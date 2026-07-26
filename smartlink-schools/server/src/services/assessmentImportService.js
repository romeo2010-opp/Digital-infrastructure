import fs from "fs/promises"
import path from "path"
import { randomUUID } from "crypto"
import { execFile } from "child_process"
import { promisify } from "util"
import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"
import { ASSESSMENT_VISION_PROMPT_VERSION, generateReviewWarnings, matchQuestionsToMarkingScheme, normalizeFormulaText, parseMarkingScheme, parseStudentPaper } from "./assessmentImportParserService.js"
import { extractCoverTemplateFromImport } from "./assessmentTemplateService.js"
import { cropPdfVisualRegions, extractEmbeddedPdfImages } from "./pdfImageExtractionService.js"
import { validateSyllabusTopicScope } from "./curriculumScopeService.js"
import { getActiveAcademicSession } from "./academicSessionService.js"

const run=promisify(execFile),clean=(value,max=2000)=>String(value??"").trim().slice(0,max)
const ASSESSMENT_IMPORT_QUESTION_REVIEWER_ROLES=new Set(["super_admin","school_owner","owner","director","headteacher"])

export function importedQuestionExplanation(answerText,markingPointsJson){
  const answer=clean(answerText,60000)
  const points=parseDbJson(markingPointsJson,[])
  const rows=(Array.isArray(points)?points:[]).map((point)=>{
    if(typeof point==="string"||typeof point==="number")return clean(point,4000)
    if(!point||typeof point!=="object")return ""
    return clean(point.text??point.point??point.description??point.answer??point.criterion,4000)
  }).filter(Boolean)
  return rows.join("\n")||(answer?`Correct answer: ${answer}`:null)
}

export function importedQuestionBankModeration({actorRole,correctAnswer,explanation,topicId,gradeId,subjectId}={}){
  const missing=[]
  if(!clean(correctAnswer,60000))missing.push("correct answer")
  if(!clean(explanation,60000))missing.push("explanation")
  if(!Number(topicId||0))missing.push("topic")
  if(!Number(gradeId||0))missing.push("grade")
  if(!Number(subjectId||0))missing.push("subject")
  const canModerate=ASSESSMENT_IMPORT_QUESTION_REVIEWER_ROLES.has(String(actorRole||"").toLowerCase())
  return {approvalStatus:canModerate&&!missing.length?"approved":"pending_review",approvalReady:!missing.length,missing}
}

function decodePdf(value,label){const match=String(value||"").match(/^data:application\/pdf;base64,(.+)$/s);if(!match)throw new HttpError(400,`${label} must be a PDF file`);const buffer=Buffer.from(match[1],"base64");if(buffer.length<5||buffer.subarray(0,5).toString()!=="%PDF-")throw new HttpError(400,`${label} is not a valid PDF`);if(buffer.length>20*1024*1024)throw new HttpError(413,`${label} exceeds the 20MB limit`);return buffer}
function regexQuestions(pages){const results=[];for(const page of pages){const blocks=String(page.text_content||"").split(/\n(?=\s*\d+(?:\s*[.(]|\s+))/);for(const block of blocks){const match=block.match(/^\s*(\d+(?:\s*\([a-zivx]+\))*)[.)]?\s+([\s\S]{8,})/i);if(!match)continue;const marks=match[2].match(/(?:\[|\()\s*(\d+(?:\.\d+)?)\s*(?:marks?)?\s*(?:\]|\))/i);results.push({tempQuestionId:`Q${results.length+1}`,questionNumber:match[1].replace(/\s/g,""),questionText:match[2].trim(),marks:marks?Number(marks[1]):null,pageStart:page.page_number,pageEnd:page.page_number,formulaCandidates:/[=±√∑∫^]/.test(match[2])?[match[2].match(/[^.!?\n]*[=±√∑∫^][^.!?\n]*/)?.[0]||""]:[],assets:[],confidence:.55})}}return results}
function regexMarking(pages){return regexQuestions(pages).map((q)=>({tempQuestionId:q.tempQuestionId,questionNumber:q.questionNumber,answerText:q.questionText,markingPoints:[],totalMarks:q.marks,pageNumber:q.pageStart,confidence:.48}))}
function normalizeResponseLayout(value={}){const rawType=clean(value.type||value.answer_space_type,40).toLowerCase();const aliases={ruled:"ruled_lines",lines:"ruled_lines",underscore_lines:"ruled_lines",blank:"blank_space",open_space:"blank_space",box:"blank_box",grid:"graph_grid"};const type=aliases[rawType]||rawType;const supported=new Set(["ruled_lines","blank_space","blank_box","graph_grid","none"]);const answerType=supported.has(type)?type:"none";const explicitHeightPoints=Number(value.heightPoints??value.height_points);const editedHeightPx=Number(value.answer_height);const heightPoints=Math.max(0,Math.min(700,Number.isFinite(editedHeightPx)&&editedHeightPx>0?editedHeightPx*3/4:(Number.isFinite(explicitHeightPoints)?explicitHeightPoints:0)));const lineCount=Math.max(0,Math.min(40,Math.round(Number(value.lineCount??value.line_count??value.answer_lines)||0)));return {answer_space_type:answerType,answer_lines:answerType==="ruled_lines"?lineCount:0,answer_height:answerType==="none"?0:Math.max(24,Math.round(Number.isFinite(editedHeightPx)&&editedHeightPx>0?editedHeightPx:heightPoints*4/3)||120),height_points:heightPoints,line_count:lineCount,page_number:Number(value.pageNumber??value.page_number)||null,starts_after_question:value.startsAfterQuestion!==false,show_border:["blank_box","graph_grid"].includes(answerType),confidence:Math.max(.05,Math.min(.99,Number(value.confidence)||.5)),evidence:clean(value.evidence,500)||null}}

function tableCell(value){
  if(value&&typeof value==="object")return clean(value.text??value.value??value.label,1000)
  return clean(value,1000)
}

export function normalizeStructuredTables(value=[]){
  if(!Array.isArray(value))return []
  return value.slice(0,12).map((table,index)=>{
    if(!table||typeof table!=="object")return null
    const headerSource=table.columnHeaders||table.column_headers||table.headers||(Array.isArray(table.columns)?table.columns:[])
    const headers=Array.isArray(headerSource)?headerSource.slice(0,12).map(tableCell):[]
    const rowSource=Array.isArray(table.cells)?table.cells:Array.isArray(table.rows)?table.rows:[]
    let cells=rowSource.slice(0,60).map((row)=>Array.isArray(row)?row.slice(0,12).map(tableCell):[])
    const headerRow=Boolean(table.headerRow??table.header_row??headers.some(Boolean))
    if(headers.length&&(!cells.length||headers.some((cell,column)=>cell!==cells[0]?.[column])))cells=[headers,...cells]
    const requestedColumns=Number(Array.isArray(table.columns)?0:table.columns||table.columnCount||table.column_count)||0
    const columnCount=Math.min(12,Math.max(1,requestedColumns,headers.length,...cells.map((row)=>row.length)))
    cells=cells.map((row)=>Array.from({length:columnCount},(_,column)=>tableCell(row[column])))
    if(!cells.length)cells=[Array.from({length:columnCount},()=>"")]
    if(!cells.some((row)=>row.some(Boolean))&&!clean(table.caption||table.title,300))return null
    return {
      table_id:clean(table.tableId||table.table_id||`table-${index+1}`,80),
      type:"table",
      caption:clean(table.caption||table.title,300),
      page_number:Number(table.pageNumber??table.page_number)||null,
      header_row:headerRow,
      rows:cells.length,
      columns:columnCount,
      cells,
      confidence:Math.max(.05,Math.min(.99,Number(table.confidence)||.5)),
    }
  }).filter(Boolean)
}

