# Term Coverage

Term coverage compares planned teaching with finalized actual lesson logs.

## Planned Source

Planned topics come from `teacher_topic_plan`.

## Actual Source

Actual coverage comes only from finalized `teacher_lesson_logs`. A topic is not treated as taught just because its planned date has passed.

## Coverage View

`GET /api/classes/:classId/subjects/:subjectId/coverage` returns:

- Planned topics
- Finalized lesson logs
- Timeline rows
- Delayed topics
- Coverage percentages
- Approved question availability
- Assessment readiness signal

Postponed, draft, reopened, and cancelled logs are excluded from actual coverage.
