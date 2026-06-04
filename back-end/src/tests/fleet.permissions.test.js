import test from "node:test"
import assert from "node:assert/strict"
import {
  FLEET_PERMISSIONS,
  isFleetManagerRole,
  normalizeFleetRole,
  roleHasFleetPermission,
} from "../modules/fleet/permissions.js"
import {
  financialOpsQuerySchema,
  fleetAllocationAdjustmentSchema,
  fleetAllocationRolloverSchema,
  fleetAllocationV2Schema,
  fleetFuelCardProviderSchema,
  fleetFuelCardReconciliationActionSchema,
  fleetFuelCardSchema,
  fleetFuelNowSchema,
  fleetBudgetSchema,
  fleetInvoiceSchema,
  fleetMaintenanceSchema,
  fleetRouteActivitySchema,
  fleetVehicleLiveStateSchema,
  fuelRequestSchema,
  inviteMemberSchema,
} from "../modules/fleet/schemas.js"

test("fleet manager roles exclude driver-only members", () => {
  assert.equal(isFleetManagerRole("owner"), true)
  assert.equal(isFleetManagerRole("admin"), true)
  assert.equal(isFleetManagerRole("finance"), true)
  assert.equal(isFleetManagerRole("dispatcher"), true)
  assert.equal(isFleetManagerRole("auditor"), true)
  assert.equal(isFleetManagerRole("driver"), false)
})

test("fleet role permissions enforce driver manager denial", () => {
  assert.equal(roleHasFleetPermission("owner", FLEET_PERMISSIONS.MEMBERS_MANAGE), true)
  assert.equal(roleHasFleetPermission("finance", FLEET_PERMISSIONS.WALLET_MANAGE), true)
  assert.equal(roleHasFleetPermission("finance", FLEET_PERMISSIONS.ALLOCATIONS_MANAGE), true)
  assert.equal(roleHasFleetPermission("finance", FLEET_PERMISSIONS.FUEL_CARDS_MANAGE), true)
  assert.equal(roleHasFleetPermission("dispatcher", FLEET_PERMISSIONS.FUEL_NOW_COMPLETE), true)
  assert.equal(roleHasFleetPermission("auditor", FLEET_PERMISSIONS.AUDIT_VIEW), true)
  assert.equal(roleHasFleetPermission("driver", FLEET_PERMISSIONS.DASHBOARD_VIEW), false)
  assert.equal(roleHasFleetPermission("driver", FLEET_PERMISSIONS.ALLOCATIONS_VIEW), false)
  assert.equal(roleHasFleetPermission("driver", FLEET_PERMISSIONS.DRIVER_MODE), true)
})

test("fleet role normalization is strict", () => {
  assert.equal(normalizeFleetRole(" OWNER "), "owner")
  assert.equal(normalizeFleetRole("fleet-admin"), "")
})

test("fleet invitation schema requires SmartLink ID, email, or phone", () => {
  assert.throws(() => {
    inviteMemberSchema.parse({
      role: "driver",
    })
  }, /SmartLink ID, email, or phone is required/)

  const payload = inviteMemberSchema.parse({
    email: "driver@example.com",
    role: "driver",
  })
  assert.equal(payload.email, "driver@example.com")
  assert.equal(payload.role, "driver")

  const smartlinkIdPayload = inviteMemberSchema.parse({
    userPublicId: "SLU123456789",
    role: "driver",
  })
  assert.equal(smartlinkIdPayload.userPublicId, "SLU123456789")
  assert.equal(smartlinkIdPayload.role, "driver")
})

test("fleet fuel request schema requires amount or litres", () => {
  assert.throws(() => {
    fuelRequestSchema.parse({
      fleetId: "FLT123456789",
      vehicleId: "VEH123456789",
    })
  }, /requestedAmount or requestedLitres is required/)

  const payload = fuelRequestSchema.parse({
    fleetId: "FLT123456789",
    vehicleId: "VEH123456789",
    requestedAmount: 50000,
  })
  assert.equal(payload.requestedAmount, 50000)
})

