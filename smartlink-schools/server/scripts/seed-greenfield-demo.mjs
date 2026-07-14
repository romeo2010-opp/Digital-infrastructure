import mysql from "mysql2/promise"
import bcrypt from "bcryptjs"
import { randomUUID } from "node:crypto"
import dotenv from "dotenv"

dotenv.config()

const DEMO_CODE = "GFA"
const DEMO_IDENTIFIER = "demo-greenfield-academy-2026"
const DEMO_PASSWORD = "Greenfield#2026"
const args = new Set(process.argv.slice(2))

if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEMO_DATA_TOOLS !== "true") {
  throw new Error("Greenfield demo tools are disabled in production. Set ENABLE_DEMO_DATA_TOOLS=true only in an isolated demo environment.")
}

const databaseUrl = process.env.DATABASE_URL || "mysql://root:@127.0.0.1:3306/smartlink_schools"
const connection = await mysql.createConnection({ uri: databaseUrl, dateStrings: ["DATE"] })

const q = async (sql, params = []) => {
  const [rows] = await connection.query(sql, params)
  return rows
}

const insertMany = async (table, columns, rows, chunkSize = 500) => {
  if (!rows.length) return
  const quotedColumns = columns.map((column) => `\`${column}\``).join(",")
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize)
    const placeholders = chunk.map(() => `(${columns.map(() => "?").join(",")})`).join(",")
    await q(`INSERT INTO \`${table}\` (${quotedColumns}) VALUES ${placeholders}`, chunk.flat())
  }
}

const iso = (date) => date.toISOString().slice(0, 10)
const addDays = (value, days) => {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return iso(date)
}
const weekdays = (start, end, holidays = new Set()) => {
  const days = []
  for (let date = new Date(`${start}T00:00:00Z`); iso(date) <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const key = iso(date)
    if (date.getUTCDay() > 0 && date.getUTCDay() < 6 && !holidays.has(key)) days.push(key)
  }
  return days
}
const gradeFor = (score) => {
  if (score === null || score === undefined) return null
  if (score >= 80) return "A"
  if (score >= 70) return "B"
  if (score >= 60) return "C"
  if (score >= 50) return "D"
  if (score >= 40) return "E"
  return "F"
}
const stableScore = (seed, min, max) => min + (Math.abs(seed * 37 + 11) % (max - min + 1))
const json = (value) => JSON.stringify(value)

const topicTemplates = {
  Mathematics: ["Place value and number sense", "Multiplication and division strategies", "Fractions and equivalent fractions", "Decimals and percentages", "Multi-step word problems"],
  English: ["Reading for meaning", "Grammar and sentence construction", "Vocabulary in context", "Writing for different audiences", "Inference and comprehension"],
  Science: ["Living things and habitats", "Materials and their properties", "Forces and energy", "Health and human development", "Scientific investigation"],
  "General Science": ["Cells and classification", "Energy transfer", "Forces and motion", "Earth and environmental systems", "Scientific investigation and evaluation"],
  Agriculture: ["Soil and soil fertility", "Crop production", "Livestock care", "Farm tools and safety", "Sustainable agriculture"],
  "Social Studies": ["Our community and governance", "Maps and local environments", "Malawi's history", "Rights and responsibilities", "Economic activities"],
  "Computer Studies": ["Computer hardware and safety", "File management", "Word processing", "Data and spreadsheets", "Digital citizenship"],
  "Life Skills": ["Personal development", "Healthy relationships", "Decision making", "Safety and first aid", "Financial responsibility"],
  "Creative Arts": ["Line, shape and colour", "Pattern and design", "Music and rhythm", "Drama and expression", "Creative project"],
  "Physical Education": ["Movement and coordination", "Games and teamwork", "Fitness and wellbeing", "Athletics", "Rules and fair play"],
  Chichewa: ["Kumvetsera ndi kulankhula", "Kuwerenga ndi kumvetsa", "Mawu ndi matanthauzo", "Kulemba nkhani", "Miyambo ndi chikhalidwe"],
  "Early Literacy": ["Listening and speaking", "Sound awareness", "Letter formation", "Shared reading", "Early writing"],
  "Early Numeracy": ["Counting and matching", "Shape and space", "Patterns", "Comparing quantities", "Early problem solving"],
  "Creative Development": ["Colour and texture", "Music and movement", "Making and building", "Stories and role play", "Creative showcase"],
  "Physical Development": ["Balance and body control", "Fine motor skills", "Outdoor movement", "Healthy routines", "Cooperative play"],
  "Environmental Awareness": ["My home and school", "Plants and animals", "Weather", "Clean and safe spaces", "Caring for our community"],
}

const subjectSets = {
  Reception: ["Early Literacy", "Early Numeracy", "Creative Development", "Physical Development", "Environmental Awareness"],
  primary: ["English", "Mathematics", "Science", "Social Studies", "Agriculture", "Computer Studies", "Life Skills", "Creative Arts", "Physical Education", "Chichewa"],
  upper: ["English", "Mathematics", "General Science", "Social Studies", "Agriculture", "Computer Studies", "Life Skills", "Creative Arts", "Physical Education", "Chichewa"],
}

const classSpecs = [
  ["Reception", "Reception", "", 22],
  ["Year 1 Blue", "Year 1", "Blue", 16], ["Year 1 Gold", "Year 1", "Gold", 16],
  ["Year 2 Blue", "Year 2", "Blue", 16], ["Year 2 Gold", "Year 2", "Gold", 16],
  ["Year 3 Blue", "Year 3", "Blue", 16], ["Year 3 Gold", "Year 3", "Gold", 16],
  ["Year 4 Blue", "Year 4", "Blue", 16], ["Year 4 Gold", "Year 4", "Gold", 16],
  ["Year 5", "Year 5", "", 26], ["Year 6", "Year 6", "", 26], ["Year 7", "Year 7", "", 26], ["Year 8", "Year 8", "", 26],
]

const teacherNames = [
  ["Madalitso", "Chirwa"], ["Thoko", "Mbewe"], ["Yamikani", "Phiri"], ["Chisomo", "Tembo"],
  ["Tadala", "Kachale"], ["Memory", "Nkhoma"], ["Blessings", "Mwale"], ["Pemphero", "Banda"],
  ["Mphatso", "Jere"], ["Lumbani", "Gondwe"], ["Dalitso", "Kumwenda"], ["Favour", "Nyirenda"],
  ["Ruth", "Kachale"], ["Peter", "Mvula"], ["Grace", "Chilima"], ["Daniel", "Soko"],
  ["Agnes", "Kondowe"], ["Kelvin", "Manda"], ["Martha", "Zimba"], ["Samuel", "Ngoma"],
  ["Esnart", "Kalua"], ["Innocent", "Lungu"], ["Natasha", "Kaphale"], ["Patrick", "Mkandawire"],
]
const studentFirstNames = ["Amina", "Chikondi", "Tiwonge", "Yamikani", "Mphatso", "Thandiwe", "Chisomo", "Dalitso", "Memory", "Tadala", "Blessings", "Fatsani", "Pemphero", "Lumbani", "Madalitso", "Favour", "Ruth", "Gift", "Natasha", "Tapiwa", "Esnart", "Innocent", "Chimwemwe", "Patience", "Wandile", "Mwayi", "Martha", "Kelvin", "Martha", "Wisdom"]
const surnames = ["Banda", "Phiri", "Mbewe", "Tembo", "Chirwa", "Mwale", "Nkhoma", "Jere", "Gondwe", "Kachale", "Nyirenda", "Mvula", "Kumwenda", "Soko", "Chilima", "Kondowe", "Manda", "Zimba", "Ngoma", "Kalua"]
const guardianFirstNames = ["Loveness", "Felix", "Miriam", "Andrew", "Chifundo", "Beatrice", "Joseph", "Rachael", "Moses", "Eunice", "Kelvin", "Agness"]

async function findOrCreateSchool() {
  const [[existing]] = await connection.query("SELECT id FROM schools WHERE code=? LIMIT 1", [DEMO_CODE])
  if (existing) await resetDemoSchool(existing.id)
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10)
  await q(`INSERT INTO schools (code,school_prefix,name,city,country,status,daily_drill_enabled,daily_drill_subject_mode,lesson_log_reminder_enabled,allow_backdated_lesson_logs,maximum_backdate_days)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE name=VALUES(name),city=VALUES(city),country=VALUES(country),status='active',school_prefix=VALUES(school_prefix)`,
  [DEMO_CODE, "GFA", "Greenfield Academy", "Blantyre", "Malawi", "active", 1, "smart_rotation", 1, 1, 14])
  const [[school]] = await connection.query("SELECT id FROM schools WHERE code=? LIMIT 1", [DEMO_CODE])
  return { schoolId: school.id, passwordHash }
}

async function resetDemoSchool(schoolId) {
  const [timetables] = await connection.query("SELECT id FROM timetables WHERE school_id=?", [schoolId])
  const timetableIds = timetables.map((row) => row.id)
  if (timetableIds.length) {
    const marks = timetableIds.map(() => "?").join(",")
    const [versions] = await connection.query(`SELECT id FROM timetable_versions WHERE timetable_id IN (${marks})`, timetableIds)
    const versionIds = versions.map((row) => row.id)
    if (versionIds.length) {
      const vm = versionIds.map(() => "?").join(",")
      const [versionTables] = await connection.query(`SELECT DISTINCT c.TABLE_NAME FROM information_schema.columns c
        JOIN information_schema.tables t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME AND t.TABLE_TYPE='BASE TABLE'
        WHERE c.TABLE_SCHEMA=DATABASE() AND c.COLUMN_NAME='timetable_version_id' AND c.TABLE_NAME <> 'timetable_versions'`)
      for (const { TABLE_NAME: table } of versionTables) await q(`DELETE FROM \`${table}\` WHERE timetable_version_id IN (${vm})`, versionIds)
    }
    await q(`UPDATE timetables SET current_published_version_id=NULL WHERE id IN (${marks})`, timetableIds)
    await q(`DELETE FROM timetable_day_templates WHERE timetable_id IN (${marks})`, timetableIds)
    await q(`DELETE FROM timetable_cycle_days WHERE timetable_id IN (${marks})`, timetableIds)
    await q(`DELETE FROM timetable_versions WHERE timetable_id IN (${marks})`, timetableIds)
    await q(`DELETE FROM bell_schedule_slots WHERE template_id IN (SELECT id FROM bell_schedule_templates WHERE timetable_id IN (${marks}))`, timetableIds)
    await q(`DELETE FROM bell_schedule_templates WHERE timetable_id IN (${marks})`, timetableIds)
  }

  // The demo is isolated by its stable code. Foreign-key checks are disabled
  // only while deleting rows carrying this exact school_id; no shared school
  // or non-demo rows are touched.
  await q("SET FOREIGN_KEY_CHECKS=0")
  const [tables] = await connection.query(`SELECT DISTINCT c.TABLE_NAME FROM information_schema.columns c
    JOIN information_schema.tables t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME AND t.TABLE_TYPE='BASE TABLE'
    WHERE c.TABLE_SCHEMA=DATABASE() AND c.COLUMN_NAME='school_id' AND c.TABLE_NAME <> 'schools'`)
  for (const { TABLE_NAME: table } of tables) {
    await q(`DELETE FROM \`${table}\` WHERE school_id=?`, [schoolId])
  }
  await q("SET FOREIGN_KEY_CHECKS=1")
}

