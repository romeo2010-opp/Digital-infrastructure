import { getScopedSchoolId, getTeacherClassSubjectPairs, isTeacher } from "../utils/tenantScope.js"
import {
  createIntervention,
  createParentAcademicInsight,
  createAssessmentBlueprint,
  createRemediationPack,
  getAcademicCommandCentre,
  getAcademicFindingExplanation,
  getAcademicIntelligenceHistory,
  getAcademicAuthoringSetup,
  getAcademicEngineConfig,
  getCanonicalAcademicEvidence,
  getParentPortalAcademicInsights,
  getStudentAcademicIntelligence,
  listAssessmentBlueprints,
  listRemediationPacks,
  patchRemediationPack,
  updateParentAcademicInsight,
  patchIntervention,
  queueAcademicRecalculation,
  updateCurriculumLifecycle,
  validateDependencyGraph,
} from "../services/academicIntelligenceEngine.js"
import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"
import { narrateAcademicFindings } from "../services/academicIntelligenceNarrator.js"

export async function academicCommandCentre(req,res){res.json(await getAcademicCommandCentre(getScopedSchoolId(req),req.query,req.user))}
export async function academicOverview(req,res){res.json(await getAcademicCommandCentre(getScopedSchoolId(req),req.query,req.user))}
export async function academicClasses(req,res){const data=await getAcademicCommandCentre(getScopedSchoolId(req),req.query,req.user);res.json({classes:data.coverage||[]})}
export async function academicClassDetail(req,res){
  const schoolId=getScopedSchoolId(req)
  const teacher=String(req.user?.role||'').toLowerCase()==='teacher'
  const [[row]]=await pool.query(`SELECT c.id,c.public_ref,c.name,c.grade_level FROM classes c WHERE c.school_id=? AND c.public_ref=?${teacher?" AND EXISTS (SELECT 1 FROM teacher_class_subject_assignments tcsa WHERE tcsa.school_id=c.school_id AND tcsa.class_id=c.id AND tcsa.teacher_id=? AND tcsa.subject_id IS NOT NULL AND tcsa.role='subject_teacher' AND tcsa.is_active=1)":''} LIMIT 1`,teacher?[schoolId,String(req.params.classRef||''),req.user.id]:[schoolId,String(req.params.classRef||'')])
  if(!row)throw new HttpError(404,'Academic class was not found.')
  const data=await getAcademicCommandCentre(schoolId,{...req.query,class_id:row.id},req.user)
  const [topicMatrix,learnerDistribution,upcomingAssessments]=await Promise.all([
    pool.query(`SELECT s.public_ref subject_ref,s.name subject_name,t.public_ref topic_ref,t.topic_name,
      ROUND(AVG(ltr.percentage),1) class_result,COUNT(DISTINCT ltr.student_id) learners_assessed,
      COUNT(DISTINCT CASE WHEN ltr.percentage<COALESCE(aec.mastery_threshold,70) THEN ltr.student_id END) learners_below_secure,
      ROUND(AVG(ltr.confidence_score),1) confidence,
      CASE WHEN COUNT(DISTINCT ams.id)<2 THEN 'unknown'
        WHEN AVG(CASE WHEN ams.published_at>DATE_SUB(NOW(),INTERVAL 30 DAY) THEN ltr.percentage END)>AVG(ltr.percentage) THEN 'improving'
        WHEN AVG(CASE WHEN ams.published_at>DATE_SUB(NOW(),INTERVAL 30 DAY) THEN ltr.percentage END)<AVG(ltr.percentage)-3 THEN 'declining' ELSE 'steady' END trend
      FROM learner_topic_results ltr
      JOIN academic_mark_sheets ams ON ams.id=ltr.mark_sheet_id AND ams.school_id=ltr.school_id AND ams.status IN ('published','locked')
      JOIN subjects s ON s.id=ams.subject_id AND s.school_id=ams.school_id
      JOIN syllabus_topics t ON t.id=ltr.topic_id AND t.school_id=ltr.school_id
      LEFT JOIN academic_engine_config aec ON aec.school_id=ltr.school_id
      WHERE ltr.school_id=? AND ams.class_id=? AND ltr.is_official=1${teacher?" AND EXISTS (SELECT 1 FROM teacher_class_subject_assignments tcsa WHERE tcsa.school_id=ams.school_id AND tcsa.teacher_id=? AND tcsa.class_id=ams.class_id AND tcsa.subject_id=ams.subject_id AND tcsa.role='subject_teacher' AND tcsa.is_active=1)":''}
      GROUP BY s.id,s.public_ref,s.name,t.id,t.public_ref,t.topic_name,aec.mastery_threshold
      ORDER BY learners_below_secure DESC,class_result,t.topic_name LIMIT 150`,teacher?[schoolId,row.id,req.user.id]:[schoolId,row.id]),
    pool.query(`SELECT amr.mastery_status,COUNT(DISTINCT amr.student_id) learner_count
      FROM academic_mastery_records amr JOIN student_enrollments se ON se.school_id=amr.school_id AND se.student_id=amr.student_id AND se.class_id=? AND se.enrollment_status='active'
      WHERE amr.school_id=? AND amr.mastery_level='subject'${teacher?" AND EXISTS (SELECT 1 FROM teacher_class_subject_assignments tcsa WHERE tcsa.school_id=amr.school_id AND tcsa.teacher_id=? AND tcsa.class_id=se.class_id AND tcsa.subject_id=amr.subject_id AND tcsa.role='subject_teacher' AND tcsa.is_active=1)":''} GROUP BY amr.mastery_status`,teacher?[row.id,schoolId,req.user.id]:[row.id,schoolId]),
    pool.query(`SELECT a.id,a.name,a.assessment_type,a.status,a.total_marks,s.public_ref subject_ref,s.name subject_name,ete.exam_date
      FROM assessments a JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id
      LEFT JOIN exam_timetable_entries ete ON ete.assessment_id=a.id AND ete.school_id=a.school_id
      WHERE a.school_id=? AND a.class_id=? AND a.status IN ('open','approved','scheduled')
        AND (ete.exam_date IS NULL OR ete.exam_date>=CURDATE())${teacher?" AND EXISTS (SELECT 1 FROM teacher_class_subject_assignments tcsa WHERE tcsa.school_id=a.school_id AND tcsa.teacher_id=? AND tcsa.class_id=a.class_id AND tcsa.subject_id=a.subject_id AND tcsa.role='subject_teacher' AND tcsa.is_active=1)":''} ORDER BY COALESCE(ete.exam_date,'9999-12-31'),a.updated_at DESC LIMIT 20`,teacher?[schoolId,row.id,req.user.id]:[schoolId,row.id]),
  ])
  res.json({
    class:{public_ref:row.public_ref,name:row.name,grade_level:row.grade_level},
    overall_state:data.alerts?.some((item)=>['urgent','high'].includes(item.severity))?'action_required':data.alerts?.length?'watch':'stable',
    readiness:data.readiness||[],coverage:data.coverage||[],topic_matrix:topicMatrix[0],learner_distribution:learnerDistribution[0],
    risks:data.alerts||[],recommendations:data.recommendations||[],interventions:data.interventions||[],recent_changes:data.meaningful_changes||[],upcoming_assessments:upcomingAssessments[0],
  })
}
export async function academicSubjects(req,res){const data=await getAcademicCommandCentre(getScopedSchoolId(req),req.query,req.user);const subjects=new Map();for(const row of data.coverage||[]){const current=subjects.get(row.subject_name)||{subject_name:row.subject_name,coverage:[],class_count:0};current.coverage.push(row);current.class_count+=1;subjects.set(row.subject_name,current)}res.json({subjects:[...subjects.values()]})}
export async function academicSubjectDetail(req,res){const data=await getAcademicCommandCentre(getScopedSchoolId(req),req.query,req.user);const subject=String(req.params.subjectRef||'');res.json({subject_ref:subject,coverage:(data.coverage||[]).filter((row)=>row.subject_ref===subject||row.subject_name===subject),risks:data.alerts||[],recommendations:data.recommendations||[]})}
export async function academicTopicDetail(req,res){
  const schoolId=getScopedSchoolId(req)
  const topicRef=String(req.params.topicRef||'')
  const teacher=isTeacher(req)
  const [[topic]]=await pool.query(`SELECT st.public_ref,st.topic_name,st.description,st.order_number,s.public_ref subject_ref,s.name subject_name FROM syllabus_topics st JOIN subjects s ON s.id=st.subject_id AND s.school_id=st.school_id WHERE st.school_id=? AND st.public_ref=?${teacher?" AND EXISTS (SELECT 1 FROM teacher_class_subject_assignments tcsa WHERE tcsa.school_id=st.school_id AND tcsa.teacher_id=? AND tcsa.subject_id=st.subject_id AND tcsa.role='subject_teacher' AND tcsa.is_active=1)":''} LIMIT 1`,teacher?[schoolId,topicRef,req.user.id]:[schoolId,topicRef])
  if(!topic)throw new HttpError(404,'Academic topic was not found.')
  const [evidence,data]=await Promise.all([
    getCanonicalAcademicEvidence(schoolId,{...req.query,topic_ref:topicRef,limit:req.query.limit||100},req.user),
    getAcademicCommandCentre(schoolId,req.query,req.user),
  ])
  const [prerequisites,delivery]=await Promise.all([
    pool.query(`SELECT pt.public_ref prerequisite_ref,pt.topic_name prerequisite_name,p.strength FROM syllabus_topic_prerequisites p JOIN syllabus_topics pt ON pt.id=p.prerequisite_topic_id AND pt.school_id=p.school_id JOIN syllabus_topics t ON t.id=p.topic_id AND t.school_id=p.school_id WHERE p.school_id=? AND t.public_ref=?`,[schoolId,topicRef]),
    pool.query(`SELECT c.public_ref class_ref,c.name class_name,s.public_ref subject_ref,s.name subject_name,SHA2(CONCAT('term:',cdr.school_id,':',cdr.term_id),256) term_ref,cdr.lifecycle_status,cdr.assessed_status,cdr.class_mastery_score,cdr.mastery_confidence_score,cdr.students_assessed,cdr.students_below_threshold,cdr.revision_required,cdr.last_recalculated_at FROM curriculum_delivery_records cdr JOIN classes c ON c.id=cdr.class_id AND c.school_id=cdr.school_id JOIN subjects s ON s.id=cdr.subject_id AND s.school_id=cdr.school_id JOIN syllabus_topics st ON st.id=cdr.topic_id AND st.school_id=cdr.school_id WHERE cdr.school_id=? AND st.public_ref=?${teacher?" AND EXISTS (SELECT 1 FROM teacher_class_subject_assignments tcsa WHERE tcsa.school_id=cdr.school_id AND tcsa.teacher_id=? AND tcsa.class_id=cdr.class_id AND tcsa.subject_id=cdr.subject_id AND tcsa.role='subject_teacher' AND tcsa.is_active=1)":''} ORDER BY c.name,s.name,cdr.term_id DESC`,teacher?[schoolId,topicRef,req.user.id]:[schoolId,topicRef]),
  ])
  res.json({topic, evidence:evidence.evidence, evidence_quality:evidence.evidence_quality, prerequisites:prerequisites[0], delivery:delivery[0], coverage:data.coverage||[], risks:data.alerts||[], recommendations:data.recommendations||[], evidence_state:evidence.evidence_quality.state, message:evidence.evidence_quality.limitations?.[0]||null})
}
export async function academicEvidence(req,res){res.json(await getCanonicalAcademicEvidence(getScopedSchoolId(req),req.query,req.user))}
export async function academicRisks(req,res){const data=await getAcademicCommandCentre(getScopedSchoolId(req),req.query,req.user);res.json({risks:data.alerts||[]})}
export async function academicInsights(req,res){const data=await getAcademicCommandCentre(getScopedSchoolId(req),req.query,req.user);res.json({insights:[...(data.recommendations||[]),...(data.alerts||[])].slice(0,100)})}
export async function academicPositiveSignals(req,res){const data=await getAcademicCommandCentre(getScopedSchoolId(req),req.query,req.user);res.json({positive_signals:data.positive_signals||[]})}
export async function academicMeaningfulChanges(req,res){const data=await getAcademicCommandCentre(getScopedSchoolId(req),req.query,req.user);res.json({meaningful_changes:data.meaningful_changes||[]})}
export async function academicEvidenceGaps(req,res){
  const schoolId=getScopedSchoolId(req)
  const teacherPairs=await getTeacherClassSubjectPairs(req,schoolId)
  const [totalsOnly,unmapped,taughtNotAssessed,staleEvidence,missingMarks,incompleteInterventions]=await Promise.all([
    pool.query(`SELECT a.id entity_ref,a.name assessment_name,c.public_ref class_ref,c.name class_name,s.public_ref subject_ref,s.name subject_name,MAX(rb.updated_at) last_activity
      FROM result_batches rb JOIN assessments a ON a.id=rb.assessment_id AND a.school_id=rb.school_id
      JOIN classes c ON c.id=rb.class_id AND c.school_id=rb.school_id JOIN subjects s ON s.id=rb.subject_id AND s.school_id=rb.school_id
      LEFT JOIN academic_mark_sheets ams ON ams.school_id=rb.school_id AND ams.assessment_id=rb.assessment_id AND ams.status IN ('published','locked') AND ams.evidence_level IN ('question','section','topic')
      WHERE rb.school_id=? AND rb.status IN ('submitted','approved','locked') AND ams.id IS NULL
      GROUP BY a.id,a.name,c.public_ref,c.name,s.public_ref,s.name ORDER BY last_activity DESC LIMIT 40`,[schoolId]),
    pool.query(`SELECT a.id entity_ref,a.name assessment_name,c.public_ref class_ref,c.name class_name,s.public_ref subject_ref,s.name subject_name,
        COUNT(DISTINCT aq.id) question_count,SUM(CASE WHEN qtm.id IS NULL THEN 1 ELSE 0 END) unmapped_count,MAX(a.updated_at) last_activity
      FROM assessments a JOIN assessment_questions aq ON aq.assessment_id=a.id AND aq.school_id=a.school_id
      JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id
      LEFT JOIN question_topic_mappings qtm ON qtm.assessment_question_id=aq.id AND qtm.school_id=aq.school_id
      WHERE a.school_id=? GROUP BY a.id,a.name,c.public_ref,c.name,s.public_ref,s.name
      HAVING unmapped_count>0 ORDER BY unmapped_count DESC,last_activity DESC LIMIT 40`,[schoolId]),
    pool.query(`SELECT cdr.public_ref entity_ref,c.public_ref class_ref,c.name class_name,s.public_ref subject_ref,s.name subject_name,st.public_ref topic_ref,st.topic_name,cdr.actual_completion_date last_activity
      FROM curriculum_delivery_records cdr JOIN classes c ON c.id=cdr.class_id AND c.school_id=cdr.school_id
      JOIN subjects s ON s.id=cdr.subject_id AND s.school_id=cdr.school_id JOIN syllabus_topics st ON st.id=cdr.topic_id AND st.school_id=cdr.school_id
      WHERE cdr.school_id=? AND cdr.lifecycle_status IN ('TAUGHT','IN_PROGRESS') AND cdr.assessed_status=0
      ORDER BY cdr.actual_completion_date,c.name,s.name,st.topic_name LIMIT 60`,[schoolId]),
    pool.query(`SELECT c.public_ref entity_ref,c.public_ref class_ref,c.name class_name,s.public_ref subject_ref,s.name subject_name,MAX(ams.published_at) last_activity
      FROM curriculum_delivery_records cdr JOIN classes c ON c.id=cdr.class_id AND c.school_id=cdr.school_id
      JOIN subjects s ON s.id=cdr.subject_id AND s.school_id=cdr.school_id
      LEFT JOIN academic_mark_sheets ams ON ams.school_id=cdr.school_id AND ams.class_id=cdr.class_id AND ams.subject_id=cdr.subject_id AND ams.status IN ('published','locked')
      WHERE cdr.school_id=? GROUP BY c.id,c.public_ref,c.name,s.id,s.public_ref,s.name
      HAVING last_activity IS NULL OR last_activity<DATE_SUB(NOW(),INTERVAL 45 DAY) ORDER BY last_activity LIMIT 40`,[schoolId]),
    pool.query(`SELECT ams.public_ref entity_ref,a.name assessment_name,c.public_ref class_ref,c.name class_name,s.public_ref subject_ref,s.name subject_name,ams.completion_percentage,ams.updated_at last_activity,
        SUM(lae.participation_status IN ('pending','incomplete')) missing_count
      FROM academic_mark_sheets ams JOIN assessments a ON a.id=ams.assessment_id AND a.school_id=ams.school_id
      JOIN classes c ON c.id=ams.class_id AND c.school_id=ams.school_id JOIN subjects s ON s.id=ams.subject_id AND s.school_id=ams.school_id
      LEFT JOIN learner_assessment_entries lae ON lae.mark_sheet_id=ams.id AND lae.school_id=ams.school_id
      WHERE ams.school_id=? AND ams.status IN ('draft','submitted')
      GROUP BY ams.id,ams.public_ref,a.name,c.public_ref,c.name,s.public_ref,s.name,ams.completion_percentage,ams.updated_at
      HAVING missing_count>0 OR ams.completion_percentage<100 ORDER BY ams.updated_at LIMIT 40`,[schoolId]),
    pool.query(`SELECT ai.public_ref entity_ref,c.public_ref class_ref,c.name class_name,s.public_ref subject_ref,s.name subject_name,st.public_ref topic_ref,st.topic_name,ai.issue,ai.review_date last_activity,ai.status,
        CASE WHEN ai.review_date<CURDATE() THEN 'overdue' ELSE 'reassessment_missing' END gap_state
      FROM academic_interventions ai LEFT JOIN classes c ON c.id=ai.class_id AND c.school_id=ai.school_id
      JOIN subjects s ON s.id=ai.subject_id AND s.school_id=ai.school_id LEFT JOIN syllabus_topics st ON st.id=ai.topic_id AND st.school_id=ai.school_id
      LEFT JOIN academic_intervention_reassessments air ON air.intervention_id=ai.id AND air.school_id=ai.school_id
      WHERE ai.school_id=? AND ai.status IN ('active','review_due') AND (ai.review_date<CURDATE() OR air.id IS NULL)
      ORDER BY ai.review_date LIMIT 40`,[schoolId]),
  ])
  let allowedPairs=null
  if(Array.isArray(teacherPairs)){
    const [refs]=teacherPairs.length?await pool.query(`SELECT c.public_ref class_ref,s.public_ref subject_ref FROM classes c JOIN subjects s ON s.school_id=c.school_id WHERE c.school_id=? AND (${teacherPairs.map(()=>'(c.id=? AND s.id=?)').join(' OR ')})`,[schoolId,...teacherPairs.flatMap((pair)=>[pair.classId,pair.subjectId])]):[[]]
    allowedPairs=new Set(refs.map((row)=>`${row.class_ref}:${row.subject_ref}`))
  }
  const scoped=(rows)=>allowedPairs===null?rows:rows.filter((row)=>allowedPairs.has(`${row.class_ref}:${row.subject_ref}`))
  const evidenceGaps=[
    ...scoped(totalsOnly[0]).map((row)=>({...row,gap_type:'assessment_totals_only',action:'map or diagnose',confidence:'aggregate only',reason:'Published totals support aggregate performance only. Topic diagnosis is unavailable until mapped question or topic evidence is recorded.'})),
    ...scoped(unmapped[0]).map((row)=>({...row,gap_type:'questions_without_topic_mappings',action:'map questions',confidence:'limited',reason:`${Number(row.unmapped_count)} of ${Number(row.question_count)} questions have no valid topic allocation, so their marks cannot support precise topic findings.`})),
    ...scoped(taughtNotAssessed[0]).map((row)=>({...row,gap_type:'taught_not_assessed',action:'create diagnostic',confidence:'unknown',reason:'Teaching is recorded, but no assessment evidence yet confirms learner understanding.'})),
    ...scoped(staleEvidence[0]).map((row)=>({...row,gap_type:'no_recent_evidence',action:'schedule evidence',confidence:'stale',reason:row.last_activity?'No mapped marks have been published in the last 45 days.':'No published mapped assessment evidence is available for this class and subject.'})),
    ...scoped(missingMarks[0]).map((row)=>({...row,gap_type:'missing_marks',action:'finish marking',confidence:'provisional',reason:`The mark sheet is ${Number(row.completion_percentage||0).toFixed(0)}% complete and remains excluded from official mastery.`})),
    ...scoped(incompleteInterventions[0]).map((row)=>({...row,gap_type:'incomplete_intervention',action:row.gap_state==='overdue'?'escalate':'schedule reassessment',confidence:'pending outcome',reason:row.gap_state==='overdue'?'The intervention review date has passed without a measured outcome.':'The active intervention has no linked reassessment plan.'})),
  ]
  res.json({evidence_gaps:evidenceGaps.slice(0,120),counts:evidenceGaps.reduce((result,row)=>({...result,[row.gap_type]:(result[row.gap_type]||0)+1}),{})})
}
export async function academicReadiness(req,res){const data=await getAcademicCommandCentre(getScopedSchoolId(req),req.query,req.user);res.json({readiness:data.readiness||[]})}
export async function academicHistory(req,res){res.json(isTeacher(req)?{history:[]}:await getAcademicIntelligenceHistory(getScopedSchoolId(req),req.query))}
export async function academicExplanation(req,res){res.json(await getAcademicFindingExplanation(getScopedSchoolId(req),String(req.params.findingId||''),req.user))}
export async function academicRecalculate(req,res){res.status(202).json(await queueAcademicRecalculation(getScopedSchoolId(req),req.user,req.body||{}))}
export async function academicAiExplain(req,res){
  const schoolId=getScopedSchoolId(req)
  const body=req.body||{}
  if(!Array.isArray(body.validatedFindings)&&!Array.isArray(body.findings))throw new HttpError(400,"Validated academic findings are required for AI interpretation.")
  const result=await narrateAcademicFindings({...body,schoolId,userId:req.user?.id||null,role:req.user?.role||body.role||'headteacher'})
  res.json(result)
}
export async function academicAuthoringSetup(req,res){res.json(await getAcademicAuthoringSetup(getScopedSchoolId(req),req.user))}
export async function studentAcademicIntelligence(req,res){res.json(await getStudentAcademicIntelligence(getScopedSchoolId(req),String(req.params.studentRef||''),req.user))}
export async function patchCurriculumLifecycle(req,res){res.json({record:await updateCurriculumLifecycle(getScopedSchoolId(req),String(req.params.recordRef||''),req.user,req.body||{})})}
export async function postIntervention(req,res){res.status(201).json({intervention:await createIntervention(getScopedSchoolId(req),req.user,req.body||{})})}
export async function postParentAcademicInsight(req,res){res.status(201).json({insight:await createParentAcademicInsight(getScopedSchoolId(req),req.user,req.body||{})})}
export async function patchParentAcademicInsight(req,res){res.json({insight:await updateParentAcademicInsight(getScopedSchoolId(req),String(req.params.insightRef||''),req.user,req.body||{})})}
export async function parentPortalAcademicInsights(req,res){res.json(await getParentPortalAcademicInsights(getScopedSchoolId(req),req.user,req.query||{}))}
export async function updateIntervention(req,res){res.json({intervention:await patchIntervention(getScopedSchoolId(req),String(req.params.interventionRef||''),req.user,req.body||{})})}
export async function assessmentBlueprints(req,res){res.json(await listAssessmentBlueprints(getScopedSchoolId(req),req.query))}
export async function postAssessmentBlueprint(req,res){res.status(201).json({blueprint:await createAssessmentBlueprint(getScopedSchoolId(req),req.user,req.body||{})})}
export async function remediationPacks(req,res){res.json(await listRemediationPacks(getScopedSchoolId(req),req.query))}
export async function postRemediationPack(req,res){res.status(201).json({remediation_pack:await createRemediationPack(getScopedSchoolId(req),req.user,req.body||{})})}
export async function updateRemediationPack(req,res){res.json({remediation_pack:await patchRemediationPack(getScopedSchoolId(req),String(req.params.packRef||''),req.user,req.body||{})})}

