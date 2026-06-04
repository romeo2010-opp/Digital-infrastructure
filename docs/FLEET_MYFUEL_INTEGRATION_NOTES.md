# Fleet MyFuel Integration Notes

## Current V2 Handling

SmartLink Fleet V2 treats MyFuel as a manual fuel-card provider until official MyFuel API credentials, documentation, and webhook contracts are available.

Implemented now:

- Register MyFuel as a fuel-card provider with `supports_api = false`.
- Register physical cards with masked card numbers, linked departments, linked vehicles, linked drivers, and daily/monthly limits.
- Track shared department cards through SmartLink internal allocations.
- Record manual card transactions.
- Record statement-import placeholders.
- Reconcile manual/provider transactions against SmartLink fleet transactions.
- Show explicit provider states such as `api_not_connected` and `manual_tracking`.

Not implemented now:

- MyFuel balance lookup.
- MyFuel card top-up.
- MyFuel card block/unblock.
- MyFuel transaction-feed sync.
- MyFuel spending-limit sync.
- MyFuel webhook receiver.
- MyFuel automated statement parsing.

## Required Future API Adapter Capabilities

A production MyFuel adapter should support:

- Provider authentication, credential rotation, and environment-specific secrets.
- Balance lookup per card and per account.
- Transaction feed polling with idempotent external references.
- Webhook verification for card transactions and card status changes.
- Top-up initiation and status reconciliation.
- Limit synchronization for card, vehicle, driver, and department caps.
- Card block/unblock requests with clear asynchronous status handling.
- Statement import and parser validation.
- Reconciliation confidence scoring for date, amount, litres, fuel type, station, vehicle, driver, and odometer.
- Full audit logging for every API-originated card change.

## Safety Rules

- Do not mark a MyFuel payment as complete without confirmed provider evidence.
- Do not show MyFuel balances as live unless they come from an authenticated provider response.
- Keep SmartLink allocations separate from provider balances; SmartLink may control internal spending policy even when one physical MyFuel card is shared by many drivers.
- Every manual reconciliation should remain reversible or flagged, but the original financial records must remain immutable.
