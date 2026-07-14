# Academic Intelligence and Learner Support Audit

Audit date: 2026-07-14
Scope: `smartlink-schools/client`, `smartlink-schools/server`, live `smartlink_schools` MariaDB database through the configured SSH tunnel.
Rule used: a rendered page, HTTP 200, seeded row, or passing pure-function test is not accepted as end-to-end proof.

## Evidence gathered

- Live database: MariaDB 10.4.32; 714 assessments, 170 assessment questions, 25 topic mappings, 20 objective mappings, 2 canonical academic mark sheets, 7,834 mastery-evidence rows, 2,718 materialised mastery rows, 274 alerts, 273 recommendations, 4 interventions, 2 generated assessments and 1 linked reassessment.
- Read-only integrity audit: mapping totals, score bounds, absence semantics, current duplicate alerts, generated-paper mark-sheet linkage in the seeded scenario, and operational evidence session fields currently pass for the existing rows.
- Authenticated API: headteacher login, command centre, targeted-assessment list and generated mark sheet return real database data. `/api/academic-support/cases` returns 404 because the domain does not exist.
- Authorisation probe: `teacher.01` has one assigned class/subject pair but can read 125 school-wide class-health scopes, 30 alerts and 2 interventions.
- Greenfield validator: passes all 27 checks that it implements, including the existing Year 5 targeted reassessment fixture.
- Backend tests: 35/41 pass on this machine. All six failures are PDF image-extraction tests blocked by missing Poppler/ImageMagick-compatible binaries. The academic unit tests pass.
- Client production build: not currently reproducible on this machine because the package-registry install stalled twice and produced no `node_modules`. A historical report says the build passed, but that is not current proof.

## Audit matrix

Status values: **working**, **partial**, **broken**, **missing**, **unverified**.

