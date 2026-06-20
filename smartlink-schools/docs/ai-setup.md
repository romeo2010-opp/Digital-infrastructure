# AI Setup

SmartLink Schools uses Google Gemini for the Daily Drills + Syllabus Intelligence pilot. The pilot provider is Gemini only, with model `gemini-2.5-flash`. There is no Ollama, local model, Groq, OpenAI, model training, or fine-tuning requirement.

If Gemini is not configured, the app still runs and should show:

```text
AI assistance is not configured yet. Upload, review, and manual approval features are still available.
```

## Environment

Add these values to `server/.env`:

```env
AI_ENABLED=true
AI_PROVIDER=gemini
AI_MODEL=gemini-2.5-flash
GEMINI_API_KEY=
AI_TIMEOUT_MS=60000
AI_MAX_RETRIES=1
AI_LOG_RAW_RESPONSES=true
AI_REQUIRE_TEACHER_APPROVAL=true
```

Create a Gemini API key in Google AI Studio:

1. Visit `https://aistudio.google.com/apikey`.
2. Create or select a Google Cloud project.
3. Create an API key.
4. Put the key only in `server/.env` for local development.
5. In production, store `GEMINI_API_KEY` as a server environment variable or secret.

Never put `GEMINI_API_KEY` in frontend JavaScript, HTML, public config files, committed source files, browser localStorage, or browser sessionStorage.

## Testing

Start the server and call:

```bash
GET /api/ai/status
POST /api/ai/test
GET /api/ai/usage-summary
PATCH /api/ai/settings
```

`/api/ai/status` reports provider, model, configured state, and last test status. It never returns the API key. `/api/ai/test` makes a tiny Gemini request. `/api/ai/usage-summary` shows requests today, requests this month, token totals, estimated cost, and top AI features.

You can also run:

```bash
cd server
node scripts/setup-ai.js
```

The script only checks Gemini environment settings; it does not install or pull local models.

## Pilot Flow

The AI architecture is RAG plus teacher approval:

1. A school uploads a syllabus, scheme of work, teacher notes, exam outline, or curriculum document.
2. The server extracts text and stores safe document chunks with upload metadata.
3. Gemini extracts structured syllabus data from chunks.
4. Extracted items are saved as `pending_review`.
5. A teacher or admin reviews, edits, approves, rejects, or merges extracted items.
6. Question generation retrieves only relevant approved topic context and chunks.
7. Gemini-generated questions are saved as `pending_review`.
8. Daily Drills use only approved questions with approved answers and explanations.
9. Student explanation help uses Gemini only on demand and is grounded in the approved question, correct answer, and explanation.

## Safety And Cost

Set `AI_ENABLED=false` to disable AI safely. Existing approved Daily Drills continue working from the approved question bank.

School-level AI settings support:

- `ai_enabled`
- `ai_monthly_budget_usd`
- `ai_daily_request_limit`

Owners and headteachers can update these with `PATCH /api/ai/settings`.

When a school exceeds its configured limits, AI generation is blocked with:

```text
AI limit reached for this school. Existing approved drills still work.
```

Set Google Cloud billing alerts before production use. Restrict the API key where possible, and rotate it immediately if it is leaked. To rotate a leaked key, revoke/delete the old key in Google AI Studio or Google Cloud, create a new key, update `GEMINI_API_KEY` on the server, restart the server, and audit recent usage.
