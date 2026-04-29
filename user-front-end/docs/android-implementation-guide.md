# SmartLink User App Android Build Brief

## What This Document Is

This is a **standalone handoff document** for building a **new native Android app** for SmartLink users.

It is written for an engineer or AI assistant that has **zero access to the repository** and **zero prior context**.

Use this document as the source of truth.

## What You Must Assume

- There is **no existing Android app**.
- The Android app must match the **mobile user web app**, not the desktop companion UI.
- The target product is a **consumer/user app**, not a station staff app, not a kiosk app, and not an internal dashboard.
- The app must support login, stations, queueing, reservations, wallet, QR flows, alerts, and assistant support.

## Android Baseline

Use this Android baseline:

- `minSdk = 28`
- `targetSdk = 35`
- `compileSdk = 35`

Recommended stack:

- Kotlin
- Jetpack Compose
- Navigation Compose
- ViewModel + StateFlow
- Retrofit or Ktor
- OkHttp
- Kotlinx Serialization or Moshi
- Room
- DataStore
- CameraX
- ML Kit barcode scanning
- Credential Manager for passkeys
- Fused Location Provider
- OkHttp WebSockets
- WorkManager
- Firebase Cloud Messaging

## Product Summary

SmartLink is a consumer mobile app for fuel-station discovery and fuel-service operations.

The user can:

- create an account
- sign in with password
- sign in with passkey or biometrics
- discover stations nearby
- inspect station prices and availability
- join a live queue
- track queue progress in real time
- create a fuel reservation
- check in to a reservation
- use a SmartLink wallet
- send credit using user ID or QR
- receive alerts
- review history
- use an assistant tied to live SmartLink data

## Main Navigation

The app should use a bottom navigation with five primary tabs:

- Home
- Orders
- Queue
- Wallet
- More

Secondary destinations:

- Login
- Stations list
- Station details
- Directions
- Reservations
- History
- Alerts
- Help
- Settings
- Account
- Assistant
- Saved stations
- Send credit

## Route-to-Screen Map

| Web Route | Android Screen | Description |
| --- | --- | --- |
| `/m/login` | `LoginScreen` | Sign in, create account, passkey sign-in |
| `/m/home` | `HomeMapScreen` | Map of stations with filters and search |
| `/m/orders` | `OrdersScreen` | Manual wallet-backed fuel orders |
| `/m/activity` | `QueueActivityScreen` | Active queue overview |
| `/m/wallet` | `WalletScreen` | Wallet summary and actions |
| `/m/wallet/send-credit` | `SendCreditScreen` | Credit transfer flow |
| `/m/more` | `MoreScreen` | Settings hub and quick links |
| `/m/stations` | `StationsListScreen` | Full station list |
| `/m/stations/:id` | `StationDetailsScreen` | Station details, queue join, reservations |
| `/m/directions/:id` | `DirectionsScreen` | Directions handoff |
| `/m/queue/:id` | `QueueStatusScreen` | Live queue status |
| `/m/reservations` | `ReservationsScreen` | Reservations list |
| `/m/history` | `HistoryScreen` | History and receipts |
| `/m/alerts` | `AlertsScreen` | Alerts inbox and archive |
| `/m/help` | `HelpScreen` | Help and support |
| `/m/settings` | `SettingsScreen` | Profile, theme, notifications, passkeys |
| `/m/account` | `AccountScreen` | Account summary and receive QR |
| `/m/assistant` | `AssistantScreen` | SmartLink assistant |
| `/m/saved` | `SavedStationsScreen` | Favorited stations |

## Core Product Areas

Build these feature areas:

- Authentication
- Stations
- Queue
- Reservations
- Wallet
- Manual Fuel Orders
- Alerts
- History
- Account and Settings
- Assistant

## Authentication and Session Rules

### Auth Model

The current product uses:

- short-lived access token
- refresh token
- `/auth/refresh`
- `/auth/me`

### Important Rule

The user app is for **USER** accounts only.

If the authenticated role is anything other than `USER`, the app must reject that session and show a message that the user should use the station staff app instead.

### Session Behavior

The client should:

- store access token securely
- retry once on `401`
- call refresh when token is missing or expired
- then retry the failed request
- log out the user if refresh also fails