| Feature | Expected behaviour | Actual implementation | Frontend | Backend | Database | Tests | Current defects | Severity | Repair required |
|---|---|---|---|---|---|---|---|---|---|
| Schema and migrations | Repeatable migration chain with all support structures and deploy integration | Academic migrations 046–059 exist; migration 059 is applied; no durable migration ledger or deploy-time apply step | n/a | partial | partial | migration execution is not tested | All 14 requested support/escalation tables are absent; deployment only runs `npm start` | critical | Add versioned support migration, migration ledger/check, safe deploy command and migration tests |
| Assessment Builder | Create, reopen, review and publish real papers | Assessment CRUD, review states, import and PDF paths exist and persist | partial | partial | working for current model | export-only tests | No end-to-end create/reopen/publish test; imported and manually authored paths use different review surfaces | high | Add API/browser workflow tests and converge validation rules |
| Sections, questions and subquestions | Persist hierarchy and section totals | Parent question and section columns exist; `assessment_sections` has zero live rows; mark entry has no section mode | partial | partial | partial | subquestion aggregation unit test only | Section evidence is declared but not operational; section totals and inherited mappings are not verified | high | Implement/verify section authoring, inherited mapping and section evidence entry |
| Topic/objective mapping | Exact allocations, optional subtopic/objective, prerequisites, suggestions, bulk edits and history | Exact multi-topic mark/percentage validation works; UI supports topic/subtopic plus one primary objective | partial | partial | partial | strong pure-function coverage | No mapping version history, bulk mapping, automatic suggestions, per-question prerequisites or multiple-objective mark allocation | high | Add mapping revisions, prerequisite links, bulk/suggestion workflow and contract tests |
| Legacy result entry | Draft, submit, approve; only approved evidence becomes official | Draft and approval workflow exists, but submission calls `ingestApprovedResultBatch` | working UI | broken | partial | no API workflow test | Submitted, not approved, totals are inserted into mastery evidence and findings; returned results can leave stale evidence | critical | Gate ingestion on approved/locked state, remove submit ingestion and invalidate evidence on return/correction |
| Canonical academic mark sheet | Question/topic/overall modes, autosave, refresh, status semantics and publish lock | Three modes exist; keyboard/paste/local draft UI exists; draft and publish persist | partial | partial | working for seeded rows | validation unit tests only | No multi-device conflict handling; absent inputs can retain supplied question marks in draft; completion/publication policies are weakly tested | high | Clear marks for non-participants, add optimistic concurrency and API/browser tests |
| Evidence precision contract | Explicit precision/status/publication fields at every evidence record | Precision is split between mark-sheet `evidence_level`, `mastery_evidence.evidence_granularity`, metadata and source type | partial | partial | broken contract | hierarchy unit test | Canonical row lacks explicit assessment/question IDs, participation status, publication state and evidence precision fields required by the specification | high | Extend canonical evidence schema/view and populate explicit fields |
| Question/topic aggregation | Correct proportional topic marks and totals | Deterministic proportional aggregation works and current rows pass bounds/allocation checks | partial | working | working for current rows | good pure-function tests | Objective totals and section totals are not materialised or exposed; no live API test | medium | Add objective/section result records and transactional integration tests |
| Overall totals | Overall-only data cannot create exact topic claims | Overall mode writes limited subject evidence and skips topic reconciliation | clear warning | working | working | unit test | Legacy submit can still create class alerts before approval; overall records contribute to a cross-term subject mastery record | high | Fix official-state and term-scoped mastery defects |
| Canonical evidence adapter | Highest available valid evidence, no absent/draft/incomplete scores | Normaliser excludes invalid statuses when supplied; mark-sheet publishing writes valid mapped evidence | partial | partial | partial | good pure-function tests | `getCanonicalAcademicEvidence` hardcodes every stored mastery row as `published`; source table cannot express invalidation/publication | critical | Store and query publication/invalidation status explicitly |
| Mastery recalculation | Scoped by school/year/term/class/subject/learner/topic | School/learner/subject/topic scoped, but `recalculateStudentMastery` reads all years and terms and writes one unscoped materialised record | real data shown | broken | broken scope | no cross-term test | Archived and current evidence are mixed; generated learner selection uses the mixed record | critical | Add year/term scope to mastery records and every recalculation/read path; migrate safely |
| Findings and risks | Comparable evidence opens the correct learner/group/class concern | Topic publication reconciles class/topic alerts; legacy totals create class follow-up alerts | partial | partial | partial | consolidation unit tests | No persistent finding-to-case lifecycle; a single low mapped publication can immediately open a class risk; no comparability model | critical | Introduce evidence comparison, issue scope classification and case reconciliation |
| Insight consolidation | No duplicate unchanged concerns | Current open alert/recommendation rows have no duplicates in Greenfield | working | partial | partial | unit + demo check | Dedupe windows are date/current-term strings and not a durable case identity; historical duplicates and state transitions are not case-linked | high | Use support-case identity and deterministic event/idempotency keys |
| Intervention workflow | Owner, learners, target, planned sessions, delivery, attendance and review | Basic intervention row and notes exist; targeted learners/topics tables exist but are empty in live data | minimal | partial | partial | no workflow tests | No cycles, sessions, attendance, delivery rate, strategy type or operational follow-up | critical | Build persistent cases, cycles, sessions and delivery validation |
| Targeted assessment | Generate mapped reviewed paper for confirmed learners | Real generator, source permission gates, versions, replacement, approval and publication exist | working for seeded flow | partial | working for seeded flow | structural unit tests + demo fixture | Generator does not use prior strategies, learner responses or assessment-format patterns; near-identical prior forms are not detected | high | Extend generation context and equivalence/variation rules |
| Generated mark sheet | Publication creates a usable restricted mark sheet | Publication creates a real assessment and result route; mark sheet is lazily created on first save, not at publication | working link | partial | seeded flow has sheet | demo fixture | A published generated assessment is not guaranteed to have a persisted empty mark sheet immediately | high | Create the restricted mark sheet transactionally on publication |
| Reassessment outcome | Validate delivery/comparability, update mastery, resolve/continue/escalate | Baseline/reassessment averages are compared; effective closes, otherwise `review_due` | partial | partial | one seeded linked outcome | unit + fixture only | Baseline is latest class/topic sheet, not case evidence; success 60/minimum change 5 are hardcoded; attendance/delivery/comparability are not checked | critical | Case-linked baseline, policy-driven outcome diagnostics and escalation decisions |
| Report cards | Every official result appears once with correct absence/incomplete semantics | Legacy approved batches generate subject/term results and report cards | legacy UI works | partial | partial | demo counts/bounds only | Canonical mark-sheet publication does not feed `subject_results`/report cards; official records can diverge | critical | Reconcile canonical publication into official reporting or make one canonical reporting source |
| Academic history | Preserve evidence and decisions across terms without mixing | Snapshot/history endpoints exist and terms are stored on many evidence rows | partial | partial | partial | no cross-term behavior test | Materialised mastery mixes terms; interventions have one nullable term; no case timeline or term transfer | critical | Term-scoped mastery, persistent case timeline and approved carry-forward |
| Frontend routes/components | Support Centre, case detail, timeline, sessions, reassessment and queues | Existing Academic Intelligence, Results, assessment and learner pages are routed | existing pages partial | n/a | n/a | no client tests | All requested learner-support routes and components are missing | critical | Add Support Centre and role-specific workflows after APIs |
| Background processing | Scoped, idempotent recalculation worker with retries | API inserts queued `academic_calculation_runs`; no consumer changes queued rows to running/completed | no status UX | broken | queue table exists, zero rows | none | Manual recalculation can remain queued forever | high | Implement worker/inline dispatcher, retry/error state and tests |
| AI assistance | Optional grounded drafts with validated references and safe boundaries | Narrator validates finding IDs/numbers and deterministic fallback exists; provider/budget controls exist | optional action | partial | narration audit table empty | narrator unit tests | No support-case evidence IDs exist; strategy/guardian drafts cannot be case-grounded; live providers unverified | medium | Keep optional; add case evidence references and human approval records |
| Role permissions | Teacher only assigned learners; coordinator/headteacher queues | Permission middleware protects routes | UI hides some actions | broken scope | tenant keys present | no security integration tests | Teacher with one assignment reads 125 school-wide health scopes, 30 alerts and 2 interventions | critical | Add assignment-aware query scopes and cross-role API tests |
| Tenant and term scoping | Every query tenant-safe and current-term by default | Most SQL includes `school_id`; term filters exist on several reads | partial | partial | partial | no cross-school API tests | Teacher scope is too broad; mastery is term-unscoped; some alert term IDs remain nullable | critical | Centralise authorised scope and require explicit historical opt-in |
| Demo scenarios | Eight realistic support outcomes through actual UI | Greenfield has one improvement fixture, one partial reassessment and manually seeded intervention examples | partial | partial | rich seed | validator passes its own checks | Scenarios A–H are not implemented as support cases; no UI execution; whole-class and multi-subject outcomes are not engine-produced | high | Add deterministic case fixtures and real API/browser scenario runner |
| Automated tests | API, DB, frontend, security, migration and scenario coverage | 41 server tests are mostly pure functions/export/PDF; no client tests or HTTP/database Academic Intelligence suite | none | partial | unverified migrations | 35/41 current pass | No end-to-end contracts, role isolation, case lifecycle, cross-term, report parity or browser tests | critical | Add database integration/API tests and client workflow tests |
| Build/deployment | Reproducible build with migrations and external binaries declared | Railway configs exist; server build is an echo; PDF tools are external and undeclared in current machine | client unverified | partial | migrations manual | current PDF tests fail | Client install stalled; Poppler/ImageMagick missing; deploy does not apply/verify migrations | high | Pin/install external tools, add CI, migration gate and real server syntax/start check |

