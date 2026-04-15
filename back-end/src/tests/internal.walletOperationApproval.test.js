import test from "node:test"
import assert from "node:assert/strict"
import { INTERNAL_ROLE_CODES } from "../modules/internal/permissions.js"
import {
  buildWalletApprovalPolicy,
  determineWalletApproval,
  WALLET_OPERATION_TYPES,
} from "../modules/internal/walletOperationApproval.service.js"

test("wallet approval policy parses boolean and numeric settings", () => {
  const policy = buildWalletApprovalPolicy({
    support_refund_threshold_mwk: "18000",
    "wallet.credit.approval_threshold_mwk": "32000",
    "wallet.ledger_adjustment.requires_approval": "0",
    "wallet.balance_transfer.requires_approval": "1",
    "wallet.self_approval.allowed": "true",
  })

  assert.equal(policy.refundSupportThresholdMwk, 18000)
  assert.equal(policy.walletCreditApprovalThresholdMwk, 32000)
  assert.equal(policy.ledgerAdjustmentRequiresApproval, false)
  assert.equal(policy.balanceTransferRequiresApproval, true)
  assert.equal(policy.selfApprovalAllowed, true)
})

test("support-threshold refund requires approval only above configured threshold", () => {
  const policy = buildWalletApprovalPolicy({
    support_refund_threshold_mwk: "15000",
  })

  const smallRefund = determineWalletApproval({
    operationType: WALLET_OPERATION_TYPES.REFUND_REQUEST,
    amountMwk: 9000,
    actorRole: INTERNAL_ROLE_CODES.FINANCE_MANAGER,
    actorUserId: 12,
    requesterUserId: 12,
    policy,
  })

  const largeRefund = determineWalletApproval({
    operationType: WALLET_OPERATION_TYPES.REFUND_REQUEST,
    amountMwk: 42000,
    actorRole: INTERNAL_ROLE_CODES.FINANCE_MANAGER,
    actorUserId: 12,
    requesterUserId: 12,
    policy,
  })

  assert.equal(smallRefund.requiresApproval, false)
  assert.equal(largeRefund.requiresApproval, true)
})

test("ledger adjustments and balance transfers use strict approval defaults", () => {
  const policy = buildWalletApprovalPolicy({})

  const ledgerAdjustment = determineWalletApproval({
    operationType: WALLET_OPERATION_TYPES.LEDGER_ADJUSTMENT,
    amountMwk: 5000,
    actorRole: INTERNAL_ROLE_CODES.PLATFORM_OWNER,
    actorUserId: 1,
    requesterUserId: 1,
    policy,
  })

  const balanceTransfer = determineWalletApproval({
    operationType: WALLET_OPERATION_TYPES.BALANCE_TRANSFER,
    amountMwk: 7500,
    actorRole: INTERNAL_ROLE_CODES.PLATFORM_INFRASTRUCTURE_ENGINEER,
    actorUserId: 3,
    requesterUserId: 3,
    policy,
  })

  assert.equal(ledgerAdjustment.requiresApproval, true)
  assert.equal(balanceTransfer.requiresApproval, true)
  assert.equal(ledgerAdjustment.canSelfApprove, false)
  assert.equal(balanceTransfer.canSelfApprove, false)
})
