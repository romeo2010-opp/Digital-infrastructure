#!/usr/bin/env node

const DEFAULT_API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000"
const DEFAULT_STATION_PUBLIC_ID = process.env.STATION_PUBLIC_ID || "SL-MW-LLWE-7882"
const DEFAULT_API_KEY = process.env.API_KEY || "change_me"

function parseArgs(argv) {
  const options = {}
  const positional = []

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (!value.startsWith("--")) {
      positional.push(value)
      continue
    }

    const [key, inlineValue] = value.slice(2).split("=", 2)
    if (inlineValue !== undefined) {
      options[key] = inlineValue
      continue
    }

    const nextValue = argv[index + 1]
    if (nextValue && !nextValue.startsWith("--")) {
      options[key] = nextValue
      index += 1
    } else {
      options[key] = "true"
    }
  }

  return {
    command: positional[0] || "help",
    options,
  }
}

function toPositiveNumber(value, fallback = null) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function toBooleanFlag(value) {
  const normalized = String(value || "").trim().toLowerCase()
  return ["1", "true", "yes", "on"].includes(normalized)
}

function printUsage() {
  console.log(`
Station Edge Simulator

Usage:
  node station-edge-simulator.mjs health
  node station-edge-simulator.mjs bindings --station STATION-001 --api-key key
  node station-edge-simulator.mjs simulate-flow --station STATION-001 --api-key key
  node station-edge-simulator.mjs simulate-fault --scenario fuel-stop
  node station-edge-simulator.mjs send-event --event-type FLOW_TIMEOUT --severity HIGH

Environment variables:
  API_BASE_URL       default: ${DEFAULT_API_BASE_URL}
  STATION_PUBLIC_ID  required unless --station is passed
  API_KEY            required unless --api-key is passed

Options:
  --station          station public id
  --api-base-url     backend base url
  --api-key          API key sent as x-api-key
  --pump             filter by pump public id
  --nozzle           filter by nozzle public id
  --session          explicit pump session public id
  --steps            number of FLOW_READING events for simulate-flow, default 5
  --increment        litres added per step, default 3
  --delay-ms         delay between events, default 750
  --start-litres     starting litres before the first flow reading, default 0
  --target-litres    target total litres to stop at; defaults to the binding requested litres when available
                     if the binding has no requested litres, pass --target-litres or explicit --steps/--increment
  --allow-target-override  allow a target above the requested litres when set to true
  --scenario         fault scenario for simulate-fault
                     fuel-stop | microcontroller-offline | telemetry-timeout | controller-error
  --event-type       event type for send-event
  --severity         severity for send-event, default HIGH
  --message          message for simulate-fault/send-event
  --error-code       raw error code for simulate-fault/send-event
  --flow-rate        explicit flow rate for send-event
  --gap-ms           wait time before timeout-style faults, default 12000
  --no-start         skip SESSION_STARTED before send-event
`)
}

function buildConfig(options) {
  const stationPublicId = String(options.station || DEFAULT_STATION_PUBLIC_ID).trim()
  const apiBaseUrl = String(options["api-base-url"] || DEFAULT_API_BASE_URL).trim().replace(/\/+$/, "")
  const apiKey = String(options["api-key"] || DEFAULT_API_KEY).trim()

  if (!stationPublicId) {
    throw new Error("Missing station public id. Pass --station or set STATION_PUBLIC_ID.")
  }
  if (!apiKey) {
    throw new Error("Missing API key. Pass --api-key or set API_KEY.")
  }

  return {
    stationPublicId,
    apiBaseUrl,
    apiKey,
  }
}

