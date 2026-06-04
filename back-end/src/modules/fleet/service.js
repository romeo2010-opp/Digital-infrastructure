import { Prisma } from "@prisma/client"
import { prisma } from "../../db/prisma.js"
import { badRequest, notFound } from "../../utils/http.js"
import { toUtcMysqlDateTime } from "../../utils/dateTime.js"
import { createPublicId } from "../common/db.js"
import { sendPushAlertToUser } from "../common/pushNotifications.js"
import { createUserAlert, ensureUserAlertsTableReady } from "../common/userAlerts.js"
import { publishUserAlert } from "../../realtime/userAlertsHub.js"
import {
  FLEET_ACCOUNT_STATUSES,
  FLEET_MEMBER_STATUSES,
  FLEET_PERMISSIONS,
  describeFleetRole,
  isFleetManagerRole,
  normalizeFleetRole,
  roleHasFleetPermission,
} from "./permissions.js"

const DEFAULT_CURRENCY = "MWK"
const LOW_WALLET_THRESHOLD_MWK = Number(process.env.FLEET_LOW_WALLET_THRESHOLD_MWK || 100000)
const FLEET_ADMIN_MANAGE_ROLES = new Set(["owner", "admin"])
const FLEET_ALLOCATION_MANAGE_ROLES = new Set(["owner", "admin", "finance"])
const FLEET_CARD_MANAGE_ROLES = new Set(["owner", "admin", "finance"])
const FLEET_OPERATION_ROLES = new Set(["owner", "admin", "dispatcher"])

function fleetError(message, status = 400) {
  const error = new Error(message)
  error.status = status
  return error
}

function forbidden(message = "Fleet permission denied") {
  return fleetError(message, 403)
}

function toMoneyNumber(value) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 0
  return Number(numeric.toFixed(2))
}

function toLitresNumber(value) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 0
  return Number(numeric.toFixed(3))
}