### Native Session Note

The web app depends on `credentials: include` and a refresh cookie.

For Android, make sure the HTTP client supports cookies and persists them correctly, or coordinate a backend-native session strategy if required.

### Required Auth Endpoints

#### Register

`POST /auth/register`

Request body:

```json
{
  "fullName": "Jane Doe",
  "phone": "+265991000000",
  "email": "jane@example.com",
  "password": "secret123"
}
```

Notes:

- `phone` is required
- `email` is optional
- `fullName` should be collected

#### Login

`POST /auth/login`

Request body:

```json
{
  "email": "jane@example.com",
  "password": "secret123"
}
```

or

```json
{
  "phone": "+265991000000",
  "password": "secret123"
}
```

#### Refresh

`POST /auth/refresh`

No JSON body required.

Expected result:

- returns a new access token

#### Current Session

`GET /auth/me`

Authorization:

`Bearer <accessToken>`

Expected result:

- current user profile
- role
- associated session context

#### Update Profile

`PATCH /auth/me`

Request body:

```json
{
  "fullName": "Jane Doe",
  "email": "jane@example.com",
  "phone": "+265991000000"
}
```

#### Logout

`POST /api/auth/logout`

### Passkeys

Passkey endpoints:

- `POST /auth/passkeys/login/options`
- `POST /auth/passkeys/login/verify`
- `POST /auth/passkeys/register/options`
- `POST /auth/passkeys/register/verify`
- `GET /auth/passkeys`
- `DELETE /auth/passkeys/:passkeyPublicId`

Android implementation:

- use Credential Manager
- support passkey sign-in
- support post-signup passkey enrollment
- allow viewing and removing passkeys in Settings

## Standard API Response Shape

Most API calls use this envelope:

```json
{
  "ok": true,
  "data": {}
}
```

On failure:

```json
{
  "ok": false,
  "error": "Human readable error message"
}
```

The Android client should surface `error` when present.

## Local Persistence Requirements

Persist these values locally:

- access token
- session metadata
- active queue join id
- active manual fuel order id
- notifications preference
- favorite station ids
- queue history
- theme preference

Recommended storage:

- secure storage for access token
- DataStore for preferences and ids
- Room for larger caches if needed

## Station Domain

## Station List

### Endpoint

`GET /api/user/stations`

### Purpose

Returns visible stations for the user app.

### Important Station Fields

The client should expect station-like objects containing:

- `id`
- `publicId`
- `name`
- `address`
- `lat`
- `lng`
- `distanceKm`
- `etaMin`
- `rating`
- `reviewsCount`
- `status`
- `fuelLevel`
- `hoursLabel`
- `openingTime`
- `closingTime`
- `workingHours`
- `facilities`
- `prices`
- `phone`
- `heroImage`
- `subscriptionPlanCode`
- `queuePlanEnabled`
- `reservationPlanEnabled`

### UX Behavior

Home map screen should provide:

- map view
- current location
- station markers
- search by station name and address
- filters for availability and fuel state
- route context to selected station
- a summary bottom sheet or equivalent panel

## Station Fuel Availability

### Endpoint

`GET /api/user/stations/:stationPublicId/fuel-status`

### Example response shape

```json
{
  "stationPublicId": "ST-001",
  "statuses": [
    { "code": "PETROL", "label": "Petrol", "status": "available" },
    { "code": "DIESEL", "label": "Diesel", "status": "low" }
  ],
  "updatedAt": "2026-04-27T10:15:00.000Z"
}
```

## Station Promotion Preview

### Endpoint

`GET /api/user/stations/:stationPublicId/promotions/preview?fuelTypeCode=PETROL&litres=20&paymentMethod=CASH`

### Purpose

Preview pricing and live offers before queue join or reservation.

## Queue Domain

The queue feature is one of the most important parts of the app.

The Android app must support:

- queue join
- active queue lookup
- live queue status
- pump QR scan
- dispense request
- leave queue
- issue reporting
- realtime updates

## Join Queue

### Endpoint

`POST /api/user/stations/:stationPublicId/queue/join`

### Request body

```json
{
  "fuelType": "PETROL",
  "maskedPlate": "BT 1234",
  "requestedLiters": 20,
  "prepay": false
}
```

### Client behavior

