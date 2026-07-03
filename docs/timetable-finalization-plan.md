# Timetable Finalization Plan

## Existing Timetable Implementation

SmartLink Schools already has a first-pass timetabling foundation in `server/database/016_timetabling_foundation.sql` and `server/src/modules/timetabling`.

Current implemented pieces:

- `timetables` and `timetable_versions` for school and exam timetable modes.
- `timetable_cycle_days`, `bell_schedule_templates`, `bell_schedule_slots`, and `timetable_day_templates`.
- `timetable_rooms` and `timetable_resources`.
- `timetable_entries`, `timetable_entry_resources`, conflicts, audit, publications, generation jobs, and daily adjustments.
- Backend APIs under `/api/timetables`.
- Frontend routes under `/timetables` and `/exam-timetables`.

Important current limitation: the implementation still treats rooms as timetable-local resources. It does not yet provide a shared school-wide facility and laboratory source of truth for lessons, weekly activities and examinations.

## Existing Exam Implementation

The older exam module uses:

- `exam_sessions`
- `assessments`
- `exam_timetable_entries`

Exam timetable entries currently store a plain `room` text value and do not reference a shared facility. Exam sessions also do not yet store operating mode, buffers, availability windows or override overlays.

The versioned `EXAM_TIMETABLE` mode introduced in the timetabling module can reference `exam_sessions` and `assessments`, but needs shared facilities, weekly activities and occupancy validation to become the scheduling source of truth.

## Existing Room And Laboratory Records

The repo currently has `timetable_rooms` with:

- code and name
- room type
- normal and exam capacity
- building and floor
- equipment JSON
- active state

There is no dedicated laboratory model, no equipment inventory, no subject eligibility table and no facility availability table.

Decision: introduce `school_facilities` as the shared source of truth and safely backfill existing `timetable_rooms` into it. Keep `timetable_rooms` for backward compatibility and map it to `school_facilities` using a nullable `facility_id`.

## Existing Settings

Settings currently include:

- profile
- preferences
- notifications
- security
- users
- school profile
- feature assignment
- integrations
- data controls

The repo also has `school_settings`, used for JSON settings such as progression policy and school feature assignment.

Missing settings areas:

- academic configuration shortcuts for teaching days, bell schedules and closures
- facilities and resources
- laboratories
- weekly activities
- timetable rules

## Existing Weekly Activity Or Calendar Records

There is a school calendar and recurring assessment support. Calendar events include values like `closure`, `meeting`, `sports` and `weekly_test`, but they are calendar records, not schedulable weekly activities with scope, facility, exam policy and timetable insertion behavior.

Decision: create `weekly_school_activities` and scope assignments. Calendar events can later be projected from these records, but weekly timetable blocking must live in the scheduling foundation.

## Reusable Components

Frontend should reuse:

- `SectionCard`
- `PortalTable`
- `SectionKpiStrip`
- `Toolbar`
- existing `Button`, `Input`, `Switch`
- lucide icons

Backend should reuse:

- `requireAuth`, `requirePasswordReady`, `requireRole`
- `getScopedSchoolId`
- `HttpError` and `asyncHandler`
- existing timetabling audit/conflict services

## Required Migrations

Add `018_shared_scheduling_foundation.sql`:

- `school_facilities`
- `facility_equipment`
- `facility_equipment_assignments`
- `facility_subject_eligibility`
- `facility_availability_rules`
- `weekly_school_activities`
- `weekly_school_activity_scope_assignments`
- `school_closure_dates`
- `exam_schedule_overrides`
- `exam_session_templates`
- compatibility columns on `timetable_rooms`, `timetable_entries`, `timetable_requirements`, `daily_schedule_adjustments`, `exam_sessions`, and `exam_timetable_entries`

Backfill:

- existing `timetable_rooms` into `school_facilities`
- map `timetable_rooms.facility_id`

## Duplicate Entities To Consolidate

- `timetable_rooms` becomes a compatibility table linked to `school_facilities`.
- `exam_timetable_entries.room` stays for historical compatibility but receives a nullable `facility_id`.
- Calendar closure events remain, but scheduling-specific closures use `school_closure_dates`.

No existing table is removed in this phase.

## Shared Occupancy Architecture

Introduce a single occupancy service that reads:

- timetable entries
- published timetable entries
- weekly school activities
- facility availability and maintenance
- school closure dates
- exam timetable entries
- exam schedule overrides

Normalized response:

- resource type and ID
- date or recurring day
- start and end time
- occupancy type
- source entity type and ID
- title
- blocking status
- override permission metadata

This service becomes the shared validation source for manual timetable entries, laboratories, weekly activities and exam scheduling.

## Risks

- MySQL/MariaDB cannot enforce all overlapping time constraints declaratively.
- Existing exam timetable rows use plain text room names.
- Existing UI has no full drag-and-drop timetable grid yet.
- Applying weekly activities into a draft must not mutate published timetables.
- Historical published timetables must remain reproducible after settings changes.

## Implementation Phases

1. Shared foundation migration and backfill.
2. Facilities, laboratories, equipment and weekly activity APIs.
3. Occupancy service and facility-aware conflict validation.
4. Settings UI for academic configuration, facilities, laboratories, weekly activities and timetable rules.
5. Manual timetable editor improvements: entry type, facility picker, weekly activity picker and activity application.
6. Exam integration: availability windows, operating modes and override overlays.
7. Full master timetable grid, utilization drawers, CSV import/export and advanced conflict resolution.
8. Automated unit, integration and E2E tests.

## Testing Plan

Focused validation for this pass:

- backend syntax checks for new services/controllers and changed routes
- client production build
- manual API smoke checklist for facilities, activities and timetable apply actions

Later automated tests should cover:

- facility capacity and exam capacity
- equipment availability
- subject eligibility
- facility availability rules
- weekly activity recurrence and scope
- applying activities to versions
- laboratory double-booking
- exam override and occupancy interaction
- cross-school isolation
