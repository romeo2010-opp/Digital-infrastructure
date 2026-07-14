import 'dotenv/config'
import mysql from 'mysql2/promise'

const connection = await mysql.createConnection(process.env.DATABASE_URL)
try {
  const [schools] = await connection.query('SELECT id,name FROM schools ORDER BY id')
  const [assignments] = await connection.query(`SELECT sch.name school_name,
      COUNT(DISTINCT CASE WHEN a.role='subject_teacher' AND a.subject_id IS NOT NULL AND a.is_active=1 THEN CONCAT(a.teacher_id,':',a.class_id,':',a.subject_id) END) exact_subject_assignments,
      COUNT(DISTINCT CASE WHEN a.subject_id IS NULL AND a.is_active=1 THEN a.id END) class_only_assignments
    FROM teacher_class_subject_assignments a
    JOIN users u ON u.id=a.teacher_id AND u.school_id=a.school_id
    JOIN schools sch ON sch.id=a.school_id
    WHERE u.role=? GROUP BY sch.id,sch.name ORDER BY sch.name`, ['teacher'])
  const [sheets] = await connection.query(`SELECT sch.name school_name,a.id assessment_id,a.name assessment_name,c.name class_name,s.name subject_name,
      ams.entry_mode,ams.status,ams.completion_percentage,
      (SELECT COUNT(*) FROM assessment_questions aq WHERE aq.school_id=a.school_id AND aq.assessment_id=a.id) question_count,
      (SELECT COUNT(*) FROM learner_assessment_entries lae WHERE lae.school_id=ams.school_id AND lae.mark_sheet_id=ams.id) learner_entries
    FROM academic_mark_sheets ams
    JOIN assessments a ON a.id=ams.assessment_id AND a.school_id=ams.school_id
    JOIN schools sch ON sch.id=ams.school_id
    JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id
    JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id
    ORDER BY ams.updated_at DESC LIMIT 30`)
  console.log(JSON.stringify({ schools, teacher_assignment_scope: assignments, academic_marksheets: sheets }, null, 2))
} finally {
  await connection.end()
}