After success:

- save the returned queue join id
- treat it as the user’s active queue scope
- open the queue status screen

## Active Queue

### Endpoint

`GET /api/user/queue/active`

### Purpose

Retrieve the user’s current queue if one exists.

## Queue Status

### Endpoint

`GET /api/user/queue/:queueJoinId/status`

### UI must show

- queue status
- position
- cars ahead
- ETA
- now serving
- last movement
- movement state
- pause info if present
- guarantee or fuel coverage info if present

## Pump QR Scan

### Endpoint

`POST /api/user/queue/:queueJoinId/pump-scan`

### Request body

```json
{
  "qrToken": "signed-pump-qr-token"
}
```

### Android behavior

- use camera QR scanning
- support manual token entry fallback
- handle denied camera permission cleanly

## Dispense Request

### Endpoint

`POST /api/user/queue/:queueJoinId/dispense-request`

### Request body

```json
{
  "liters": 20,
  "prepay": false
}
```

## Leave Queue

### Endpoint

`POST /api/user/queue/:queueJoinId/leave`

### Request body

No strict shape is enforced by the current client. It may send a reason if desired.

## Report Queue Issue

### Endpoint

`POST /api/user/queue/:queueJoinId/report-issue`

### Example request body

```json
{
  "issueType": "QR_SCAN",
  "message": "Pump QR would not scan"
}
```

## Reservation Domain

The reservation flow lets a user reserve a slot for fuel service.

## Reservation Slot Lookup

### Endpoint

`GET /api/user/stations/:stationPublicId/reservations/slots?fuelType=PETROL&lookAhead=8`

### Purpose

Load live reservation slot options.

### Client behavior

- refresh slot availability while the reservation modal or screen is open
- do not assume slots remain available after initial load

## Create Reservation

### Endpoint

`POST /api/user/stations/:stationPublicId/reservations`

### Request body

```json
{
  "fuelType": "PETROL",
  "expectedLiters": 20,
  "slotStart": "2026-04-27T12:00:00.000Z",
  "slotEnd": "2026-04-27T12:15:00.000Z",
  "identifier": "BT 1234",
  "depositAmount": 3000,
  "userLat": -15.7861,
  "userLng": 35.0058
}
```

Notes:

- `userLat` and `userLng` are optional

## List Reservations

### Endpoint

`GET /api/user/reservations`

### UI requirements

Show:

- station name
- fuel type
- litres
- time slot
- date
- deposit
- status

## Cancel Reservation

### Endpoint

`POST /api/user/reservations/:reservationPublicId/cancel`

### Example request body

```json
{
  "reason": "user_cancel"
}
```

## Reservation Check-In

### Endpoint

`POST /api/user/reservations/:reservationPublicId/check-in`

### GPS request body

```json
{
  "method": "GPS",
  "userLat": -15.7861,
  "userLng": 35.0058
}
```

### QR request body

```json
{
  "method": "QR",
  "qrToken": "reservation-checkin-token"
}
```

### Important Product Rule

Even though the current mobile web UI mostly uses GPS check-in, the backend already supports QR check-in. The Android app should support both.

## Wallet Domain

The wallet feature includes:

- balance summary
- transactions
- holds
- top-ups
- refunds
- transfers
- transfer history
- receive QR

## Wallet Summary

### Endpoint

`GET /api/user/wallet/me`

### Common fields

Expect wallet-like data such as:

- `walletId`
- `walletPublicId`
- `walletNumber`
- `status`
- `currencyCode`
- `ledgerBalance`
- `availableBalance`
- `lockedBalance`
- `pendingInflow`
- `pendingOutflow`
- `activeHoldAmount`

## Wallet Transactions

### Endpoint

`GET /api/user/wallet/me/transactions?page=1&limit=20&type=PAYMENT&status=POSTED`

## Wallet Holds

### Endpoint

`GET /api/user/wallet/me/holds?status=ACTIVE&limit=20`

## Wallet Top-Up

### Endpoint

`POST /api/user/wallet/me/topups`

### Request body

```json
{
  "amount": 15000,
  "note": "Manual top-up"
}
```

## Wallet Refunds

### List endpoint

`GET /api/user/wallet/me/refunds`

### Create endpoint