test("fleet financial ops schemas validate DB-backed records", () => {
  assert.deepEqual(financialOpsQuerySchema.parse({ month: "2026-05" }), { month: "2026-05" })

  const budget = fleetBudgetSchema.parse({
    budgetMonth: "2026-05-01",
    fuelBudget: 4200000,
    maintenanceBudget: 850000,
    otherBudget: 350000,
    revenueTarget: 12800000,
  })
  assert.equal(budget.status, "active")
  assert.equal(budget.fuelBudget, 4200000)

  const invoice = fleetInvoiceSchema.parse({
    invoiceNumber: "MBEYA-2026-05-001",
    subtotal: 980000,
    totalAmount: 980000,
    dueAt: "2026-05-31T00:00:00.000Z",
  })
  assert.equal(invoice.status, "pending")

  const maintenance = fleetMaintenanceSchema.parse({
    vehicleId: "FLTVEHBT2034000000000001",
    title: "5,000 km service",
    dueAt: "2026-05-31T00:00:00.000Z",
  })
  assert.equal(maintenance.recordType, "service")
  assert.equal(maintenance.status, "due")

  const route = fleetRouteActivitySchema.parse({
    routeName: "Limbe - Chileka shuttle",
    routeStatus: "active",
    distanceKm: 186.4,
    fuelCost: 118500,
  })
  assert.equal(route.distanceKm, 186.4)

  const liveState = fleetVehicleLiveStateSchema.parse({
    vehicleId: "FLTVEHBT2034000000000001",
    fuelPercent: 62,
    operationalStatus: "active",
    latitude: -15.8069,
    longitude: 35.052,
  })
  assert.equal(liveState.fuelPercent, 62)
})

test("fleet financial ops schemas reject invalid limits", () => {
  assert.throws(() => {
    fleetVehicleLiveStateSchema.parse({
      vehicleId: "FLTVEHBT2034000000000001",
      fuelPercent: 120,
    })
  })

  assert.throws(() => {
    fleetBudgetSchema.parse({
      budgetMonth: "2026-05-01",
      fuelBudget: -1,
    })
  })
})

test("fleet V2 schemas validate allocations, fuel-now, and cards", () => {
  const allocation = fleetAllocationV2Schema.parse({
    allocationTargetType: "driver",
    allocationUnit: "both",
    driverUserPublicId: "SLU123456789",
    vehicleId: "FLTVEHBT2034000000000001",
    monthlyLitreCap: 120,
    monthlyMoneyCap: 180000,
    periodStart: "2026-05-01",
    periodEnd: "2026-05-31",
  })
  assert.equal(allocation.rolloverPolicy, "top_up_to_cap")
  assert.equal(allocation.monthlyLitreCap, 120)

  const adjustment = fleetAllocationAdjustmentSchema.parse({
    transactionType: "allocation_topup",
    litres: 50,
  })
  assert.equal(adjustment.transactionType, "allocation_topup")

  const rollover = fleetAllocationRolloverSchema.parse({
    allocationIds: ["FLTALLOCPOOL000000000001"],
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
  })
  assert.equal(rollover.allocationIds.length, 1)

  const fuelNow = fleetFuelNowSchema.parse({
    fleetId: "FLTMBEYALOGISTICS000000001",
    vehicleId: "FLTVEHBT2034000000000001",
    requestedLitres: 30,
    odometerReading: 45000,
  })
  assert.equal(fuelNow.paymentContextType, "fleet_wallet")

  const provider = fleetFuelCardProviderSchema.parse({
    name: "MyFuel",
    type: "myfuel",
  })
  assert.equal(provider.supportsApi, false)

  const card = fleetFuelCardSchema.parse({
    providerId: "FLTPROVMYFUEL0000000001",
    cardLabel: "Operations MyFuel Shared Card",
    maskedCardNumber: "****4821",
    providerStatus: "api_not_connected",
  })
  assert.equal(card.providerStatus, "api_not_connected")

  const reconciliation = fleetFuelCardReconciliationActionSchema.parse({
    fleetTransactionId: "FLTTXREF000000000000001",
    notes: "Matched manually",
  })
  assert.equal(reconciliation.status, "matched")
})

test("fleet V2 schemas reject missing allocation quantity and fuel-now quantity", () => {
  assert.throws(() => {
    fleetAllocationAdjustmentSchema.parse({})
  }, /litres or amount is required/)

  assert.throws(() => {
    fleetFuelNowSchema.parse({
      fleetId: "FLTMBEYALOGISTICS000000001",
      vehicleId: "FLTVEHBT2034000000000001",
      odometerReading: 45000,
    })
  }, /requestedLitres or requestedAmount is required/)
})