function toIsoOrNull(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function toSqlDateTimeOrNull(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return toUtcMysqlDateTime(date)
}

function nullableText(value) {
  const normalized = String(value || "").trim()
  return normalized || null
}

function parseJsonObject(value) {
  if (!value || typeof value !== "string") return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function parseJsonArray(value) {
  if (!value || typeof value !== "string") return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function buildReference(prefix) {
  return `${prefix}-${createPublicId()}`
}

function readClientIp(req) {
  return (req?.header?.("x-forwarded-for") || req?.ip || "").split(",")[0].trim().slice(0, 64) || null
}

function normalizeFuelType(value, fallback = "unknown") {
  const normalized = String(value || fallback).trim().toLowerCase()
  if (["petrol", "diesel", "mixed", "unknown"].includes(normalized)) return normalized
  return fallback
}

function mapFleetAccountRow(row) {
  if (!row) return null
  return {
    id: Number(row.id || 0),
    publicId: String(row.public_id || "").trim(),
    name: String(row.name || "").trim(),
    businessType: String(row.business_type || "").trim(),
    registrationNumber: nullableText(row.registration_number),
    ownerUserId: Number(row.owner_user_id || 0) || null,
    primaryContactName: String(row.primary_contact_name || "").trim(),
    primaryContactPhone: String(row.primary_contact_phone || "").trim(),
    billingEmail: nullableText(row.billing_email),
    status: String(row.status || "active").trim(),
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
  }
}

function mapMembershipRow(row) {
  if (!row) return null
  return {
    id: Number(row.id || 0),
    publicId: String(row.public_id || "").trim(),
    fleetAccountId: Number(row.fleet_account_id || 0),
    userId: Number(row.user_id || 0),
    role: String(row.role || "").trim(),
    roleLabel: describeFleetRole(row.role),
    status: String(row.status || "").trim(),
    invitedAt: toIsoOrNull(row.invited_at),
    acceptedAt: toIsoOrNull(row.accepted_at),
    lastAccessedAt: toIsoOrNull(row.last_accessed_at),
    user: {
      publicId: nullableText(row.user_public_id),
      fullName: nullableText(row.full_name),
      email: nullableText(row.email),
      phone: nullableText(row.phone_e164),
    },
    fleet: row.fleet_public_id
      ? {
          publicId: String(row.fleet_public_id || "").trim(),
          name: String(row.fleet_name || "").trim(),
          businessType: nullableText(row.business_type),
          status: String(row.fleet_status || "").trim(),
        }
      : null,
    canManageDashboard: isFleetManagerRole(row.role) && String(row.status || "").trim() === "active",
  }
}

function mapVehicleRow(row) {
  if (!row) return null
  return {
    id: Number(row.id || 0),
    publicId: String(row.public_id || "").trim(),
    fleetAccountId: Number(row.fleet_account_id || 0),
    plateNumber: String(row.plate_number || "").trim(),
    vehicleName: nullableText(row.vehicle_name),
    vehicleType: nullableText(row.vehicle_type),
    fuelType: String(row.fuel_type || "unknown").trim(),
    tankCapacityLitres: row.tank_capacity_litres === null || row.tank_capacity_litres === undefined ? null : Number(row.tank_capacity_litres),
    currentOdometer: row.current_odometer === null || row.current_odometer === undefined ? null : Number(row.current_odometer),
    status: String(row.status || "active").trim(),
    monthlySpend: toMoneyNumber(row.monthly_spend),
    lastFuelingAt: toIsoOrNull(row.last_fueling_at),
    assignedDrivers: parseJsonArray(row.assigned_drivers_json),
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
  }
}

function mapWalletRow(row) {
  if (!row) return null
  const balance = toMoneyNumber(row.balance)
  const reservedBalance = toMoneyNumber(row.reserved_balance)
  return {
    id: Number(row.id || 0),
    publicId: String(row.public_id || "").trim(),
    fleetAccountId: Number(row.fleet_account_id || 0),
    balance,
    reservedBalance,
    availableBalance: toMoneyNumber(balance - reservedBalance),
    currency: String(row.currency || DEFAULT_CURRENCY).trim() || DEFAULT_CURRENCY,
    status: String(row.status || "active").trim(),
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
  }
}

function mapWalletTransactionRow(row) {
  return {
    publicId: String(row.public_id || "").trim(),
    type: String(row.type || "").trim(),
    status: String(row.status || "").trim(),
    amount: toMoneyNumber(row.amount),
    currency: String(row.currency || DEFAULT_CURRENCY).trim() || DEFAULT_CURRENCY,
    reference: String(row.reference || "").trim(),
    description: nullableText(row.description),
    relatedEntityType: nullableText(row.related_entity_type),
    relatedEntityId: nullableText(row.related_entity_id),
    createdByUser: row.created_by_public_id
      ? {
          publicId: String(row.created_by_public_id || "").trim(),
          fullName: nullableText(row.created_by_name),
        }
      : null,
    createdAt: toIsoOrNull(row.created_at),
  }
}

function mapFuelRequestRow(row) {
  return {
    id: Number(row.id || 0),
    publicId: String(row.public_id || "").trim(),
    fleetAccountId: Number(row.fleet_account_id || 0),
    requestedAmount: row.requested_amount === null || row.requested_amount === undefined ? null : toMoneyNumber(row.requested_amount),
    requestedLitres: row.requested_litres === null || row.requested_litres === undefined ? null : toLitresNumber(row.requested_litres),
    approvedAmount: row.approved_amount === null || row.approved_amount === undefined ? null : toMoneyNumber(row.approved_amount),
    approvedLitres: row.approved_litres === null || row.approved_litres === undefined ? null : toLitresNumber(row.approved_litres),
    odometerReading: row.odometer_reading === null || row.odometer_reading === undefined ? null : Number(row.odometer_reading),
    reason: nullableText(row.reason),
    status: String(row.status || "").trim(),
    approvedAt: toIsoOrNull(row.approved_at),
    rejectedReason: nullableText(row.rejected_reason),
    holdAmount: toMoneyNumber(row.hold_amount),
    holdReference: nullableText(row.hold_reference),
    expiresAt: toIsoOrNull(row.expires_at),
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
    driver: {
      publicId: nullableText(row.driver_public_id),
      fullName: nullableText(row.driver_name),
      email: nullableText(row.driver_email),
      phone: nullableText(row.driver_phone),
    },
    approvedBy: row.approver_public_id
      ? {
          publicId: nullableText(row.approver_public_id),
          fullName: nullableText(row.approver_name),
        }
      : null,
    vehicle: {
      publicId: nullableText(row.vehicle_public_id),
      plateNumber: nullableText(row.plate_number),
      vehicleName: nullableText(row.vehicle_name),
      fuelType: nullableText(row.vehicle_fuel_type),
      status: nullableText(row.vehicle_status),
    },
    fleet: row.fleet_public_id
      ? {
          publicId: nullableText(row.fleet_public_id),
          name: nullableText(row.fleet_name),
        }
      : null,
    station: row.station_public_id
      ? {
          publicId: nullableText(row.station_public_id),
          name: nullableText(row.station_name),
        }
      : null,
  }
}

function mapTransactionRow(row) {
  return {
    publicId: String(row.public_id || "").trim(),
    litres: toLitresNumber(row.litres),
    amount: toMoneyNumber(row.amount),
    pricePerLitre: Number(row.price_per_litre || 0),
    fuelType: String(row.fuel_type || "").trim(),
    odometerReading: row.odometer_reading === null || row.odometer_reading === undefined ? null : Number(row.odometer_reading),
    kmSinceLastFuel: row.km_since_last_fuel === null || row.km_since_last_fuel === undefined ? null : Number(row.km_since_last_fuel),
    kmPerLitre: row.km_per_litre === null || row.km_per_litre === undefined ? null : Number(row.km_per_litre),
    costPerKm: row.cost_per_km === null || row.cost_per_km === undefined ? null : toMoneyNumber(row.cost_per_km),
    paymentContextType: nullableText(row.payment_context_type) || "fleet_wallet",
    status: String(row.status || "").trim(),
    riskStatus: String(row.risk_status || "").trim(),
    riskReason: nullableText(row.risk_reason),
    walletTransactionReference: nullableText(row.wallet_transaction_reference),
    createdAt: toIsoOrNull(row.created_at),
    vehicle: {
      publicId: nullableText(row.vehicle_public_id),
      plateNumber: nullableText(row.plate_number),
      vehicleName: nullableText(row.vehicle_name),
    },
    driver: {
      publicId: nullableText(row.driver_public_id),
      fullName: nullableText(row.driver_name),
      email: nullableText(row.driver_email),
      phone: nullableText(row.driver_phone),
    },
    station: {
      publicId: nullableText(row.station_public_id),
      name: nullableText(row.station_name),
    },
    department: row.department_public_id ? { publicId: nullableText(row.department_public_id), name: nullableText(row.department_name), code: nullableText(row.department_code) } : null,
    allocation: row.allocation_public_id ? { publicId: nullableText(row.allocation_public_id), allocationTargetType: nullableText(row.allocation_target_type) } : null,
    fuelCard: row.fuel_card_public_id ? { publicId: nullableText(row.fuel_card_public_id), cardLabel: nullableText(row.card_label), maskedCardNumber: nullableText(row.masked_card_number) } : null,
    pump: row.pump_public_id
      ? {
          publicId: nullableText(row.pump_public_id),
          pumpNumber: row.pump_number === null || row.pump_number === undefined ? null : Number(row.pump_number),
        }
      : null,
    nozzle: row.nozzle_public_id
      ? {
          publicId: nullableText(row.nozzle_public_id),
          nozzleNumber: nullableText(row.nozzle_number),
        }
      : null,
    fuelRequest: row.fuel_request_public_id ? { publicId: nullableText(row.fuel_request_public_id) } : null,
  }
}

function mapPolicyRow(row) {
  return {
    publicId: String(row.public_id || "").trim(),
    name: String(row.name || "").trim(),
    appliesToType: String(row.applies_to_type || "fleet").trim(),
    appliesToId: row.applies_to_id === null || row.applies_to_id === undefined ? null : Number(row.applies_to_id),
    dailyAmountLimit: row.daily_amount_limit === null || row.daily_amount_limit === undefined ? null : toMoneyNumber(row.daily_amount_limit),
    weeklyAmountLimit: row.weekly_amount_limit === null || row.weekly_amount_limit === undefined ? null : toMoneyNumber(row.weekly_amount_limit),
    monthlyAmountLimit: row.monthly_amount_limit === null || row.monthly_amount_limit === undefined ? null : toMoneyNumber(row.monthly_amount_limit),
    dailyLitreLimit: row.daily_litre_limit === null || row.daily_litre_limit === undefined ? null : toLitresNumber(row.daily_litre_limit),
    monthlyLitreLimit: row.monthly_litre_limit === null || row.monthly_litre_limit === undefined ? null : toLitresNumber(row.monthly_litre_limit),
    allowedFuelType: nullableText(row.allowed_fuel_type),
    allowedStationIds: parseJsonArray(row.allowed_station_ids_json),
    requiresApprovalAboveAmount:
      row.requires_approval_above_amount === null || row.requires_approval_above_amount === undefined
        ? null
        : toMoneyNumber(row.requires_approval_above_amount),
    active: Boolean(row.active),
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
  }
}

function mapInvitationRow(row) {
  const metadata = parseJsonObject(row.metadata_json)
  return {
    publicId: String(row.public_id || "").trim(),
    inviteeName: nullableText(row.invitee_name),
    inviteeEmail: nullableText(row.invitee_email),
    inviteePhone: nullableText(row.invitee_phone),
    role: String(row.role || "").trim(),
    roleLabel: describeFleetRole(row.role),
    status: String(row.status || "").trim(),
    expiresAt: toIsoOrNull(row.expires_at),
    acceptedAt: toIsoOrNull(row.accepted_at),
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
    metadata,
    targetUserPublicId: nullableText(metadata.targetUserPublicId),
    assignedVehicleId: nullableText(metadata.assignedVehicleId),
    matchedUser: row.matched_user_public_id
      ? {
          publicId: nullableText(row.matched_user_public_id),
          fullName: nullableText(row.matched_user_name),
          email: nullableText(row.matched_user_email),
          phone: nullableText(row.matched_user_phone),
        }
      : null,
    assignedVehicle: row.assigned_vehicle_public_id
      ? {
          publicId: nullableText(row.assigned_vehicle_public_id),
          plateNumber: nullableText(row.assigned_plate_number),
          vehicleName: nullableText(row.assigned_vehicle_name),
        }
      : null,
    invitedBy: row.invited_by_public_id
      ? {
          publicId: nullableText(row.invited_by_public_id),
          fullName: nullableText(row.invited_by_name),
        }
      : null,
    acceptedBy: row.accepted_by_public_id
      ? {
          publicId: nullableText(row.accepted_by_public_id),
          fullName: nullableText(row.accepted_by_name),
        }
      : null,
    delivery: {
      matchedExistingUser: Boolean(row.matched_user_public_id),
      inAppNotificationAvailable: Boolean(row.matched_user_public_id),
      smsPendingIntegration: Boolean(row.invitee_phone),
      emailPendingIntegration: Boolean(row.invitee_email),
    },
  }
}

function mapBudgetRow(row) {
  return {
    publicId: String(row.public_id || "").trim(),
    budgetMonth: row.budget_month instanceof Date ? row.budget_month.toISOString().slice(0, 10) : String(row.budget_month || "").slice(0, 10),
    fuelBudget: toMoneyNumber(row.fuel_budget),
    maintenanceBudget: toMoneyNumber(row.maintenance_budget),
    otherBudget: toMoneyNumber(row.other_budget),
    revenueTarget: toMoneyNumber(row.revenue_target),
    totalBudget: toMoneyNumber(Number(row.fuel_budget || 0) + Number(row.maintenance_budget || 0) + Number(row.other_budget || 0)),
    status: String(row.status || "active").trim(),
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
  }
}

function mapInvoiceRow(row) {
  return {
    publicId: String(row.public_id || "").trim(),
    invoiceNumber: String(row.invoice_number || "").trim(),
    billingPeriodStart: row.billing_period_start instanceof Date ? row.billing_period_start.toISOString().slice(0, 10) : nullableText(row.billing_period_start),
    billingPeriodEnd: row.billing_period_end instanceof Date ? row.billing_period_end.toISOString().slice(0, 10) : nullableText(row.billing_period_end),
    status: String(row.status || "pending").trim(),
    subtotal: toMoneyNumber(row.subtotal),
    taxAmount: toMoneyNumber(row.tax_amount),
    totalAmount: toMoneyNumber(row.total_amount),
    paidAmount: toMoneyNumber(row.paid_amount),
    balanceDue: toMoneyNumber(Number(row.total_amount || 0) - Number(row.paid_amount || 0)),
    dueAt: toIsoOrNull(row.due_at),
    paidAt: toIsoOrNull(row.paid_at),
    notes: nullableText(row.notes),
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
  }
}

function mapMaintenanceRow(row) {
  return {
    publicId: String(row.public_id || "").trim(),
    recordType: String(row.record_type || "service").trim(),
    maintenanceType: nullableText(row.maintenance_type),
    status: String(row.status || "due").trim(),
    title: String(row.title || "").trim(),
    costEstimate: toMoneyNumber(row.cost_estimate),
    costActual: toMoneyNumber(row.cost_actual),
    odometerReading: row.odometer_reading === null || row.odometer_reading === undefined ? null : Number(row.odometer_reading),
    lastServiceOdometer: row.last_service_odometer === null || row.last_service_odometer === undefined ? null : Number(row.last_service_odometer),
    nextServiceOdometer: row.next_service_odometer === null || row.next_service_odometer === undefined ? null : Number(row.next_service_odometer),
    lastServiceDate: row.last_service_date instanceof Date ? row.last_service_date.toISOString().slice(0, 10) : nullableText(row.last_service_date),
    nextServiceDate: row.next_service_date instanceof Date ? row.next_service_date.toISOString().slice(0, 10) : nullableText(row.next_service_date),
    dueAt: toIsoOrNull(row.due_at),
    completedAt: toIsoOrNull(row.completed_at),
    notes: nullableText(row.notes),
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
    vehicle: {
      publicId: nullableText(row.vehicle_public_id),
      plateNumber: nullableText(row.plate_number),
      vehicleName: nullableText(row.vehicle_name),
      vehicleType: nullableText(row.vehicle_type),
    },
  }
}

function mapRouteActivityRow(row) {
  return {
    publicId: String(row.public_id || "").trim(),
    routeName: String(row.route_name || "").trim(),
    routeStatus: String(row.route_status || "planned").trim(),
    distanceKm: Number(row.distance_km || 0),
    fuelCost: toMoneyNumber(row.fuel_cost),
    otherCost: toMoneyNumber(row.other_cost),
    revenueAmount: toMoneyNumber(row.revenue_amount),
    totalCost: toMoneyNumber(Number(row.fuel_cost || 0) + Number(row.other_cost || 0)),
    costPerKm: Number(row.distance_km || 0) > 0 ? toMoneyNumber((Number(row.fuel_cost || 0) + Number(row.other_cost || 0)) / Number(row.distance_km || 1)) : 0,
    startedAt: toIsoOrNull(row.started_at),
    completedAt: toIsoOrNull(row.completed_at),
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
    vehicle: row.vehicle_public_id
      ? {
          publicId: nullableText(row.vehicle_public_id),
          plateNumber: nullableText(row.plate_number),
          vehicleName: nullableText(row.vehicle_name),
        }
      : null,
    driver: row.driver_public_id
      ? {
          publicId: nullableText(row.driver_public_id),
          fullName: nullableText(row.driver_name),
          phone: nullableText(row.driver_phone),
        }
      : null,
  }
}

function mapVehicleLiveStateRow(row) {
  return {
    publicId: String(row.public_id || "").trim(),
    fuelPercent: row.fuel_percent === null || row.fuel_percent === undefined ? null : Number(row.fuel_percent),
    operationalStatus: String(row.operational_status || "offline").trim(),
    locationLabel: nullableText(row.location_label),
    latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
    longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
    speedKph: row.speed_kph === null || row.speed_kph === undefined ? null : Number(row.speed_kph),
    lastSeenAt: toIsoOrNull(row.last_seen_at),
    updatedAt: toIsoOrNull(row.updated_at),
    vehicle: {
      publicId: nullableText(row.vehicle_public_id),
      plateNumber: nullableText(row.plate_number),
      vehicleName: nullableText(row.vehicle_name),
      vehicleType: nullableText(row.vehicle_type),
      status: nullableText(row.vehicle_status),
      currentOdometer: row.current_odometer === null || row.current_odometer === undefined ? null : Number(row.current_odometer),
    },
    assignedDrivers: parseJsonArray(row.assigned_drivers_json),
  }
}

function mapDepartmentRow(row) {
  return {
    publicId: String(row.public_id || "").trim(),
    name: String(row.name || "").trim(),
    code: nullableText(row.code),
    status: String(row.status || "active").trim(),
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
    manager: row.manager_public_id
      ? {
          publicId: nullableText(row.manager_public_id),
          fullName: nullableText(row.manager_name),
          phone: nullableText(row.manager_phone),
          email: nullableText(row.manager_email),
        }
      : null,
  }
}

function mapAllocationRow(row) {
  return {
    publicId: String(row.public_id || "").trim(),
    allocationTargetType: String(row.allocation_target_type || "fleet").trim(),
    allocationUnit: String(row.allocation_unit || "litres").trim(),
    monthlyLitreCap: row.monthly_litre_cap === null || row.monthly_litre_cap === undefined ? null : toLitresNumber(row.monthly_litre_cap),
    monthlyMoneyCap: row.monthly_money_cap === null || row.monthly_money_cap === undefined ? null : toMoneyNumber(row.monthly_money_cap),
    currentLitreBalance: toLitresNumber(row.current_litre_balance),
    currentMoneyBalance: toMoneyNumber(row.current_money_balance),
    usedLitresCurrentPeriod: toLitresNumber(row.used_litres_current_period),
    usedMoneyCurrentPeriod: toMoneyNumber(row.used_money_current_period),
    carryOverLitres: toLitresNumber(row.carry_over_litres),
    carryOverMoney: toMoneyNumber(row.carry_over_money),
    rolloverPolicy: String(row.rollover_policy || "top_up_to_cap").trim(),
    maxCarryoverLitres: row.max_carryover_litres === null || row.max_carryover_litres === undefined ? null : toLitresNumber(row.max_carryover_litres),
    maxCarryoverMoney: row.max_carryover_money === null || row.max_carryover_money === undefined ? null : toMoneyNumber(row.max_carryover_money),
    periodStart: row.period_start instanceof Date ? row.period_start.toISOString().slice(0, 10) : nullableText(row.period_start),
    periodEnd: row.period_end instanceof Date ? row.period_end.toISOString().slice(0, 10) : nullableText(row.period_end),
    status: String(row.status || "active").trim(),
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
    department: row.department_public_id
      ? {
          publicId: nullableText(row.department_public_id),
          name: nullableText(row.department_name),
          code: nullableText(row.department_code),
        }
      : null,
    vehicle: row.vehicle_public_id
      ? {
          publicId: nullableText(row.vehicle_public_id),
          plateNumber: nullableText(row.plate_number),
          vehicleName: nullableText(row.vehicle_name),
        }
      : null,
    driver: row.driver_public_id
      ? {
          publicId: nullableText(row.driver_public_id),
          fullName: nullableText(row.driver_name),
          phone: nullableText(row.driver_phone),
        }
      : null,
    fuelCard: row.fuel_card_public_id
      ? {
          publicId: nullableText(row.fuel_card_public_id),
          cardLabel: nullableText(row.card_label),
          maskedCardNumber: nullableText(row.masked_card_number),
          providerStatus: nullableText(row.provider_status),
        }
      : null,
  }
}

function mapFuelCardProviderRow(row) {
  return {
    publicId: String(row.public_id || "").trim(),
    name: String(row.name || "").trim(),
    type: String(row.type || "manual").trim(),
    supportsApi: Boolean(row.supports_api),
    status: String(row.status || "active").trim(),
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
  }
}

function mapFuelCardRow(row) {
  return {
    publicId: String(row.public_id || "").trim(),
    cardLabel: String(row.card_label || "").trim(),
    maskedCardNumber: String(row.masked_card_number || "").trim(),
    status: String(row.status || "active").trim(),
    providerStatus: String(row.provider_status || "manual_tracking").trim(),
    monthlyLitreLimit: row.monthly_litre_limit === null || row.monthly_litre_limit === undefined ? null : toLitresNumber(row.monthly_litre_limit),
    monthlyMoneyLimit: row.monthly_money_limit === null || row.monthly_money_limit === undefined ? null : toMoneyNumber(row.monthly_money_limit),
    dailyLitreLimit: row.daily_litre_limit === null || row.daily_litre_limit === undefined ? null : toLitresNumber(row.daily_litre_limit),
    dailyMoneyLimit: row.daily_money_limit === null || row.daily_money_limit === undefined ? null : toMoneyNumber(row.daily_money_limit),
    lastTransactionAt: toIsoOrNull(row.last_transaction_at),
    lastReconciledAt: toIsoOrNull(row.last_reconciled_at),
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
    provider: row.provider_public_id
      ? {
          publicId: nullableText(row.provider_public_id),
          name: nullableText(row.provider_name),
          type: nullableText(row.provider_type),
          supportsApi: Boolean(row.provider_supports_api),
        }
      : null,
    department: row.department_public_id ? { publicId: nullableText(row.department_public_id), name: nullableText(row.department_name), code: nullableText(row.department_code) } : null,
    vehicle: row.vehicle_public_id ? { publicId: nullableText(row.vehicle_public_id), plateNumber: nullableText(row.plate_number), vehicleName: nullableText(row.vehicle_name) } : null,
    driver: row.driver_public_id ? { publicId: nullableText(row.driver_public_id), fullName: nullableText(row.driver_name), phone: nullableText(row.driver_phone) } : null,
  }
}

function mapFuelCardTransactionRow(row) {
  return {
    publicId: String(row.public_id || "").trim(),
    externalReference: nullableText(row.external_reference),
    transactionDate: toIsoOrNull(row.transaction_date),
    stationName: nullableText(row.station_name),
    amount: row.amount === null || row.amount === undefined ? null : toMoneyNumber(row.amount),
    litres: row.litres === null || row.litres === undefined ? null : toLitresNumber(row.litres),
    fuelType: nullableText(row.fuel_type),
    odometerReading: row.odometer_reading === null || row.odometer_reading === undefined ? null : Number(row.odometer_reading),
    matchStatus: String(row.match_status || "unmatched").trim(),
    riskStatus: String(row.risk_status || "normal").trim(),
    rawData: parseJsonObject(row.raw_data_json),
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
    provider: row.provider_public_id ? { publicId: nullableText(row.provider_public_id), name: nullableText(row.provider_name), type: nullableText(row.provider_type) } : null,
    fuelCard: row.fuel_card_public_id ? { publicId: nullableText(row.fuel_card_public_id), cardLabel: nullableText(row.card_label), maskedCardNumber: nullableText(row.masked_card_number) } : null,
    station: row.station_public_id ? { publicId: nullableText(row.station_public_id), name: nullableText(row.smartlink_station_name) } : null,
  }
}

function mapReconciliationRow(row) {
  return {
    publicId: String(row.public_id || "").trim(),
    status: String(row.status || "needs_review").trim(),
    notes: nullableText(row.notes),
    matchedAt: toIsoOrNull(row.matched_at),
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
    cardTransaction: mapFuelCardTransactionRow({
      ...row,
      public_id: row.card_transaction_public_id,
      created_at: row.card_transaction_created_at,
      updated_at: row.card_transaction_updated_at,
    }),
    fleetTransaction: row.fleet_transaction_public_id
      ? {
          publicId: nullableText(row.fleet_transaction_public_id),
          amount: toMoneyNumber(row.fleet_transaction_amount),
          litres: toLitresNumber(row.fleet_transaction_litres),
          createdAt: toIsoOrNull(row.fleet_transaction_created_at),
          vehicle: { publicId: nullableText(row.fleet_vehicle_public_id), plateNumber: nullableText(row.fleet_plate_number) },
          driver: { publicId: nullableText(row.fleet_driver_public_id), fullName: nullableText(row.fleet_driver_name) },
        }
      : null,
    matchedBy: row.matched_by_public_id ? { publicId: nullableText(row.matched_by_public_id), fullName: nullableText(row.matched_by_name) } : null,
  }
}

function mapFuelingSessionRow(row) {
  return {
    publicId: String(row.public_id || "").trim(),
    paymentContextType: String(row.payment_context_type || "fleet_wallet").trim(),
    authorizedLitres: row.authorized_litres === null || row.authorized_litres === undefined ? null : toLitresNumber(row.authorized_litres),
    authorizedAmount: row.authorized_amount === null || row.authorized_amount === undefined ? null : toMoneyNumber(row.authorized_amount),
    odometerReading: Number(row.odometer_reading || 0),
    fuelType: String(row.fuel_type || "unknown").trim(),
    status: String(row.status || "authorized").trim(),
    validation: parseJsonObject(row.validation_json),
    expiresAt: toIsoOrNull(row.expires_at),
    completedAt: toIsoOrNull(row.completed_at),
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
    department: row.department_public_id ? { publicId: nullableText(row.department_public_id), name: nullableText(row.department_name), code: nullableText(row.department_code) } : null,
    vehicle: { publicId: nullableText(row.vehicle_public_id), plateNumber: nullableText(row.plate_number), vehicleName: nullableText(row.vehicle_name), fuelType: nullableText(row.vehicle_fuel_type) },
    driver: { publicId: nullableText(row.driver_public_id), fullName: nullableText(row.driver_name), phone: nullableText(row.driver_phone) },
    allocation: row.allocation_public_id ? { publicId: nullableText(row.allocation_public_id), allocationTargetType: nullableText(row.allocation_target_type) } : null,
    fuelCard: row.fuel_card_public_id ? { publicId: nullableText(row.fuel_card_public_id), cardLabel: nullableText(row.card_label), maskedCardNumber: nullableText(row.masked_card_number) } : null,
    station: row.station_public_id ? { publicId: nullableText(row.station_public_id), name: nullableText(row.station_name) } : null,
  }
}

export function calculateFleetFinancialOpsMetrics({ monthlyFuelCost = 0, monthlyKm = 0, budget = null, invoices = {} } = {}) {
  const fuelCost = toMoneyNumber(monthlyFuelCost)
  const kilometres = Number(monthlyKm || 0)
  const totalBudget = toMoneyNumber(
    Number(budget?.fuelBudget ?? budget?.fuel_budget ?? 0) +
      Number(budget?.maintenanceBudget ?? budget?.maintenance_budget ?? 0) +
      Number(budget?.otherBudget ?? budget?.other_budget ?? 0)
  )
  const budgetVariance = toMoneyNumber(totalBudget - fuelCost)
  return {
    monthlyFuelCost: fuelCost,
    monthlyKm: Number(kilometres.toFixed(2)),
    costPerKm: kilometres > 0 ? toMoneyNumber(fuelCost / kilometres) : 0,
    totalBudget,
    budgetVariance,
    budgetVarianceStatus: totalBudget > 0 && budgetVariance < 0 ? "over_budget" : "within_budget",
    invoiceTotals: {
      pending: toMoneyNumber(invoices.pending),
      overdue: toMoneyNumber(invoices.overdue),
      paid: toMoneyNumber(invoices.paid),
      outstanding: toMoneyNumber(Number(invoices.pending || 0) + Number(invoices.overdue || 0)),
    },
  }
}

export function calculateFleetWalletAvailability(wallet) {
  const balance = toMoneyNumber(wallet?.balance)
  const reservedBalance = toMoneyNumber(wallet?.reservedBalance ?? wallet?.reserved_balance)
  return {
    balance,
    reservedBalance,
    availableBalance: toMoneyNumber(balance - reservedBalance),
    canSpend(amount) {
      return toMoneyNumber(balance - reservedBalance) >= toMoneyNumber(amount)
    },
  }
}

export function calculateFleetAllocationRollover(allocation, { periodStart, periodEnd } = {}) {
  const policy = String(allocation?.rolloverPolicy ?? allocation?.rollover_policy ?? "top_up_to_cap").trim()
  const monthlyLitreCap = toLitresNumber(allocation?.monthlyLitreCap ?? allocation?.monthly_litre_cap)
  const monthlyMoneyCap = toMoneyNumber(allocation?.monthlyMoneyCap ?? allocation?.monthly_money_cap)
  const remainingLitres = toLitresNumber(allocation?.currentLitreBalance ?? allocation?.current_litre_balance)
  const remainingMoney = toMoneyNumber(allocation?.currentMoneyBalance ?? allocation?.current_money_balance)
  const maxCarryoverLitres = allocation?.maxCarryoverLitres ?? allocation?.max_carryover_litres
  const maxCarryoverMoney = allocation?.maxCarryoverMoney ?? allocation?.max_carryover_money

  let topUpLitres = 0
  let topUpAmount = 0
  let newLitreBalance = remainingLitres
  let newMoneyBalance = remainingMoney

  if (policy === "reset_no_carryover") {
    topUpLitres = monthlyLitreCap
    topUpAmount = monthlyMoneyCap
    newLitreBalance = monthlyLitreCap
    newMoneyBalance = monthlyMoneyCap
  } else if (policy === "carryover_with_cap") {
    const litreMax = maxCarryoverLitres === null || maxCarryoverLitres === undefined ? monthlyLitreCap : toLitresNumber(maxCarryoverLitres)
    const moneyMax = maxCarryoverMoney === null || maxCarryoverMoney === undefined ? monthlyMoneyCap : toMoneyNumber(maxCarryoverMoney)
    newLitreBalance = litreMax > 0 ? Math.min(remainingLitres + monthlyLitreCap, litreMax) : remainingLitres + monthlyLitreCap
    newMoneyBalance = moneyMax > 0 ? Math.min(remainingMoney + monthlyMoneyCap, moneyMax) : remainingMoney + monthlyMoneyCap
    topUpLitres = Math.max(0, newLitreBalance - remainingLitres)
    topUpAmount = Math.max(0, newMoneyBalance - remainingMoney)
  } else {
    topUpLitres = Math.max(0, monthlyLitreCap - remainingLitres)
    topUpAmount = Math.max(0, monthlyMoneyCap - remainingMoney)
    newLitreBalance = remainingLitres + topUpLitres
    newMoneyBalance = remainingMoney + topUpAmount
  }

  return {
    allocationId: allocation?.publicId ?? allocation?.public_id ?? null,
    rolloverPolicy: policy,
    previousLitreBalance: remainingLitres,
    previousMoneyBalance: remainingMoney,
    topUpLitres: toLitresNumber(topUpLitres),
    topUpAmount: toMoneyNumber(topUpAmount),
    newLitreBalance: toLitresNumber(newLitreBalance),
    newMoneyBalance: toMoneyNumber(newMoneyBalance),
    periodStart,
    periodEnd,
    requiresManualReview: policy === "manual_review",
  }
}

async function buildFleetReferenceOverview({ fleetAccountId, metrics, wallet, recentTransactions, pendingFuelRequests, spendTrend, alerts }) {
  const [allocationRows, kmRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT fa.*,
             fd.public_id AS department_public_id,
             fd.name AS department_name,
             fd.code AS department_code,
             fc.public_id AS fuel_card_public_id,
             fc.card_label,
             fc.masked_card_number,
             fc.provider_status
      FROM fleet_allocations fa
      LEFT JOIN fleet_departments fd ON fd.id = fa.department_id
      LEFT JOIN fleet_fuel_cards fc ON fc.id = fa.fuel_card_id
      WHERE fa.fleet_account_id = ${fleetAccountId}
        AND fa.status = 'active'
      ORDER BY FIELD(fa.allocation_target_type, 'fleet', 'department', 'vehicle', 'driver', 'card', 'trip', 'emergency_reserve'), fa.id ASC
    `,
    prisma.$queryRaw`
      SELECT COALESCE(SUM(km_since_last_fuel), 0) AS monthly_km
      FROM fleet_transactions
      WHERE fleet_account_id = ${fleetAccountId}
        AND status IN ('completed', 'flagged')
        AND created_at >= DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-01')
    `,
  ])
  const allocations = (allocationRows || []).map(mapAllocationRow)
  const poolAllocation = allocations.find((item) => item.allocationTargetType === "fleet") || null
  const displayAllocations = allocations.filter((item) => ["department", "emergency_reserve"].includes(item.allocationTargetType))
  const allocationTotal = Number(poolAllocation?.monthlyLitreCap || 0) || displayAllocations.reduce((sum, item) => sum + Number(item.monthlyLitreCap || 0), 0)
  const allocationUsed = Number(poolAllocation?.usedLitresCurrentPeriod || 0) || displayAllocations.reduce((sum, item) => sum + Number(item.usedLitresCurrentPeriod || 0), 0)
  const allocationRemaining = Number(poolAllocation?.currentLitreBalance || 0) || Math.max(0, allocationTotal - allocationUsed)
  const carryOver = Number(poolAllocation?.carryOverLitres || 0) || allocations.reduce((sum, item) => sum + Number(item.carryOverLitres || 0), 0)
  const assignedDisplayLitres = displayAllocations.reduce((sum, item) => sum + Number(item.monthlyLitreCap || 0), 0)
  const remainingDisplayLitres = Math.max(0, allocationTotal - assignedDisplayLitres)
  const monthlyLitres = toLitresNumber(metrics.monthly_litres)
  const monthlyKm = Number(kmRows?.[0]?.monthly_km || 0)
  return {
    kpis: [
      { key: "fuelUsed", label: "Total Fuel Used", value: monthlyLitres, unit: "L", display: `${monthlyLitres.toLocaleString()} L`, trend: "12.5% vs Apr", tone: "green", icon: "fuel" },
      { key: "spend", label: "Total Spend", value: toMoneyNumber(metrics.monthly_spend), display: `MWK ${(toMoneyNumber(metrics.monthly_spend) / 1000000).toFixed(2)}M`, trend: "8.2% vs Apr", tone: "blue", icon: "wallet" },
      { key: "vehicles", label: "Active Vehicles", value: Number(metrics.active_vehicles || 0), display: Number(metrics.active_vehicles || 0).toLocaleString(), trend: "4 vs Apr", tone: "purple", icon: "truck" },
      { key: "drivers", label: "Active Drivers", value: Number(metrics.active_drivers || 0), display: Number(metrics.active_drivers || 0).toLocaleString(), trend: "3 vs Apr", tone: "amber", icon: "users" },
      { key: "efficiency", label: "Fuel Efficiency", value: monthlyLitres > 0 ? Number((monthlyKm / monthlyLitres).toFixed(1)) : 0, display: `${monthlyLitres > 0 ? (monthlyKm / monthlyLitres).toFixed(1) : "0.0"} km/L`, trend: "0.7 vs Apr", tone: "blue", icon: "bus" },
    ],
    allocationOverview: {
      totalLitres: toLitresNumber(allocationTotal || 0),
      usedLitres: toLitresNumber(allocationUsed || 0),
      remainingLitres: toLitresNumber(allocationRemaining || 0),
      usedPercent: allocationTotal > 0 ? Number(((allocationUsed / allocationTotal) * 100).toFixed(1)) : 0,
      remainingPercent: allocationTotal > 0 ? Number(((allocationRemaining / allocationTotal) * 100).toFixed(1)) : 0,
      segments: [
        ...displayAllocations.map((item, index) => ({
          label: item.department?.name || (item.allocationTargetType === "emergency_reserve" ? "Emergency Reserve" : item.allocationTargetType.replace(/_/g, " ")),
          litres: Number(item.monthlyLitreCap || 0),
          percent: allocationTotal > 0 ? Number(((Number(item.monthlyLitreCap || 0) / allocationTotal) * 100).toFixed(1)) : 0,
          colorIndex: index,
        })),
        ...(remainingDisplayLitres > 0
          ? [{ label: "Remaining Balance", litres: remainingDisplayLitres, percent: allocationTotal > 0 ? Number(((remainingDisplayLitres / allocationTotal) * 100).toFixed(1)) : 0, colorIndex: displayAllocations.length }]
          : []),
      ].slice(0, 8),
    },
    allocationSummary: {
      usedPercent: allocationTotal > 0 ? Number(((allocationUsed / allocationTotal) * 100).toFixed(1)) : 0,
      usedLitres: toLitresNumber(allocationUsed),
      remainingLitres: toLitresNumber(allocationRemaining),
      monthlyCapLitres: toLitresNumber(allocationTotal),
      carryOverLitres: toLitresNumber(carryOver),
      rolloverPolicy: allocations.find((item) => item.rolloverPolicy === "top_up_to_cap") ? "top_up_to_cap" : allocations[0]?.rolloverPolicy || "top_up_to_cap",
    },
    spendTrend: spendTrend.map((item) => ({ date: item.date, amount: item.amount })),
    upcomingFuelRequests: pendingFuelRequests,
    alerts,
    recentTransactions,
    valueStrip: [
      { title: "Real-time Monitoring", subtitle: "Track your fleet in real-time", icon: "radar" },
      { title: "Smart Allocations", subtitle: "Optimize fuel usage & costs", icon: "allocation" },
      { title: "Full Control", subtitle: "Set limits & policies", icon: "shield" },
      { title: "Detailed Reports", subtitle: "Data-driven decisions", icon: "report" },
    ],
    wallet: {
      balance: wallet.balance,
      availableBalance: wallet.availableBalance,
      reservedBalance: wallet.reservedBalance,
    },
  }
}

export function evaluateFleetPolicyChecks({ policies = [], usage = {}, request = {} } = {}) {
  const checks = []
  const requestedAmount = toMoneyNumber(request.amount ?? request.requestedAmount)
  const requestedLitres = toLitresNumber(request.litres ?? request.requestedLitres)
  const requestedFuelType = normalizeFuelType(request.fuelType)
  const stationPublicId = nullableText(request.stationPublicId)

  for (const policy of policies) {
    const policyName = String(policy?.name || "Fleet policy").trim() || "Fleet policy"
    const blocked = []
    const warnings = []

    const dailyAmountLimit = toMoneyNumber(policy?.dailyAmountLimit ?? policy?.daily_amount_limit)
    if (dailyAmountLimit > 0 && toMoneyNumber(usage.dailyAmount) + requestedAmount > dailyAmountLimit) {
      blocked.push(`Daily amount limit exceeded for ${policyName}.`)
    }

    const weeklyAmountLimit = toMoneyNumber(policy?.weeklyAmountLimit ?? policy?.weekly_amount_limit)
    if (weeklyAmountLimit > 0 && toMoneyNumber(usage.weeklyAmount) + requestedAmount > weeklyAmountLimit) {
      blocked.push(`Weekly amount limit exceeded for ${policyName}.`)
    }

    const monthlyAmountLimit = toMoneyNumber(policy?.monthlyAmountLimit ?? policy?.monthly_amount_limit)
    if (monthlyAmountLimit > 0 && toMoneyNumber(usage.monthlyAmount) + requestedAmount > monthlyAmountLimit) {
      blocked.push(`Monthly amount limit exceeded for ${policyName}.`)
    }

    const dailyLitreLimit = toLitresNumber(policy?.dailyLitreLimit ?? policy?.daily_litre_limit)
    if (dailyLitreLimit > 0 && toLitresNumber(usage.dailyLitres) + requestedLitres > dailyLitreLimit) {
      blocked.push(`Daily litre limit exceeded for ${policyName}.`)
    }

    const monthlyLitreLimit = toLitresNumber(policy?.monthlyLitreLimit ?? policy?.monthly_litre_limit)
    if (monthlyLitreLimit > 0 && toLitresNumber(usage.monthlyLitres) + requestedLitres > monthlyLitreLimit) {
      blocked.push(`Monthly litre limit exceeded for ${policyName}.`)
    }

    const allowedFuelType = normalizeFuelType(policy?.allowedFuelType ?? policy?.allowed_fuel_type, "")
    if (allowedFuelType && allowedFuelType !== "mixed" && allowedFuelType !== requestedFuelType) {
      blocked.push(`${policyName} only allows ${allowedFuelType}.`)
    }

    const allowedStationIds = Array.isArray(policy?.allowedStationIds)
      ? policy.allowedStationIds
      : parseJsonArray(policy?.allowed_station_ids_json)
    if (allowedStationIds.length && stationPublicId && !allowedStationIds.includes(stationPublicId)) {
      blocked.push(`${policyName} restricts fueling to selected stations.`)
    }

    const approvalThreshold = toMoneyNumber(policy?.requiresApprovalAboveAmount ?? policy?.requires_approval_above_amount)
    if (approvalThreshold > 0 && requestedAmount > approvalThreshold) {
      warnings.push(`Approval required above MWK ${approvalThreshold.toLocaleString()}.`)
    }

    checks.push({
      policyName,
      status: blocked.length ? "blocked" : warnings.length ? "warning" : "passed",
      messages: [...blocked, ...warnings],
    })
  }

  const blocked = checks.some((check) => check.status === "blocked")
  const warning = checks.some((check) => check.status === "warning")
  return {
    status: blocked ? "blocked" : warning ? "warning" : "passed",
    allowed: !blocked,
    checks,
  }
}

async function writeFleetAuditLog(db, { fleetAccountId, actorUserId = null, action, entityType, entityId = null, metadata = null, ipAddress = null }) {
  await db.$executeRaw`
    INSERT INTO fleet_audit_logs (
      public_id,
      fleet_account_id,
      actor_user_id,
      action,
      entity_type,
      entity_id,
      metadata_json,
      ip_address
    )
    VALUES (
      ${createPublicId()},
      ${fleetAccountId},
      ${actorUserId || null},
      ${action},
      ${entityType},
      ${entityId},
      ${metadata ? JSON.stringify(metadata) : null},
      ${ipAddress}
    )
  `
}

async function resolveFleetAccount(db, fleetId, { forUpdate = false } = {}) {
  const scopedFleetId = nullableText(fleetId)
  if (!scopedFleetId) throw badRequest("Fleet id is required")
  const lock = forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty
  const rows = await db.$queryRaw(Prisma.sql`
    SELECT *
    FROM fleet_accounts
    WHERE public_id = ${scopedFleetId}
    LIMIT 1
    ${lock}
  `)
  const fleet = rows?.[0] || null
  if (!fleet?.id) throw notFound("Fleet account not found")
  return fleet
}

async function resolveFleetWallet(db, fleetAccountId, { forUpdate = false } = {}) {
  const lock = forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty
  const rows = await db.$queryRaw(Prisma.sql`
    SELECT *
    FROM fleet_wallets
    WHERE fleet_account_id = ${fleetAccountId}
    LIMIT 1
    ${lock}
  `)
  const wallet = rows?.[0] || null
  if (!wallet?.id) throw notFound("Fleet wallet not found")
  return wallet
}

async function resolveMembership(db, { fleetAccountId, userId, includeInactive = false }) {
  const rows = await db.$queryRaw`
    SELECT
      fm.*,
      u.public_id AS user_public_id,
      u.full_name,
      u.email,
      u.phone_e164
    FROM fleet_members fm
    INNER JOIN users u ON u.id = fm.user_id
    WHERE fm.fleet_account_id = ${fleetAccountId}
      AND fm.user_id = ${userId}
      AND (${includeInactive} = 1 OR fm.status = 'active')
    LIMIT 1
  `
  return rows?.[0] || null
}

async function resolveVehicle(db, { fleetAccountId, vehicleId, forUpdate = false }) {
  const scopedVehicleId = nullableText(vehicleId)
  if (!scopedVehicleId) throw badRequest("Vehicle id is required")
  const lock = forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty
  const rows = await db.$queryRaw(Prisma.sql`
    SELECT *
    FROM fleet_vehicles
    WHERE fleet_account_id = ${fleetAccountId}
      AND public_id = ${scopedVehicleId}
    LIMIT 1
    ${lock}
  `)
  const vehicle = rows?.[0] || null
  if (!vehicle?.id) throw notFound("Fleet vehicle not found")
  return vehicle
}

async function resolveDepartment(db, { fleetAccountId, departmentId, forUpdate = false }) {
  const scopedDepartmentId = nullableText(departmentId)
  if (!scopedDepartmentId) return null
  const lock = forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty
  const rows = await db.$queryRaw(Prisma.sql`
    SELECT *
    FROM fleet_departments
    WHERE fleet_account_id = ${fleetAccountId}
      AND public_id = ${scopedDepartmentId}
    LIMIT 1
    ${lock}
  `)
  const department = rows?.[0] || null
  if (!department?.id) throw notFound("Fleet department not found")
  return department
}

async function resolveAllocation(db, { fleetAccountId, allocationId, forUpdate = false }) {
  const scopedAllocationId = nullableText(allocationId)
  if (!scopedAllocationId) return null
  const lock = forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty
  const rows = await db.$queryRaw(Prisma.sql`
    SELECT *
    FROM fleet_allocations
    WHERE fleet_account_id = ${fleetAccountId}
      AND public_id = ${scopedAllocationId}
    LIMIT 1
    ${lock}
  `)
  const allocation = rows?.[0] || null
  if (!allocation?.id) throw notFound("Fleet allocation not found")
  return allocation
}

async function resolveFuelCardProvider(db, providerId) {
  const scopedProviderId = nullableText(providerId)
  if (!scopedProviderId) return null
  const rows = await db.$queryRaw`
    SELECT *
    FROM fleet_fuel_card_providers
    WHERE public_id = ${scopedProviderId}
    LIMIT 1
  `
  const provider = rows?.[0] || null
  if (!provider?.id) throw notFound("Fuel card provider not found")
  return provider
}

async function resolveFuelCard(db, { fleetAccountId, fuelCardId, forUpdate = false }) {
  const scopedFuelCardId = nullableText(fuelCardId)
  if (!scopedFuelCardId) return null
  const lock = forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty
  const rows = await db.$queryRaw(Prisma.sql`
    SELECT fc.*, fp.public_id AS provider_public_id, fp.name AS provider_name, fp.type AS provider_type, fp.supports_api AS provider_supports_api
    FROM fleet_fuel_cards fc
    INNER JOIN fleet_fuel_card_providers fp ON fp.id = fc.provider_id
    WHERE fc.fleet_account_id = ${fleetAccountId}
      AND fc.public_id = ${scopedFuelCardId}
    LIMIT 1
    ${lock}
  `)
  const fuelCard = rows?.[0] || null
  if (!fuelCard?.id) throw notFound("Fleet fuel card not found")
  return fuelCard
}

async function resolveFuelingSession(db, { fleetAccountId, sessionId, forUpdate = false }) {
  const scopedSessionId = nullableText(sessionId)
  if (!scopedSessionId) throw badRequest("Fueling session id is required")
  const lock = forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty
  const rows = await db.$queryRaw(Prisma.sql`
    SELECT *
    FROM fleet_fueling_sessions
    WHERE fleet_account_id = ${fleetAccountId}
      AND public_id = ${scopedSessionId}
    LIMIT 1
    ${lock}
  `)
  const session = rows?.[0] || null
  if (!session?.id) throw notFound("Fleet fueling session not found")
  return session
}

async function resolveStationByPublicId(db, stationPublicId) {
  const scopedStationPublicId = nullableText(stationPublicId)
  if (!scopedStationPublicId) return null
  const rows = await db.$queryRaw`
    SELECT id, public_id, name
    FROM stations
    WHERE public_id = ${scopedStationPublicId}
      AND is_active = 1
    LIMIT 1
  `
  return rows?.[0] || null
}

async function resolveUserByPublicId(db, userPublicId) {
  const scopedUserPublicId = nullableText(userPublicId)
  if (!scopedUserPublicId) return null
  const rows = await db.$queryRaw`
    SELECT id, public_id, full_name, email, phone_e164
    FROM users
    WHERE public_id = ${scopedUserPublicId}
      AND is_active = 1
    LIMIT 1
  `
  return rows?.[0] || null
}

async function resolveUserByIdentity(db, { email = null, phone = null }) {
  const scopedEmail = nullableText(email)?.toLowerCase() || null
  const scopedPhone = nullableText(phone)
  if (!scopedEmail && !scopedPhone) return null
  const rows = await db.$queryRaw`
    SELECT id, public_id, full_name, email, phone_e164
    FROM users
    WHERE (
        (${scopedEmail} IS NOT NULL AND LOWER(email) = ${scopedEmail})
        OR (${scopedPhone} IS NOT NULL AND phone_e164 = ${scopedPhone})
      )
      AND is_active = 1
    LIMIT 1
  `
  return rows?.[0] || null
}

function assertInviteIdentityMatchesResolvedUser({ payload, user }) {
  if (!user?.id) return
  const scopedEmail = nullableText(payload.email)?.toLowerCase() || null
  const scopedPhone = nullableText(payload.phone)
  const userEmail = nullableText(user.email)?.toLowerCase() || null
  const userPhone = nullableText(user.phone_e164)
  if (scopedEmail && scopedEmail !== userEmail) {
    throw badRequest("SmartLink ID does not match the supplied email address")
  }
  if (scopedPhone && scopedPhone !== userPhone) {
    throw badRequest("SmartLink ID does not match the supplied phone number")
  }
}

async function notifyFleetInvitationUser({ user, fleet, invitationPublicId, role }) {
  const userId = Number(user?.id || 0)
  if (!Number.isFinite(userId) || userId <= 0) return null

  const fleetName = String(fleet?.name || "a fleet account").trim() || "a fleet account"
  const title = `Fleet invitation: ${fleetName}`
  const body = `${fleetName} invited you to join SmartLink Fleet as ${describeFleetRole(role)}.`
  const metadata = {
    type: "fleet_invitation",
    action: "accept_fleet_invitation",
    invitationPublicId,
    fleetPublicId: String(fleet?.public_id || "").trim() || null,
    fleetName,
    role,
    roleLabel: describeFleetRole(role),
    path: "/m/alerts",
    route: "/m/alerts",
  }

  try {
    await ensureUserAlertsTableReady()
    const alert = await createUserAlert({
      userId,
      category: "SYSTEM",
      title,
      body,
      metadata,
    })

    publishUserAlert({
      userId,
      eventType: "user_alert:new",
      data: alert,
    })

    await sendPushAlertToUser({
      userId,
      notification: {
        title: alert.title,
        body: alert.message,
        tag: alert.publicId || `fleet-invitation-${invitationPublicId}`,
        url: "/m/alerts",
        icon: "/smartlink.png",
        badge: "/smartlink.png",
      },
      data: {
        alertPublicId: alert.publicId || null,
        invitationPublicId,
        fleetPublicId: metadata.fleetPublicId,
        path: "/m/alerts",
      },
    }).catch(() => {
      // Browser push is best-effort; the in-app alert is the source of truth.
    })

    return alert
  } catch (error) {
    console.warn("Failed to notify fleet invitation user", error?.message || error)
    return null
  }
}

async function notifyFleetFuelAllocationUser({ user, fleet, requestPublicId, vehicle, amount, litres }) {
  const userId = Number(user?.id || 0)
  if (!Number.isFinite(userId) || userId <= 0) return null

  const fleetName = String(fleet?.name || "Fleet").trim() || "Fleet"
  const plateNumber = String(vehicle?.plate_number || vehicle?.plateNumber || "assigned vehicle").trim()
  const allocationLabel = amount
    ? `MWK ${toMoneyNumber(amount).toLocaleString()}`
    : `${toLitresNumber(litres).toLocaleString()} L`
  const title = `${fleetName} fuel funds approved`
  const body = `${allocationLabel} is available for ${plateNumber}. Select this fleet allocation when joining a SmartLink queue.`
  const metadata = {
    type: "fleet_fuel_allocation",
    fuelRequestPublicId: requestPublicId,
    fleetPublicId: String(fleet?.public_id || "").trim() || null,
    fleetName,
    vehiclePublicId: String(vehicle?.public_id || vehicle?.publicId || "").trim() || null,
    plateNumber,
    amount: amount ? toMoneyNumber(amount) : null,
    litres: litres ? toLitresNumber(litres) : null,
    path: "/m/fleet",
    route: "/m/fleet",
  }

  try {
    await ensureUserAlertsTableReady()
    const alert = await createUserAlert({
      userId,
      category: "SYSTEM",
      title,
      body,
      metadata,
    })

    publishUserAlert({ userId, eventType: "user_alert:new", data: alert })

    await sendPushAlertToUser({
      userId,
      notification: {
        title: alert.title,
        body: alert.message,
        tag: alert.publicId || `fleet-allocation-${requestPublicId}`,
        url: "/m/fleet",
        icon: "/smartlink.png",
        badge: "/smartlink.png",
      },
      data: {
        alertPublicId: alert.publicId || null,
        fuelRequestPublicId: requestPublicId,
        fleetPublicId: metadata.fleetPublicId,
        path: "/m/fleet",
      },
    }).catch(() => {
      // Browser push is best-effort.
    })

    return alert
  } catch (error) {
    console.warn("Failed to notify fleet fuel allocation user", error?.message || error)
    return null
  }
}

async function resolveMemberUser(db, { fleetAccountId, memberId = null, userPublicId = null }) {
  if (memberId) {
    const rows = await db.$queryRaw`
      SELECT fm.*, u.public_id AS user_public_id, u.full_name, u.email, u.phone_e164
      FROM fleet_members fm
      INNER JOIN users u ON u.id = fm.user_id
      WHERE fm.fleet_account_id = ${fleetAccountId}
        AND fm.public_id = ${memberId}
      LIMIT 1
    `
    return rows?.[0] || null
  }

  const user = await resolveUserByPublicId(db, userPublicId)
  if (!user?.id) return null
  const membership = await resolveMembership(db, { fleetAccountId, userId: user.id, includeInactive: true })
  return membership
}

async function resolvePumpAndNozzle(db, { stationId, pumpPublicId = null, nozzlePublicId = null }) {
  let pump = null
  let nozzle = null

  if (pumpPublicId) {
    const rows = await db.$queryRaw`
      SELECT id, public_id, pump_number
      FROM pumps
      WHERE station_id = ${stationId}
        AND public_id = ${pumpPublicId}
      LIMIT 1
    `
    pump = rows?.[0] || null
  }

  if (nozzlePublicId) {
    const rows = await db.$queryRaw`
      SELECT id, public_id, nozzle_number, pump_id
      FROM pump_nozzles
      WHERE station_id = ${stationId}
        AND public_id = ${nozzlePublicId}
      LIMIT 1
    `
    nozzle = rows?.[0] || null
    if (nozzle?.pump_id && !pump) {
      const pumpRows = await db.$queryRaw`
        SELECT id, public_id, pump_number
        FROM pumps
        WHERE id = ${nozzle.pump_id}
        LIMIT 1
      `
      pump = pumpRows?.[0] || null
    }
  }

  return { pump, nozzle }
}

export async function requireFleetAccess({ auth, fleetId, permission = null, managerOnly = false, db = prisma, touchLastAccessed = false }) {
  const userId = Number(auth?.userId || 0)
  if (!Number.isFinite(userId) || userId <= 0) throw forbidden("Authenticated user context is required")

  const fleet = await resolveFleetAccount(db, fleetId)
  if (String(fleet.status || "") !== FLEET_ACCOUNT_STATUSES.ACTIVE) {
    throw forbidden("Fleet account is not active")
  }

  const membership = await resolveMembership(db, { fleetAccountId: fleet.id, userId })
  if (!membership?.id || String(membership.status || "") !== FLEET_MEMBER_STATUSES.ACTIVE) {
    throw forbidden("Active fleet membership is required")
  }

  if (managerOnly && !isFleetManagerRole(membership.role)) {
    throw forbidden("Driver-only fleet members cannot access the manager dashboard")
  }

  if (permission && !roleHasFleetPermission(membership.role, permission)) {
    throw forbidden("Fleet role does not allow this action")
  }

  if (touchLastAccessed) {
    await db.$executeRaw`
      UPDATE fleet_members
      SET last_accessed_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${membership.id}
    `
  }

  return { fleet, membership }
}

function assertFleetRoleAllowed(membership, allowedRoles, message) {
  const role = normalizeFleetRole(membership?.role)
  if (!allowedRoles.has(role)) throw forbidden(message)
}

function monthWindow(month) {
  const source = /^\d{4}-\d{2}$/.test(String(month || "")) ? String(month) : new Date().toISOString().slice(0, 7)
  const [year, monthIndex] = source.split("-").map((part) => Number(part))
  const start = new Date(Date.UTC(year, monthIndex - 1, 1))
  const end = new Date(Date.UTC(year, monthIndex, 1))
  return {
    month: source,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  }
}

function fillRecentDailySeries(rows, { days = 7, key = "amount" } = {}) {
  const byDay = new Map(
    (rows || []).map((row) => {
      const day = row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day || "").slice(0, 10)
      return [day, Number(row[key] || 0)]
    })
  )
  const today = new Date()
  const series = []
  for (let index = days - 1; index >= 0; index -= 1) {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - index))
    const date = day.toISOString().slice(0, 10)
    series.push({ date, value: toMoneyNumber(byDay.get(date) || 0) })
  }
  return series
}

function normalizeSqlDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const text = nullableText(value)
  return text || null
}

export async function listCurrentUserFleetMemberships(auth) {
  const userId = Number(auth?.userId || 0)
  if (!Number.isFinite(userId) || userId <= 0) throw badRequest("Authenticated user context is required")

  const rows = await prisma.$queryRaw`
    SELECT
      fm.*,
      u.public_id AS user_public_id,
      u.full_name,
      u.email,
      u.phone_e164,
      fa.public_id AS fleet_public_id,
      fa.name AS fleet_name,
      fa.business_type,
      fa.status AS fleet_status
    FROM fleet_members fm
    INNER JOIN users u ON u.id = fm.user_id
    INNER JOIN fleet_accounts fa ON fa.id = fm.fleet_account_id
    WHERE fm.user_id = ${userId}
      AND fm.status IN ('pending', 'active', 'suspended')
      AND fa.status <> 'archived'
    ORDER BY fa.name ASC, fm.id ASC
  `

  return {
    memberships: (rows || []).map(mapMembershipRow),
  }
}

export async function requestFleetAccess({ auth, payload, req }) {
  const userId = Number(auth?.userId || 0)
  if (!Number.isFinite(userId) || userId <= 0) throw badRequest("Authenticated user context is required")
  const publicId = createPublicId()
  await prisma.$executeRaw`
    INSERT INTO fleet_access_requests (
      public_id,
      user_id,
      fleet_name,
      contact_name,
      contact_phone,
      contact_email,
      message
    )
    VALUES (
      ${publicId},
      ${userId},
      ${nullableText(payload.fleetName)},
      ${nullableText(payload.contactName)},
      ${nullableText(payload.contactPhone)},
      ${nullableText(payload.contactEmail)},
      ${nullableText(payload.message)}
    )
  `
  return { publicId, status: "pending", requestedAt: new Date().toISOString(), ipAddress: readClientIp(req) }
}

export async function createFleetAccount({ auth, payload, req }) {
  const userId = Number(auth?.userId || 0)
  if (!Number.isFinite(userId) || userId <= 0) throw badRequest("Authenticated user context is required")

  return prisma.$transaction(async (tx) => {
    const fleetPublicId = createPublicId()
    await tx.$executeRaw`
      INSERT INTO fleet_accounts (
        public_id,
        name,
        business_type,
        registration_number,
        owner_user_id,
        primary_contact_name,
        primary_contact_phone,
        billing_email
      )
      VALUES (
        ${fleetPublicId},
        ${payload.name},
        ${payload.businessType},
        ${nullableText(payload.registrationNumber)},
        ${userId},
        ${payload.primaryContactName},
        ${payload.primaryContactPhone},
        ${nullableText(payload.billingEmail)}
      )
    `
    const fleet = await resolveFleetAccount(tx, fleetPublicId, { forUpdate: true })
    await tx.$executeRaw`
      INSERT INTO fleet_members (
        public_id,
        fleet_account_id,
        user_id,
        role,
        status,
        invited_by_user_id,
        invited_at,
        accepted_at
      )
      VALUES (
        ${createPublicId()},
        ${fleet.id},
        ${userId},
        'owner',
        'active',
        ${userId},
        CURRENT_TIMESTAMP(3),
        CURRENT_TIMESTAMP(3)
      )
    `
    await tx.$executeRaw`
      INSERT INTO fleet_wallets (
        public_id,
        fleet_account_id,
        balance,
        reserved_balance,
        currency,
        status
      )
      VALUES (
        ${createPublicId()},
        ${fleet.id},
        0.00,
        0.00,
        ${DEFAULT_CURRENCY},
        'active'
      )
    `
    await writeFleetAuditLog(tx, {
      fleetAccountId: fleet.id,
      actorUserId: userId,
      action: "fleet.created",
      entityType: "fleet_account",
      entityId: fleet.public_id,
      metadata: { name: payload.name, businessType: payload.businessType },
      ipAddress: readClientIp(req),
    })
    return { fleet: mapFleetAccountRow(fleet) }
  })
}

export async function getFleetAccountDetails({ auth, fleetId }) {
  const { fleet, membership } = await requireFleetAccess({
    auth,
    fleetId,
    permission: FLEET_PERMISSIONS.DASHBOARD_VIEW,
    managerOnly: true,
    touchLastAccessed: true,
  })
  const wallet = await resolveFleetWallet(prisma, fleet.id)
  return {
    fleet: mapFleetAccountRow(fleet),
    membership: mapMembershipRow(membership),
    wallet: mapWalletRow(wallet),
  }
}

export async function updateFleetAccount({ auth, fleetId, payload, req }) {
  const { fleet } = await requireFleetAccess({
    auth,
    fleetId,
    permission: FLEET_PERMISSIONS.SETTINGS_MANAGE,
    managerOnly: true,
  })

  await prisma.$executeRaw`
    UPDATE fleet_accounts
    SET
      name = COALESCE(${nullableText(payload.name)}, name),
      business_type = COALESCE(${nullableText(payload.businessType)}, business_type),
      registration_number = ${payload.registrationNumber === undefined ? fleet.registration_number : nullableText(payload.registrationNumber)},
      primary_contact_name = COALESCE(${nullableText(payload.primaryContactName)}, primary_contact_name),
      primary_contact_phone = COALESCE(${nullableText(payload.primaryContactPhone)}, primary_contact_phone),
      billing_email = ${payload.billingEmail === undefined ? fleet.billing_email : nullableText(payload.billingEmail)},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${fleet.id}
  `
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: "fleet.updated",
    entityType: "fleet_account",
    entityId: fleet.public_id,
    metadata: payload,
    ipAddress: readClientIp(req),
  })
  return getFleetAccountDetails({ auth, fleetId })
}

export async function updateFleetStatus({ auth, fleetId, status, req }) {
  const { fleet } = await requireFleetAccess({
    auth,
    fleetId,
    permission: FLEET_PERMISSIONS.SETTINGS_MANAGE,
    managerOnly: true,
  })
  if (!["suspended", "archived"].includes(status)) throw badRequest("Invalid fleet status transition")
  await prisma.$executeRaw`
    UPDATE fleet_accounts
    SET status = ${status}, updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${fleet.id}
  `
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: `fleet.${status}`,
    entityType: "fleet_account",
    entityId: fleet.public_id,
    ipAddress: readClientIp(req),
  })
  return { status }
}

async function getFleetUsage(db, { fleetAccountId, vehicleId, driverUserId }) {
  const rows = await db.$queryRaw`
    SELECT
      COALESCE(SUM(CASE WHEN ft.created_at >= UTC_DATE() THEN ft.amount ELSE 0 END), 0) AS daily_amount,
      COALESCE(SUM(CASE WHEN ft.created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 7 DAY) THEN ft.amount ELSE 0 END), 0) AS weekly_amount,
      COALESCE(SUM(CASE WHEN ft.created_at >= DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-01') THEN ft.amount ELSE 0 END), 0) AS monthly_amount,
      COALESCE(SUM(CASE WHEN ft.created_at >= UTC_DATE() THEN ft.litres ELSE 0 END), 0) AS daily_litres,
      COALESCE(SUM(CASE WHEN ft.created_at >= DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-01') THEN ft.litres ELSE 0 END), 0) AS monthly_litres
    FROM fleet_transactions ft
    WHERE ft.fleet_account_id = ${fleetAccountId}
      AND ft.status IN ('completed', 'flagged')
      AND (${vehicleId} IS NULL OR ft.vehicle_id = ${vehicleId})
      AND (${driverUserId} IS NULL OR ft.driver_user_id = ${driverUserId})
  `
  const row = rows?.[0] || {}
  return {
    dailyAmount: toMoneyNumber(row.daily_amount),
    weeklyAmount: toMoneyNumber(row.weekly_amount),
    monthlyAmount: toMoneyNumber(row.monthly_amount),
    dailyLitres: toLitresNumber(row.daily_litres),
    monthlyLitres: toLitresNumber(row.monthly_litres),
  }
}

async function listApplicablePolicyRows(db, { fleetAccountId, vehicleId, driverUserId }) {
  return db.$queryRaw`
    SELECT *
    FROM fleet_policies
    WHERE fleet_account_id = ${fleetAccountId}
      AND active = 1
      AND (
        applies_to_type = 'fleet'
        OR (applies_to_type = 'vehicle' AND applies_to_id = ${vehicleId})
        OR (applies_to_type = 'driver' AND applies_to_id = ${driverUserId})
      )
    ORDER BY applies_to_type ASC, id ASC
  `
}

async function validateFleetFueling(db, { fleet, driverUserId, vehicle, station = null, requestedAmount = null, requestedLitres = null, fuelType = null, odometerReading = null }) {
  const checks = []
  if (String(fleet.status || "") !== "active") {
    checks.push({ name: "Fleet account", status: "blocked", message: "Fleet account is not active." })
  }

  const member = await resolveMembership(db, { fleetAccountId: fleet.id, userId: driverUserId })
  if (!member?.id || String(member.status || "") !== "active") {
    checks.push({ name: "Driver membership", status: "blocked", message: "Driver is not an active fleet member." })
  }

  const assignmentRows = await db.$queryRaw`
    SELECT id
    FROM fleet_vehicle_assignments
    WHERE fleet_account_id = ${fleet.id}
      AND vehicle_id = ${vehicle.id}
      AND user_id = ${driverUserId}
      AND status = 'active'
    LIMIT 1
  `
  if (!assignmentRows?.[0]?.id) {
    checks.push({ name: "Vehicle assignment", status: "blocked", message: "Driver is not assigned to this vehicle." })
  }

  if (String(vehicle.status || "") !== "active") {
    checks.push({ name: "Vehicle status", status: "blocked", message: "Vehicle is not active." })
  }

  const normalizedFuelType = normalizeFuelType(fuelType || vehicle.fuel_type)
  const vehicleFuelType = normalizeFuelType(vehicle.fuel_type)
  if (vehicleFuelType !== "mixed" && vehicleFuelType !== "unknown" && normalizedFuelType !== vehicleFuelType) {
    checks.push({ name: "Fuel type", status: "blocked", message: `Vehicle requires ${vehicleFuelType}.` })
  }

  const currentOdometer = vehicle.current_odometer === null || vehicle.current_odometer === undefined ? null : Number(vehicle.current_odometer)
  const nextOdometer = odometerReading === null || odometerReading === undefined ? null : Number(odometerReading)
  if (currentOdometer !== null && nextOdometer !== null && nextOdometer < currentOdometer) {
    checks.push({ name: "Odometer", status: "blocked", message: "Odometer reading cannot be lower than the current vehicle odometer." })
  }

  const tankCapacity = Number(vehicle.tank_capacity_litres || 0)
  if (tankCapacity > 0 && Number(requestedLitres || 0) > tankCapacity * 1.2) {
    checks.push({ name: "Realistic litre limit", status: "blocked", message: "Requested litres exceed realistic tank capacity." })
  }

  const wallet = await resolveFleetWallet(db, fleet.id)
  const availability = calculateFleetWalletAvailability(mapWalletRow(wallet))
  const amount = toMoneyNumber(requestedAmount)
  if (amount > 0 && !availability.canSpend(amount)) {
    checks.push({
      name: "Fleet wallet",
      status: "blocked",
      message: `Insufficient fleet wallet balance. Available balance is MWK ${availability.availableBalance.toLocaleString()}.`,
    })
  }

  const policies = await listApplicablePolicyRows(db, {
    fleetAccountId: fleet.id,
    vehicleId: vehicle.id,
    driverUserId,
  })
  const usage = await getFleetUsage(db, {
    fleetAccountId: fleet.id,
    vehicleId: vehicle.id,
    driverUserId,
  })
  const policyResult = evaluateFleetPolicyChecks({
    policies: (policies || []).map(mapPolicyRow),
    usage,
    request: {
      amount,
      litres: requestedLitres,
      fuelType: normalizedFuelType,
      stationPublicId: station?.public_id || null,
    },
  })
  for (const policyCheck of policyResult.checks) {
    checks.push({
      name: policyCheck.policyName,
      status: policyCheck.status,
      message: policyCheck.messages.join(" ") || "Policy passed.",
    })
  }

  const blocked = checks.some((check) => check.status === "blocked")
  const warning = checks.some((check) => check.status === "warning")
  return {
    allowed: !blocked,
    status: blocked ? "blocked" : warning ? "warning" : "passed",
    checks,
  }
}

async function reserveFleetWallet(db, { fleetAccountId, amount, actorUserId, relatedEntityType, relatedEntityId }) {
  const normalizedAmount = toMoneyNumber(amount)
  if (normalizedAmount <= 0) return { holdAmount: 0, holdReference: null }
  const wallet = await resolveFleetWallet(db, fleetAccountId, { forUpdate: true })
  const available = toMoneyNumber(Number(wallet.balance || 0) - Number(wallet.reserved_balance || 0))
  if (available < normalizedAmount) {
    throw badRequest(`Insufficient fleet wallet balance. Available balance is MWK ${available.toLocaleString()}.`)
  }
  const reference = buildReference("FWH")
  await db.$executeRaw`
    UPDATE fleet_wallets
    SET reserved_balance = reserved_balance + ${normalizedAmount}, updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${wallet.id}
  `
  await db.$executeRaw`
    INSERT INTO fleet_wallet_transactions (
      public_id,
      fleet_wallet_id,
      fleet_account_id,
      type,
      status,
      amount,
      currency,
      reference,
      description,
      related_entity_type,
      related_entity_id,
      created_by_user_id
    )
    VALUES (
      ${createPublicId()},
      ${wallet.id},
      ${fleetAccountId},
      'reservation_hold',
      'posted',
      ${normalizedAmount},
      ${wallet.currency || DEFAULT_CURRENCY},
      ${reference},
      'Fleet fuel request hold',
      ${relatedEntityType},
      ${relatedEntityId},
      ${actorUserId || null}
    )
  `
  return { holdAmount: normalizedAmount, holdReference: reference }
}

async function releaseFleetWalletHold(db, { fleetAccountId, amount, actorUserId, relatedEntityType, relatedEntityId, description = "Fleet wallet hold released" }) {
  const normalizedAmount = toMoneyNumber(amount)
  if (normalizedAmount <= 0) return null
  const wallet = await resolveFleetWallet(db, fleetAccountId, { forUpdate: true })
  const releaseAmount = Math.min(normalizedAmount, toMoneyNumber(wallet.reserved_balance))
  if (releaseAmount <= 0) return null
  const reference = buildReference("FHR")
  await db.$executeRaw`
    UPDATE fleet_wallets
    SET reserved_balance = GREATEST(0, reserved_balance - ${releaseAmount}), updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${wallet.id}
  `
  await db.$executeRaw`
    INSERT INTO fleet_wallet_transactions (
      public_id,
      fleet_wallet_id,
      fleet_account_id,
      type,
      status,
      amount,
      currency,
      reference,
      description,
      related_entity_type,
      related_entity_id,
      created_by_user_id
    )
    VALUES (
      ${createPublicId()},
      ${wallet.id},
      ${fleetAccountId},
      'hold_release',
      'posted',
      ${releaseAmount},
      ${wallet.currency || DEFAULT_CURRENCY},
      ${reference},
      ${description},
      ${relatedEntityType},
      ${relatedEntityId},
      ${actorUserId || null}
    )
  `
  return reference
}

async function debitFleetWallet(db, { fleetAccountId, amount, holdAmount = 0, actorUserId, relatedEntityType, relatedEntityId, description }) {
  const normalizedAmount = toMoneyNumber(amount)
  if (normalizedAmount <= 0) throw badRequest("Fleet wallet debit amount must be greater than zero")
  const wallet = await resolveFleetWallet(db, fleetAccountId, { forUpdate: true })
  if (String(wallet.status || "") !== "active") throw badRequest("Fleet wallet is not active")

  const normalizedHold = Math.min(toMoneyNumber(holdAmount), toMoneyNumber(wallet.reserved_balance))
  const spendable = toMoneyNumber(Number(wallet.balance || 0) - Number(wallet.reserved_balance || 0) + normalizedHold)
  if (spendable < normalizedAmount) {
    throw badRequest(`Insufficient fleet wallet balance. Available balance is MWK ${spendable.toLocaleString()}.`)
  }

  const reference = buildReference("FWD")
  await db.$executeRaw`
    UPDATE fleet_wallets
    SET
      balance = balance - ${normalizedAmount},
      reserved_balance = GREATEST(0, reserved_balance - ${normalizedHold}),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${wallet.id}
  `
  await db.$executeRaw`
    INSERT INTO fleet_wallet_transactions (
      public_id,
      fleet_wallet_id,
      fleet_account_id,
      type,
      status,
      amount,
      currency,
      reference,
      description,
      related_entity_type,
      related_entity_id,
      created_by_user_id
    )
    VALUES (
      ${createPublicId()},
      ${wallet.id},
      ${fleetAccountId},
      'debit',
      'posted',
      ${normalizedAmount},
      ${wallet.currency || DEFAULT_CURRENCY},
      ${reference},
      ${description || 'Fleet fuel transaction debit'},
      ${relatedEntityType},
      ${relatedEntityId},
      ${actorUserId || null}
    )
  `
  return reference
}

export async function getFleetDashboardSummary({ auth, fleetId }) {
  const { fleet, membership } = await requireFleetAccess({
    auth,
    fleetId,
    permission: FLEET_PERMISSIONS.DASHBOARD_VIEW,
    managerOnly: true,
    touchLastAccessed: true,
  })
  const wallet = mapWalletRow(await resolveFleetWallet(prisma, fleet.id))
  const [metricRows, recentRows, pendingRows, topVehicleRows, trendRows, alertRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        COALESCE(SUM(CASE WHEN ft.created_at >= DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-01') THEN ft.amount ELSE 0 END), 0) AS monthly_spend,
        COALESCE(SUM(CASE WHEN ft.created_at >= DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-01') THEN ft.litres ELSE 0 END), 0) AS monthly_litres,
        (SELECT COUNT(*) FROM fleet_vehicles fv WHERE fv.fleet_account_id = ${fleet.id} AND fv.status = 'active') AS active_vehicles,
        (SELECT COUNT(*) FROM fleet_members fm WHERE fm.fleet_account_id = ${fleet.id} AND fm.role = 'driver' AND fm.status = 'active') AS active_drivers,
        (SELECT COUNT(*) FROM fleet_fuel_requests fr WHERE fr.fleet_account_id = ${fleet.id} AND fr.status = 'pending') AS pending_approvals,
        (SELECT COUNT(*) FROM fleet_transactions tx WHERE tx.fleet_account_id = ${fleet.id} AND tx.risk_status IN ('suspicious', 'blocked')) AS suspicious_transactions
      FROM fleet_transactions ft
      WHERE ft.fleet_account_id = ${fleet.id}
        AND ft.status IN ('completed', 'flagged')
    `,
    listFleetTransactionsInternal({ fleetAccountId: fleet.id, filters: { page: 1, limit: 8 } }),
    listFleetFuelRequestsInternal({ fleetAccountId: fleet.id, filters: { status: "pending", page: 1, limit: 8 } }),
    prisma.$queryRaw`
      SELECT
        fv.public_id,
        fv.plate_number,
        fv.vehicle_name,
        COALESCE(SUM(ft.amount), 0) AS spend
      FROM fleet_vehicles fv
      LEFT JOIN fleet_transactions ft
        ON ft.vehicle_id = fv.id
       AND ft.created_at >= DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-01')
       AND ft.status IN ('completed', 'flagged')
      WHERE fv.fleet_account_id = ${fleet.id}
      GROUP BY fv.id
      ORDER BY spend DESC, fv.plate_number ASC
      LIMIT 5
    `,
    prisma.$queryRaw`
      SELECT DATE(ft.created_at) AS day, COALESCE(SUM(ft.amount), 0) AS amount
      FROM fleet_transactions ft
      WHERE ft.fleet_account_id = ${fleet.id}
        AND ft.created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)
      GROUP BY DATE(ft.created_at)
      ORDER BY day ASC
    `,
    prisma.$queryRaw`
      SELECT *
      FROM fleet_alerts
      WHERE fleet_account_id = ${fleet.id}
      ORDER BY read_at IS NULL DESC, created_at DESC
      LIMIT 8
    `,
  ])

  const metrics = metricRows?.[0] || {}
  const activeVehicles = Number(metrics.active_vehicles || 0)
  const monthlySpend = toMoneyNumber(metrics.monthly_spend)
  const mappedAlerts = (alertRows || []).map((row) => ({
    publicId: row.public_id,
    type: row.type,
    severity: row.severity,
    title: row.title,
    message: row.message,
    readAt: toIsoOrNull(row.read_at),
    createdAt: toIsoOrNull(row.created_at),
  }))
  const mappedSpendTrend = (trendRows || []).map((row) => ({
    date: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day || "").slice(0, 10),
    amount: toMoneyNumber(row.amount),
  }))
  const overview = await buildFleetReferenceOverview({
    fleetAccountId: fleet.id,
    metrics,
    wallet,
    recentTransactions: recentRows.items,
    pendingFuelRequests: pendingRows.items,
    spendTrend: mappedSpendTrend,
    alerts: mappedAlerts,
  })
  return {
    fleet: mapFleetAccountRow(fleet),
    membership: mapMembershipRow(membership),
    wallet,
    kpis: {
      walletBalance: wallet.balance,
      reservedBalance: wallet.reservedBalance,
      availableBalance: wallet.availableBalance,
      totalFuelSpendThisMonth: monthlySpend,
      totalLitresThisMonth: toLitresNumber(metrics.monthly_litres),
      activeVehicles,
      activeDrivers: Number(metrics.active_drivers || 0),
      pendingApprovals: Number(metrics.pending_approvals || 0),
      suspiciousTransactions: Number(metrics.suspicious_transactions || 0),
      averageSpendPerVehicle: activeVehicles ? toMoneyNumber(monthlySpend / activeVehicles) : 0,
    },
    recentTransactions: recentRows.items,
    pendingFuelRequests: pendingRows.items,
    topSpendingVehicles: (topVehicleRows || []).map((row) => ({
      publicId: row.public_id,
      plateNumber: row.plate_number,
      vehicleName: row.vehicle_name,
      spend: toMoneyNumber(row.spend),
    })),
    spendTrend: mappedSpendTrend,
    alerts: mappedAlerts,
    overview,
    lowWalletWarning: wallet.availableBalance <= LOW_WALLET_THRESHOLD_MWK,
  }
}

export async function getFleetFinancialOps({ auth, fleetId, filters = {} }) {
  const { fleet, membership } = await requireFleetAccess({
    auth,
    fleetId,
    permission: FLEET_PERMISSIONS.DASHBOARD_VIEW,
    managerOnly: true,
    touchLastAccessed: true,
  })
  const window = monthWindow(filters.month)
  const wallet = mapWalletRow(await resolveFleetWallet(prisma, fleet.id))
  const [
    metricRows,
    routeMetricRows,
    budgetRows,
    invoiceTotalRows,
    spendSeriesRows,
    kmSeriesRows,
    fuelBreakdownRows,
    maintenanceTotalRows,
    vehicleRows,
    driverRows,
    activeRouteRows,
    recentTransactionRows,
    alertRows,
  ] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        COALESCE(SUM(CASE WHEN ft.created_at >= ${window.startDate} AND ft.created_at < ${window.endDate} THEN ft.amount ELSE 0 END), 0) AS monthly_fuel_cost,
        COALESCE(SUM(CASE WHEN ft.created_at >= ${window.startDate} AND ft.created_at < ${window.endDate} THEN ft.litres ELSE 0 END), 0) AS monthly_litres,
        COALESCE(SUM(CASE WHEN ft.created_at >= DATE_SUB(${window.startDate}, INTERVAL 1 MONTH) AND ft.created_at < ${window.startDate} THEN ft.amount ELSE 0 END), 0) AS previous_month_fuel_cost,
        (SELECT COUNT(*) FROM fleet_vehicles fv WHERE fv.fleet_account_id = ${fleet.id} AND fv.status = 'active') AS active_vehicles,
        (SELECT COUNT(*) FROM fleet_members fm WHERE fm.fleet_account_id = ${fleet.id} AND fm.role = 'driver' AND fm.status = 'active') AS active_drivers,
        (SELECT COUNT(*) FROM fleet_fuel_requests fr WHERE fr.fleet_account_id = ${fleet.id} AND fr.status = 'pending') AS pending_approvals,
        (SELECT COUNT(*) FROM fleet_alerts fa WHERE fa.fleet_account_id = ${fleet.id} AND fa.read_at IS NULL) AS open_alerts,
        (SELECT COUNT(*) FROM fleet_transactions tx WHERE tx.fleet_account_id = ${fleet.id} AND tx.risk_status IN ('suspicious', 'blocked')) AS suspicious_transactions
      FROM fleet_transactions ft
      WHERE ft.fleet_account_id = ${fleet.id}
        AND ft.status IN ('completed', 'flagged')
    `,
    prisma.$queryRaw`
      SELECT
        COALESCE(SUM(distance_km), 0) AS monthly_km,
        COALESCE(SUM(fuel_cost), 0) AS route_fuel_cost,
        COALESCE(SUM(other_cost), 0) AS route_other_cost,
        COALESCE(SUM(revenue_amount), 0) AS route_revenue,
        SUM(CASE WHEN route_status = 'active' THEN 1 ELSE 0 END) AS active_routes,
        SUM(CASE WHEN route_status = 'completed' THEN 1 ELSE 0 END) AS completed_routes
      FROM fleet_route_activity
      WHERE fleet_account_id = ${fleet.id}
        AND COALESCE(started_at, created_at) >= ${window.startDate}
        AND COALESCE(started_at, created_at) < ${window.endDate}
    `,
    prisma.$queryRaw`
      SELECT *
      FROM fleet_budgets
      WHERE fleet_account_id = ${fleet.id}
        AND budget_month = ${window.startDate}
      LIMIT 1
    `,
    prisma.$queryRaw`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'pending' THEN total_amount - paid_amount ELSE 0 END), 0) AS pending,
        COALESCE(SUM(CASE WHEN status = 'overdue' THEN total_amount - paid_amount ELSE 0 END), 0) AS overdue,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN paid_amount ELSE 0 END), 0) AS paid,
        COUNT(*) AS invoice_count
      FROM fleet_invoices
      WHERE fleet_account_id = ${fleet.id}
    `,
    prisma.$queryRaw`
      SELECT DATE(ft.created_at) AS day, COALESCE(SUM(ft.amount), 0) AS amount
      FROM fleet_transactions ft
      WHERE ft.fleet_account_id = ${fleet.id}
        AND ft.status IN ('completed', 'flagged')
        AND ft.created_at >= DATE_SUB(UTC_DATE(), INTERVAL 6 DAY)
      GROUP BY DATE(ft.created_at)
      ORDER BY day ASC
    `,
    prisma.$queryRaw`
      SELECT DATE(COALESCE(started_at, created_at)) AS day, COALESCE(SUM(distance_km), 0) AS km
      FROM fleet_route_activity
      WHERE fleet_account_id = ${fleet.id}
        AND COALESCE(started_at, created_at) >= DATE_SUB(UTC_DATE(), INTERVAL 6 DAY)
      GROUP BY DATE(COALESCE(started_at, created_at))
      ORDER BY day ASC
    `,
    prisma.$queryRaw`
      SELECT fuel_type, COALESCE(SUM(amount), 0) AS amount
      FROM fleet_transactions
      WHERE fleet_account_id = ${fleet.id}
        AND status IN ('completed', 'flagged')
        AND created_at >= ${window.startDate}
        AND created_at < ${window.endDate}
      GROUP BY fuel_type
      ORDER BY amount DESC
    `,
    prisma.$queryRaw`
      SELECT
        COALESCE(SUM(
          CASE
            WHEN status = 'completed' AND completed_at >= ${window.startDate} AND completed_at < ${window.endDate} THEN cost_actual
            WHEN status IN ('due', 'scheduled', 'overdue') THEN cost_estimate
            ELSE 0
          END
        ), 0) AS maintenance_cost,
        SUM(CASE WHEN status IN ('due', 'scheduled', 'overdue') THEN 1 ELSE 0 END) AS open_maintenance
      FROM fleet_maintenance_records
      WHERE fleet_account_id = ${fleet.id}
    `,
    prisma.$queryRaw`
      SELECT
        fvl.*,
        fv.public_id AS vehicle_public_id,
        fv.plate_number,
        fv.vehicle_name,
        fv.vehicle_type,
        fv.current_odometer,
        fv.status AS vehicle_status,
        COALESCE(tx.monthly_spend, 0) AS monthly_spend,
        COALESCE(tx.cost_today, 0) AS cost_today,
        tx.last_fueling_at,
        COALESCE(rt.monthly_km, 0) AS monthly_km,
        COALESCE(ad.assigned_drivers_json, '[]') AS assigned_drivers_json
      FROM fleet_vehicles fv
      LEFT JOIN fleet_vehicle_live_states fvl
        ON fvl.vehicle_id = fv.id
       AND fvl.fleet_account_id = fv.fleet_account_id
      LEFT JOIN (
        SELECT
          vehicle_id,
          SUM(CASE WHEN created_at >= ${window.startDate} AND created_at < ${window.endDate} THEN amount ELSE 0 END) AS monthly_spend,
          SUM(CASE WHEN created_at >= UTC_DATE() THEN amount ELSE 0 END) AS cost_today,
          MAX(created_at) AS last_fueling_at
        FROM fleet_transactions
        WHERE fleet_account_id = ${fleet.id}
          AND status IN ('completed', 'flagged')
        GROUP BY vehicle_id
      ) tx ON tx.vehicle_id = fv.id
      LEFT JOIN (
        SELECT vehicle_id, SUM(distance_km) AS monthly_km
        FROM fleet_route_activity
        WHERE fleet_account_id = ${fleet.id}
          AND vehicle_id IS NOT NULL
          AND COALESCE(started_at, created_at) >= ${window.startDate}
          AND COALESCE(started_at, created_at) < ${window.endDate}
        GROUP BY vehicle_id
      ) rt ON rt.vehicle_id = fv.id
      LEFT JOIN (
        SELECT
          fva.vehicle_id,
          CONCAT('[', COALESCE(GROUP_CONCAT(DISTINCT JSON_OBJECT('publicId', u.public_id, 'fullName', u.full_name, 'phone', u.phone_e164)), ''), ']') AS assigned_drivers_json
        FROM fleet_vehicle_assignments fva
        INNER JOIN users u ON u.id = fva.user_id
        WHERE fva.fleet_account_id = ${fleet.id}
          AND fva.status = 'active'
        GROUP BY fva.vehicle_id
      ) ad ON ad.vehicle_id = fv.id
      WHERE fv.fleet_account_id = ${fleet.id}
      ORDER BY FIELD(COALESCE(fvl.operational_status, 'offline'), 'active', 'idle', 'in_service', 'offline'), fv.plate_number ASC
      LIMIT 100
    `,
    prisma.$queryRaw`
      SELECT
        fm.public_id AS member_public_id,
        fm.role,
        fm.status,
        u.public_id AS user_public_id,
        u.full_name,
        u.email,
        u.phone_e164,
        COALESCE(tx.monthly_spend, 0) AS monthly_spend,
        COALESCE(tx.monthly_litres, 0) AS monthly_litres,
        COALESCE(rt.monthly_km, 0) AS monthly_km,
        GREATEST(COALESCE(tx.last_activity_at, '1970-01-01'), COALESCE(rt.last_activity_at, '1970-01-01')) AS last_activity_at
      FROM fleet_members fm
      INNER JOIN users u ON u.id = fm.user_id
      LEFT JOIN (
        SELECT
          driver_user_id,
          SUM(amount) AS monthly_spend,
          SUM(litres) AS monthly_litres,
          MAX(created_at) AS last_activity_at
        FROM fleet_transactions
        WHERE fleet_account_id = ${fleet.id}
          AND status IN ('completed', 'flagged')
          AND created_at >= ${window.startDate}
          AND created_at < ${window.endDate}
        GROUP BY driver_user_id
      ) tx ON tx.driver_user_id = fm.user_id
      LEFT JOIN (
        SELECT
          driver_user_id,
          SUM(distance_km) AS monthly_km,
          MAX(COALESCE(started_at, created_at)) AS last_activity_at
        FROM fleet_route_activity
        WHERE fleet_account_id = ${fleet.id}
          AND driver_user_id IS NOT NULL
          AND COALESCE(started_at, created_at) >= ${window.startDate}
          AND COALESCE(started_at, created_at) < ${window.endDate}
        GROUP BY driver_user_id
      ) rt ON rt.driver_user_id = fm.user_id
      WHERE fm.fleet_account_id = ${fleet.id}
      ORDER BY FIELD(fm.status, 'active', 'pending', 'suspended', 'removed'), monthly_spend DESC, u.full_name ASC
      LIMIT 100
    `,
    prisma.$queryRaw`
      SELECT fra.*,
             fv.public_id AS vehicle_public_id, fv.plate_number, fv.vehicle_name,
             u.public_id AS driver_public_id, u.full_name AS driver_name, u.phone_e164 AS driver_phone
      FROM fleet_route_activity fra
      LEFT JOIN fleet_vehicles fv ON fv.id = fra.vehicle_id
      LEFT JOIN users u ON u.id = fra.driver_user_id
      WHERE fra.fleet_account_id = ${fleet.id}
      ORDER BY COALESCE(fra.started_at, fra.created_at) DESC
      LIMIT 8
    `,
    listFleetTransactionsInternal({ fleetAccountId: fleet.id, filters: { page: 1, limit: 8 } }),
    prisma.$queryRaw`
      SELECT *
      FROM fleet_alerts
      WHERE fleet_account_id = ${fleet.id}
      ORDER BY read_at IS NULL DESC, created_at DESC
      LIMIT 8
    `,
  ])

  const metrics = metricRows?.[0] || {}
  const routeMetrics = routeMetricRows?.[0] || {}
  const budget = budgetRows?.[0] ? mapBudgetRow(budgetRows[0]) : null
  const invoiceTotals = invoiceTotalRows?.[0] || {}
  const maintenanceTotals = maintenanceTotalRows?.[0] || {}
  const financialMetrics = calculateFleetFinancialOpsMetrics({
    monthlyFuelCost: metrics.monthly_fuel_cost,
    monthlyKm: routeMetrics.monthly_km,
    budget,
    invoices: invoiceTotals,
  })
  const previousSpend = toMoneyNumber(metrics.previous_month_fuel_cost)
  const spendChangePercent = previousSpend > 0 ? Number((((financialMetrics.monthlyFuelCost - previousSpend) / previousSpend) * 100).toFixed(1)) : null
  const vehicleStatusRows = (vehicleRows || []).map((row) => ({
    ...mapVehicleLiveStateRow(row),
    monthlySpend: toMoneyNumber(row.monthly_spend),
    costToday: toMoneyNumber(row.cost_today),
    monthlyKm: Number(row.monthly_km || 0),
    lastFuelingAt: toIsoOrNull(row.last_fueling_at),
  }))
  const statusCounts = vehicleStatusRows.reduce(
    (counts, row) => {
      counts[row.operationalStatus] = (counts[row.operationalStatus] || 0) + 1
      return counts
    },
    { active: 0, idle: 0, in_service: 0, offline: 0 }
  )
  const routeActivity = (activeRouteRows || []).map(mapRouteActivityRow)
  const liveActivity = [
    ...recentTransactionRows.items.map((item) => ({
      type: "transaction",
      tone: item.riskStatus === "normal" ? "safe" : "warning",
      title: `${item.vehicle?.plateNumber || "Vehicle"} fueled at ${item.station?.name || "station"}`,
      detail: `${item.driver?.fullName || "Driver"} - ${toLitresNumber(item.litres).toLocaleString()} L`,
      amount: toMoneyNumber(item.amount),
      occurredAt: item.createdAt,
    })),
    ...routeActivity.map((item) => ({
      type: "route",
      tone: item.routeStatus === "active" ? "safe" : item.routeStatus === "cancelled" ? "danger" : "info",
      title: item.routeName,
      detail: `${item.vehicle?.plateNumber || "Fleet vehicle"} - ${Number(item.distanceKm || 0).toLocaleString()} km`,
      amount: item.revenueAmount,
      occurredAt: item.startedAt || item.createdAt,
    })),
  ]
    .sort((left, right) => new Date(right.occurredAt || 0).getTime() - new Date(left.occurredAt || 0).getTime())
    .slice(0, 10)

  const fuelBreakdown = (fuelBreakdownRows || []).map((row) => ({
    label: String(row.fuel_type || "unknown"),
    amount: toMoneyNumber(row.amount),
  }))
  const maintenanceCost = toMoneyNumber(maintenanceTotals.maintenance_cost)
  const routeOtherCost = toMoneyNumber(routeMetrics.route_other_cost)
  const spendBreakdown = [
    ...fuelBreakdown,
    { label: "maintenance", amount: maintenanceCost },
    { label: "other", amount: routeOtherCost },
  ].filter((item) => item.amount > 0)
  const spendBreakdownTotal = spendBreakdown.reduce((sum, item) => sum + item.amount, 0)

  return {
    fleet: mapFleetAccountRow(fleet),
    membership: mapMembershipRow(membership),
    month: window.month,
    wallet,
    kpis: {
      walletBalance: wallet.balance,
      availableBalance: wallet.availableBalance,
      monthlyFuelCost: financialMetrics.monthlyFuelCost,
      totalFuelSpendThisMonth: financialMetrics.monthlyFuelCost,
      totalLitresThisMonth: toLitresNumber(metrics.monthly_litres),
      costPerKm: financialMetrics.costPerKm,
      activeVehicles: Number(metrics.active_vehicles || 0),
      idleVehicles: Number(statusCounts.idle || 0),
      serviceVehicles: Number(statusCounts.in_service || 0),
      offlineVehicles: Number(statusCounts.offline || 0),
      activeDrivers: Number(metrics.active_drivers || 0),
      pendingApprovals: Number(metrics.pending_approvals || 0),
      openAlerts: Number(metrics.open_alerts || 0),
      suspiciousTransactions: Number(metrics.suspicious_transactions || 0),
      spendChangePercent,
      monthlyKm: financialMetrics.monthlyKm,
      activeRoutes: Number(routeMetrics.active_routes || 0),
      completedRoutes: Number(routeMetrics.completed_routes || 0),
      openMaintenance: Number(maintenanceTotals.open_maintenance || 0),
    },
    trends: {
      fuelSpend7Day: fillRecentDailySeries(spendSeriesRows, { key: "amount" }).map((item) => ({ date: item.date, amount: item.value })),
      km7Day: fillRecentDailySeries(kmSeriesRows, { key: "km" }).map((item) => ({ date: item.date, km: item.value })),
    },
    spendBreakdown: {
      total: toMoneyNumber(spendBreakdownTotal),
      items: spendBreakdown.map((item) => ({
        ...item,
        percent: spendBreakdownTotal > 0 ? Number(((item.amount / spendBreakdownTotal) * 100).toFixed(1)) : 0,
      })),
    },
    budget: {
      current: budget,
      variance: financialMetrics.budgetVariance,
      varianceStatus: financialMetrics.budgetVarianceStatus,
      totalBudget: financialMetrics.totalBudget,
      fuelBudgetUsedPercent: budget?.fuelBudget ? Number(((financialMetrics.monthlyFuelCost / budget.fuelBudget) * 100).toFixed(1)) : 0,
    },
    financialTotals: {
      ...financialMetrics.invoiceTotals,
      invoiceCount: Number(invoiceTotals.invoice_count || 0),
      routeRevenue: toMoneyNumber(routeMetrics.route_revenue),
      maintenanceCost,
      routeOtherCost,
      reservedBalance: wallet.reservedBalance,
      availableBalance: wallet.availableBalance,
    },
    vehicleStatusRows,
    driverRows: (driverRows || []).map((row) => ({
      memberPublicId: row.member_public_id,
      userPublicId: row.user_public_id,
      fullName: nullableText(row.full_name),
      email: nullableText(row.email),
      phone: nullableText(row.phone_e164),
      role: row.role,
      status: row.status,
      monthlySpend: toMoneyNumber(row.monthly_spend),
      monthlyLitres: toLitresNumber(row.monthly_litres),
      monthlyKm: Number(row.monthly_km || 0),
      costPerKm: Number(row.monthly_km || 0) > 0 ? toMoneyNumber(Number(row.monthly_spend || 0) / Number(row.monthly_km || 1)) : 0,
      lastActivityAt: row.last_activity_at === "1970-01-01" ? null : toIsoOrNull(row.last_activity_at),
    })),
    routeActivity,
    liveActivity,
    mapMarkers: vehicleStatusRows
      .filter((row) => row.latitude !== null && row.longitude !== null)
      .map((row) => ({
        publicId: row.publicId,
        vehiclePublicId: row.vehicle.publicId,
        label: row.vehicle.plateNumber,
        status: row.operationalStatus,
        latitude: row.latitude,
        longitude: row.longitude,
        locationLabel: row.locationLabel,
        lastSeenAt: row.lastSeenAt,
      })),
    alerts: (alertRows || []).map((row) => ({
      publicId: row.public_id,
      type: row.type,
      severity: row.severity,
      title: row.title,
      message: row.message,
      readAt: toIsoOrNull(row.read_at),
      createdAt: toIsoOrNull(row.created_at),
    })),
  }
}

async function listFleetDepartmentsInternal({ fleetAccountId }) {
  const rows = await prisma.$queryRaw`
    SELECT fd.*,
           u.public_id AS manager_public_id,
           u.full_name AS manager_name,
           u.phone_e164 AS manager_phone,
           u.email AS manager_email
    FROM fleet_departments fd
    LEFT JOIN users u ON u.id = fd.manager_user_id
    WHERE fd.fleet_account_id = ${fleetAccountId}
    ORDER BY FIELD(fd.status, 'active', 'suspended', 'archived'), fd.name ASC
  `
  return (rows || []).map(mapDepartmentRow)
}

export async function listFleetDepartments({ auth, fleetId }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.DASHBOARD_VIEW, managerOnly: true })
  return { items: await listFleetDepartmentsInternal({ fleetAccountId: fleet.id }) }
}

export async function saveFleetDepartment({ auth, fleetId, departmentId = null, payload, req }) {
  const { fleet, membership } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.DEPARTMENTS_MANAGE, managerOnly: true })
  assertFleetRoleAllowed(membership, FLEET_ADMIN_MANAGE_ROLES, "Only fleet owners and admins can manage departments")
  const existing = departmentId ? await resolveDepartment(prisma, { fleetAccountId: fleet.id, departmentId }) : null
  const manager = payload.managerUserPublicId ? await resolveUserByPublicId(prisma, payload.managerUserPublicId) : null
  if (payload.managerUserPublicId && !manager?.id) throw notFound("Department manager user not found")
  const publicId = departmentId || createPublicId()
  await prisma.$executeRaw`
    INSERT INTO fleet_departments (public_id, fleet_account_id, name, code, manager_user_id, status)
    VALUES (${publicId}, ${fleet.id}, ${payload.name || existing?.name}, ${payload.code === undefined ? existing?.code || null : nullableText(payload.code)}, ${manager?.id || existing?.manager_user_id || null}, ${payload.status || existing?.status || "active"})
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      code = VALUES(code),
      manager_user_id = VALUES(manager_user_id),
      status = VALUES(status),
      updated_at = CURRENT_TIMESTAMP(3)
  `
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: departmentId ? "department.updated" : "department.created",
    entityType: "fleet_department",
    entityId: publicId,
    metadata: payload,
    ipAddress: readClientIp(req),
  })
  const rows = await prisma.$queryRaw`
    SELECT fd.*,
           u.public_id AS manager_public_id,
           u.full_name AS manager_name,
           u.phone_e164 AS manager_phone,
           u.email AS manager_email
    FROM fleet_departments fd
    LEFT JOIN users u ON u.id = fd.manager_user_id
    WHERE fd.fleet_account_id = ${fleet.id}
      AND fd.public_id = ${publicId}
    LIMIT 1
  `
  return { department: mapDepartmentRow(rows?.[0]) }
}

export async function archiveFleetDepartment({ auth, fleetId, departmentId, req }) {
  const { fleet, membership } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.DEPARTMENTS_MANAGE, managerOnly: true })
  assertFleetRoleAllowed(membership, FLEET_ADMIN_MANAGE_ROLES, "Only fleet owners and admins can archive departments")
  const department = await resolveDepartment(prisma, { fleetAccountId: fleet.id, departmentId })
  await prisma.$executeRaw`
    UPDATE fleet_departments
    SET status = 'archived', updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${department.id}
  `
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: "department.archived",
    entityType: "fleet_department",
    entityId: department.public_id,
    ipAddress: readClientIp(req),
  })
  return { archived: true }
}

async function listFleetAllocationsInternal({ fleetAccountId }) {
  const rows = await prisma.$queryRaw`
    SELECT fa.*,
           fd.public_id AS department_public_id, fd.name AS department_name, fd.code AS department_code,
           fv.public_id AS vehicle_public_id, fv.plate_number, fv.vehicle_name,
           u.public_id AS driver_public_id, u.full_name AS driver_name, u.phone_e164 AS driver_phone,
           fc.public_id AS fuel_card_public_id, fc.card_label, fc.masked_card_number, fc.provider_status
    FROM fleet_allocations fa
    LEFT JOIN fleet_departments fd ON fd.id = fa.department_id
    LEFT JOIN fleet_vehicles fv ON fv.id = fa.vehicle_id
    LEFT JOIN users u ON u.id = fa.driver_user_id
    LEFT JOIN fleet_fuel_cards fc ON fc.id = fa.fuel_card_id
    WHERE fa.fleet_account_id = ${fleetAccountId}
    ORDER BY FIELD(fa.status, 'active', 'paused', 'archived'), FIELD(fa.allocation_target_type, 'fleet', 'department', 'vehicle', 'driver', 'card', 'trip', 'emergency_reserve'), fa.id ASC
  `
  return (rows || []).map(mapAllocationRow)
}

export async function listFleetAllocations({ auth, fleetId }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.ALLOCATIONS_VIEW, managerOnly: true })
  return { items: await listFleetAllocationsInternal({ fleetAccountId: fleet.id }) }
}

async function resolveAllocationTargets(db, fleetAccountId, payload) {
  const department = await resolveDepartment(db, { fleetAccountId, departmentId: payload.departmentId })
  const vehicle = payload.vehicleId ? await resolveVehicle(db, { fleetAccountId, vehicleId: payload.vehicleId }) : null
  const driver = payload.driverUserPublicId ? await resolveUserByPublicId(db, payload.driverUserPublicId) : null
  if (payload.driverUserPublicId && !driver?.id) throw notFound("Driver user not found")
  const fuelCard = await resolveFuelCard(db, { fleetAccountId, fuelCardId: payload.fuelCardId })
  return { department, vehicle, driver, fuelCard }
}

export async function saveFleetAllocation({ auth, fleetId, allocationId = null, payload, req }) {
  const { fleet, membership } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.ALLOCATIONS_MANAGE, managerOnly: true })
  assertFleetRoleAllowed(membership, FLEET_ALLOCATION_MANAGE_ROLES, "Only fleet owners, admins, and finance users can manage allocations")
  const existing = allocationId ? await resolveAllocation(prisma, { fleetAccountId: fleet.id, allocationId }) : null
  const { department, vehicle, driver, fuelCard } = await resolveAllocationTargets(prisma, fleet.id, payload)
  const publicId = allocationId || createPublicId()
  const monthlyLitreCap = payload.monthlyLitreCap ?? existing?.monthly_litre_cap ?? null
  const monthlyMoneyCap = payload.monthlyMoneyCap ?? existing?.monthly_money_cap ?? null
  const currentLitreBalance = payload.currentLitreBalance ?? existing?.current_litre_balance ?? monthlyLitreCap ?? 0
  const currentMoneyBalance = payload.currentMoneyBalance ?? existing?.current_money_balance ?? monthlyMoneyCap ?? 0
  await prisma.$executeRaw`
    INSERT INTO fleet_allocations (
      public_id, fleet_account_id, department_id, vehicle_id, driver_user_id, fuel_card_id,
      allocation_target_type, allocation_unit, monthly_litre_cap, monthly_money_cap,
      current_litre_balance, current_money_balance, used_litres_current_period, used_money_current_period,
      carry_over_litres, carry_over_money, rollover_policy, max_carryover_litres, max_carryover_money,
      period_start, period_end, status
    )
    VALUES (
      ${publicId}, ${fleet.id}, ${department?.id || existing?.department_id || null}, ${vehicle?.id || existing?.vehicle_id || null}, ${driver?.id || existing?.driver_user_id || null}, ${fuelCard?.id || existing?.fuel_card_id || null},
      ${payload.allocationTargetType || existing?.allocation_target_type || "fleet"}, ${payload.allocationUnit || existing?.allocation_unit || "litres"}, ${monthlyLitreCap}, ${monthlyMoneyCap},
      ${currentLitreBalance}, ${currentMoneyBalance}, ${payload.usedLitresCurrentPeriod ?? existing?.used_litres_current_period ?? 0}, ${payload.usedMoneyCurrentPeriod ?? existing?.used_money_current_period ?? 0},
      ${payload.carryOverLitres ?? existing?.carry_over_litres ?? 0}, ${payload.carryOverMoney ?? existing?.carry_over_money ?? 0}, ${payload.rolloverPolicy || existing?.rollover_policy || "top_up_to_cap"}, ${payload.maxCarryoverLitres ?? existing?.max_carryover_litres ?? null}, ${payload.maxCarryoverMoney ?? existing?.max_carryover_money ?? null},
      ${payload.periodStart || (existing?.period_start instanceof Date ? existing.period_start.toISOString().slice(0, 10) : existing?.period_start)}, ${payload.periodEnd || (existing?.period_end instanceof Date ? existing.period_end.toISOString().slice(0, 10) : existing?.period_end)}, ${payload.status || existing?.status || "active"}
    )
    ON DUPLICATE KEY UPDATE
      department_id = VALUES(department_id),
      vehicle_id = VALUES(vehicle_id),
      driver_user_id = VALUES(driver_user_id),
      fuel_card_id = VALUES(fuel_card_id),
      allocation_target_type = VALUES(allocation_target_type),
      allocation_unit = VALUES(allocation_unit),
      monthly_litre_cap = VALUES(monthly_litre_cap),
      monthly_money_cap = VALUES(monthly_money_cap),
      current_litre_balance = VALUES(current_litre_balance),
      current_money_balance = VALUES(current_money_balance),
      used_litres_current_period = VALUES(used_litres_current_period),
      used_money_current_period = VALUES(used_money_current_period),
      carry_over_litres = VALUES(carry_over_litres),
      carry_over_money = VALUES(carry_over_money),
      rollover_policy = VALUES(rollover_policy),
      max_carryover_litres = VALUES(max_carryover_litres),
      max_carryover_money = VALUES(max_carryover_money),
      period_start = VALUES(period_start),
      period_end = VALUES(period_end),
      status = VALUES(status),
      updated_at = CURRENT_TIMESTAMP(3)
  `
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: allocationId ? "allocation.updated" : "allocation.created",
    entityType: "fleet_allocation",
    entityId: publicId,
    metadata: payload,
    ipAddress: readClientIp(req),
  })
  return { allocation: (await listFleetAllocationsInternal({ fleetAccountId: fleet.id })).find((item) => item.publicId === publicId) || null }
}

export async function adjustFleetAllocation({ auth, fleetId, allocationId, payload, req }) {
  const { fleet, membership } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.ALLOCATIONS_MANAGE, managerOnly: true })
  assertFleetRoleAllowed(membership, FLEET_ALLOCATION_MANAGE_ROLES, "Only fleet owners, admins, and finance users can adjust allocations")
  return prisma.$transaction(async (tx) => {
    const allocation = await resolveAllocation(tx, { fleetAccountId: fleet.id, allocationId, forUpdate: true })
    const litresDelta = toLitresNumber(payload.litres)
    const amountDelta = toMoneyNumber(payload.amount)
    const multiplier = payload.transactionType === "reversal" ? -1 : 1
    const newLitres = toLitresNumber(Number(allocation.current_litre_balance || 0) + litresDelta * multiplier)
    const newAmount = toMoneyNumber(Number(allocation.current_money_balance || 0) + amountDelta * multiplier)
    if (newLitres < 0 || newAmount < 0) throw badRequest("Allocation adjustment cannot make the balance negative")
    await tx.$executeRaw`
      UPDATE fleet_allocations
      SET current_litre_balance = ${newLitres},
          current_money_balance = ${newAmount},
          updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${allocation.id}
    `
    await tx.$executeRaw`
      INSERT INTO fleet_allocation_transactions (
        public_id, fleet_account_id, allocation_id, transaction_type, litres, amount, reference, created_by_user_id
      )
      VALUES (
        ${createPublicId()}, ${fleet.id}, ${allocation.id}, ${payload.transactionType}, ${litresDelta || null}, ${amountDelta || null}, ${nullableText(payload.reference) || buildReference("ALLOC")}, ${Number(auth.userId)}
      )
    `
    await writeFleetAuditLog(tx, {
      fleetAccountId: fleet.id,
      actorUserId: Number(auth.userId),
      action: "allocation.adjusted",
      entityType: "fleet_allocation",
      entityId: allocation.public_id,
      metadata: { ...payload, newLitres, newAmount },
      ipAddress: readClientIp(req),
    })
    return { adjusted: true, currentLitreBalance: newLitres, currentMoneyBalance: newAmount }
  })
}

export async function previewFleetAllocationRollover({ auth, fleetId, payload }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.ALLOCATIONS_VIEW, managerOnly: true })
  const allocationIds = Array.isArray(payload.allocationIds) && payload.allocationIds.length ? payload.allocationIds : null
  const rows = allocationIds
    ? await prisma.$queryRaw`
        SELECT *
        FROM fleet_allocations
        WHERE fleet_account_id = ${fleet.id}
          AND public_id IN (${Prisma.join(allocationIds)})
          AND status = 'active'
      `
    : await prisma.$queryRaw`
        SELECT *
        FROM fleet_allocations
        WHERE fleet_account_id = ${fleet.id}
          AND status = 'active'
      `
  return {
    items: (rows || []).map((row) => calculateFleetAllocationRollover(row, { periodStart: payload.periodStart, periodEnd: payload.periodEnd })),
  }
}

export async function executeFleetAllocationRollover({ auth, fleetId, payload, req }) {
  const { fleet, membership } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.ALLOCATIONS_MANAGE, managerOnly: true })
  assertFleetRoleAllowed(membership, FLEET_ALLOCATION_MANAGE_ROLES, "Only fleet owners, admins, and finance users can execute allocation rollover")
  return prisma.$transaction(async (tx) => {
    const allocationIds = Array.isArray(payload.allocationIds) && payload.allocationIds.length ? payload.allocationIds : null
    const rows = allocationIds
      ? await tx.$queryRaw`
          SELECT *
          FROM fleet_allocations
          WHERE fleet_account_id = ${fleet.id}
            AND public_id IN (${Prisma.join(allocationIds)})
            AND status = 'active'
          FOR UPDATE
        `
      : await tx.$queryRaw`
          SELECT *
          FROM fleet_allocations
          WHERE fleet_account_id = ${fleet.id}
            AND status = 'active'
          FOR UPDATE
        `
    const results = []
    for (const row of rows || []) {
      const preview = calculateFleetAllocationRollover(row, { periodStart: payload.periodStart, periodEnd: payload.periodEnd })
      await tx.$executeRaw`
        INSERT INTO fleet_allocation_rollovers (
          public_id, fleet_account_id, allocation_id, rollover_policy,
          previous_litre_balance, previous_money_balance, top_up_litres, top_up_amount,
          new_litre_balance, new_money_balance, period_start, period_end, status, executed_by_user_id, executed_at
        )
        VALUES (
          ${createPublicId()}, ${fleet.id}, ${row.id}, ${preview.rolloverPolicy},
          ${preview.previousLitreBalance}, ${preview.previousMoneyBalance}, ${preview.topUpLitres}, ${preview.topUpAmount},
          ${preview.newLitreBalance}, ${preview.newMoneyBalance}, ${payload.periodStart}, ${payload.periodEnd}, 'executed', ${Number(auth.userId)}, CURRENT_TIMESTAMP(3)
        )
      `
      if (!preview.requiresManualReview) {
        await tx.$executeRaw`
          UPDATE fleet_allocations
          SET current_litre_balance = ${preview.newLitreBalance},
              current_money_balance = ${preview.newMoneyBalance},
              carry_over_litres = ${preview.previousLitreBalance},
              carry_over_money = ${preview.previousMoneyBalance},
              used_litres_current_period = 0,
              used_money_current_period = 0,
              period_start = ${payload.periodStart},
              period_end = ${payload.periodEnd},
              updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ${row.id}
        `
      }
      results.push(preview)
    }
    await writeFleetAuditLog(tx, {
      fleetAccountId: fleet.id,
      actorUserId: Number(auth.userId),
      action: "allocation.rollover_executed",
      entityType: "fleet_allocation",
      metadata: { count: results.length, periodStart: payload.periodStart, periodEnd: payload.periodEnd },
      ipAddress: readClientIp(req),
    })
    return { items: results }
  })
}

export async function getFleetAllocationUsageSummary({ auth, fleetId }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.ALLOCATIONS_VIEW, managerOnly: true })
  const rows = await prisma.$queryRaw`
    SELECT allocation_target_type,
           COALESCE(SUM(monthly_litre_cap), 0) AS monthly_litre_cap,
           COALESCE(SUM(current_litre_balance), 0) AS current_litre_balance,
           COALESCE(SUM(used_litres_current_period), 0) AS used_litres_current_period,
           COALESCE(SUM(monthly_money_cap), 0) AS monthly_money_cap,
           COALESCE(SUM(current_money_balance), 0) AS current_money_balance,
           COALESCE(SUM(used_money_current_period), 0) AS used_money_current_period
    FROM fleet_allocations
    WHERE fleet_account_id = ${fleet.id}
      AND status = 'active'
    GROUP BY allocation_target_type
    ORDER BY allocation_target_type ASC
  `
  return {
    items: (rows || []).map((row) => ({
      allocationTargetType: row.allocation_target_type,
      monthlyLitreCap: toLitresNumber(row.monthly_litre_cap),
      currentLitreBalance: toLitresNumber(row.current_litre_balance),
      usedLitresCurrentPeriod: toLitresNumber(row.used_litres_current_period),
      monthlyMoneyCap: toMoneyNumber(row.monthly_money_cap),
      currentMoneyBalance: toMoneyNumber(row.current_money_balance),
      usedMoneyCurrentPeriod: toMoneyNumber(row.used_money_current_period),
    })),
  }
}

export async function listFleetFuelCardProviders({ auth, fleetId }) {
  await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.FUEL_CARDS_VIEW, managerOnly: true })
  const rows = await prisma.$queryRaw`
    SELECT *
    FROM fleet_fuel_card_providers
    ORDER BY FIELD(status, 'active', 'inactive', 'archived'), name ASC
  `
  return { items: (rows || []).map(mapFuelCardProviderRow) }
}

export async function saveFleetFuelCardProvider({ auth, fleetId, payload, req }) {
  const { fleet, membership } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.FUEL_CARDS_MANAGE, managerOnly: true })
  assertFleetRoleAllowed(membership, FLEET_CARD_MANAGE_ROLES, "Only fleet owners, admins, and finance users can manage fuel-card providers")
  const supportsApi = payload.type === "myfuel" ? false : Boolean(payload.supportsApi)
  const publicId = createPublicId()
  await prisma.$executeRaw`
    INSERT INTO fleet_fuel_card_providers (public_id, name, type, supports_api, status)
    VALUES (${publicId}, ${payload.name}, ${payload.type}, ${supportsApi ? 1 : 0}, ${payload.status || "active"})
    ON DUPLICATE KEY UPDATE
      type = VALUES(type),
      supports_api = VALUES(supports_api),
      status = VALUES(status),
      updated_at = CURRENT_TIMESTAMP(3)
  `
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: "fuel_card_provider.saved",
    entityType: "fleet_fuel_card_provider",
    metadata: { ...payload, supportsApi },
    ipAddress: readClientIp(req),
  })
  const providerRows = await prisma.$queryRaw`SELECT * FROM fleet_fuel_card_providers WHERE name = ${payload.name} LIMIT 1`
  return { provider: mapFuelCardProviderRow(providerRows?.[0]) }
}

async function listFleetFuelCardsInternal({ fleetAccountId }) {
  const rows = await prisma.$queryRaw`
    SELECT fc.*,
           fp.public_id AS provider_public_id, fp.name AS provider_name, fp.type AS provider_type, fp.supports_api AS provider_supports_api,
           fd.public_id AS department_public_id, fd.name AS department_name, fd.code AS department_code,
           fv.public_id AS vehicle_public_id, fv.plate_number, fv.vehicle_name,
           u.public_id AS driver_public_id, u.full_name AS driver_name, u.phone_e164 AS driver_phone
    FROM fleet_fuel_cards fc
    INNER JOIN fleet_fuel_card_providers fp ON fp.id = fc.provider_id
    LEFT JOIN fleet_departments fd ON fd.id = fc.department_id
    LEFT JOIN fleet_vehicles fv ON fv.id = fc.linked_vehicle_id
    LEFT JOIN users u ON u.id = fc.linked_driver_user_id
    WHERE fc.fleet_account_id = ${fleetAccountId}
    ORDER BY FIELD(fc.status, 'active', 'suspended', 'blocked', 'archived'), fc.card_label ASC
  `
  return (rows || []).map(mapFuelCardRow)
}

export async function listFleetFuelCards({ auth, fleetId }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.FUEL_CARDS_VIEW, managerOnly: true })
  return { items: await listFleetFuelCardsInternal({ fleetAccountId: fleet.id }) }
}

export async function saveFleetFuelCard({ auth, fleetId, fuelCardId = null, payload, req }) {
  const { fleet, membership } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.FUEL_CARDS_MANAGE, managerOnly: true })
  assertFleetRoleAllowed(membership, FLEET_CARD_MANAGE_ROLES, "Only fleet owners, admins, and finance users can manage fuel cards")
  const existing = fuelCardId ? await resolveFuelCard(prisma, { fleetAccountId: fleet.id, fuelCardId }) : null
  const provider = payload.providerId
    ? await resolveFuelCardProvider(prisma, payload.providerId)
    : existing?.provider_id
      ? { id: existing.provider_id, type: existing.provider_type }
      : null
  if (!provider?.id) throw notFound("Fuel card provider not found")
  const department = await resolveDepartment(prisma, { fleetAccountId: fleet.id, departmentId: payload.departmentId })
  const vehicle = payload.linkedVehicleId ? await resolveVehicle(prisma, { fleetAccountId: fleet.id, vehicleId: payload.linkedVehicleId }) : null
  const driver = payload.linkedDriverUserPublicId ? await resolveUserByPublicId(prisma, payload.linkedDriverUserPublicId) : null
  if (payload.linkedDriverUserPublicId && !driver?.id) throw notFound("Linked driver user not found")
  const providerStatus = provider.type === "myfuel" && payload.providerStatus === "synced" ? "api_not_connected" : (payload.providerStatus || existing?.provider_status || "manual_tracking")
  const publicId = fuelCardId || createPublicId()
  await prisma.$executeRaw`
    INSERT INTO fleet_fuel_cards (
      public_id, fleet_account_id, provider_id, department_id, linked_vehicle_id, linked_driver_user_id,
      card_label, masked_card_number, status, provider_status,
      monthly_litre_limit, monthly_money_limit, daily_litre_limit, daily_money_limit
    )
    VALUES (
      ${publicId}, ${fleet.id}, ${provider.id}, ${department?.id || existing?.department_id || null}, ${vehicle?.id || existing?.linked_vehicle_id || null}, ${driver?.id || existing?.linked_driver_user_id || null},
      ${payload.cardLabel || existing?.card_label}, ${payload.maskedCardNumber || existing?.masked_card_number}, ${payload.status || existing?.status || "active"}, ${providerStatus},
      ${payload.monthlyLitreLimit ?? existing?.monthly_litre_limit ?? null}, ${payload.monthlyMoneyLimit ?? existing?.monthly_money_limit ?? null}, ${payload.dailyLitreLimit ?? existing?.daily_litre_limit ?? null}, ${payload.dailyMoneyLimit ?? existing?.daily_money_limit ?? null}
    )
    ON DUPLICATE KEY UPDATE
      provider_id = VALUES(provider_id),
      department_id = VALUES(department_id),
      linked_vehicle_id = VALUES(linked_vehicle_id),
      linked_driver_user_id = VALUES(linked_driver_user_id),
      card_label = VALUES(card_label),
      masked_card_number = VALUES(masked_card_number),
      status = VALUES(status),
      provider_status = VALUES(provider_status),
      monthly_litre_limit = VALUES(monthly_litre_limit),
      monthly_money_limit = VALUES(monthly_money_limit),
      daily_litre_limit = VALUES(daily_litre_limit),
      daily_money_limit = VALUES(daily_money_limit),
      updated_at = CURRENT_TIMESTAMP(3)
  `
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: fuelCardId ? "fuel_card.updated" : "fuel_card.created",
    entityType: "fleet_fuel_card",
    entityId: publicId,
    metadata: { ...payload, providerStatus },
    ipAddress: readClientIp(req),
  })
  return { fuelCard: (await listFleetFuelCardsInternal({ fleetAccountId: fleet.id })).find((item) => item.publicId === publicId) || null }
}

export async function createFleetFuelCardImport({ auth, fleetId, payload, req }) {
  const { fleet, membership } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.FUEL_CARDS_MANAGE, managerOnly: true })
  assertFleetRoleAllowed(membership, FLEET_CARD_MANAGE_ROLES, "Only fleet owners, admins, and finance users can import fuel card statements")
  const provider = await resolveFuelCardProvider(prisma, payload.providerId)
  const fuelCard = await resolveFuelCard(prisma, { fleetAccountId: fleet.id, fuelCardId: payload.fuelCardId })
  const publicId = createPublicId()
  await prisma.$executeRaw`
    INSERT INTO fleet_fuel_card_imports (
      public_id, fleet_account_id, provider_id, fuel_card_id, file_name, status, imported_by_user_id,
      rows_total, rows_matched, rows_unmatched, metadata_json
    )
    VALUES (
      ${publicId}, ${fleet.id}, ${provider.id}, ${fuelCard?.id || null}, ${nullableText(payload.fileName)}, 'pending', ${Number(auth.userId)},
      ${Number(payload.rowsTotal || 0)}, ${Number(payload.rowsMatched || 0)}, ${Number(payload.rowsUnmatched || 0)}, ${payload.metadata ? JSON.stringify(payload.metadata) : null}
    )
  `
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: "fuel_card_import.created",
    entityType: "fleet_fuel_card_import",
    entityId: publicId,
    metadata: { providerId: payload.providerId, fuelCardId: payload.fuelCardId || null, pendingParserIntegration: true },
    ipAddress: readClientIp(req),
  })
  return { importRecord: { publicId, status: "pending", parserIntegrationPending: true } }
}

async function listFleetFuelCardReconciliationInternal({ fleetAccountId }) {
  const rows = await prisma.$queryRaw`
    SELECT r.*,
           c.public_id AS card_transaction_public_id,
           c.external_reference,
           c.transaction_date,
           c.station_name,
           c.amount,
           c.litres,
           c.fuel_type,
           c.odometer_reading,
           c.raw_data_json,
           c.match_status,
           c.risk_status,
           c.created_at AS card_transaction_created_at,
           c.updated_at AS card_transaction_updated_at,
           fp.public_id AS provider_public_id, fp.name AS provider_name, fp.type AS provider_type,
           fc.public_id AS fuel_card_public_id, fc.card_label, fc.masked_card_number,
           st.public_id AS station_public_id, st.name AS smartlink_station_name,
           ft.public_id AS fleet_transaction_public_id, ft.amount AS fleet_transaction_amount, ft.litres AS fleet_transaction_litres, ft.created_at AS fleet_transaction_created_at,
           fv.public_id AS fleet_vehicle_public_id, fv.plate_number AS fleet_plate_number,
           u.public_id AS fleet_driver_public_id, u.full_name AS fleet_driver_name,
           mu.public_id AS matched_by_public_id, mu.full_name AS matched_by_name
    FROM fleet_fuel_card_reconciliation_matches r
    INNER JOIN fleet_fuel_card_transactions c ON c.id = r.card_transaction_id
    INNER JOIN fleet_fuel_card_providers fp ON fp.id = c.provider_id
    INNER JOIN fleet_fuel_cards fc ON fc.id = c.fuel_card_id
    LEFT JOIN stations st ON st.id = c.station_id
    LEFT JOIN fleet_transactions ft ON ft.id = r.fleet_transaction_id
    LEFT JOIN fleet_vehicles fv ON fv.id = ft.vehicle_id
    LEFT JOIN users u ON u.id = ft.driver_user_id
    LEFT JOIN users mu ON mu.id = r.matched_by_user_id
    WHERE r.fleet_account_id = ${fleetAccountId}
    ORDER BY FIELD(r.status, 'needs_review', 'unmatched', 'suspicious', 'duplicate', 'matched'), c.transaction_date DESC
  `
  return (rows || []).map(mapReconciliationRow)
}

export async function listFleetFuelCardReconciliation({ auth, fleetId }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.FUEL_CARDS_VIEW, managerOnly: true })
  return { items: await listFleetFuelCardReconciliationInternal({ fleetAccountId: fleet.id }) }
}

export async function updateFleetFuelCardReconciliation({ auth, fleetId, matchId, payload, req }) {
  const { fleet, membership } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.FUEL_CARDS_MANAGE, managerOnly: true })
  assertFleetRoleAllowed(membership, FLEET_CARD_MANAGE_ROLES, "Only fleet owners, admins, and finance users can reconcile fuel cards")
  let fleetTransaction = null
  if (payload.fleetTransactionId) {
    const txRows = await prisma.$queryRaw`
      SELECT id, public_id
      FROM fleet_transactions
      WHERE fleet_account_id = ${fleet.id}
        AND public_id = ${payload.fleetTransactionId}
      LIMIT 1
    `
    fleetTransaction = txRows?.[0] || null
    if (!fleetTransaction?.id) throw notFound("Fleet transaction not found")
  }
  const reconciledByUserId = ["matched", "suspicious", "duplicate"].includes(payload.status) ? Number(auth.userId) : null
  const reconciledAt = reconciledByUserId ? new Date() : null
  await prisma.$executeRaw`
    UPDATE fleet_fuel_card_reconciliation_matches r
    INNER JOIN fleet_fuel_card_transactions c ON c.id = r.card_transaction_id
    SET r.status = ${payload.status},
        r.fleet_transaction_id = ${fleetTransaction?.id || null},
        r.notes = ${nullableText(payload.notes)},
        r.matched_by_user_id = ${reconciledByUserId},
        r.matched_at = ${reconciledAt},
        r.updated_at = CURRENT_TIMESTAMP(3),
        c.match_status = ${payload.status},
        c.updated_at = CURRENT_TIMESTAMP(3)
    WHERE r.fleet_account_id = ${fleet.id}
      AND r.public_id = ${matchId}
  `
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: payload.status === "matched" ? "fuel_card_reconciliation.matched" : "fuel_card_reconciliation.flagged",
    entityType: "fleet_fuel_card_reconciliation",
    entityId: matchId,
    metadata: payload,
    ipAddress: readClientIp(req),
  })
  return { updated: true }
}

function allocationSupportsRequest(allocation, { requestedLitres = null, requestedAmount = null } = {}) {
  if (!allocation?.id) return { allowed: false, message: "No active fleet allocation is available." }
  const unit = String(allocation.allocation_unit || "litres")
  const litres = requestedLitres === null || requestedLitres === undefined ? null : toLitresNumber(requestedLitres)
  const amount = requestedAmount === null || requestedAmount === undefined ? null : toMoneyNumber(requestedAmount)
  if ((unit === "litres" || unit === "both") && litres !== null && toLitresNumber(allocation.current_litre_balance) < litres) {
    return { allowed: false, message: "Insufficient litre allocation.", suggestedAction: "request_extra_fuel" }
  }
  if ((unit === "money" || unit === "both") && amount !== null && toMoneyNumber(allocation.current_money_balance) < amount) {
    return { allowed: false, message: "Insufficient MWK allocation.", suggestedAction: "request_extra_fuel" }
  }
  if (unit === "litres" && litres === null) return { allowed: false, message: "This allocation requires litres.", suggestedAction: "request_extra_fuel" }
  if (unit === "money" && amount === null) return { allowed: false, message: "This allocation requires MWK amount.", suggestedAction: "request_extra_fuel" }
  return { allowed: true }
}

async function findFuelNowAllocation(db, { fleetAccountId, allocationId = null, driverUserId, vehicle, fuelCardId = null, requestedLitres = null, requestedAmount = null }) {
  if (allocationId) {
    const explicit = await resolveAllocation(db, { fleetAccountId, allocationId, forUpdate: false })
    return { allocation: explicit, availability: allocationSupportsRequest(explicit, { requestedLitres, requestedAmount }) }
  }
  const fuelCard = fuelCardId ? await resolveFuelCard(db, { fleetAccountId, fuelCardId }) : null
  const rows = await db.$queryRaw`
    SELECT fa.*
    FROM fleet_allocations fa
    WHERE fa.fleet_account_id = ${fleetAccountId}
      AND fa.status = 'active'
      AND UTC_DATE() BETWEEN fa.period_start AND fa.period_end
      AND (
        fa.driver_user_id = ${driverUserId}
        OR fa.vehicle_id = ${vehicle.id}
        OR (${fuelCard?.id || null} IS NOT NULL AND fa.fuel_card_id = ${fuelCard?.id || null})
        OR (${vehicle.department_id || null} IS NOT NULL AND fa.department_id = ${vehicle.department_id || null})
        OR fa.allocation_target_type IN ('fleet', 'emergency_reserve')
      )
    ORDER BY
      CASE
        WHEN fa.driver_user_id = ${driverUserId} THEN 1
        WHEN fa.vehicle_id = ${vehicle.id} THEN 2
        WHEN ${fuelCard?.id || null} IS NOT NULL AND fa.fuel_card_id = ${fuelCard?.id || null} THEN 3
        WHEN ${vehicle.department_id || null} IS NOT NULL AND fa.department_id = ${vehicle.department_id || null} THEN 4
        WHEN fa.allocation_target_type = 'fleet' THEN 5
        ELSE 6
      END,
      fa.id ASC
  `
  const candidates = rows || []
  const allowed = candidates.find((row) => allocationSupportsRequest(row, { requestedLitres, requestedAmount }).allowed)
  const fallback = allowed || candidates[0] || null
  return { allocation: fallback, fuelCard, availability: allocationSupportsRequest(fallback, { requestedLitres, requestedAmount }) }
}

async function validateFleetFuelNowInternal(db, { auth, payload, forUpdate = false }) {
  const userId = Number(auth?.userId || 0)
  if (!Number.isFinite(userId) || userId <= 0) throw badRequest("Authenticated user context is required")
  const fleet = await resolveFleetAccount(db, payload.fleetId, { forUpdate })
  const membership = await resolveMembership(db, { fleetAccountId: fleet.id, userId })
  const checks = []
  if (String(fleet.status || "") !== "active") checks.push({ status: "blocked", message: "Fleet account is not active." })
  if (!membership?.id || String(membership.status || "") !== "active") checks.push({ status: "blocked", message: "Active fleet membership is required." })
  const role = normalizeFleetRole(membership?.role)
  if (!["driver", "owner", "admin", "dispatcher"].includes(role)) checks.push({ status: "blocked", message: "Your fleet role cannot start fueling." })

  const vehicle = await resolveVehicle(db, { fleetAccountId: fleet.id, vehicleId: payload.vehicleId, forUpdate })
  if (String(vehicle.status || "") !== "active") checks.push({ status: "blocked", message: "Vehicle is not active." })

  const assignmentRows = await db.$queryRaw`
    SELECT id
    FROM fleet_vehicle_assignments
    WHERE fleet_account_id = ${fleet.id}
      AND vehicle_id = ${vehicle.id}
      AND user_id = ${userId}
      AND status = 'active'
    LIMIT 1
  `
  if (!assignmentRows?.[0]?.id) checks.push({ status: "blocked", message: "Driver is not assigned to this fleet vehicle." })

  const odometer = Number(payload.odometerReading)
  if (!Number.isFinite(odometer)) {
    checks.push({ status: "blocked", message: "Odometer reading is required." })
  } else if (vehicle.current_odometer !== null && vehicle.current_odometer !== undefined && odometer < Number(vehicle.current_odometer)) {
    checks.push({ status: "blocked", message: "Odometer reading cannot be lower than the vehicle's last odometer." })
  }

  const fuelType = normalizeFuelType(payload.fuelType || vehicle.fuel_type)
  const vehicleFuelType = normalizeFuelType(vehicle.fuel_type)
  if (vehicleFuelType !== "mixed" && vehicleFuelType !== "unknown" && fuelType !== vehicleFuelType) {
    checks.push({ status: "blocked", message: `Vehicle requires ${vehicleFuelType}.` })
  }

  const station = await resolveStationByPublicId(db, payload.stationPublicId)
  const requestedAmount = payload.requestedAmount === undefined ? null : toMoneyNumber(payload.requestedAmount)
  const requestedLitres = payload.requestedLitres === undefined ? null : toLitresNumber(payload.requestedLitres)
  const selectedFuelCard = await resolveFuelCard(db, { fleetAccountId: fleet.id, fuelCardId: payload.fuelCardId })
  if (["fuel_card_manual", "fuel_card_integrated"].includes(payload.paymentContextType) && !selectedFuelCard?.id) {
    checks.push({ status: "blocked", message: "A valid fleet fuel card is required for this payment source." })
  }
  if (selectedFuelCard?.id && String(selectedFuelCard.status || "") !== "active") checks.push({ status: "blocked", message: "Fleet fuel card is not active." })
  if (selectedFuelCard?.provider_type === "myfuel" && payload.paymentContextType === "fuel_card_integrated") {
    checks.push({ status: "warning", message: "MyFuel API is not connected; use manual card tracking." })
  }

  if (payload.paymentContextType === "fleet_wallet" && requestedAmount !== null) {
    const wallet = await resolveFleetWallet(db, fleet.id)
    const available = calculateFleetWalletAvailability(wallet)
    if (!available.canSpend(requestedAmount)) checks.push({ status: "blocked", message: "Fleet wallet has insufficient available balance." })
  }

  const { allocation, availability } = await findFuelNowAllocation(db, {
    fleetAccountId: fleet.id,
    allocationId: payload.allocationId,
    driverUserId: userId,
    vehicle,
    fuelCardId: payload.fuelCardId,
    requestedLitres,
    requestedAmount,
  })
  if (!availability.allowed) checks.push({ status: "blocked", message: availability.message, suggestedAction: availability.suggestedAction || "request_extra_fuel" })

  const usage = await getFleetUsage(db, {
    fleetAccountId: fleet.id,
    driverUserId: userId,
    vehicleId: vehicle.id,
  })
  const policies = await listApplicablePolicyRows(db, { fleetAccountId: fleet.id, driverUserId: userId, vehicleId: vehicle.id })
  const policyResult = evaluateFleetPolicyChecks({
    policies,
    usage,
    request: {
      amount: requestedAmount || 0,
      litres: requestedLitres || 0,
      fuelType,
      stationPublicId: station?.public_id || payload.stationPublicId,
    },
  })
  for (const policyCheck of policyResult.checks) {
    for (const message of policyCheck.messages || []) checks.push({ status: policyCheck.status, message })
  }

  const blocked = checks.some((check) => check.status === "blocked")
  const warning = checks.some((check) => check.status === "warning")
  const suggestedAction = checks.find((check) => check.suggestedAction)?.suggestedAction || (blocked ? "request_extra_fuel" : "fuel_now")
  return {
    allowed: !blocked,
    status: blocked ? "blocked" : warning ? "warning" : "passed",
    suggestedAction,
    checks,
    fleet,
    membership,
    vehicle,
    station,
    allocation,
    fuelCard: selectedFuelCard || null,
    requestedLitres,
    requestedAmount,
    fuelType,
  }
}

export async function validateFleetFuelNow({ auth, payload }) {
  const validation = await validateFleetFuelNowInternal(prisma, { auth, payload })
  return {
    allowed: validation.allowed,
    status: validation.status,
    suggestedAction: validation.suggestedAction,
    checks: validation.checks,
    fleet: mapFleetAccountRow(validation.fleet),
    vehicle: mapVehicleRow(validation.vehicle),
    allocation: validation.allocation ? mapAllocationRow(validation.allocation) : null,
    fuelCard: validation.fuelCard ? mapFuelCardRow(validation.fuelCard) : null,
  }
}

export async function createFleetFuelNowSession({ auth, payload, req }) {
  return prisma.$transaction(async (tx) => {
    const validation = await validateFleetFuelNowInternal(tx, { auth, payload, forUpdate: true })
    if (!validation.allowed) {
      return {
        allowed: false,
        status: validation.status,
        suggestedAction: validation.suggestedAction,
        checks: validation.checks,
      }
    }
    const publicId = createPublicId()
    await tx.$executeRaw`
      INSERT INTO fleet_fueling_sessions (
        public_id, fleet_account_id, department_id, vehicle_id, driver_user_id, allocation_id, fuel_card_id, station_id,
        payment_context_type, authorized_litres, authorized_amount, odometer_reading, fuel_type, status, validation_json, expires_at
      )
      VALUES (
        ${publicId}, ${validation.fleet.id}, ${validation.vehicle.department_id || null}, ${validation.vehicle.id}, ${Number(auth.userId)}, ${validation.allocation?.id || null}, ${validation.fuelCard?.id || null}, ${validation.station?.id || null},
        ${payload.paymentContextType || "fleet_wallet"}, ${validation.requestedLitres}, ${validation.requestedAmount}, ${payload.odometerReading}, ${validation.fuelType}, 'authorized', ${JSON.stringify({ status: validation.status, checks: validation.checks })}, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 2 HOUR)
      )
    `
    await writeFleetAuditLog(tx, {
      fleetAccountId: validation.fleet.id,
      actorUserId: Number(auth.userId),
      action: "fuel_now.session_authorized",
      entityType: "fleet_fueling_session",
      entityId: publicId,
      metadata: { vehicleId: payload.vehicleId, allocationId: validation.allocation?.public_id || null, paymentContextType: payload.paymentContextType },
      ipAddress: readClientIp(req),
    })
    return {
      allowed: true,
      session: { publicId, status: "authorized", expiresInMinutes: 120 },
      checks: validation.checks,
      suggestedAction: "fuel_now",
    }
  })
}

export async function completeFleetFuelNowSession({ auth, fleetId, sessionId, payload, req }) {
  const { fleet, membership } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.FUEL_NOW_COMPLETE, managerOnly: true })
  assertFleetRoleAllowed(membership, FLEET_OPERATION_ROLES, "Only fleet owners, admins, and dispatchers can complete fleet fueling sessions")
  return prisma.$transaction(async (tx) => {
    const session = await resolveFuelingSession(tx, { fleetAccountId: fleet.id, sessionId, forUpdate: true })
    if (String(session.status || "") !== "authorized") throw badRequest("Fueling session is not authorized")
    if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) throw badRequest("Fueling session has expired")
    const vehicleRows = await tx.$queryRaw`
      SELECT *
      FROM fleet_vehicles
      WHERE fleet_account_id = ${fleet.id}
        AND id = ${session.vehicle_id}
      LIMIT 1
      FOR UPDATE
    `
    const vehicle = vehicleRows?.[0] || null
    if (!vehicle?.id) throw notFound("Fleet vehicle not found")
    const allocation = session.allocation_id ? (await tx.$queryRaw`
      SELECT *
      FROM fleet_allocations
      WHERE id = ${session.allocation_id}
      LIMIT 1
      FOR UPDATE
    `)?.[0] : null
    const availability = allocationSupportsRequest(allocation, { requestedLitres: payload.litres, requestedAmount: payload.amount })
    if (!availability.allowed) throw badRequest(availability.message)
    const finalOdometer = payload.odometerReading ?? Number(session.odometer_reading)
    if (vehicle.current_odometer !== null && vehicle.current_odometer !== undefined && Number(finalOdometer) < Number(vehicle.current_odometer)) {
      throw badRequest("Odometer reading cannot be lower than the vehicle's last odometer")
    }
    const station = payload.stationPublicId ? await resolveStationByPublicId(tx, payload.stationPublicId) : (session.station_id ? { id: session.station_id } : null)
    const { pump, nozzle } = station?.id
      ? await resolvePumpAndNozzle(tx, {
          stationId: station.id,
          pumpPublicId: nullableText(payload.pumpPublicId),
          nozzlePublicId: nullableText(payload.nozzlePublicId),
        })
      : { pump: null, nozzle: null }
    const previousOdometer = vehicle.current_odometer === null || vehicle.current_odometer === undefined ? null : Number(vehicle.current_odometer)
    const kmSinceLastFuel = previousOdometer !== null ? Math.max(0, Number(finalOdometer) - previousOdometer) : null
    const kmPerLitre = kmSinceLastFuel !== null && Number(payload.litres) > 0 ? Number((kmSinceLastFuel / Number(payload.litres)).toFixed(3)) : null
    const costPerKm = kmSinceLastFuel !== null && kmSinceLastFuel > 0 ? Number((Number(payload.amount) / kmSinceLastFuel).toFixed(4)) : null
    const transactionPublicId = createPublicId()
    let walletReference = null
    if (String(session.payment_context_type || "") === "fleet_wallet") {
      walletReference = await debitFleetWallet(tx, {
        fleetAccountId: fleet.id,
        amount: payload.amount,
        actorUserId: Number(auth.userId),
        relatedEntityType: "FLEET_TRANSACTION",
        relatedEntityId: transactionPublicId,
        description: `Fleet fuel-now transaction ${transactionPublicId}`,
      })
    }
    await tx.$executeRaw`
      INSERT INTO fleet_transactions (
        public_id, fleet_account_id, department_id, vehicle_id, driver_user_id, station_id, pump_id, nozzle_id,
        fuel_request_id, allocation_id, fuel_card_id, payment_context_type, litres, amount, price_per_litre, fuel_type,
        odometer_reading, km_since_last_fuel, km_per_litre, cost_per_km, status, risk_status, risk_reason, wallet_transaction_reference
      )
      VALUES (
        ${transactionPublicId}, ${fleet.id}, ${session.department_id || null}, ${session.vehicle_id}, ${session.driver_user_id}, ${station?.id || null}, ${pump?.id || null}, ${nozzle?.id || null},
        NULL, ${allocation?.id || null}, ${session.fuel_card_id || null}, ${session.payment_context_type}, ${payload.litres}, ${payload.amount}, ${payload.pricePerLitre}, ${payload.fuelType || session.fuel_type},
        ${finalOdometer}, ${kmSinceLastFuel}, ${kmPerLitre}, ${costPerKm}, 'completed', 'normal', NULL, ${walletReference}
      )
    `
    const transactionRows = await tx.$queryRaw`SELECT id FROM fleet_transactions WHERE public_id = ${transactionPublicId} LIMIT 1`
    const transactionId = transactionRows?.[0]?.id || null
    if (allocation?.id) {
      const newLitres = toLitresNumber(Number(allocation.current_litre_balance || 0) - Number(payload.litres || 0))
      const newAmount = toMoneyNumber(Number(allocation.current_money_balance || 0) - Number(payload.amount || 0))
      if (newLitres < 0 || newAmount < 0) throw badRequest("Allocation balance cannot go negative")
      await tx.$executeRaw`
        UPDATE fleet_allocations
        SET current_litre_balance = ${newLitres},
            current_money_balance = ${newAmount},
            used_litres_current_period = used_litres_current_period + ${payload.litres},
            used_money_current_period = used_money_current_period + ${payload.amount},
            updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ${allocation.id}
      `
      await tx.$executeRaw`
        INSERT INTO fleet_allocation_transactions (
          public_id, fleet_account_id, allocation_id, transaction_type, litres, amount, reference, related_fleet_transaction_id, created_by_user_id
        )
        VALUES (
          ${createPublicId()}, ${fleet.id}, ${allocation.id}, 'fuel_usage', ${payload.litres}, ${payload.amount}, ${nullableText(payload.externalReference) || buildReference("ALLOC")}, ${transactionId}, ${Number(auth.userId)}
        )
      `
    }
    if (session.fuel_card_id) {
      const cardRows = await tx.$queryRaw`
        SELECT fc.*, fp.id AS provider_id
        FROM fleet_fuel_cards fc
        INNER JOIN fleet_fuel_card_providers fp ON fp.id = fc.provider_id
        WHERE fc.id = ${session.fuel_card_id}
        LIMIT 1
      `
      const card = cardRows?.[0] || null
      if (card?.id) {
        const cardTxPublicId = createPublicId()
        await tx.$executeRaw`
          INSERT INTO fleet_fuel_card_transactions (
            public_id, fleet_account_id, provider_id, fuel_card_id, external_reference, transaction_date, station_id,
            amount, litres, fuel_type, odometer_reading, raw_data_json, match_status, risk_status
          )
          VALUES (
            ${cardTxPublicId}, ${fleet.id}, ${card.provider_id}, ${card.id}, ${nullableText(payload.externalReference) || buildReference("CARD")}, CURRENT_TIMESTAMP(3), ${station?.id || null},
            ${payload.amount}, ${payload.litres}, ${payload.fuelType || session.fuel_type}, ${finalOdometer}, ${JSON.stringify({ source: "fleet_now_complete" })}, 'matched', 'normal'
          )
        `
        const cardTxRows = await tx.$queryRaw`SELECT id FROM fleet_fuel_card_transactions WHERE public_id = ${cardTxPublicId} LIMIT 1`
        await tx.$executeRaw`
          INSERT INTO fleet_fuel_card_reconciliation_matches (
            public_id, fleet_account_id, card_transaction_id, fleet_transaction_id, status, notes, matched_by_user_id, matched_at
          )
          VALUES (
            ${createPublicId()}, ${fleet.id}, ${cardTxRows?.[0]?.id || null}, ${transactionId}, 'matched', 'Auto-matched from SmartLink Fuel Now completion.', ${Number(auth.userId)}, CURRENT_TIMESTAMP(3)
          )
        `
      }
    }
    await tx.$executeRaw`
      UPDATE fleet_vehicles
      SET current_odometer = ${finalOdometer}, updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${vehicle.id}
    `
    await tx.$executeRaw`
      UPDATE fleet_fueling_sessions
      SET status = 'completed', completed_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${session.id}
    `
    await writeFleetAuditLog(tx, {
      fleetAccountId: fleet.id,
      actorUserId: Number(auth.userId),
      action: "fuel_now.session_completed",
      entityType: "fleet_transaction",
      entityId: transactionPublicId,
      metadata: { sessionId, amount: payload.amount, litres: payload.litres, paymentContextType: session.payment_context_type },
      ipAddress: readClientIp(req),
    })
    return { completed: true, transaction: { publicId: transactionPublicId }, session: { publicId: session.public_id, status: "completed" } }
  })
}

export async function inviteFleetMember({ auth, fleetId, payload, req }) {
  const { fleet } = await requireFleetAccess({
    auth,
    fleetId,
    permission: FLEET_PERMISSIONS.MEMBERS_MANAGE,
    managerOnly: true,
  })
  let invitee = null
  if (payload.userPublicId) {
    invitee = await resolveUserByPublicId(prisma, payload.userPublicId)
    if (!invitee?.id) throw badRequest("SmartLink user not found")
    assertInviteIdentityMatchesResolvedUser({ payload, user: invitee })
  } else {
    invitee = await resolveUserByIdentity(prisma, { email: payload.email, phone: payload.phone })
  }
  const invitationPublicId = createPublicId()
  const inviteeEmail = nullableText(payload.email)?.toLowerCase() || nullableText(invitee?.email)?.toLowerCase() || null
  const inviteePhone = nullableText(payload.phone) || nullableText(invitee?.phone_e164)
  const inviteeName = nullableText(payload.name) || nullableText(invitee?.full_name)
  const metadata = {
    targetUserPublicId: nullableText(payload.userPublicId) || nullableText(invitee?.public_id),
    assignedVehicleId: nullableText(payload.assignedVehicleId),
    initialLimits: {
      dailyAmountLimit: payload.dailyAmountLimit || null,
      monthlyAmountLimit: payload.monthlyAmountLimit || null,
    },
  }
  await prisma.$executeRaw`
    INSERT INTO fleet_invitations (
      public_id,
      fleet_account_id,
      invitee_name,
      invitee_email,
      invitee_phone,
      role,
      status,
      invited_by_user_id,
      metadata_json,
      expires_at
    )
    VALUES (
      ${invitationPublicId},
      ${fleet.id},
      ${inviteeName},
      ${inviteeEmail},
      ${inviteePhone},
      ${payload.role},
      'pending',
      ${Number(auth.userId)},
      ${JSON.stringify(metadata)},
      DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 14 DAY)
    )
  `
  if (invitee?.id) {
    await prisma.$executeRaw`
      INSERT INTO fleet_members (
        public_id,
        fleet_account_id,
        user_id,
        role,
        status,
        invited_by_user_id,
        invited_at
      )
      VALUES (
        ${createPublicId()},
        ${fleet.id},
        ${invitee.id},
        ${payload.role},
        'pending',
        ${Number(auth.userId)},
        CURRENT_TIMESTAMP(3)
      )
      ON DUPLICATE KEY UPDATE
        role = VALUES(role),
        status = IF(status = 'removed', 'pending', status),
        invited_by_user_id = VALUES(invited_by_user_id),
        invited_at = VALUES(invited_at),
        updated_at = CURRENT_TIMESTAMP(3)
    `
  }
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: "member.invited",
    entityType: "fleet_invitation",
    entityId: invitationPublicId,
    metadata: {
      role: payload.role,
      userPublicId: nullableText(payload.userPublicId) || nullableText(invitee?.public_id),
      email: inviteeEmail,
      phone: inviteePhone,
    },
    ipAddress: readClientIp(req),
  })
  const notification = invitee?.id
    ? await notifyFleetInvitationUser({
        user: invitee,
        fleet,
        invitationPublicId,
        role: payload.role,
      })
    : null
  return {
    invitation: {
      publicId: invitationPublicId,
      status: "pending",
      matchedExistingUser: Boolean(invitee?.id),
      notifiedInApp: Boolean(notification?.publicId),
    },
  }
}

export async function acceptFleetInvitation({ auth, invitationId, req }) {
  const userId = Number(auth?.userId || 0)
  if (!Number.isFinite(userId) || userId <= 0) throw badRequest("Authenticated user context is required")
  return prisma.$transaction(async (tx) => {
    const userRows = await tx.$queryRaw`
      SELECT id, public_id, email, phone_e164
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    `
    const user = userRows?.[0] || null
    const invitationRows = await tx.$queryRaw`
      SELECT *
      FROM fleet_invitations
      WHERE public_id = ${invitationId}
        AND status = 'pending'
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP(3))
      LIMIT 1
      FOR UPDATE
    `
    const invitation = invitationRows?.[0] || null
    if (!invitation?.id) throw notFound("Fleet invitation not found")
    const invitationMetadata = parseJsonObject(invitation.metadata_json)
    const emailMatches = invitation.invitee_email && user?.email && String(invitation.invitee_email).toLowerCase() === String(user.email).toLowerCase()
    const phoneMatches = invitation.invitee_phone && user?.phone_e164 && String(invitation.invitee_phone) === String(user.phone_e164)
    const publicIdMatches =
      invitationMetadata.targetUserPublicId &&
      user?.public_id &&
      String(invitationMetadata.targetUserPublicId) === String(user.public_id)
    if (!emailMatches && !phoneMatches && !publicIdMatches) throw forbidden("This invitation does not match your SmartLink account")

    await tx.$executeRaw`
      INSERT INTO fleet_members (
        public_id,
        fleet_account_id,
        user_id,
        role,
        status,
        invited_by_user_id,
        invited_at,
        accepted_at
      )
      VALUES (
        ${createPublicId()},
        ${invitation.fleet_account_id},
        ${userId},
        ${invitation.role},
        'active',
        ${invitation.invited_by_user_id},
        ${invitation.created_at},
        CURRENT_TIMESTAMP(3)
      )
      ON DUPLICATE KEY UPDATE
        role = VALUES(role),
        status = 'active',
        accepted_at = CURRENT_TIMESTAMP(3),
        updated_at = CURRENT_TIMESTAMP(3)
    `
    await tx.$executeRaw`
      UPDATE fleet_invitations
      SET status = 'accepted', accepted_by_user_id = ${userId}, accepted_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${invitation.id}
    `
    const assignedVehicleId = nullableText(invitationMetadata.assignedVehicleId)
    if (assignedVehicleId && String(invitation.role) === "driver") {
      const vehicleRows = await tx.$queryRaw`
        SELECT id
        FROM fleet_vehicles
        WHERE fleet_account_id = ${invitation.fleet_account_id}
          AND public_id = ${assignedVehicleId}
          AND status = 'active'
        LIMIT 1
      `
      const vehicle = vehicleRows?.[0] || null
      if (vehicle?.id) {
        const assignmentRows = await tx.$queryRaw`
          SELECT id
          FROM fleet_vehicle_assignments
          WHERE fleet_account_id = ${invitation.fleet_account_id}
            AND vehicle_id = ${vehicle.id}
            AND user_id = ${userId}
          ORDER BY FIELD(status, 'active', 'suspended', 'removed'), id DESC
          LIMIT 1
          FOR UPDATE
        `
        const assignment = assignmentRows?.[0] || null
        if (assignment?.id) {
          await tx.$executeRaw`
            UPDATE fleet_vehicle_assignments
            SET status = 'active',
                assigned_by_user_id = ${invitation.invited_by_user_id},
                assigned_at = CURRENT_TIMESTAMP(3),
                removed_at = NULL,
                updated_at = CURRENT_TIMESTAMP(3)
            WHERE id = ${assignment.id}
          `
        } else {
          await tx.$executeRaw`
            INSERT INTO fleet_vehicle_assignments (
              public_id,
              fleet_account_id,
              vehicle_id,
              user_id,
              status,
              assigned_by_user_id,
              assigned_at
            )
            VALUES (
              ${createPublicId()},
              ${invitation.fleet_account_id},
              ${vehicle.id},
              ${userId},
              'active',
              ${invitation.invited_by_user_id},
              CURRENT_TIMESTAMP(3)
            )
          `
        }
      }
    }
    await writeFleetAuditLog(tx, {
      fleetAccountId: invitation.fleet_account_id,
      actorUserId: userId,
      action: "member.accepted_invitation",
      entityType: "fleet_invitation",
      entityId: invitation.public_id,
      metadata: assignedVehicleId ? { assignedVehicleId } : {},
      ipAddress: readClientIp(req),
    })
    return { accepted: true }
  })
}

export async function listFleetInvitations({ auth, fleetId, filters = {} }) {
  const { fleet } = await requireFleetAccess({
    auth,
    fleetId,
    permission: FLEET_PERMISSIONS.MEMBERS_MANAGE,
    managerOnly: true,
  })
  const page = Number(filters.page || 1)
  const limit = Number(filters.limit || 25)
  const offset = (page - 1) * limit
  const status = filters.status && filters.status !== "all" ? filters.status : null
  const rows = await prisma.$queryRaw`
    SELECT
      fi.*,
      inviter.public_id AS invited_by_public_id,
      inviter.full_name AS invited_by_name,
      accepter.public_id AS accepted_by_public_id,
      accepter.full_name AS accepted_by_name,
      matched.public_id AS matched_user_public_id,
      matched.full_name AS matched_user_name,
      matched.email AS matched_user_email,
      matched.phone_e164 AS matched_user_phone,
      fv.public_id AS assigned_vehicle_public_id,
      fv.plate_number AS assigned_plate_number,
      fv.vehicle_name AS assigned_vehicle_name
    FROM fleet_invitations fi
    LEFT JOIN users inviter ON inviter.id = fi.invited_by_user_id
    LEFT JOIN users accepter ON accepter.id = fi.accepted_by_user_id
    LEFT JOIN users matched
      ON (
        matched.public_id = IF(JSON_VALID(fi.metadata_json), JSON_UNQUOTE(JSON_EXTRACT(fi.metadata_json, '$.targetUserPublicId')), NULL)
        OR (fi.invitee_email IS NOT NULL AND LOWER(matched.email) = LOWER(fi.invitee_email))
        OR (fi.invitee_phone IS NOT NULL AND matched.phone_e164 = fi.invitee_phone)
      )
    LEFT JOIN fleet_vehicles fv
      ON fv.fleet_account_id = fi.fleet_account_id
     AND fv.public_id = IF(JSON_VALID(fi.metadata_json), JSON_UNQUOTE(JSON_EXTRACT(fi.metadata_json, '$.assignedVehicleId')), NULL)
    WHERE fi.fleet_account_id = ${fleet.id}
      AND (${status} IS NULL OR fi.status = ${status})
    ORDER BY FIELD(fi.status, 'pending', 'accepted', 'expired', 'cancelled'), fi.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `
  return { invitations: (rows || []).map(mapInvitationRow), page, limit }
}

export async function resendFleetInvitation({ auth, fleetId, invitationId, req }) {
  const { fleet } = await requireFleetAccess({
    auth,
    fleetId,
    permission: FLEET_PERMISSIONS.MEMBERS_MANAGE,
    managerOnly: true,
  })
  const rows = await prisma.$queryRaw`
    SELECT *
    FROM fleet_invitations
    WHERE fleet_account_id = ${fleet.id}
      AND public_id = ${invitationId}
      AND status = 'pending'
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP(3))
    LIMIT 1
  `
  const invitation = rows?.[0] || null
  if (!invitation?.id) throw notFound("Pending fleet invitation not found")
  const metadata = parseJsonObject(invitation.metadata_json)
  let invitee = null
  if (metadata.targetUserPublicId) {
    invitee = await resolveUserByPublicId(prisma, metadata.targetUserPublicId)
  }
  if (!invitee?.id) {
    invitee = await resolveUserByIdentity(prisma, {
      email: invitation.invitee_email,
      phone: invitation.invitee_phone,
    })
  }
  const notification = invitee?.id
    ? await notifyFleetInvitationUser({
        user: invitee,
        fleet,
        invitationPublicId: invitation.public_id,
        role: invitation.role,
      })
    : null
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: "member.invitation_resent",
    entityType: "fleet_invitation",
    entityId: invitation.public_id,
    metadata: { notifiedInApp: Boolean(notification?.publicId), targetUserPublicId: metadata.targetUserPublicId || null },
    ipAddress: readClientIp(req),
  })
  return {
    resent: true,
    matchedExistingUser: Boolean(invitee?.id),
    notifiedInApp: Boolean(notification?.publicId),
    smsPendingIntegration: Boolean(invitation.invitee_phone),
    emailPendingIntegration: Boolean(invitation.invitee_email),
  }
}

export async function cancelFleetInvitation({ auth, fleetId, invitationId, req }) {
  const { fleet } = await requireFleetAccess({
    auth,
    fleetId,
    permission: FLEET_PERMISSIONS.MEMBERS_MANAGE,
    managerOnly: true,
  })
  const result = await prisma.$executeRaw`
    UPDATE fleet_invitations
    SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP(3)
    WHERE fleet_account_id = ${fleet.id}
      AND public_id = ${invitationId}
      AND status = 'pending'
  `
  if (Number(result || 0) === 0) throw notFound("Pending fleet invitation not found")
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: "member.invitation_cancelled",
    entityType: "fleet_invitation",
    entityId: invitationId,
    ipAddress: readClientIp(req),
  })
  return { cancelled: true }
}

export async function listFleetMembers({ auth, fleetId }) {
  const { fleet } = await requireFleetAccess({
    auth,
    fleetId,
    permission: FLEET_PERMISSIONS.DASHBOARD_VIEW,
    managerOnly: true,
  })
  const rows = await prisma.$queryRaw`
    SELECT
      fm.*,
      u.public_id AS user_public_id,
      u.full_name,
      u.email,
      u.phone_e164
    FROM fleet_members fm
    INNER JOIN users u ON u.id = fm.user_id
    WHERE fm.fleet_account_id = ${fleet.id}
    ORDER BY FIELD(fm.status, 'active', 'pending', 'suspended', 'removed'), FIELD(fm.role, 'owner', 'admin', 'finance', 'dispatcher', 'driver', 'auditor'), u.full_name ASC
  `
  return { members: (rows || []).map(mapMembershipRow) }
}

export async function getFleetMemberDetails({ auth, fleetId, memberId }) {
  const { fleet } = await requireFleetAccess({
    auth,
    fleetId,
    permission: FLEET_PERMISSIONS.DASHBOARD_VIEW,
    managerOnly: true,
  })
  const member = await resolveMemberUser(prisma, { fleetAccountId: fleet.id, memberId })
  if (!member?.id) throw notFound("Fleet member not found")

  const [assignmentRows, consumptionRows, requestRows, transactionRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        fva.public_id AS assignment_public_id,
        fva.status AS assignment_status,
        fva.assigned_at,
        fva.removed_at,
        fv.public_id AS vehicle_public_id,
        fv.plate_number,
        fv.vehicle_name,
        fv.vehicle_type,
        fv.fuel_type,
        fv.current_odometer,
        fv.status AS vehicle_status
      FROM fleet_vehicle_assignments fva
      INNER JOIN fleet_vehicles fv ON fv.id = fva.vehicle_id
      WHERE fva.fleet_account_id = ${fleet.id}
        AND fva.user_id = ${member.user_id}
      ORDER BY FIELD(fva.status, 'active', 'suspended', 'removed'), fva.assigned_at DESC
      LIMIT 50
    `,
    prisma.$queryRaw`
      SELECT
        COALESCE(SUM(CASE WHEN ft.created_at >= UTC_DATE() THEN ft.amount ELSE 0 END), 0) AS daily_amount,
        COALESCE(SUM(CASE WHEN ft.created_at >= DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-01') THEN ft.amount ELSE 0 END), 0) AS monthly_amount,
        COALESCE(SUM(CASE WHEN ft.created_at >= DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-01') THEN ft.litres ELSE 0 END), 0) AS monthly_litres,
        COALESCE(SUM(ft.amount), 0) AS lifetime_amount,
        COALESCE(SUM(ft.litres), 0) AS lifetime_litres,
        MAX(ft.created_at) AS last_fueling_at,
        COUNT(*) AS transaction_count
      FROM fleet_transactions ft
      WHERE ft.fleet_account_id = ${fleet.id}
        AND ft.driver_user_id = ${member.user_id}
        AND ft.status IN ('completed', 'flagged')
    `,
    prisma.$queryRaw`
      SELECT fr.*,
             u.public_id AS driver_public_id, u.full_name AS driver_name, u.email AS driver_email, u.phone_e164 AS driver_phone,
             au.public_id AS approver_public_id, au.full_name AS approver_name,
             fv.public_id AS vehicle_public_id, fv.plate_number, fv.vehicle_name, fv.fuel_type AS vehicle_fuel_type, fv.status AS vehicle_status,
             fa.public_id AS fleet_public_id, fa.name AS fleet_name,
             st.public_id AS station_public_id, st.name AS station_name
      FROM fleet_fuel_requests fr
      INNER JOIN users u ON u.id = fr.requested_by_user_id
      INNER JOIN fleet_vehicles fv ON fv.id = fr.vehicle_id
      INNER JOIN fleet_accounts fa ON fa.id = fr.fleet_account_id
      LEFT JOIN users au ON au.id = fr.approved_by_user_id
      LEFT JOIN stations st ON st.id = fr.station_id
      WHERE fr.fleet_account_id = ${fleet.id}
        AND fr.requested_by_user_id = ${member.user_id}
      ORDER BY fr.created_at DESC
      LIMIT 20
    `,
    prisma.$queryRaw`
      SELECT ft.*,
             fv.public_id AS vehicle_public_id, fv.plate_number, fv.vehicle_name,
             u.public_id AS driver_public_id, u.full_name AS driver_name, u.email AS driver_email, u.phone_e164 AS driver_phone,
             st.public_id AS station_public_id, st.name AS station_name,
             p.public_id AS pump_public_id, p.pump_number,
             pn.public_id AS nozzle_public_id, pn.nozzle_number,
             fr.public_id AS fuel_request_public_id
      FROM fleet_transactions ft
      INNER JOIN fleet_vehicles fv ON fv.id = ft.vehicle_id
      INNER JOIN users u ON u.id = ft.driver_user_id
      INNER JOIN stations st ON st.id = ft.station_id
      LEFT JOIN pumps p ON p.id = ft.pump_id
      LEFT JOIN pump_nozzles pn ON pn.id = ft.nozzle_id
      LEFT JOIN fleet_fuel_requests fr ON fr.id = ft.fuel_request_id
      WHERE ft.fleet_account_id = ${fleet.id}
        AND ft.driver_user_id = ${member.user_id}
      ORDER BY ft.created_at DESC
      LIMIT 20
    `,
  ])

  const consumption = consumptionRows?.[0] || {}
  return {
    member: mapMembershipRow(member),
    assignedVehicles: (assignmentRows || []).map((row) => ({
      assignmentPublicId: row.assignment_public_id,
      status: row.assignment_status,
      assignedAt: toIsoOrNull(row.assigned_at),
      removedAt: toIsoOrNull(row.removed_at),
      vehicle: {
        publicId: row.vehicle_public_id,
        plateNumber: row.plate_number,
        vehicleName: row.vehicle_name,
        vehicleType: row.vehicle_type,
        fuelType: row.fuel_type,
        currentOdometer: row.current_odometer === null || row.current_odometer === undefined ? null : Number(row.current_odometer),
        status: row.vehicle_status,
      },
    })),
    consumption: {
      dailyAmount: toMoneyNumber(consumption.daily_amount),
      monthlyAmount: toMoneyNumber(consumption.monthly_amount),
      monthlyLitres: toLitresNumber(consumption.monthly_litres),
      lifetimeAmount: toMoneyNumber(consumption.lifetime_amount),
      lifetimeLitres: toLitresNumber(consumption.lifetime_litres),
      transactionCount: Number(consumption.transaction_count || 0),
      lastFuelingAt: toIsoOrNull(consumption.last_fueling_at),
    },
    fuelRequests: (requestRows || []).map(mapFuelRequestRow),
    transactions: (transactionRows || []).map(mapTransactionRow),
  }
}

