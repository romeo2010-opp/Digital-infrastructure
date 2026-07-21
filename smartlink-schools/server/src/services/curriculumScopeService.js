import { HttpError } from "../utils/http.js"

function scopedId(value) {
  const id = Number(value || 0)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * Resolves topic identifiers through the tenant and subject boundary before they
 * are written to tables whose legacy foreign keys only reference a global id.
 */
export async function validateSyllabusTopicScope(db, {
  schoolId,
  subjectId,
  topicId = null,
  subtopicId = null,
  requireTopic = false,
  activeOnly = true,
} = {}) {
  const supplied = (value) => value !== null && value !== undefined && value !== "" && value !== 0 && value !== "0"
  const school = scopedId(schoolId)
  const subject = scopedId(subjectId)
  const topic = scopedId(topicId)
  const subtopic = scopedId(subtopicId)
  if (!school || !subject) throw new HttpError(400, "Select a valid school subject.")
  if (supplied(topicId) && !topic) throw new HttpError(400, "Select a valid syllabus topic.")
  if (supplied(subtopicId) && !subtopic) throw new HttpError(400, "Select a valid syllabus subtopic.")
  if (requireTopic && !topic) throw new HttpError(400, "Select a valid syllabus topic.")
  if (subtopic && !topic) throw new HttpError(400, "Select a main topic before selecting a subtopic.")
  if (!topic && !subtopic) return { topicId: null, subtopicId: null, topic: null, subtopic: null }

  const ids = [...new Set([topic, subtopic].filter(Boolean))]
  const [rows] = await db.query(
    `SELECT id,school_id,subject_id,curriculum_id,grade_id,parent_topic_id,topic_name,is_active
     FROM syllabus_topics
     WHERE school_id=? AND subject_id=? AND id IN (${ids.map(() => "?").join(",")})${activeOnly ? " AND is_active=1" : ""}`,
    [school, subject, ...ids],
  )
  const byId = new Map(rows.map((row) => [Number(row.id), row]))
  const topicRow = topic ? byId.get(topic) : null
  const subtopicRow = subtopic ? byId.get(subtopic) : null
  if (topic && !topicRow) throw new HttpError(400, "The selected topic does not belong to this school and subject.")
  if (subtopic && !subtopicRow) throw new HttpError(400, "The selected subtopic does not belong to this school and subject.")
  if (topicRow && subtopicRow && Number(subtopicRow.parent_topic_id) !== Number(topicRow.id)) {
    throw new HttpError(400, "The selected subtopic does not belong to the selected main topic.")
  }
  if (topicRow && subtopicRow) {
    const sameCurriculum = !topicRow.curriculum_id || !subtopicRow.curriculum_id
      || Number(topicRow.curriculum_id) === Number(subtopicRow.curriculum_id)
    const sameGrade = !topicRow.grade_id || !subtopicRow.grade_id
      || Number(topicRow.grade_id) === Number(subtopicRow.grade_id)
    if (!sameCurriculum || !sameGrade) {
      throw new HttpError(400, "The selected subtopic does not share the main topic's curriculum and year level.")
    }
  }
  return { topicId: topic, subtopicId: subtopic, topic: topicRow || null, subtopic: subtopicRow || null }
}