`POST /api/user/wallet/me/refunds`

### Request body

```json
{
  "transactionPublicId": "TX-001",
  "amount": 1000,
  "reason": "Wrong amount charged"
}
```

## Wallet Transfers

## Receive QR

### Endpoint

`GET /api/user/wallet/me/transfers/recipient-qr`

### Purpose

Gets a signed QR payload or image that others can use to send credit to this user.

## Preview Transfer

### Endpoint

`POST /api/user/wallet/me/transfers/preview`

### Transfer by user ID body

```json
{
  "recipientUserId": "USR-001",
  "amountMwk": 5000,
  "transferMode": "NORMAL"
}
```

### Transfer by QR body

```json
{
  "recipientQrPayload": "signed-qr-payload",
  "amountMwk": 5000,
  "transferMode": "NORMAL"
}
```

### Optional station-locked variant

```json
{
  "recipientUserId": "USR-001",
  "amountMwk": 5000,
  "transferMode": "STATION_LOCKED",
  "stationPublicId": "ST-001"
}
```

## Create Transfer

### Endpoint

`POST /api/user/wallet/me/transfers`

### Request body

```json
{
  "recipientUserId": "USR-001",
  "amountMwk": 5000,
  "transferMode": "NORMAL",
  "note": "Fuel contribution",
  "idempotencyKey": "wallet-transfer-uuid"
}
```

Important:

- the final create call should use an idempotency key

## Transfer History

### Endpoint

`GET /api/user/wallet/me/transfers/history?page=1&limit=20`

## Station-Locked Balances

### Endpoint

`GET /api/user/wallet/me/station-locked-balances`

## Manual Fuel Orders

This is separate from queueing.

It creates a wallet-backed fuel order that can later be attached when the user physically reaches the station.

## Create Manual Fuel Order

### Endpoint

`POST /api/fuel-orders/manual-wallet`

### Request body

```json
{
  "stationPublicId": "ST-001",
  "fuelType": "PETROL",
  "requestedAmountMwk": 15000,
  "requestedLitres": null
}
```

or

```json
{
  "stationPublicId": "ST-001",
  "fuelType": "PETROL",
  "requestedAmountMwk": null,
  "requestedLitres": 20
}
```

## Get Manual Fuel Order

### Endpoint

`GET /api/fuel-orders/:fuelOrderId`

## Cancel Manual Fuel Order

### Endpoint

`POST /api/fuel-orders/:fuelOrderId/cancel`

### Example request body

```json
{
  "reason": "user_cancel"
}
```

## History and Receipts

## History

### Endpoint

`GET /api/user/history?from=2026-04-01&to=2026-04-27`

### Purpose

Load combined user history relevant to queue, reservations, and wallet-linked activity.

## Receipt Download

### Endpoint

`GET /api/user/receipts/:receiptType/:reference/download`

Rules:

- `receiptType` must be `queue` or `reservation`
- `reference` is required

Android behavior:

- download PDF
- open it in system viewer or share sheet

## Alerts Domain

The alerts feature includes:

- current alerts
- archived alerts
- read action
- archive action
- realtime alert updates

## List Alerts

### Endpoint

`GET /api/user/alerts?limit=50`

## List Archived Alerts

### Endpoint

`GET /api/user/alerts/archived?limit=200`

## Mark Alert Read

### Endpoint

`POST /api/user/alerts/:alertPublicId/read`

## Archive Alert

### Endpoint

`POST /api/user/alerts/:alertPublicId/archive`

## Push Notification Registration

Current web routes:

- `GET /api/user/push/public-key`
- `POST /api/user/push/subscribe`
- `POST /api/user/push/unsubscribe`

Important native note:

- these routes may be web-push-specific
- Android should use FCM
- backend may need native push-token support if current payload shape is browser-only

## Support Domain

Support-related routes already used by the app:

- `GET /api/support/config`
- `GET /api/support/tickets`

The Help area can start simple even if these routes are not fully used on day one.

## Assistant Domain

The assistant is a guided SmartLink helper.

It can:

- receive free-text user messages
- return suggestions and actions
- require confirmation before sensitive actions
- use location context when relevant

## Assistant Respond

### Endpoint

`POST /api/user/assistant/respond`

### Request body

