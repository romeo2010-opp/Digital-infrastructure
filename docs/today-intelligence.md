# Today Intelligence

Today Intelligence answers: what is the school officially doing today?

Backend routes:

- `GET /api/school/today`
- `GET /api/school/today/classes/:classId`
- `GET /api/school/today/teachers/:teacherId`
- `GET /api/school/today/facilities/:facilityId`
- `GET /api/school/today/exams`
- `GET /api/school/today/alerts`
- `POST /api/school/today/recalculate`

The backend composes the snapshot from official sources: active academic year and term, published timetable entries, weekly activities, exam timetable entries, school closures, calendar events, attendance records, lesson logs, and facility maintenance.

The Python solver service can process the same normalized payload through `POST /intelligence/today`. If the solver is temporarily unavailable, the backend returns a deterministic database-derived snapshot instead of fake data.

Dashboard consumers should read `today.schoolStatus`, `today.operatingMode`, `today.examSessionsToday`, `today.classesWritingExams`, `today.classesContinuingNormalLessons`, `today.laboratoriesInUseNow`, `today.alerts`, and `today.recommendations`.

