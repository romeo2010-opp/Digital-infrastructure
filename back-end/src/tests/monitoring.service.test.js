import test from "node:test"
import assert from "node:assert/strict"
import {
  canFallbackToScopedPumpSessionLookup,
  derivePumpSessionStatusFromTelemetryEvent,
  derivePumpDbStatusFromNozzles,
  derivePumpMonitoringStatus,
  monitoringStatusToNozzleDbStatus,
  normalizeMonitoringLitres,
  normalizeMonitoringStatus,
  resolvePumpSessionTelemetryCorrelationId,
  normalizeTelemetryEventType,
  normalizeTelemetrySeverity,
  normalizeTelemetrySourceType,
  resolveTelemetryLitresValue,
  shouldCreateDispensingTransaction,
} from "../modules/monitoring/monitoring.service.js"

test("normalizeMonitoringStatus maps persisted nozzle states to live monitoring states", () => {
  assert.equal(normalizeMonitoringStatus("DISPENSING"), "DISPENSING")
  assert.equal(normalizeMonitoringStatus("ACTIVE"), "IDLE")
  assert.equal(normalizeMonitoringStatus("PAUSED"), "IDLE")
  assert.equal(normalizeMonitoringStatus("OFFLINE"), "OFFLINE")
  assert.equal(normalizeMonitoringStatus("unknown"), "IDLE")
})

test("normalizeMonitoringLitres only keeps litres while dispensing", () => {
  assert.equal(normalizeMonitoringLitres("IDLE", 12.4), null)
  assert.equal(normalizeMonitoringLitres("OFFLINE", 5), null)
  assert.equal(normalizeMonitoringLitres("DISPENSING", 0), 0)
  assert.equal(normalizeMonitoringLitres("DISPENSING", 12.345), 12.345)
  assert.equal(normalizeMonitoringLitres("DISPENSING", -1), null)
  assert.equal(normalizeMonitoringLitres("DISPENSING", "abc"), null)
})

test("telemetry helpers normalize event metadata for hardware ingest", () => {
  assert.equal(normalizeTelemetryEventType("dispensing started"), "DISPENSING_STARTED")
  assert.equal(normalizeTelemetryEventType(" flow-reading "), "FLOW_READING")
  assert.equal(normalizeTelemetrySeverity("high"), "HIGH")
  assert.equal(normalizeTelemetrySeverity("weird"), "INFO")
  assert.equal(normalizeTelemetrySourceType("edge gateway"), "EDGE_GATEWAY")
  assert.equal(normalizeTelemetrySourceType(""), "PUMP_CONTROLLER")
})

test("telemetry events map cleanly onto pump session states", () => {
  assert.equal(derivePumpSessionStatusFromTelemetryEvent("NOZZLE_LIFTED"), "STARTED")
  assert.equal(derivePumpSessionStatusFromTelemetryEvent("DISPENSING_STARTED"), "DISPENSING")
  assert.equal(derivePumpSessionStatusFromTelemetryEvent("FLOW_READING"), "DISPENSING")
  assert.equal(derivePumpSessionStatusFromTelemetryEvent("DISPENSING_STOPPED"), "COMPLETED")
  assert.equal(derivePumpSessionStatusFromTelemetryEvent("TIMEOUT"), "FAILED")
})

test("telemetry correlation ID is preserved, adopted, or generated for pump sessions", () => {
  assert.equal(
    resolvePumpSessionTelemetryCorrelationId({
      sessionTelemetryCorrelationId: "TEL-SESSION-001",
      telemetryCorrelationId: "TEL-INCOMING-002",
    }),
    "TEL-SESSION-001"
  )
  assert.equal(
    resolvePumpSessionTelemetryCorrelationId({
      sessionTelemetryCorrelationId: "",
      telemetryCorrelationId: "TEL-INCOMING-002",
    }),
    "TEL-INCOMING-002"
  )
  assert.match(
    resolvePumpSessionTelemetryCorrelationId({
      sessionTelemetryCorrelationId: "",
      telemetryCorrelationId: "",
    }),
    /^TEL-/
  )
})

test("pump session scope fallback stays enabled when only telemetry correlation is provided", () => {
  assert.equal(
    canFallbackToScopedPumpSessionLookup({
      sessionPublicId: "",
      sessionReference: "",
    }),
    true
  )
  assert.equal(
    canFallbackToScopedPumpSessionLookup({
      sessionPublicId: "",
      sessionReference: "PS-STRICT-001",
    }),
    false
  )
  assert.equal(
    canFallbackToScopedPumpSessionLookup({
      sessionPublicId: "01PUMPSESSIONSTRICT0000001",
      sessionReference: "",
    }),
    false
  )
})

test("telemetry litres value accepts stop-event aliases from edge payloads", () => {
  assert.equal(
    resolveTelemetryLitresValue({
      dispensedLitres: 15,
    }),
    15
  )
  assert.equal(
    resolveTelemetryLitresValue({
      payload: { dispensedLitres: 18.5 },
    }),
    18.5
  )
  assert.equal(
    resolveTelemetryLitresValue({
      payload: { litresValue: 22 },
    }),
    22
  )
})

test("derivePumpMonitoringStatus prioritizes DISPENSING and handles offline states", () => {
  assert.equal(derivePumpMonitoringStatus([]), "OFFLINE")
  assert.equal(derivePumpMonitoringStatus([{ status: "OFFLINE" }, { status: "OFFLINE" }]), "OFFLINE")
  assert.equal(derivePumpMonitoringStatus([{ status: "IDLE" }, { status: "OFFLINE" }]), "IDLE")
  assert.equal(derivePumpMonitoringStatus([{ status: "DISPENSING" }, { status: "OFFLINE" }]), "DISPENSING")
})

test("monitoringStatusToNozzleDbStatus maps live states to persisted nozzle states", () => {
  assert.equal(monitoringStatusToNozzleDbStatus("DISPENSING"), "DISPENSING")
  assert.equal(monitoringStatusToNozzleDbStatus("OFFLINE"), "OFFLINE")
  assert.equal(monitoringStatusToNozzleDbStatus("IDLE"), "ACTIVE")
})

test("derivePumpDbStatusFromNozzles keeps pump ACTIVE unless all nozzles are OFFLINE", () => {
  assert.equal(derivePumpDbStatusFromNozzles([]), "OFFLINE")
  assert.equal(derivePumpDbStatusFromNozzles([{ status: "OFFLINE" }, { status: "OFFLINE" }]), "OFFLINE")
  assert.equal(derivePumpDbStatusFromNozzles([{ status: "IDLE" }, { status: "OFFLINE" }]), "ACTIVE")
  assert.equal(derivePumpDbStatusFromNozzles([{ status: "DISPENSING" }, { status: "OFFLINE" }]), "ACTIVE")
})

test("shouldCreateDispensingTransaction only fires on transition into DISPENSING with positive litres", () => {
  assert.equal(
    shouldCreateDispensingTransaction({
      previousStatus: "IDLE",
      nextStatus: "DISPENSING",
      litres: 12.5,
    }),
    true
  )
  assert.equal(
    shouldCreateDispensingTransaction({
      previousStatus: "DISPENSING",
      nextStatus: "DISPENSING",
      litres: 18,
    }),
    false
  )
  assert.equal(
    shouldCreateDispensingTransaction({
      previousStatus: "IDLE",
      nextStatus: "IDLE",
      litres: 18,
    }),
    false
  )
  assert.equal(
    shouldCreateDispensingTransaction({
      previousStatus: "IDLE",
      nextStatus: "DISPENSING",
      litres: 0,
    }),
    false
  )
})
