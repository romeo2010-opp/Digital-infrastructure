# Time Settings and Exam Windows Plan

## Current State

SmartLink Schools already has a scheduling foundation for timetables:

- `bell_schedule_templates` stores reusable bell schedules for a school and optional timetable.
- `bell_schedule_slots` stores periods, breaks, lunch, closed blocks, and custom/exam-session blocks.
- `timetable_day_templates` assigns bell templates to cycle days.
- Weekly activities, facility availability, timetable entries, solver mappers, and Today Intelligence already reference bell slots.
- The React scheduling settings page shows bell periods, but it was read-only.

## Missing Piece

Admins could not configure periods from the UI. That meant the solver could consume periods, but schools had to rely on seeded defaults or database edits.

## Implementation Scope

This pass adds real admin-managed Bell Schedule settings:

- List bell schedule templates and their slots.
- Create bell schedule templates.
- Edit/archive templates.
- Create/edit/delete period slots safely.
- Validate time order and overlapping periods.
- Preserve breaks, lunch, closed slots, and custom exam-session windows as first-class slot types.

## Tables Used

No new table is required for basic period configuration. Existing tables are used:

- `bell_schedule_templates`
- `bell_schedule_slots`

Future full time-setting work can extend with:

- `student_closing_time_rules`
- `school_time_blocks`
- dedicated exam-window/rule tables

## Backend APIs

Added scheduling foundation APIs:

- `GET /api/scheduling/bell-schedules`
- `POST /api/scheduling/bell-schedules`
- `PATCH /api/scheduling/bell-schedules/:id`
- `POST /api/scheduling/bell-schedules/:id/archive`
- `POST /api/scheduling/bell-schedules/:id/slots`
- `PATCH /api/scheduling/bell-schedule-slots/:slotId`
- `DELETE /api/scheduling/bell-schedule-slots/:slotId`

## Frontend UI

`Settings -> Academic Configuration` now includes a Bell Schedules editor. Admins can create templates and maintain period slots, including break and lunch blocks.

## Solver Consumption

The Node backend mapper already sends `bellScheduleSlots` to the Python solver. School timetable generation uses teaching-enabled slots and rejects breaks/lunch/closed slots. Exam timetable generation can use custom or exam-session templates already modeled as clock-time slots.

## Validation

Backend validation checks:

- Template belongs to the scoped school.
- Timetable, when selected, belongs to the school.
- Slot start time is before end time.
- Slot number and code remain unique per template.
- Slots cannot overlap within the same template.
- Slots referenced by timetable entries, weekly activities, facility availability, or daily adjustments cannot be deleted.

## Testing Plan

- Node syntax checks for changed backend files.
- Frontend production build.
- API smoke tests for bell schedule listing and authenticated creation/update behavior.
- Existing Python solver tests remain valid because the solver contract did not change.