export async function academicEngineConfiguration(req,res){
  const schoolId=getScopedSchoolId(req)
  const config=await getAcademicEngineConfig(schoolId)
  res.json({config})
}

export async function updateAcademicEngineConfiguration(req,res){
  const schoolId=getScopedSchoolId(req)
  const fields=['mastery_threshold','intervention_threshold','exam_readiness_threshold','curriculum_delay_tolerance_days','minimum_evidence_count','recency_half_life_days','formative_weight','summative_weight','examination_weight','drill_weight','teacher_evidence_weight']
  const values=[];const sets=[]
  for(const field of fields){if(req.body[field]===undefined)continue;const value=Number(req.body[field]);if(!Number.isFinite(value)||value<0)throw new HttpError(400,`${field.replaceAll('_',' ')} must be a non-negative number.`);sets.push(`${field}=?`);values.push(value)}
  for(const field of ['parent_visibility_json','terminology_json','alert_rules_json']){if(req.body[field]===undefined)continue;sets.push(`${field}=?`);values.push(JSON.stringify(req.body[field]))}
  if(sets.length)await pool.query(`UPDATE academic_engine_config SET ${sets.join(',')},updated_by=? WHERE school_id=?`,[...values,req.user.id,schoolId])
  const config=await getAcademicEngineConfig(schoolId)
  res.json({config})
}

