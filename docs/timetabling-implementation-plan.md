# Timetabling Implementation Plan

## Repository Architecture Audit

SmartLink Schools is currently a React 18 + Vite 6 frontend and an Express 4 backend using hand-written SQL with `mysql2/promise`.

- Frontend: `smartlink-schools/client`, React Router 7, Tailwind CSS 4, Radix UI primitives, lucide icons, shadcn-style UI primitives, `sonner` toasts, and custom SmartLink components such as `PortalTable`, `SectionCard`, `SectionKpiStrip`, `PageHeader`, and `Sidebar`.
- Backend: `smartlink-schools/server`, Express routes in `src/routes/index.js`, controllers in `src/controllers`, services in `src/services`, MySQL connection pool in `src/config/db.js`, and migrations in `server/database/*.sql`.
- Database: MySQL/MariaDB style DDL, JSON columns, foreign keys, scoped unique keys, and no ORM.
- Authentication: JWT bearer tokens signed by `src/middleware/auth.js`; `requireAuth`, `requirePasswordReady`, and `requireRole` protect route groups.
- Tenancy: `getScopedSchoolId`, `assertSameSchool`, teacher-scope helpers, and school-scoped SQL clauses in `src/utils/tenantScope.js`.
- Existing domain entities reused: `schools`, `users`, `classes`, `subjects`, `academic_years`, `terms`, `teacher_class_subject_assignments`, `students`, `student_enrollments`, `parent_student_links`, `school_events`, `exam_sessions`, `assessments`, `exam_timetable_entries`, `attendance_records`, `homework`, `messages`, `teacher_lesson_logs`, and result/report-card tables.
- Roles: `super_admin`, `school_owner`, `headteacher`, `bursar`, `teacher`, `parent`, `student`. The frontend has a permissions helper, but authorization is mostly role-based today.
- Notifications: the current production channel is the `messages` table with `recipient_scope`, `channel`, and `delivery_status`; no separate queue worker is present.
- Background jobs: no general background-job runner exists. Timetable generation needs a new durable `timetable_generation_jobs` model and a worker command in a later phase.
- Exports: PDF export exists through `pdfkit` in `examController.js`; spreadsheet export utility is not yet centralized.
- Existing related modules: exam sessions and exam timetable entries, assessment builder, syllabus intelligence, attendance, teacher lesson logs, daily drills, school calendar, results, students/classes/teachers, and messages.

## Components Being Reused

- School, user, class, subject, student, enrollment, academic year, term, exam session, assessment, attendance, lesson log, calendar, and message tables are reused.
- Existing auth and tenancy middleware remains authoritative.
- Existing route/controller conventions are reused for API endpoints.
- Existing SmartLink visual language is reused: compact page header, sidebar, bordered white panels, small labels, native buttons, and lucide icons.
- Existing Vite websocket proxy is compatible with future realtime generation/job updates.

## Database Changes

Add `server/database/016_timetabling_foundation.sql` and `server/database/017_school_feature_settings.sql`.

The migration introduces the shared scheduling foundation:

- `timetable_rooms`
- `timetable_resources`
- `timetables`
- `timetable_versions`
- `timetable_cycle_days`
- `bell_schedule_templates`
- `bell_schedule_slots`
- `timetable_day_templates`
- `timetable_requirements`
- `timetable_entries`
- `timetable_entry_resources`
- `timetable_constraints`
- `teacher_availability_rules`
- `room_availability_rules`
- `resource_availability_rules`
- `timetable_generation_jobs`
- `timetable_conflicts`
- `timetable_review_comments`
- `timetable_audit_events`
- `timetable_publications`
- `daily_schedule_adjustments`

The existing `exam_timetable_entries` table is not removed. The new `EXAM_TIMETABLE` mode stores versioned scheduling metadata and can reference existing `exam_sessions` and `assessments`.

`017_school_feature_settings.sql` seeds a `school_features` JSON setting for existing schools so leadership can enable or disable timetable modules from Settings without changing code.

## API Changes

Add role-protected routes under `/api/timetables`:

- `GET /timetables`
- `POST /timetables`
- `GET /timetables/setup-options`
- `GET /timetables/:id`
- `PATCH /timetables/:id/setup`
- `POST /timetables/:id/archive`
- `GET /timetables/:id/versions`
- `POST /timetables/:id/versions`
- `GET /timetables/:id/versions/:versionId`
- `POST /timetables/:id/versions/:versionId/clone`
- `POST /timetables/:id/versions/:versionId/submit-review`
- `POST /timetables/:id/versions/:versionId/request-changes`
- `POST /timetables/:id/versions/:versionId/approve`
- `POST /timetables/:id/versions/:versionId/publish`
- `GET /timetables/:id/versions/:versionId/readiness`
- `GET /timetables/:id/versions/:versionId/conflicts`
- `POST /timetables/:id/versions/:versionId/validate-entry`
- `POST /timetables/:id/versions/:versionId/entries`
- `GET /timetables/:id/audit`

