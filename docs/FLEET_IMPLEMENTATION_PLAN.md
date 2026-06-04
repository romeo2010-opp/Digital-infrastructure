# Fleet Accounts Implementation Plan

## Repository Study Summary

SmartLink is a multi-app workspace:

- `back-end/`: Express API, Prisma client, MySQL/MariaDB schema, SQL migrations, route modules, middleware, realtime hubs, and Node test files.
- `front-end/`: station manager dashboard. It has station-scoped auth and must remain station-only.
- `user-front-end/`: driver/user app with mobile and desktop shells, existing SmartLink auth usage, wallet, queue, reservations, stations, alerts, and public marketing pages.
- `internal/`: internal/admin dashboard using separate internal routes and permissions.
- `mera/`: MERA regulator portal using its own auth/routes and UI components.
- `smartlink-kiosk/`: kiosk/attendant-focused UI.

The backend uses:

- `back-end/src/app.js` for route registration.
- `back-end/src/middleware/requireAuth.js` for JWT session validation.
- `back-end/src/modules/*` for domain route/service code.
- `back-end/sql/*.sql` for additive migrations and seeds.
- `back-end/prisma/schema.prisma` for the Prisma client schema.
- API responses shaped as `{ ok: true, data }` through `ok(res, data)`, and `{ ok: false, error }` through shared error middleware.

Existing workflows to preserve:

- User app auth, wallet, queue, reservations, station discovery, alerts, and Scan & Go.
- Station manager dashboard auth and station-scoped workflows.
- MERA regulator dashboard and `/api/mera/*`.
- Internal/admin dashboard and `/api/internal/*`.
- Kiosk workflows and kiosk auth/session handling.

## Files Added

- `docs/FLEET_IMPLEMENTATION_PLAN.md`
- `docs/FLEET_PENDING_INTEGRATIONS.md`
- `docs/FLEET_QA_CHECKLIST.md`
- `back-end/sql/070_fleet_accounts.sql`
- `back-end/sql/071_seed_fleet_demo.sql`
- `back-end/sql/072_fleet_financial_ops.sql`
- `back-end/src/modules/fleet/routes.js`
- `back-end/src/modules/fleet/service.js`
- `back-end/src/modules/fleet/schemas.js`
- `back-end/src/modules/fleet/permissions.js`
- `back-end/src/modules/fleet/reports.js`
- `back-end/src/tests/fleet.permissions.test.js`
- `back-end/src/tests/fleet.policy.test.js`
- `user-front-end/src/mobile/api/fleetApi.js`
- `user-front-end/src/features/fleet/FleetApp.jsx`
- `user-front-end/src/features/fleet/FleetDashboard.jsx`
- `user-front-end/src/features/fleet/FleetDriverMode.jsx`
- `user-front-end/src/features/fleet/fleet.css`

## Files Modified

- `back-end/src/app.js`: register fleet routes under protected `/api`.
- `back-end/prisma/schema.prisma`: add fleet models/enums for the new SQL tables.
- `user-front-end/src/mobile/screens/AlertsScreen.jsx`: existing SmartLink users can accept fleet invitations from app alerts.
- `user-front-end/src/App.jsx`: route `/fleet/*` to the fleet workspace and `/m/fleet` to driver mode.
- `user-front-end/src/desktop/DesktopApp.jsx`: route `/d/fleet` to driver mode.
- `user-front-end/src/desktop/desktopNav.jsx`: add Fleet Mode entry.
- `user-front-end/src/mobile/screens/MoreScreen.jsx`: add Fleet Mode quick access.

## Files That Must Not Be Touched

- `front-end/src/auth/AuthContext.jsx`: station staff auth guard remains station-only.
- MERA behavior under `mera/*` and `/api/mera/*`.
- Internal/admin behavior under `internal/*` and `/api/internal/*`.
- Kiosk auth/session behavior.
- Existing wallet, queue, reservation, station, login, register, logout API contracts.

## Integration Approach

Fleet users remain normal SmartLink users with JWT role `USER`. Fleet authorization is enforced on the backend by `fleet_members` role/status checks:

- Manager dashboard roles: `owner`, `admin`, `finance`, `dispatcher`, `auditor`.
- Driver-only users are denied manager dashboard access and sent to Fleet Driver Mode.
- Permissions are never trusted from the frontend.

Fleet wallet is intentionally separate from personal user wallets:

- Existing `wallets`, user wallet APIs, queue prepay, reservations, and Scan & Go remain unchanged.
- Fleet wallet uses `fleet_wallets` and `fleet_wallet_transactions`.
- Manual top-ups are recorded as pending integration records unless a real payment provider is later connected.
- Approvals can reserve funds; completed fleet transactions debit the fleet wallet and preserve history.
- Financial operations metrics use DB-backed `fleet_budgets`, `fleet_invoices`, `fleet_maintenance_records`, `fleet_route_activity`, and `fleet_vehicle_live_states` records plus existing fleet transactions.
- Fleet invitations can target existing users by SmartLink ID, email, or phone; matched users receive in-app alerts and accept through the existing user app notification flow.

The manager UI lives in `user-front-end` at `/fleet/*` because it already accepts normal SmartLink user sessions. This avoids changing station dashboard assumptions.

## Preservation Rules

