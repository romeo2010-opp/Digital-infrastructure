# Python Timetable Solver Fix Plan

## Audit Summary

SmartLink Schools currently uses a Node.js/Express backend in `smartlink-schools/server`, a React/Vite frontend in `smartlink-schools/client`, and MariaDB/MySQL through `mysql2/promise` connection pooling in `server/src/config/db.js`. There is no ORM; controllers and services use SQL directly.

The backend is organized around authenticated `/api` routes in `server/src/routes/index.js`, JWT auth in `server/src/middleware/auth.js`, role guards through `requireRole`, tenant scoping through `getScopedSchoolId`, and service/controller modules. Notifications are currently represented mainly through the `messages` table and in-app message creation. Real-time delivery exists through `server/src/realtime/websocketServer.js` with long-poll style packet fetching on the frontend. There is no separate queue worker or Bull/Agenda system; existing timetable generation only persisted a queued row.

The frontend uses React Router, `portalApi.ts` for API calls, `SchoolDashboard.tsx` for the school dashboard, `StudentPortalPage.tsx` for students, and `TimetablingPage.tsx` for timetable setup/editing. Timetable routes already exist for school and exam timetables.

Scheduling tables already present or recently added include `timetables`, `timetable_versions`, `timetable_cycle_days`, `bell_schedule_templates`, `bell_schedule_slots`, `timetable_day_templates`, `timetable_requirements`, `timetable_entries`, `timetable_constraints`, `teacher_availability_rules`, `room_availability_rules`, `resource_availability_rules`, `timetable_generation_jobs`, `timetable_conflicts`, `timetable_publications`, `daily_schedule_adjustments`, `school_facilities`, `facility_equipment`, `facility_equipment_assignments`, `facility_subject_eligibility`, `facility_availability_rules`, `weekly_school_activities`, `weekly_school_activity_scope_assignments`, `school_closure_dates`, `exam_session_templates`, and `exam_schedule_overrides`.

Exam tables include `exam_sessions`, `assessments`, and `exam_timetable_entries`. Classes, streams, subjects, teachers, students, and enrollments are stored in `classes`, `subjects`, `users`, `students`, `student_enrollments`, and `teacher_class_subject_assignments`.

Feature settings are stored with the `school_features` setting and enforced through `schoolFeaturesService.js`. Deployment in this repo has no SmartLink Schools compose file yet, but `services/ml-service` shows the local Python service pattern with FastAPI, `requirements.txt`, Dockerfile, and service README. Environment variables use `.env.example` files and `process.env`.

## What Was Missing

The existing `services/timetable-solver` was a flat experimental FastAPI file with one generic `/solve` endpoint. It did not have the required service structure, internal Bearer-token auth, school timetable endpoint, exam timetable endpoint, room allocation endpoint, invigilation endpoint, alternative-slot endpoint, today intelligence endpoint, Pydantic domain models, tests, Dockerfile, or backend integration.

The Node backend had a `POST /timetables/:id/versions/:versionId/generate` route, but it only inserted a queued generation row and changed statuses. It did not construct a normalized scheduling problem, call a solver, validate returned assignments, save a generated draft, expose useful solver diagnostics, or compute today intelligence.

The most important missing data concept was curriculum period requirements: automatic generation needs structured requirements that say which class/group needs which subject, teacher, facility type, block length, and how many weekly/cycle periods. Without that, a solver has no real objective to satisfy.

## Why The Python Solver Is Required

Timetable generation is a constraint programming problem: teacher, class, stream, facility, laboratory, equipment, weekly activity, availability, locked-entry, capacity, candidate-clash, and invigilation constraints must be satisfied together. Random placement or frontend-only generation cannot reliably prove feasibility or explain infeasibility.

Google OR-Tools CP-SAT gives SmartLink a real constraint solver with Boolean decision variables, hard constraints, soft weighted objectives, time limits, objective scores, and stable solver statuses. Python is the best fit because OR-Tools has a mature Python API and can remain isolated behind an internal service boundary.

## New Solver Service Location

The real service will live in:

`services/timetable-solver/`

It will contain `app/main.py`, config, auth, JSON logging, API routers, Pydantic models, solver modules, constraint helpers, service helpers, tests, `requirements.txt`, `pyproject.toml`, `Dockerfile`, `.env.example`, and README.

## How The Main Backend Will Call It

The Node backend will add a `TimetableSolverClient` that sends normalized payloads to:

- `GET /health`
- `POST /solve/school-timetable`
- `POST /solve/exam-timetable`
- `POST /solve/exam-room-allocation`
- `POST /solve/invigilation`
- `POST /solve/alternative-slots`
- `POST /intelligence/today`

