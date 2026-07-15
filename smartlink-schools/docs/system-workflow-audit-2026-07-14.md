# SmartLink Schools Workflow Audit

Date: 2026-07-14

This audit focuses on workflows that are visible in the product but can still feel incomplete to a school user because the loop is missing, gated by setup, or dependent on optional services.

## High-Priority Gaps

1. **Database is still in recovery mode**
   - Current local XAMPP MariaDB was brought up with `innodb_force_recovery=3`.
   - Impact: code can be built and reviewed, but normal write-heavy app testing is unsafe until the database is restored normally.
   - Next action: restore from `/home/calyx/smartlink-db-recovery/smartlink_schools_recovered_20260714_223021.sql` into a clean MariaDB data directory, remove `innodb_force_recovery`, then restart services.

2. **Parent account creation exists, but lookup is still manual**
   - Settings > Users & Roles can create `parent` accounts and link them with `student_ref` + guardian slot.
   - Impact: admins need to know or copy the student public reference; this is functional but not ergonomic.
   - Next action: replace the raw student reference field with a searchable student picker and show linked children on the created-account confirmation.

3. **Classroom Mode depends on active timetable publication**
   - The launcher now auto-selects the current teacher period when a published timetable period exists.
   - Impact: if the timetable is unpublished, missing bell slots, or the teacher is not assigned to the entry, the teacher must still pick class and subject manually.
   - Next action: add a visible fallback reason such as “No active published period found” and link to timetable setup.

4. **AI-assisted workflows depend on AI configuration**
   - Syllabus question generation, assessment extraction, parent-safe summaries, and academic intelligence narration all degrade when AI is unavailable.
   - Impact: the UI can expose draft/generate actions while the backend returns configuration-related limits.
   - Next action: centralize the AI readiness banner and make each AI action show the same setup path.

## Medium-Priority Gaps

1. **Exam Intelligence is still a coming-soon surface**
   - Route exists and is available in navigation, but the main user-facing page is still a coming-soon experience.
   - Next action: either hide it behind a feature flag or ship the first read-only forecast/dashboard slice.

2. **Term closing and progression are complete but setup-sensitive**
   - The app blocks closing when there are draft batches, draft exam papers, or missing term readiness checks.
   - Impact: users may see a workflow but not understand what exact records must be completed.
   - Next action: make every blocking count clickable into the exact records that need attention.

3. **Teacher Compliance previously overloaded the chart**
   - Fixed in this pass with bar pagination when the dataset is large.
   - Next action: add table-level filtering by department/class if schools have very large staff lists.

4. **Notifications had a crowded list layout**
   - Fixed in this pass with separated notification cards, metadata chips, and cleaner date placement.
   - Next action: add filters for unread, academics, finance, tasks, and timetable.

5. **My Leave was available but not discoverable in Settings**
   - Fixed in this pass by adding `/settings/my-leave` and a Settings sidebar entry.
   - Next action: decide whether the old top-level `/my-leave` sidebar entries should remain or be removed for staff roles.

## Lower-Priority / Polish Gaps

1. **Parent portal is parent-safe but narrower than the student portal**
   - Fixed visually in this pass so parents get a student-portal-style family surface.
   - Remaining gap: parents do not yet get a full linked-student switcher with results/fees/homework sections embedded in the same page.

2. **Resource request in Classroom Mode is useful but context-light**
   - Teachers can request resources from the live class.
   - Remaining gap: the request does not yet prefill desired date, print deadline, or urgency from the active period.

3. **Audit and export flows are present but unevenly exposed**
   - Settings has audit/data controls, and server audit logs exist.
   - Remaining gap: non-owner roles have limited self-service visibility into “what changed and why” for records they own.

4. **Some operational empty states still read like data absence, not next steps**
   - Many pages correctly show empty states.
   - Remaining gap: some should be setup checklists, especially timetable, exam rooms, AI configuration, salary profiles, and progression rules.

## Completed In This Pass

- Parent login wording now supports email login for staff and parents instead of saying only “Staff Email”.
- Parent portal was redesigned to follow the student portal’s calmer family-app visual language and still show parent-safe insights when published.
- Teacher Compliance and other large bar charts paginate instead of crushing labels together.
- My Leave now appears under Settings at `/settings/my-leave`.
- Notification drawer list was redesigned into cleaner cards with less crowding.
- Classroom Mode now:
  - opens an existing active lesson directly,
  - auto-selects the active timetable class/subject when available,
  - keeps live class mode focused on attendance and approved resources,
  - moves reflection and lesson-evidence panels behind an “End live class” step.