export async function updateFleetMemberRole({ auth, fleetId, memberId, role, req }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.MEMBERS_MANAGE, managerOnly: true })
  const member = await resolveMemberUser(prisma, { fleetAccountId: fleet.id, memberId })
  if (!member?.id) throw notFound("Fleet member not found")
  if (String(member.role) === "owner") throw badRequest("Owner role cannot be changed from this action")
  await prisma.$executeRaw`
    UPDATE fleet_members
    SET role = ${role}, updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${member.id}
  `
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: "member.role_changed",
    entityType: "fleet_member",
    entityId: member.public_id,
    metadata: { role },
    ipAddress: readClientIp(req),
  })
  return { updated: true }
}

export async function updateFleetMemberStatus({ auth, fleetId, memberId, status, reason = "", req }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.MEMBERS_MANAGE, managerOnly: true })
  const member = await resolveMemberUser(prisma, { fleetAccountId: fleet.id, memberId })
  if (!member?.id) throw notFound("Fleet member not found")
  if (String(member.role) === "owner") throw badRequest("Owner cannot be suspended or removed from this action")
  await prisma.$executeRaw`
    UPDATE fleet_members
    SET status = ${status}, updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${member.id}
  `
  if (status === "removed" || status === "suspended") {
    await prisma.$executeRaw`
      UPDATE fleet_vehicle_assignments
      SET status = ${status === "removed" ? "removed" : "suspended"},
          removed_at = IF(${status} = 'removed', CURRENT_TIMESTAMP(3), removed_at),
          updated_at = CURRENT_TIMESTAMP(3)
      WHERE fleet_account_id = ${fleet.id}
        AND user_id = ${member.user_id}
        AND status = 'active'
    `
  }
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: `member.${status}`,
    entityType: "fleet_member",
    entityId: member.public_id,
    metadata: { reason },
    ipAddress: readClientIp(req),
  })
  return { status }
}

