# Exam Timetable Generation

Exam timetable generation starts in the Node backend through:

- `POST /api/exam-timetables/:id/versions/:versionId/generate`
- `POST /api/exam-timetables/:id/versions/:versionId/generate-for-scope`
- `POST /api/exam-timetables/:id/versions/:versionId/allocate-rooms`
- `POST /api/exam-timetables/:id/versions/:versionId/allocate-invigilators`

The examinations officer supplies scope and operating mode. Supported scopes are `WHOLE_SCHOOL`, `GRADE`, `CLASS`, `STREAM`, `STUDENT_GROUP`, `SUBJECT`, and `CUSTOM`. Supported operating modes are `NORMAL_LESSONS_CONTINUE`, `PARTIAL_SUSPENSION`, `FULL_SCHOOL_SUSPENSION`, and `CUSTOM`.

The backend loads the selected exam session, assessments as papers, enrolled candidates, available exam windows, facilities/labs/computer labs, weekly activities, closures, and availability rules. The solver schedules papers into windows and facilities while preventing direct candidate clashes, capacity violations, protected activity overrides, and lab/computer misuse.

Generated drafts are revalidated in the backend before saving to `timetable_entries` and `exam_timetable_entries`.

Whole-school exams include all selected papers. Class-specific exams only include the selected class and should not disrupt unrelated classes unless a shared resource is explicitly used.