## Exact verified breakpoints

1. `submitResults()` commits a submitted batch and immediately invokes `ingestApprovedResultBatch()`. The ingestion accepts `submitted`, `approved` and `locked` entries, so unapproved evidence affects mastery, readiness, alerts and recommendations.
2. `recalculateStudentMastery()` filters by school, learner, subject and topic/objective only. It does not filter by academic year or term, then overwrites one materialised scope record.
3. Academic Intelligence permission checks grant teachers view access, but read services do not constrain results to teacher assignments. A live teacher account with one assignment returned school-wide health and intervention data.
4. Canonical mark-sheet publication writes mastery evidence but does not generate the legacy official result/report-card structures. Legacy approval does; the two publication paths are not reconciled.
5. Reassessment publication selects the latest class/subject/topic sheet as baseline and stores hardcoded `60`/`5` outcome thresholds. It does not prove delivery, attendance or evidence comparability.
6. The recalculation endpoint only queues a row. No worker/consumer exists.
7. Every requested support-case API returns no route; every requested support-case table and frontend route is absent.

## Current acceptance-gate result before repair

| Criterion | Result | Evidence |
|---|---|---|
| Questions map correctly to topics | partial pass | exact allocation validator and current row audit pass; missing history/bulk/prerequisite support |
| Question marks calculate topic evidence | pass for seeded canonical flow | live Year 5 sheet and unit aggregation tests |
| Published results trigger recalculation | partial pass | canonical publish does; legacy submission triggers too early |
| Weak evidence creates a support case | fail | no support-case model |
| Repeated comparable failure creates formal intervention | fail | no comparability/case-cycle engine |
| Incomplete support is not failure | fail | delivery is not tracked |
| Reassessment updates mastery | partial pass | seeded linked reassessment does, with unsafe baseline/policy assumptions |
| Successful support resolves/reduces case | fail | intervention can complete; no case exists |
| Unsuccessful support changes strategy | fail | strategy history/adaptation absent |
| Repeated unsuccessful cycles escalate | fail | cycles/escalation decisions absent |
| Class-wide failure creates one class issue | partial | class alert exists; no issue/case classifier or tested threshold policy |
| Cross-term support history remains intact | fail | no cases/transfers; mastery mixes terms |
| Dynamic narratives are grounded | partial pass | finding references/numbers validated; no case-evidence grounding |
| Targeted assessments generate valid mark sheets | partial pass | seeded flow works; mark sheet is not guaranteed at publication |
| Roles see correct workflow | fail | teacher scope leak and missing coordinator/support views |
| No placeholder/duplicate intelligence remains | partial | current duplicate check passes; queued recalculation and hardcoded policies remain |
| Frontend build passes | unverified | dependency install stalled on this machine |
| Backend tests pass | fail | 35/41; six external PDF-tool failures |
| Database migrations pass | partial | live 059 structures exist; no support migration or deploy gate |
| Demo scenarios work through actual UI | fail | validator is database/script based and scenarios A–H are absent |