All protected calls will use:

`Authorization: Bearer ${TIMETABLE_SOLVER_INTERNAL_TOKEN}`

The solver will not read the SmartLink database. The Node backend remains responsible for authentication, authorization, tenancy, database reads, normalization, revalidation, persistence, audit events, notifications, and publication.

## School Timetable Generation Flow

1. User requests generation for a timetable version.
2. Backend verifies role, school tenancy, feature settings, timetable ownership, and editable state.
3. Backend loads active academic context, cycle days, bell slots, teachers, classes, subjects, facilities, equipment, weekly activities, locked/manual entries, teacher/facility availability, current occupancy, and curriculum period requirements.
4. Backend creates a `timetable_generation_jobs` row and moves the version to `GENERATING`.
5. Backend maps database rows to solver-safe IDs and payloads.
6. Backend calls `/solve/school-timetable`.
7. Solver creates CP-SAT variables for requirement/day/slot/teacher/facility choices and enforces hard constraints.
8. Solver returns one or more alternatives with assignments, objective scores, soft penalties, diagnostics, and metrics.
9. Backend revalidates all assignments using SmartLink entities and conflict rules.
10. Backend saves a generated draft only when validation passes, updates the job, version solver fields, audit trail, and message notifications.

## Exam Timetable Generation Flow

1. User chooses scope: whole school, grade, class, stream, student group, subject, or custom.
2. Backend loads relevant assessments/papers, enrolled candidates, operating mode, date range, exam windows, published timetable occupancy, weekly activities, facilities/labs/computer labs, invigilators, accommodations when available, and existing exam reservations.
3. Backend sends a normalized exam problem to `/solve/exam-timetable`.
4. Solver schedules papers into valid date/session windows while preventing candidate clashes and respecting room/lab/computer capacity.
5. Backend revalidates candidate clashes, facilities, normal timetable occupancy, and invigilator conflicts.
6. Backend persists a draft exam timetable version and mirrors scheduled papers into `exam_timetable_entries` for existing SmartLink views.

Whole-school sessions include all relevant classes and papers. Class-specific sessions include only the selected class and avoid unrelated class disruption unless shared facilities are deliberately reserved.

## How SmartLink Knows What The School Is Doing Today

A `SchoolTodayService` will compute the effective daily schedule from official sources: active academic year/term, published timetables, weekly activities, school closures, daily adjustments, teacher absences where present, substitutions, published exam timetable entries, facility reservations, events, attendance records, and lesson logs.

The service will expose:

- `GET /school/today`
- `GET /school/today/classes/:classId`
- `GET /school/today/teachers/:teacherId`
- `GET /school/today/facilities/:facilityId`
- `GET /school/today/exams`
- `GET /school/today/alerts`
- `POST /school/today/recalculate`

The dashboard will consume this computed snapshot. No fake Today cards will be introduced.

## Database/API Changes Needed

- Add or extend `curriculum_period_requirements` so schools can define required periods before solver generation.
- Extend `timetable_generation_jobs` with requested lifecycle fields, solver metrics, result snapshots, scope fields, and diagnostics.
- Add backend solver client, mappers, occupancy service, today service, revalidation service, and controllers.
- Add/fix routes for school generation, assisted completion, alternatives, exam generation, room allocation, invigilation, generation-job lookup/cancel, solver health, and today intelligence.
- Update `.env.example` with solver URL, token, timeout, alternative count, and default time limit.

## Tests To Add

Python solver tests:

- Health endpoint.
- Invalid token rejection.
- Feasible and infeasible school timetable generation.
- Locked entries and weekly activity blocking.
- Whole-school and class-specific exam generation.
- Candidate clash prevention.
- Room allocation.
- Invigilation.
- Today intelligence snapshot.

Backend verification:

- Solver client health and call behavior.
- Job lifecycle.
- Revalidation and draft save.
- Today intelligence API.

Frontend verification:

- Build passes.
- Generate controls call real backend APIs.
- Dashboard renders computed Today Intelligence payloads.

## Assumptions

- Python 3.11+ is acceptable for the service.
- Node 18+ `fetch` is available in the server runtime.
- There is no production queue worker in this repo yet, so the first implementation will run generation through a backend service flow while persisting meaningful job stages. It will not show fake percentages.
- The solver receives normalized payloads only; it does not receive passwords, tokens, raw user records, or unrelated school data.
- Existing SmartLink tables remain the source of truth, and generated assignments are saved only after backend revalidation.
