# Greenfield Academy demonstration environment

The protected demo tools create a complete fictional private primary school in Blantyre, Malawi. They are development utilities only and refuse to run when `NODE_ENV=production` unless `ENABLE_DEMO_DATA_TOOLS=true` is explicitly set.

## Commands

From `smartlink-schools/server`:

```sh
npm run demo:greenfield
npm run demo:recalculate
npm run demo:validate
npm run demo:control -- simulate
```

`demo:greenfield` is deterministic and resets only the school with code `GFA`. It creates the school, academic years and terms, classes, staff, family accounts, learners, guardians, fee records, attendance, leave, events, curriculum, syllabus topics/objectives/prerequisites, lesson evidence, assessments, question-level records, results, report cards, interventions, and a published conflict-free timetable. `demo:recalculate` ingests approved result batches into the Academic Intelligence Engine and recalculates question analytics. Both operations are safe to repeat.

`demo:control` exposes the protected development controls `reset`, `seed`, `recalculate`, `validate`, `publish`, `generate`, `archive`, and `simulate`; for example `npm run demo:control -- publish`.

Use `npm run demo:control -- reset` to remove only GFA records, then `npm run demo:control -- seed` to rebuild them.

## Demo access

All seeded accounts use:

```text
Password: Greenfield#2026
```

Examples:

```text
owner@greenfield.academy
headteacher@greenfield.academy
academic.coordinator@greenfield.academy
bursar@greenfield.academy
librarian@greenfield.academy
exams.officer@greenfield.academy
teacher.01@greenfield.academy
parent.001@parents.greenfield.academy
```

The seed creates 29 teaching/staff-role accounts, 127 parent accounts, 254 learners across 13 classes, and shared guardian records to exercise sibling relationships.

## Validation coverage

The validator fails with exit code 1 if any check fails. It verifies the requested learner/staff scale, guardian coverage, term lifecycle (Term 1 archived, Term 2 open, Term 3 upcoming), curriculum and delivery evidence, assessment and report evidence, Academic Intelligence evidence, unique admissions, published timetable teacher/room/class conflicts, detailed-paper mark totals, score bounds, absent-result handling, non-uniform class averages, and an acyclic syllabus prerequisite graph.

The seed data is fictional and intended for development/testing. It does not replace production data or production approval workflows. The current engine ingests final assessment evidence at subject level unless question-level mappings are present; the selected detailed papers include question attempts and analytics for that purpose.