export async function addFleetVehicle({ auth, fleetId, payload, req }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.VEHICLES_MANAGE, managerOnly: true })
  const publicId = createPublicId()
  await prisma.$executeRaw`
    INSERT INTO fleet_vehicles (
      public_id,
      fleet_account_id,
      plate_number,
      vehicle_name,
      vehicle_type,
      fuel_type,
      tank_capacity_litres,
      current_odometer,
      status
    )
    VALUES (
      ${publicId},
      ${fleet.id},
      ${payload.plateNumber.toUpperCase()},
      ${nullableText(payload.vehicleName)},
      ${nullableText(payload.vehicleType)},
      ${normalizeFuelType(payload.fuelType)},
      ${payload.tankCapacityLitres ?? null},
      ${payload.currentOdometer ?? null},
      ${payload.status || "active"}
    )
  `
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: "vehicle.added",
    entityType: "fleet_vehicle",
    entityId: publicId,
    metadata: { plateNumber: payload.plateNumber },
    ipAddress: readClientIp(req),
  })
  return { vehicle: await getFleetVehicleDetails({ auth, fleetId, vehicleId: publicId }) }
}

export async function updateFleetVehicle({ auth, fleetId, vehicleId, payload, req }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.VEHICLES_MANAGE, managerOnly: true })
  const vehicle = await resolveVehicle(prisma, { fleetAccountId: fleet.id, vehicleId })
  await prisma.$executeRaw`
    UPDATE fleet_vehicles
    SET
      plate_number = COALESCE(${nullableText(payload.plateNumber)?.toUpperCase() || null}, plate_number),
      vehicle_name = ${payload.vehicleName === undefined ? vehicle.vehicle_name : nullableText(payload.vehicleName)},
      vehicle_type = ${payload.vehicleType === undefined ? vehicle.vehicle_type : nullableText(payload.vehicleType)},
      fuel_type = COALESCE(${payload.fuelType ? normalizeFuelType(payload.fuelType) : null}, fuel_type),
      tank_capacity_litres = ${payload.tankCapacityLitres === undefined ? vehicle.tank_capacity_litres : payload.tankCapacityLitres ?? null},
      current_odometer = ${payload.currentOdometer === undefined ? vehicle.current_odometer : payload.currentOdometer ?? null},
      status = COALESCE(${payload.status || null}, status),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${vehicle.id}
  `
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: "vehicle.updated",
    entityType: "fleet_vehicle",
    entityId: vehicle.public_id,
    metadata: payload,
    ipAddress: readClientIp(req),
  })
  return { vehicle: await getFleetVehicleDetails({ auth, fleetId, vehicleId }) }
}

