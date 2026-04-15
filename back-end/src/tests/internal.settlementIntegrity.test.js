import test from "node:test"
import assert from "node:assert/strict"
import {
  buildAutomaticFinanceReconciliationFindings,
  summarizeSettlementIntegrityTransactions,
} from "../modules/internal/service.js"

test("summarizeSettlementIntegrityTransactions flags transactions without a user", () => {
  const review = summarizeSettlementIntegrityTransactions([
    { public_id: "01TXNOUSER", user_id: null, queue_entry_id: 44, reservation_public_id: null },
  ])

  assert.equal(review.flagged, true)
  assert.equal(review.severity, "HIGH")
  assert.equal(review.missingUserCount, 1)
  assert.equal(review.missingJourneyLinkCount, 0)
  assert.deepEqual(review.missingUserTransactionPublicIds, ["01TXNOUSER"])
})

test("summarizeSettlementIntegrityTransactions flags user transactions without queue or reservation linkage", () => {
  const review = summarizeSettlementIntegrityTransactions([
    { public_id: "01TXORPHAN", user_id: 12, queue_entry_id: null, reservation_public_id: null },
  ])

  assert.equal(review.flagged, true)
  assert.equal(review.severity, "MEDIUM")
  assert.equal(review.missingUserCount, 0)
  assert.equal(review.missingJourneyLinkCount, 1)
  assert.deepEqual(review.missingJourneyLinkTransactionPublicIds, ["01TXORPHAN"])
})

test("summarizeSettlementIntegrityTransactions passes linked queue and reservation transactions", () => {
  const review = summarizeSettlementIntegrityTransactions([
    { public_id: "01TXQUEUE", user_id: 77, queue_entry_id: 91, reservation_public_id: null },
    { public_id: "01TXRES", user_id: 88, queue_entry_id: null, reservation_public_id: "RSV-001" },
  ])

  assert.equal(review.flagged, false)
  assert.equal(review.severity, "LOW")
  assert.equal(review.missingUserCount, 0)
  assert.equal(review.missingJourneyLinkCount, 0)
})

test("buildAutomaticFinanceReconciliationFindings creates settlement integrity exceptions from open alerts", () => {
  const findings = buildAutomaticFinanceReconciliationFindings({
    settlementAlerts: [
      {
        entity_public_id: "SB-TEST-001",
        severity: "HIGH",
        summary: "Settlement batch includes transactions without a linked user.",
        station_name: "Lilongwe Central",
        metadata: JSON.stringify({
          batchDate: "2026-03-23",
          review: {
            severity: "HIGH",
            missingUserCount: 2,
            missingJourneyLinkCount: 1,
            sampleTransactionPublicIds: ["TX-1", "TX-2"],
          },
        }),
      },
    ],
  })

  assert.equal(findings.length, 1)
  assert.equal(findings[0].exceptionType, "SETTLEMENT_INTEGRITY")
  assert.equal(findings[0].severity, "HIGH")
  assert.match(findings[0].summary, /SB-TEST-001/)
  assert.match(findings[0].detail, /Missing user links: 2/)
  assert.match(findings[0].detail, /Sample transactions: TX-1, TX-2/)
})

test("buildAutomaticFinanceReconciliationFindings returns no exceptions when there are no alerts", () => {
  const findings = buildAutomaticFinanceReconciliationFindings({ settlementAlerts: [] })
  assert.deepEqual(findings, [])
})
