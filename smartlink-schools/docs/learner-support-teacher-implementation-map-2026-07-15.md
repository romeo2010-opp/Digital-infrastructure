# Learner Support Teacher Integration Map

Date: 2026-07-15

## Canonical architecture discovered

The existing Learner Support implementation is the canonical system. The teacher integration extends it in place.

### Database

- `server/database/059_academic_operations_loop.sql`: generated targeted assessments, mark sheets, question evidence and reassessment foundations.
- `server/database/060_learner_support_cases.sql`: canonical cases, members, topics, evidence, timeline events, intervention cycles, sessions, session attendance, academic reviews, guardian reviews, escalation policy and decisions, support notifications, term transfers and reassessment links.
- `server/database/061_generated_assessment_marksheets.sql`: publication-to-marksheet linkage and legacy backfill.
- `server/database/062_teacher_learner_support_access.sql`: teacher-access extensions only. It adds explicit case assignments, visibility-scoped case notes, the requested session states and teacher session detail columns, plus reassessment due dates. It does not recreate cases, evidence, interventions, reassessments or notifications.
- `teacher_class_subject_assignments`: existing canonical subject-teacher and class-teacher relationships, scoped by school, academic year and term.
- `students.class_id` and `learner_support_case_members`: canonical individual and group membership relationships.

### Backend

- `server/src/services/academicSupportService.js`: canonical support policy, scope classification, evidence comparison, case queries, case detail, evidence, timeline, interventions, actions, outcomes and teacher authorisation.
- `server/src/controllers/academicSupportController.js`: thin HTTP adapter for the canonical service.
- `server/src/routes/index.js`: central authenticated API registration.
- `server/src/services/academicOperationsService.js`: existing targeted-assessment generator, review, approval, publication and mark-sheet lifecycle reused by support cases.
- `server/src/services/academicIntelligenceEngine.js`: creates and synchronises canonical support cases from published academic evidence.
- `server/src/services/operationalCommunicationService.js`: existing notification store and deduplication reused by support workflows.
- `server/src/services/reminderEngine.js`: existing scheduled reminder engine extended for due/overdue support sessions and reassessments.
- `server/src/controllers/schoolDataController.js`: class roster response enriched with permission-safe support indicators using one batched query.

### Frontend

- `client/src/app/pages/LearnerSupportPage.tsx`: existing page replaced in place with teacher queues, paginated filters, case detail tabs and authorised actions.
- `client/src/app/components/TargetedAssessmentWorkflow.tsx`: existing assessment workflow reused with optional case prefill.
- `client/src/app/lib/portalApi.ts`: existing API client extended with canonical support actions.
- `client/src/app/components/Sidebar.tsx`: existing Learner Support navigation entry is reused.
- `client/src/app/App.tsx`: existing `/learner-support` and `/learner-support/:caseId` routes are reused.
- `client/src/app/pages/SchoolDashboard.tsx`: compact teacher-homepage support summary.
- `client/src/app/pages/ClassDetailPage.tsx`: subtle permission-safe roster indicator.
- `client/src/app/pages/StudentProfilePage.tsx`: authorised active and resolved support summary.

## Existing behavior verified

Read-only database inspection found real persisted records:

- 13 learner-support cases
- 7 intervention cycles
- 19 intervention sessions
- 38 evidence links
- 23 case timeline events

Read-only relationship checks found zero broken primary learner, class, subject, primary-topic, evidence-assessment, evidence-learner, evidence-topic, intervention-cycle, strategy or session-cycle links in those records.

The page and domain were therefore not mock-only. The current database is running with `@@innodb_force_recovery = 3`, so write operations and migration application were not attempted.

## Broken or incomplete behavior found

- Teacher case scope only covered direct case ownership or an exact subject assignment.
- Class teachers, cycle owners and explicitly assigned support teachers were incomplete or absent from the common scope.
- The generic teacher permission granted access to management routes whose service-level action rules were too broad.
- Action-specific authorisation was repeated or absent instead of evaluated by one case service.
- Notes had no durable visibility model for teacher, support-team, coordinator and headteacher boundaries.
- Teacher session recording did not capture the requested delivery detail or per-learner attendance workflow.
- Planned/cancelled/absence states could not express the required delivery distinctions.
- Teacher queues, counts, search, pagination, due work and positive outcomes were incomplete.
- Case detail did not expose the complete evidence/support/reassessment/timeline/note workflow in the Teacher Portal.
- Targeted assessment generation was not prefilled from the support case.
- Explicit assignments could not be acknowledged, reassignment-requested and completed as one durable lifecycle.
- Class roster, learner profile and teacher homepage had no compact support integration.
- Due support notifications were not connected to the existing reminder engine.
- The first dashboard implementation used an empty queue value for `Needs attention`; this was corrected to a real backend filter.

## Canonical authorisation

`canAccessLearnerSupportCase({ userId, schoolId, caseId, requestedAction, db, lock })` is the single case-level decision point.

It evaluates:

- school ownership before any relationship check
- active user and employment state
- headteacher or academic coordinator role type
- canonical case owner
- current intervention-cycle owner
- explicit owner, support-teacher or action assignment
- current subject-teacher assignment for the case class and subject
- current class-teacher assignment for the case class
- legacy primary class-teacher link
- academic year and term alignment for teacher assignments
- requested action and restricted case transitions

List queries use the equivalent `learnerSupportScopeSql` relationship predicate. Detail, evidence, timeline, interventions and all mutations call the canonical case service. Frontend visibility is derived from backend-returned actions and is not the security boundary.

## Role and action matrix