export function structuredTableParts(value=[]){return normalizeStructuredTables(value).map((table)=>({...table,local_id:table.table_id}))}
function questionTablesFromStorage(question={}){return normalizeStructuredTables(parseDbJson(question.bbox_json,{}).structured_tables||question.tables||[])}
function questionBankAssets(question={}){
  const stored=parseDbJson(question.assets_json,[])
  const assets=Array.isArray(stored)?stored:[]
  const tables=structuredTableParts(questionTablesFromStorage(question)).map((table)=>({...table,asset_type:"structured_table"}))
  return [...assets,...tables]
}
function exactQuestionNumber(value){return clean(value,80).trim()}
function referenceKey(value){return exactQuestionNumber(value).toLowerCase().replace(/[\s.()[\]{}_-]+/g,"")}
function textTokens(value){return new Set(clean(value,4000).toLowerCase().replace(/[^a-z0-9]+/g," ").split(/\s+/).filter((token)=>token.length>2))}
function questionTextSimilarity(left,right){const a=textTokens(left),b=textTokens(right),union=new Set([...a,...b]);if(!union.size)return 0;let common=0;a.forEach((token)=>{if(b.has(token))common+=1});return common/union.size}
function printedTextMatchScore(questionText,candidateText){const question=clean(questionText,4000).toLowerCase().replace(/[^a-z0-9]+/g," ").trim();const candidate=clean(candidateText,1000).toLowerCase().replace(/[^a-z0-9]+/g," ").trim();if(!question||!candidate)return 0;if(question.includes(candidate)||candidate.includes(question))return .99;const candidateTokens=candidate.split(/\s+/).filter((token)=>token.length>2);if(!candidateTokens.length)return 0;const questionSet=textTokens(question);return candidateTokens.filter((token)=>questionSet.has(token)).length/candidateTokens.length}
function printedQuestionCandidates(pages=[]){let mainNumber="",letter="";const candidates=[];for(const page of pages){for(const rawLine of String(page.text_content||"").split(/\r?\n/)){let line=rawLine.trim();if(!line)continue;if(/^section\s+[a-z0-9]+/i.test(line)){mainNumber="";letter="";continue}let found=false;const main=line.match(/^(\d{1,3})\.\s*(.+)$/);if(main){const proposed=Number(main[1]);const current=Number(mainNumber)||0;if(!current||proposed>=current){mainNumber=main[1];letter="";line=main[2].trim();found=true}}const letterMatch=line.match(/^([a-z])\.\s*(.+)$/i);if(letterMatch){letter=letterMatch[1];line=letterMatch[2].trim();found=true}const romanMatch=line.match(/^(\([ivxlcdm]+\))\s*(.+)$/i);let roman="";if(romanMatch){roman=romanMatch[1];line=romanMatch[2].trim();found=true}if(!found||!mainNumber||line.length<4)continue;const reference=[`${mainNumber}.`,letter?`${letter}.`:"",roman].filter(Boolean).join(" ");candidates.push({reference,text:line,page_number:Number(page.page_number)||null})}}return candidates}
export function reconcileQuestionNumbersWithPrintedSource(records=[],pages=[],options={}){const textField=options.textField||"questionText",pageField=options.pageField||"pageStart",numberField=options.numberField||"questionNumber";const candidates=printedQuestionCandidates(pages),used=new Set();for(const record of records){const page=Number(record?.[pageField])||0;const ranked=candidates.map((candidate,index)=>({candidate,index,score:printedTextMatchScore(record?.[textField],candidate.text),pageDistance:page&&candidate.page_number?Math.abs(page-candidate.page_number):0})).filter((row)=>!used.has(row.index)&&row.pageDistance<=1).sort((left,right)=>(right.score-left.score)||(left.pageDistance-right.pageDistance));const best=ranked[0];if(best&&best.score>=.6){record[numberField]=best.candidate.reference;used.add(best.index)}}return records}
function safeAssetPart(value){return clean(value,80).replace(/[^a-z0-9_-]+/gi,"-").replace(/^-|-$/g,"")||"question"}
async function cropQuestionDiagramAssets(questions,filePath,folder,pageCount,pages=[]){
  const pageTextByNumber=new Map(pages.map((page)=>[Number(page.page_number),page.text_content||""]))
  const result=await cropPdfVisualRegions({questions,pdfPath:filePath,outputDir:folder,documentType:"student_paper",pageCount,pageTextByNumber})
  result.assets.extractionWarnings=result.warnings
  return result.assets
}
function preferEmbeddedDiagramAssets(detected=[],embedded=[]){const used=new Set();return detected.map((diagram)=>{if(diagram.bbox_json?.normalized&&["diagram","graph","chart","map","table","scientific_illustration","geometric_figure","formula_image"].includes(diagram.asset_type))return diagram;const best=embedded.filter((asset)=>!used.has(asset.public_ref)&&asset.page_number===diagram.page_number&&asset.embedded_type==="image"&&Number(asset.width||0)>=80&&Number(asset.height||0)>=60).sort((left,right)=>(right.width*right.height)-(left.width*left.height))[0];if(!best)return diagram;used.add(best.public_ref);return {...diagram,...best,asset_type:diagram.asset_type,linked_question_temp_id:diagram.linked_question_temp_id,suggested_question_number:diagram.suggested_question_number||diagram.linked_question_number,source_question_index:diagram.source_question_index,linked_question_number:diagram.linked_question_number,source_asset_key:`embedded-${best.embedded_number}`,extraction_method:"embedded",placement:"after_question_text",assignment_status:"suggested",requires_review:Number(diagram.confidence)<.8,bbox_json:{...(diagram.bbox_json||{}),embedded_width:best.width,embedded_height:best.height,extraction_method:"embedded"},alt_text:diagram.alt_text,confidence:Math.max(diagram.confidence,.85)}})}
async function jobByRef(connection,schoolId,ref,lock=false){const [[job]]=await connection.query(`SELECT * FROM assessment_import_jobs WHERE school_id=? AND public_ref=? LIMIT 1${lock?" FOR UPDATE":""}`,[schoolId,ref]);if(!job)throw new HttpError(404,"Assessment import was not found");return job}

async function resolveImportAssessmentTeacher(connection,schoolId,userId,job,term){
  const [[actor]]=await connection.query("SELECT id,role FROM users WHERE school_id=? AND id=? AND is_active=1 LIMIT 1",[schoolId,userId])
  if(!actor)throw new HttpError(403,"Your active school account could not be verified")
  const actorRole=String(actor.role||"").toLowerCase()
  const activeSession=await getActiveAcademicSession(schoolId,connection)
  if(activeSession.setupRequired||Number(term.academic_year_id)!==Number(activeSession.academicYearId)||Number(job.term_id)!==Number(activeSession.termId)){
    throw new HttpError(actorRole==="teacher"?403:400,"Assessment imports can only be approved for the current academic year and term")
  }
  const teacherClause=actorRole==="teacher"?" AND assignment.teacher_id=?":""
  const params=[schoolId,job.class_id,job.subject_id,activeSession.academicYearId,activeSession.termId]
  if(actorRole==="teacher")params.push(userId)
  const [[assignment]]=await connection.query(`SELECT assignment.teacher_id
    FROM teacher_class_subject_assignments assignment
    JOIN users teacher ON teacher.id=assignment.teacher_id AND teacher.school_id=assignment.school_id
    WHERE assignment.school_id=? AND assignment.class_id=? AND assignment.subject_id=?
      AND assignment.academic_year_id=? AND assignment.term_id=?
      AND assignment.role='subject_teacher' AND assignment.is_active=1
      AND teacher.role='teacher' AND teacher.is_active=1${teacherClause}
    ORDER BY assignment.updated_at DESC,assignment.id DESC
    LIMIT 1`,params)
  if(!assignment)throw new HttpError(actorRole==="teacher"?403:400,actorRole==="teacher"?"Teachers can only approve imports for their current academic-year and term assignments":"Assign an active subject teacher to this class and subject for the current academic year and term before approving the assessment")
  return Number(assignment.teacher_id)
}

export function inspectPdfStructure(pdfBuffer){
  const source=Buffer.from(pdfBuffer||[]).toString("latin1")
  const header=source.slice(0,16)
  const tail=source.slice(-8192)
  const pageTreeCounts=[...source.matchAll(/\/Type\s*\/Pages\b[^>]*\/Count\s+(\d+)/g)].map((match)=>Number(match[1])).filter((value)=>value>0)
  const visiblePageObjects=(source.match(/\/Type\s*\/Page\b/g)||[]).length
  return {
    validHeader:header.startsWith("%PDF-"),
    // Readers tolerate harmless trailing bytes after the final EOF marker.
    hasEof:/%%EOF/.test(tail),
    encrypted:/\/Encrypt\b/.test(source),
    pageCount:Math.max(1,...pageTreeCounts,visiblePageObjects),
  }
}

export function pdfPagesFromText(text,pageCount=1){
  const raw=String(text||"").split("\f")
  if(raw.length>1&&!raw.at(-1)?.trim())raw.pop()
  const total=Math.max(1,Number(pageCount)||1,raw.length)
  return Array.from({length:total},(_,index)=>({page_number:index+1,text_content:String(raw[index]||"").trim()}))
}

function pdfCommandFailureReason(error){
  if(error?.code==="ENOENT")return "Poppler text extraction is not installed on this server"
  const stderr=clean(error?.stderr||error?.cause?.stderr||"",300).replace(/\s+/g," ")
  return stderr||clean(error?.message,300)||"the embedded text layer could not be decoded"
}

export async function extractDocument(job,documentType,filePath,folder){
  const textFile=path.join(folder,`${documentType}.txt`)
  const pdfBuffer=await fs.readFile(filePath)
  const structure=inspectPdfStructure(pdfBuffer)
  if(!structure.validHeader||!structure.hasEof){throw new HttpError(422,`SmartLink could not verify the ${documentType.replaceAll("_"," ")} PDF structure. The upload appears incomplete or corrupted.`,{code:"ASSESSMENT_PDF_INVALID_STRUCTURE",details:{document_type:documentType}})}
  await fs.unlink(textFile).catch(()=>{})
  let textExtractionError=null
  try{await run("pdftotext",["-layout","-enc","UTF-8",filePath,textFile],{timeout:120000,maxBuffer:5*1024*1024})}
  catch(error){textExtractionError=error}
  const text=await fs.readFile(textFile,"utf8").catch(()=>"")
  if(textExtractionError&&structure.encrypted&&!text.trim()){throw new HttpError(422,`SmartLink could not unlock the ${documentType.replaceAll("_"," ")} PDF. Remove its password and upload it again.`,{code:"ASSESSMENT_PDF_PASSWORD_PROTECTED",details:{document_type:documentType}})}
  const pages=pdfPagesFromText(text,structure.pageCount)
  const coverPrefix=path.join(folder,`${documentType}-cover`)
  await run("pdftoppm",["-f","1","-l","1","-singlefile","-png","-r","180",filePath,coverPrefix],{timeout:120000}).catch(()=>{})
  const coverPath=`${coverPrefix}.png`
  const relativeCover=await fs.access(coverPath).then(()=>path.relative(process.cwd(),coverPath)).catch(()=>null)
  let imageExtraction={assets:[],warnings:[],scan_pages:[],images_found:0,duplicates_skipped:0}
  try{
    imageExtraction=await extractEmbeddedPdfImages({pdfPath:filePath,outputDir:folder,documentType,pageCount:pages.length,pageTextByNumber:new Map(pages.map((page)=>[page.page_number,page.text_content]))})
  }catch(error){imageExtraction.warnings=[`Embedded image extraction failed for the ${documentType.replaceAll("_"," ")}: ${clean(error.message,240)}`]}
  if(textExtractionError){imageExtraction.warnings.unshift(`Embedded text extraction was unavailable (${pdfCommandFailureReason(textExtractionError)}). SmartLink continued with visual PDF analysis.`)}
  else if(!text.trim()){imageExtraction.warnings.unshift("This PDF has no readable embedded text layer. SmartLink continued with visual PDF analysis.")}
  return {pages,pdfData:pdfBuffer.toString("base64"),coverPath:relativeCover,assets:imageExtraction.assets,imageExtraction,textExtraction:{ok:!textExtractionError&&Boolean(text.trim()),fallbackUsed:Boolean(textExtractionError)||!text.trim(),reason:textExtractionError?pdfCommandFailureReason(textExtractionError):!text.trim()?"empty_text_layer":null}}
}

