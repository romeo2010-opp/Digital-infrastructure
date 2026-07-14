# SmartLink Academic Intelligence Engine

## Architecture

The engine is intentionally hybrid:

1. Source records remain authoritative. `mastery_evidence` is the canonical adapter for assessment, drill and teacher evidence; `academic_intelligence_evidence` exposes the same shape as a read-only SQL view. The adapter carries school, academic-year, term, class, subject, learner, teacher, assessment, question/topic/objective references, observed/recorded timestamps and mapping metadata.
2. Deterministic calculations produce performance, mastery, delivery, readiness and question analytics.
3. Rules and workflow tables (`academic_alerts`, `academic_recommendations`, `academic_interventions`) hold reviewable actions rather than silently changing official results.
4. `AcademicIntelligenceNarrator` is optional. It receives only validated finding references and aggregate metrics, and it cannot calculate, publish or mutate academic records.

## Formulae and evidence quality

`normalizeEvidenceRecord()` maps source rows to a common shape. Draft, invalidated and absent records remain visible as limitations but do not contribute to official calculations.

Evidence confidence is a weighted combination of:

```text
0.20 volume + 0.20 cohort/mapping coverage + 0.15 recency
+ 0.20 source reliability + 0.10 consistency + 0.15 curriculum mapping
```

`calculatePerformanceScore()` computes:

```text
sum(score × sourceWeight × reliability × recency) / sum(weights)
```

Default source weights are declared in `academicIntelligenceEngine.js` and can be overridden by school configuration.

Mastery remains evidence-weighted and requires a minimum evidence count. A missing score is `null` with `NOT_ASSESSED`, never zero. The explanation stores its evidence references, thresholds and formula.

`calculateEvidenceConfidence()` exposes the component score rather than hiding it behind a single percentage. Draft, absent, invalidated and incomplete observations remain in the limitations list while contributing no official marks. Question analytics report `psychometric_state=insufficient_sample` below the configured minimum attempts.

Readiness is a decision-support signal, not a predicted examination mark. It exposes each input contribution, missing inputs, penalties, confidence, range and `readiness-v2` formula version.

Trend analysis uses a least-squares slope plus a robust first-half/last-half median change. Fewer than four observations produces `INSUFFICIENT_HISTORY`; high interquartile spread is reported as `VOLATILE`.

Anomaly detection checks impossible marks and robust outliers. Psychometric-style flags are withheld below the configured sample size and are phrased as review recommendations, not misconduct findings.

## AI interpretation

The endpoint is `POST /api/academic-intelligence/ai/explain`. It is never called during page load. Configure it with:

```text
ACADEMIC_AI_ENABLED=false
ACADEMIC_AI_PROVIDER=gemini
ACADEMIC_AI_MODEL=gemini-2.5-flash
ACADEMIC_AI_TIMEOUT_MS=15000
ACADEMIC_AI_MAX_RETRIES=2
ACADEMIC_AI_DAILY_BUDGET=0
```

The default is deterministic fallback mode. The narrator validates finding IDs, output shape, deadlines and every academic number against the supplied evidence. Provider, model, prompt version, validation status and output references are recorded in `academic_ai_narration_runs`; raw prompts and raw learner records are not stored.

## APIs

The engine exposes command-centre and scoped routes under `/api/academic-intelligence`: overview, classes, subjects, students, topics, canonical evidence, risks, insights, evidence gaps, readiness, history, explanations, recalculation queue and AI explanation. All routes use school permission middleware, public references and term/class/subject scoping where the finding has that scope.

`academic_calculation_runs` is an idempotent queue boundary for scoped recalculation. `academic_intelligence_snapshots` and `academic_ai_narration_runs` preserve meaningful calculation and interpretation history without storing raw prompts or internal IDs in the UI payload.

Apply migrations `053` through `058` after the existing academic-intelligence migrations. They add narration audit records, nullable readiness, term-scoped findings/interventions, session-scoped evidence, the canonical evidence view, and the `academic_intelligence` AI usage feature.

## Validation

Run:

```bash
cd server && npm test
cd ../client && npm run build
```

The test suite covers missing evidence, draft/absent evidence, source weighting, mastery, readiness, trend history, anomalies, consolidation, intervention effectiveness and AI output guardrails.

## Known limitations

Question discrimination and teacher-delivery causal analysis still require a sufficiently large, consistently mapped sample. The current command centre reads materialised academic tables; a production queue worker should consume queued `academic_calculation_runs` and write scoped snapshots. Legacy alerts without a term remain unscoped until their next recalculation. Human review remains required for interventions, parent-safe language, anomaly escalation and promotion decisions.