## Audit conclusion

The existing system has a genuine mapped-evidence and targeted-reassessment foundation, but it is not a persistent learner-support engine and is not safe to describe as end-to-end complete. The critical repairs must precede UI expansion: official publication semantics, term-scoped mastery, assignment-aware authorisation, canonical report reconciliation, and a policy-driven persistent case/cycle model.

## Post-repair verification

The matrix and breakpoints above are the initial audit snapshot. The following work was completed after that snapshot; unresolved items remain unresolved rather than being re-labelled as working.

### Repairs and additions completed

- Removed submit-time intelligence ingestion. Legacy batches now create official evidence only after approval/lock.
- Added academic-year/term keys to materialised mastery and restricted recalculation to published/locked, valid evidence in the selected session.
- Added explicit assessment, question, precision, publication, status and recorded-at fields to mastery evidence.
- Made canonical draft entry clear question marks for absent/excused learners and use configured mastery thresholds.
- Added assignment-aware teacher filtering to the command centre and persistent support APIs. The live teacher probe dropped from 125 school-wide health scopes to seven authorised class-health rows; an out-of-assignment case detail returned 404.
- Added all persistent support structures, including members, topics, evidence, events, cycles, sessions, attendance, strategies, review records, policies, decisions, notifications and term transfers.
- Added the complete required `/api/academic-support` route surface with school scoping, permission guards, teacher assignment checks, optimistic version checks and deterministic idempotency keys.
- Added deterministic comparable-evidence, issue-scope, delivery/attendance outcome, strategy-rotation and safe-narrative rules.
- Connected canonical mapped publication to automatic learner/group/class support-case reconciliation. Existing Greenfield current-term evidence was backfilled into five real cases.
- Made targeted-assessment publication create a question marksheet transactionally. Migration 061 repaired the one previously published generated assessment that lacked one.
- Added a Learner Support Centre and case detail route with queues, metrics, timeline, evidence, cycles, session recording, intervention creation, review requests and guardian-safe draft actions.
- Added Greenfield scenarios Aâ€“H as deterministic support-case fixtures without altering official marks.
- Added support unit and contract tests. PDF tests now skip explicitly when their external Poppler/ImageMagick toolchain is unavailable instead of failing through Windows `convert.exe`.

### Final measured state

- Live schema: all 14 audited support structures present; 13 Greenfield support cases, 34 case-evidence rows, 22 timeline events, seven intervention cycles and 19 sessions.
- Integrity audit: zero invalid question allocations, score overflows, absent totals, non-present official entries, retained absent question marks, duplicate open alerts, published generated assessments without marksheets, or operational evidence rows missing year/term scope.
- Server tests: 57 passed, zero failed, six skipped because Poppler/ImageMagick are not installed.
- Client production build: passed with 2,369 modules transformed. Vite reports the existing large-bundle warning.
- Greenfield baseline validator: all 27 checks passed.
- Live mutation probe: one intervention POST plus an identical retry produced one cycle; one session POST plus retry produced one session; an under-delivered review became `incomplete_delivery` / `not_classified`, and its retry returned the prior decision.

### Acceptance gate after repair