```json
{
  "message": "Find nearby diesel stations",
  "sessionToken": "",
  "actionId": "",
  "actionPayload": {},
  "currentLocation": {
    "lat": -15.7861,
    "lng": 35.0058
  }
}
```

## Assistant Confirm

### Endpoint

`POST /api/user/assistant/confirm`

### Request body

```json
{
  "confirmationToken": "assistant-confirmation-token"
}
```

## Realtime Requirements

The app uses realtime sockets for:

- queue updates
- station changes
- alerts

## Queue Socket

### Endpoint pattern

`/ws/user-queue?accessToken=<token>&queueJoinId=<queueJoinId>`

### Known event types

- `queue:snapshot`
- `queue:update`
- `queue:movement`
- `station:status`
- `queue:fuel`

## Station Changes Socket

### Endpoint pattern

`/ws/user-station-changes?accessToken=<token>&stationPublicId=<stationPublicId>`

### Purpose

- reservation slot changes
- station-level updates that affect user decisions

## Alerts Socket

### Endpoint pattern

`/ws/user-alerts?accessToken=<token>`

### Known event types

- `user_alert:new`
- `user_alert:read`
- `user_alert:archived`

## Realtime Client Rules

The Android client should:

- reconnect with backoff
- treat auth-related close as session expiry
- preserve stale UI state during temporary disconnects where reasonable
- continue polling or refreshing where the product already expects fallback behavior

## Scanning Scope

Scanning is part of the user app in these places:

- queue pump QR scan
- send-credit recipient QR scan
- reservation QR check-in

Scanning that is **not** part of this app:

- attendant kiosk scanning
- staff console scanning
- internal operations scanning

Recommended Android scanning stack:

- CameraX
- ML Kit barcode scanning

Always include:

- manual entry fallback
- permission denial handling
- unsupported-device fallback

## Location Scope

Location is used for:

- nearby station context
- route context
- reservation check-in
- assistant context

Location should be:

- requested when useful
- optional where possible
- gracefully handled if denied

## Theme and Preferences

At minimum support:

- light theme
- dark theme
- notification preference
- saved stations

## Main Screens and What They Must Do

## LoginScreen

- sign in by email or phone
- create account
- sign in with passkey
- offer passkey setup after signup

## HomeMapScreen

- show nearby stations
- show map and markers
- allow search and filters
- open station details

### Home Screen Visual Spec

This screen is a **full-bleed live map screen** with floating controls and a **bottom station drawer**.

Important:

- there is **no left-side navigation drawer** on this screen
- the only drawer-like element is a **bottom sheet / bottom station drawer**
- the map is the main visual surface
- the top controls float over the map
- the bottom sheet floats over the map

### Overall layout

The screen should feel like this:

- full-height map background
- minimal chrome
- a floating search bar near the top
- a small floating filter button inside that search area
- an optional active-filter chip below the search bar
- station markers directly on the map
- a current-location marker on the map
- a selected-station label chip hovering above the selected marker
- a bottom station drawer showing the selected station summary

### Screen proportions

Use these layout ideas:

- the map should occupy almost the entire screen
- the top search area should sit inside the top safe area with small horizontal margins
- the bottom sheet should sit above the bottom tab bar
- the map should remain visible around and behind the bottom sheet

### Search bar

The search bar is a rounded floating pill, not a full-width app bar.

Visual behavior:

- positioned near the top edge
- inset from left and right
- white or near-white in light mode
- dark translucent panel in dark mode
- soft border
- compact height
- slightly glassy/floating feel

Contents from left to right:

- search icon
- text input
- filter button

Search input rules:

- placeholder text should read like `Search Station`
- user can search by station name, address, chip label, and hours text
- no heavy border inside the input
- text field should visually blend into the pill

### Filter button

The filter button lives inside the search pill on the right.

Visual behavior:

- small square-ish button with rounded corners
- neutral gray background when inactive
- green-tinted background when active
- filter icon centered

Filter options:

- All Stations
- Available
- In Use
- Low Fuel
- Medium Fuel
- Open 24h

### Filter popover

When the filter button is tapped, a floating popover opens directly below the search pill area.

Popover styling:

- narrow menu, not full screen
- rounded corners
- soft shadow
- white panel in light mode
- dark panel in dark mode

