import { getScopedSchoolId } from "../utils/tenantScope.js"
import {
  attachClassroomResource,
  browseArchive,
  closeClassroomSession,
  createLibraryResource,
  createPrintRequest,
  createTeachingResource,
  createTeachingResourceRequest,
  createTeachingResourceVersion,
  getClassroomSession,
  getClassroomSetup,
  getLibrarianDashboard,
  getTeachingResource,
  issueLibraryLoan,
  listClassroomHistory,
  listLibraryLoans,
  listLibraryComputers,
  listLibraryResources,
  listPrintRequests,
  listTeachingResources,
  listTeachingResourceRequests,
  resolveTeachingResourceDownload,
  returnLibraryLoan,
  reviewTeachingResource,
  saveClassroomAttendance,
  saveClassroomSession,
  saveLibraryComputer,
  startClassroomSession,
  transitionPrintRequest,
  transitionTeachingResource,
  updateTeachingResourceRequest,
} from "../services/libraryClassroomService.js"

export async function librarianDashboard(req,res){res.json({dashboard:await getLibrarianDashboard(getScopedSchoolId(req))})}
export async function teachingResources(req,res){res.json(await listTeachingResources(getScopedSchoolId(req),req.user,req.query))}
export async function teachingResource(req,res){res.json(await getTeachingResource(getScopedSchoolId(req),String(req.params.resourceRef||''),req.user))}
export async function postTeachingResource(req,res){res.status(201).json(await createTeachingResource(getScopedSchoolId(req),req.user,req.body||{}))}
export async function postTeachingResourceVersion(req,res){res.status(201).json(await createTeachingResourceVersion(getScopedSchoolId(req),String(req.params.resourceRef||''),req.user,req.body||{}))}
export async function patchTeachingResourceStatus(req,res){res.json(await transitionTeachingResource(getScopedSchoolId(req),String(req.params.resourceRef||''),req.user,req.body||{}))}
export async function postTeachingResourceReview(req,res){res.status(201).json(await reviewTeachingResource(getScopedSchoolId(req),String(req.params.resourceRef||''),req.user,req.body||{}))}
export async function teachingResourceRequests(req,res){res.json(await listTeachingResourceRequests(getScopedSchoolId(req),req.user,req.query))}
export async function postTeachingResourceRequest(req,res){res.status(201).json({request:await createTeachingResourceRequest(getScopedSchoolId(req),req.user,req.body||{})})}
export async function patchTeachingResourceRequest(req,res){res.json({request:await updateTeachingResourceRequest(getScopedSchoolId(req),String(req.params.requestRef||''),req.user,req.body||{})})}
export async function downloadTeachingResource(req,res){const file=await resolveTeachingResourceDownload(getScopedSchoolId(req),String(req.params.resourceRef||''),req.user,req.query.version_ref||null);res.type(file.mime_type);res.download(file.path,file.filename)}
export async function physicalLibraryResources(req,res){res.json(await listLibraryResources(getScopedSchoolId(req),req.query))}
export async function postPhysicalLibraryResource(req,res){res.status(201).json({resource:await createLibraryResource(getScopedSchoolId(req),req.user,req.body||{})})}
export async function libraryLoans(req,res){res.json(await listLibraryLoans(getScopedSchoolId(req),req.query))}
export async function postLibraryLoan(req,res){res.status(201).json(await issueLibraryLoan(getScopedSchoolId(req),req.user,req.body||{}))}
export async function postLibraryReturn(req,res){res.json({loan:await returnLibraryLoan(getScopedSchoolId(req),String(req.params.loanRef||''),req.user,req.body||{})})}
export async function libraryComputers(req,res){res.json(await listLibraryComputers(getScopedSchoolId(req)))}
export async function postLibraryComputer(req,res){res.status(201).json({computer:await saveLibraryComputer(getScopedSchoolId(req),req.user,req.body||{})})}
export async function patchLibraryComputer(req,res){res.json({computer:await saveLibraryComputer(getScopedSchoolId(req),req.user,req.body||{},String(req.params.computerRef||''))})}
export async function printRequests(req,res){res.json(await listPrintRequests(getScopedSchoolId(req),req.query))}
export async function postPrintRequest(req,res){res.status(201).json({request:await createPrintRequest(getScopedSchoolId(req),req.user,req.body||{})})}
export async function patchPrintRequest(req,res){res.json({request:await transitionPrintRequest(getScopedSchoolId(req),String(req.params.requestRef||''),req.user,req.body||{})})}
export async function archiveBrowser(req,res){res.json(await browseArchive(getScopedSchoolId(req),req.user,req.query))}
export async function classroomSetup(req,res){res.json(await getClassroomSetup(getScopedSchoolId(req),req.user))}
export async function postClassroomSession(req,res){const schoolId=getScopedSchoolId(req);res.status(201).json(await startClassroomSession(schoolId,req.user,req.body||{}))}
export async function classroomSession(req,res){res.json(await getClassroomSession(getScopedSchoolId(req),String(req.params.sessionRef||''),req.user))}
export async function patchClassroomSession(req,res){res.json(await saveClassroomSession(getScopedSchoolId(req),String(req.params.sessionRef||''),req.user,req.body||{}))}
export async function classroomAttendance(req,res){res.json(await saveClassroomAttendance(getScopedSchoolId(req),String(req.params.sessionRef||''),req.user,req.body||{}))}
export async function classroomResource(req,res){res.json(await attachClassroomResource(getScopedSchoolId(req),String(req.params.sessionRef||''),req.user,req.body||{}))}
export async function completeClassroomSession(req,res){res.json(await closeClassroomSession(getScopedSchoolId(req),String(req.params.sessionRef||''),req.user,req.body||{}))}
export async function classroomHistory(req,res){res.json(await listClassroomHistory(getScopedSchoolId(req),req.user,req.query))}