async function seed() {
  await connection.beginTransaction()
  try {
    if (args.has("--reset-only")) {
      const [[existing]] = await connection.query("SELECT id FROM schools WHERE code=? LIMIT 1", [DEMO_CODE])
      if (existing) await resetDemoSchool(existing.id)
      await connection.commit()
      return { schoolId: existing?.id || null, resetOnly: true }
    }
    const { schoolId, passwordHash } = await findOrCreateSchool()
    const schoolAddress = "Greenfield Academy, Blantyre, Malawi"

    const staff = [
      ["school_owner", "admin_teacher", "Rosemary", "Banda", "owner", "School owner and director", "admin_teacher"],
      ["headteacher", "headteacher", "Evelyn", "Mbewe", "headteacher", "Headteacher", "headteacher"],
      ["teacher", "deputy_headteacher", "Patrick", "Phiri", "deputy", "Deputy headteacher", "deputy_headteacher"],
      ["teacher", "admin_teacher", "Lilian", "Tembo", "academic.coordinator", "Academic coordinator", "admin_teacher"],
      ["bursar", "admin_teacher", "Tiwonge", "Kachale", "bursar", "Bursar", "admin_teacher"],
      ["librarian", "admin_teacher", "Miriam", "Nkhoma", "librarian", "Librarian", "admin_teacher"],
      ["teacher", "admin_teacher", "Chifundo", "Mwale", "administrator", "School administrator", "admin_teacher"],
      ["teacher", "admin_teacher", "Beatrice", "Jere", "reception", "Reception administrator", "admin_teacher"],
      ["teacher", "admin_teacher", "Felix", "Gondwe", "exams.officer", "Examinations officer", "admin_teacher"],
      ...teacherNames.map(([firstName, lastName], index) => ["teacher", "teacher", firstName, lastName, `teacher.${String(index + 1).padStart(2, "0")}`, "Class and subject teacher", "teacher"]),
    ]
    const staffRows = staff.map(([role, roleType, firstName, lastName, local, specialization], index) => [
      randomUUID(), schoolId, role, `${firstName} ${lastName}`, firstName, lastName,
      `${local}@greenfield.academy`, passwordHash, 0, `+265 88${String(200000 + index).slice(-6)}`,
      `GFA-${String(index + 1).padStart(3, "0")}`, role === "teacher" ? "B.Ed Primary Education" : "School Administration",
      specialization, "active", roleType, 1,
    ])
    await insertMany("users", ["public_ref", "school_id", "role", "full_name", "first_name", "last_name", "email", "password_hash", "must_change_password", "phone", "employee_id", "qualification", "specialization", "employment_status", "role_type", "is_active"], staffRows)
    const users = Object.fromEntries((await q("SELECT id,email,role FROM users WHERE school_id=?", [schoolId])).map((row) => [row.email.split("@")[0], row]))
    const ownerId = users.owner.id
    const headteacherId = users.headteacher.id
    const bursarId = users.bursar.id
    const coordinatorId = users["academic.coordinator"].id
    const examOfficerId = users["exams.officer"].id
    const teacherIds = teacherNames.map((_, index) => users[`teacher.${String(index + 1).padStart(2, "0")}`].id)

    const [yearResult] = await connection.query(`INSERT INTO academic_years (school_id,name,start_date,end_date,status,is_active) VALUES (?,?,?,?,?,?)`, [schoolId, "2026 Academic Year", "2026-01-05", "2026-12-04", "active", 1])
    const yearId = yearResult.insertId
    const termRows = [
      [schoolId, yearId, "Term 1", 1, "2026-01-05", "2026-04-10", "2026-02-16", "2026-02-20", "2026-03-23", "2026-03-27", "2026-03-30", "2026-04-08", "2026-04-10", "archived"],
      [schoolId, yearId, "Term 2", 2, "2026-04-20", "2026-08-07", "2026-06-22", "2026-06-26", "2026-07-20", "2026-07-24", "2026-07-27", "2026-08-05", "2026-08-07", "open"],
      [schoolId, yearId, "Term 3", 3, "2026-09-01", "2026-12-04", "2026-10-19", "2026-10-23", "2026-11-16", "2026-11-20", "2026-11-23", "2026-12-02", "2026-12-04", "upcoming"],
    ]
    await insertMany("terms", ["school_id", "academic_year_id", "name", "term_number", "start_date", "end_date", "revision_start_date", "revision_end_date", "exam_start_date", "exam_end_date", "marking_start_date", "marking_end_date", "closing_date", "status"], termRows)
    const terms = Object.fromEntries((await q("SELECT id,name FROM terms WHERE school_id=? AND academic_year_id=?", [schoolId, yearId])).map((row) => [row.name, row.id]))
    const term1Id = terms["Term 1"]
    const term2Id = terms["Term 2"]
    const term3Id = terms["Term 3"]

    await q("INSERT INTO curricula (school_id,name,country,is_active) VALUES (?,?,?,1)", [schoolId, "Greenfield Academy Primary Curriculum", "Malawi"])
    const [[curriculum]] = await connection.query("SELECT id FROM curricula WHERE school_id=? ORDER BY id DESC LIMIT 1", [schoolId])
    const gradeRows = ["Reception", ...Array.from({ length: 8 }, (_, index) => `Year ${index + 1}`)].map((name, index) => [schoolId, curriculum.id, name, "Primary", index, name === "Year 8" ? 1 : 0])
    await insertMany("grade_levels", ["school_id", "curriculum_id", "name", "stage", "order_number", "is_candidate"], gradeRows)
    const gradeIds = Object.fromEntries((await q("SELECT id,name FROM grade_levels WHERE school_id=?", [schoolId])).map((row) => [row.name, row.id]))

    const subjectNames = [...new Set(Object.values(subjectSets).flat())]
    const subjectRows = subjectNames.map((name) => [randomUUID(), schoolId, name, name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 8)])
    await insertMany("subjects", ["public_ref", "school_id", "name", "code"], subjectRows)
    const subjectIds = Object.fromEntries((await q("SELECT id,name FROM subjects WHERE school_id=?", [schoolId])).map((row) => [row.name, row.id]))

    const classRows = classSpecs.map(([name, grade, stream], index) => [randomUUID(), schoolId, name, grade, teacherIds[index]])
    await insertMany("classes", ["public_ref", "school_id", "name", "grade_level", "teacher_user_id"], classRows)
    const classRowsDb = await q("SELECT id,name,grade_level,teacher_user_id FROM classes WHERE school_id=? ORDER BY id", [schoolId])
    const classes = Object.fromEntries(classRowsDb.map((row) => [row.name, row]))
    const classSubjects = (grade) => grade === "Reception" ? subjectSets.Reception : Number(grade.split(" ")[1]) <= 4 ? subjectSets.primary : subjectSets.upper

    const assignmentRows = []
    for (const row of classRowsDb) {
      const spec = classSpecs.find((entry) => entry[0] === row.name)
      assignmentRows.push([schoolId, row.teacher_user_id, row.id, null, yearId, term2Id, "2026", "Term 2", "class_teacher", 1, `${row.name} class teacher`])
      classSubjects(spec[1]).forEach((subject, subjectIndex) => {
        const teacherId = teacherIds[(classRowsDb.indexOf(row) + subjectIndex + 4) % teacherIds.length]
        assignmentRows.push([schoolId, teacherId, row.id, subjectIds[subject], yearId, term2Id, "2026", "Term 2", "subject_teacher", 1, `${subject} for ${row.name}`])
      })
    }
    await insertMany("teacher_class_subject_assignments", ["school_id", "teacher_id", "class_id", "subject_id", "academic_year_id", "term_id", "academic_year", "term", "role", "is_active", "notes"], assignmentRows)

    const studentRows = []
    let studentNumber = 0
    const studentMeta = []
    for (const [className, grade, stream, count] of classSpecs) {
      const classRow = classes[className]
      for (let local = 0; local < count; local += 1) {
        studentNumber += 1
        const firstName = studentFirstNames[(studentNumber - 1) % studentFirstNames.length]
        const lastName = surnames[(studentNumber * 7) % surnames.length]
        const special = studentNumber === 17 ? "new" : studentNumber === 63 ? "transfer" : studentNumber === 104 ? "repeat" : studentNumber === 151 ? "exam_absent" : studentNumber === 189 ? "incomplete" : studentNumber === 207 ? "improving" : studentNumber === 219 ? "declining" : studentNumber === 231 ? "high_performer" : null
        const status = studentNumber === 236 ? "withdrawn" : "active"
        const admission = `GFA-2026-${String(studentNumber).padStart(4, "0")}`
        studentRows.push([randomUUID(), schoolId, classRow.id, admission, admission, firstName, lastName, `${2011 + Math.max(0, 8 - Number(grade.split(" ")[1] || 0))}-${String((studentNumber % 12) + 1).padStart(2, "0")}-${String((studentNumber % 24) + 1).padStart(2, "0")}`, studentNumber % 2 ? "Female" : "Male", stream || null, "2026-04-20", special === "new" ? "new" : special === "transfer" ? "transfer" : special === "repeat" ? "returning" : "returning", status])
        studentMeta.push({ admission, classId: classRow.id, className, grade, stream, special, status, number: studentNumber })
      }
    }
    await insertMany("students", ["public_ref", "school_id", "class_id", "student_id", "admission_no", "first_name", "last_name", "date_of_birth", "gender", "stream_section", "enrollment_date", "student_type", "status"], studentRows)
    const students = await q("SELECT id,admission_no,first_name,last_name,class_id,status,student_type FROM students WHERE school_id=? ORDER BY admission_no", [schoolId])
    const studentByAdmission = Object.fromEntries(students.map((row) => [row.admission_no, row]))
    const enrollmentRows = []
    const progressionRows = []
    for (const meta of studentMeta) {
      const student = studentByAdmission[meta.admission]
      const status = meta.status === "withdrawn" ? "withdrawn" : "active"
      enrollmentRows.push([schoolId, student.id, yearId, term1Id, student.class_id, meta.stream || null, "continued", meta.status === "withdrawn" ? "withdrawn" : "active", "2026-01-05"])
      enrollmentRows.push([schoolId, student.id, yearId, term2Id, student.class_id, meta.stream || null, meta.special === "new" ? "new" : meta.special === "repeat" ? "repeated" : "continued", status, "2026-04-20"])
      const gradeNumber = Number(meta.grade.split(" ")[1] || 0)
      const nextClassName = gradeNumber >= 8 ? null : gradeNumber === 0 ? "Year 1 Blue" : `Year ${gradeNumber + 1}${gradeNumber + 1 <= 4 ? " Blue" : ""}`
      progressionRows.push([schoolId, student.id, yearId, yearId, student.class_id, nextClassName ? classes[nextClassName]?.id || null : null, meta.special === "repeat" ? "repeated" : meta.status === "withdrawn" ? "withdrawn" : gradeNumber >= 8 ? "graduated" : "promoted", meta.special === "repeat" ? "Repeated after a supported review." : "Term 1 progression decision based on published evidence.", ownerId, "2026-04-15"])
    }
    await insertMany("student_enrollments", ["school_id", "student_id", "academic_year_id", "term_id", "class_id", "stream_section", "enrollment_type", "enrollment_status", "start_date"], enrollmentRows)
    await insertMany("promotion_decisions", ["school_id", "student_id", "from_academic_year_id", "to_academic_year_id", "from_class_id", "to_class_id", "decision", "reason", "approved_by", "approved_at"], progressionRows)

    const parentRows = []
    const parentLinks = []
    const guardianRows = []
    const parentMeta = []
    for (let family = 0; family < Math.ceil(studentMeta.length / 2); family += 1) {
      const first = guardianFirstNames[family % guardianFirstNames.length]
      const last = surnames[(family * 3) % surnames.length]
      const emailLocal = `family.${String(family + 1).padStart(3, "0")}`
      parentRows.push([randomUUID(), schoolId, "parent", `${first} ${last}`, first, last, `${emailLocal}@parents.greenfield.academy`, passwordHash, 0, `+265 99${String(500000 + family).slice(-6)}`, null, null, null, "active", "teacher", 1])
      parentMeta.push({ family, emailLocal, name: `${first} ${last}` })
    }
    await insertMany("users", ["public_ref", "school_id", "role", "full_name", "first_name", "last_name", "email", "password_hash", "must_change_password", "phone", "employee_id", "qualification", "specialization", "employment_status", "role_type", "is_active"], parentRows)
    const parentIds = Object.fromEntries((await q("SELECT id,email FROM users WHERE school_id=? AND role='parent'", [schoolId])).map((row) => [row.email.split("@")[0], row.id]))
    for (let index = 0; index < studentMeta.length; index += 1) {
      const meta = studentMeta[index]
      const student = studentByAdmission[meta.admission]
      const family = Math.floor(index / 2)
      const parentId = parentIds[`family.${String(family + 1).padStart(3, "0")}`]
      guardianRows.push([randomUUID(), schoolId, student.id, parentId, 1, parentMeta[family].name, index % 3 === 0 ? "mother" : index % 3 === 1 ? "father" : "guardian", `+265 99${String(500000 + family).slice(-6)}`, null, `${parentMeta[family].emailLocal}@parents.greenfield.academy`, null])
      guardianRows.push([randomUUID(), schoolId, student.id, null, 2, `${surnames[(family + 5) % surnames.length]} Family Guardian`, index % 2 ? "aunt" : "grandparent", `+265 88${String(600000 + family).slice(-6)}`, null, null, null])
      parentLinks.push([schoolId, parentId, student.id, index % 3 === 0 ? "mother" : index % 3 === 1 ? "father" : "guardian"])
    }
    await insertMany("student_guardians", ["public_ref", "school_id", "student_id", "user_id", "guardian_number", "full_name", "relationship", "primary_phone", "secondary_phone", "email", "national_id"], guardianRows)
    await insertMany("parent_student_links", ["school_id", "parent_user_id", "student_id", "relationship"], parentLinks)

    const feeStructureRows = [
      [schoolId, yearId, term1Id, null, "Greenfield Term 1 Fees", "2026-03-01", "percent", 5, json({ sibling_discount: 5, bursary_discount: 50 }), "active", bursarId],
      [schoolId, yearId, term2Id, null, "Greenfield Term 2 Fees", "2026-06-15", "percent", 5, json({ sibling_discount: 5, bursary_discount: 50 }), "active", bursarId],
    ]
    await insertMany("finance_fee_structures", ["school_id", "academic_year_id", "term_id", "class_id", "name", "due_date", "late_penalty_type", "late_penalty_value", "discount_rules_json", "status", "created_by"], feeStructureRows)
    const feeStructures = await q("SELECT id,term_id FROM finance_fee_structures WHERE school_id=? ORDER BY id", [schoolId])
    const feeItems = []
    for (const structure of feeStructures) {
      feeItems.push([schoolId, structure.id, "Tuition", "tuition", 150000, 1], [schoolId, structure.id, "ICT and learning resources", "development", 18000, 2], [schoolId, structure.id, "Activities and sports", "other", 12000, 3], [schoolId, structure.id, "Examination", "exam", 10000, 4])
    }
    await insertMany("finance_fee_structure_items", ["school_id", "fee_structure_id", "item_name", "item_type", "amount", "sort_order"], feeItems)
    const feeAccounts = []
    const feePayments = []
    const feeProfileRows = []
    for (const meta of studentMeta) {
      const student = studentByAdmission[meta.admission]
      const familyIndex = Math.floor((studentMeta.indexOf(meta)) / 2)
      const bursary = meta.number % 23 === 0
      const sibling = familyIndex % 7 === 0
      const discountPercent = bursary ? 50 : sibling ? 5 : 0
      feeProfileRows.push([schoolId, student.id, bursary ? "bursary" : "standard", "termly", discountPercent, bursary ? "Greenfield access bursary" : sibling ? "Sibling discount" : null])
      for (const structure of feeStructures) {
        const gross = 190000
        const due = gross * (1 - discountPercent / 100)
        const paidRatio = meta.number % 11 === 0 ? 0 : meta.number % 5 === 0 ? 0.55 : meta.number % 3 === 0 ? 0.78 : 1
        const paid = Number((due * paidRatio).toFixed(2))
        feeAccounts.push([schoolId, student.id, yearId, structure.term_id, student.class_id, structure.id, structure.term_id === term1Id ? "Term 1 2026" : "Term 2 2026", due, 0, 0, paid, paid >= due ? "paid" : paid === 0 ? "overdue" : "partial", structure.term_id === term1Id ? "2026-03-01" : "2026-06-15", paidRatio < 1 ? "Payment plan or outstanding balance for demonstration." : null])
      }
    }
    await insertMany("student_fee_profiles", ["school_id", "student_id", "fee_category", "payment_plan", "discount_percent", "discount_reason"], feeProfileRows)
    await insertMany("fee_accounts", ["school_id", "student_id", "academic_year_id", "term_id", "class_id", "fee_structure_id", "term_name", "amount_due", "discount_amount", "penalty_amount", "amount_paid", "status", "due_date", "finance_notes"], feeAccounts)
    const accountRows = await q("SELECT id,student_id,amount_paid FROM fee_accounts WHERE school_id=? AND amount_paid>0 ORDER BY id", [schoolId])
    for (const account of accountRows) feePayments.push([schoolId, account.id, null, Number(account.amount_paid), "posted", account.id % 3 === 0 ? "bank_transfer" : account.id % 3 === 1 ? "mobile_money" : "cash", `GFA-REC-${String(account.id).padStart(6, "0")}`, account.id % 2 ? "2026-06-10" : "2026-03-10", "Greenfield demo payment", 0, 0, `GFA-REC-${String(account.id).padStart(6, "0")}`, bursarId])
    await insertMany("fee_payments", ["school_id", "fee_account_id", "invoice_id", "amount", "status", "payment_method", "reference", "paid_on", "notes", "balance_before", "balance_after", "receipt_no", "recorded_by"], feePayments)

    const term1Holidays = new Set(["2026-02-16", "2026-03-03"])
    const term2Holidays = new Set(["2026-05-01", "2026-06-15", "2026-07-06"])
    const attendanceRows = []
    for (const meta of studentMeta) {
      const student = studentByAdmission[meta.admission]
      for (const date of weekdays("2026-01-05", "2026-04-10", term1Holidays).concat(weekdays("2026-04-20", "2026-07-13", term2Holidays))) {
        const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
        let status = "present"
        if (meta.special === "declining" && date >= "2026-06-01" && (meta.number + weekday) % 5 === 0) status = "absent"
        else if (meta.special === "attendance_drop" && date >= "2026-06-01" && (meta.number + weekday) % 4 === 0) status = "absent"
        else if (meta.number % 29 === 0 && weekday === 1) status = "absent"
        else if (meta.special === "exam_absent" && date === "2026-07-21") status = "absent"
        else if ((meta.number + date.charCodeAt(9)) % 41 === 0) status = "late"
        else if ((meta.number + date.charCodeAt(8)) % 113 === 0) status = "sick"
        attendanceRows.push([schoolId, student.class_id, student.id, date, status, status === "absent" ? "Fictional attendance pattern for follow-up testing." : null, coordinatorId])
      }
    }
    await insertMany("attendance_records", ["school_id", "class_id", "student_id", "attendance_date", "status", "note", "marked_by"], attendanceRows)
    const staffAttendanceRows = []
    const staffUsers = await q("SELECT id,role FROM users WHERE school_id=? AND role IN ('teacher','headteacher','bursar','librarian')", [schoolId])
    for (const user of staffUsers) for (const date of weekdays("2026-04-20", "2026-07-13", term2Holidays)) {
      const status = user.id % 17 === 0 && date >= "2026-06-01" ? "late" : user.id % 19 === 0 && date === "2026-06-18" ? "absent" : "present"
      staffAttendanceRows.push([randomUUID(), schoolId, user.id, date, status, status === "late" ? "Late arrival recorded." : null, coordinatorId])
    }
    await insertMany("staff_attendance", ["public_ref", "school_id", "staff_user_id", "attendance_date", "status", "notes", "recorded_by"], staffAttendanceRows)

    const leaveRows = [
      [randomUUID(), schoolId, teacherIds[20], "study", "2026-06-15", "2026-06-19", 5, "Approved professional development week.", teacherIds[21], "approved", headteacherId, "2026-06-10", "Substitute coverage arranged.", coordinatorId],
      [randomUUID(), schoolId, teacherIds[21], "annual", "2026-07-27", "2026-07-31", 5, "Upcoming annual leave request.", teacherIds[22], "pending", null, null, null, teacherIds[21]],
    ]
    await insertMany("staff_leave_requests", ["public_ref", "school_id", "staff_user_id", "leave_type", "start_date", "end_date", "total_days", "reason", "coverage_staff_user_id", "status", "approved_by", "approved_at", "decision_notes", "created_by"], leaveRows)

    const eventRows = [
      [schoolId, yearId, term1Id, "Term 1 opening", "Welcome assembly and learner induction.", "school_event", "NO_CLASSES_SUSPENDED", null, "2026-01-05 07:30:00", "2026-01-05 15:30:00", 0, null, null, null, ownerId, "whole_school", "manual", null, "completed"],
      [schoolId, yearId, term2Id, "Greenfield Sports Day", "Inter-house sports and family activities.", "sports", "HALF_DAY", "12:25:00", "2026-05-29 07:30:00", "2026-05-29 12:25:00", 0, null, null, null, ownerId, "whole_school", "manual", null, "completed"],
      [schoolId, yearId, term2Id, "Term 2 Mid-Term Examinations 2026", "Formal mid-term assessment week.", "exam_week", "ALL_CLASSES_SUSPENDED", null, "2026-07-20 07:30:00", "2026-07-24 15:30:00", 0, null, null, null, examOfficerId, "whole_school", "academic_timeline", null, "scheduled"],
      [schoolId, yearId, term2Id, "Parent progress meeting", "Evidence-based academic and attendance conversations.", "meeting", "NO_CLASSES_SUSPENDED", null, "2026-07-10 14:00:00", "2026-07-10 16:30:00", 0, null, null, null, headteacherId, "parents", "manual", null, "completed"],
      [schoolId, yearId, term3Id, "Term 3 planning week", "Draft planning and timetable review.", "revision_week", "NO_CLASSES_SUSPENDED", null, "2026-08-24 08:00:00", "2026-08-28 15:30:00", 0, null, null, null, coordinatorId, "teachers_only", "academic_timeline", null, "draft"],
    ]
    await insertMany("school_events", ["school_id", "academic_year_id", "term_id", "title", "description", "event_type", "class_impact", "half_day_closing_time", "start_datetime", "end_datetime", "all_day", "class_id", "stream_section", "subject_id", "created_by", "visibility", "source_type", "source_id", "status"], eventRows)

    const syllabusRows = []
    const objectiveRows = []
    const topicMap = {}
    for (const grade of ["Reception", ...Array.from({ length: 8 }, (_, index) => `Year ${index + 1}`)]) {
      const subjects = grade === "Reception" ? subjectSets.Reception : Number(grade.split(" ")[1]) <= 4 ? subjectSets.primary : subjectSets.upper
      for (const subject of subjects) {
        const templates = topicTemplates[subject]
        topicMap[`${grade}|${subject}`] = []
        templates.forEach((topicName, order) => {
          const term = order < 2 ? "Term 1" : order < 4 ? "Term 2" : "Term 3"
          syllabusRows.push([randomUUID(), schoolId, curriculum.id, gradeIds[grade], subjectIds[subject], null, topicName, `${grade} ${subject}: ${topicName}`, term, order + 1, "teacher_created", 1])
        })
      }
    }
    await insertMany("syllabus_topics", ["public_ref", "school_id", "curriculum_id", "grade_id", "subject_id", "parent_topic_id", "topic_name", "description", "term", "order_number", "source_type", "is_active"], syllabusRows)
    const topicRowsDb = await q("SELECT id,grade_id,subject_id,topic_name,order_number,term FROM syllabus_topics WHERE school_id=? ORDER BY id", [schoolId])
    for (const topic of topicRowsDb) {
      const grade = Object.entries(gradeIds).find(([, id]) => id === topic.grade_id)?.[0]
      const subject = Object.entries(subjectIds).find(([, id]) => id === topic.subject_id)?.[0]
      topicMap[`${grade}|${subject}`].push(topic)
      objectiveRows.push([randomUUID(), schoolId, topic.id, topic.subject_id, grade, `Explain and apply ${topic.topic_name.toLowerCase()} in a new example.`, "application", "high"], [randomUUID(), schoolId, topic.id, topic.subject_id, grade, `Communicate accurate reasoning about ${topic.topic_name.toLowerCase()}.`, "reasoning", "medium"])
    }
    await insertMany("learning_objectives", ["public_ref", "school_id", "topic_id", "subject_id", "class_level", "objective_text", "skill_type", "exam_relevance"], objectiveRows)
    const dependencyRows = []
    for (const topics of Object.values(topicMap)) for (let index = 1; index < topics.length; index += 1) dependencyRows.push([schoolId, topics[index].id, topics[index - 1].id, index === 1 ? "required" : "recommended"])
    await insertMany("syllabus_topic_prerequisites", ["school_id", "topic_id", "prerequisite_topic_id", "strength"], dependencyRows)

    const deliveryRows = []
    const lessonRows = []
    for (const row of classRowsDb) {
      const spec = classSpecs.find((entry) => entry[0] === row.name)
      const subjects = classSubjects(spec[1])
      for (const subject of subjects) {
        const topics = topicMap[`${spec[1]}|${subject}`]
        const teacher = assignmentRows.find((assignment) => assignment[2] === row.id && assignment[3] === subjectIds[subject])?.[1] || row.teacher_user_id
        topics.forEach((topic, index) => {
          const key = `${spec[1]}|${subject}`
          let lifecycle = topic.term === "Term 1" ? "ASSESSED" : topic.term === "Term 3" ? "NOT_STARTED" : "IN_PROGRESS"
          let confidence = "medium"
          let assessed = lifecycle === "ASSESSED" ? 1 : 0
          let mastery = lifecycle === "ASSESSED" ? 68 : null
          let below = lifecycle === "ASSESSED" ? 3 : 0
          if (row.name.includes("Year 5") && subject === "Mathematics" && index >= 2) { lifecycle = index === 2 ? "REQUIRES_REVISION" : "PLANNED"; mastery = index === 2 ? 48 : null; assessed = index === 2 ? 1 : 0; below = index === 2 ? 10 : 0; confidence = "high" }
          if (row.name.includes("Year 3") && subject === "English" && topic.term === "Term 2") { lifecycle = "ASSESSED"; mastery = 76; assessed = 1; below = 2; confidence = "high" }
          if (row.name.includes("Year 4") && subject === "Science" && topic.term === "Term 2") { lifecycle = "TAUGHT"; mastery = null; assessed = 0; below = 0; confidence = "medium" }
          if (row.name === "Year 6" && subject === "General Science" && index === 2) { lifecycle = "MASTERED"; mastery = 82; assessed = 1; below = 1; confidence = "high" }
          if (row.name === "Year 6" && subject === "General Science" && index === 3) { lifecycle = "REQUIRES_REVISION"; mastery = 44; assessed = 1; below = 9; confidence = "high" }
          if (row.name === "Year 7" && subject === "Mathematics" && index === 2) { lifecycle = "PARTIALLY_MASTERED"; mastery = 61; assessed = 1; below = 7; confidence = "medium" }
          if (row.name.includes("Year 2") && subject === "Mathematics" && topic.term === "Term 2") { lifecycle = index === 2 ? "IN_PROGRESS" : "NOT_STARTED"; mastery = null; assessed = 0; below = 0; confidence = "low" }
          deliveryRows.push([randomUUID(), schoolId, yearId, term2Id, row.id, spec[2] || null, subjectIds[subject], teacher, curriculum.id, topic.id, null, null, "2026-04-20", "2026-05-15", lifecycle === "NOT_STARTED" ? null : "2026-04-22", lifecycle === "NOT_STARTED" ? null : "2026-05-12", 4, lifecycle === "NOT_STARTED" ? 0 : 4, lifecycle === "NOT_STARTED" ? 0 : 4, lifecycle, confidence, mastery ? "Evidence seeded from connected assessments and delivery logs." : null, assessed, mastery, mastery ? 68 : null, mastery ? 20 : 0, below, below > 0 ? 1 : 0, "greenfield_lesson_and_assessment_evidence", new Date()])
          if (topic.term !== "Term 3" && (index < 4 || lifecycle === "REQUIRES_REVISION")) lessonRows.push([schoolId, yearId, term2Id, teacher, row.id, subjectIds[subject], null, addDays("2026-04-20", (index + row.id) % 45), "07:45:00", "08:45:00", "finalized", topic.id, lifecycle === "REQUIRES_REVISION" ? "partially_taught" : lifecycle === "ASSESSED" ? "assessed" : "fully_taught", lifecycle === "REQUIRES_REVISION" ? 50 : 100, lifecycle === "REQUIRES_REVISION" ? "students_struggled" : lifecycle === "ASSESSED" ? "students_understood" : "mixed_understanding", lifecycle === "REQUIRES_REVISION" ? "high" : "medium", lifecycle === "REQUIRES_REVISION" ? "Two lessons were postponed and the prerequisite needs recovery." : `${topic.topic_name} lesson delivered with guided practice.`, "Practice questions issued.", lifecycle === "REQUIRES_REVISION" ? "Run a diagnostic and reteach the prerequisite." : "Continue to the next sequenced topic.", lifecycle === "REQUIRES_REVISION" ? "fractions and multi-step reasoning" : null, coordinatorId, `${addDays("2026-04-20", (index + row.id) % 45)} 09:00:00`])
        })
      }
    }
    await insertMany("curriculum_delivery_records", ["public_ref", "school_id", "academic_year_id", "term_id", "class_id", "stream_section", "subject_id", "teacher_id", "curriculum_id", "topic_id", "subtopic_id", "learning_objective_id", "planned_start_date", "planned_completion_date", "actual_start_date", "actual_completion_date", "planned_lesson_count", "completed_lesson_count", "periods_spent", "lifecycle_status", "teacher_confidence", "teacher_notes", "assessed_status", "class_mastery_score", "mastery_confidence_score", "students_assessed", "students_below_threshold", "revision_required", "evidence_source", "last_recalculated_at"], deliveryRows)
    await insertMany("teacher_lesson_logs", ["school_id", "academic_year_id", "term_id", "teacher_id", "class_id", "subject_id", "timetable_entry_id", "lesson_date", "started_at", "ended_at", "status", "main_topic_id", "coverage_status", "coverage_percentage", "lesson_outcome", "difficulty_observed", "lesson_notes", "homework_assigned", "next_lesson_action", "recommended_drill_focus", "finalized_by", "finalized_at"], lessonRows)

    const examSessionRows = [
      [schoolId, yearId, term1Id, "Term 1 Diagnostic Week", "custom", "results_approved", "NORMAL_LESSONS_CONTINUE", "2026-01-26", "2026-01-30", "Opening diagnostic evidence.", ownerId],
      [schoolId, yearId, term1Id, "Term 1 Mid-Term Examinations 2026", "mid_term", "results_approved", "PARTIAL_SUSPENSION", "2026-03-23", "2026-03-27", "Archived mid-term examination.", ownerId],
      [schoolId, yearId, term1Id, "Term 1 End-of-Term Examinations 2026", "end_of_term", "results_approved", "FULL_SCHOOL_SUSPENSION", "2026-03-30", "2026-04-08", "Published historical results.", ownerId],
      [schoolId, yearId, term2Id, "Term 2 Opening Baseline", "custom", "results_approved", "NORMAL_LESSONS_CONTINUE", "2026-04-27", "2026-05-01", "Baseline evidence for current term.", ownerId],
      [schoolId, yearId, term2Id, "Term 2 Mid-Term Examinations 2026", "mid_term", "results_approved", "PARTIAL_SUSPENSION", "2026-07-20", "2026-07-24", "Current mid-term examination session.", ownerId],
      [schoolId, yearId, term2Id, "Term 2 End-of-Term Examinations 2026", "end_of_term", "scheduled", "FULL_SCHOOL_SUSPENSION", "2026-07-27", "2026-07-31", "Upcoming examination session.", ownerId],
    ]
    await insertMany("exam_sessions", ["school_id", "academic_year_id", "term_id", "name", "exam_type", "status", "operating_mode", "start_date", "end_date", "notes", "created_by"], examSessionRows)
    const sessions = Object.fromEntries((await q("SELECT id,name,term_id,exam_type,status FROM exam_sessions WHERE school_id=?", [schoolId])).map((row) => [row.name, row]))

    const assessmentRows = []
    const assessmentMeta = []
    for (const row of classRowsDb) {
      const spec = classSpecs.find((entry) => entry[0] === row.name)
      for (const subject of classSubjects(spec[1])) {
        const teacher = assignmentRows.find((assignment) => assignment[2] === row.id && assignment[3] === subjectIds[subject])?.[1] || row.teacher_user_id
        for (const [sessionName, type, status] of [["Term 1 End-of-Term Examinations 2026", "end_of_term_exam", "approved"], ["Term 2 Opening Baseline", "class_test", "approved"], ["Term 2 Mid-Term Examinations 2026", "mid_term", row.name.includes("Year 2") && subject === "Mathematics" ? "draft" : "approved"], ["Term 2 End-of-Term Examinations 2026", "end_of_term_exam", "scheduled"]]) {
          const title = `${sessionName} · ${row.name} · ${subject}`
          assessmentRows.push([schoolId, sessions[sessionName].id, row.id, subjectIds[subject], yearId, sessions[sessionName].term_id, teacher, title, type, sessions[sessionName].term_id === term1Id ? "Term 1" : "Term 2", 100, type === "class_test" ? 45 : 120, "Complete every section and show reasoning.", "Medium", status, status === "approved" ? ownerId : null, status === "approved" ? new Date() : null, ownerId])
          assessmentMeta.push({ title, classId: row.id, className: row.name, grade: spec[1], subject, subjectId: subjectIds[subject], teacherId: teacher, sessionName, sessionId: sessions[sessionName].id, termId: sessions[sessionName].term_id, status, assessmentType: type })
        }
      }
    }
    // Additional weekly quiz used for the Year 3 English improvement story.
    const y3 = classes["Year 3 Blue"]
    const y3EnglishTeacher = assignmentRows.find((assignment) => assignment[2] === y3.id && assignment[3] === subjectIds.English)?.[1] || y3.teacher_user_id
    const quizTitle = "Term 2 Week 8 Reading Comprehension Quiz · Year 3 Blue · English"
    assessmentRows.push([schoolId, sessions["Term 2 Mid-Term Examinations 2026"].id, y3.id, subjectIds.English, yearId, term2Id, y3EnglishTeacher, quizTitle, "quiz", "Term 2", 30, 35, "Read the passage and answer in complete sentences.", "Medium", "approved", ownerId, new Date(), ownerId])
    assessmentMeta.push({ title: quizTitle, classId: y3.id, className: "Year 3 Blue", grade: "Year 3", subject: "English", subjectId: subjectIds.English, teacherId: y3EnglishTeacher, sessionName: "Term 2 Mid-Term Examinations 2026", sessionId: sessions["Term 2 Mid-Term Examinations 2026"].id, termId: term2Id, status: "approved", assessmentType: "quiz" })
    await insertMany("assessments", ["school_id", "exam_session_id", "class_id", "subject_id", "academic_year_id", "term_id", "teacher_id", "name", "assessment_type", "term_name", "total_marks", "duration_minutes", "instructions", "expected_difficulty", "status", "approved_by", "approved_at", "created_by"], assessmentRows)
    const assessmentDb = await q("SELECT id,name,class_id,subject_id,exam_session_id,academic_year_id,term_id,teacher_id,total_marks,assessment_type,status FROM assessments WHERE school_id=? ORDER BY id", [schoolId])
    const assessmentByTitle = Object.fromEntries(assessmentDb.map((row) => [row.name, row]))

    const questionSets = [
      ["Year 5", "Mathematics", "Term 2 Mid-Term Examinations 2026", ["Number fluency", "Equivalent fractions", "Fraction comparison", "Decimal conversion", "Multi-step word problems"]],
      ["Year 5", "English", "Term 2 Mid-Term Examinations 2026", ["Reading for meaning", "Vocabulary in context", "Grammar", "Writing for audience", "Inference"]],
      ["Year 4", "Science", "Term 2 Opening Baseline", ["Living things", "Materials", "Forces", "Health", "Investigation"]],
      ["Year 6", "General Science", "Term 2 Mid-Term Examinations 2026", ["Classification", "Energy", "Forces", "Earth systems", "Practical investigation"]],
      ["Year 7", "Mathematics", "Term 2 Mid-Term Examinations 2026", ["Place value", "Multiplication", "Fractions", "Decimals", "Word problems"]],
      ["Year 3 Blue", "English", "Term 2 Week 8 Reading Comprehension Quiz", ["Retrieval", "Vocabulary", "Sequencing", "Inference", "Written response"]],
    ]
    const detailedAssessmentIds = new Set()
    const questionBankRows = []
    const assessmentQuestionRows = []
    const questionAttemptSeed = []
    for (const [classLabel, subject, sessionName, questionNames] of questionSets) {
      const meta = assessmentMeta.find((entry) => entry.className === classLabel || entry.className.startsWith(classLabel))
      const assessment = assessmentMeta.find((entry) => (entry.className === classLabel || entry.className.startsWith(`${classLabel} `)) && entry.subject === subject && entry.sessionName === sessionName)?.title
      const assessmentRow = assessmentByTitle[assessment]
      if (!assessmentRow) continue
      detailedAssessmentIds.add(assessmentRow.id)
      const topics = topicMap[`${assessmentRow.class_id === classes["Year 3 Blue"]?.id ? "Year 3" : classLabel}|${subject}`] || topicMap[`${classLabel}|${subject}`] || topicMap[`Year ${classLabel.match(/\d+/)?.[0]}|${subject}`] || []
      questionNames.forEach((questionText, index) => {
        const marks = index === 4 ? 55 : index === 3 ? 15 : 10
        const topic = topics[index % Math.max(1, topics.length)]
        assessmentQuestionRows.push([schoolId, assessmentRow.id, index + 1, String(index + 1), questionText, "structured", marks, topic?.id || null, topic?.topic_name || questionText, null, null, index > 2 ? "hard" : index === 2 ? "medium" : "easy", index < 2 ? "recall" : index === 2 ? "understanding" : "application", "Answer with evidence.", null, "Expected evidence-based answer.", `Award up to ${marks} marks using the published scheme.`, "Show a clear method.", index, new Date(), new Date()])
        questionBankRows.push([randomUUID(), schoolId, curriculum.id, null, assessmentRow.subject_id, topic?.id || 1, "structured", questionText, null, "Expected evidence-based answer.", null, null, "Typical misconception recorded during moderation.", index > 2 ? "hard" : index === 2 ? "medium" : "easy", index < 2 ? "recall" : index === 2 ? "understanding" : "application", marks, 0.9, "teacher_created", 1, ownerId, ownerId, new Date(), 1, "approved"])
      })
    }
    const year5FractionTopic = topicMap["Year 5|Mathematics"][2]
    const diagnosticSources = [
      ["Write one fraction equivalent to 1/2 and show how you know.", "2/4; equivalent scaling shown", "easy", "understanding"],
      ["Complete the statement: 3/5 = __/10.", "6/10", "easy", "application"],
      ["Which is greater, 4/6 or 3/6? Explain using a common denominator.", "4/6 is greater", "medium", "application"],
      ["Simplify 12/18 and describe the common factor used.", "2/3; divide by 6", "medium", "analysis"],
      ["A learner says 2/3 and 4/5 are equivalent because both increase by two. Identify and correct the misconception.", "They are not equivalent; cross-products differ", "hard", "analysis"],
      ["Use multiplication to generate two equivalent representations of 3/4.", "For example 6/8 and 9/12", "medium", "application"],
    ]
    for (const [wording, answer, difficulty, skill] of diagnosticSources) questionBankRows.push([randomUUID(), schoolId, curriculum.id, null, subjectIds.Mathematics, year5FractionTopic.id, "structured", wording, null, answer, null, "Award credit for an equivalent correct method and representation.", "Confuses additive and multiplicative equivalence.", difficulty, skill, 4, 0.95, "teacher_created", 1, ownerId, ownerId, new Date(), 1, "approved"])
    await insertMany("assessment_questions", ["school_id", "assessment_id", "question_number", "display_number", "question_text", "question_type", "marks", "topic_id", "topic_text", "subtopic_id", "subtopic_text", "difficulty", "cognitive_skill", "question_instructions", "attachment_url", "correct_answer", "marking_scheme", "explanation", "sort_order", "created_at", "updated_at"], assessmentQuestionRows)
    await insertMany("question_bank", ["public_ref", "school_id", "curriculum_id", "grade_id", "subject_id", "topic_id", "question_type", "question_text", "options_json", "correct_answer", "accepted_answers_json", "explanation", "common_mistake", "difficulty", "skill_type", "marks", "confidence", "source_type", "is_daily_drill_eligible", "created_by", "approved_by", "approved_at", "version_number", "approval_status"], questionBankRows)
    // New operational evidence remains deliberately mixed. Detailed papers
    // receive explicit curriculum allocations, except Year 4 Science, whose
    // unmapped paper demonstrates that totals must not produce a topic claim.
    await q(`INSERT INTO question_topic_mappings (public_ref,school_id,assessment_question_id,topic_id,allocation_type,allocated_marks,allocated_percentage,is_primary,created_by,updated_by)
      SELECT UUID(),aq.school_id,aq.id,aq.topic_id,'marks',aq.marks,100,1,a.created_by,a.created_by
      FROM assessment_questions aq JOIN assessments a ON a.id=aq.assessment_id AND a.school_id=aq.school_id
      JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id
      WHERE aq.school_id=? AND aq.topic_id IS NOT NULL AND NOT (c.name LIKE 'Year 4%' AND s.name='Science')`, [schoolId])
    await q(`INSERT INTO question_objective_mappings (public_ref,school_id,assessment_question_id,learning_objective_id,mapping_role,created_by,updated_by)
      SELECT UUID(),aq.school_id,aq.id,MIN(lo.id),'primary',a.created_by,a.created_by
      FROM assessment_questions aq JOIN assessments a ON a.id=aq.assessment_id AND a.school_id=aq.school_id
      JOIN question_topic_mappings qtm ON qtm.assessment_question_id=aq.id AND qtm.school_id=aq.school_id
      JOIN learning_objectives lo ON lo.topic_id=qtm.topic_id AND lo.school_id=qtm.school_id
      WHERE aq.school_id=? GROUP BY aq.id,aq.school_id,a.created_by`, [schoolId])
    await q(`UPDATE assessment_questions aq SET aq.mapping_status=IF(EXISTS(SELECT 1 FROM question_topic_mappings qtm WHERE qtm.school_id=aq.school_id AND qtm.assessment_question_id=aq.id),'mapped','unmapped') WHERE aq.school_id=?`, [schoolId])
    await q(`INSERT INTO question_source_permissions (public_ref,school_id,question_bank_id,permission_status,reuse_allowed,transformation_allowed,reviewed_by,reviewed_at,created_by,updated_by)
      SELECT UUID(),qb.school_id,qb.id,'teacher_authored',1,1,?,CURRENT_TIMESTAMP,?,? FROM question_bank qb WHERE qb.school_id=?`, [ownerId, ownerId, ownerId, schoolId])

    const batchRows = []
    for (const meta of assessmentMeta) {
      const assessment = assessmentByTitle[meta.title]
      if (!assessment || meta.status !== "approved") continue
      batchRows.push([randomUUID(), schoolId, assessment.exam_session_id, assessment.id, yearId, assessment.term_id, assessment.class_id, null, assessment.subject_id, assessment.teacher_id, "approved", new Date(), assessment.teacher_id, new Date(), ownerId])
    }
    await insertMany("result_batches", ["public_ref", "school_id", "exam_session_id", "assessment_id", "academic_year_id", "term_id", "class_id", "stream_section", "subject_id", "teacher_id", "status", "submitted_at", "submitted_by", "approved_at", "approved_by"], batchRows)
    const batches = await q("SELECT id,assessment_id,class_id,subject_id,term_id,exam_session_id FROM result_batches WHERE school_id=?", [schoolId])
    const batchByAssessment = Object.fromEntries(batches.map((row) => [row.assessment_id, row]))
    const enrollmentLookupRows = await q("SELECT id,student_id,term_id,stream_section FROM student_enrollments WHERE school_id=? AND academic_year_id=?", [schoolId, yearId])
    const enrollmentByStudentTerm = Object.fromEntries(enrollmentLookupRows.map((row) => [`${row.student_id}:${row.term_id}`, row]))
    const resultRows = []
    for (const batch of batches) {
      const assessment = assessmentDb.find((row) => row.id === batch.assessment_id)
      const meta = assessmentMeta.find((entry) => entry.title === assessment.name)
      const className = meta.className
      const classStudents = studentMeta.filter((entry) => entry.classId === batch.class_id && entry.status !== "withdrawn")
      for (const studentMetaRow of classStudents) {
        const student = studentByAdmission[studentMetaRow.admission]
        const isAbsent = studentMetaRow.special === "exam_absent" && assessment.name.includes("Year 5") && assessment.name.includes("Mathematics") && assessment.term_id === term2Id
        let score = null
        if (!isAbsent) {
          const gradeNumber = Number(studentMetaRow.grade.split(" ")[1] || 0)
          let base = 64
          if (className.startsWith("Year 5") && assessment.subject_id === subjectIds.Mathematics) base = assessment.term_id === term1Id ? 58 : 54
          if (className.startsWith("Year 3") && assessment.subject_id === subjectIds.English) base = assessment.term_id === term1Id ? 61 : 72
          if (className === "Year 4 Blue" && assessment.subject_id === subjectIds.Science) base = 66
          if (className === "Year 6" && assessment.subject_id === subjectIds["General Science"]) base = assessment.name.includes("Practical") ? 82 : 56
          if (className === "Year 7" && assessment.subject_id === subjectIds.Mathematics) base = 64
          if (studentMetaRow.special === "improving") base += assessment.term_id === term2Id ? 12 : 0
          if (studentMetaRow.special === "declining") base -= assessment.term_id === term2Id ? 12 : 0
          if (studentMetaRow.special === "high_performer") base += 18
          if (studentMetaRow.special === "incomplete") base = assessment.term_id === term2Id ? null : base
          if (base !== null) {
            const percentage = stableScore(studentMetaRow.number + assessment.id, Math.max(25, base - 13), Math.min(98, base + 13))
            score = Number((percentage / 100 * Number(assessment.total_marks || 100)).toFixed(2))
          }
        }
        const status = isAbsent ? "absent" : score === null ? "approved" : "approved"
        const percentageScore = score === null ? null : Number(score) / Math.max(1, Number(assessment.total_marks || 100)) * 100
        resultRows.push([schoolId, batch.id, student.id, enrollmentByStudentTerm[`${student.id}:${batch.term_id}`]?.id || null, score, gradeFor(percentageScore), isAbsent ? "Absent during the examination session." : score === null ? "Incomplete evidence; not treated as zero." : "Connected assessment evidence.", status, new Date()])
      }
    }
    await insertMany("result_entries", ["school_id", "result_batch_id", "student_id", "enrollment_id", "score", "grade", "comment", "status", "last_saved_at"], resultRows, 250)

    const detailedQuestionRows = await q("SELECT aq.id,aq.assessment_id,aq.marks,aq.topic_id,a.subject_id FROM assessment_questions aq JOIN assessments a ON a.id=aq.assessment_id WHERE aq.school_id=? AND aq.assessment_id IN (?)", [schoolId, [...detailedAssessmentIds]])
    const questionBanks = await q("SELECT id,question_text,subject_id,topic_id,marks FROM question_bank WHERE school_id=? ORDER BY id", [schoolId])
    const questionAttempts = []
    for (const question of questionBanks) {
      const assessmentQuestion = detailedQuestionRows.find((row) => row.subject_id === question.subject_id && row.topic_id === question.topic_id && row.marks === question.marks)
      if (!assessmentQuestion) continue
      const assessment = assessmentDb.find((row) => row.id === assessmentQuestion.assessment_id)
      const classStudents = studentMeta.filter((entry) => entry.classId === assessment.class_id && entry.status !== "withdrawn")
      for (const meta of classStudents) {
        const student = studentByAdmission[meta.admission]
        const weak = (assessment.name.includes("Year 5") && assessment.name.includes("Mathematics") && question.topic_id === assessmentQuestion.topic_id && question.question_text.toLowerCase().includes("fraction")) || (assessment.name.includes("word problems") && meta.number % 3 === 0)
        const responseStatus = weak ? (meta.number % 4 === 0 ? "incorrect" : "partially_correct") : meta.number % 13 === 0 ? "incorrect" : "correct"
        const marks = responseStatus === "correct" ? question.marks : responseStatus === "partially_correct" ? Number((question.marks * 0.5).toFixed(2)) : 0
        questionAttempts.push([randomUUID(), schoolId, student.id, question.id, assessment.id, null, assessment.class_id, assessment.subject_id, question.topic_id, null, null, responseStatus === "correct" ? "Correct response" : responseStatus === "incorrect" ? "Misconception observed" : "Partial method shown", responseStatus, marks, question.marks, 60 + (meta.number % 90), "examination", new Date()])
      }
    }
    await insertMany("question_attempts", ["public_ref", "school_id", "student_id", "question_id", "assessment_id", "drill_session_id", "class_id", "subject_id", "topic_id", "subtopic_id", "learning_objective_id", "response_text", "response_status", "marks_awarded", "marks_available", "completion_seconds", "attempt_context", "attempted_at"], questionAttempts, 250)
    const questionTotals = await q("SELECT assessment_id,student_id,ROUND(SUM(marks_awarded),2) score FROM question_attempts WHERE school_id=? AND assessment_id IN (?) GROUP BY assessment_id,student_id", [schoolId, [...detailedAssessmentIds]])
    for (const total of questionTotals) {
      const batch = batchByAssessment[total.assessment_id]
      const assessment = assessmentDb.find((row) => row.id === total.assessment_id)
      if (batch && assessment) await q("UPDATE result_entries SET score=?,grade=? WHERE school_id=? AND result_batch_id=? AND student_id=? AND status='approved'", [total.score, gradeFor(Number(total.score) / Math.max(1, Number(assessment.total_marks || 100)) * 100), schoolId, batch.id, total.student_id])
    }

    const examTimetableRows = []
    const midSession = sessions["Term 2 Mid-Term Examinations 2026"]
    const approvedMid = assessmentDb.filter((assessment) => assessment.exam_session_id === midSession.id && assessment.status === "approved")
    approvedMid.forEach((assessment, index) => {
      const day = addDays("2026-07-20", Math.floor(index / 10))
      const afternoon = index % 2
      examTimetableRows.push([schoolId, midSession.id, assessment.id, yearId, term2Id, assessment.class_id, null, assessment.subject_id, day, afternoon ? "13:30:00" : "08:00:00", afternoon ? "14:45:00" : "10:00:00", 10, 0, 5, null, null, `Exam Room ${((index % 13) + 1)}`, null, teacherIds[index % teacherIds.length], "scheduled"])
    })
    await insertMany("exam_timetable_entries", ["school_id", "exam_session_id", "assessment_id", "academic_year_id", "term_id", "class_id", "stream_section", "subject_id", "exam_date", "start_time", "end_time", "setup_buffer_minutes", "reading_time_minutes", "collection_buffer_minutes", "source_availability_window", "override_id", "room", "facility_id", "invigilator_teacher_id", "status"], examTimetableRows)

    // Term 1 official results and report cards are built from approved result
    // entries, preserving the same totals used by the reporting controllers.
    const term1End = sessions["Term 1 End-of-Term Examinations 2026"]
    const term1Batches = batches.filter((batch) => batch.exam_session_id === term1End.id)
    const term1Students = studentMeta.filter((meta) => meta.status !== "withdrawn")
    const reportRows = []
    const termResultIds = {}
    for (const meta of term1Students) {
      const student = studentByAdmission[meta.admission]
      const enrollment = enrollmentByStudentTerm[`${student.id}:${term1Id}`]
      const entries = await q(`SELECT re.score,rb.subject_id,rb.assessment_id,rb.id result_batch_id,sr.name FROM result_entries re JOIN result_batches rb ON rb.id=re.result_batch_id JOIN subjects sr ON sr.id=rb.subject_id WHERE re.school_id=? AND re.student_id=? AND rb.exam_session_id=? AND re.status='approved'`, [schoolId, student.id, term1End.id])
      const scores = entries.filter((entry) => entry.score !== null).map((entry) => Number(entry.score))
      const average = scores.length ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1)) : 0
      const [termResult] = await connection.query(`INSERT INTO term_results (school_id,student_id,enrollment_id,academic_year_id,term_id,class_id,stream_section,total_score,average_score,grade,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [schoolId, student.id, enrollment?.id || null, yearId, term1Id, student.class_id, enrollment?.stream_section || null, Number(scores.reduce((sum, score) => sum + score, 0).toFixed(1)), average, gradeFor(average), "approved"])
      termResultIds[student.id] = termResult.insertId
      for (const entry of entries) await q(`INSERT INTO subject_results (school_id,term_result_id,subject_id,teacher_id,assessment_id,result_batch_id,score,grade,comment) VALUES (?,?,?,?,?,?,?,?,?)`, [schoolId, termResult.insertId, entry.subject_id, teacherIds[meta.number % teacherIds.length], entry.assessment_id, entry.result_batch_id, entry.score, gradeFor(Number(entry.score)), Number(entry.score) >= 70 ? "A confident term of learning." : "Continue targeted practice and ask for help early."])
      reportRows.push([schoolId, student.id, enrollment?.id || null, yearId, term1Id, term1End.id, termResult.insertId, "approved", ownerId])
    }
    await insertMany("report_cards", ["school_id", "student_id", "enrollment_id", "academic_year_id", "term_id", "exam_session_id", "term_result_id", "status", "generated_by"], reportRows)
    const term2Mid = sessions["Term 2 Mid-Term Examinations 2026"]
    const draftReportRows = []
    for (const meta of studentMeta.slice(0, 12)) {
      const student = studentByAdmission[meta.admission]
      const enrollment = enrollmentByStudentTerm[`${student.id}:${term2Id}`]
      const [termResult] = await connection.query(`INSERT INTO term_results (school_id,student_id,enrollment_id,academic_year_id,term_id,class_id,stream_section,total_score,average_score,grade,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [schoolId, student.id, enrollment?.id || null, yearId, term2Id, student.class_id, meta.stream || null, 0, 0, null, "draft"])
      draftReportRows.push([schoolId, student.id, enrollment?.id || null, yearId, term2Id, term2Mid.id, termResult.insertId, "generated", ownerId])
    }
    await insertMany("report_cards", ["school_id", "student_id", "enrollment_id", "academic_year_id", "term_id", "exam_session_id", "term_result_id", "status", "generated_by"], draftReportRows)

    const interventionRows = []
    const year5Math = classes["Year 5"]
    const year7Math = classes["Year 7"]
    const year3English = classes["Year 3 Blue"]
    const year5Fractions = topicMap["Year 5|Mathematics"][2]
    const year7Fractions = topicMap["Year 7|Mathematics"][2]
    interventionRows.push([randomUUID(), schoolId, null, year3English.id, subjectIds.English, topicMap["Year 3|English"][0].id, "small_group_support", "Reading comprehension needed targeted support in Term 1.", json({ term: "Term 1", baseline: 61, reassessment: 72, evidence: "published Term 1 results" }), teacherIds[4], "medium", "2026-02-02", "2026-04-03", "Guided reading three times weekly, followed by a short comprehension reassessment.", "sent", json({ outcome: "improved", reassessment_average: 72 }), "improved", "completed", ownerId, teacherIds[4], "2026-04-04"])
    interventionRows.push([randomUUID(), schoolId, null, year5Math.id, subjectIds.Mathematics, year5Fractions.id, "prerequisite_recovery", "Fractions and multi-step word problems remain below the mastery threshold.", json({ class_average: 54, students_affected: 10, question_level: true, prerequisite: "Multiplication and division strategies" }), teacherIds[8], "high", "2026-06-23", "2026-07-30", "Use fraction strips, worked examples and a 20-minute diagnostic before reassessment.", "pending", null, "pending", "active", coordinatorId, null, null])
    interventionRows.push([randomUUID(), schoolId, null, year7Math.id, subjectIds.Mathematics, year7Fractions.id, "small_group_support", "A small group has uneven mastery despite acceptable class coverage.", json({ students_affected: 7, class_average: 64 }), teacherIds[10], "medium", "2026-07-08", "2026-07-22", "Acknowledge the assignment, identify the seven learners, and schedule targeted practice.", "not_required", null, "pending", "draft", coordinatorId, null, null])
    const attendanceStudent = studentByAdmission[studentMeta.find((entry) => entry.special === "declining")?.admission]
    interventionRows.push([randomUUID(), schoolId, attendanceStudent.id, attendanceStudent.class_id, subjectIds.English, null, "attendance_intervention", "Irregular attendance is interrupting learning continuity.", json({ attendance_pattern: "Monday absences and late-term decline", academic_signal: "declining trend" }), teacherIds[12], "high", "2026-06-20", "2026-07-18", "Contact guardian, agree an attendance plan, and review attendance weekly.", "pending", null, "pending", "active", headteacherId, null, null])
    await insertMany("academic_interventions", ["public_ref", "school_id", "student_id", "class_id", "subject_id", "topic_id", "intervention_type", "issue", "evidence_json", "assigned_teacher_id", "priority", "start_date", "review_date", "action_plan", "parent_notification_status", "reassessment_summary_json", "outcome", "status", "created_by", "completed_by", "completed_at"], interventionRows)
    const interventions = await q("SELECT id,intervention_type,status FROM academic_interventions WHERE school_id=?", [schoolId])
    await insertMany("academic_intervention_updates", ["public_ref", "school_id", "intervention_id", "update_type", "note", "evidence_json", "created_by"], interventions.map((row) => [randomUUID(), schoolId, row.id, row.status === "completed" ? "reassessment" : "note", row.status === "completed" ? "Reassessment shows improved reading comprehension." : "Initial evidence and next action recorded for teacher follow-up.", json({ source: "greenfield_demo" }), coordinatorId]))

    // Timetable foundation: each class has its own classroom and class teacher,
    // so the generated published version has zero teacher/room hard conflicts.
    const roomRows = classRowsDb.map((row) => [schoolId, `GFA-${row.name.replace(/ /g, "-")}`, `${row.name} Classroom`, "ordinary_classroom", 36, 36, row.id, 1, ownerId])
    await insertMany("timetable_rooms", ["school_id", "code", "name", "room_type", "capacity", "exam_capacity", "home_class_id", "active", "created_by"], roomRows)
    const roomByClass = Object.fromEntries((await q("SELECT id,home_class_id FROM timetable_rooms WHERE school_id=?", [schoolId])).map((row) => [row.home_class_id, row.id]))
    const timetableRows = [
      [randomUUID(), schoolId, "SCHOOL_TIMETABLE", "Greenfield Term 1 Archived Timetable", yearId, term1Id, "NORMAL_WEEK", 1, "2026-01-05", "2026-04-10", "ARCHIVED", json({ source: DEMO_IDENTIFIER, archived: true }), ownerId],
      [randomUUID(), schoolId, "SCHOOL_TIMETABLE", "Greenfield Term 2 Published Timetable", yearId, term2Id, "NORMAL_WEEK", 1, "2026-04-20", "2026-08-07", "PUBLISHED", json({ source: DEMO_IDENTIFIER, classes: classRowsDb.length }), ownerId],
      [randomUUID(), schoolId, "SCHOOL_TIMETABLE", "Greenfield Term 3 Draft Timetable", yearId, term3Id, "NORMAL_WEEK", 1, "2026-09-01", "2026-12-04", "DRAFT", json({ source: DEMO_IDENTIFIER, draft: true }), ownerId],
    ]
    await insertMany("timetables", ["public_ref", "school_id", "timetable_type", "name", "academic_year_id", "term_id", "cycle_type", "timetable_cycle_weeks", "effective_from", "effective_to", "status", "setup_progress", "created_by"], timetableRows)
    const timetables = Object.fromEntries((await q("SELECT id,name,term_id FROM timetables WHERE school_id=?", [schoolId])).map((row) => [row.name, row]))
    const cycleRows = []
    for (const timetable of Object.values(timetables)) for (const [number, code, display, weekday] of [[1, "MON", "Monday", 1], [2, "TUE", "Tuesday", 2], [3, "WED", "Wednesday", 3], [4, "THU", "Thursday", 4], [5, "FRI", "Friday", 5]]) cycleRows.push([timetable.id, number, code, display, weekday, number, 1])
    await insertMany("timetable_cycle_days", ["timetable_id", "cycle_day_number", "code", "display_name", "weekday", "sort_order", "active"], cycleRows)
    const bellRows = Object.values(timetables).map((timetable) => [schoolId, timetable.id, `${timetable.name} Bell Schedule`, "Registration, lessons, break, lunch and clubs.", timetable.term_id === term2Id ? 1 : 0, 1, ownerId])
    await insertMany("bell_schedule_templates", ["school_id", "timetable_id", "name", "description", "is_default", "active", "created_by"], bellRows)
    const bells = await q("SELECT id,timetable_id FROM bell_schedule_templates WHERE school_id=?", [schoolId])
    const slotRows = []
    for (const bell of bells) slotRows.push([bell.id, 1, "REG", "Registration", "07:30:00", "07:45:00", "ASSEMBLY", 0, 0, 1], [bell.id, 2, "P1", "Period 1", "07:45:00", "08:45:00", "TEACHING_PERIOD", 1, 1, 2], [bell.id, 3, "P2", "Period 2", "08:45:00", "09:45:00", "TEACHING_PERIOD", 1, 1, 3], [bell.id, 4, "BREAK", "Morning break", "10:00:00", "10:25:00", "BREAK", 0, 0, 4], [bell.id, 5, "P3", "Period 3", "10:25:00", "11:25:00", "TEACHING_PERIOD", 1, 1, 5], [bell.id, 6, "P4", "Period 4", "11:25:00", "12:25:00", "TEACHING_PERIOD", 1, 1, 6], [bell.id, 7, "LUNCH", "Lunch", "12:25:00", "13:20:00", "LUNCH", 0, 0, 7], [bell.id, 8, "P5", "Period 5", "13:20:00", "14:20:00", "TEACHING_PERIOD", 1, 1, 8], [bell.id, 9, "P6", "Period 6", "14:20:00", "15:10:00", "TEACHING_PERIOD", 1, 1, 9], [bell.id, 10, "CLOSE", "Closing and clubs", "15:10:00", "15:30:00", "CLUB", 0, 0, 10])
    await insertMany("bell_schedule_slots", ["template_id", "slot_number", "code", "display_name", "start_time", "end_time", "slot_type", "teaching_allowed", "can_span", "sort_order"], slotRows)
    const cycleDays = await q("SELECT id,timetable_id,cycle_day_number FROM timetable_cycle_days WHERE timetable_id IN (?)", [Object.values(timetables).map((row) => row.id)])
    const dayTemplates = bells.flatMap((bell) => cycleDays.filter((day) => day.timetable_id === bell.timetable_id).map((day) => [bell.timetable_id, day.id, bell.id]))
    await insertMany("timetable_day_templates", ["timetable_id", "cycle_day_id", "bell_template_id"], dayTemplates)
    const term2Timetable = timetables["Greenfield Term 2 Published Timetable"]
    const term2VersionResult = await connection.query(`INSERT INTO timetable_versions (public_ref,timetable_id,version_number,status,creation_method,generation_strategy,solver_status,hard_conflict_count,soft_penalty_score,change_summary,publication_notes,approved_by,approved_at,published_by,published_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [randomUUID(), term2Timetable.id, 1, "PUBLISHED", "MANUAL", "TEACHER_FRIENDLY", "FEASIBLE", 0, 12, "Validated deterministic demonstration timetable.", "Published for all Greenfield classes.", ownerId, new Date(), ownerId, new Date(), ownerId])
    const term2VersionId = term2VersionResult[0].insertId
    for (const timetable of [timetables["Greenfield Term 1 Archived Timetable"], timetables["Greenfield Term 3 Draft Timetable"]]) await q(`INSERT INTO timetable_versions (public_ref,timetable_id,version_number,status,creation_method,hard_conflict_count,soft_penalty_score,created_by) VALUES (?,?,?,?,?,?,?,?)`, [randomUUID(), timetable.id, 1, timetable.term_id === term3Id ? "DRAFT" : "ARCHIVED", "MANUAL", 0, 0, ownerId])
    const term2Days = cycleDays.filter((day) => day.timetable_id === term2Timetable.id)
    const term2Bell = bells.find((bell) => bell.timetable_id === term2Timetable.id)
    const term2Slots = await q("SELECT id,slot_number FROM bell_schedule_slots WHERE template_id=? AND teaching_allowed=1 ORDER BY slot_number", [term2Bell.id])
    const timetableEntries = []
    for (const row of classRowsDb) {
      const spec = classSpecs.find((entry) => entry[0] === row.name)
      const subjects = classSubjects(spec[1])
      term2Days.forEach((day) => term2Slots.forEach((slot, slotIndex) => {
        const subject = subjects[(day.cycle_day_number + slotIndex) % subjects.length]
        timetableEntries.push([term2VersionId, day.id, slot.id, slot.id, "LESSON", subjectIds[subject], row.id, null, row.teacher_user_id, roomByClass[row.id], `${row.name} · ${subject}`, 0, 0, ownerId, ownerId])
      }))
    }
    await insertMany("timetable_entries", ["timetable_version_id", "cycle_day_id", "slot_start_id", "slot_end_id", "entry_type", "subject_id", "class_id", "stream_section", "teacher_id", "room_id", "title", "locked", "manually_modified", "created_by", "updated_by"], timetableEntries)
    await q("UPDATE timetables SET current_published_version_id=?,status='PUBLISHED' WHERE id=?", [term2VersionId, term2Timetable.id])
    await q("INSERT INTO timetable_publications (school_id,timetable_id,timetable_version_id,publication_status,audience_scope,snapshot,published_by) VALUES (?,?,?,?,?,?,?)", [schoolId, term2Timetable.id, term2VersionId, "ACTIVE", json({ roles: ["teacher", "headteacher", "school_owner", "parent", "student"] }), json({ source: DEMO_IDENTIFIER, hard_conflicts: 0, classes: classRowsDb.length }), ownerId])
    const constraints = [
      [schoolId, term2Timetable.id, term2VersionId, "SCHOOL_TIMETABLE", "NO_TEACHER_OVERLAP", "STAFFING", "HARD", 1000, 1, "SCHOOL", null, json({}), ownerId],
      [schoolId, term2Timetable.id, term2VersionId, "SCHOOL_TIMETABLE", "NO_ROOM_OVERLAP", "ROOMS", "HARD", 1000, 1, "SCHOOL", null, json({}), ownerId],
      [schoolId, term2Timetable.id, term2VersionId, "SCHOOL_TIMETABLE", "MATHS_MORNING_PREFERENCE", "PEDAGOGY", "SOFT", 20, 1, "SCHOOL", null, json({ preferred_slots: [2, 3, 5, 6] }), ownerId],
      [schoolId, term2Timetable.id, term2VersionId, "SCHOOL_TIMETABLE", "FRIDAY_CLUBS", "ACTIVITIES", "SOFT", 10, 1, "SCHOOL", null, json({ weekday: 5 }), ownerId],
    ]
    await insertMany("timetable_constraints", ["school_id", "timetable_id", "timetable_version_id", "timetable_type", "constraint_code", "constraint_category", "severity", "weight", "enabled", "scope_type", "scope_reference_id", "configuration", "created_by"], constraints)

    await connection.commit()
    return { schoolId, ownerId, headteacherId, coordinatorId, examOfficerId, bursarId, teacherIds, assessmentCount: assessmentRows.length, studentCount: students.length, classCount: classRowsDb.length, timetableEntryCount: timetableEntries.length, password: DEMO_PASSWORD }
  } catch (error) {
    await connection.rollback()
    throw error
  }
}

const result = await seed()
console.log(JSON.stringify(result.resetOnly
  ? { ok: true, demo_identifier: DEMO_IDENTIFIER, reset_only: true, school_id: result.schoolId }
  : { ok: true, demo_identifier: DEMO_IDENTIFIER, school_id: result.schoolId, classes: result.classCount, students: result.studentCount, assessments: result.assessmentCount, timetable_entries: result.timetableEntryCount, login_password: result.password }, null, 2))
await connection.end()