The first implementation phase focuses on setup, lifecycle, readiness, conflict validation, audit, and manual entries. Generation returns a durable job record but remains queued for the solver worker phase.

Add school feature-setting routes:

- `GET /school/features`
- `PATCH /school/features`

## Solver Architecture

Create `services/timetable-solver/` as a small internal Python service:

- FastAPI API surface.
- Pydantic request/response models.
- OR-Tools CP-SAT model construction.
- Deterministic seed.
- Time-limit support.
- Stable status mapping.
- Structured health and solve responses.

The Express app remains responsible for auth, tenancy, data normalization, job persistence, and writing drafts. The solver receives only normalized data for one authorized school/version.

## Permission Changes

Because the current app has role guards but no permission persistence, phase 1 maps granular timetable permissions to current roles:

- `super_admin`, `school_owner`, `headteacher`: full create/edit/review/approve/publish/export for authorized school scope.
- `teacher`: view and review-relevant school timetable data for assigned school.
- `bursar`: read-only school timetable access where useful for operations.
- `student` and `parent`: future published projection endpoints only.

The plan keeps granular permission names documented for a future permission table or policy service.

School-level feature assignment is persisted in `school_settings` under `school_features`. The frontend route guard/sidebar and backend timetable services both enforce these settings, so disabled timetable modules are not merely hidden in the UI.

## UI Routes

Add native SmartLink routes:

- `/timetables`
- `/timetables/new`
- `/timetables/:id/setup`
- `/timetables/:id/versions`
- `/timetables/:id/versions/:versionId`
- `/timetables/:id/versions/:versionId/edit`
- `/exam-timetables`
- `/exam-timetables/new`
- `/my-timetable`
- `/my-exams`
- `/my-invigilation`
- `/settings/features`

Phase 1 implements the main timetables page and detail/version shell using the shared route component. Later phases deepen the setup wizard, editor, exam seating, and personal projections.

## Implementation Phases

1. Domain foundation: migration, role mapping, module boundary, setup/listing/version lifecycle, audit, readiness and conflict primitives.
2. School timetable setup: bell schedules, cycle days, curriculum requirements, availability, rooms/resources, fixed activities, readiness audit.
3. Manual editor: grid, entry CRUD, server-side validation, locks, swap, view filters, undo/redo.
4. Solver service: normalized contracts, CP-SAT school model, durable jobs, three strategies, persistence.
5. Workflow: review, approval, publication, notifications, exports, daily adjustments, attendance and lesson-log links.
6. Exam setup: series, sessions, papers, candidate registrations, rooms, invigilators, accommodations, clash matrix.
7. Exam solver: candidate constraints, room allocation, invigilator assignment, alternatives.
8. Exam operations: editor, seating plans, invigilation, exports, publication.
9. Hardening: tests, performance, security, accessibility, documentation, migration verification.

## Backward-Compatibility Risks

- Existing `exam_timetable_entries` remains unchanged; new versioned exam timetable data must be migrated or bridged gradually.
- MySQL/MariaDB cannot enforce all time-overlap constraints declaratively, so transaction-level revalidation is required.
- The current role model lacks department head, academic administrator, and examination officer roles; those are represented as headteacher/school_owner in phase 1.
- Notifications currently use `messages`; bulk timetable notifications should avoid one-message-per-cell spam.
- No central background worker exists, so generation jobs need a new worker command before automatic generation can be production-complete.

## Testing Strategy

- Server syntax checks for new modules and changed routes.
- Controller/service tests should cover readiness checks, entry conflict detection, lifecycle transitions, tenancy checks, stale write rejection, and publication validation.
- Solver tests should use deterministic small fixtures and assert invariants rather than exact timetables.
- Frontend build verifies route/component integration.
- Migration verification should run in a disposable MySQL database before production.

## Assumptions

- There is no existing room table, so phase 1 introduces `timetable_rooms`.
- Academic year and term are mandatory for school timetables; term can be nullable for future calendar-wide timetables but is required by the initial readiness audit.
- Current SmartLink roles are authoritative until a granular permission table is introduced.
- Generation must be durable and asynchronous; phase 1 stores queued jobs and defines the solver contract, then later worker code will execute jobs.
- Existing Vite proxy handles `/api` and `/ws`; no extra frontend server configuration is required for this module.
