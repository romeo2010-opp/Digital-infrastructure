# Topic Mastery

SmartLink stores mastery per student, subject, and topic in `student_topic_mastery`.

The update uses a weighted moving average:

`new_mastery = 0.75 * previous_mastery + 0.25 * latest_performance`

For a brand-new topic, the first latest performance becomes the first mastery value.

## Labels

- `weak`: below 50
- `developing`: 50 to 69
- `good`: 70 to 84
- `strong`: 85 and above

## Spaced Review

Next review dates are scheduled from performance:

- Weak: tomorrow
- Developing: in 3 days
- Good: in 7 days
- Strong: in 14 days

The marking flow remains deterministic first. AI feedback may assist structured answers where already configured, but the lesson-log module does not change the existing answer-marking service.

## Intervention

The system tracks consecutive failures. When a learner fails the same topic three times in a row, SmartLink marks `intervention_needed` and recommends prerequisite recovery or guided reteaching in teacher insights.
