# Syllabus Upload Flow

The Syllabus Intelligence module is designed around teacher approval.

## Staff Workflow

1. Open `Syllabus Intelligence`.
2. Upload a syllabus or scheme file from the Uploads tab.
3. The server stores the file metadata, extracts text, and saves document chunks.
4. Gemini 2.5 Flash extracts draft curriculum items from chunks.
5. Review extracted topics, subtopics, objectives, warnings, and low-confidence items.
6. Approve clean items, reject bad items, or merge duplicates.
7. Approved topics appear in the Topic Map.
8. Teachers can create approved questions manually or generate AI drafts from approved topic context.
9. Draft questions must be approved before students receive them in Daily Drills.

## Supported Upload Types

The API accepts `txt`, `csv`, `pdf`, `docx`, and `xlsx` metadata/uploads through the JSON/base64 upload endpoint. Text and CSV are extracted directly. Binary formats are stored and given a conservative best-effort text pass until a deeper parser is added.

## Safety Rules

- Extracted syllabus items default to `pending_review`.
- Low-confidence AI output is not trusted automatically.
- Question generation retrieves only relevant approved syllabus/topic chunks.
- Approved drill questions require a subject, grade, topic, correct answer, and explanation.
- Students only receive approved questions.
- Students do not see correct answers, marks, or explanations until a drill is submitted.
- This is RAG plus teacher approval, not model training or fine-tuning.

## Key Endpoints

```text
GET  /api/syllabus/setup
POST /api/syllabus/uploads
POST /api/syllabus/uploads/:id/process
GET  /api/syllabus/uploads/:id/review
POST /api/syllabus/extracted-items/:id/approve
POST /api/syllabus/extracted-items/:id/reject
POST /api/syllabus/extracted-items/:id/merge
GET  /api/syllabus/topics
POST /api/questions/generate-draft
POST /api/questions/:id/approve
GET  /api/ai/status
POST /api/ai/test
GET  /api/ai/usage-summary
```