- Additive SQL only; no renames or destructive data migrations.
- Driver and vehicle removal updates status instead of deleting records.
- Historical fleet transactions, fuel requests, and audit logs remain queryable.
- Existing station/MERA/internal/kiosk route registration remains unchanged except for adding the new fleet route module.

## Fleet Management V2 Additive Plan

Fleet V2 extends the existing `070`-`074` work. It does not replace Fleet v1 auth, wallet, invitations, dashboard access, or existing user/station/MERA/internal workflows.

### Files To Add

- `docs/design-reference/fleet-dashboard-reference.png`: visual source of truth for the Fleet Manager overview.
- `docs/FLEET_MYFUEL_INTEGRATION_NOTES.md`: manual MyFuel handling now and future adapter/API requirements.
- `back-end/sql/075_fleet_allocations_cards_departments.sql`: departments, allocations, fuel-now sessions, manual fuel cards, imports, and reconciliation tables.
- `back-end/sql/076_seed_fleet_management_demo.sql`: safe development records for Mbeya/Blantyre demo departments, allocations, manual MyFuel cards, fuel-now sessions, and reconciliation examples.

### Files To Modify

- `back-end/prisma/schema.prisma`: mapped Prisma models/enums for V2 tables and nullable V2 columns.
- `back-end/src/modules/fleet/permissions.js`: add server-side permissions for departments, allocations, fuel cards, and fuel-now operations.
- `back-end/src/modules/fleet/schemas.js`: Zod schemas for department, allocation, rollover, fuel-now, fuel-card, import, and reconciliation APIs.
- `back-end/src/modules/fleet/routes.js`: add V2 routes under existing authenticated `/api/fleet`.
- `back-end/src/modules/fleet/service.js`: add V2 service functions, atomic fuel-now validation/session/complete logic, allocation rollover math, manual card reconciliation, and reference dashboard payload.
- `user-front-end/src/mobile/api/fleetApi.js`: add client methods for V2 endpoints.
- `user-front-end/src/features/fleet/FleetApp.jsx`: route `/fleet/dashboard` to `/fleet/dashboard/overview` and map each sidebar route.
- `user-front-end/src/features/fleet/FleetDashboard.jsx`: redesign the manager dashboard to match the navy/blue financial-grade reference.
- `user-front-end/src/features/fleet/FleetDriverMode.jsx`: add explicit Personal Wallet vs Fleet Account flow, allocation-backed `Fuel Now`, and `Request Extra Fuel` exception path.
- `user-front-end/src/features/fleet/fleet.css`: add scoped `.fleet-v2-*` styles only for the Fleet workspace.

### Files Not To Touch

- `front-end/src/auth/AuthContext.jsx` and station auth assumptions.
- Existing MERA behavior under `mera/*` and `/api/mera/*`.
- Existing internal/admin behavior under `internal/*` and `/api/internal/*`.
- Existing user personal wallet, queue, reservation, login/register/logout, kiosk, and station availability contracts.

### Fleet V2 Database Additions

- New tables: `fleet_departments`, `fleet_allocations`, `fleet_allocation_transactions`, `fleet_allocation_rollovers`, `fleet_fueling_sessions`, `fleet_fuel_card_providers`, `fleet_fuel_cards`, `fleet_fuel_card_imports`, `fleet_fuel_card_transactions`, and `fleet_fuel_card_reconciliation_matches`.
- Add nullable V2 columns to existing fleet records only: member/vehicle department links, approved request amounts, allocation/card/payment context on transactions, km/cost efficiency fields, and maintenance interval fields.
- `fleet_transactions.station_id` becomes nullable so manual card and reconciliation records can exist without a SmartLink station match.
- Financial and operational records remain soft-statused; no destructive deletes are introduced.

### Fleet V2 API Additions

- Departments: list/create/update/archive.
- Allocations: list/create/update/adjustments/usage summary/rollover preview/rollover execute.
- Fuel Now: driver eligibility validation, driver session creation, manager/station completion.
- Fuel Cards: providers, manual cards, statement import placeholders, reconciliation list, match, and flag.
- Dashboard/report payloads: reference overview KPIs, allocation donut, spend trend, allocation summary, upcoming exception fuel requests, alerts, recent transactions, allocation reports, and fuel card reconciliation reports.

### Fuel Allocation Model

Normal fleet fueling is allocation-backed. Fuel requests are for exceptions:

- `top_up_to_cap`: next period top-up equals cap minus remaining balance.
- `reset_no_carryover`: remaining balance is cleared and reset to cap.
- `carryover_with_cap`: unused allocation carries forward up to the configured max cap.
- `manual_review`: rollover is calculated but not executed automatically.

Fuel Now validates active fleet, active membership, assignment, active vehicle, odometer, fuel type, allocation availability, policy checks, and payment source before creating or completing any fleet transaction.

### MyFuel Handling

MyFuel is implemented as manual tracking in V2:

- Providers can be registered with `supports_api = false`.
- Cards show `provider_status = api_not_connected` or `manual_tracking`.
- Manual card transactions and statement-import placeholders can be reconciled to SmartLink fleet transactions.
- No fake MyFuel balance, top-up, limit-sync, or webhook behavior is implemented without real provider credentials/API documentation.
