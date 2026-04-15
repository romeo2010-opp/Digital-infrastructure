# Migration Notes: Pump/Nozzle Refactor

## What Changed
- `pumps` is now the dispenser/group container.
- New table: `pump_nozzles` (atomic dispensing endpoints).
- `pumps.fuel_type_id` is nullable for group-only pumps.
- `transactions` now supports `nozzle_id` (FK to `pump_nozzles.id`).
- `pump_dispense_events` now supports `nozzle_id` (FK to `pump_nozzles.id`).

## Backward Compatibility
- Legacy flows that only send `pumpPublicId` still work.
- Server auto-maps legacy pump transactions to nozzle `#1` and records compatibility warning metadata.
- For stations with old pump-only rows, nozzle `#1` is auto-created idempotently.

## Required DB Patch Order
1. Apply `back-end/sql/schema.sql` for fresh environments.
2. Existing environments: run `back-end/sql/002_add_missing_columns_indexes.sql`.
3. Optional realistic seed: run `back-end/sql/010_seed_realistic.sql`.

## Station Configuration Guide
- Add a dispenser group (`pumpNumber`) first.
- Add nozzles under that dispenser:
  - Common Malawi setup:
    - `MALAWI_2_NOZZLES`: 1 petrol + 1 diesel
    - `MALAWI_4_NOZZLES`: 2 petrol + 2 diesel
- Every nozzle should have:
  - `fuelType` (required)
  - `tankPublicId` (recommended; required by policy in production ops)
  - `nozzleNumber` unique within pump

## Data Integrity Command
Run:

```bash
npm run integrity:nozzles
```

Optional scoped checks:

```bash
node src/scripts/nozzleIntegrityCheck.js --stationPublicId <stationPublicId>
node src/scripts/nozzleIntegrityCheck.js --stationId <numericStationId>
```

The command:
- finds pumps with zero nozzles
- finds nozzles without tank mapping
- backfills transactions where `pump_id` exists and `nozzle_id` is null

## Safe Defaults for Ambiguous Legacy Behavior
- Transaction fuel/tank attribution prefers nozzle mapping.
- If a transaction has no nozzle mapping, system falls back to pump legacy mapping and flags the transaction path as compatibility mode.
- Reports continue rendering when nozzle/tank mappings are incomplete and surface explicit warnings in exceptions output.
