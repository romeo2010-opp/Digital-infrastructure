# Academic Intelligence operations implementation report

## Outcome

Academic Intelligence now implements one evidence-to-action loop:

```text
syllabus → mapped questions → assessment → draft marks → official topic evidence
→ scoped finding → targeted learner group → reviewed diagnostic → reassessment
→ measured intervention outcome → risk downgrade, resolution or continued support
```

The command centre is no longer the calculation surface. It reads deterministic backend findings and exposes action, ownership, evidence limitations, positive signals and material changes.

## Architecture built

- `059_academic_operations_loop.sql` extends existing assessment/intervention structures with sections, question-topic/objective mappings, source permissions and lineage, academic mark sheets, learner question/topic results, versioned generated assessments, confirmed learner groups and linked intervention reassessments.
- `academicOperationsService.js` is the canonical operational contract. It validates mappings and marks, separates draft from official evidence, publishes the highest available evidence precision, performs scoped recalculation and evaluates comparable reassessments.
- `academicIntelligenceEngine.js` remains the canonical deterministic calculation path. The command-centre projection now returns Academic Position Today, class health, positive signals, operational counts and meaningful snapshots.
- `academicIntelligenceNarrator.js` varies phrasing by stable phrase dimensions and role while validating finding references, entities and every number. Invalid/unavailable AI output falls back to deterministic narration.
- Optional AI providers now include OpenAI, Gemini, Anthropic and disabled deterministic mode. Keys are environment-only; AI never calculates or publishes marks/mastery.

## Evidence hierarchy and confidence

| Level | Precision | Topic claims | Local potential confidence |
|---|---|---:|---|
| Question/subquestion | Highest | Yes, with valid allocation | High; volume, mapped marks and mapping coverage increase confidence |
| Section | Medium | Yes, with explicit section allocation | Medium |
| Topic total | Medium/low | Yes | Starts lower and rises with mapped volume/coverage |
| Overall assessment total | Lowest | No | Aggregate-only confidence; exact topic diagnosis is prohibited |

Absence and excusal create no score. Incomplete scripts remain non-official. Missing evidence is `null`/`NOT_ASSESSED`, never zero.

## Assessment authoring and result entry

- Saved/imported questions expose a searchable, school/class/subject/term-filtered hierarchy and learning objectives.
- One topic receives all question marks automatically. Multi-topic mapping requires marks totaling question marks, percentages totaling 100%, or one primary topic with secondary tags; vague tags are rejected.
- Destructive paper saves preserve mappings by question display number.
- Results now expose question-by-question, topic-total and overall-total modes. Headers show maximum marks; the grid supports arrows/Enter, spreadsheet paste, validation, derived totals, status, draft save and local browser persistence.
- Question marks derive learner topic totals automatically. Drafts are provisional and excluded from official mastery. Publication updates only the affected assessment, class, subject, term, learners and mapped topics.
- The Results view also exposes assessment completion, distribution, mapping coverage, evidence quality and question omission/zero/full/success rates. Psychometric wording remains unavailable below a supported sample.

## Living workflow

- Topic publication reconciles one deduplicated alert per class/subject/topic/term and sends one deduplicated in-app teacher notification for a newly opened issue.
- Priority cards show scope, severity, evidence, confidence, action, owner, deadline and reassessment method, and can open a prefilled targeted assessment.
- The generator proposes learners from topic mastery or missing evidence, but requires teacher confirmation.
- Only approved questions with `school_owned`, `teacher_authored`, `public_domain`, `licensed`, `internal_use_only` or `attribution_required` permissions and explicit reuse flags can be selected. Unknown/prohibited sources are analytical references only.
- Generation creates a versioned paper and marking scheme. The teacher can edit, save review, replace one question without rebuilding the paper, approve and publish. Publication creates a real assessment and a mark sheet limited to confirmed learners.
- A linked intervention reassessment compares the same learners and topic against its baseline, stores learner counts, outcome and change, and leaves partially effective support in `review_due` rather than silently resolving it.

## Command, class and learner views

- Command centre sections are: Academic Position Today, six operational metrics, Immediate Priorities (maximum five), Positive Signals, Class Health Overview (one row per class), Evidence Gaps, Recent Meaningful Changes, targeted-assessment operations and intervention oversight.
- Evidence gaps explicitly distinguish totals-only assessments, unmapped questions, taught-but-unassessed topics, stale class evidence, missing marks and incomplete interventions.
- Class detail exposes state, readiness/confidence, mapped topic matrix, learner mastery distribution, active interventions and upcoming assessments.
- Learner profiles retain trajectory, mastery, recommendations, readiness, interventions and moderated parent-safe updates. The engine does not infer laziness, intelligence, disability, mental health, home conditions or finances.

## Greenfield Academy verified scenario

The repeatable `demo:academic-loop` script produced:

| Stage | Verified result |
|---|---|
| Baseline | Year 5 Mathematics mapped question sheet; 10 of 26 below secure equivalent-fractions mastery; 56.92% whole-class topic average; high risk |
| Generated assessment | Teacher-reviewed, five questions, 20 marks, five marking-scheme items, only the 10 confirmed learners |
| Reassessment | Seven learners improved and reached the criterion; three remain below; targeted-group result 58.5% |
| Measured outcome | Baseline 20% → 58.5%, +38.5 points; `PARTIALLY_EFFECTIVE`; intervention remains review-due |
| Risk response | Affected count 10 → 3 and severity high → medium; risk remains open for the three learners |

The seed also retains Year 3 English improvement (completed/improved positive signal), Year 2 Mathematics aggregate/insufficient evidence, Year 4 Science unmapped totals with no topic diagnosis, and Year 7 Mathematics’s seven-learner subgroup.

## Validation and tests

Automated tests cover hierarchy, mapping totals/percentages, subquestion aggregation, impossible marks, absent/incomplete semantics, permission gates, generated-paper marks/answers/mappings/duplicates, deterministic role variation and unsupported narrative facts. Existing mastery, readiness, consolidation, intervention and AI fallback tests remain green.

Verified on 2026-07-14:

- database migrations `032` and `059`: applied successfully;
- Greenfield seed: 13 classes, 254 students, 501 baseline assessments;
- operational demo loop: completed with a published assessment and mark sheet;
- server tests: 39 passed, 0 failed;
- frontend production build: passed (Vite reports the existing large-chunk and non-module `config.js` warnings);
- server build/syntax: passed; no compile step is required by the server package.

## Known limitations

- Free-form mathematical correctness and subtle objective equivalence cannot be proven generically; structural validators plus teacher review remain mandatory.
- Browser local storage preserves an offline draft, but multi-device conflict resolution/service-worker background sync is not implemented.
- A production worker should consume queued whole-scope recalculation jobs; mark publication itself already performs synchronous scoped recalculation.
- Anthropic/OpenAI/Gemini live calls require the school’s credential and were not invoked during deterministic demo validation.
- Legacy aggregate records remain Level 4 evidence until a teacher maps or replaces them; the system intentionally does not back-infer topics.

## Exact run commands

```bash
cd smartlink-schools/server
set -a; source .env; set +a
npm run db:apply -- database/032_director_executive_analytics.sql database/059_academic_operations_loop.sql
npm run demo:greenfield
npm run demo:recalculate
npm run demo:academic-loop
npm run demo:validate
npm test
npm run build

cd ../client
npm run build
```