Each option:

- looks like a compact menu row
- has medium-weight text
- active row gets a green-tinted highlight

### Active filter chip

When any filter other than `All Stations` is selected, show a small pill chip below the search bar.

Visual behavior:

- small rounded chip
- light background
- green text
- compact, secondary to the search bar

### Map surface

The map itself should feel clean and practical rather than decorative.

Visual behavior:

- light mode uses a pale, clean map surface
- dark mode uses a deep navy/dark map surface
- no exaggerated pitch or rotation
- north-up feel
- smooth camera movement

Camera behavior:

- initial zoom is neighborhood/city level
- when a station is selected, the camera eases toward that station
- extra bottom padding is applied so the selected station is visible above the bottom drawer

### Station markers

Station markers are **small circular icon markers**, not default map pins.

Marker shape:

- perfect circle
- compact size, about fingertip-sized
- centered pump glyph inside

Marker icon:

- fuel-pump symbol
- white on green/red in most cases
- dark text/icon on yellow/orange markers where needed

Marker color logic:

- green = healthy / available / high confidence station
- yellow = medium fuel
- red = low fuel
- orange = in use / busy

Selected marker behavior:

- slightly larger than unselected markers
- stronger shadow
- colored outer glow ring based on marker state

Marker tone rules:

- `tone-high` = green
- `tone-medium` = yellow
- `tone-low` = red
- `tone-in-use` = orange

### Selected station label chip

When a marker is selected, show a small floating chip above that marker.

Visual behavior:

- small rounded pill
- same color family as the selected station state
- white text for green/red
- dark text for yellow/orange
- tiny triangular pointer below it
- short station label inside
- should track map movement and stay attached to the marker position

This chip is there to make the selected station feel anchored and obvious.

### Current location marker

The user location should not look like a normal station marker.

Visual behavior:

- soft outer circular glow
- smaller solid dot in the center
- no tap target needed
- should feel like a live GPS location pulse

Color:

- green glow and dot in light mode
- blue-toned glow and dot in dark mode

### Route line

If user location is available and a station is selected, draw a route line between user and station.

Route behavior:

- try real directions first
- if routing fails, fall back to a simple straight line

Route styling:

- thick outer casing
- slightly thinner inner line
- rounded ends

Route color should follow the selected station tone:

- green route for high/available
- yellow route for medium fuel
- red route for low fuel
- orange route for in-use station

### Empty and error states on map

Show a floating status card on the map when needed.

Cases:

- missing map token
- map load failure
- no stations match the search/filter

These status messages should sit above the map, not replace the whole screen.

### Bottom station drawer

This is the main “drawer” on the screen.

It is a floating bottom sheet that sits above the tab bar.

Visual behavior:

- rounded top corners
- translucent white card in light mode
- dark translucent card in dark mode
- soft border
- strong but soft shadow
- compact height when collapsed
- much taller when expanded

Collapsed state:

- shows the currently selected station summary
- shows a grabber at the top
- keeps most of the map visible

Expanded state:

- grows upward
- reveals a scrollable list of visible stations
- still leaves some map visible behind it

### Drawer grabber

At the very top of the bottom sheet:

- centered horizontal grab handle
- subtle gray rounded bar

Behavior:

- tap toggles collapse/expand
- upward swipe expands
- downward swipe collapses

### Drawer header content

In collapsed mode, the selected station summary should include:

- station name in large, bold text
- station address in smaller muted text
- circular action button on the right for moving into full station details

The action button should:

- be circular
- use a green gradient
- feel like a navigation arrow / proceed action

### Drawer metadata rows

Under the station title:

- status pill
- rating stars
- review count
- distance
- ETA

Status pill color should match station state:

- green for available
- yellow for medium
- red for low fuel
- orange for in use

The distance and ETA row should be smaller and quieter than the title.

### Primary CTA in drawer

There should be a single rounded `View` button in the selected-station summary.

Purpose:

- opens the full station details screen

Visual behavior:

- rounded pill
- primary action styling
- clearly separated from the metadata row

### Expanded drawer station list

When expanded, the bottom sheet reveals a list of station cards.

Each row should include:

- small circular fuel-pump icon on the left
- station name
- station address
- distance
- ETA

Selected row behavior:

