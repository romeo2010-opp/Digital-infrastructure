# SmartLink Schools

SmartLink Schools is a separate MVP from the existing fuel platform. It is a multi-school SaaS prototype with a React/Vite frontend, an Express API, MySQL schema, RBAC middleware, and tenant-scoped queries using `school_id`.

## Structure

- `client/` React + Vite school portal UI
- `server/` Express REST API
- `server/database/schema.sql` MySQL schema
- `server/database/seed.sql` Greenhill Primary School demo data

## Run

```bash
cd smartlink-schools/client
npm install
npm run dev
```

```bash
cd smartlink-schools/server
cp .env.example .env
npm install
npm run dev
```

To load the database:

```bash
mysql -u root -p < server/database/schema.sql
mysql -u root -p < server/database/seed.sql
```

Apply the Daily Drills + Syllabus Intelligence migrations:

```bash
cd smartlink-schools/server
node database/apply-daily-drills-migration.mjs
```

## Gemini AI Pilot

The Daily Drills + Syllabus Intelligence pilot uses Google Gemini only:

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

Store `GEMINI_API_KEY` in `server/.env` locally and as a server-side environment variable in production. Never expose it in the client. If the key is missing, the app still runs and AI features report that upload, review, and manual approval are available.

See `docs/ai-setup.md` for Google AI Studio setup, key safety, billing alerts, usage logs, and the RAG plus teacher-approval flow.

## Tenant Safety

Every school-owned table includes `school_id`. API controllers derive the active `school_id` from the JWT session through `getScopedSchoolId(req)` and include it in all school data queries. Non-super-admin users cannot request another school's records; `super_admin` must explicitly pass a `school_id` for scoped requests.

## Demo Roles

The API supports demo role login when `DEMO_LOGIN_ENABLED=true`:

- `super_admin`
- `school_owner`
- `headteacher`
- `bursar`
- `teacher`
- `parent`
- `student`

The client currently starts on the dashboard so the visual design can be reviewed immediately.
