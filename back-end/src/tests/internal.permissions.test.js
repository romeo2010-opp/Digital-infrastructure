import test from "node:test"
import assert from "node:assert/strict"
import {
  INTERNAL_PERMISSIONS,
  INTERNAL_ROLE_CODES,
  resolveEffectiveInternalPermissions,
} from "../modules/internal/permissions.js"

test("station onboarding manager gets station and onboarding permissions only", () => {
  const permissions = new Set(
    resolveEffectiveInternalPermissions([INTERNAL_ROLE_CODES.STATION_ONBOARDING_MANAGER], [])
  )

  const allowed = [
    INTERNAL_PERMISSIONS.OVERVIEW_VIEW,
    INTERNAL_PERMISSIONS.STATIONS_VIEW,
    INTERNAL_PERMISSIONS.STATIONS_ACTIVATE,
    INTERNAL_PERMISSIONS.STATIONS_CONFIGURE,
    INTERNAL_PERMISSIONS.ONBOARDING_VIEW,
    INTERNAL_PERMISSIONS.ONBOARDING_MANAGE,
    INTERNAL_PERMISSIONS.FIELD_VIEW,
    INTERNAL_PERMISSIONS.FIELD_MANAGE,
  ]

  allowed.forEach((permissionCode) => {
    assert.equal(
      permissions.has(permissionCode),
      true,
      `expected ${permissionCode} to be granted`
    )
  })

  const forbidden = [
    INTERNAL_PERMISSIONS.SUPPORT_VIEW,
    INTERNAL_PERMISSIONS.SUPPORT_RESOLVE,
    INTERNAL_PERMISSIONS.SUPPORT_REFUND_LIMITED,
    INTERNAL_PERMISSIONS.FINANCE_VIEW,
    INTERNAL_PERMISSIONS.FINANCE_SETTLE,
    INTERNAL_PERMISSIONS.FINANCE_REFUND_APPROVE,
    INTERNAL_PERMISSIONS.STAFF_VIEW,
    INTERNAL_PERMISSIONS.STAFF_MANAGE,
    INTERNAL_PERMISSIONS.SETTINGS_VIEW,
    INTERNAL_PERMISSIONS.SETTINGS_EDIT,
    INTERNAL_PERMISSIONS.SECURITY_OVERRIDE,
    INTERNAL_PERMISSIONS.SECURITY_FORCE_SIGN_OUT,
    INTERNAL_PERMISSIONS.SECURITY_LOCK_ACCOUNT,
  ]

  forbidden.forEach((permissionCode) => {
    assert.equal(
      permissions.has(permissionCode),
      false,
      `expected ${permissionCode} to remain blocked`
    )
  })
})

test("field agent gets field workflow access without activation or finance powers", () => {
  const permissions = new Set(resolveEffectiveInternalPermissions([INTERNAL_ROLE_CODES.FIELD_AGENT], []))

  const allowed = [
    INTERNAL_PERMISSIONS.STATIONS_VIEW,
    INTERNAL_PERMISSIONS.ONBOARDING_VIEW,
    INTERNAL_PERMISSIONS.FIELD_VIEW,
    INTERNAL_PERMISSIONS.FIELD_MANAGE,
  ]

  allowed.forEach((permissionCode) => {
    assert.equal(
      permissions.has(permissionCode),
      true,
      `expected ${permissionCode} to be granted`
    )
  })

  const forbidden = [
    INTERNAL_PERMISSIONS.OVERVIEW_VIEW,
    INTERNAL_PERMISSIONS.STATIONS_ACTIVATE,
    INTERNAL_PERMISSIONS.STATIONS_CONFIGURE,
    INTERNAL_PERMISSIONS.ONBOARDING_MANAGE,
    INTERNAL_PERMISSIONS.FINANCE_VIEW,
    INTERNAL_PERMISSIONS.FINANCE_SETTLE,
    INTERNAL_PERMISSIONS.FINANCE_REFUND_APPROVE,
    INTERNAL_PERMISSIONS.SUPPORT_REFUND_LIMITED,
    INTERNAL_PERMISSIONS.STAFF_MANAGE,
    INTERNAL_PERMISSIONS.SETTINGS_EDIT,
    INTERNAL_PERMISSIONS.SECURITY_OVERRIDE,
  ]

  forbidden.forEach((permissionCode) => {
    assert.equal(
      permissions.has(permissionCode),
      false,
      `expected ${permissionCode} to remain blocked`
    )
  })
})