- slightly stronger border
- subtle green shadow/highlight

Motion:

- rows animate in with a slight upward fade when the sheet expands

### Home screen interaction rules

User can:

- pan and zoom the map
- tap station markers
- type in search
- open filter popover
- choose filter
- expand bottom drawer
- choose station from drawer list
- tap `View` to open station details

Behavior rules:

- selecting a station updates the drawer
- selecting a station recenters the map
- selecting a station updates the route line when location exists
- changing search/filter updates visible markers and drawer list
- if no station matches, show a floating “no results” message

### Dark mode behavior

Dark mode should keep the same layout but shift the surfaces:

- map background becomes dark navy
- floating search/filter/drawer surfaces become dark translucent panels
- borders become cooler blue-gray
- current location marker becomes blue-toned instead of green
- active states stay bright and readable

### Design tone to preserve

The home screen should feel:

- mobile-first
- map-led
- fast to scan
- practical
- slightly polished and premium
- not overcrowded
- not full of boxed sections

The map is the hero. The drawer and controls should feel like floating tools layered over it, not like separate full-page panels.

## StationsListScreen

- list all stations
- open station details

## SavedStationsScreen

- list favorite stations
- open station details

## StationDetailsScreen

- show prices, facilities, and status
- allow favorite toggle
- allow directions
- allow queue join
- allow reservation creation

## QueueActivityScreen / QueueStatusScreen

- show current queue
- show live progress
- allow leave
- allow issue report
- allow pump scan
- allow dispense request

## ReservationsScreen

- list reservations
- search reservations
- cancel reservation
- check in to reservation

## OrdersScreen

- create manual fuel order
- show active order
- cancel active order if eligible

## WalletScreen

- show balances
- show transactions
- show holds
- support top-up
- support refund
- support transfer flows

## SendCreditScreen

- recipient by user ID or QR
- preview transfer
- final confirm
- idempotency key

## HistoryScreen

- show historical records
- filter by date range
- open receipts

## AlertsScreen

- show inbox
- show archive
- mark read
- archive

## AccountScreen

- show profile summary
- show receive QR
- copy user ID
- open wallet or settings

## SettingsScreen

- edit profile
- manage theme
- manage notification preference
- manage passkeys
- logout

## HelpScreen

- show support content

## AssistantScreen

- chat thread
- message composer
- suggestion chips
- action and confirmation flow

## Error Handling Rules

The Android app should:

- show server-provided error messages when available
- retry once after refresh on auth errors
- log out when refresh fails
- keep camera/manual fallback behavior
- handle missing network gracefully
- preserve user progress where reasonable

## Suggested Core Models

Define models for at least:

- `UserProfile`
- `SessionMeta`
- `StationSummary`
- `StationFuelStatus`
- `PromotionPreview`
- `QueueSnapshot`
- `Reservation`
- `WalletSummary`
- `WalletTransaction`
- `WalletHold`
- `WalletTransferPreview`
- `WalletTransfer`
- `ManualFuelOrder`
- `UserAlert`
- `AssistantMessage`

## Recommended Delivery Order

### Phase 1

- app shell
- navigation
- authentication
- session refresh
- home map
- stations list
- station details

### Phase 2

- queue join
- active queue
- realtime queue updates
- leave queue
- issue reporting
- pump QR scan

### Phase 3

- reservations
- live slot loading
- reservation check-in
- saved stations
- alerts

### Phase 4

- wallet summary
- send credit
- receive QR
- transfers
- refunds
- manual fuel orders
- history and receipts

### Phase 5

- passkeys polish
- assistant
- notification polish
- offline and retry polish
- accessibility polish

## Instructions For Gemini Or Another AI Assistant

If you are another AI assistant using this brief:

- build a native Android app from scratch
- follow this document without assuming repository access
- keep API contracts aligned with the routes listed here
- do not use the desktop app as the parity target
- preserve queue, reservation, wallet, and QR behaviors
- explicitly call out any backend gaps instead of inventing incompatible payloads

## First Release Recommendation

For the first Android release, prioritize:

- authentication
- station discovery
- station details
- queue join
- live queue status
- reservations
- wallet summary
- send credit

That is the highest-value product slice and includes the most important login, realtime, and QR-driven user flows.