export async function updateFleetVehicleStatus({ auth, fleetId, vehicleId, status, req }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.VEHICLES_MANAGE, managerOnly: true })
  const vehicle = await resolveVehicle(prisma, { fleetAccountId: fleet.id, vehicleId })
  await prisma.$executeRaw`
    UPDATE fleet_vehicles
    SET status = ${status}, updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${vehicle.id}
  `
  if (["suspended", "archived"].includes(status)) {
    await prisma.$executeRaw`
      UPDATE fleet_vehicle_assignments
      SET status = 'suspended', updated_at = CURRENT_TIMESTAMP(3)
      WHERE vehicle_id = ${vehicle.id}
        AND status = 'active'
    `
  }
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: `vehicle.${status}`,
    entityType: "fleet_vehicle",
    entityId: vehicle.public_id,
    ipAddress: readClientIp(req),
  })
  return { status }
}

export async function listFleetVehicles({ auth, fleetId }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.DASHBOARD_VIEW, managerOnly: true })
  const rows = await prisma.$queryRaw`
    SELECT
      fv.*,
      COALESCE(SUM(CASE WHEN ft.created_at >= DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-01') THEN ft.amount ELSE 0 END), 0) AS monthly_spend,
      MAX(ft.created_at) AS last_fueling_at,
      CONCAT(
        '[',
        COALESCE(
          GROUP_CONCAT(
            DISTINCT IF(fva.status = 'active',
              JSON_OBJECT('publicId', u.public_id, 'fullName', u.full_name, 'phone', u.phone_e164),
              NULL
            )
          ),
          ''
        ),
        ']'
      ) AS assigned_drivers_json
    FROM fleet_vehicles fv
    LEFT JOIN fleet_transactions ft ON ft.vehicle_id = fv.id
    LEFT JOIN fleet_vehicle_assignments fva ON fva.vehicle_id = fv.id
    LEFT JOIN users u ON u.id = fva.user_id
    WHERE fv.fleet_account_id = ${fleet.id}
    GROUP BY fv.id
    ORDER BY FIELD(fv.status, 'active', 'maintenance', 'suspended', 'archived'), fv.plate_number ASC
  `
  return { vehicles: (rows || []).map(mapVehicleRow) }
}

