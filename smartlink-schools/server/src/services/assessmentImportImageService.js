import path from "path"
import { randomUUID } from "crypto"
import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"
import { cropPdfVisualRegions, extractEmbeddedPdfImages } from "./pdfImageExtractionService.js"

const text=(value,max=2000)=>String(value??"").trim().slice(0,max)
const json=(value,fallback)=>{if(value===null||value===undefined)return fallback;if(typeof value==="object")return value;try{return JSON.parse(value)}catch{return fallback}}

async function importJob(connection,schoolId,ref,lock=false){const [[job]]=await connection.query(`SELECT * FROM assessment_import_jobs WHERE school_id=? AND public_ref=? LIMIT 1${lock?" FOR UPDATE":""}`,[schoolId,ref]);if(!job)throw new HttpError(404,"Assessment import was not found");return job}
async function audit(connection,{schoolId,jobId,userId,assetId=null,action,before=null,after=null}){await connection.query("INSERT INTO assessment_import_asset_audit (school_id,import_job_id,asset_id,actor_user_id,action,before_json,after_json) VALUES (?,?,?,?,?,?,?)",[schoolId,jobId,assetId,userId,action,before?JSON.stringify(before):null,after?JSON.stringify(after):null])}

async function saveAsset(connection,{schoolId,jobId,userId,asset}){
  const checksum=text(asset.checksum,64)||null
  let duplicate=null
  if(checksum){[[duplicate]]=await connection.query("SELECT id,file_path,document_type,page_number,linked_question_temp_id FROM assessment_import_assets WHERE school_id=? AND import_job_id=? AND checksum=? AND removed_at IS NULL ORDER BY id LIMIT 1",[schoolId,jobId,checksum])}
  if(duplicate&&duplicate.document_type===asset.document_type&&Number(duplicate.page_number||0)===Number(asset.page_number||0)&&String(duplicate.linked_question_temp_id||"")===String(asset.linked_question_temp_id||""))return duplicate.id
  const filePath=duplicate?.file_path||asset.file_path
  const method=["embedded","vector_crop","page_crop","cropped_from_scan"].includes(asset.extraction_method)?asset.extraction_method:(asset.bbox_json?"vector_crop":"embedded")
  const status=["unassigned","suggested","confirmed","rejected"].includes(asset.assignment_status)?asset.assignment_status:(asset.linked_question_temp_id?"suggested":"unassigned")
  const [saved]=await connection.query(`INSERT INTO assessment_import_assets (
    public_ref,school_id,import_job_id,document_type,page_number,asset_type,file_path,bbox_json,alt_text,
    linked_question_temp_id,suggested_question_number,source_asset_key,extraction_method,file_name,mime_type,
    width,height,aspect_ratio,placement,requires_review,assignment_status,checksum,duplicate_of_asset_id,created_by,confidence
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
    asset.public_ref||randomUUID(),schoolId,jobId,asset.document_type,asset.page_number||null,asset.asset_type||"unknown",filePath,
    asset.bbox_json?JSON.stringify(asset.bbox_json):null,asset.alt_text||null,asset.linked_question_temp_id||null,
    asset.suggested_question_number||asset.linked_question_number||null,asset.source_asset_key||null,method,
    asset.file_name||path.basename(filePath),asset.mime_type||null,Number(asset.width)||null,Number(asset.height)||null,
    Number(asset.aspect_ratio)||null,asset.placement||"unassigned",asset.requires_review===false?0:1,status,checksum,
    duplicate?.id||null,userId,Math.max(.05,Math.min(.99,Number(asset.confidence)||.5)),
  ])
  return saved.insertId
}

function payload(asset,ref){return {...asset,requires_review:Boolean(asset.requires_review),row_version:Number(asset.row_version||1),width:asset.width===null?null:Number(asset.width),height:asset.height===null?null:Number(asset.height),aspect_ratio:asset.aspect_ratio===null?null:Number(asset.aspect_ratio),confidence:asset.confidence===null?null:Number(asset.confidence),preview_url:`/api/assessment-imports/${ref}/assets/${asset.public_ref}/preview`}}

export async function listImportImages(schoolId,ref){
  const job=await importJob(pool,schoolId,ref)
  const [assets]=await pool.query("SELECT public_ref,document_type,page_number,asset_type,alt_text,linked_question_temp_id,suggested_question_number,extraction_method,file_name,mime_type,width,height,aspect_ratio,placement,requires_review,assignment_status,checksum,row_version,confidence,created_at,updated_at FROM assessment_import_assets WHERE school_id=? AND import_job_id=? AND removed_at IS NULL ORDER BY document_type,page_number,id",[schoolId,job.id])
  const [[duplicates]]=await pool.query("SELECT COUNT(*) duplicate_count FROM assessment_import_assets WHERE school_id=? AND import_job_id=? AND removed_at IS NULL AND duplicate_of_asset_id IS NOT NULL",[schoolId,job.id])
  return {success:true,import_ref:ref,summary:{status:job.image_extraction_status,pages_processed:Number(job.image_extraction_pages_processed||0),total_pages:Number(job.image_extraction_total_pages||0),images_found:Number(job.image_extraction_images_found||0),images_saved:Number(job.image_extraction_images_saved||0),images_requiring_review:Number(job.image_extraction_review_count||0),duplicates_skipped:Number(duplicates?.duplicate_count||0),last_error:job.image_extraction_last_error,version:Number(job.image_extraction_version||0)},images:assets.map((asset)=>payload(asset,ref))}
}

export async function patchImportImage(schoolId,userId,ref,assetRef,body={}){
  const connection=await pool.getConnection()
  try{
    await connection.beginTransaction()
    const job=await importJob(connection,schoolId,ref,true)
    const [[asset]]=await connection.query("SELECT * FROM assessment_import_assets WHERE school_id=? AND import_job_id=? AND public_ref=? AND removed_at IS NULL FOR UPDATE",[schoolId,job.id,assetRef])
    if(!asset)throw new HttpError(404,"Extracted image was not found")
    if(body.row_version!==undefined&&Number(body.row_version)!==Number(asset.row_version))throw new HttpError(409,"This image was changed by another user. Refresh and try again.",{code:"ASSET_VERSION_CONFLICT",details:{current_version:Number(asset.row_version)}})
    let linkedTemp=asset.linked_question_temp_id,questionNumber=asset.suggested_question_number
    if(body.question_ref!==undefined){
      if(body.question_ref){const [[question]]=await connection.query("SELECT temp_question_id,question_number FROM assessment_import_questions WHERE school_id=? AND import_job_id=? AND public_ref=? LIMIT 1",[schoolId,job.id,body.question_ref]);if(!question)throw new HttpError(400,"Select a question from this imported paper");linkedTemp=question.temp_question_id;questionNumber=question.question_number}
      else{linkedTemp=null;questionNumber=null}
    }
    const types=new Set(["image","diagram","graph","chart","map","table","table_image","logo","cover_graphic","scientific_illustration","geometric_figure","formula_image","photo","apparatus","other","unknown"])
    const assetType=types.has(body.asset_type)?body.asset_type:asset.asset_type
    const placement=["before_question_text","after_question_text","inline","cover","unassigned"].includes(body.placement)?body.placement:asset.placement
    let status=["unassigned","suggested","confirmed","rejected"].includes(body.assignment_status)?body.assignment_status:asset.assignment_status
    if(status==="confirmed"&&!linkedTemp)throw new HttpError(400,"Assign the image to a question before confirming it")
    if(!linkedTemp&&status==="suggested")status="unassigned"
    const next={linked_question_temp_id:linkedTemp,suggested_question_number:questionNumber,asset_type:assetType,placement,assignment_status:status,requires_review:status==="confirmed"?0:(body.requires_review===false?0:1),alt_text:body.alt_text===undefined?asset.alt_text:text(body.alt_text,255)}
    const [updated]=await connection.query("UPDATE assessment_import_assets SET linked_question_temp_id=?,suggested_question_number=?,asset_type=?,placement=?,assignment_status=?,requires_review=?,alt_text=?,row_version=row_version+1 WHERE id=? AND school_id=? AND row_version=?",[next.linked_question_temp_id,next.suggested_question_number,next.asset_type,next.placement,next.assignment_status,next.requires_review,next.alt_text,asset.id,schoolId,asset.row_version])
    if(!updated.affectedRows)throw new HttpError(409,"This image was changed by another user. Refresh and try again.",{code:"ASSET_VERSION_CONFLICT"})
    const action=status==="confirmed"?"confirmed":asset.linked_question_temp_id&&asset.linked_question_temp_id!==linkedTemp?"reassigned":"assigned"
    await audit(connection,{schoolId,jobId:job.id,userId,assetId:asset.id,action,before:{linked_question_temp_id:asset.linked_question_temp_id,suggested_question_number:asset.suggested_question_number,assignment_status:asset.assignment_status,placement:asset.placement},after:next})
    await connection.query("UPDATE assessment_import_jobs SET image_extraction_review_count=(SELECT COUNT(*) FROM assessment_import_assets WHERE import_job_id=? AND removed_at IS NULL AND requires_review=1) WHERE id=?",[job.id,job.id])
    await connection.commit()
    return listImportImages(schoolId,ref)
  }catch(error){await connection.rollback();throw error}finally{connection.release()}
}

export async function removeImportImage(schoolId,userId,ref,assetRef){
  const connection=await pool.getConnection()
  try{await connection.beginTransaction();const job=await importJob(connection,schoolId,ref,true);const [[asset]]=await connection.query("SELECT id,public_ref,linked_question_temp_id,suggested_question_number,assignment_status FROM assessment_import_assets WHERE school_id=? AND import_job_id=? AND public_ref=? AND removed_at IS NULL FOR UPDATE",[schoolId,job.id,assetRef]);if(!asset)throw new HttpError(404,"Extracted image was not found");await connection.query("UPDATE assessment_import_assets SET removed_at=CURRENT_TIMESTAMP,assignment_status='rejected',linked_question_temp_id=NULL,row_version=row_version+1 WHERE id=? AND school_id=?",[asset.id,schoolId]);await audit(connection,{schoolId,jobId:job.id,userId,assetId:asset.id,action:"removed",before:asset,after:{removed:true}});await connection.query("UPDATE assessment_import_jobs SET image_extraction_images_saved=(SELECT COUNT(*) FROM assessment_import_assets WHERE import_job_id=? AND removed_at IS NULL),image_extraction_review_count=(SELECT COUNT(*) FROM assessment_import_assets WHERE import_job_id=? AND removed_at IS NULL AND requires_review=1) WHERE id=?",[job.id,job.id,job.id]);await connection.commit();return {ok:true}}catch(error){await connection.rollback();throw error}finally{connection.release()}
}

export async function extractImportImages(schoolId,userId,ref){
  const job=await importJob(pool,schoolId,ref)
  const [claimed]=await pool.query("UPDATE assessment_import_jobs SET image_extraction_status='processing',image_extraction_started_at=CURRENT_TIMESTAMP,image_extraction_completed_at=NULL,image_extraction_last_error=NULL,image_extraction_pages_processed=0,image_extraction_version=image_extraction_version+1 WHERE id=? AND school_id=? AND image_extraction_status<>'processing'",[job.id,schoolId])
  if(!claimed.affectedRows)throw new HttpError(409,"Image extraction is already running for this import.",{code:"IMAGE_EXTRACTION_IN_PROGRESS"})
  await audit(pool,{schoolId,jobId:job.id,userId,action:job.image_extraction_status==="failed"?"retry_started":"extraction_started"})
  const folder=path.dirname(path.resolve(process.cwd(),job.student_pdf_file_path))
  try{
    const [[pageRows],[questionRows],[priorVisualRows]]=await Promise.all([
      pool.query("SELECT document_type,page_number,text_content FROM assessment_import_pages WHERE school_id=? AND import_job_id=? ORDER BY document_type,page_number",[schoolId,job.id]),
      pool.query("SELECT temp_question_id,question_number,question_text,page_start,assets_json FROM assessment_import_questions WHERE school_id=? AND import_job_id=? ORDER BY id",[schoolId,job.id]),
      pool.query("SELECT linked_question_temp_id,suggested_question_number,page_number,asset_type,bbox_json,alt_text,confidence,source_asset_key FROM assessment_import_assets WHERE school_id=? AND import_job_id=? AND bbox_json IS NOT NULL ORDER BY id DESC",[schoolId,job.id]),
    ])
    const pagesByType=new Map()
    for(const row of pageRows){const rows=pagesByType.get(row.document_type)||[];rows.push({page_number:Number(row.page_number),text_content:row.text_content||""});pagesByType.set(row.document_type,rows)}
    const studentPages=pagesByType.get("student_paper")||[],markingPages=pagesByType.get("marking_scheme")||[]
    const [studentEmbedded,markingEmbedded]=await Promise.all([
      extractEmbeddedPdfImages({pdfPath:path.resolve(process.cwd(),job.student_pdf_file_path),outputDir:folder,documentType:"student_paper",pageCount:studentPages.length,pageTextByNumber:new Map(studentPages.map((page)=>[page.page_number,page.text_content]))}),
      extractEmbeddedPdfImages({pdfPath:path.resolve(process.cwd(),job.marking_scheme_pdf_file_path),outputDir:folder,documentType:"marking_scheme",pageCount:markingPages.length,pageTextByNumber:new Map(markingPages.map((page)=>[page.page_number,page.text_content]))}),
    ])
    const cropQuestions=questionRows.map((question)=>{const stored=json(question.assets_json,[]).filter((asset)=>asset?.bbox?.normalized).map((asset)=>({assetKey:asset.public_ref,assetType:asset.asset_type,pageNumber:asset.page_number,bboxNormalized:asset.bbox.normalized,description:asset.alt_text,confidence:asset.confidence}));const previous=priorVisualRows.filter((asset)=>asset.linked_question_temp_id===question.temp_question_id||asset.suggested_question_number===question.question_number).map((asset)=>{const bbox=json(asset.bbox_json,{});return {assetKey:asset.source_asset_key,assetType:asset.asset_type,pageNumber:asset.page_number,bboxNormalized:bbox.normalized,description:asset.alt_text,confidence:asset.confidence}}).filter((asset)=>asset.bboxNormalized);const unique=new Map([...stored,...previous].map((asset)=>[`${asset.pageNumber}:${JSON.stringify(asset.bboxNormalized)}`,asset]));return {tempQuestionId:question.temp_question_id,questionNumber:question.question_number,questionText:question.question_text,pageStart:question.page_start,assets:[...unique.values()]}})
    const crops=await cropPdfVisualRegions({questions:cropQuestions,pdfPath:path.resolve(process.cwd(),job.student_pdf_file_path),outputDir:folder,documentType:"student_paper",pageCount:studentPages.length,pageTextByNumber:new Map(studentPages.map((page)=>[page.page_number,page.text_content]))})
    const assets=[...studentEmbedded.assets,...markingEmbedded.assets,...crops.assets],warnings=[...studentEmbedded.warnings,...markingEmbedded.warnings,...crops.warnings]
    for(const asset of assets){if(asset.linked_question_temp_id||asset.page_number===1)continue;const prior=priorVisualRows.find((row)=>Number(row.page_number)===Number(asset.page_number)&&(row.linked_question_temp_id||row.suggested_question_number));if(prior){const question=questionRows.find((row)=>row.temp_question_id===prior.linked_question_temp_id||row.question_number===prior.suggested_question_number);if(question){asset.linked_question_temp_id=question.temp_question_id;asset.suggested_question_number=question.question_number;asset.assignment_status="suggested";asset.placement="after_question_text";asset.requires_review=true}}}
    const connection=await pool.getConnection()
    try{
      await connection.beginTransaction()
      await connection.query("UPDATE assessment_import_assets SET removed_at=CURRENT_TIMESTAMP,assignment_status='rejected',row_version=row_version+1 WHERE school_id=? AND import_job_id=? AND assignment_status<>'confirmed' AND removed_at IS NULL",[schoolId,job.id])
      for(const asset of assets)await saveAsset(connection,{schoolId,jobId:job.id,userId,asset})
      const reviewCount=assets.filter((asset)=>asset.requires_review!==false).length,totalPages=studentPages.length+markingPages.length,found=studentEmbedded.images_found+markingEmbedded.images_found+crops.assets.length,status=warnings.length?"completed_with_warnings":"completed"
      await connection.query("UPDATE assessment_import_jobs SET image_extraction_status=?,image_extraction_pages_processed=?,image_extraction_total_pages=?,image_extraction_images_found=?,image_extraction_images_saved=(SELECT COUNT(*) FROM assessment_import_assets WHERE import_job_id=? AND removed_at IS NULL),image_extraction_review_count=?,image_extraction_last_error=?,image_extraction_completed_at=CURRENT_TIMESTAMP WHERE id=?",[status,totalPages,totalPages,found,job.id,reviewCount,warnings.join(" ").slice(0,2000)||null,job.id])
      await audit(connection,{schoolId,jobId:job.id,userId,action:"extraction_completed",after:{status,pages_processed:totalPages,images_found:found,images_saved:assets.length,requires_review:reviewCount}})
      await connection.commit()
    }catch(error){await connection.rollback();throw error}finally{connection.release()}
    return listImportImages(schoolId,ref)
  }catch(error){await pool.query("UPDATE assessment_import_jobs SET image_extraction_status='failed',image_extraction_last_error=?,image_extraction_completed_at=CURRENT_TIMESTAMP WHERE id=?",[text(error.message,2000),job.id]).catch(()=>{});await audit(pool,{schoolId,jobId:job.id,userId,action:"extraction_failed",after:{error:text(error.message,500)}}).catch(()=>{});throw new HttpError(422,`SmartLink could not extract images from this PDF: ${text(error.message,500)}`,{code:"ASSESSMENT_IMAGE_EXTRACTION_FAILED",details:{retryable:true}})}
}
