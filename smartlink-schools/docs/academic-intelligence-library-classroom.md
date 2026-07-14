# SmartLink Academic Intelligence, Library and Classroom Mode

## Architecture

This implementation extends the existing SmartLink Schools academic domain. It does not create a second syllabus, assessment, attendance, lesson-log, notification, audit or term archive system.

The Academic Intelligence Engine is implemented in `server/src/services/academicIntelligenceEngine.js`. It consumes existing syllabus topics, learning objectives, lesson logs, Daily Drill answers, result batches, attendance, the academic calendar and timetable data. Pages consume shared outputs instead of implementing separate scoring rules.

The librarian, institutional resources, archive, printing and Classroom Mode workflows are implemented in `server/src/services/libraryClassroomService.js`. Classroom Mode creates and finalises the existing `teacher_lesson_logs` records and writes to the existing `attendance_records` table.

## Existing components reused

- JWT authentication and the existing school-scoped session.
- `user_permissions` overrides and the owner permission editor.
- `syllabus_topics`, `learning_objectives` and topic prerequisites.
- `question_bank`, assessment questions and result batches.
- Daily Drill generation and question marking.
- `teacher_lesson_logs` and their topic/objective/student child records.
- `attendance_records`.
- Academic years, terms, school calendar, bell schedules and published timetables.
- Notifications and the existing WebSocket user-event channel.
- `audit_logs` and lesson-log audit events.
- Term close/archive actions and historical report records.
- Existing upload directories and server-side PDF/file tooling.

## Migrations

- `046_academic_intelligence_library_classroom.sql`
  - adds the `librarian` role;
  - extends objectives and question metadata;
  - adds curriculum delivery lifecycle, mastery evidence/records, recommendations, interventions, alerts, pacing/readiness snapshots and calculation runs;
  - adds teaching resources and immutable versions, physical catalogue/copies/loans, print requests, library computers and institutional archive records;
  - adds Classroom Mode extensions linked one-to-one to lesson logs;
  - backfills existing topic mastery as low-confidence topic evidence.
- `047_academic_evidence_blueprints_remediation.sql`
  - adds question attempts, class mastery snapshots, assessment blueprints, remediation packs, teacher resource requests and archive correction requests.
- `048_academic_idempotency.sql`
  - adds stable mastery scope keys and Daily Drill uniqueness constraints so retries do not duplicate evidence.
- `049_academic_migration_reports.sql`
  - records school-scoped migrated, partially migrated, skipped and manual-review counts for legacy academic evidence;
  - documents that the legacy backfill did not infer objective mastery or fabricate precision.
- `050_syllabus_topic_public_references.sql`
  - backfills UUID references for legacy syllabus topics so teacher-facing topic selection never depends on numeric database IDs.
- `051_parent_academic_insights.sql`
  - links guardian accounts to students with tenant-scoped UUID references;
  - adds a draft, approval, publication and withdrawal lifecycle for parent-safe academic updates;
  - keeps the evidence summary internal while publishing only plain-language strengths, focus areas, attendance context and home support.

Historical records are preserved. Final percentages are imported only as limited subject evidence. The migration does not infer question, topic or learning-objective mastery from a final mark.

## Curriculum lifecycle

Delivery supports:

`NOT_STARTED`, `PLANNED`, `IN_PROGRESS`, `TAUGHT`, `ASSESSED`, `PARTIALLY_MASTERED`, `MASTERED`, `REQUIRES_REVISION`, `DELAYED`, `SKIPPED`.

Finalising a lesson maps delivery to `IN_PROGRESS`, `TAUGHT`, `ASSESSED` or `REQUIRES_REVISION`. It never maps a teacher observation to `MASTERED`. A manual mastery override requires an authorised user and a reason when assessment evidence is insufficient.

## Mastery calculation

Mastery is a weighted evidence score:

`recency × marks × difficulty × assessment type × independence`.

The result stores:

- mastery score;
- confidence score;
- evidence count;
- evidence granularity;
- trend;
- last evidence time;
- formula components and thresholds used;
- missing-evidence warnings.