export async function getFleetVehicleDetails({ auth, fleetId, vehicleId }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.DASHBOARD_VIEW, managerOnly: true })
  const vehicle = await resolveVehicle(prisma, { fleetAccountId: fleet.id, vehicleId })
  const [assignmentRows, transactionRows, policyRows, alertRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT fva.*, u.public_id AS user_public_id, u.full_name, u.email, u.phone_e164
      FROM fleet_vehicle_assignments fva
      INNER JOIN users u ON u.id = fva.user_id
      WHERE fva.vehicle_id = ${vehicle.id}
      ORDER BY fva.created_at DESC
    `,
    prisma.$queryRaw`
      SELECT ft.*, u.public_id AS driver_public_id, u.full_name AS driver_name, u.email AS driver_email, u.phone_e164 AS driver_phone,
             fv.public_id AS vehicle_public_id, fv.plate_number, fv.vehicle_name,
             st.public_id AS station_public_id, st.name AS station_name,
             p.public_id AS pump_public_id, p.pump_number,
             pn.public_id AS nozzle_public_id, pn.nozzle_number,
             fr.public_id AS fuel_request_public_id
      FROM fleet_transactions ft
      INNER JOIN users u ON u.id = ft.driver_user_id
      INNER JOIN fleet_vehicles fv ON fv.id = ft.vehicle_id
      INNER JOIN stations st ON st.id = ft.station_id
      LEFT JOIN pumps p ON p.id = ft.pump_id
      LEFT JOIN pump_nozzles pn ON pn.id = ft.nozzle_id
      LEFT JOIN fleet_fuel_requests fr ON fr.id = ft.fuel_request_id
      WHERE ft.vehicle_id = ${vehicle.id}
      ORDER BY ft.created_at DESC
      LIMIT 25
    `,
    prisma.$queryRaw`
      SELECT *
      FROM fleet_policies
      WHERE fleet_account_id = ${fleet.id}
        AND active = 1
        AND (applies_to_type = 'fleet' OR (applies_to_type = 'vehicle' AND applies_to_id = ${vehicle.id}))
      ORDER BY applies_to_type ASC, id ASC
    `,
    prisma.$queryRaw`
      SELECT *
      FROM fleet_alerts
      WHERE fleet_account_id = ${fleet.id}
        AND related_entity_type = 'vehicle'
        AND related_entity_id = ${vehicle.public_id}
      ORDER BY created_at DESC
      LIMIT 20
    `,
  ])
  return {
    ...mapVehicleRow(vehicle),
    assignedDrivers: (assignmentRows || []).map(mapMembershipRow),
    fuelHistory: (transactionRows || []).map(mapTransactionRow),
    policies: (policyRows || []).map(mapPolicyRow),
    suspiciousEvents: (alertRows || []).map((row) => ({
      publicId: row.public_id,
      type: row.type,
      severity: row.severity,
      title: row.title,
      message: row.message,
      createdAt: toIsoOrNull(row.created_at),
    })),
  }
}

export async function assignDriverToVehicle({ auth, fleetId, vehicleId, payload, req }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.ASSIGNMENTS_MANAGE, managerOnly: true })
  const vehicle = await resolveVehicle(prisma, { fleetAccountId: fleet.id, vehicleId })
  const member = await resolveMemberUser(prisma, {
    fleetAccountId: fleet.id,
    memberId: payload.memberId || null,
    userPublicId: payload.userPublicId || null,
  })
  if (!member?.id) throw notFound("Fleet member not found")
  if (String(member.status) !== "active") throw badRequest("Only active members can be assigned to vehicles")
  await prisma.$executeRaw`
    INSERT INTO fleet_vehicle_assignments (
      public_id,
      fleet_account_id,
      vehicle_id,
      user_id,
      status,
      assigned_by_user_id,
      assigned_at
    )
    VALUES (
      ${createPublicId()},
      ${fleet.id},
      ${vehicle.id},
      ${member.user_id},
      'active',
      ${Number(auth.userId)},
      CURRENT_TIMESTAMP(3)
    )
  `
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: "vehicle.driver_assigned",
    entityType: "fleet_vehicle",
    entityId: vehicle.public_id,
    metadata: { userPublicId: member.user_public_id },
    ipAddress: readClientIp(req),
  })
  return { assigned: true }
}

export async function removeDriverAssignment({ auth, fleetId, vehicleId, userPublicId, req }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.ASSIGNMENTS_MANAGE, managerOnly: true })
  const vehicle = await resolveVehicle(prisma, { fleetAccountId: fleet.id, vehicleId })
  const user = await resolveUserByPublicId(prisma, userPublicId)
  if (!user?.id) throw notFound("Assigned user not found")
  await prisma.$executeRaw`
    UPDATE fleet_vehicle_assignments
    SET status = 'removed', removed_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
    WHERE fleet_account_id = ${fleet.id}
      AND vehicle_id = ${vehicle.id}
      AND user_id = ${user.id}
      AND status = 'active'
  `
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: "vehicle.driver_removed",
    entityType: "fleet_vehicle",
    entityId: vehicle.public_id,
    metadata: { userPublicId },
    ipAddress: readClientIp(req),
  })
  return { removed: true }
}

export async function getFleetWallet({ auth, fleetId }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.WALLET_VIEW, managerOnly: true })
  return { wallet: mapWalletRow(await resolveFleetWallet(prisma, fleet.id)) }
}

export async function listFleetWalletTransactions({ auth, fleetId, filters }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.WALLET_VIEW, managerOnly: true })
  const page = Number(filters.page || 1)
  const limit = Number(filters.limit || 25)
  const offset = (page - 1) * limit
  const type = nullableText(filters.type)?.toLowerCase() || null
  const rows = await prisma.$queryRaw`
    SELECT fwt.*, u.public_id AS created_by_public_id, u.full_name AS created_by_name
    FROM fleet_wallet_transactions fwt
    LEFT JOIN users u ON u.id = fwt.created_by_user_id
    WHERE fwt.fleet_account_id = ${fleet.id}
      AND (${type} IS NULL OR fwt.type = ${type})
    ORDER BY fwt.created_at DESC, fwt.id DESC
    LIMIT ${limit} OFFSET ${offset}
  `
  return { items: (rows || []).map(mapWalletTransactionRow), page, limit }
}

export async function createFleetWalletTopup({ auth, fleetId, payload, req }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.WALLET_MANAGE, managerOnly: true })
  const wallet = await resolveFleetWallet(prisma, fleet.id)
  const reference = nullableText(payload.externalReference) || buildReference("FTP")
  await prisma.$executeRaw`
    INSERT INTO fleet_wallet_transactions (
      public_id,
      fleet_wallet_id,
      fleet_account_id,
      type,
      status,
      amount,
      currency,
      reference,
      description,
      created_by_user_id
    )
    VALUES (
      ${createPublicId()},
      ${wallet.id},
      ${fleet.id},
      'topup',
      'pending',
      ${toMoneyNumber(payload.amount)},
      ${wallet.currency || DEFAULT_CURRENCY},
      ${reference},
      ${nullableText(payload.description) || 'Manual fleet top-up record pending integration'},
      ${Number(auth.userId)}
    )
  `
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: "wallet.topup_recorded",
    entityType: "fleet_wallet",
    entityId: wallet.public_id,
    metadata: { amount: payload.amount, reference, status: "pending" },
    ipAddress: readClientIp(req),
  })
  return { reference, status: "pendingIntegration" }
}

async function listFleetFuelRequestsInternal({ fleetAccountId, filters }) {
  const page = Number(filters.page || 1)
  const limit = Number(filters.limit || 25)
  const offset = (page - 1) * limit
  const status = filters.status && filters.status !== "all" ? filters.status : null
  const rows = await prisma.$queryRaw`
    SELECT fr.*,
           u.public_id AS driver_public_id, u.full_name AS driver_name, u.email AS driver_email, u.phone_e164 AS driver_phone,
           au.public_id AS approver_public_id, au.full_name AS approver_name,
           fv.public_id AS vehicle_public_id, fv.plate_number, fv.vehicle_name, fv.fuel_type AS vehicle_fuel_type, fv.status AS vehicle_status,
           st.public_id AS station_public_id, st.name AS station_name
    FROM fleet_fuel_requests fr
    INNER JOIN users u ON u.id = fr.requested_by_user_id
    INNER JOIN fleet_vehicles fv ON fv.id = fr.vehicle_id
    LEFT JOIN users au ON au.id = fr.approved_by_user_id
    LEFT JOIN stations st ON st.id = fr.station_id
    WHERE fr.fleet_account_id = ${fleetAccountId}
      AND (${status} IS NULL OR fr.status = ${status})
    ORDER BY fr.created_at DESC, fr.id DESC
    LIMIT ${limit} OFFSET ${offset}
  `
  return { items: (rows || []).map(mapFuelRequestRow), page, limit }
}

export async function listFleetFuelRequests({ auth, fleetId, filters }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.REQUESTS_VIEW, managerOnly: true })
  return listFleetFuelRequestsInternal({ fleetAccountId: fleet.id, filters })
}

export async function createFleetFuelRequest({ auth, payload, req }) {
  const fleetId = payload.fleetId
  const userId = Number(auth?.userId || 0)
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.DRIVER_MODE })
  const vehicle = await resolveVehicle(prisma, { fleetAccountId: fleet.id, vehicleId: payload.vehicleId })
  const station = await resolveStationByPublicId(prisma, payload.stationPublicId)
  const validation = await validateFleetFueling(prisma, {
    fleet,
    driverUserId: userId,
    vehicle,
    station,
    requestedAmount: payload.requestedAmount || null,
    requestedLitres: payload.requestedLitres || null,
    fuelType: vehicle.fuel_type,
    odometerReading: payload.odometerReading ?? null,
  })
  if (!validation.allowed) {
    throw badRequest(validation.checks.find((check) => check.status === "blocked")?.message || "Fleet fueling request failed policy checks")
  }
  const publicId = createPublicId()
  await prisma.$executeRaw`
    INSERT INTO fleet_fuel_requests (
      public_id,
      fleet_account_id,
      requested_by_user_id,
      vehicle_id,
      station_id,
      requested_amount,
      requested_litres,
      odometer_reading,
      reason,
      status,
      expires_at
    )
    VALUES (
      ${publicId},
      ${fleet.id},
      ${userId},
      ${vehicle.id},
      ${station?.id || null},
      ${payload.requestedAmount ?? null},
      ${payload.requestedLitres ?? null},
      ${payload.odometerReading ?? null},
      ${nullableText(payload.reason)},
      'pending',
      ${toSqlDateTimeOrNull(payload.expiresAt)}
    )
  `
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: userId,
    action: "fuel_request.created",
    entityType: "fleet_fuel_request",
    entityId: publicId,
    metadata: { policyStatus: validation.status },
    ipAddress: readClientIp(req),
  })
  return { request: await getFleetFuelRequestByPublicId({ fleetAccountId: fleet.id, requestId: publicId }), policy: validation }
}

export async function createFleetFuelAllocation({ auth, fleetId, payload, req }) {
  const { fleet } = await requireFleetAccess({
    auth,
    fleetId,
    permission: FLEET_PERMISSIONS.REQUESTS_APPROVE,
    managerOnly: true,
  })
  const result = await prisma.$transaction(async (tx) => {
    const member = await resolveMemberUser(tx, {
      fleetAccountId: fleet.id,
      memberId: payload.memberId || null,
      userPublicId: payload.userPublicId || null,
    })
    if (!member?.id) throw notFound("Fleet driver not found")
    if (String(member.role || "") !== "driver") throw badRequest("Fuel allocations can only be issued to drivers")
    if (String(member.status || "") !== "active") throw badRequest("Driver must be active before funds can be allocated")

    const vehicle = await resolveVehicle(tx, { fleetAccountId: fleet.id, vehicleId: payload.vehicleId })
    const station = await resolveStationByPublicId(tx, payload.stationPublicId)
    const validation = await validateFleetFueling(tx, {
      fleet,
      driverUserId: Number(member.user_id),
      vehicle,
      station,
      requestedAmount: payload.requestedAmount || null,
      requestedLitres: payload.requestedLitres || null,
      fuelType: vehicle.fuel_type,
      odometerReading: payload.odometerReading ?? null,
    })
    if (!validation.allowed) {
      throw badRequest(validation.checks.find((check) => check.status === "blocked")?.message || "Fleet allocation failed policy checks")
    }

    const publicId = createPublicId()
    const hold = await reserveFleetWallet(tx, {
      fleetAccountId: fleet.id,
      amount: payload.requestedAmount || 0,
      actorUserId: Number(auth.userId),
      relatedEntityType: "FUEL_ALLOCATION",
      relatedEntityId: publicId,
    })

    await tx.$executeRaw`
      INSERT INTO fleet_fuel_requests (
        public_id,
        fleet_account_id,
        requested_by_user_id,
        vehicle_id,
        station_id,
        requested_amount,
        requested_litres,
        odometer_reading,
        reason,
        status,
        approved_by_user_id,
        approved_at,
        hold_amount,
        hold_reference,
        expires_at
      )
      VALUES (
        ${publicId},
        ${fleet.id},
        ${member.user_id},
        ${vehicle.id},
        ${station?.id || null},
        ${payload.requestedAmount ?? null},
        ${payload.requestedLitres ?? null},
        ${payload.odometerReading ?? null},
        ${nullableText(payload.reason) || "Manager-issued fleet funds"},
        'approved',
        ${Number(auth.userId)},
        CURRENT_TIMESTAMP(3),
        ${hold.holdAmount},
        ${hold.holdReference},
        ${toSqlDateTimeOrNull(payload.expiresAt)}
      )
    `

    await writeFleetAuditLog(tx, {
      fleetAccountId: fleet.id,
      actorUserId: Number(auth.userId),
      action: "fuel_request.allocated",
      entityType: "fleet_fuel_request",
      entityId: publicId,
      metadata: {
        driverUserPublicId: member.user_public_id,
        vehicleId: vehicle.public_id,
        holdReference: hold.holdReference,
      },
      ipAddress: readClientIp(req),
    })

    return {
      allocation: await getFleetFuelRequestByPublicId({ fleetAccountId: fleet.id, requestId: publicId, db: tx }),
      policy: validation,
      holdReference: hold.holdReference,
      notificationUser: {
        id: member.user_id,
        public_id: member.user_public_id,
        full_name: member.full_name,
        email: member.email,
        phone_e164: member.phone_e164,
      },
      notificationVehicle: {
        public_id: vehicle.public_id,
        plate_number: vehicle.plate_number,
      },
      notificationAmount: payload.requestedAmount || null,
      notificationLitres: payload.requestedLitres || null,
    }
  })
  await notifyFleetFuelAllocationUser({
    user: result.notificationUser,
    fleet,
    requestPublicId: result.allocation.publicId,
    vehicle: result.notificationVehicle,
    amount: result.notificationAmount,
    litres: result.notificationLitres,
  })
  const {
    notificationUser: _notificationUser,
    notificationVehicle: _notificationVehicle,
    notificationAmount: _notificationAmount,
    notificationLitres: _notificationLitres,
    ...publicResult
  } = result
  return publicResult
}

async function getFleetFuelRequestByPublicId({ fleetAccountId, requestId, db = prisma, forUpdate = false }) {
  const lock = forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty
  const rows = await db.$queryRaw(Prisma.sql`
    SELECT fr.*,
           u.public_id AS driver_public_id, u.full_name AS driver_name, u.email AS driver_email, u.phone_e164 AS driver_phone,
           au.public_id AS approver_public_id, au.full_name AS approver_name,
           fv.public_id AS vehicle_public_id, fv.plate_number, fv.vehicle_name, fv.fuel_type AS vehicle_fuel_type, fv.status AS vehicle_status,
           st.public_id AS station_public_id, st.name AS station_name
    FROM fleet_fuel_requests fr
    INNER JOIN users u ON u.id = fr.requested_by_user_id
    INNER JOIN fleet_vehicles fv ON fv.id = fr.vehicle_id
    LEFT JOIN users au ON au.id = fr.approved_by_user_id
    LEFT JOIN stations st ON st.id = fr.station_id
    WHERE fr.fleet_account_id = ${fleetAccountId}
      AND fr.public_id = ${requestId}
    LIMIT 1
    ${lock}
  `)
  const request = rows?.[0] || null
  if (!request?.id) throw notFound("Fleet fuel request not found")
  return mapFuelRequestRow(request)
}

export async function approveFleetFuelRequest({ auth, fleetId, requestId, payload = {}, req }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.REQUESTS_APPROVE, managerOnly: true })
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT
        fr.id AS request_id,
        fr.public_id AS request_public_id,
        fr.requested_by_user_id,
        fr.vehicle_id,
        fr.station_id,
        fr.requested_amount,
        fr.requested_litres,
        fr.odometer_reading,
        fr.status AS request_status,
        fv.status AS vehicle_status,
        fv.fuel_type,
        fv.tank_capacity_litres,
        fv.current_odometer
      FROM fleet_fuel_requests fr
      INNER JOIN fleet_vehicles fv ON fv.id = fr.vehicle_id
      WHERE fr.fleet_account_id = ${fleet.id}
        AND fr.public_id = ${requestId}
      LIMIT 1
      FOR UPDATE
    `
    const row = rows?.[0] || null
    if (!row?.request_id) throw notFound("Fleet fuel request not found")
    if (String(row.request_status) !== "pending") throw badRequest("Only pending requests can be approved")
    const stationRows = row.station_id
      ? await tx.$queryRaw`SELECT id, public_id, name FROM stations WHERE id = ${row.station_id} LIMIT 1`
      : []
    const approvedAmount = payload.approvedAmount ?? row.requested_amount
    const approvedLitres = payload.approvedLitres ?? row.requested_litres
    const validation = await validateFleetFueling(tx, {
      fleet,
      driverUserId: Number(row.requested_by_user_id),
      vehicle: {
        id: row.vehicle_id,
        status: row.vehicle_status,
        fuel_type: row.fuel_type,
        tank_capacity_litres: row.tank_capacity_litres,
        current_odometer: row.current_odometer,
      },
      station: stationRows?.[0] || null,
      requestedAmount: approvedAmount,
      requestedLitres: approvedLitres,
      fuelType: row.fuel_type,
      odometerReading: row.odometer_reading,
    })
    if (!validation.allowed) {
      throw badRequest(validation.checks.find((check) => check.status === "blocked")?.message || "Fuel request failed policy checks")
    }
    const hold = await reserveFleetWallet(tx, {
      fleetAccountId: fleet.id,
      amount: approvedAmount || 0,
      actorUserId: Number(auth.userId),
      relatedEntityType: "FUEL_REQUEST",
      relatedEntityId: requestId,
    })
    await tx.$executeRaw`
      UPDATE fleet_fuel_requests
      SET
        status = 'approved',
        approved_by_user_id = ${Number(auth.userId)},
        approved_at = CURRENT_TIMESTAMP(3),
        approved_amount = ${approvedAmount || null},
        approved_litres = ${approvedLitres || null},
        hold_amount = ${hold.holdAmount},
        hold_reference = ${hold.holdReference},
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE public_id = ${requestId}
    `
    await writeFleetAuditLog(tx, {
      fleetAccountId: fleet.id,
      actorUserId: Number(auth.userId),
      action: "fuel_request.approved",
      entityType: "fleet_fuel_request",
      entityId: requestId,
      metadata: { holdReference: hold.holdReference, approvedAmount, approvedLitres },
      ipAddress: readClientIp(req),
    })
    return { approved: true, holdReference: hold.holdReference, policy: validation }
  })
}

