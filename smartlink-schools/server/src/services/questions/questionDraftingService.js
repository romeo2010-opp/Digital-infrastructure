import { generateQuestionDrafts } from "../ai/aiClient.js"

const questionSchemaHint = `Expected JSON: {"questions":[{"question_text":"","question_type":"structured","options_json":[],"correct_answer":"","accepted_answers_json":[],"explanation":"","common_mistake":"","difficulty":"easy","skill_type":"explain","marks":2,"confidence":0.8}]}`

const questionResponseSchema = {
  type: "OBJECT",
  properties: {
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          question_text: { type: "STRING" },
          question_type: { type: "STRING", enum: ["multiple_choice", "true_false", "short_answer", "structured", "essay"] },
          options_json: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                label: { type: "STRING" },
                text: { type: "STRING" },
              },
              required: ["label", "text"],
            },
          },
          correct_answer: { type: "STRING" },
          accepted_answers_json: { type: "ARRAY", items: { type: "STRING" } },
          explanation: { type: "STRING" },
          common_mistake: { type: "STRING" },
          difficulty: { type: "STRING", enum: ["easy", "medium", "hard"] },
          skill_type: { type: "STRING" },
          marks: { type: "INTEGER" },
          confidence: { type: "NUMBER" },
        },
        required: ["question_text", "question_type", "options_json", "correct_answer", "accepted_answers_json", "explanation", "common_mistake", "difficulty", "skill_type", "marks", "confidence"],
      },
    },
  },
  required: ["questions"],
}

function validateQuestionPayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Question output must be an object")
  if (!Array.isArray(payload.questions)) throw new Error("Question output must include questions")
  payload.questions.forEach((question) => {
    if (!question.question_text) throw new Error("Every question needs question_text")
    if (!question.correct_answer) throw new Error("Every question needs correct_answer")
    if (!question.explanation) throw new Error("Every question needs explanation")
  })
}

function fallbackQuestions(context = {}) {
  const count = Math.max(1, Math.min(10, Number(context.numberOfQuestions || 3)))
  return {
    questions: Array.from({ length: count }, (_, index) => ({
      question_text: `Review question ${index + 1}: explain one key idea from ${context.topicName || "this topic"}.`,
      question_type: context.questionType || "short_answer",
      options_json: [],
      correct_answer: context.topicName || "teacher-approved answer",
      accepted_answers_json: [context.topicName || "teacher-approved answer"],
      explanation: "This draft must be checked by a teacher before students can use it.",
      common_mistake: "Leaving the answer unsupported.",
      difficulty: context.difficulty || "easy",
      skill_type: "recall",
      marks: 1,
      confidence: 0.3,
    })),
  }
}

function normalizeOptions(question) {
  if (Array.isArray(question.options_json)) return question.options_json
  if (Array.isArray(question.options)) return question.options
  return []
}

function normalizeAcceptedAnswers(question) {
  if (Array.isArray(question.accepted_answers_json)) return question.accepted_answers_json.map(String)
  if (Array.isArray(question.accepted_answers)) return question.accepted_answers.map(String)
  return []
}

export async function generateDraftQuestions(context = {}) {
  const fallback = fallbackQuestions(context)
  const requestedType = String(context.questionType || "mixed")
  const prompt = `Generate original syllabus-aligned practice questions for SmartLink Daily Drills. Do not copy copyrighted, uploaded, or real assessment questions.

Approved syllabus context:
${JSON.stringify(context.approvedSyllabusContext || [], null, 2)}

Recent school assessment question history for style and coverage only. Do not copy these questions:
${JSON.stringify(context.assessmentQuestionHistory || [], null, 2)}

Teacher-created manual question examples for house style only. These show how teachers at this school type Daily Drill questions, answers, explanations, marks, and common mistakes. Do not copy these questions:
${JSON.stringify(context.teacherQuestionStyleExamples || [], null, 2)}

Generation request:
${JSON.stringify({
  curriculum: context.curriculum,
  grade: context.gradeName,
  subject: context.subjectName,
  topic: context.topicName,
  subtopic: context.subtopicName,
  difficulty: context.difficulty,
  question_type: requestedType,
  number_of_questions: context.numberOfQuestions,
  exam_track: context.examTrack || "",
  language_level: context.languageLevel || "",
  include_explanations: context.includeExplanations !== false,
}, null, 2)}

Rules:
- First look at approved_success_criteria. Every generated question must clearly target one or more success criteria.
- If success criteria contain action tags such as define, list, explain, identify, compare, calculate, analyse, or evaluate, make the question demand that action.
- If a success criterion says something like "Define, List, Explain, Identify main factors of agricultural production", generate questions about those factors and close variants of the same concept.
- Use the assessment history only to understand the style, mark values, and repeated emphasis. Never copy an assessment question.
- Use teacher-created manual examples to match the school's house style: phrasing, question length, mark depth, answer/rubric shape, explanation tone, and common-mistake format. Never copy a manual question.
- If teacher manual examples conflict with approved syllabus success criteria, follow the approved success criteria.
- Use only the approved syllabus context, success criteria, and topic metadata as the source of truth.
- Keep wording age/grade appropriate.
- Include explanations, common mistakes, marks, skill type, and confidence.
- For multiple_choice, provide 3-4 options. For short_answer, structured, and essay, leave options_json empty and make correct_answer a careful marking guide/rubric.
- If question_type is "mixed", create a balanced mix of multiple_choice, short_answer, and structured questions. Include at least one structured question when generating three or more questions.
- Save-ready drafts must still require teacher approval before Daily Drills.
- Return JSON only.`

  const result = await generateQuestionDrafts({
    prompt,
    schemaHint: questionSchemaHint,
    responseSchema: questionResponseSchema,
    validate: validateQuestionPayload,
    fallback,
    schoolId: context.schoolId || null,
    userId: context.userId || null,
  })
  const payload = result.data || fallback
  const questions = (Array.isArray(payload.questions) ? payload.questions : []).map((question) => ({
    question_text: String(question.question_text || "").trim(),
    question_type: ["multiple_choice", "true_false", "short_answer", "structured", "essay"].includes(String(question.question_type))
      ? String(question.question_type)
      : requestedType === "mixed" ? "structured" : context.questionType || "short_answer",
    options: normalizeOptions(question),
    correct_answer: String(question.correct_answer || "").trim(),
    accepted_answers: normalizeAcceptedAnswers(question),
    explanation: String(question.explanation || "").trim(),
    common_mistake: String(question.common_mistake || "").trim(),
    difficulty: ["easy", "medium", "hard"].includes(String(question.difficulty)) ? String(question.difficulty) : context.difficulty || "easy",
    skill_type: String(question.skill_type || "recall"),
    marks: Math.max(1, Number(question.marks || 1)),
    confidence: Math.max(0, Math.min(1, Number(question.confidence || 0.5))),
  })).filter((question) => question.question_text && question.correct_answer && question.explanation)

  return { ...result, data: { questions } }
}
