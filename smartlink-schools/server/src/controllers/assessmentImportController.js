import { getScopedSchoolId } from "../utils/tenantScope.js"
import { pool } from "../config/db.js"
import { approveAssessmentImport,cancelAssessmentImport,createAssessmentImport,getAssessmentImport,getAssessmentImportReview,getImportAssetPath,getImportPreviewPath,linkImportAnswer,listAssessmentImports,patchImportMarkingItem,patchImportQuestion,processAssessmentImport } from "../services/assessmentImportService.js"
import { extractImportImages, listImportImages, patchImportImage, removeImportImage } from "../services/assessmentImportImageService.js"
const school=(req)=>getScopedSchoolId(req)
async function assertAccess(req){if(String(req.user.role)!=="teacher")return;const [[row]]=await pool.query("SELECT id FROM assessment_import_jobs WHERE school_id=? AND public_ref=? AND created_by=?",[school(req),req.params.importRef,req.user.id]);if(!row){const error=new Error("Assessment import was not found in your assigned scope");error.status=404;throw error}}
export async function createImport(req,res){res.status(201).json(await createAssessmentImport(school(req),req.user.id,req.body))}
export async function listImports(req,res){res.json(await listAssessmentImports(school(req),req.user))}
export async function getImport(req,res){await assertAccess(req);res.json(await getAssessmentImport(school(req),req.params.importRef))}
export async function startImport(req,res){await assertAccess(req);const payload=await processAssessmentImport(school(req),req.user.id,req.params.importRef);res.json(payload)}
export async function reviewImport(req,res){await assertAccess(req);res.json(await getAssessmentImportReview(school(req),req.params.importRef))}
export async function updateImportQuestion(req,res){await assertAccess(req);res.json(await patchImportQuestion(school(req),req.params.importRef,req.params.questionRef,req.body))}
export async function updateImportMarking(req,res){await assertAccess(req);res.json(await patchImportMarkingItem(school(req),req.params.importRef,req.params.markingRef,req.body))}
export async function linkAnswer(req,res){await assertAccess(req);res.json(await linkImportAnswer(school(req),req.params.importRef,req.body))}
export async function approveImport(req,res){await assertAccess(req);res.json(await approveAssessmentImport(school(req),req.user.id,req.params.importRef))}
export async function cancelImport(req,res){await assertAccess(req);res.json(await cancelAssessmentImport(school(req),req.params.importRef))}
export async function pagePreview(req,res){await assertAccess(req);res.sendFile(await getImportPreviewPath(school(req),req.params.importRef,req.params.documentType,req.params.pageNumber))}
export async function assetPreview(req,res){await assertAccess(req);res.sendFile(await getImportAssetPath(school(req),req.params.importRef,req.params.assetRef))}
export async function extractImages(req,res){await assertAccess(req);res.json(await extractImportImages(school(req),req.user.id,req.params.importRef))}
export async function listImages(req,res){await assertAccess(req);res.json(await listImportImages(school(req),req.params.importRef))}
export async function updateImage(req,res){await assertAccess(req);res.json(await patchImportImage(school(req),req.user.id,req.params.importRef,req.params.assetRef,req.body))}
export async function deleteImage(req,res){await assertAccess(req);res.json(await removeImportImage(school(req),req.user.id,req.params.importRef,req.params.assetRef))}
