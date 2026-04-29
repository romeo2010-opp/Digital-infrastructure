import test from "node:test"
import assert from "node:assert/strict"
import {
  buildVoiceUpdateScript,
  normalizeLiveUpdateLanguage,
  shouldDispatchQueueLiveUpdate,
} from "../modules/assistant/live-updates.service.js"

test("live update language normalization supports english and chichewa", () => {
  assert.equal(normalizeLiveUpdateLanguage("English"), "en")
  assert.equal(normalizeLiveUpdateLanguage("chichewa"), "ny")
  assert.equal(normalizeLiveUpdateLanguage("unknown"), "en")
})

test("voice update script includes position change, music, and station escalation cues", () => {
  const script = buildVoiceUpdateScript({
    languageCode: "en",
    previousPosition: 6,
    snapshot: {
      queueStatus: "WAITING",
      position: 4,
      etaMinutes: 9,
      fuelType: "PETROL",
      station: {
        name: "Area 18 Service Station",
      },
    },
  })

  assert.match(script.previewText, /position 4/i)
  assert.match(script.previewText, /Area 18 Service Station/)
  assert.equal(script.shouldPlayMusic, true)
  assert.equal(script.shouldCallToStation, true)
})

test("live update dispatching reacts to queue movement and status changes", () => {
  assert.equal(
    shouldDispatchQueueLiveUpdate(
      {
        notifyOnPositionChange: true,
        lastKnownPosition: 5,
        lastKnownStatus: "WAITING",
        callWhenPositionReached: 4,
      },
      {
        queueStatus: "WAITING",
        position: 4,
      }
    ),
    true
  )

  assert.equal(
    shouldDispatchQueueLiveUpdate(
      {
        notifyOnPositionChange: true,
        lastKnownPosition: 4,
        lastKnownStatus: "WAITING",
        callWhenPositionReached: 4,
      },
      {
        queueStatus: "WAITING",
        position: 4,
      }
    ),
    false
  )

  assert.equal(
    shouldDispatchQueueLiveUpdate(
      {
        notifyOnPositionChange: true,
        lastKnownPosition: 2,
        lastKnownStatus: "WAITING",
        callWhenPositionReached: 4,
      },
      {
        queueStatus: "CALLED",
        position: 2,
      }
    ),
    true
  )
})
