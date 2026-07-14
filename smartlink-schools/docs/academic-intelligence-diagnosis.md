# Academic Intelligence technical inventory and diagnosis

## Runtime inventory

| Path or structure | Purpose | Used | Duplicate? | Decision |
|---|---|---:|---:|---|
| `client/src/app/pages/AcademicIntelligencePage.tsx` | `/academic-intelligence` command centre | Yes | Was duplicating alerts/recommendations across sections | Retained and rebuilt as the single operations UI |
| `client/src/app/pages/SyllabusIntelligencePage.tsx` | Syllabus authoring and delivery | Yes | No; it is upstream evidence | Retained |
| `client/src/app/pages/ExamIntelligenceComingSoonPage.tsx` | Separate `/exam-intelligence` product route | Yes | Name looked obsolete, but route/import checks prove it is live | Retained; not deleted by name |
| `client/src/app/pages/ResultsEntryPage.tsx` | Canonical results route | Yes | Legacy overall entry coexisted with no mapped evidence entry | Merged: legacy total entry remains labelled compatibility mode; operational mark sheet is canonical for intelligence |
| `client/src/app/pages/ExamPaperDocumentPage.tsx` | Assessment question editor/import review | Yes | No | Retained and extended with canonical curriculum mapping |
| `client/src/app/pages/ClassDetailPage.tsx` | Class workspace | Yes | No | Retained and extended with class intelligence |
| `client/src/app/pages/StudentProfilePage.tsx` | Learner record | Yes | No | Retained; already consumes learner intelligence |
| `server/src/services/academicIntelligenceEngine.js` | Deterministic mastery, pacing, readiness, findings and snapshots | Yes | Several callers formerly rebuilt summaries in controllers/UI | Retained as the canonical calculation path |
| `server/src/services/academicIntelligenceNarrator.js` | Validated optional narration | Yes | Previous fallback used one repetitive shape | Merged with role/phrase variation and number/reference validation |
| `server/src/services/academicOperationsService.js` | Mapping, mark sheets, publication, targeted generation and reassessment | Yes | No | Added as the operational domain service; it calls the canonical engine rather than replacing it |
| `server/src/controllers/academicIntelligenceController.js` | Scoped intelligence reads/actions | Yes | Thin aliases exist for compatibility (`overview`, `command-centre`) | Retained; aliases share one implementation |
| `server/src/controllers/academicOperationsController.js` | Thin operational HTTP adapter | Yes | No | Added |
| `mastery_evidence` / `academic_mastery_records` | Canonical evidence adapter and materialised mastery | Yes | No | Retained; new published marks feed these tables |
| `result_batches` / `result_entries` | Legacy aggregate results | Yes | Lower precision, not a second topic engine | Retained as Level 4 aggregate evidence only |
| `assessment_topics` / `assessment_topic_marks` | Legacy teacher-entered topic totals | Yes in compatibility paths | Overlaps Level 3 evidence | Retained for migration; new `learner_topic_results` is the operational result contract |
| `academic_alerts`, `academic_recommendations`, `academic_interventions` | Risk/action workflow | Yes | UI previously rendered alerts and recommendations repeatedly | Retained and consolidated into five command-centre priorities |
| Assessment blueprint/remediation pack APIs | Planning and reviewed resource drafts | Yes | Not the live operations loop | Retained, but removed from the command-centre page |

## Cleanup result

- Removed files: none. Import, route, test and runtime-reference checks did not prove any academic file safe to delete; the apparently obsolete exam-intelligence page is actively routed.
- Merged implementation: repeated priority, alert, recommendation, migration and blueprint sections were removed from the command-centre component; mapped evidence calculations moved to the backend operations service.
- Functionality intentionally removed from the command centre: repeated percentage cards, duplicated alert/recommendation lists, blueprint authoring, remediation-pack moderation and recalculation timestamps.
- Retained compatibility: aggregate result batches and overall-total entry remain usable, but cannot create topic claims.
- Required migration chain: existing Academic Intelligence migrations `046`–`058`, audit migration `032` on older databases that do not yet have `audit_logs`, then `059_academic_operations_loop.sql`.

The existing engine already had useful mastery, pacing, result-ingestion and intervention tables, but they were not joined by a single evidence contract. The practical risks found during the audit were:

- final-score ingestion was explicitly limited and could not support topic claims;
- evidence status, mapping strength, recency and cohort coverage were not calculated together;
- missing mastery was easy for the command-centre UI to render as `0%`;
- readiness inputs were stored as opaque JSON without contribution-level explanations;
- trend history and robust anomaly limits were absent;
- alerts and recommendations were deduplicated by rule but not consistently term-scoped;
- topic detail had no evidence adapter and could only display a generic limitation;
- AI had no academic-specific opt-in policy, strict finding-reference validation or academic usage budget;
- recalculation had no idempotent queue boundary or meaningful snapshot history.

The remediation keeps source records authoritative and adds a canonical adapter, explicit quality components, deterministic analytical helpers, term/session scoping, explainability records and an opt-in narrator. It deliberately does not infer causes or sensitive learner traits from marks.
