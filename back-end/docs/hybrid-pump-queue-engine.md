
# Hybrid Pump Queue Engine

## Architecture Overview

The hybrid pilot queue engine lives in `src/modules/queue/hybrid/` and stays framework-agnostic:

- `domain.js`
  Defines explicit enums, JSDoc entity types, and shared helpers for pumps, jobs, lane commitments, scoring order, and kiosk status shaping.
- `hybridPumpPolicy.js`
  Encapsulates compatibility rules, digital-readiness eligibility, hold timeout configuration, and priority scoring.
- `readinessService.js`
  Accepts only real on-site readiness signals such as attendant confirmation, QR scan, BLE/NFC, and geofence confirmation.
- `walkInRoutingService.js`
  Routes new walk-ins while respecting `DIGITAL_HOLD` and ready digital demand on the pilot pump.
- `pumpDispatcher.js`
  Applies the pilot-pump hold/call/release logic, including timeout expiry and safe offline handling.
- `queueEngine.js`
  Orchestrates the services, mutates queue state immutably, manages lane commitments, and produces kiosk-facing state.

## Suggested Backend Wiring

Use the engine as a pure domain service inside queue or attendant routes:

1. Load the current station snapshot:
   - pumps
   - active queue jobs
   - active lane commitments
2. Instantiate one shared `QueueEngine` with station or tenant config:
   - `digitalHoldTimeoutMs`
   - kiosk redirect message
   - priority weights if needed
3. Call the engine method that matches the event:
   - digital arrival signal: `applyReadinessSignal(...)`
   - pilot pump state evaluation: `dispatchPilotPump(...)`
   - walk-in arrival: `routeWalkIn(...)`
   - forecourt commitment: `markLaneCommitted(...)`
   - fueling start: `startFueling(...)`
   - fueling complete: `completeFueling(...)`
   - periodic timeout tick: `processTimeouts(...)`
   - pump offline event: `handlePumpOffline(...)`
4. Persist the returned pump/job/commitment state back to storage.
5. Publish `kioskState` over your station realtime channel after pilot dispatch, timeout, or offline transitions.

## Suggested Kiosk UI Wiring

Render directly from `queueEngine.buildKioskState(...)` or the `kioskState` returned by pilot dispatch methods:

- `pilotPumpMode`
- `pilotPumpState`
- `digitalHoldActive`
- `committedCarsAhead`
- `currentNextAssignmentTarget`
- `walkInRedirectMessage`
- `digitalUserStatuses`

Recommended kiosk copy during hold:

`Pilot pump reserved for next ready SmartLink user. Please use another pump.`

## API Boundary Notes

- Keep `READY_ON_SITE` separate from queue join. Remote joins alone must stay `WAITING`.
- Persist `LaneCommitment` rows whenever a vehicle is physically committed to the pilot lane.
- Do not delete or reshuffle active lane commitments when digital hold activates.
- Let timeout or offline events release the hold; do not force-release committed walk-ins already in lane.

node station-edge-simulator.mjs bindings
node station-edge-simulator.mjs simulate-flow
node station-edge-simulator.mjs simulate-flow --target-litres 22
node station-edge-simulator.mjs simulate-fault --scenario fuel-stop --target-litres 18