test("customer support agent gets support workflow access without finance or station control", () => {
  const permissions = new Set(resolveEffectiveInternalPermissions([INTERNAL_ROLE_CODES.CUSTOMER_SUPPORT_AGENT], []))

  const allowed = [
    INTERNAL_PERMISSIONS.OVERVIEW_VIEW,
    INTERNAL_PERMISSIONS.STATIONS_VIEW,
    INTERNAL_PERMISSIONS.SUPPORT_VIEW,
    INTERNAL_PERMISSIONS.SUPPORT_RESOLVE,
    INTERNAL_PERMISSIONS.SUPPORT_ESCALATE,
    INTERNAL_PERMISSIONS.SUPPORT_REFUND_LIMITED,
  ]

  allowed.forEach((permissionCode) => {
    assert.equal(
      permissions.has(permissionCode),
      true,
      `expected ${permissionCode} to be granted`
    )
  })

  const forbidden = [
    INTERNAL_PERMISSIONS.STATIONS_ACTIVATE,
    INTERNAL_PERMISSIONS.STATIONS_CONFIGURE,
    INTERNAL_PERMISSIONS.FINANCE_VIEW,
    INTERNAL_PERMISSIONS.FINANCE_SETTLE,
    INTERNAL_PERMISSIONS.FINANCE_REFUND_APPROVE,
    INTERNAL_PERMISSIONS.STAFF_MANAGE,
    INTERNAL_PERMISSIONS.RISK_FREEZE,
    INTERNAL_PERMISSIONS.AUDIT_VIEW,
    INTERNAL_PERMISSIONS.AUDIT_EXPORT,
    INTERNAL_PERMISSIONS.SECURITY_OVERRIDE,
  ]

  forbidden.forEach((permissionCode) => {
    assert.equal(
      permissions.has(permissionCode),
      false,
      `expected ${permissionCode} to remain blocked`
    )
  })

  const walletAllowed = [
    INTERNAL_PERMISSIONS.WALLET_LOOKUP,
    INTERNAL_PERMISSIONS.WALLET_BALANCE_VIEW,
    INTERNAL_PERMISSIONS.WALLET_TRANSACTIONS_VIEW,
    INTERNAL_PERMISSIONS.WALLET_POINTS_VIEW,
  ]

  walletAllowed.forEach((permissionCode) => {
    assert.equal(
      permissions.has(permissionCode),
      true,
      `expected ${permissionCode} to be granted`
    )
  })

  const walletForbidden = [
    INTERNAL_PERMISSIONS.WALLET_POINTS_ADJUST,
    INTERNAL_PERMISSIONS.WALLET_REFUND_REQUEST,
    INTERNAL_PERMISSIONS.WALLET_WALLET_CREDIT_ISSUE,
    INTERNAL_PERMISSIONS.WALLET_LEDGER_ADJUST,
    INTERNAL_PERMISSIONS.WALLET_BALANCE_TRANSFER,
  ]

  walletForbidden.forEach((permissionCode) => {
    assert.equal(
      permissions.has(permissionCode),
      false,
      `expected ${permissionCode} to remain blocked`
    )
  })
})

test("finance manager gets finance workflow access without station or security powers", () => {
  const permissions = new Set(resolveEffectiveInternalPermissions([INTERNAL_ROLE_CODES.FINANCE_MANAGER], []))

  const allowed = [
    INTERNAL_PERMISSIONS.OVERVIEW_VIEW,
    INTERNAL_PERMISSIONS.FINANCE_VIEW,
    INTERNAL_PERMISSIONS.FINANCE_SETTLE,
    INTERNAL_PERMISSIONS.FINANCE_SETTLEMENT_REJECT,
    INTERNAL_PERMISSIONS.FINANCE_REFUND_APPROVE,
    INTERNAL_PERMISSIONS.AUDIT_VIEW,
  ]

  allowed.forEach((permissionCode) => {
    assert.equal(
      permissions.has(permissionCode),
      true,
      `expected ${permissionCode} to be granted`
    )
  })

  const forbidden = [
    INTERNAL_PERMISSIONS.STATIONS_VIEW,
    INTERNAL_PERMISSIONS.STATIONS_CONFIGURE,
    INTERNAL_PERMISSIONS.STATIONS_ACTIVATE,
    INTERNAL_PERMISSIONS.SUPPORT_VIEW,
    INTERNAL_PERMISSIONS.STAFF_MANAGE,
    INTERNAL_PERMISSIONS.SETTINGS_EDIT,
    INTERNAL_PERMISSIONS.SECURITY_OVERRIDE,
    INTERNAL_PERMISSIONS.SECURITY_FORCE_SIGN_OUT,
    INTERNAL_PERMISSIONS.SECURITY_LOCK_ACCOUNT,
    INTERNAL_PERMISSIONS.AUDIT_EXPORT,
  ]

  forbidden.forEach((permissionCode) => {
    assert.equal(
      permissions.has(permissionCode),
      false,
      `expected ${permissionCode} to remain blocked`
    )
  })

  const walletAllowed = [
    INTERNAL_PERMISSIONS.WALLET_LOOKUP,
    INTERNAL_PERMISSIONS.WALLET_BALANCE_VIEW,
    INTERNAL_PERMISSIONS.WALLET_TRANSACTIONS_VIEW,
    INTERNAL_PERMISSIONS.WALLET_POINTS_VIEW,
    INTERNAL_PERMISSIONS.WALLET_POINTS_ADJUST,
    INTERNAL_PERMISSIONS.WALLET_REFUND_REQUEST,
    INTERNAL_PERMISSIONS.WALLET_WALLET_CREDIT_ISSUE,
    INTERNAL_PERMISSIONS.WALLET_AUDIT_VIEW,
    INTERNAL_PERMISSIONS.WALLET_REVIEW_MARK,
    INTERNAL_PERMISSIONS.WALLET_STATEMENT_EXPORT,
    INTERNAL_PERMISSIONS.WALLET_FREEZE,
    INTERNAL_PERMISSIONS.WALLET_UNFREEZE,
  ]

  walletAllowed.forEach((permissionCode) => {
    assert.equal(
      permissions.has(permissionCode),
      true,
      `expected ${permissionCode} to be granted`
    )
  })

  const walletForbidden = [
    INTERNAL_PERMISSIONS.WALLET_LEDGER_ADJUST,
    INTERNAL_PERMISSIONS.WALLET_BALANCE_TRANSFER,
    INTERNAL_PERMISSIONS.WALLET_HOLD_PLACE,
    INTERNAL_PERMISSIONS.WALLET_HOLD_RELEASE,
  ]

  walletForbidden.forEach((permissionCode) => {
    assert.equal(
      permissions.has(permissionCode),
      false,
      `expected ${permissionCode} to remain blocked`
    )
  })
})