Teacher relationships may view permitted cases, acknowledge an assignment, complete their assigned action, accept eligible ownership, request reassignment, create an intervention, record a session and attendance, add a teacher-academic note, create an assessment draft, schedule a reassessment, request review and recommend escalation.

Support teachers receive the same delivery permissions for explicitly assigned cases, without unrestricted ownership or leadership transitions.

Academic coordinators may assign owners, review outcomes, approve academic transitions and inspect coordinator-visible academic notes. They cannot draft guardian summaries by default.

Headteachers receive school-scoped academic support oversight, restricted note visibility and guarded escalation/resolution/guardian-summary actions.

Ordinary teachers cannot assign other users, perform formal escalation, resolve cases, carry cases between terms or create guardian summaries. High-severity closure remains a leadership action.

## Note visibility

- `teacher_academic`: authorised subject/class/support teachers, coordinators and headteachers.
- `support_team`: assigned support staff, owners, coordinators and headteachers.
- `coordinator_only`: coordinators and headteachers.
- `headteacher_only`: headteachers only.
- `guardian_meeting`: coordinators/headteachers under the academic support policy.
- `administrative_restricted`: headteachers only in this academic support response.

Teacher APIs select only permitted note columns and permitted rows. Hidden notes and their metadata are not returned.

## API contract

Existing canonical routes reused:

- `GET /api/academic-support/cases`
- `GET /api/academic-support/cases/:caseId`
- `GET /api/academic-support/cases/:caseId/evidence`
- `GET /api/academic-support/cases/:caseId/timeline`
- `GET /api/academic-support/cases/:caseId/interventions`
- `GET /api/academic-support/learners/:learnerId`
- existing assign/intervention/session/reassessment/outcome/escalate/resolve/carry-forward/review/guardian routes

Extensions on the same canonical route family:

- `GET /api/academic-support/summary`
- `POST /api/academic-support/cases/:caseId/acknowledge`
- `POST /api/academic-support/cases/:caseId/complete-assignment`
- `POST /api/academic-support/cases/:caseId/accept-ownership`
- `POST /api/academic-support/cases/:caseId/request-reassignment`
- `POST /api/academic-support/cases/:caseId/add-note`
- `POST /api/academic-support/cases/:caseId/create-targeted-assessment`
- `POST /api/academic-support/cases/:caseId/recommend-escalation`

No duplicate `/api/teacher/learner-support` case system was created.

## Teacher Portal workflow

The Teacher Portal now contains:

- needs-attention, assigned, class, subject, awaiting-action, reassessment, review, recently-improved and completed queues
- relationship-safe counts and paginated search/filtering
- today support work and positive outcome signals
- case overview, evidence, support plan, sessions, reassessment, timeline and notes
- assignment acknowledgement, completion, ownership acceptance and reassignment request
- detailed session status, duration, delivery method, resources, activities, observation, practice, next action and attendance
- targeted assessment prefill through the existing generator
- approved assessment linking and marksheet navigation
- published reassessment evaluation updates the canonical reassessment, intervention cycle, case outcome counters and timeline using the shared delivery calculation
- strategy-review request and escalation recommendation
- compact homepage, roster and learner-profile integrations

## Tests

Automated coverage includes:

- unrelated teacher denial
- cross-school denial
- subject-teacher access and restricted-action denial
- class-teacher access
- explicit support-teacher access
- removed assignment revocation
- archived case relationship enforcement
- coordinator/headteacher action separation
- restricted-note response contract
- durable session states and attendance contract
- canonical route reuse and absence of duplicate teacher case routes
- canonical reminder-engine support notifications and deduplication
- existing academic evidence, intervention, assessment, marksheet and support contracts

Commands run:

```bash
cd smartlink-schools/server
node --check src/services/academicSupportService.js
node --check src/services/reminderEngine.js
node --check src/controllers/academicSupportController.js
node --check src/controllers/schoolDataController.js
node --check src/routes/index.js
npm test

cd ../client
npm run build

/opt/lampp/bin/mysql --protocol=tcp -h 127.0.0.1 -P 3306 -u root -D smartlink_schools --batch --raw -e "SELECT @@innodb_force_recovery; ..."
```

Automated result at the time of this report: all server tests passed and the production frontend build passed. The Vite build still reports the pre-existing large-chunk and non-module `config.js` warnings.

## Manual QA boundary

Completed:

- read-only verification that canonical support tables and real data exist
- static server syntax validation
- full backend automated suite
- production frontend compilation

Not completed:

- migration application
- live API writes
- browser login walkthrough for subject teacher, class teacher, intervention owner, unrelated teacher, coordinator and headteacher
- refresh/persistence verification against the extended schema
- live query-plan inspection after the extension indexes exist

Reason: MariaDB is running in `innodb_force_recovery=3`. Applying migrations or testing writes in that state risks further database damage and is not a valid end-to-end verification environment.

## Cleanup

No canonical tables, endpoints or role workflows were removed. No duplicate teacher-support experiment was found that could be safely deleted. Common permission logic was consolidated into the support service, and existing targeted-assessment, notification, evidence and outcome logic was reused.

## Remaining work after database recovery

1. Make and verify a full logical backup while the current database remains readable.
2. Repair or restore MariaDB, start it with `innodb_force_recovery=0`, and verify normal writes.
3. Apply `062_teacher_learner_support_access.sql` with the normal migration runner.
4. Run the demo-school role matrix through the actual UI and API.
5. Inspect `EXPLAIN` plans using real teacher/case volumes; add indexes only if the real plans show a need.
6. Validate scheduled reminders through the normal reminder-engine execution path.
7. Add browser-level tests after the recovered database can provide stable fixtures.
