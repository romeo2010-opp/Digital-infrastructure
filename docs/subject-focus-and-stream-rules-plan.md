# Subject Focus And Stream Rules Plan

## What Already Exists

- Timetable setup has school/exam timetables, timetable versions, manual entries, generation jobs, readiness, conflicts, audit, and solver integration.
- Scheduling settings already include bell schedules, bell periods, daily templates, facilities, weekly activities, and curriculum period requirements.
- Bell periods live in `bell_schedule_slots`; day-specific bell templates are mapped through `timetable_day_templates`.
- Curriculum requirements already carry `class_id`, `stream_section`, `subject_id`, preferred/avoided days, preferred/avoided slots, facility requirements, periods per cycle, and block length.
- Classes exist, and streams are represented in several tables as `stream_section`; there is no first-class stream model/table in the timetable module.
- The Python solver already accepts bell slots, classes, facilities, requirements, fixed entries, availability, and weekly activities. It scores soft preferences and enforces hard resource conflicts.
- Manual entry validation already checks slots, non-teaching periods, class/teacher/facility conflicts, facility suitability, and day-specific bell template availability.
- Frontend design language for scheduling settings uses dense section cards, compact form controls, tables, switches, and restrained colors.
- Permission enforcement currently uses role guards in routes (`school_owner`, `headteacher`, `teacher`, etc.) rather than fine-grained named permission flags.
- Existing migration style uses numbered SQL files under `smartlink-schools/server/database`.

## What Is Missing

- No persistent bell slot tags such as `MORNING_FOCUS`, `AFTER_LUNCH`, or `LAST_PERIOD`.
- No subject focus categories or subject-to-focus assignments.
- No focus rules that define preferred/avoided slot tags or hard/soft penalties.
- No stream scheduling rules beyond ordinary class/teacher/facility conflicts.
- The solver payload does not send focus rules, slot tags, or stream rules.
- The Python solver does not score subject focus or explain focus-rule penalties.
- Manual placement does not warn/block on subject focus or stream rules.
- No quality report for focus-rule performance or stream-rule compliance.
- No UI for configuring subject focus categories, focus assignments, slot tags, or stream scheduling rules.

## Tables And Models To Add Or Extend

- Add `bell_schedule_slot_tags`.
- Add `subject_focus_categories`.
- Add `subject_focus_assignments`.
- Add `subject_focus_rules`.
- Add `stream_scheduling_rules`.
- Keep stream references compatible with the existing model by supporting `class_id`, `stream_section`, `scope_type`, and `scope_reference_id`; do not require a new stream table.

## Frontend Pages And Components To Add

- Extend `Settings -> Academic Configuration -> Bell Periods` with slot-tag selection.
- Extend `Settings -> Timetable Rules` with:
  - Subject focus category form/list.
  - Subject focus assignment form/list.
  - Subject focus rule form/list.
  - Stream scheduling rule form/list.
- Extend manual timetable entry with rule warnings/conflict feedback returned by the backend.
- Add compact quality report panels on timetable detail for focus and stream rule outcomes.

## Backend APIs To Add

- `GET/POST/PATCH/ARCHIVE /api/scheduling/subject-focus-categories`
- `GET/POST/PATCH/ARCHIVE /api/scheduling/subject-focus-assignments`
- `GET/POST/PATCH/ARCHIVE /api/scheduling/subject-focus-rules`
- `GET /api/scheduling/bell-slot-tags`
- `PUT /api/scheduling/bell-schedules/:scheduleId/slot-tags`
- `GET/POST/PATCH/ARCHIVE /api/scheduling/stream-scheduling-rules`
- `GET /api/timetables/:id/versions/:versionId/focus-report`
- `GET /api/timetables/:id/versions/:versionId/stream-rule-report`

## Solver Payload

The Node mapper will add:

- `bellScheduleSlotTags`: slot id plus normalized tag codes.
- `subjectFocusCategories`
- `subjectFocusAssignments`
- `subjectFocusRules`
- `streamSchedulingRules`

The payload must include only school-scoped scheduling data and avoid private user data.

## Subject Focus Scoring

- Soft focus rules add weighted objective penalties.
- Preferred slot tag match has zero penalty.
- Neutral slot gets a smaller penalty.
- Avoided tags get the configured rule weight or stronger.
- `LAST_PERIOD` gets an additional weight-derived penalty when avoided.
- Hard rules remove incompatible candidates.
- Solver output includes a focus summary and warnings for placements outside preferred tags.

## Stream Same-Subject Handling

- `DISALLOW_PARALLEL_SAME_SUBJECT` hard rules add at-most-one constraints for matching class/stream/subject/day/slot groups.
- Soft stream rules add penalties instead of blocking.
- `ALLOW_ONLY_WITH_DIFFERENT_TEACHERS` and `ALLOW_ONLY_WITH_DIFFERENT_ROOMS` block only matching teacher/facility parallel placements.
- Existing teacher double-booking remains independent and cannot be used as the only stream protection.

## Hard Vs Soft Strategy

- Default focus severity is `SOFT`.
- Stream rules can be `HARD` or `SOFT`; hard rules block generation/manual placement.
- Manual placement returns soft warnings with stable codes and blocks hard violations.
- Overrides are represented by `allow_override`; role-based override permissions can be added later if the application introduces named permission claims.

## Test Plan

- SQL syntax/schema creation.
- Backend syntax checks and route smoke checks.
- Manual placement warning for soft focus rule.
- Manual placement block for hard focus rule.
- Manual placement block for hard stream parallel rule.
- Python solver: focus prefers morning, uses afternoon only when needed, hard focus rule blocks avoided tag.
- Python solver: stream hard rule blocks same-subject parallel placement.
- Existing solver tests remain green.
- Production client build remains green.

## Assumptions

- Current streams are `stream_section` strings, not a separate table.
- Role guards remain the active permission mechanism; new fine-grained permission labels are documented in UI/API intent but not enforced until the broader permission framework exists.
- Default focus categories are available to seed per school, but no subject is automatically forced into HIGH_FOCUS.
- Bell slot tags are manually configurable; the implementation does not infer morning solely from time.
