import test from "node:test"
import assert from "node:assert/strict"
import { buildUssdActiveBookingText, resolveUssdDirectPrompt } from "../modules/assistant/service.js"

test("ussd direct prompt fallback honors the stored home menu", () => {
  const prompt = resolveUssdDirectPrompt("2", {
    menuOptions: [
      { kind: "menu", label: "Find fuel", menu: "fuel" },
      { kind: "prompt", label: "My booking", prompt: "Check my booking" },
      { kind: "prompt", label: "My balance", prompt: "Check wallet balance" },
      { kind: "menu", label: "Help", menu: "help" },
    ],
  })

  assert.equal(prompt, "Check my booking")
})

test("ussd direct prompt fallback still maps the default home menu when session options are missing", () => {
  assert.equal(resolveUssdDirectPrompt("1", {}), "Find fuel near me")
  assert.equal(resolveUssdDirectPrompt("4", {}), "Help")
})

test("ussd active booking text renders queue and reservation details", () => {
  const text = buildUssdActiveBookingText([
    {
      kind: "active_booking",
      bookingType: "queue",
      station: { name: "Area 18 Service Station" },
      fuelType: "PETROL",
      position: 3,
      carsAhead: 2,
      etaMinutes: 8,
      requestedLiters: 20,
      queueStatus: "WAITING",
    },
    {
      kind: "active_booking",
      bookingType: "reservation",
      station: { name: "Kanengo Fuel Hub" },
      fuelType: "DIESEL",
      litres: 40,
      identifier: "MH12AB1234",
      slotStart: "2026-04-28T10:00:00.000Z",
      slotEnd: "2026-04-28T11:00:00.000Z",
      expiresAt: "2026-04-28T09:30:00.000Z",
      reservationStatus: "CONFIRMED",
    },
  ])

  assert.match(text, /Active queue/i)
  assert.match(text, /Area 18 Service Station/)
  assert.match(text, /ETA: 8 min/)
  assert.match(text, /Active reservation/i)
  assert.match(text, /Kanengo Fuel Hub/)
  assert.match(text, /Ref: MH12AB1234/)
  assert.match(text, /Status: CONFIRMED/)
})
