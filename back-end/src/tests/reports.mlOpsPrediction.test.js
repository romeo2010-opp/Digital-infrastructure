import test from "node:test"
import assert from "node:assert/strict"
import {
  buildMlServiceUrl,
  callMlPrediction,
  normalizeFuelType,
} from "../modules/reports/mlOpsPrediction.service.js"

test("normalizeFuelType supports SmartLink fuel defaults", () => {
  assert.equal(normalizeFuelType("diesel"), "DIESEL")
  assert.equal(normalizeFuelType("PETROL"), "PETROL")
  assert.equal(normalizeFuelType("unknown"), "PETROL")
})

test("buildMlServiceUrl trims trailing slashes", () => {
  const previous = process.env.ML_SERVICE_URL
  process.env.ML_SERVICE_URL = "http://ml.test:8001/"

  try {
    assert.equal(buildMlServiceUrl("/predict"), "http://ml.test:8001/predict")
    assert.equal(buildMlServiceUrl("metadata"), "http://ml.test:8001/metadata")
  } finally {
    if (previous === undefined) {
      delete process.env.ML_SERVICE_URL
    } else {
      process.env.ML_SERVICE_URL = previous
    }
  }
})

test("callMlPrediction sends JSON payload to FastAPI service", async () => {
  const previous = process.env.ML_SERVICE_URL
  process.env.ML_SERVICE_URL = "http://ml.test:8001"
  const calls = []
  const payload = {
    station_id: "01J5SMARTLINKBLANTYRE00001",
    district: "Blantyre",
    fuel_type: "PETROL",
  }

  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    return {
      ok: true,
      status: 200,
      json: async () => ({ queue_length_30m: 21 }),
    }
  }

  try {
    const response = await callMlPrediction(payload, { fetchImpl, timeoutMs: 1000 })
    assert.deepEqual(response, { queue_length_30m: 21 })
    assert.equal(calls[0].url, "http://ml.test:8001/predict")
    assert.equal(calls[0].options.method, "POST")
    assert.equal(calls[0].options.headers["Content-Type"], "application/json")
    assert.deepEqual(JSON.parse(calls[0].options.body), payload)
  } finally {
    if (previous === undefined) {
      delete process.env.ML_SERVICE_URL
    } else {
      process.env.ML_SERVICE_URL = previous
    }
  }
})

test("callMlPrediction surfaces clean upstream errors", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 503,
    statusText: "Service Unavailable",
    json: async () => ({ detail: "training must run first" }),
  })

  await assert.rejects(
    () => callMlPrediction({}, { fetchImpl, timeoutMs: 1000 }),
    /training must run first/
  )
})
