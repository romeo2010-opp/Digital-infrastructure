# Daily Drill Algorithm

Daily Drills are generated from approved content only.

## Subject Scoring

When no subject is forced, SmartLink scores available subjects using:

- 30% recent taught/timetable priority
- 25% student weakness
- 20% overdue review
- 15% upcoming assessment urgency
- 10% subject balance

This prevents the engine from choosing randomly when several subjects have approved questions.

## Topic Sources

The generator builds scored topic candidates from:

1. Finalized lesson logs from the last seven days, excluding postponed topics.
2. Student weak or developing topics from mastery records.
3. Spaced-review topics whose review date is due.
4. Prerequisite recovery topics when repeated failure is detected.
5. Current teacher topic plan.
6. Approved syllabus fallback topics with approved questions.

Topic priority uses weakness, review urgency, lesson relevance, assessment relevance, and coverage gap. Teacher drill-priority overrides multiply the final topic score.

## Bucket Allocation

Normal classes use a 50/30/20 target split:

- 50% recently taught/current topics
- 30% weak topics
- 20% spaced review

Candidate classes shift toward weakness and exam preparation. Prerequisite recovery can reserve a question when intervention is needed.

## Question Rules

Questions must belong to the same school, grade, subject, and topic scope. They must be approved and include both a correct answer and a base explanation.

Introduced topics use easy questions only. Partially taught topics use easy and medium questions. Fully taught, revised, and assessed topics can use the normal difficulty mix.

Question scoring uses topic priority, difficulty match, novelty, quality score, skill diversity, and prior misconception/failure evidence.

## Intervention Analytics

Mastery now stores latest performance, confidence, trend, consecutive failures, and an intervention flag. Three consecutive failures mark a topic for intervention and allow prerequisite-recovery questions when relationships exist in `syllabus_topic_prerequisites`.

## Class Generation

`POST /api/drills/generate/class/:classId` generates personalized drills for active enrolled students. Existing completed drills for the same student, date, and subject are not replaced.

## Auditability

Generation choices are stored in `daily_drill_generation_logs`, including selected lesson logs, topic IDs, candidate question IDs, final question IDs, and bucket allocation.