async function requestJson(url, { method = "GET", apiKey, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await response.text()
  const payload = text ? JSON.parse(text) : null
  if (!response.ok) {
    if (payload?.error === "Missing Bearer token") {
      throw new Error(
        "Backend returned 'Missing Bearer token'. The edge gateway route is probably not live yet, so restart/redeploy the backend with the new monitoring gateway routes."
      )
    }
    throw new Error(payload?.error || `Request failed with ${response.status}`)
  }

  return payload?.data ?? payload
}

async function fetchBindings(config) {
  return requestJson(
    `${config.apiBaseUrl}/api/stations/${encodeURIComponent(config.stationPublicId)}/edge/pump-session-bindings`,
    {
      apiKey: config.apiKey,
    }
  )
}

async function fetchHealth(config) {
  return requestJson(
    `${config.apiBaseUrl}/api/edge/health`,
    {
      apiKey: config.apiKey,
    }
  )
}

function pickBinding(payload, options) {
  const requestedSessionId = String(options.session || "").trim()
  const requestedPumpId = String(options.pump || "").trim()
  const requestedNozzleId = String(options.nozzle || "").trim()
  const bindings = Array.isArray(payload?.bindings) ? payload.bindings : []

  return bindings.find((binding) => {
    if (requestedSessionId && binding.pumpSessionPublicId !== requestedSessionId) return false
    if (requestedPumpId && binding.pumpPublicId !== requestedPumpId) return false
    if (requestedNozzleId && binding.nozzlePublicId !== requestedNozzleId) return false
    return true
  }) || null
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function sendTelemetry(config, binding, event) {
  return requestJson(
    `${config.apiBaseUrl}/api/stations/${encodeURIComponent(config.stationPublicId)}/edge/telemetry/events`,
    {
      method: "POST",
      apiKey: config.apiKey,
      body: {
        pumpId: binding.pumpPublicId,
        nozzleId: binding.nozzlePublicId,
        sessionPublicId: binding.pumpSessionPublicId,
        sessionReference: binding.sessionReference,
        telemetryCorrelationId: binding.telemetryCorrelationId,
        sourceType: "STATION_EDGE_SIMULATOR",
        ...event,
      },
    }
  )
}

function logTelemetryResult(prefix, result) {
  console.log(prefix, JSON.stringify(result.session), JSON.stringify(result.event))
}

async function resolveBinding(config, options) {
  const payload = await fetchBindings(config)
  const binding = pickBinding(payload, options)
  if (!binding) {
    throw new Error("No active edge binding matched the requested station/pump/nozzle/session.")
  }
  return binding
}

function resolveTargetLitres(options, binding, defaultIncrement) {
  const explicitTargetLitres = toPositiveNumber(options["target-litres"], null)
  const requestedLitres =
    toPositiveNumber(binding?.requestedLitres, null)
    ?? toPositiveNumber(binding?.requested_litres, null)
  const targetLitres = explicitTargetLitres ?? requestedLitres
  const allowTargetOverride = toBooleanFlag(options["allow-target-override"])

  if (
    explicitTargetLitres !== null
    && requestedLitres !== null
    && explicitTargetLitres > requestedLitres + 0.01
    && !allowTargetOverride
  ) {
    throw new Error(
      `Requested litres for this binding are ${requestedLitres}. Refusing to overshoot to ${explicitTargetLitres} without --allow-target-override true.`
    )
  }

  const startingLitres = Number(options["start-litres"] || 0) || 0
  const derivedSteps = targetLitres !== null
    ? Math.max(1, Math.ceil(Math.max(targetLitres - startingLitres, 0) / defaultIncrement))
    : null

  return {
    targetLitres,
    requestedLitres,
    derivedSteps,
  }
}

function resolveSteps(options, derivedSteps, fallbackSteps = 5) {
  const explicitSteps = toPositiveNumber(options.steps, null)
  if (derivedSteps !== null) {
    return Math.max(explicitSteps ?? derivedSteps, derivedSteps)
  }
  return explicitSteps ?? fallbackSteps
}

async function emitSessionStarted(config, binding, litresValue, message = "Simulator opened the nozzle.") {
  const result = await sendTelemetry(config, binding, {
    eventType: "SESSION_STARTED",
    message,
    happenedAt: new Date().toISOString(),
    litresValue,
  })
  logTelemetryResult("SESSION_STARTED", result)
  return result
}

async function emitFlowReadings(config, binding, {
  steps = 1,
  increment = 3,
  delayMs = 750,
  litresValue = 0,
  targetLitres = null,
  messagePrefix = "Simulator flow step",
  payload = {},
} = {}) {
  let nextLitresValue = Number(litresValue || 0) || 0
  const normalizedTargetLitres = toPositiveNumber(targetLitres, null)

  if (normalizedTargetLitres !== null && nextLitresValue >= normalizedTargetLitres) {
    return nextLitresValue
  }

  for (let step = 1; step <= steps; step += 1) {
    const remainingLitres =
      normalizedTargetLitres !== null
        ? Number((normalizedTargetLitres - nextLitresValue).toFixed(3))
        : null
    const stepIncrement =
      remainingLitres !== null
        ? Math.min(increment, Math.max(remainingLitres, 0))
        : increment

    if (!(stepIncrement > 0)) {
      break
    }

    nextLitresValue = Number((nextLitresValue + stepIncrement).toFixed(3))
    const result = await sendTelemetry(config, binding, {
      eventType: "FLOW_READING",
      message: `${messagePrefix} ${step}`,
      happenedAt: new Date().toISOString(),
      litresValue: nextLitresValue,
      flowRate: stepIncrement,
      payload: {
        step,
        targetLitres: normalizedTargetLitres,
        ...payload,
      },
    })
    logTelemetryResult(`FLOW_READING step=${step} litres=${nextLitresValue}`, result)
    if (normalizedTargetLitres !== null && nextLitresValue >= normalizedTargetLitres) {
      break
    }
    if (step < steps) {
      await sleep(delayMs)
    }
  }

  return nextLitresValue
}

async function emitStop(config, binding, litresValue, message = "Simulator stopped dispensing.") {
  const result = await sendTelemetry(config, binding, {
    eventType: "DISPENSING_STOPPED",
    message,
    happenedAt: new Date().toISOString(),
    litresValue,
  })
  logTelemetryResult("DISPENSING_STOPPED", result)
  return result
}

async function runBindings(config) {
  const payload = await fetchBindings(config)
  console.log(JSON.stringify(payload, null, 2))
}

async function runHealth(config) {
  const payload = await fetchHealth(config)
  console.log(JSON.stringify(payload, null, 2))
}

async function runSimulateFlow(config, options) {
  const binding = await resolveBinding(config, options)

  const increment = toPositiveNumber(options.increment, 3)
  const { targetLitres, requestedLitres, derivedSteps } = resolveTargetLitres(options, binding, increment)
  const steps = resolveSteps(options, derivedSteps, 5)
  const delayMs = toPositiveNumber(options["delay-ms"], 750)
  let litresValue = Number(options["start-litres"] || 0) || 0

  if (targetLitres === null && options.steps === undefined) {
    throw new Error(
      "The matched binding does not expose requested litres, so the simulator cannot infer the stop point. Pass --target-litres <litres> or explicit --steps/--increment."
    )
  }

  console.log(`Using binding ${binding.pumpSessionPublicId} on ${binding.pumpPublicId}/${binding.nozzlePublicId}`)
  if (requestedLitres !== null) {
    console.log(`Requested litres: ${requestedLitres}`)
  } else {
    console.log("Requested litres: unavailable on binding payload")
  }
  if (targetLitres !== null) {
    console.log(`Target litres: ${targetLitres}`)
  }

  await emitSessionStarted(config, binding, litresValue)
  litresValue = await emitFlowReadings(config, binding, {
    steps,
    increment,
    delayMs,
    litresValue,
    targetLitres,
  })
  await emitStop(config, binding, litresValue)
}

function resolveFaultScenario(value) {
  const scenario = String(value || "").trim().toLowerCase()
  if (scenario === "fuel-stop") return "fuel-stop"
  if (scenario === "microcontroller-offline") return "microcontroller-offline"
  if (scenario === "telemetry-timeout") return "telemetry-timeout"
  if (scenario === "controller-error") return "controller-error"
  throw new Error(
    "Unknown fault scenario. Use one of: fuel-stop, microcontroller-offline, telemetry-timeout, controller-error."
  )
}

async function runSimulateFault(config, options) {
  const binding = await resolveBinding(config, options)
  const scenario = resolveFaultScenario(options.scenario)
  const increment = toPositiveNumber(options.increment, 2)
  const { targetLitres, requestedLitres, derivedSteps } = resolveTargetLitres(options, binding, increment)
  const steps = resolveSteps(options, derivedSteps, 2)
  const delayMs = toPositiveNumber(options["delay-ms"], 750)
  const gapMs = toPositiveNumber(options["gap-ms"], 12000)
  let litresValue = Number(options["start-litres"] || 0) || 0

  if (targetLitres === null && options.steps === undefined && scenario !== "controller-error") {
    throw new Error(
      "The matched binding does not expose requested litres, so the fault simulator cannot infer the stop point. Pass --target-litres <litres> or explicit --steps/--increment."
    )
  }

  console.log(`Using binding ${binding.pumpSessionPublicId} on ${binding.pumpPublicId}/${binding.nozzlePublicId}`)
  console.log(`Fault scenario: ${scenario}`)
  if (requestedLitres !== null) {
    console.log(`Requested litres: ${requestedLitres}`)
  } else {
    console.log("Requested litres: unavailable on binding payload")
  }
  if (targetLitres !== null) {
    console.log(`Target litres: ${targetLitres}`)
  }

  await emitSessionStarted(config, binding, litresValue, "Simulator started a session for fault testing.")

  if (scenario !== "controller-error") {
    litresValue = await emitFlowReadings(config, binding, {
      steps,
      increment,
      delayMs,
      litresValue,
      targetLitres,
      messagePrefix: `Fault scenario ${scenario} flow step`,
      payload: {
        scenario,
      },
    })
  }

  if (scenario === "fuel-stop") {
    const result = await sendTelemetry(config, binding, {
      eventType: "FLOW_TIMEOUT",
      severity: "HIGH",
      rawErrorCode: String(options["error-code"] || "").trim() || "FUEL_FLOW_INTERRUPTED",
      message: String(options.message || "").trim() || "Fuel stopped flowing unexpectedly during dispensing.",
      happenedAt: new Date().toISOString(),
      litresValue,
      payload: {
        scenario,
        recoverable: true,
        microcontrollerOnline: true,
        lastStableLitres: litresValue,
      },
    })
    logTelemetryResult("FLOW_TIMEOUT", result)
    return
  }

  if (scenario === "microcontroller-offline") {
    const result = await sendTelemetry(config, binding, {
      eventType: "CONTROLLER_ERROR",
      severity: "CRITICAL",
      rawErrorCode: String(options["error-code"] || "").trim() || "MICROCONTROLLER_OFFLINE",
      message:
        String(options.message || "").trim()
        || "Station edge lost contact with the pump microcontroller during dispensing.",
      happenedAt: new Date().toISOString(),
      litresValue,
      payload: {
        scenario,
        microcontrollerOnline: false,
        networkConnected: false,
        lastStableLitres: litresValue,
      },
    })
    logTelemetryResult("CONTROLLER_ERROR", result)
    return
  }

  if (scenario === "telemetry-timeout") {
    console.log(`Waiting ${gapMs}ms without telemetry to simulate an upstream outage...`)
    await sleep(gapMs)
    const result = await sendTelemetry(config, binding, {
      eventType: "TIMEOUT",
      severity: "HIGH",
      rawErrorCode: String(options["error-code"] || "").trim() || "TELEMETRY_TIMEOUT",
      message:
        String(options.message || "").trim()
        || "Telemetry updates stopped arriving before dispensing could be completed.",
      happenedAt: new Date().toISOString(),
      litresValue,
      payload: {
        scenario,
        gapMs,
        telemetryResumed: false,
        lastStableLitres: litresValue,
      },
    })
    logTelemetryResult("TIMEOUT", result)
    return
  }

  if (scenario === "controller-error") {
    const result = await sendTelemetry(config, binding, {
      eventType: "ERROR",
      severity: "CRITICAL",
      rawErrorCode: String(options["error-code"] || "").trim() || "PUMP_CONTROLLER_FAULT",
      message:
        String(options.message || "").trim()
        || "Pump controller reported a critical hardware fault before flow started.",
      happenedAt: new Date().toISOString(),
      litresValue,
      payload: {
        scenario,
        hardwareHealthy: false,
        lastStableLitres: litresValue,
      },
    })
    logTelemetryResult("ERROR", result)
  }
}

async function runSendEvent(config, options) {
  const binding = await resolveBinding(config, options)
  const eventType = String(options["event-type"] || "").trim()
  if (!eventType) {
    throw new Error("send-event requires --event-type.")
  }

  const shouldStart = String(options["no-start"] || "").trim().toLowerCase() !== "true"
  const litresValue = Number(options["start-litres"] || 0) || 0
  if (shouldStart) {
    await emitSessionStarted(config, binding, litresValue, "Simulator started a session for a custom event.")
  }

  const result = await sendTelemetry(config, binding, {
    eventType,
    severity: String(options.severity || "").trim().toUpperCase() || "HIGH",
    rawErrorCode: String(options["error-code"] || "").trim() || null,
    message: String(options.message || "").trim() || `Simulator sent ${eventType}.`,
    happenedAt: new Date().toISOString(),
    litresValue,
    flowRate: toPositiveNumber(options["flow-rate"], null),
    payload: {
      source: "custom-event",
    },
  })
  logTelemetryResult(eventType, result)
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2))
  if (command === "help" || command === "--help" || command === "-h") {
    printUsage()
    return
  }

  const config = buildConfig(options)

  if (command === "bindings") {
    await runBindings(config)
    return
  }

  if (command === "health") {
    await runHealth(config)
    return
  }

  if (command === "simulate-flow") {
    await runSimulateFlow(config, options)
    return
  }

  if (command === "simulate-fault") {
    await runSimulateFault(config, options)
    return
  }

  if (command === "send-event") {
    await runSendEvent(config, options)
    return
  }

  throw new Error(`Unknown command: ${command}`)
}

main().catch((error) => {
  console.error(error?.message || error)
  process.exitCode = 1
})
