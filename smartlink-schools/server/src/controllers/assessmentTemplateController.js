import { getScopedSchoolId } from "../utils/tenantScope.js"
import {
  applyAssessmentTemplate,
  approveAssessmentTemplate,
  archiveAssessmentTemplate,
  createAssessmentTemplate,
  duplicateAssessmentTemplate,
  extractCoverTemplateFromImport,
  getAssessmentTemplate,
  getAssessmentTemplatePreviewPath,
  getAssessmentTemplateSettings,
  listAssessmentTemplates,
  matchCoverTemplateFromImport,
  setDefaultAssessmentTemplate,
  updateAssessmentTemplate,
  updateAssessmentTemplateSettings,
} from "../services/assessmentTemplateService.js"

const school=(req)=>getScopedSchoolId(req)
export async function listTemplates(req,res){res.json(await listAssessmentTemplates(school(req),req.query))}
export async function getTemplate(req,res){res.json(await getAssessmentTemplate(school(req),req.params.templateRef))}
export async function createTemplate(req,res){res.status(201).json(await createAssessmentTemplate(school(req),req.user,req.body))}
export async function updateTemplate(req,res){res.json(await updateAssessmentTemplate(school(req),req.user,req.params.templateRef,req.body))}
export async function deleteTemplate(req,res){res.json(await archiveAssessmentTemplate(school(req),req.user,req.params.templateRef))}
export async function approveTemplate(req,res){res.json(await approveAssessmentTemplate(school(req),req.user,req.params.templateRef))}
export async function archiveTemplate(req,res){res.json(await archiveAssessmentTemplate(school(req),req.user,req.params.templateRef))}
export async function duplicateTemplate(req,res){res.status(201).json(await duplicateAssessmentTemplate(school(req),req.user,req.params.templateRef,req.body))}
export async function applyTemplate(req,res){res.json(await applyAssessmentTemplate(school(req),req.user,req.params.templateRef,req.body.assessment_id||req.body.assessmentId))}
export async function setDefaultTemplate(req,res){res.json(await setDefaultAssessmentTemplate(school(req),req.user,req.params.templateRef,req.body.category))}
export async function extractImportCoverTemplate(req,res){res.status(201).json(await extractCoverTemplateFromImport(school(req),req.user,req.params.importRef))}
export async function importTemplateCandidates(req,res){res.json(await matchCoverTemplateFromImport(school(req),req.user,req.params.importRef))}
export async function matchImportCoverTemplate(req,res){res.json(await matchCoverTemplateFromImport(school(req),req.user,req.params.importRef))}
export async function applyImportTemplateMatch(req,res){res.json(await applyAssessmentTemplate(school(req),req.user,req.body.template_ref||req.body.templateRef,req.body.assessment_id||req.body.assessmentId))}
export async function getTemplateSettings(req,res){res.json(await getAssessmentTemplateSettings(school(req)))}
export async function patchTemplateSettings(req,res){res.json(await updateAssessmentTemplateSettings(school(req),req.user,req.body))}
export async function templatePreview(req,res){res.sendFile(await getAssessmentTemplatePreviewPath(school(req),req.params.templateRef))}