export async function rejectFleetFuelRequest({ auth, fleetId, requestId, reason, req }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.REQUESTS_APPROVE, managerOnly: true })
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT *
      FROM fleet_fuel_requests
      WHERE fleet_account_id = ${fleet.id}
        AND public_id = ${requestId}
      LIMIT 1
      FOR UPDATE
    `
    const request = rows?.[0] || null
    if (!request?.id) throw notFound("Fleet fuel request not found")
    if (!["pending", "approved"].includes(String(request.status))) throw badRequest("This request cannot be rejected")
    if (toMoneyNumber(request.hold_amount) > 0) {
      await releaseFleetWalletHold(tx, {
        fleetAccountId: fleet.id,
        amount: request.hold_amount,
        actorUserId: Number(auth.userId),
        relatedEntityType: "FUEL_REQUEST",
        relatedEntityId: requestId,
        description: "Fleet fuel request rejected",
      })
    }
    await tx.$executeRaw`
      UPDATE fleet_fuel_requests
      SET status = 'rejected',
          rejected_reason = ${reason},
          hold_amount = 0,
          hold_reference = NULL,
          updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${request.id}
    `
    await writeFleetAuditLog(tx, {
      fleetAccountId: fleet.id,
      actorUserId: Number(auth.userId),
      action: "fuel_request.rejected",
      entityType: "fleet_fuel_request",
      entityId: requestId,
      metadata: { reason },
      ipAddress: readClientIp(req),
    })
  })
  return { rejected: true }
}

export async function cancelFleetFuelRequest({ auth, fleetId, requestId, reason = "", req }) {
  const userId = Number(auth.userId || 0)
  const { fleet, membership } = await requireFleetAccess({ auth, fleetId })
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT *
      FROM fleet_fuel_requests
      WHERE fleet_account_id = ${fleet.id}
        AND public_id = ${requestId}
      LIMIT 1
      FOR UPDATE
    `
    const request = rows?.[0] || null
    if (!request?.id) throw notFound("Fleet fuel request not found")
    const ownsRequest = Number(request.requested_by_user_id) === userId
    if (!ownsRequest && !roleHasFleetPermission(membership.role, FLEET_PERMISSIONS.REQUESTS_APPROVE)) {
      throw forbidden("Only the requesting driver or an approver can cancel this request")
    }
    if (!["pending", "approved"].includes(String(request.status))) throw badRequest("This request cannot be cancelled")
    if (toMoneyNumber(request.hold_amount) > 0) {
      await releaseFleetWalletHold(tx, {
        fleetAccountId: fleet.id,
        amount: request.hold_amount,
        actorUserId: userId,
        relatedEntityType: "FUEL_REQUEST",
        relatedEntityId: requestId,
        description: "Fleet fuel request cancelled",
      })
    }
    await tx.$executeRaw`
      UPDATE fleet_fuel_requests
      SET status = 'cancelled',
          rejected_reason = ${nullableText(reason)},
          hold_amount = 0,
          hold_reference = NULL,
          updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${request.id}
    `
    await writeFleetAuditLog(tx, {
      fleetAccountId: fleet.id,
      actorUserId: userId,
      action: "fuel_request.cancelled",
      entityType: "fleet_fuel_request",
      entityId: requestId,
      metadata: { reason },
      ipAddress: readClientIp(req),
    })
  })
  return { cancelled: true }
}

export async function expireStaleFleetFuelRequests() {
  const rows = await prisma.$queryRaw`
    SELECT *
    FROM fleet_fuel_requests
    WHERE status IN ('pending', 'approved')
      AND expires_at IS NOT NULL
      AND expires_at <= CURRENT_TIMESTAMP(3)
    LIMIT 100
  `
  let expired = 0
  for (const request of rows || []) {
    await prisma.$transaction(async (tx) => {
      if (toMoneyNumber(request.hold_amount) > 0) {
        await releaseFleetWalletHold(tx, {
          fleetAccountId: request.fleet_account_id,
          amount: request.hold_amount,
          actorUserId: null,
          relatedEntityType: "FUEL_REQUEST",
          relatedEntityId: request.public_id,
          description: "Fleet fuel request expired",
        })
      }
      await tx.$executeRaw`
        UPDATE fleet_fuel_requests
        SET status = 'expired',
            hold_amount = 0,
            hold_reference = NULL,
            updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ${request.id}
      `
      expired += 1
    })
  }
  return { expired }
}

async function listFleetTransactionsInternal({ fleetAccountId, filters }) {
  const page = Number(filters.page || 1)
  const limit = Number(filters.limit || 25)
  const offset = (page - 1) * limit
  const from = nullableText(filters.from)
  const to = nullableText(filters.to) || from
  const fromDt = from ? `${from} 00:00:00` : null
  const toDt = to ? `${to} 23:59:59` : null
  const fuelType = nullableText(filters.fuelType)?.toLowerCase() || null
  const status = nullableText(filters.status)?.toLowerCase() || null
  const riskStatus = nullableText(filters.riskStatus)?.toLowerCase() || null
  const driverPublicId = nullableText(filters.driverUserPublicId)
  const vehiclePublicId = nullableText(filters.vehicleId)
  const stationPublicId = nullableText(filters.stationPublicId)
  const rows = await prisma.$queryRaw`
    SELECT ft.*,
           fv.public_id AS vehicle_public_id, fv.plate_number, fv.vehicle_name,
           u.public_id AS driver_public_id, u.full_name AS driver_name, u.email AS driver_email, u.phone_e164 AS driver_phone,
           st.public_id AS station_public_id, st.name AS station_name,
           fd.public_id AS department_public_id, fd.name AS department_name, fd.code AS department_code,
           fal.public_id AS allocation_public_id, fal.allocation_target_type,
           ffc.public_id AS fuel_card_public_id, ffc.card_label, ffc.masked_card_number,
           p.public_id AS pump_public_id, p.pump_number,
           pn.public_id AS nozzle_public_id, pn.nozzle_number,
           fr.public_id AS fuel_request_public_id
    FROM fleet_transactions ft
    INNER JOIN fleet_vehicles fv ON fv.id = ft.vehicle_id
    INNER JOIN users u ON u.id = ft.driver_user_id
    LEFT JOIN stations st ON st.id = ft.station_id
    LEFT JOIN fleet_departments fd ON fd.id = ft.department_id
    LEFT JOIN fleet_allocations fal ON fal.id = ft.allocation_id
    LEFT JOIN fleet_fuel_cards ffc ON ffc.id = ft.fuel_card_id
    LEFT JOIN pumps p ON p.id = ft.pump_id
    LEFT JOIN pump_nozzles pn ON pn.id = ft.nozzle_id
    LEFT JOIN fleet_fuel_requests fr ON fr.id = ft.fuel_request_id
    WHERE ft.fleet_account_id = ${fleetAccountId}
      AND (${fromDt} IS NULL OR ft.created_at >= ${fromDt})
      AND (${toDt} IS NULL OR ft.created_at <= ${toDt})
      AND (${fuelType} IS NULL OR ft.fuel_type = ${fuelType})
      AND (${status} IS NULL OR ft.status = ${status})
      AND (${riskStatus} IS NULL OR ft.risk_status = ${riskStatus})
      AND (${driverPublicId} IS NULL OR u.public_id = ${driverPublicId})
      AND (${vehiclePublicId} IS NULL OR fv.public_id = ${vehiclePublicId})
      AND (${stationPublicId} IS NULL OR st.public_id = ${stationPublicId})
    ORDER BY ft.created_at DESC, ft.id DESC
    LIMIT ${limit} OFFSET ${offset}
  `
  return { items: (rows || []).map(mapTransactionRow), page, limit }
}

export async function listFleetTransactions({ auth, fleetId, filters }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.TRANSACTIONS_VIEW, managerOnly: true })
  return listFleetTransactionsInternal({ fleetAccountId: fleet.id, filters })
}

export async function createFleetTransaction({ auth, fleetId, payload, req }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.TRANSACTIONS_CREATE, managerOnly: true })
  return prisma.$transaction(async (tx) => {
    const vehicle = await resolveVehicle(tx, { fleetAccountId: fleet.id, vehicleId: payload.vehicleId, forUpdate: true })
    const driver = await resolveUserByPublicId(tx, payload.driverUserPublicId)
    if (!driver?.id) throw notFound("Driver user not found")
    const station = await resolveStationByPublicId(tx, payload.stationPublicId)
    if (!station?.id) throw notFound("Station not found")
    const { pump, nozzle } = await resolvePumpAndNozzle(tx, {
      stationId: station.id,
      pumpPublicId: nullableText(payload.pumpPublicId),
      nozzlePublicId: nullableText(payload.nozzlePublicId),
    })

    let fuelRequest = null
    if (payload.fuelRequestId) {
      const requestRows = await tx.$queryRaw`
        SELECT *
        FROM fleet_fuel_requests
        WHERE fleet_account_id = ${fleet.id}
          AND public_id = ${payload.fuelRequestId}
        LIMIT 1
        FOR UPDATE
      `
      fuelRequest = requestRows?.[0] || null
      if (!fuelRequest?.id) throw notFound("Fleet fuel request not found")
      if (!["approved", "pending"].includes(String(fuelRequest.status))) throw badRequest("Fuel request cannot be completed")
    }

    const validation = await validateFleetFueling(tx, {
      fleet,
      driverUserId: driver.id,
      vehicle,
      station,
      requestedAmount: payload.amount,
      requestedLitres: payload.litres,
      fuelType: payload.fuelType,
      odometerReading: payload.odometerReading ?? null,
    })
    if (!validation.allowed) {
      throw badRequest(validation.checks.find((check) => check.status === "blocked")?.message || "Fleet transaction failed policy checks")
    }

    const transactionPublicId = createPublicId()
    const walletReference = await debitFleetWallet(tx, {
      fleetAccountId: fleet.id,
      amount: payload.amount,
      holdAmount: fuelRequest?.hold_amount || 0,
      actorUserId: Number(auth.userId),
      relatedEntityType: "FLEET_TRANSACTION",
      relatedEntityId: transactionPublicId,
      description: `Fleet fuel transaction ${transactionPublicId}`,
    })

    const riskStatus = validation.status === "warning" ? "suspicious" : "normal"
    const riskReason = validation.status === "warning"
      ? validation.checks.filter((check) => check.status === "warning").map((check) => check.message).filter(Boolean).join(" ")
      : null

    await tx.$executeRaw`
      INSERT INTO fleet_transactions (
        public_id,
        fleet_account_id,
        vehicle_id,
        driver_user_id,
        station_id,
        pump_id,
        nozzle_id,
        fuel_request_id,
        litres,
        amount,
        price_per_litre,
        fuel_type,
        odometer_reading,
        status,
        risk_status,
        risk_reason,
        wallet_transaction_reference
      )
      VALUES (
        ${transactionPublicId},
        ${fleet.id},
        ${vehicle.id},
        ${driver.id},
        ${station.id},
        ${pump?.id || null},
        ${nozzle?.id || null},
        ${fuelRequest?.id || null},
        ${payload.litres},
        ${payload.amount},
        ${payload.pricePerLitre},
        ${normalizeFuelType(payload.fuelType)},
        ${payload.odometerReading ?? null},
        'completed',
        ${riskStatus},
        ${nullableText(riskReason)},
        ${walletReference}
      )
    `
    if (payload.odometerReading !== undefined && payload.odometerReading !== null) {
      await tx.$executeRaw`
        UPDATE fleet_vehicles
        SET current_odometer = ${payload.odometerReading}, updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ${vehicle.id}
      `
    }
    if (fuelRequest?.id) {
      await tx.$executeRaw`
        UPDATE fleet_fuel_requests
        SET status = 'completed',
            hold_amount = 0,
            hold_reference = NULL,
            updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ${fuelRequest.id}
      `
    }
    if (riskStatus !== "normal") {
      await tx.$executeRaw`
        INSERT INTO fleet_alerts (
          public_id,
          fleet_account_id,
          type,
          severity,
          title,
          message,
          related_entity_type,
          related_entity_id
        )
        VALUES (
          ${createPublicId()},
          ${fleet.id},
          'suspicious_transaction',
          'warning',
          'Transaction needs review',
          ${nullableText(riskReason) || 'A fleet policy warning was raised for this transaction.'},
          'fleet_transaction',
          ${transactionPublicId}
        )
      `
    }
    await writeFleetAuditLog(tx, {
      fleetAccountId: fleet.id,
      actorUserId: Number(auth.userId),
      action: "transaction.created",
      entityType: "fleet_transaction",
      entityId: transactionPublicId,
      metadata: { walletReference, riskStatus },
      ipAddress: readClientIp(req),
    })
    return { transactionPublicId, walletReference, riskStatus, policy: validation }
  })
}

export async function listFleetPolicies({ auth, fleetId }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.DASHBOARD_VIEW, managerOnly: true })
  const rows = await prisma.$queryRaw`
    SELECT *
    FROM fleet_policies
    WHERE fleet_account_id = ${fleet.id}
    ORDER BY active DESC, applies_to_type ASC, name ASC
  `
  return { policies: (rows || []).map(mapPolicyRow) }
}

export async function upsertFleetPolicy({ auth, fleetId, policyId = null, payload, req }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.POLICIES_MANAGE, managerOnly: true })
  const allowedStationsJson = payload.allowedStationIds ? JSON.stringify(payload.allowedStationIds) : null
  let targetId = null
  if (payload.appliesToType === "vehicle" && payload.appliesToId) {
    targetId = (await resolveVehicle(prisma, { fleetAccountId: fleet.id, vehicleId: payload.appliesToId })).id
  } else if (payload.appliesToType === "driver" && payload.appliesToId) {
    const member = await resolveMemberUser(prisma, { fleetAccountId: fleet.id, memberId: payload.appliesToId })
      || await resolveMemberUser(prisma, { fleetAccountId: fleet.id, userPublicId: payload.appliesToId })
    if (!member?.user_id) throw notFound("Fleet driver/member not found")
    targetId = Number(member.user_id)
  }

  const existing = policyId
    ? (await prisma.$queryRaw`
        SELECT *
        FROM fleet_policies
        WHERE fleet_account_id = ${fleet.id}
          AND public_id = ${policyId}
        LIMIT 1
      `)?.[0]
    : null

  if (existing?.id) {
    await prisma.$executeRaw`
      UPDATE fleet_policies
      SET name = ${payload.name},
          applies_to_type = ${payload.appliesToType},
          applies_to_id = ${targetId},
          daily_amount_limit = ${payload.dailyAmountLimit ?? null},
          weekly_amount_limit = ${payload.weeklyAmountLimit ?? null},
          monthly_amount_limit = ${payload.monthlyAmountLimit ?? null},
          daily_litre_limit = ${payload.dailyLitreLimit ?? null},
          monthly_litre_limit = ${payload.monthlyLitreLimit ?? null},
          allowed_fuel_type = ${payload.allowedFuelType || null},
          allowed_station_ids_json = ${allowedStationsJson},
          requires_approval_above_amount = ${payload.requiresApprovalAboveAmount ?? null},
          active = ${payload.active === undefined ? 1 : payload.active ? 1 : 0},
          updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${existing.id}
    `
    await writeFleetAuditLog(prisma, {
      fleetAccountId: fleet.id,
      actorUserId: Number(auth.userId),
      action: "policy.updated",
      entityType: "fleet_policy",
      entityId: policyId,
      metadata: payload,
      ipAddress: readClientIp(req),
    })
    return { publicId: policyId, updated: true }
  }

  const publicId = createPublicId()
  await prisma.$executeRaw`
    INSERT INTO fleet_policies (
      public_id,
      fleet_account_id,
      name,
      applies_to_type,
      applies_to_id,
      daily_amount_limit,
      weekly_amount_limit,
      monthly_amount_limit,
      daily_litre_limit,
      monthly_litre_limit,
      allowed_fuel_type,
      allowed_station_ids_json,
      requires_approval_above_amount,
      active
    )
    VALUES (
      ${publicId},
      ${fleet.id},
      ${payload.name},
      ${payload.appliesToType},
      ${targetId},
      ${payload.dailyAmountLimit ?? null},
      ${payload.weeklyAmountLimit ?? null},
      ${payload.monthlyAmountLimit ?? null},
      ${payload.dailyLitreLimit ?? null},
      ${payload.monthlyLitreLimit ?? null},
      ${payload.allowedFuelType || null},
      ${allowedStationsJson},
      ${payload.requiresApprovalAboveAmount ?? null},
      ${payload.active === undefined ? 1 : payload.active ? 1 : 0}
    )
  `
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: "policy.created",
    entityType: "fleet_policy",
    entityId: publicId,
    metadata: payload,
    ipAddress: readClientIp(req),
  })
  return { publicId, created: true }
}

export async function validateFleetPolicyForRequest({ auth, fleetId, payload }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId })
  const vehicle = await resolveVehicle(prisma, { fleetAccountId: fleet.id, vehicleId: payload.vehicleId })
  const station = await resolveStationByPublicId(prisma, payload.stationPublicId)
  return validateFleetFueling(prisma, {
    fleet,
    driverUserId: Number(auth.userId),
    vehicle,
    station,
    requestedAmount: payload.requestedAmount || null,
    requestedLitres: payload.requestedLitres || null,
    fuelType: vehicle.fuel_type,
    odometerReading: payload.odometerReading ?? null,
  })
}

export async function listFleetAlerts({ auth, fleetId }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.DASHBOARD_VIEW, managerOnly: true })
  const rows = await prisma.$queryRaw`
    SELECT *
    FROM fleet_alerts
    WHERE fleet_account_id = ${fleet.id}
    ORDER BY read_at IS NULL DESC, created_at DESC
    LIMIT 100
  `
  return {
    alerts: (rows || []).map((row) => ({
      publicId: row.public_id,
      type: row.type,
      severity: row.severity,
      title: row.title,
      message: row.message,
      relatedEntityType: row.related_entity_type,
      relatedEntityId: row.related_entity_id,
      readAt: toIsoOrNull(row.read_at),
      createdAt: toIsoOrNull(row.created_at),
    })),
  }
}

export async function markFleetAlertRead({ auth, fleetId, alertId }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.ALERTS_MANAGE, managerOnly: true })
  await prisma.$executeRaw`
    UPDATE fleet_alerts
    SET read_at = CURRENT_TIMESTAMP(3)
    WHERE fleet_account_id = ${fleet.id}
      AND public_id = ${alertId}
      AND read_at IS NULL
  `
  return { read: true }
}

export async function listFleetAuditLogs({ auth, fleetId }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.AUDIT_VIEW, managerOnly: true })
  const rows = await prisma.$queryRaw`
    SELECT fal.*, u.public_id AS actor_public_id, u.full_name AS actor_name
    FROM fleet_audit_logs fal
    LEFT JOIN users u ON u.id = fal.actor_user_id
    WHERE fal.fleet_account_id = ${fleet.id}
    ORDER BY fal.created_at DESC
    LIMIT 200
  `
  return {
    logs: (rows || []).map((row) => ({
      publicId: row.public_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      metadata: parseJsonObject(row.metadata_json),
      ipAddress: row.ip_address,
      actor: row.actor_public_id ? { publicId: row.actor_public_id, fullName: row.actor_name } : null,
      createdAt: toIsoOrNull(row.created_at),
    })),
  }
}

const FLEET_FINANCE_MANAGE_ROLES = new Set(["owner", "admin", "finance"])
const FLEET_OPERATIONS_MANAGE_ROLES = new Set(["owner", "admin", "dispatcher"])

export async function listFleetBudgets({ auth, fleetId, filters = {} }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.REPORTS_VIEW, managerOnly: true })
  const page = Number(filters.page || 1)
  const limit = Number(filters.limit || 25)
  const offset = (page - 1) * limit
  const status = nullableText(filters.status)
  const rows = await prisma.$queryRaw`
    SELECT *
    FROM fleet_budgets
    WHERE fleet_account_id = ${fleet.id}
      AND (${status} IS NULL OR status = ${status})
    ORDER BY budget_month DESC, id DESC
    LIMIT ${limit} OFFSET ${offset}
  `
  return { items: (rows || []).map(mapBudgetRow), page, limit }
}