Confidence grows with evidence breadth, recency and objective-level mapping. No evidence returns `NOT_ASSESSED`; too little evidence returns `INSUFFICIENT_EVIDENCE`. These are deliberately different from low mastery.

School configuration controls thresholds, minimum evidence, recency half-life, intervention rules and assessment weights.

## Question intelligence

Daily Drill responses are stored as idempotent `question_attempts`. The engine calculates total/correct/partial/incorrect/omitted attempts, success rate, measured difficulty and confidence. Extreme success/failure rates are only flagged after the minimum sample size. The original estimated difficulty remains separate.

## Curriculum pacing

Pacing compares planned, taught, assessed and mastered topic counts. It calculates teaching-day variance and the required topics per teaching week. A class can therefore be on delivery schedule but still receive a consolidation warning when mastery is materially behind teaching.

## Exam readiness

Readiness is a forecast, not a promised examination result. Available factors include syllabus completion, assessed coverage, class mastery, recent performance, consistency, attendance and difficulty coverage. Missing inputs reduce confidence. Untaught mandatory topics and weak prerequisites apply visible penalties.

## Parent academic updates

Staff prepare a plain-language update from the student profile. It remains a draft until a user with academic intelligence management authority approves it, and parents cannot see it until publication. Publication notifies only user accounts linked through the student guardian record.

The parent route returns only active students linked to the signed-in parent and only published updates. It deliberately excludes mastery scores, confidence scores, evidence metadata, internal recommendations and teacher-only observations. Published updates may be withdrawn but cannot be moved backwards into a draft.

## Assessment blueprints and remediation

Blueprint validation checks total marks, duration, topic allocation, difficulty distribution, cognitive distribution, duplicate topics and taught-topic warnings. Teacher overrides remain warnings and are retained.

Remediation packs are editable records. AI-created packs always begin in `pending_teacher_review` and must store model/prompt/source metadata. They are never automatically assigned or approved.

## Librarian permissions

Librarians receive physical catalogue, loans, resource file-quality review, archive metadata, print queue and library computer permissions. They do not receive named-result, historical-result modification, permanent archive deletion, payroll or financial archive permissions by default.

Academic content approval is separate from librarian file-quality review. A resource cannot become approved until both reviews exist. A librarian can only perform academic review when the school owner explicitly grants `TEACHING_RESOURCE_APPROVE`.

## Teaching resource workflow

1. A teacher or librarian uploads a school-scoped file and academic metadata.
2. The resource is submitted.
3. A librarian records file-quality and archive metadata review.
4. An academic approver records content review.
5. The resource becomes approved and appears to assigned teachers.
6. New files create a new version; approved versions are not overwritten.
7. Archived resources remain in the institutional archive and may be restored as a new version.

New resource files are blocked from the public `/uploads` static route. Downloads require an authenticated, tenant-scoped endpoint and confidential downloads are audited.

## Institutional archive

Term archival creates metadata-driven records for syllabuses, lesson delivery, assessments, approved resources, timetables and anonymous result summaries. Official records are immutable. Librarians may improve metadata or submit a correction request, but cannot change historical results.

Named results and marking schemes require explicit permissions and every sensitive access is designed to be audit logged.

## Print security

Print requests record copies, paper size, sides, colour mode, required time, confidentiality and assessment security. State transitions are validated. Confidential assessment activity uses a separate audit action and does not grant editing rights to the processor.

## Classroom Mode

Classroom Mode is an exact teacher-only route, including at the API boundary; librarian and administrative roles cannot enter it through a general role bypass. It opens as a separate vibrant canvas without the normal dashboard header or sidebar and includes a return-to-dashboard button.

The launcher uses a dedicated setup endpoint that returns only UUID public references for the signed-in teacher's active class/subject assignments. Numeric database keys are not sent to the Classroom browser workflow.

The published timetable provides the scheduled lesson end and the teacher's next period. The header shows a live countdown. If no matching published period exists, the interface uses a clearly bounded 40-minute fallback timer.

The workflow includes:

- fast attendance with “all present” and exception editing;
- topic and coverage selection;
- approved teaching resources;
- class-level teacher observation;
- paper/oral/exercise-book formative activity;
- optional homework and next-lesson action;
- safe lesson close and curriculum update.

Drafts are stored locally and retried after network failure. `offline_client_id` and the one-session-per-lesson relationship prevent duplicate submissions.

Students never need a SmartLink device or Classroom Mode login.

## API summary

Academic Intelligence:

- `GET /api/academic-intelligence/command-centre`
- `GET /api/academic-intelligence/authoring-setup`
- `GET /api/academic-intelligence/students/:studentRef`
- `GET /api/academic-intelligence/dependencies`
- `GET|PATCH /api/academic-intelligence/config`
- `PATCH /api/academic-intelligence/curriculum/:recordRef`
- `POST|PATCH /api/academic-intelligence/interventions`
- `POST /api/academic-intelligence/parent-insights`
- `PATCH /api/academic-intelligence/parent-insights/:insightRef`
- `GET /api/parent-portal/academic-insights` (exact parent role)
- `GET|POST /api/academic-intelligence/assessment-blueprints`
- `GET|POST|PATCH /api/academic-intelligence/remediation-packs`

Library and resources:

- `GET /api/library/dashboard`
- `GET|POST /api/library/catalogue`
- `GET|POST /api/library/loans`
- `POST /api/library/loans/:loanRef/return`
- `GET|POST|PATCH /api/library/computers`
- `GET|POST /api/teaching-resources`
- `GET|POST|PATCH /api/teaching-resource-requests`
- `GET /api/teaching-resources/:resourceRef`
- `POST /api/teaching-resources/:resourceRef/versions`
- `POST /api/teaching-resources/:resourceRef/reviews`
- `PATCH /api/teaching-resources/:resourceRef/status`
- `GET /api/teaching-resources/:resourceRef/download`
- `GET|POST|PATCH /api/print-requests`
- `GET /api/institutional-archive`

Classroom Mode:

- `GET /api/classroom-mode/setup`
- `GET /api/classroom-mode/history`
- `POST /api/classroom-mode/sessions`
- `GET|PATCH /api/classroom-mode/sessions/:sessionRef`
- `POST /api/classroom-mode/sessions/:sessionRef/attendance`
- `POST /api/classroom-mode/sessions/:sessionRef/resources`
- `POST /api/classroom-mode/sessions/:sessionRef/complete`

## Tenant and access safety

All new tables contain `school_id`, indexes start with school scope for operational queries, and every service lookup includes the current school. Teachers are additionally constrained to their assigned class/subject pairs. External routes use UUID public references; raw IDs are only internal foreign keys.

## Role guidance

### Librarian

Start with the Library Dashboard action queue. Process overdue loans, submitted resources, print requests and archive metadata warnings. File-quality review does not imply academic approval.

### Teacher

Launch Classroom Mode from the teaching workspace, confirm the class and subject, capture attendance, use approved resources and close the lesson. Use Academic Intelligence recommendations as advice; teacher judgement remains final.

### Headteacher and academic director

Use the command centre to compare taught, assessed and mastered coverage, then drill into evidence before assigning an intervention. Configure thresholds to match school policy.

### School owner

Create librarian and other staff accounts from Users & Roles; the server returns a one-time temporary password and forces replacement at first login. Use user permission overrides for exceptional dual roles such as a librarian who is also an authorised records officer. Avoid granting named historical results or permanent archive deletion unless operationally necessary.

### Parent or guardian

The default landing page is Child Progress. The account only sees published academic updates for students explicitly linked by the school owner or authorised office staff; UUID public references are used in browser routes and responses.

## Known limitations

- Background queue infrastructure is not present in the current repository. Recalculation is event-driven inline with retry-safe reconciliation records; a production queue can later consume `academic_calculation_runs`.
- Malware scanning needs an infrastructure scanner/provider. The current implementation enforces MIME and size allow-lists, school paths and authorised downloads.
- Legacy result batches without question/section marks remain limited subject evidence until staff map more granular data.
- The existing client bundle is large and should be code-split independently of these workflows.
