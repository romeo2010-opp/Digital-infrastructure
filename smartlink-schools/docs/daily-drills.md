# Daily Drills

Daily Drills turn approved syllabus topics and approved question-bank items into short practice sessions for students.

## Student Experience

Students open `Practice` in the student portal. The portal loads today's drill, shows the subject/topic focus, lets the student answer questions, and submits the drill for review. Results, correct answers, and explanations are only shown after submission.

The portal also caches the last loaded drill and drill history in local storage so a student or guardian can review the latest available practice data on a poor connection.

## Drill Selection

The generator tries to pick:

1. A weak or developing topic from the student's mastery record.
2. The class teacher's current topic plan.
3. Any active approved topic with approved questions for the student's grade and subject.

If there are not enough approved questions, the student sees a clear message and staff can approve more questions from Syllabus Intelligence.

## Marking

Multiple choice and true/false questions are auto-marked. Short answers use accepted answers and normalization. Structured and essay answers are saved for teacher review.

Mastery updates after each mark:

- below 50: weak, review tomorrow
- 50 to 69: developing, review in 3 days
- 70 to 84: good, review in 7 days
- 85 and above: strong, review in 14 days

## Staff and Guardian Views

Teachers can view class drill insights from Syllabus Intelligence. Guardian summaries expose the student's recent completion pattern, strongest subject, weakest topic, and a recommended action.

## Key Endpoints

```text
GET  /api/drills/today/:studentId?
POST /api/drills/generate/:studentId?
POST /api/drills/:id/answer
POST /api/drills/:id/submit
GET  /api/drills/history/:studentId?
GET  /api/teacher/classes/:classId/drill-insights
GET  /api/guardian/students/:studentId/drill-summary
POST /api/explanations/question/:id/adapt
```