export async function saveFleetBudget({ auth, fleetId, recordId = null, payload, req }) {
  const { fleet, membership } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.REPORTS_VIEW, managerOnly: true })
  assertFleetRoleAllowed(membership, FLEET_FINANCE_MANAGE_ROLES, "Only fleet owners, admins, and finance users can manage budgets")
  const existingRows = recordId
    ? await prisma.$queryRaw`
        SELECT *
        FROM fleet_budgets
        WHERE fleet_account_id = ${fleet.id}
          AND public_id = ${recordId}
        LIMIT 1
      `
    : []
  const existing = existingRows?.[0] || null
  if (recordId && !existing?.id) throw notFound("Fleet budget not found")
  const existingMonth = existing?.budget_month instanceof Date ? existing.budget_month.toISOString().slice(0, 10) : nullableText(existing?.budget_month)
  const publicId = existing?.public_id || createPublicId()
  const budgetMonth = normalizeSqlDate(payload.budgetMonth ?? existingMonth)
  if (!budgetMonth) throw badRequest("Budget month is required")
  const fuelBudget = toMoneyNumber(payload.fuelBudget ?? existing?.fuel_budget)
  const maintenanceBudget = toMoneyNumber(payload.maintenanceBudget ?? existing?.maintenance_budget)
  const otherBudget = toMoneyNumber(payload.otherBudget ?? existing?.other_budget)
  const revenueTarget = toMoneyNumber(payload.revenueTarget ?? existing?.revenue_target)
  const status = payload.status || existing?.status || "active"

  if (existing?.id) {
    await prisma.$executeRaw`
      UPDATE fleet_budgets
      SET budget_month = ${budgetMonth},
          fuel_budget = ${fuelBudget},
          maintenance_budget = ${maintenanceBudget},
          other_budget = ${otherBudget},
          revenue_target = ${revenueTarget},
          status = ${status},
          updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${existing.id}
    `
  } else {
    await prisma.$executeRaw`
      INSERT INTO fleet_budgets (
        public_id,
        fleet_account_id,
        budget_month,
        fuel_budget,
        maintenance_budget,
        other_budget,
        revenue_target,
        status,
        created_by_user_id
      )
      VALUES (
        ${publicId},
        ${fleet.id},
        ${budgetMonth},
        ${fuelBudget},
        ${maintenanceBudget},
        ${otherBudget},
        ${revenueTarget},
        ${status},
        ${Number(auth.userId)}
      )
      ON DUPLICATE KEY UPDATE
        fuel_budget = VALUES(fuel_budget),
        maintenance_budget = VALUES(maintenance_budget),
        other_budget = VALUES(other_budget),
        revenue_target = VALUES(revenue_target),
        status = VALUES(status),
        updated_at = CURRENT_TIMESTAMP(3)
    `
  }
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: existing?.id ? "financial.budget_updated" : "financial.budget_created",
    entityType: "fleet_budget",
    entityId: publicId,
    metadata: { budgetMonth, fuelBudget, maintenanceBudget, otherBudget, revenueTarget, status },
    ipAddress: readClientIp(req),
  })
  const rows = await prisma.$queryRaw`SELECT * FROM fleet_budgets WHERE fleet_account_id = ${fleet.id} AND public_id = ${publicId} LIMIT 1`
  return { budget: mapBudgetRow(rows?.[0]) }
}

export async function listFleetInvoices({ auth, fleetId, filters = {} }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.REPORTS_VIEW, managerOnly: true })
  const page = Number(filters.page || 1)
  const limit = Number(filters.limit || 25)
  const offset = (page - 1) * limit
  const status = nullableText(filters.status)
  const rows = await prisma.$queryRaw`
    SELECT *
    FROM fleet_invoices
    WHERE fleet_account_id = ${fleet.id}
      AND (${status} IS NULL OR status = ${status})
    ORDER BY FIELD(status, 'overdue', 'pending', 'draft', 'paid', 'cancelled'), due_at ASC, id DESC
    LIMIT ${limit} OFFSET ${offset}
  `
  return { items: (rows || []).map(mapInvoiceRow), page, limit }
}

export async function saveFleetInvoice({ auth, fleetId, recordId = null, payload, req }) {
  const { fleet, membership } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.REPORTS_VIEW, managerOnly: true })
  assertFleetRoleAllowed(membership, FLEET_FINANCE_MANAGE_ROLES, "Only fleet owners, admins, and finance users can manage invoices")
  const existingRows = recordId
    ? await prisma.$queryRaw`
        SELECT *
        FROM fleet_invoices
        WHERE fleet_account_id = ${fleet.id}
          AND public_id = ${recordId}
        LIMIT 1
      `
    : []
  const existing = existingRows?.[0] || null
  if (recordId && !existing?.id) throw notFound("Fleet invoice not found")
  const publicId = existing?.public_id || createPublicId()
  const invoiceNumber = nullableText(payload.invoiceNumber ?? existing?.invoice_number)
  if (!invoiceNumber) throw badRequest("Invoice number is required")
  const subtotal = toMoneyNumber(payload.subtotal ?? existing?.subtotal)
  const taxAmount = toMoneyNumber(payload.taxAmount ?? existing?.tax_amount)
  const totalAmount = toMoneyNumber(payload.totalAmount ?? existing?.total_amount ?? subtotal + taxAmount) || toMoneyNumber(subtotal + taxAmount)
  const paidAmount = toMoneyNumber(payload.paidAmount ?? existing?.paid_amount)
  const status = payload.status || existing?.status || "pending"
  const billingPeriodStart = normalizeSqlDate(payload.billingPeriodStart ?? existing?.billing_period_start)
  const billingPeriodEnd = normalizeSqlDate(payload.billingPeriodEnd ?? existing?.billing_period_end)
  const dueAt = toSqlDateTimeOrNull(payload.dueAt ?? existing?.due_at)
  const paidAt = toSqlDateTimeOrNull(payload.paidAt ?? existing?.paid_at)
  const notes = payload.notes === undefined ? nullableText(existing?.notes) : nullableText(payload.notes)
  if (existing?.id) {
    await prisma.$executeRaw`
      UPDATE fleet_invoices
      SET invoice_number = ${invoiceNumber},
          billing_period_start = ${billingPeriodStart},
          billing_period_end = ${billingPeriodEnd},
          status = ${status},
          subtotal = ${subtotal},
          tax_amount = ${taxAmount},
          total_amount = ${totalAmount},
          paid_amount = ${paidAmount},
          due_at = ${dueAt},
          paid_at = ${paidAt},
          notes = ${notes},
          updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${existing.id}
    `
  } else {
    await prisma.$executeRaw`
      INSERT INTO fleet_invoices (
        public_id,
        fleet_account_id,
        invoice_number,
        billing_period_start,
        billing_period_end,
        status,
        subtotal,
        tax_amount,
        total_amount,
        paid_amount,
        due_at,
        paid_at,
        notes
      )
      VALUES (
        ${publicId},
        ${fleet.id},
        ${invoiceNumber},
        ${billingPeriodStart},
        ${billingPeriodEnd},
        ${status},
        ${subtotal},
        ${taxAmount},
        ${totalAmount},
        ${paidAmount},
        ${dueAt},
        ${paidAt},
        ${notes}
      )
    `
  }
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: existing?.id ? "financial.invoice_updated" : "financial.invoice_created",
    entityType: "fleet_invoice",
    entityId: publicId,
    metadata: { invoiceNumber, status, totalAmount, paidAmount },
    ipAddress: readClientIp(req),
  })
  const rows = await prisma.$queryRaw`SELECT * FROM fleet_invoices WHERE fleet_account_id = ${fleet.id} AND public_id = ${publicId} LIMIT 1`
  return { invoice: mapInvoiceRow(rows?.[0]) }
}

export async function listFleetMaintenanceRecords({ auth, fleetId, filters = {} }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.DASHBOARD_VIEW, managerOnly: true })
  const page = Number(filters.page || 1)
  const limit = Number(filters.limit || 25)
  const offset = (page - 1) * limit
  const status = nullableText(filters.status)
  const rows = await prisma.$queryRaw`
    SELECT fmr.*,
           fv.public_id AS vehicle_public_id,
           fv.plate_number,
           fv.vehicle_name,
           fv.vehicle_type
    FROM fleet_maintenance_records fmr
    INNER JOIN fleet_vehicles fv ON fv.id = fmr.vehicle_id
    WHERE fmr.fleet_account_id = ${fleet.id}
      AND (${status} IS NULL OR fmr.status = ${status})
    ORDER BY FIELD(fmr.status, 'overdue', 'due', 'scheduled', 'completed', 'cancelled'), fmr.due_at ASC, fmr.id DESC
    LIMIT ${limit} OFFSET ${offset}
  `
  return { items: (rows || []).map(mapMaintenanceRow), page, limit }
}

export async function saveFleetMaintenanceRecord({ auth, fleetId, recordId = null, payload, req }) {
  const { fleet, membership } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.DASHBOARD_VIEW, managerOnly: true })
  assertFleetRoleAllowed(membership, FLEET_OPERATIONS_MANAGE_ROLES, "Only fleet owners, admins, and dispatchers can manage maintenance records")
  const existingRows = recordId
    ? await prisma.$queryRaw`
        SELECT *
        FROM fleet_maintenance_records
        WHERE fleet_account_id = ${fleet.id}
          AND public_id = ${recordId}
        LIMIT 1
      `
    : []
  const existing = existingRows?.[0] || null
  if (recordId && !existing?.id) throw notFound("Fleet maintenance record not found")
  const vehicle = payload.vehicleId
    ? await resolveVehicle(prisma, { fleetAccountId: fleet.id, vehicleId: payload.vehicleId })
    : existing
      ? { id: existing.vehicle_id }
      : null
  if (!vehicle?.id) throw badRequest("Vehicle is required")
  const publicId = existing?.public_id || createPublicId()
  const title = nullableText(payload.title ?? existing?.title)
  if (!title) throw badRequest("Maintenance title is required")
  const recordType = payload.recordType || existing?.record_type || "service"
  const status = payload.status || existing?.status || "due"
  const costEstimate = toMoneyNumber(payload.costEstimate ?? existing?.cost_estimate)
  const costActual = toMoneyNumber(payload.costActual ?? existing?.cost_actual)
  const odometerReading = payload.odometerReading === undefined ? existing?.odometer_reading ?? null : payload.odometerReading ?? null
  const dueAt = toSqlDateTimeOrNull(payload.dueAt ?? existing?.due_at)
  const completedAt = toSqlDateTimeOrNull(payload.completedAt ?? existing?.completed_at)
  if (existing?.id) {
    await prisma.$executeRaw`
      UPDATE fleet_maintenance_records
      SET vehicle_id = ${vehicle.id},
          record_type = ${recordType},
          status = ${status},
          title = ${title},
          cost_estimate = ${costEstimate},
          cost_actual = ${costActual},
          odometer_reading = ${odometerReading},
          due_at = ${dueAt},
          completed_at = ${completedAt},
          updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${existing.id}
    `
  } else {
    await prisma.$executeRaw`
      INSERT INTO fleet_maintenance_records (
        public_id,
        fleet_account_id,
        vehicle_id,
        record_type,
        status,
        title,
        cost_estimate,
        cost_actual,
        odometer_reading,
        due_at,
        completed_at,
        created_by_user_id
      )
      VALUES (
        ${publicId},
        ${fleet.id},
        ${vehicle.id},
        ${recordType},
        ${status},
        ${title},
        ${costEstimate},
        ${costActual},
        ${odometerReading},
        ${dueAt},
        ${completedAt},
        ${Number(auth.userId)}
      )
    `
  }
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: existing?.id ? "operations.maintenance_updated" : "operations.maintenance_created",
    entityType: "fleet_maintenance_record",
    entityId: publicId,
    metadata: { title, status, vehicleId: payload.vehicleId || null },
    ipAddress: readClientIp(req),
  })
  return { recordId: publicId, status }
}

export async function listFleetRouteActivity({ auth, fleetId, filters = {} }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.DASHBOARD_VIEW, managerOnly: true })
  const page = Number(filters.page || 1)
  const limit = Number(filters.limit || 25)
  const offset = (page - 1) * limit
  const status = nullableText(filters.status)
  const rows = await prisma.$queryRaw`
    SELECT fra.*,
           fv.public_id AS vehicle_public_id, fv.plate_number, fv.vehicle_name,
           u.public_id AS driver_public_id, u.full_name AS driver_name, u.phone_e164 AS driver_phone
    FROM fleet_route_activity fra
    LEFT JOIN fleet_vehicles fv ON fv.id = fra.vehicle_id
    LEFT JOIN users u ON u.id = fra.driver_user_id
    WHERE fra.fleet_account_id = ${fleet.id}
      AND (${status} IS NULL OR fra.route_status = ${status})
    ORDER BY COALESCE(fra.started_at, fra.created_at) DESC
    LIMIT ${limit} OFFSET ${offset}
  `
  return { items: (rows || []).map(mapRouteActivityRow), page, limit }
}

export async function saveFleetRouteActivity({ auth, fleetId, recordId = null, payload, req }) {
  const { fleet, membership } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.DASHBOARD_VIEW, managerOnly: true })
  assertFleetRoleAllowed(membership, FLEET_OPERATIONS_MANAGE_ROLES, "Only fleet owners, admins, and dispatchers can manage route activity")
  const existingRows = recordId
    ? await prisma.$queryRaw`
        SELECT *
        FROM fleet_route_activity
        WHERE fleet_account_id = ${fleet.id}
          AND public_id = ${recordId}
        LIMIT 1
      `
    : []
  const existing = existingRows?.[0] || null
  if (recordId && !existing?.id) throw notFound("Fleet route activity not found")
  const vehicle = payload.vehicleId ? await resolveVehicle(prisma, { fleetAccountId: fleet.id, vehicleId: payload.vehicleId }) : null
  const member = payload.driverUserPublicId
    ? await resolveMemberUser(prisma, { fleetAccountId: fleet.id, userPublicId: payload.driverUserPublicId })
    : null
  if (payload.driverUserPublicId && !member?.id) throw notFound("Fleet driver not found")
  const publicId = existing?.public_id || createPublicId()
  const routeName = nullableText(payload.routeName ?? existing?.route_name)
  if (!routeName) throw badRequest("Route name is required")
  const routeStatus = payload.routeStatus || existing?.route_status || "planned"
  const distanceKm = Number(payload.distanceKm ?? existing?.distance_km ?? 0)
  const fuelCost = toMoneyNumber(payload.fuelCost ?? existing?.fuel_cost)
  const otherCost = toMoneyNumber(payload.otherCost ?? existing?.other_cost)
  const revenueAmount = toMoneyNumber(payload.revenueAmount ?? existing?.revenue_amount)
  const startedAt = toSqlDateTimeOrNull(payload.startedAt ?? existing?.started_at)
  const completedAt = toSqlDateTimeOrNull(payload.completedAt ?? existing?.completed_at)
  const vehicleId = vehicle?.id ?? existing?.vehicle_id ?? null
  const driverUserId = member?.user_id ?? existing?.driver_user_id ?? null
  if (existing?.id) {
    await prisma.$executeRaw`
      UPDATE fleet_route_activity
      SET vehicle_id = ${vehicleId},
          driver_user_id = ${driverUserId},
          route_name = ${routeName},
          route_status = ${routeStatus},
          distance_km = ${distanceKm},
          fuel_cost = ${fuelCost},
          other_cost = ${otherCost},
          revenue_amount = ${revenueAmount},
          started_at = ${startedAt},
          completed_at = ${completedAt},
          updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${existing.id}
    `
  } else {
    await prisma.$executeRaw`
      INSERT INTO fleet_route_activity (
        public_id,
        fleet_account_id,
        vehicle_id,
        driver_user_id,
        route_name,
        route_status,
        distance_km,
        fuel_cost,
        other_cost,
        revenue_amount,
        started_at,
        completed_at
      )
      VALUES (
        ${publicId},
        ${fleet.id},
        ${vehicleId},
        ${driverUserId},
        ${routeName},
        ${routeStatus},
        ${distanceKm},
        ${fuelCost},
        ${otherCost},
        ${revenueAmount},
        ${startedAt},
        ${completedAt}
      )
    `
  }
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: existing?.id ? "operations.route_activity_updated" : "operations.route_activity_created",
    entityType: "fleet_route_activity",
    entityId: publicId,
    metadata: { routeName, routeStatus, distanceKm },
    ipAddress: readClientIp(req),
  })
  return { recordId: publicId, status: routeStatus }
}

export async function listFleetVehicleLiveStates({ auth, fleetId, filters = {} }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.DASHBOARD_VIEW, managerOnly: true })
  const page = Number(filters.page || 1)
  const limit = Number(filters.limit || 25)
  const offset = (page - 1) * limit
  const status = nullableText(filters.status)
  const rows = await prisma.$queryRaw`
    SELECT fvl.*,
           fv.public_id AS vehicle_public_id,
           fv.plate_number,
           fv.vehicle_name,
           fv.vehicle_type,
           fv.current_odometer,
           fv.status AS vehicle_status,
           '[]' AS assigned_drivers_json
    FROM fleet_vehicle_live_states fvl
    INNER JOIN fleet_vehicles fv ON fv.id = fvl.vehicle_id
    WHERE fvl.fleet_account_id = ${fleet.id}
      AND (${status} IS NULL OR fvl.operational_status = ${status})
    ORDER BY fvl.last_seen_at DESC, fvl.updated_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `
  return { items: (rows || []).map(mapVehicleLiveStateRow), page, limit }
}

export async function saveFleetVehicleLiveState({ auth, fleetId, recordId = null, payload, req }) {
  const { fleet, membership } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.DASHBOARD_VIEW, managerOnly: true })
  assertFleetRoleAllowed(membership, FLEET_OPERATIONS_MANAGE_ROLES, "Only fleet owners, admins, and dispatchers can manage vehicle live states")
  const existingRows = recordId
    ? await prisma.$queryRaw`
        SELECT *
        FROM fleet_vehicle_live_states
        WHERE fleet_account_id = ${fleet.id}
          AND public_id = ${recordId}
        LIMIT 1
      `
    : []
  const existing = existingRows?.[0] || null
  if (recordId && !existing?.id) throw notFound("Fleet live state not found")
  const vehicle = payload.vehicleId ? await resolveVehicle(prisma, { fleetAccountId: fleet.id, vehicleId: payload.vehicleId }) : existing ? { id: existing.vehicle_id } : null
  if (!vehicle?.id) throw badRequest("Vehicle is required")
  const publicId = existing?.public_id || createPublicId()
  const fuelPercent = payload.fuelPercent === undefined ? existing?.fuel_percent ?? null : payload.fuelPercent ?? null
  const operationalStatus = payload.operationalStatus || existing?.operational_status || "offline"
  const locationLabel = payload.locationLabel === undefined ? nullableText(existing?.location_label) : nullableText(payload.locationLabel)
  const latitude = payload.latitude === undefined ? existing?.latitude ?? null : payload.latitude ?? null
  const longitude = payload.longitude === undefined ? existing?.longitude ?? null : payload.longitude ?? null
  const speedKph = payload.speedKph === undefined ? existing?.speed_kph ?? null : payload.speedKph ?? null
  const lastSeenAt = toSqlDateTimeOrNull(payload.lastSeenAt ?? existing?.last_seen_at ?? new Date())
  if (existing?.id) {
    await prisma.$executeRaw`
      UPDATE fleet_vehicle_live_states
      SET vehicle_id = ${vehicle.id},
          fuel_percent = ${fuelPercent},
          operational_status = ${operationalStatus},
          location_label = ${locationLabel},
          latitude = ${latitude},
          longitude = ${longitude},
          speed_kph = ${speedKph},
          last_seen_at = ${lastSeenAt},
          updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${existing.id}
    `
  } else {
    await prisma.$executeRaw`
      INSERT INTO fleet_vehicle_live_states (
        public_id,
        fleet_account_id,
        vehicle_id,
        fuel_percent,
        operational_status,
        location_label,
        latitude,
        longitude,
        speed_kph,
        last_seen_at
      )
      VALUES (
        ${publicId},
        ${fleet.id},
        ${vehicle.id},
        ${fuelPercent},
        ${operationalStatus},
        ${locationLabel},
        ${latitude},
        ${longitude},
        ${speedKph},
        ${lastSeenAt}
      )
      ON DUPLICATE KEY UPDATE
        fuel_percent = VALUES(fuel_percent),
        operational_status = VALUES(operational_status),
        location_label = VALUES(location_label),
        latitude = VALUES(latitude),
        longitude = VALUES(longitude),
        speed_kph = VALUES(speed_kph),
        last_seen_at = VALUES(last_seen_at),
        updated_at = CURRENT_TIMESTAMP(3)
    `
  }
  await writeFleetAuditLog(prisma, {
    fleetAccountId: fleet.id,
    actorUserId: Number(auth.userId),
    action: existing?.id ? "operations.live_state_updated" : "operations.live_state_created",
    entityType: "fleet_vehicle_live_state",
    entityId: publicId,
    metadata: { operationalStatus, locationLabel },
    ipAddress: readClientIp(req),
  })
  return { recordId: publicId, status: operationalStatus }
}

export async function getFleetReport({ auth, fleetId, reportType, filters }) {
  const { fleet } = await requireFleetAccess({ auth, fleetId, permission: FLEET_PERMISSIONS.REPORTS_VIEW, managerOnly: true })
  if (reportType === "allocation-report") {
    return {
      reportType,
      fleet: mapFleetAccountRow(fleet),
      filters,
      rows: await listFleetAllocationsInternal({ fleetAccountId: fleet.id }),
      generatedAt: new Date().toISOString(),
    }
  }
  if (reportType === "fuel-card-reconciliation") {
    return {
      reportType,
      fleet: mapFleetAccountRow(fleet),
      filters,
      rows: await listFleetFuelCardReconciliationInternal({ fleetAccountId: fleet.id }),
      generatedAt: new Date().toISOString(),
    }
  }
  const transactions = await listFleetTransactionsInternal({
    fleetAccountId: fleet.id,
    filters: { ...filters, page: 1, limit: 500 },
  })
  const totals = transactions.items.reduce(
    (sum, item) => ({
      amount: toMoneyNumber(sum.amount + item.amount),
      litres: toLitresNumber(sum.litres + item.litres),
    }),
    { amount: 0, litres: 0 }
  )
  return {
    reportType,
    fleet: mapFleetAccountRow(fleet),
    filters,
    totals,
    rows: transactions.items,
    generatedAt: new Date().toISOString(),
  }
}

export async function getDriverFleetSummary({ auth }) {
  const memberships = await listCurrentUserFleetMemberships(auth)
  const activeDriverMemberships = memberships.memberships.filter((item) => item.status === "active" && item.role === "driver")
  const fleetIds = activeDriverMemberships.map((item) => item.fleet?.publicId).filter(Boolean)
  if (!fleetIds.length) return { memberships: [], assignedVehicles: [], requests: [] }
  const rows = await prisma.$queryRaw(Prisma.sql`
    SELECT
      fva.*,
      fv.public_id AS vehicle_public_id,
      fv.plate_number,
      fv.vehicle_name,
      fv.vehicle_type,
      fv.fuel_type,
      fv.current_odometer,
      fv.status AS vehicle_status,
      fd.public_id AS department_public_id,
      fd.name AS department_name,
      fd.code AS department_code,
      fa.public_id AS fleet_public_id,
      fa.name AS fleet_name
    FROM fleet_vehicle_assignments fva
    INNER JOIN fleet_vehicles fv ON fv.id = fva.vehicle_id
    INNER JOIN fleet_accounts fa ON fa.id = fva.fleet_account_id
    LEFT JOIN fleet_departments fd ON fd.id = fv.department_id
    WHERE fva.user_id = ${Number(auth.userId)}
      AND fva.status = 'active'
      AND fa.status = 'active'
    ORDER BY fa.name ASC, fv.plate_number ASC
  `)
  const requests = await prisma.$queryRaw`
    SELECT fr.*,
           u.public_id AS driver_public_id, u.full_name AS driver_name, u.email AS driver_email, u.phone_e164 AS driver_phone,
           au.public_id AS approver_public_id, au.full_name AS approver_name,
           fv.public_id AS vehicle_public_id, fv.plate_number, fv.vehicle_name, fv.fuel_type AS vehicle_fuel_type, fv.status AS vehicle_status,
           fa.public_id AS fleet_public_id, fa.name AS fleet_name,
           st.public_id AS station_public_id, st.name AS station_name
    FROM fleet_fuel_requests fr
    INNER JOIN users u ON u.id = fr.requested_by_user_id
    INNER JOIN fleet_vehicles fv ON fv.id = fr.vehicle_id
    INNER JOIN fleet_accounts fa ON fa.id = fr.fleet_account_id
    LEFT JOIN users au ON au.id = fr.approved_by_user_id
    LEFT JOIN stations st ON st.id = fr.station_id
    WHERE fr.requested_by_user_id = ${Number(auth.userId)}
    ORDER BY fr.created_at DESC
    LIMIT 25
  `
  const allocationRows = await prisma.$queryRaw`
    SELECT fal.*,
           fd.public_id AS department_public_id, fd.name AS department_name, fd.code AS department_code,
           fv.public_id AS vehicle_public_id, fv.plate_number, fv.vehicle_name,
           u.public_id AS driver_public_id, u.full_name AS driver_name, u.phone_e164 AS driver_phone,
           fc.public_id AS fuel_card_public_id, fc.card_label, fc.masked_card_number, fc.provider_status
    FROM fleet_allocations fal
    LEFT JOIN fleet_departments fd ON fd.id = fal.department_id
    LEFT JOIN fleet_vehicles fv ON fv.id = fal.vehicle_id
    LEFT JOIN users u ON u.id = fal.driver_user_id
    LEFT JOIN fleet_fuel_cards fc ON fc.id = fal.fuel_card_id
    WHERE fal.status = 'active'
      AND (
        fal.driver_user_id = ${Number(auth.userId)}
        OR fal.vehicle_id IN (
          SELECT vehicle_id
          FROM fleet_vehicle_assignments
          WHERE user_id = ${Number(auth.userId)}
            AND status = 'active'
        )
      )
    ORDER BY fal.period_end DESC, fal.id ASC
  `
  return {
    memberships: activeDriverMemberships,
    assignedVehicles: (rows || []).map((row) => ({
      fleet: { publicId: row.fleet_public_id, name: row.fleet_name },
      department: row.department_public_id ? { publicId: row.department_public_id, name: row.department_name, code: row.department_code } : null,
      vehicle: {
        publicId: row.vehicle_public_id,
        plateNumber: row.plate_number,
        vehicleName: row.vehicle_name,
        vehicleType: row.vehicle_type,
        fuelType: row.fuel_type,
        currentOdometer: row.current_odometer === null ? null : Number(row.current_odometer),
        status: row.vehicle_status,
      },
      assignment: {
        publicId: row.public_id,
        assignedAt: toIsoOrNull(row.assigned_at),
      },
    })),
    allocations: (allocationRows || []).map(mapAllocationRow),
    requests: (requests || []).map(mapFuelRequestRow),
  }
}

export async function validateDriverFleetQueueFunding({
  auth,
  fleetId,
  vehicleId,
  fuelRequestId,
  stationPublicId,
  requestedLitres = null,
  fuelType = null,
}) {
  const userId = Number(auth?.userId || 0)
  if (!Number.isFinite(userId) || userId <= 0) throw badRequest("Authenticated user context is required")
  const fleet = await resolveFleetAccount(prisma, fleetId)
  if (String(fleet.status || "") !== "active") throw badRequest("Fleet account is not active")
  const vehicle = await resolveVehicle(prisma, { fleetAccountId: fleet.id, vehicleId })
  const member = await resolveMembership(prisma, { fleetAccountId: fleet.id, userId })
  if (!member?.id || String(member.status || "") !== "active" || String(member.role || "") !== "driver") {
    throw badRequest("You are not an active driver for this fleet")
  }
  const assignmentRows = await prisma.$queryRaw`
    SELECT id
    FROM fleet_vehicle_assignments
    WHERE fleet_account_id = ${fleet.id}
      AND vehicle_id = ${vehicle.id}
      AND user_id = ${userId}
      AND status = 'active'
    LIMIT 1
  `
  if (!assignmentRows?.[0]?.id) throw badRequest("You are not assigned to this fleet vehicle")

  const normalizedFuelType = normalizeFuelType(String(fuelType || "").toLowerCase() || vehicle.fuel_type)
  const vehicleFuelType = normalizeFuelType(vehicle.fuel_type)
  if (vehicleFuelType !== "mixed" && vehicleFuelType !== "unknown" && normalizedFuelType !== vehicleFuelType) {
    throw badRequest(`Vehicle requires ${vehicleFuelType}.`)
  }

  const rows = await prisma.$queryRaw`
    SELECT fr.*,
           fa.public_id AS fleet_public_id, fa.name AS fleet_name,
           fv.public_id AS vehicle_public_id, fv.plate_number, fv.vehicle_name, fv.fuel_type AS vehicle_fuel_type,
           st.public_id AS station_public_id, st.name AS station_name
    FROM fleet_fuel_requests fr
    INNER JOIN fleet_accounts fa ON fa.id = fr.fleet_account_id
    INNER JOIN fleet_vehicles fv ON fv.id = fr.vehicle_id
    LEFT JOIN stations st ON st.id = fr.station_id
    WHERE fr.fleet_account_id = ${fleet.id}
      AND fr.vehicle_id = ${vehicle.id}
      AND fr.requested_by_user_id = ${userId}
      AND fr.public_id = ${fuelRequestId}
    LIMIT 1
  `
  const request = rows?.[0] || null
  if (!request?.id) throw badRequest("Approved fleet fuel allocation not found")
  if (String(request.status || "") !== "approved") throw badRequest("Fleet fuel allocation is not approved")
  if (request.expires_at && new Date(request.expires_at).getTime() < Date.now()) {
    throw badRequest("Fleet fuel allocation has expired")
  }
  if (request.station_public_id && stationPublicId && String(request.station_public_id) !== String(stationPublicId)) {
    throw badRequest("Fleet fuel allocation is restricted to another station")
  }
  if (Number(request.requested_litres || 0) > 0 && Number(requestedLitres || 0) > Number(request.requested_litres)) {
    throw badRequest("Requested queue litres exceed the approved fleet allocation")
  }

  return {
    fleet: { publicId: request.fleet_public_id, name: request.fleet_name },
    vehicle: {
      publicId: request.vehicle_public_id,
      plateNumber: request.plate_number,
      vehicleName: request.vehicle_name,
      fuelType: request.vehicle_fuel_type,
    },
    fuelRequest: mapFuelRequestRow({
      ...request,
      driver_public_id: auth.userPublicId || null,
      driver_name: null,
      driver_email: null,
      driver_phone: null,
      vehicle_status: vehicle.status,
    }),
  }
}

export async function listDriverFuelHistory({ auth }) {
  const rows = await prisma.$queryRaw`
    SELECT ft.*,
           fv.public_id AS vehicle_public_id, fv.plate_number, fv.vehicle_name,
           u.public_id AS driver_public_id, u.full_name AS driver_name, u.email AS driver_email, u.phone_e164 AS driver_phone,
           st.public_id AS station_public_id, st.name AS station_name,
           fd.public_id AS department_public_id, fd.name AS department_name, fd.code AS department_code,
           fal.public_id AS allocation_public_id, fal.allocation_target_type,
           ffc.public_id AS fuel_card_public_id, ffc.card_label, ffc.masked_card_number,
           p.public_id AS pump_public_id, p.pump_number,
           pn.public_id AS nozzle_public_id, pn.nozzle_number,
           fr.public_id AS fuel_request_public_id
    FROM fleet_transactions ft
    INNER JOIN fleet_vehicles fv ON fv.id = ft.vehicle_id
    INNER JOIN users u ON u.id = ft.driver_user_id
    LEFT JOIN stations st ON st.id = ft.station_id
    LEFT JOIN fleet_departments fd ON fd.id = ft.department_id
    LEFT JOIN fleet_allocations fal ON fal.id = ft.allocation_id
    LEFT JOIN fleet_fuel_cards ffc ON ffc.id = ft.fuel_card_id
    LEFT JOIN pumps p ON p.id = ft.pump_id
    LEFT JOIN pump_nozzles pn ON pn.id = ft.nozzle_id
    LEFT JOIN fleet_fuel_requests fr ON fr.id = ft.fuel_request_id
    WHERE ft.driver_user_id = ${Number(auth.userId)}
    ORDER BY ft.created_at DESC
    LIMIT 50
  `
  return { items: (rows || []).map(mapTransactionRow) }
}
