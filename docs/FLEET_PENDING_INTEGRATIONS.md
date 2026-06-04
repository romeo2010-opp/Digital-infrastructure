# Fleet Pending Integrations

## Payment Provider

Fleet wallet top-ups currently create manual pending records. They do not mark funds as completed until a real mobile-money, bank, or finance approval workflow is connected.

## Invitation Delivery

Fleet invitations are stored in the database and existing SmartLink users now receive in-app alerts when matched by SmartLink ID, email, or phone. Managers can view pending invites, resend in-app notifications for matched users, and cancel pending invitations. SMS/email delivery is still pending SMTP/SMS integration for fleet-specific invitation messages.

## PDF Reports

Fleet CSV/export-ready report data is implemented through API responses. Fleet PDF exports should later reuse SmartLink PDF helpers once report templates are approved.

## Station Pump Automation

Fleet transactions can reference station, pump, nozzle, and existing fuel request records. Direct automatic attachment to live pump sessions is intentionally deferred to avoid changing station/kiosk workflows.

## Mapbox Live Operations

The dashboard includes a DB-backed live-state map placeholder from `fleet_vehicle_live_states`. A richer Mapbox layer should be connected after a fleet-specific Mapbox UX and telemetry provider contract are defined.

## Fleet Telemetry Providers

Financial operations metrics now use SmartLink fleet records for budgets, invoices, maintenance, route activity, vehicle live states, and transactions. Direct GPS/telematics ingestion, automated odometer sync, and fuel-sensor integrations remain pending provider selection.

## MyFuel Provider API

Fleet V2 supports manual MyFuel card tracking, shared department-card allocations, manual transaction entry, import placeholders, and reconciliation records. Live MyFuel API behavior remains pending official credentials and documentation. See `docs/FLEET_MYFUEL_INTEGRATION_NOTES.md`.

## Fuel Allocation Automation

Top-up-to-cap, reset-no-carryover, carryover-with-cap, and manual-review rollover logic are implemented in SmartLink Fleet records. Automatic payroll/ERP budget import and provider-side card-limit sync remain pending external integration contracts.