test("risk compliance officer gets risk and audit access without finance or station setup powers", () => {
  const permissions = new Set(resolveEffectiveInternalPermissions([INTERNAL_ROLE_CODES.RISK_COMPLIANCE_OFFICER], []))

  const allowed = [
    INTERNAL_PERMISSIONS.OVERVIEW_VIEW,
    INTERNAL_PERMISSIONS.RISK_VIEW,
    INTERNAL_PERMISSIONS.RISK_FREEZE,
    INTERNAL_PERMISSIONS.RISK_UNFREEZE,
    INTERNAL_PERMISSIONS.AUDIT_VIEW,
    INTERNAL_PERMISSIONS.AUDIT_EXPORT,
    INTERNAL_PERMISSIONS.SECURITY_EVENT_DETAIL,
  ]

  allowed.forEach((permissionCode) => {
    assert.equal(
      permissions.has(permissionCode),
      true,
      `expected ${permissionCode} to be granted`
    )
  })

  const forbidden = [
    INTERNAL_PERMISSIONS.FINANCE_VIEW,
    INTERNAL_PERMISSIONS.FINANCE_SETTLE,
    INTERNAL_PERMISSIONS.FINANCE_REFUND_APPROVE,
    INTERNAL_PERMISSIONS.STATIONS_CONFIGURE,
    INTERNAL_PERMISSIONS.STATIONS_ACTIVATE,
    INTERNAL_PERMISSIONS.STAFF_MANAGE,
    INTERNAL_PERMISSIONS.SETTINGS_EDIT,
    INTERNAL_PERMISSIONS.SECURITY_OVERRIDE,
  ]

  forbidden.forEach((permissionCode) => {
    assert.equal(
      permissions.has(permissionCode),
      false,
      `expected ${permissionCode} to remain blocked`
    )
  })
})

test("platform infrastructure engineer gets admin wallet controls", () => {
  const permissions = new Set(resolveEffectiveInternalPermissions([INTERNAL_ROLE_CODES.PLATFORM_INFRASTRUCTURE_ENGINEER], []))

  const allowed = [
    INTERNAL_PERMISSIONS.WALLET_LOOKUP,
    INTERNAL_PERMISSIONS.WALLET_BALANCE_VIEW,
    INTERNAL_PERMISSIONS.WALLET_TRANSACTIONS_VIEW,
    INTERNAL_PERMISSIONS.WALLET_POINTS_VIEW,
    INTERNAL_PERMISSIONS.WALLET_POINTS_ADJUST,
    INTERNAL_PERMISSIONS.WALLET_REFUND_REQUEST,
    INTERNAL_PERMISSIONS.WALLET_WALLET_CREDIT_ISSUE,
    INTERNAL_PERMISSIONS.WALLET_LEDGER_ADJUST,
    INTERNAL_PERMISSIONS.WALLET_BALANCE_TRANSFER,
    INTERNAL_PERMISSIONS.WALLET_AUDIT_VIEW,
    INTERNAL_PERMISSIONS.WALLET_FREEZE,
    INTERNAL_PERMISSIONS.WALLET_UNFREEZE,
    INTERNAL_PERMISSIONS.WALLET_REVIEW_MARK,
    INTERNAL_PERMISSIONS.WALLET_STATEMENT_EXPORT,
    INTERNAL_PERMISSIONS.WALLET_HOLD_PLACE,
    INTERNAL_PERMISSIONS.WALLET_HOLD_RELEASE,
  ]

  allowed.forEach((permissionCode) => {
    assert.equal(
      permissions.has(permissionCode),
      true,
      `expected ${permissionCode} to be granted`
    )
  })
})