function assessmentImportFailure(error,stage){if(error instanceof HttpError&&Number(error.status)<500)return error;const databaseFailure=String(error?.code||"").startsWith("ER_");const message=databaseFailure?"SmartLink read the PDFs but could not save the extracted assessment. Please retry. If this continues, ask an administrator to verify assessment import migration 041.":`Assessment import stopped while ${stage}. Please retry; the uploaded PDFs have been kept.`;return new HttpError(500,message,{code:databaseFailure?"ASSESSMENT_IMPORT_SAVE_FAILED":"ASSESSMENT_IMPORT_PROCESSING_FAILED",details:{stage,retryable:true},expose:true,cause:error})}
function parseDbJson(value,fallback){if(value===null||value===undefined)return fallback;if(typeof value==="object")return value;try{return JSON.parse(value)}catch{return fallback}}
async function saveImportAsset(connection,{schoolId,jobId,userId,asset}){
  const checksum=clean(asset.checksum,64)||null
  let duplicate=null
  if(checksum){[[duplicate]]=await connection.query("SELECT id,file_path,document_type,page_number,linked_question_temp_id FROM assessment_import_assets WHERE school_id=? AND import_job_id=? AND checksum=? AND removed_at IS NULL ORDER BY id LIMIT 1",[schoolId,jobId,checksum])}
  if(duplicate&&duplicate.document_type===asset.document_type&&Number(duplicate.page_number||0)===Number(asset.page_number||0)&&String(duplicate.linked_question_temp_id||"")===String(asset.linked_question_temp_id||"")){asset.id=duplicate.id;asset.file_path=duplicate.file_path;return asset}
  const filePath=duplicate?.file_path||asset.file_path
  const assignmentStatus=["unassigned","suggested","confirmed","rejected"].includes(asset.assignment_status)?asset.assignment_status:(asset.linked_question_temp_id?"suggested":"unassigned")
  const extractionMethod=["embedded","vector_crop","page_crop","cropped_from_scan"].includes(asset.extraction_method)?asset.extraction_method:(asset.bbox_json?"vector_crop":"embedded")
  const [saved]=await connection.query(`INSERT INTO assessment_import_assets (
    public_ref,school_id,import_job_id,document_type,page_number,asset_type,file_path,bbox_json,alt_text,
    linked_question_temp_id,suggested_question_number,source_asset_key,extraction_method,file_name,mime_type,
    width,height,aspect_ratio,placement,requires_review,assignment_status,checksum,duplicate_of_asset_id,created_by,confidence
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
    asset.public_ref||randomUUID(),schoolId,jobId,asset.document_type,asset.page_number||null,asset.asset_type||"unknown",filePath,
    asset.bbox_json?JSON.stringify(asset.bbox_json):null,asset.alt_text||null,asset.linked_question_temp_id||null,
    asset.suggested_question_number||asset.linked_question_number||null,asset.source_asset_key||null,extractionMethod,
    asset.file_name||path.basename(filePath),asset.mime_type||null,Number(asset.width)||null,Number(asset.height)||null,
    Number(asset.aspect_ratio)||null,asset.placement||"unassigned",asset.requires_review===false?0:1,assignmentStatus,checksum,
    duplicate?.id||null,userId||null,Math.max(.05,Math.min(.99,Number(asset.confidence)||.5)),
  ])
  asset.id=saved.insertId
  asset.file_path=filePath
  return asset
}
async function auditImportAsset(connection,{schoolId,jobId,userId,assetId=null,action,before=null,after=null}){await connection.query("INSERT INTO assessment_import_asset_audit (school_id,import_job_id,asset_id,actor_user_id,action,before_json,after_json) VALUES (?,?,?,?,?,?,?)",[schoolId,jobId,assetId,userId,action,before?JSON.stringify(before):null,after?JSON.stringify(after):null])}

export async function createAssessmentImport(schoolId,userId,body={}){
  const classId=Number(body.class_id)||0,subjectId=Number(body.subject_id)||0,termId=Number(body.term_id)||0
  const title=clean(body.title,180)
  if(!title)throw new HttpError(400,"Assessment title is required")
  const [[scope]]=await pool.query(`SELECT actor.role,term.academic_year_id
    FROM users actor
    JOIN classes class_scope ON class_scope.school_id=actor.school_id AND class_scope.id=?
    JOIN subjects subject_scope ON subject_scope.school_id=actor.school_id AND subject_scope.id=?
    JOIN terms term ON term.school_id=actor.school_id AND term.id=?
    WHERE actor.school_id=? AND actor.id=? AND actor.is_active=1 LIMIT 1`,[classId,subjectId,termId,schoolId,userId])
  if(!scope)throw new HttpError(400,"Select a class, subject and term from this school")
  if(String(scope.role||"").toLowerCase()==="teacher"){
    const activeSession=await getActiveAcademicSession(schoolId)
    if(activeSession.setupRequired||Number(scope.academic_year_id)!==Number(activeSession.academicYearId)||termId!==Number(activeSession.termId))throw new HttpError(403,"Teachers can only import assessments for the current academic year and term")
    const [[assignment]]=await pool.query("SELECT id FROM teacher_class_subject_assignments WHERE school_id=? AND teacher_id=? AND class_id=? AND subject_id=? AND academic_year_id=? AND term_id=? AND role='subject_teacher' AND is_active=1 LIMIT 1",[schoolId,userId,classId,subjectId,activeSession.academicYearId,activeSession.termId])
    if(!assignment)throw new HttpError(403,"Teachers can only import assessments for their current academic-year and term assignments")
  }
  const student=decodePdf(body.student_pdf_data_url||body.studentPdfDataUrl,"Student question paper"),marking=decodePdf(body.marking_scheme_pdf_data_url||body.markingSchemePdfDataUrl,"Marking scheme"),ref=randomUUID(),folder=path.resolve(process.cwd(),"uploads","assessment-imports",String(schoolId),ref)
  await fs.mkdir(folder,{recursive:true})
  const studentPath=path.join(folder,"student-paper.pdf"),markingPath=path.join(folder,"marking-scheme.pdf")
  await Promise.all([fs.writeFile(studentPath,student),fs.writeFile(markingPath,marking)])
  await pool.query(`INSERT INTO assessment_import_jobs (public_ref,school_id,created_by,title,subject_id,class_id,term_id,assessment_type,assessment_date,duration_minutes,student_pdf_file_path,marking_scheme_pdf_file_path,parser_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,[ref,schoolId,userId,title,subjectId,classId,termId,clean(body.assessment_type,40)||"exam",body.assessment_date||null,Number(body.duration_minutes)||null,path.relative(process.cwd(),studentPath),path.relative(process.cwd(),markingPath),"smartlink-pdf-import-v1"])
  return {import_job:{public_ref:ref,status:"uploaded",progress_percentage:0,id:undefined}}
}

export async function listAssessmentImports(schoolId,viewer={}){
  const teacher=String(viewer.role||"").toLowerCase()==="teacher"
  if(!teacher){const [rows]=await pool.query("SELECT public_ref,title,assessment_type,status,progress_percentage,error_message,created_at,updated_at,assessment_id FROM assessment_import_jobs WHERE school_id=? ORDER BY created_at DESC LIMIT 100",[schoolId]);return {imports:rows}}
  const session=await getActiveAcademicSession(schoolId)
  if(session.setupRequired)return {imports:[]}
  const [rows]=await pool.query(`SELECT DISTINCT job.public_ref,job.title,job.assessment_type,job.status,job.progress_percentage,job.error_message,job.created_at,job.updated_at,job.assessment_id
    FROM assessment_import_jobs job
    JOIN teacher_class_subject_assignments assignment
      ON assignment.school_id=job.school_id AND assignment.teacher_id=? AND assignment.class_id=job.class_id
      AND assignment.subject_id=job.subject_id AND assignment.academic_year_id=? AND assignment.term_id=job.term_id
      AND assignment.term_id=? AND assignment.role='subject_teacher' AND assignment.is_active=1
    WHERE job.school_id=? AND job.created_by=? AND job.term_id=?
    ORDER BY job.created_at DESC LIMIT 100`,[viewer.id,session.academicYearId,session.termId,schoolId,viewer.id,session.termId])
  return {imports:rows}
}

export async function getAssessmentImport(schoolId,ref){const job=await jobByRef(pool,schoolId,ref);return {import_job:{...job,id:undefined,school_id:undefined,created_by:undefined,student_pdf_file_path:undefined,marking_scheme_pdf_file_path:undefined}}}

export async function processAssessmentImport(schoolId,userId,ref){
  const job=await jobByRef(pool,schoolId,ref)
  if(!["uploaded","failed"].includes(job.status))throw new HttpError(409,"This import cannot be started from its current status")
  await pool.query("UPDATE assessment_import_jobs SET status='extracting',progress_percentage=10,error_message=NULL,image_extraction_status='processing',image_extraction_started_at=CURRENT_TIMESTAMP,image_extraction_completed_at=NULL,image_extraction_last_error=NULL,image_extraction_version=image_extraction_version+1 WHERE id=?",[job.id])
  await auditImportAsset(pool,{schoolId,jobId:job.id,userId,action:job.image_extraction_status==="failed"?"retry_started":"extraction_started"})
  const folder=path.dirname(path.resolve(process.cwd(),job.student_pdf_file_path))
  let stage="reading the uploaded PDFs"
  try{
    const [studentDoc,markingDoc]=await Promise.all([
      extractDocument(job,"student_paper",path.resolve(process.cwd(),job.student_pdf_file_path),folder),
      extractDocument(job,"marking_scheme",path.resolve(process.cwd(),job.marking_scheme_pdf_file_path),folder),
    ])
    stage="visually reading printed and handwritten content"
    await pool.query("UPDATE assessment_import_jobs SET status='parsing',progress_percentage=55 WHERE id=?",[job.id])
    const metadata={title:job.title,subject_id:job.subject_id,class_id:job.class_id,term_id:job.term_id,assessment_type:job.assessment_type}
    const [studentAi,markingAi]=await Promise.all([
      parseStudentPaper({pages:studentDoc.pages,pdfData:studentDoc.pdfData,metadata,schoolId,userId}),
      parseMarkingScheme({pages:markingDoc.pages,pdfData:markingDoc.pdfData,metadata,schoolId,userId}),
    ])
    const aiQuestions=(studentAi?.data?.sections||[]).flatMap((section)=>(section.questions||[]).map((q)=>({...q,sectionTitle:section.title})))
    const questions=reconcileQuestionNumbersWithPrintedSource(aiQuestions.length?aiQuestions:regexQuestions(studentDoc.pages),studentDoc.pages)
    const items=reconcileQuestionNumbersWithPrintedSource(markingAi?.data?.items?.length?markingAi.data.items:regexMarking(markingDoc.pages),markingDoc.pages,{textField:"answerText",pageField:"pageNumber"})
    questions.forEach((question,index)=>{question.questionNumber=exactQuestionNumber(question.questionNumber)||"?";question.tempQuestionId=clean(question.tempQuestionId||`source-${safeAssetPart(question.questionNumber)}-${index+1}`,80);question.tables=normalizeStructuredTables(question.tables);if(question.tables.length)question.assets=(question.assets||[]).filter((asset)=>!["table","table_image"].includes(String(asset?.assetType||asset?.asset_type||"").toLowerCase()))})
    const detectedDiagramAssets=await cropQuestionDiagramAssets(questions,path.resolve(process.cwd(),job.student_pdf_file_path),folder,studentDoc.pages.length,studentDoc.pages)
    const diagramAssets=preferEmbeddedDiagramAssets(detectedDiagramAssets,studentDoc.assets)
    stage="saving the extracted questions and marking scheme"
    const connection=await pool.getConnection()
    try{
      await connection.beginTransaction()
      await connection.query("DELETE FROM assessment_import_pages WHERE import_job_id=?",[job.id])
      await connection.query("DELETE FROM assessment_import_assets WHERE import_job_id=?",[job.id])
      await connection.query("DELETE FROM assessment_import_question_answer_links WHERE import_job_id=?",[job.id])
      await connection.query("DELETE FROM assessment_import_marking_items WHERE import_job_id=?",[job.id])
      await connection.query("DELETE FROM assessment_import_questions WHERE import_job_id=?",[job.id])
      for(const [type,doc] of [["student_paper",studentDoc],["marking_scheme",markingDoc]]){
        for(const page of doc.pages){
          await connection.query("INSERT INTO assessment_import_pages (public_ref,school_id,import_job_id,document_type,page_number,text_content,preview_image_path) VALUES (UUID(),?,?,?,?,?,?)",[schoolId,job.id,type,page.page_number,page.text_content,page.page_number===1?doc.coverPath:null])
        }
      }
      const linkedDiagramRefs=new Set(diagramAssets.map((asset)=>asset.public_ref))
      const assets=[...studentDoc.assets.filter((asset)=>!linkedDiagramRefs.has(asset.public_ref)),...markingDoc.assets,...diagramAssets]
      for(const asset of assets)await saveImportAsset(connection,{schoolId,jobId:job.id,userId,asset})
      const questionRows=[]
      for(let index=0;index<questions.length;index++){
        const q=questions[index]
        const formulas=(q.formulaCandidates||[]).map(normalizeFormulaText)
        const responseLayout=normalizeResponseLayout(q.responseSpace||q.response_layout||{})
        const displayNumber=exactQuestionNumber(q.questionNumber)||"?"
        const tempQuestionId=clean(q.tempQuestionId||`source-${safeAssetPart(displayNumber)}-${index+1}`,80)
        diagramAssets.filter((asset)=>asset.source_question_index===index).forEach((asset)=>{asset.linked_question_temp_id=tempQuestionId})
        const linkedAssets=assets.filter((asset)=>asset.linked_question_temp_id===tempQuestionId||asset.source_question_index===index).map((asset)=>({public_ref:asset.public_ref,asset_type:asset.asset_type,page_number:asset.page_number,alt_text:asset.alt_text,confidence:asset.confidence,bbox:asset.bbox_json}))
        const [saved]=await connection.query(`INSERT INTO assessment_import_questions (public_ref,school_id,import_job_id,temp_question_id,question_number,parent_question_number,section_title,question_text,raw_text,marks,difficulty,detected_topic_text,page_start,page_end,bbox_json,formula_json,assets_json,response_layout_json,confidence,review_status) VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')`,[schoolId,job.id,tempQuestionId,displayNumber,exactQuestionNumber(q.parentQuestionNumber)||null,clean(q.sectionTitle,180)||null,clean(q.questionText,60000),clean(q.rawText||q.questionText,60000),Number(q.marks)||null,["easy","medium","hard"].includes(q.difficulty)?q.difficulty:"medium",clean(q.detectedTopicText,180)||null,Number(q.pageStart)||null,Number(q.pageEnd)||Number(q.pageStart)||null,JSON.stringify({structured_tables:q.tables}),JSON.stringify(formulas),JSON.stringify(linkedAssets),JSON.stringify(responseLayout),Math.max(.05,Math.min(.99,Number(q.confidence)||.5))])
        questionRows.push({...q,id:saved.insertId,temp_question_id:tempQuestionId,question_number:displayNumber})
      }
      const itemRows=[]
      for(let index=0;index<items.length;index++){
        const item=items[index]
        const displayNumber=exactQuestionNumber(item.questionNumber)||"?"
        const [saved]=await connection.query(`INSERT INTO assessment_import_marking_items (public_ref,school_id,import_job_id,temp_question_id,question_number,answer_text,marking_points_json,marks,page_number,confidence) VALUES (UUID(),?,?,?,?,?,?,?,?,?)`,[schoolId,job.id,clean(item.tempQuestionId||`mark-${safeAssetPart(displayNumber)}-${index+1}`,80),displayNumber,clean(item.answerText,60000),JSON.stringify(item.markingPoints||[]),Number(item.totalMarks||item.marks)||null,Number(item.pageNumber)||null,Math.max(.05,Math.min(.99,Number(item.confidence)||.5))])
        itemRows.push({...item,id:saved.insertId,question_number:displayNumber})
      }
      const links=matchQuestionsToMarkingScheme(questionRows,itemRows)
      for(const link of links)await connection.query("INSERT INTO assessment_import_question_answer_links (public_ref,school_id,import_job_id,import_question_id,marking_item_id,match_method,confidence) VALUES (UUID(),?,?,?,?,?,?)",[schoolId,job.id,link.question.id,link.markingItem.id,link.matchMethod,link.confidence])
      const warnings=generateReviewWarnings({questions:questionRows,items:itemRows,links,assets})
      const provider=studentAi?.provider||markingAi?.provider||null,model=studentAi?.model||markingAi?.model||null
      const qualityScores=[studentAi?.qualityScore,markingAi?.qualityScore].filter((value)=>Number.isFinite(Number(value)))
      const qualityScore=qualityScores.length?Math.round(qualityScores.reduce((sum,value)=>sum+Number(value),0)/qualityScores.length):0
      const fallbackUsed=Boolean(studentAi?.fallbackUsed||markingAi?.fallbackUsed)
      const providerWarning=fallbackUsed?`The primary exam-vision provider was unavailable or returned invalid data. SmartLink completed extraction with the configured ${provider||"fallback"} provider.`:null
      const qualityWarning=qualityScore<70?`Visual extraction quality scored ${qualityScore}%. Review question references, diagrams, handwriting and response areas carefully before approval.`:null
      const imageWarnings=[...(studentDoc.imageExtraction?.warnings||[]),...(markingDoc.imageExtraction?.warnings||[]),...(detectedDiagramAssets.extractionWarnings||[])]
      const allWarnings=[...(studentAi?.data?.warnings||[]),...(markingAi?.data?.warnings||[]),providerWarning,qualityWarning,...imageWarnings,...warnings].filter(Boolean)
      const reviewImageCount=assets.filter((asset)=>asset.requires_review!==false).length
      const imagesFound=Number(studentDoc.imageExtraction?.images_found||0)+Number(markingDoc.imageExtraction?.images_found||0)+detectedDiagramAssets.length
      const imageStatus=imageWarnings.length?"completed_with_warnings":"completed"
      await connection.query("UPDATE assessment_import_jobs SET status='review_required',progress_percentage=100,cover_json=?,warnings_json=?,error_message=NULL,parser_version='smartlink-pdf-vision-v6-tables',ai_provider=?,ai_model=?,ai_prompt_version=?,ai_quality_score=?,ai_fallback_used=?,image_extraction_status=?,image_extraction_pages_processed=?,image_extraction_total_pages=?,image_extraction_images_found=?,image_extraction_images_saved=?,image_extraction_review_count=?,image_extraction_last_error=?,image_extraction_completed_at=CURRENT_TIMESTAMP,completed_at=CURRENT_TIMESTAMP WHERE id=?",[JSON.stringify(studentAi?.data?.coverPage||{title:job.title,confidence:.3,preview_path:studentDoc.coverPath}),JSON.stringify(allWarnings),provider,model,ASSESSMENT_VISION_PROMPT_VERSION,qualityScore,fallbackUsed?1:0,imageStatus,studentDoc.pages.length+markingDoc.pages.length,studentDoc.pages.length+markingDoc.pages.length,imagesFound,assets.length,reviewImageCount,imageWarnings.join(" ").slice(0,2000)||null,job.id])
      await auditImportAsset(connection,{schoolId,jobId:job.id,userId,action:"extraction_completed",after:{status:imageStatus,pages_processed:studentDoc.pages.length+markingDoc.pages.length,images_found:imagesFound,images_saved:assets.length,requires_review:reviewImageCount}})
      await connection.commit()
      let coverTemplateCandidate=null
      try{const [[actor]]=await pool.query("SELECT id,role FROM users WHERE school_id=? AND id=?",[schoolId,userId]);coverTemplateCandidate=(await extractCoverTemplateFromImport(schoolId,actor||{id:userId,role:"teacher"},ref)).template}catch(error){allWarnings.push(`The original cover was preserved, but its reusable template candidate could not be created: ${clean(error.message,300)}`)}
      return {ok:true,status:"review_required",questions:questionRows.length,marking_items:itemRows.length,warnings:allWarnings.length,vision_extraction:Boolean(studentAi?.ok||markingAi?.ok),ai_provider:provider,ai_model:model,ai_quality_score:qualityScore,ai_fallback_used:fallbackUsed,cover_template_candidate:coverTemplateCandidate}
    }catch(error){
      await connection.rollback()
      throw error
    }finally{
      connection.release()
    }
  }catch(error){
    const publicError=assessmentImportFailure(error,stage)
    await pool.query("UPDATE assessment_import_jobs SET status='failed',error_message=?,progress_percentage=0,image_extraction_last_error=IF(image_extraction_status='processing',?,image_extraction_last_error),image_extraction_completed_at=IF(image_extraction_status='processing',CURRENT_TIMESTAMP,image_extraction_completed_at),image_extraction_status=IF(image_extraction_status='processing','failed',image_extraction_status) WHERE id=?",[clean(publicError.message,2000),clean(error.message,2000),job.id]).catch(()=>{})
    await auditImportAsset(pool,{schoolId,jobId:job.id,userId,action:"extraction_failed",after:{stage,error:clean(error.message,500)}}).catch(()=>{})
    throw publicError
  }
}

export async function getAssessmentImportReview(schoolId,ref){
  const job=await jobByRef(pool,schoolId,ref)
  const [questions,items,links,pages,assets,templates,matches]=await Promise.all([
    pool.query("SELECT public_ref,temp_question_id,question_number,parent_question_number,section_title,question_text,marks,difficulty,topic_id,subtopic_id,detected_topic_text,page_start,page_end,bbox_json,formula_json,assets_json,response_layout_json,confidence,daily_drill_eligible,review_status FROM assessment_import_questions WHERE school_id=? AND import_job_id=? ORDER BY id",[schoolId,job.id]),
    pool.query("SELECT public_ref,temp_question_id,question_number,answer_text,marking_points_json,marks,page_number,confidence,review_status FROM assessment_import_marking_items WHERE school_id=? AND import_job_id=? ORDER BY id",[schoolId,job.id]),
    pool.query(`SELECT q.public_ref question_ref,m.public_ref marking_ref,l.match_method,l.confidence FROM assessment_import_question_answer_links l JOIN assessment_import_questions q ON q.id=l.import_question_id JOIN assessment_import_marking_items m ON m.id=l.marking_item_id WHERE l.school_id=? AND l.import_job_id=?`,[schoolId,job.id]),
    pool.query("SELECT public_ref,document_type,page_number,preview_image_path FROM assessment_import_pages WHERE school_id=? AND import_job_id=? ORDER BY document_type,page_number",[schoolId,job.id]),
    pool.query("SELECT public_ref,document_type,page_number,asset_type,alt_text,linked_question_temp_id,suggested_question_number,extraction_method,file_name,mime_type,width,height,aspect_ratio,placement,requires_review,assignment_status,checksum,row_version,confidence FROM assessment_import_assets WHERE school_id=? AND import_job_id=? AND removed_at IS NULL ORDER BY document_type,page_number,id",[schoolId,job.id]),
    pool.query("SELECT public_ref,template_name,template_description,source_type,template_category,confidence,review_status,appearance_count,usage_count,preview_image_path FROM assessment_cover_templates WHERE school_id=? AND source_import_job_id=? ORDER BY id DESC",[schoolId,job.id]),
    pool.query(`SELECT m.match_score,m.match_reasons_json,t.public_ref,t.template_name,t.source_type,t.template_category,t.review_status FROM assessment_template_matches m JOIN assessment_cover_templates t ON t.id=m.matched_template_id WHERE m.school_id=? AND m.import_job_id=? ORDER BY m.match_score DESC`,[schoolId,job.id]),
  ])
  const linkMap=new Map(links[0].map((link)=>[link.question_ref,link]))
  const markMap=new Map(items[0].map((item)=>[item.public_ref,{...item,marking_points_json:parseDbJson(item.marking_points_json,[])}]))
  return {
    import_job:{public_ref:job.public_ref,title:job.title,subject_id:job.subject_id,class_id:job.class_id,term_id:job.term_id,assessment_type:job.assessment_type,status:job.status,progress_percentage:job.progress_percentage,cover:parseDbJson(job.cover_json,{}),warnings:parseDbJson(job.warnings_json,[]),assessment_id:job.assessment_id,error_message:job.error_message,parser_version:job.parser_version,ai_provider:job.ai_provider,ai_model:job.ai_model,ai_prompt_version:job.ai_prompt_version,ai_quality_score:job.ai_quality_score===null?null:Number(job.ai_quality_score),ai_fallback_used:Boolean(job.ai_fallback_used),image_extraction_status:job.image_extraction_status,image_extraction_pages_processed:Number(job.image_extraction_pages_processed||0),image_extraction_total_pages:Number(job.image_extraction_total_pages||0),image_extraction_images_found:Number(job.image_extraction_images_found||0),image_extraction_images_saved:Number(job.image_extraction_images_saved||0),image_extraction_review_count:Number(job.image_extraction_review_count||0),image_extraction_last_error:job.image_extraction_last_error,image_extraction_version:Number(job.image_extraction_version||0)},
    questions:questions[0].map((question)=>({...question,bbox_json:undefined,tables:questionTablesFromStorage(question),formula_json:parseDbJson(question.formula_json,[]),assets_json:parseDbJson(question.assets_json,[]),response_layout:normalizeResponseLayout(parseDbJson(question.response_layout_json,{})),matched_link:linkMap.get(question.public_ref)||null,matched_marking_item:markMap.get(linkMap.get(question.public_ref)?.marking_ref)||null})),
    marking_items:[...markMap.values()],
    pages:pages[0].map((page)=>({...page,preview_url:page.preview_image_path?`/api/assessment-imports/${ref}/pages/${page.document_type}/${page.page_number}/preview`:null})),
    assets:assets[0].map((asset)=>({...asset,preview_url:`/api/assessment-imports/${ref}/assets/${asset.public_ref}/preview`})),
    cover_template_candidates:templates[0].map((template)=>({...template,confidence:Number(template.confidence||0),preview_url:template.preview_image_path?`/api/assessment-templates/${template.public_ref}/preview`:null})),
    template_matches:matches[0].map((match)=>({...match,match_score:Number(match.match_score||0),match_reasons:parseDbJson(match.match_reasons_json,{})})),
  }
}

export async function patchImportQuestion(schoolId,ref,questionRef,body={}){
  const job=await jobByRef(pool,schoolId,ref)
  const [[current]]=await pool.query("SELECT topic_id,subtopic_id,bbox_json FROM assessment_import_questions WHERE school_id=? AND import_job_id=? AND public_ref=? LIMIT 1",[schoolId,job.id,questionRef])
  if(!current)throw new HttpError(404,"Imported question was not found")
  const responseLayout=body.response_layout===undefined?null:JSON.stringify(normalizeResponseLayout(body.response_layout))
  const tableStorage=body.tables===undefined?null:JSON.stringify({...parseDbJson(current.bbox_json,{}),structured_tables:normalizeStructuredTables(body.tables)})
  const hasTopic=Object.prototype.hasOwnProperty.call(body,"topic_id")
  let hasSubtopic=Object.prototype.hasOwnProperty.call(body,"subtopic_id")
  const requestedTopic=hasTopic?(body.topic_id||null):current.topic_id
  let requestedSubtopic=hasSubtopic?(body.subtopic_id||null):current.subtopic_id
  if(hasTopic&&!requestedTopic&&!hasSubtopic){requestedSubtopic=null;hasSubtopic=true}
  const topicScope=(requestedTopic||requestedSubtopic)
    ?await validateSyllabusTopicScope(pool,{schoolId,subjectId:job.subject_id,topicId:requestedTopic,subtopicId:requestedSubtopic})
    :{topicId:null,subtopicId:null}
  const [result]=await pool.query(`UPDATE assessment_import_questions SET question_text=COALESCE(?,question_text),marks=COALESCE(?,marks),difficulty=COALESCE(?,difficulty),topic_id=CASE WHEN ? THEN ? ELSE topic_id END,subtopic_id=CASE WHEN ? THEN ? ELSE subtopic_id END,bbox_json=COALESCE(?,bbox_json),response_layout_json=COALESCE(?,response_layout_json),daily_drill_eligible=COALESCE(?,daily_drill_eligible),review_status=COALESCE(?,review_status) WHERE school_id=? AND import_job_id=? AND public_ref=?`,[body.question_text||null,body.marks??null,body.difficulty||null,hasTopic,topicScope.topicId,hasSubtopic,topicScope.subtopicId,tableStorage,responseLayout,body.daily_drill_eligible===undefined?null:Boolean(body.daily_drill_eligible),body.review_status||"edited",schoolId,job.id,questionRef])
  if(!result.affectedRows)throw new HttpError(404,"Imported question was not found")
  return {ok:true}
}
export async function patchImportMarkingItem(schoolId,ref,itemRef,body={}){const job=await jobByRef(pool,schoolId,ref);const [result]=await pool.query("UPDATE assessment_import_marking_items SET answer_text=COALESCE(?,answer_text),marks=COALESCE(?,marks),marking_points_json=COALESCE(?,marking_points_json),review_status=COALESCE(?,review_status) WHERE school_id=? AND import_job_id=? AND public_ref=?",[body.answer_text||null,body.marks??null,body.marking_points?JSON.stringify(body.marking_points):null,body.review_status||"edited",schoolId,job.id,itemRef]);if(!result.affectedRows)throw new HttpError(404,"Marking item was not found");return {ok:true}}
export async function linkImportAnswer(schoolId,ref,body={}){const job=await jobByRef(pool,schoolId,ref);const [[q]]=await pool.query("SELECT id FROM assessment_import_questions WHERE school_id=? AND import_job_id=? AND public_ref=?",[schoolId,job.id,body.question_ref]);const [[m]]=await pool.query("SELECT id FROM assessment_import_marking_items WHERE school_id=? AND import_job_id=? AND public_ref=?",[schoolId,job.id,body.marking_ref]);if(!q||!m)throw new HttpError(400,"Question or marking item was not found");await pool.query("DELETE FROM assessment_import_question_answer_links WHERE import_question_id=?",[q.id]);await pool.query("INSERT INTO assessment_import_question_answer_links (public_ref,school_id,import_job_id,import_question_id,marking_item_id,match_method,confidence) VALUES (UUID(),?,?,?,?,'manual',1)",[schoolId,job.id,q.id,m.id]);return {ok:true}}

async function copyImportedCoverToAssessment(connection,{schoolId,userId,job,assessmentId}){
  const [[coverPage]]=await connection.query("SELECT preview_image_path FROM assessment_import_pages WHERE school_id=? AND import_job_id=? AND document_type='student_paper' AND page_number=1 LIMIT 1",[schoolId,job.id])
  if(!coverPage?.preview_image_path)return null
  const sourcePath=path.resolve(process.cwd(),coverPage.preview_image_path)
  const uploadsRoot=path.resolve(process.cwd(),"uploads")
  if(!sourcePath.startsWith(`${uploadsRoot}${path.sep}`))return null
  const targetFolder=path.resolve(process.cwd(),"uploads","assessment-media",String(schoolId),String(assessmentId))
  const targetPath=path.join(targetFolder,"original-imported-cover.png")
  await fs.mkdir(targetFolder,{recursive:true})
  await fs.copyFile(sourcePath,targetPath)
  const file=await fs.stat(targetPath)
  const [[existing]]=await connection.query("SELECT id FROM assessment_media WHERE school_id=? AND assessment_id=? AND file_name='original-imported-cover.png' LIMIT 1",[schoolId,assessmentId])
  if(existing){await connection.query("UPDATE assessment_media SET file_size=?,storage_path=?,alt_text=? WHERE id=? AND school_id=?",[file.size,path.relative(process.cwd(),targetPath),"Original first page extracted from the imported student paper",existing.id,schoolId]);return existing.id}
  const [media]=await connection.query(`INSERT INTO assessment_media (school_id,assessment_id,uploaded_by,file_name,file_type,file_size,storage_path,alt_text) VALUES (?,?,?,?,?,?,?,?)`,[schoolId,assessmentId,userId,"original-imported-cover.png","image/png",file.size,path.relative(process.cwd(),targetPath),"Original first page extracted from the imported student paper"])
  return media.insertId
}

async function copyImportedQuestionAssetsToAssessment(connection,{schoolId,userId,job,assessmentId}){
  const [assets]=await connection.query("SELECT * FROM assessment_import_assets WHERE school_id=? AND import_job_id=? AND linked_question_temp_id IS NOT NULL AND assignment_status='confirmed' AND removed_at IS NULL AND asset_type IN ('diagram','image','graph','chart','map','table','table_image','scientific_illustration','geometric_figure','formula_image','photo','apparatus','other') ORDER BY page_number,id",[schoolId,job.id])
  const mediaByQuestion=new Map()
  const targetFolder=path.resolve(process.cwd(),"uploads","assessment-media",String(schoolId),String(assessmentId),"imported-diagrams")
  await fs.mkdir(targetFolder,{recursive:true})
  for(const asset of assets){
    const sourcePath=path.resolve(process.cwd(),asset.file_path)
    const uploadsRoot=path.resolve(process.cwd(),"uploads")
    if(!sourcePath.startsWith(`${uploadsRoot}${path.sep}`))continue
    const fileName=`diagram-${asset.public_ref}.png`
    const targetPath=path.join(targetFolder,fileName)
    try{await fs.copyFile(sourcePath,targetPath)}catch{continue}
    const stat=await fs.stat(targetPath)
    const storagePath=path.relative(process.cwd(),targetPath)
    const [[existing]]=await connection.query("SELECT id FROM assessment_media WHERE school_id=? AND assessment_id=? AND file_name=? LIMIT 1",[schoolId,assessmentId,fileName])
    let mediaId=existing?.id
    if(mediaId)await connection.query("UPDATE assessment_media SET file_size=?,storage_path=?,alt_text=? WHERE id=? AND school_id=?",[stat.size,storagePath,asset.alt_text||"Imported question diagram",mediaId,schoolId])
    else{const [media]=await connection.query("INSERT INTO assessment_media (school_id,assessment_id,uploaded_by,file_name,file_type,file_size,storage_path,alt_text) VALUES (?,?,?,?,?,?,?,?)",[schoolId,assessmentId,userId,fileName,"image/png",stat.size,storagePath,asset.alt_text||"Imported question diagram"]);mediaId=media.insertId}
    const parts=mediaByQuestion.get(asset.linked_question_temp_id)||[]
    parts.push({type:"image",media_id:mediaId,url:storagePath,caption:asset.alt_text||"",alt_text:asset.alt_text||"Imported question diagram",width:Math.min(520,Math.max(180,Math.round((parseDbJson(asset.bbox_json,{}).width||280)*1.25))),source_asset_ref:asset.public_ref,page_number:asset.page_number})
    mediaByQuestion.set(asset.linked_question_temp_id,parts)
  }
  return mediaByQuestion
}

async function installImportedAssessmentBlocks(connection,{schoolId,assessmentId,job,questions,coverMediaId,questionMediaMap=new Map()}){
  const cover=parseDbJson(job.cover_json,{})
  const paperLayout={paper_size:"A4",margins:"normal",question_spacing:"normal",section_spacing:"normal",cover_style:coverMediaId?"original_imported":"standard",original_cover_media_id:coverMediaId,source_import_ref:job.public_ref,original_cover_page_number:1,cover_extraction:cover,page_numbers:"bottom",cover_blocks:[]}
  await connection.query(`INSERT INTO assessment_blocks (school_id,assessment_id,block_type,content_json,style_json,metadata_json,sort_order,is_printable) VALUES (?,?,'cover_field',?,?,?,0,1)`,[schoolId,assessmentId,JSON.stringify({paper_layout:paperLayout}),JSON.stringify({}),JSON.stringify({system_block:"paper_layout",source:"assessment_import"})])
  for(let index=0;index<questions.length;index++){
    const question=questions[index]
    const response=normalizeResponseLayout(parseDbJson(question.response_layout_json,{}))
    const imageParts=questionMediaMap.get(question.temp_question_id)||[]
    const tableParts=structuredTableParts(questionTablesFromStorage(question))
    const contentParts=[{type:"text",text:question.question_text},...tableParts,...imageParts]
    await connection.query(`INSERT INTO assessment_blocks (school_id,assessment_id,block_type,content_json,style_json,metadata_json,sort_order,is_printable) VALUES (?,?,'question',?,?,?, ?,1)`,[schoolId,assessmentId,JSON.stringify({question_number:question.question_number,question_text:question.question_text,content_parts:contentParts,question_type:"structured",marks:Number(question.marks||1),question_instructions:"",options:[]}),JSON.stringify({spacing:"normal",z_index:0,offset_x:0,offset_y:0,answer_space_type:response.answer_space_type,answer_lines:response.answer_lines,answer_height:response.answer_height,answer_space_confidence:response.confidence,answer_space_evidence:response.evidence}),JSON.stringify({source_import_question_ref:question.public_ref,original_question_number:question.question_number,page_start:question.page_start,page_end:question.page_end,diagram_count:imageParts.length,table_count:tableParts.length}),100+index])
  }
}

export async function approveAssessmentImport(schoolId,actor,ref){
  const userId=Number(actor?.id||actor||0)
  const connection=await pool.getConnection()
  try{
    await connection.beginTransaction()
    const job=await jobByRef(connection,schoolId,ref,true)
    if(job.status!=="review_required")throw new HttpError(409,"Import must be reviewed before approval")
    const [questions]=await connection.query("SELECT * FROM assessment_import_questions WHERE school_id=? AND import_job_id=? AND review_status<>'rejected' ORDER BY id",[schoolId,job.id])
    if(!questions.length)throw new HttpError(409,"Approve at least one extracted question")
    const validatedTopicPairs=new Map()
    for(const question of questions){
      if(!question.topic_id&&!question.subtopic_id)continue
      const key=`${question.topic_id||""}:${question.subtopic_id||""}`
      if(validatedTopicPairs.has(key))continue
      const topicScope=await validateSyllabusTopicScope(connection,{schoolId,subjectId:job.subject_id,topicId:question.topic_id,subtopicId:question.subtopic_id,requireTopic:true})
      validatedTopicPairs.set(key,topicScope)
    }
    const [[term]]=await connection.query("SELECT id,academic_year_id,name FROM terms WHERE school_id=? AND id=?",[schoolId,job.term_id])
    if(!term)throw new HttpError(400,"Select a valid term")
    const [[scope]]=await connection.query(`SELECT c.id class_id,s.id subject_id,grade.id grade_id,grade.curriculum_id
      FROM classes c
      JOIN subjects s ON s.school_id=c.school_id
      LEFT JOIN grade_levels grade ON grade.school_id=c.school_id AND LOWER(TRIM(grade.name))=LOWER(TRIM(c.grade_level))
      WHERE c.school_id=? AND c.id=? AND s.id=?`,[schoolId,job.class_id,job.subject_id])
    if(!scope)throw new HttpError(400,"Select a valid class and subject")
    for(const question of questions){
      if(!question.topic_id||!question.daily_drill_eligible)continue
      const topicScope=validatedTopicPairs.get(`${question.topic_id||""}:${question.subtopic_id||""}`)
      const topicGradeId=Number(topicScope?.topic?.grade_id||0)||null
      const topicCurriculumId=Number(topicScope?.topic?.curriculum_id||0)||null
      if(scope.grade_id&&topicGradeId&&Number(scope.grade_id)!==topicGradeId)throw new HttpError(400,"A Daily Drill question topic does not belong to the assessment class year level")
      if(scope.curriculum_id&&topicCurriculumId&&Number(scope.curriculum_id)!==topicCurriculumId)throw new HttpError(400,"A Daily Drill question topic does not belong to the assessment class curriculum")
    }
    const typeMap={exam:"end_of_term_exam",test:"class_test",homework:"assignment",quiz:"quiz",other:"class_test",daily_drill_source:"class_test"}
    const total=questions.reduce((sum,question)=>sum+Number(question.marks||0),0)||questions.length
    const teacherId=await resolveImportAssessmentTeacher(connection,schoolId,userId,job,term)
    const [assessment]=await connection.query(`INSERT INTO assessments (school_id,source_import_job_id,class_id,subject_id,academic_year_id,term_id,teacher_id,name,assessment_type,term_name,total_marks,duration_minutes,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'draft',?)`,[schoolId,job.id,job.class_id,job.subject_id,term.academic_year_id,job.term_id,teacherId,job.title,typeMap[job.assessment_type]||"class_test",term.name,total,job.duration_minutes,userId])
    const questionMediaMap=await copyImportedQuestionAssetsToAssessment(connection,{schoolId,userId,job,assessmentId:assessment.insertId})
    for(let index=0;index<questions.length;index++){
      const question=questions[index]
      const [[linked]]=await connection.query(`SELECT m.answer_text,m.marking_points_json FROM assessment_import_question_answer_links l JOIN assessment_import_marking_items m ON m.id=l.marking_item_id WHERE l.import_question_id=? LIMIT 1`,[question.id])
      const correctAnswer=clean(linked?.answer_text,60000)||null
      const explanation=importedQuestionExplanation(correctAnswer,linked?.marking_points_json)
      const firstDiagram=questionMediaMap.get(question.temp_question_id)?.[0]
      await connection.query(`INSERT INTO assessment_questions (school_id,assessment_id,question_number,display_number,source_import_question_id,question_text,question_type,marks,topic_id,subtopic_id,difficulty,attachment_url,correct_answer,marking_scheme,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[schoolId,assessment.insertId,index+1,question.question_number,question.id,question.question_text,"structured",Number(question.marks||1),question.topic_id||null,question.subtopic_id||null,question.difficulty||"medium",firstDiagram?.url||null,correctAnswer,linked?.marking_points_json||correctAnswer,index])
      if(question.topic_id&&question.daily_drill_eligible){
        const topicScope=validatedTopicPairs.get(`${question.topic_id||""}:${question.subtopic_id||""}`)
        const curriculumId=Number(topicScope?.topic?.curriculum_id||0)||null
        const gradeId=Number(topicScope?.topic?.grade_id||0)||null
        const moderation=importedQuestionBankModeration({actorRole:actor?.role,correctAnswer,explanation,topicId:topicScope?.topicId,gradeId,subjectId:job.subject_id})
        const approvedBy=moderation.approvalStatus==="approved"?userId:null
        await connection.query(`INSERT INTO question_bank (
          public_ref,school_id,curriculum_id,grade_id,subject_id,topic_id,subtopic_id,question_type,question_text,
          correct_answer,explanation,difficulty,marks,confidence,source_type,source_import_job_id,is_daily_drill_eligible,
          formula_json,assets_json,approval_status,created_by,approved_by,approved_at
        ) VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?,?,?,'assessment_import',?,1,?,?,?,?,?,CASE WHEN ? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END)`,[
          schoolId,curriculumId,gradeId,job.subject_id,topicScope?.topicId,topicScope?.subtopicId||null,"structured",question.question_text,
          correctAnswer,explanation,question.difficulty||"medium",Math.max(1,Math.round(Number(question.marks||1))),question.confidence,
          job.id,question.formula_json,JSON.stringify(questionBankAssets(question)),moderation.approvalStatus,userId,approvedBy,approvedBy,
        ])
      }
    }
    const coverMediaId=await copyImportedCoverToAssessment(connection,{schoolId,userId,job,assessmentId:assessment.insertId})
    await installImportedAssessmentBlocks(connection,{schoolId,assessmentId:assessment.insertId,job,questions,coverMediaId,questionMediaMap})
    await connection.query("UPDATE assessment_import_jobs SET status='approved',assessment_id=?,completed_at=CURRENT_TIMESTAMP WHERE id=?",[assessment.insertId,job.id])
    await connection.commit()
    return {ok:true,assessment_id:assessment.insertId,builder_path:`/exam-builder/${assessment.insertId}`,original_cover_applied:Boolean(coverMediaId),response_layouts_applied:questions.length}
  }catch(error){
    await connection.rollback()
    throw error
  }finally{
    connection.release()
  }
}

export async function repairApprovedAssessmentImportLayout(schoolId,userId,ref){
  const job=await jobByRef(pool,schoolId,ref)
  if(!job.assessment_id)throw new HttpError(409,"This import has not created an assessment yet")
  const studentPath=path.resolve(process.cwd(),job.student_pdf_file_path)
  const folder=path.dirname(studentPath)
  const studentDoc=await extractDocument(job,"student_paper",studentPath,folder)
  const metadata={title:job.title,subject_id:job.subject_id,class_id:job.class_id,term_id:job.term_id,assessment_type:job.assessment_type}
  const studentAi=await parseStudentPaper({pages:studentDoc.pages,pdfData:studentDoc.pdfData,metadata,schoolId,userId})
  const extracted=reconcileQuestionNumbersWithPrintedSource((studentAi?.data?.sections||[]).flatMap((section)=>(section.questions||[]).map((question)=>({...question,sectionTitle:section.title,tables:normalizeStructuredTables(question.tables)}))),studentDoc.pages)
  if(!studentAi?.ok||!extracted.length)throw new HttpError(422,studentAi?.message||"Visual AI did not return response-space measurements for this paper")
  extracted.forEach((question)=>{if(question.tables?.length)question.assets=(question.assets||[]).filter((asset)=>!["table","table_image"].includes(String(asset?.assetType||asset?.asset_type||"").toLowerCase()))})
  const diagramAssets=preferEmbeddedDiagramAssets(await cropQuestionDiagramAssets(extracted,studentPath,folder,studentDoc.pages.length,studentDoc.pages),studentDoc.assets)
  const connection=await pool.getConnection()
  try{
    await connection.beginTransaction()
    const [storedQuestions]=await connection.query("SELECT * FROM assessment_import_questions WHERE school_id=? AND import_job_id=? AND review_status<>'rejected' ORDER BY id",[schoolId,job.id])
    const unusedExtracted=new Set(extracted)
    const sourceForStored=new Map()
    for(const stored of storedQuestions){
      const exact=[...unusedExtracted].find((source)=>referenceKey(source.questionNumber)&&referenceKey(source.questionNumber)===referenceKey(stored.question_number)&&questionTextSimilarity(source.questionText,stored.question_text)>=.2)
      const ranked=[...unusedExtracted].map((source)=>({source,score:questionTextSimilarity(source.questionText,stored.question_text)})).sort((left,right)=>right.score-left.score)
      const source=exact||ranked[0]?.source||null
      if(source){sourceForStored.set(stored,source);unusedExtracted.delete(source)}
    }
    await connection.query("DELETE FROM assessment_import_assets WHERE school_id=? AND import_job_id=? AND source_asset_key IS NOT NULL",[schoolId,job.id])
    for(const stored of storedQuestions){
      const source=sourceForStored.get(stored)||{}
      const response=normalizeResponseLayout(source.responseSpace||{})
      const displayNumber=exactQuestionNumber(source.questionNumber)||stored.question_number
      const parentNumber=exactQuestionNumber(source.parentQuestionNumber)||null
      const tableStorage={...parseDbJson(stored.bbox_json,{}),structured_tables:normalizeStructuredTables(source.tables)}
      await connection.query("UPDATE assessment_import_questions SET question_number=?,parent_question_number=?,bbox_json=?,response_layout_json=? WHERE id=? AND school_id=?",[displayNumber,parentNumber,JSON.stringify(tableStorage),JSON.stringify(response),stored.id,schoolId])
      stored.question_number=displayNumber
      stored.parent_question_number=parentNumber
      stored.response_layout_json=JSON.stringify(response)
      stored.bbox_json=JSON.stringify(tableStorage)
      stored._source_temp_id=clean(source.tempQuestionId,80)
    }
    for(const asset of diagramAssets){
      const sourceQuestion=extracted[asset.source_question_index]
      const assetReference=referenceKey(asset.linked_question_number)
      const stored=storedQuestions.find((question)=>sourceForStored.get(question)===sourceQuestion)||storedQuestions.find((question)=>question._source_temp_id&&question._source_temp_id===asset.linked_question_temp_id)||storedQuestions.find((question)=>referenceKey(question.question_number)===assetReference)||storedQuestions.find((question)=>assetReference&&referenceKey(question.question_number).startsWith(assetReference))
      if(!stored)continue
      asset.linked_question_temp_id=stored.temp_question_id
      await saveImportAsset(connection,{schoolId,jobId:job.id,userId,asset})
    }
    for(const stored of storedQuestions){
      const linked=diagramAssets.filter((asset)=>asset.linked_question_temp_id===stored.temp_question_id).map((asset)=>({public_ref:asset.public_ref,asset_type:asset.asset_type,page_number:asset.page_number,alt_text:asset.alt_text,confidence:asset.confidence,bbox:asset.bbox_json}))
      await connection.query("UPDATE assessment_import_questions SET assets_json=? WHERE id=? AND school_id=?",[JSON.stringify(linked),stored.id,schoolId])
      stored.assets_json=JSON.stringify(linked)
    }
    await connection.query("UPDATE assessment_import_pages SET preview_image_path=? WHERE school_id=? AND import_job_id=? AND document_type='student_paper' AND page_number=1",[studentDoc.coverPath,schoolId,job.id])
    await connection.query("UPDATE assessment_import_jobs SET cover_json=?,parser_version='smartlink-pdf-vision-v6-tables',ai_prompt_version=?,error_message=NULL WHERE id=?",[JSON.stringify(studentAi.data.coverPage||parseDbJson(job.cover_json,{})),ASSESSMENT_VISION_PROMPT_VERSION,job.id])
    const [[assessment]]=await connection.query("SELECT id,status FROM assessments WHERE school_id=? AND id=? FOR UPDATE",[schoolId,job.assessment_id])
    if(!assessment)throw new HttpError(404,"The assessment created by this import was not found")
    if(["locked","archived"].includes(assessment.status))throw new HttpError(409,"The assessment is locked; unlock it before refreshing imported layout")
    await connection.query("UPDATE assessments SET source_import_job_id=? WHERE id=? AND school_id=?",[job.id,assessment.id,schoolId])
    const refreshedJob={...job,cover_json:JSON.stringify(studentAi.data.coverPage||parseDbJson(job.cover_json,{}))}
    const coverMediaId=await copyImportedCoverToAssessment(connection,{schoolId,userId,job:refreshedJob,assessmentId:assessment.id})
    const questionMediaMap=await copyImportedQuestionAssetsToAssessment(connection,{schoolId,userId,job:refreshedJob,assessmentId:assessment.id})
    const [assessmentQuestions]=await connection.query("SELECT * FROM assessment_questions WHERE school_id=? AND assessment_id=? ORDER BY sort_order,question_number,id",[schoolId,assessment.id])
    for(let index=0;index<assessmentQuestions.length&&index<storedQuestions.length;index++){
      const stored=storedQuestions[index]
      const firstDiagram=questionMediaMap.get(stored.temp_question_id)?.[0]
      await connection.query("UPDATE assessment_questions SET display_number=?,source_import_question_id=?,attachment_url=COALESCE(?,attachment_url) WHERE id=? AND school_id=?",[stored.question_number,stored.id,firstDiagram?.url||null,assessmentQuestions[index].id,schoolId])
    }
    const [blocks]=await connection.query("SELECT * FROM assessment_blocks WHERE school_id=? AND assessment_id=? ORDER BY sort_order,id",[schoolId,assessment.id])
    if(!blocks.length){
      await installImportedAssessmentBlocks(connection,{schoolId,assessmentId:assessment.id,job:refreshedJob,questions:storedQuestions,coverMediaId,questionMediaMap})
    }else{
      const layoutBlock=blocks.find((block)=>parseDbJson(block.metadata_json,{}).system_block==="paper_layout")
      const previousLayout=parseDbJson(layoutBlock?.content_json,{}).paper_layout||{}
      const nextLayout={...previousLayout,paper_size:"A4",cover_style:"original_imported",original_cover_media_id:coverMediaId,source_import_ref:job.public_ref,original_cover_page_number:1,cover_extraction:studentAi.data.coverPage||{}}
      if(layoutBlock)await connection.query("UPDATE assessment_blocks SET content_json=? WHERE id=? AND school_id=?",[JSON.stringify({paper_layout:nextLayout}),layoutBlock.id,schoolId])
      else await connection.query("INSERT INTO assessment_blocks (school_id,assessment_id,block_type,content_json,style_json,metadata_json,sort_order,is_printable) VALUES (?,?,'cover_field',?,?,?,0,1)",[schoolId,assessment.id,JSON.stringify({paper_layout:nextLayout}),JSON.stringify({}),JSON.stringify({system_block:"paper_layout",source:"assessment_import"})])
      const questionBlocks=blocks.filter((block)=>block.block_type==="question")
      for(let index=0;index<questionBlocks.length&&index<storedQuestions.length;index++){
        const stored=storedQuestions[index]
        const response=normalizeResponseLayout(parseDbJson(stored.response_layout_json,{}))
        const style={...parseDbJson(questionBlocks[index].style_json,{}),answer_space_type:response.answer_space_type,answer_lines:response.answer_lines,answer_height:response.answer_height,answer_space_confidence:response.confidence,answer_space_evidence:response.evidence}
        const content=parseDbJson(questionBlocks[index].content_json,{})
        const imageParts=questionMediaMap.get(stored.temp_question_id)||[]
        const tableParts=structuredTableParts(questionTablesFromStorage(stored))
        const nextContent={...content,question_number:stored.question_number,content_parts:[{type:"text",text:content.question_text||stored.question_text},...tableParts,...imageParts]}
        const blockMetadata={...parseDbJson(questionBlocks[index].metadata_json,{}),source_import_question_ref:stored.public_ref,original_question_number:stored.question_number,diagram_count:imageParts.length,table_count:tableParts.length}
        await connection.query("UPDATE assessment_blocks SET content_json=?,style_json=?,metadata_json=? WHERE id=? AND school_id=?",[JSON.stringify(nextContent),JSON.stringify(style),JSON.stringify(blockMetadata),questionBlocks[index].id,schoolId])
      }
    }
    await connection.commit()
    return {ok:true,assessment_id:assessment.id,questions_measured:storedQuestions.length,diagrams_extracted:diagramAssets.length,original_numbering_preserved:true,original_cover_applied:Boolean(coverMediaId),vision_extraction:true}
  }catch(error){
    await connection.rollback()
    throw error
  }finally{
    connection.release()
  }
}
export async function cancelAssessmentImport(schoolId,ref){const job=await jobByRef(pool,schoolId,ref);if(job.status==="approved")throw new HttpError(409,"Approved imports cannot be cancelled");await pool.query("UPDATE assessment_import_jobs SET status='cancelled' WHERE id=?",[job.id]);return {ok:true}}
export async function getImportPreviewPath(schoolId,ref,documentType,pageNumber){const job=await jobByRef(pool,schoolId,ref);const [[page]]=await pool.query("SELECT preview_image_path FROM assessment_import_pages WHERE school_id=? AND import_job_id=? AND document_type=? AND page_number=?",[schoolId,job.id,documentType,Number(pageNumber)]);if(!page?.preview_image_path)throw new HttpError(404,"Page preview is not available");return path.resolve(process.cwd(),page.preview_image_path)}
export async function getImportAssetPath(schoolId,ref,assetRef){const job=await jobByRef(pool,schoolId,ref);const [[asset]]=await pool.query("SELECT file_path FROM assessment_import_assets WHERE school_id=? AND import_job_id=? AND public_ref=? AND removed_at IS NULL LIMIT 1",[schoolId,job.id,assetRef]);if(!asset?.file_path)throw new HttpError(404,"Image preview is not available");const resolved=path.resolve(process.cwd(),asset.file_path);const uploads=path.resolve(process.cwd(),"uploads");if(!resolved.startsWith(`${uploads}${path.sep}`))throw new HttpError(404,"Image preview is not available");return resolved}