| Criterion | Result | Final evidence or limitation |
|---|---|---|
| 1. Questions map correctly to topics | partial pass | exact allocation works; mapping revision history, inherited subquestion mapping, bulk confirmation and automatic suggestions remain incomplete |
| 2. Question marks calculate topic evidence | pass | canonical aggregation tests and live integrity audit pass |
| 3. Published results trigger recalculation | pass | canonical publish and approved legacy batches are official-state gated and term scoped |
| 4. Weak learner evidence creates a support case | pass | automatic canonical reconciliation and Greenfield backfill created real cases |
| 5. Repeated comparable failure creates a formal intervention | partial pass | it reaches level 2 and creates a formal-intervention recommendation; a human still creates the auditable cycle through the API |
| 6. Incomplete support is not intervention failure | pass | unit and live mutation probe returned `incomplete_delivery` and `not_classified` |
| 7. Reassessment updates learner mastery | partial pass | canonical reassessment publication updates mastery; support outcome review still accepts reviewed score/comparability inputs rather than deriving all values from linked rows |
| 8. Successful support resolves or reduces the case | partial pass | effective outcome de-escalates to continued monitoring; final resolution requires a separate guarded human action |
| 9. Unsuccessful support changes strategy | pass | repeat strategy is blocked after insufficient outcome and a deterministic alternative is returned |
| 10. Repeated unsuccessful cycles escalate to review | pass | policy-driven level 3/4 transitions and Greenfield scenarios B/C |
| 11. Class-wide failure creates one class issue | pass | classifier plus automatic case reconciliation; scenario F is one class case with linked members |
| 12. Cross-term history remains intact | partial pass | persistent history and carry-forward API exist; term-close integration and browser workflow are not verified |
| 13. Narratives remain grounded | pass for deterministic narration | structured facts and neutral wording are tested; support-specific AI generation is not implemented |
| 14. Targeted assessments generate marksheets | pass | publication invariant plus migration-061 backfill; final audit count is zero missing |
| 15. Roles see the correct workflow | partial pass | headteacher and teacher assignment probes pass; no distinct academic-coordinator role/workspace exists |
| 16. No placeholder or duplicate intelligence remains | fail | queued recalculation still has no worker; some legacy/default behavior and duplicate read surfaces remain |
| 17. Frontend build passes | pass | `npm run build` completed successfully |
| 18. Backend tests pass | pass with explicit skips | zero failures; six external PDF-tool tests skipped |
| 19. Database migrations pass | pass | 060 validated in a disposable schema then applied; 061 applied; final live audit passed |
| 20. Demo scenarios work through the actual UI | fail | Aâ€“H persist and are API-visible, but no browser-driven manual/automated UI run was completed |

### Remaining critical limitations

1. Canonical marksheet publication still does not write `subject_results`, `term_results` and report-card rows. The legacy approval and canonical publication paths can therefore diverge in official reporting.
2. Support outcome review validates delivery and attendance from persisted sessions, but reviewed baseline/reassessment scores and comparability are still supplied by the authorised request instead of being fully derived from linked published evidence.
3. The recalculation queue has no worker. A queued manual recalculation may remain queued.
4. Cross-term carry-forward is not invoked automatically during term closure.
5. Multi-subject decline and assessment-format pattern examples are deterministic fixtures, not automatic detectors over production evidence.
6. Notification storage and deduplication exist, but event-driven notification creation/delivery is not wired.
7. Section evidence mode, mapping version history, bulk mapping, automatic suggestions and prerequisite mapping are incomplete.
8. No browser test or manual role-by-role UI QA was completed. The build proves compilation, not usable interaction.
9. Poppler and ImageMagick are still absent on this Windows machine, so PDF image-extraction behavior is not currently executable here.

### Exact verification commands used

From `smartlink-schools/server` with Node on `PATH`:

```powershell
node --env-file=.env scripts/validate-support-migration.mjs
node --env-file=.env scripts/apply-sql.mjs database/060_learner_support_cases.sql
node --env-file=.env scripts/apply-sql.mjs database/061_generated_assessment_marksheets.sql
node --env-file=.env scripts/backfill-support-cases.mjs
node --env-file=.env scripts/seed-greenfield-support-scenarios.mjs
npm test
npm run demo:validate
node --env-file=.env scripts/audit-academic-system.mjs
```

From `smartlink-schools/client`:

```powershell
npm install --no-audit --no-fund
npm run build
```

Authenticated API probes used the running server at `http://127.0.0.1:4307` and exercised support list/detail/timeline/evidence/intervention endpoints, headteacher versus teacher visibility, idempotent cycle/session creation and incomplete-delivery outcome review. Credentials and tokens are intentionally not included in this report.