export async function curriculumDependencyGraph(req,res){
  const schoolId=getScopedSchoolId(req)
  const [topicEdges,objectiveEdges]=await Promise.all([
    // syllabus_topic_prerequisites predates public references and therefore has
    // no public_ref column. Return a deterministic opaque reference instead of
    // selecting the missing column (which used to make this endpoint fail with
    // ER_BAD_FIELD_ERROR on otherwise healthy databases).
    pool.query(`SELECT SHA2(CONCAT('topic-prerequisite:',p.school_id,':',p.id),256) public_ref,p.topic_id,p.prerequisite_topic_id,p.strength,t.public_ref topic_ref,t.topic_name,pt.public_ref prerequisite_ref,pt.topic_name prerequisite_name FROM syllabus_topic_prerequisites p JOIN syllabus_topics t ON t.id=p.topic_id AND t.school_id=p.school_id JOIN syllabus_topics pt ON pt.id=p.prerequisite_topic_id AND pt.school_id=p.school_id WHERE p.school_id=?`,[schoolId]),
    pool.query(`SELECT p.public_ref,p.learning_objective_id,p.prerequisite_objective_id,p.strength,o.public_ref objective_ref,o.objective_text,po.public_ref prerequisite_ref,po.objective_text prerequisite_text FROM learning_objective_prerequisites p JOIN learning_objectives o ON o.id=p.learning_objective_id AND o.school_id=p.school_id JOIN learning_objectives po ON po.id=p.prerequisite_objective_id AND po.school_id=p.school_id WHERE p.school_id=?`,[schoolId]),
  ])
  const validation=validateDependencyGraph([
    ...topicEdges[0].map((row)=>({from:`topic:${row.topic_id}`,to:`topic:${row.prerequisite_topic_id}`})),
    ...objectiveEdges[0].map((row)=>({from:`objective:${row.learning_objective_id}`,to:`objective:${row.prerequisite_objective_id}`})),
  ])
  res.json({topic_dependencies:topicEdges[0].map(({topic_id,prerequisite_topic_id,...row})=>row),objective_dependencies:objectiveEdges[0].map(({learning_objective_id,prerequisite_objective_id,...row})=>row),validation})
}
