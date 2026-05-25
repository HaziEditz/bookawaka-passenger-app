# Booking Audit Checklist

Use this document to verify every dev reply during the booking data audit.
Three things must be confirmed, in priority order:

1. **Timezone is fixed** — wrong time = wrong reports = financial loss
2. **Firebase paths match** — wrong path = data that never shows up anywhere
3. **All required fields are written** — missing field = broken subsidy, broken payout, broken report

---

## 1. Canonical Firebase Paths

### Realtime Database (RTDB)

| Path | Written by | Read by | Notes |
|---|---|---|---|
| `pendingjobs/{cid}/{jobId}` | Passenger App | Dispatcher | Primary inbox — dispatcher watches this for new jobs |
| `allbookings/{cid}/{jobId}` | Passenger App | Dispatcher, SA Portal, Owner Panel | Mirror of full booking record |
| `Passengerjobs/{uid}/{jobId}` | Passenger App | Passenger App (scheduled tab) | Note capital P — keyed by passenger UID, not company |
| `companyProfiles/{cid}` | SA Portal | Passenger App, Dispatcher | Includes `timezone`, `name`, tariffs |
| `companyProfiles/{cid}/timezone` | SA Portal | Passenger App | IANA tz string e.g. `"Pacific/Auckland"` |
| `users/{uid}` | Auth flow / Profile screen | Passenger App | Passenger profile — `name`, `phone`, `walletBalance` |
| `businessAccounts/{cid}/{accountId}` | Owner Panel | Passenger App (validation), Dispatcher, SA Portal | |
| `accClients/{cid}/{clientId}` | Owner Panel | Passenger App (validation), Dispatcher, SA Portal | |
| `companySettings/{cid}/features/accEnabled` | SA Portal | Owner Panel, Dispatcher | |
| `companySettings/{cid}/features/businessAccounts` | SA Portal | Owner Panel, Dispatcher | |
| `rentalPromos/{code}` | SA Portal | Passenger App (rental promo validation) | |

### Firestore

| Path | Written by | Read by | Notes |
|---|---|---|---|
| `allbookings/{cid}/rides/{jobId}` | Passenger App | SA Portal, Owner Panel, Dispatcher | Canonical booking record |
| `trips` collection | Ride-complete flow | Passenger App (history tab) | Trip history per passenger |

### RTDB — Driver-App-Owned Paths (passenger app reads/patches only)

| Path | Written by | Read by | Notes |
|---|---|---|---|
| `online/{cid}/{vid}/current` | Driver App | Dispatcher | Live GPS presence — `{lat, lng, hasGps, time}` |
| `driverRatings/{cid}/{jobId}` | Driver App (trip rating) + Passenger App (star rating) | SA Portal, Driver App | Driver app writes full rating doc; passenger app patches `passengerRating` + `passengerRatedAt` using `update()` — never `set()` |
| `allbookings/{cid}/{jobId}/driverRating` | Driver App | SA Portal, Dispatcher | Driver's self-reported trip rating |
| `allbookings/{cid}/{jobId}/passengerRating` | Passenger App | SA Portal, Driver App | Passenger's star rating of the driver ✅ fixed |

---

## 2. Required Fields — Every Booking Write

Both RTDB paths (`pendingjobs` and `allbookings`) and Firestore (`allbookings/{cid}/rides/{jobId}`) must contain **all** of the following:

### Identity
| Field (camelCase) | Field (PascalCase) | Value | Required in |
|---|---|---|---|
| `passengerId` | — | Firebase UID | Firestore |
| `passengerName` | `PassengerName` | From RTDB `users/{uid}/name` (NOT email or displayName) | Both |
| `passengerPhone` | `PhoneNo` / `phone` | Firebase phone number | Both |
| `jobId` | `Id` / `jobId` | Server-issued job ID | Both |
| `companyId` | `CompanyId` | Selected company Firebase ID | Both |
| `source` | `Source` | `"PassengerApp"` | RTDB |

### Locations
| Field (camelCase) | Field (PascalCase) | Notes |
|---|---|---|
| `pickup` | — | Object `{address, lat, lng}` — Firestore only |
| `destination` | — | Object `{address, lat, lng}` — Firestore only |
| `pickupAddress` | `PickupAddress` | Flat string alias — both |
| `dropoffAddress` | `DropoffAddress` | Flat string alias — both |
| `pickupLat` / `pickupLng` | `PickupLat` / `PickupLng` | RTDB only |
| `dropoffLat` / `dropoffLng` | `DropoffLat` / `DropoffLng` | RTDB only |
| `pickupLocation` | `PickupLocation` | Object `{address, lat, lng}` alias — both ✅ added |
| `dropoffLocation` | `DropoffLocation` | Object `{address, lat, lng}` alias — both ✅ added |

### Booking Details
| Field (camelCase) | Field (PascalCase) | Notes |
|---|---|---|
| `vehicleType` | `VehicleType` | Both |
| `estimatedFare` | `EstimatedFare` | Both |
| `paymentMethod` | `PaymentMethod` | Both |
| `paymentType` | `PaymentType` | Alias for paymentMethod — both ✅ added |
| `status` | `Status` | `"Waiting"` / `"Scheduled"` / `"PendingPayment"` |
| `scheduledAt` | `ScheduledAt` | UTC ISO string — only if scheduled |
| `scheduledFor` | `ScheduledFor` | ms timestamp — only if scheduled |

### Timestamps
| Field (camelCase) | Field (PascalCase) | Type | Notes |
|---|---|---|---|
| `requestedAt` | `RequestedAt` | UTC ISO string | ✅ added — use for timezone-safe display |
| `createdAt` | `CreatedAt` | ms number | Legacy — kept for dispatcher compat |
| `updatedAt` | — | Firestore `serverTimestamp()` | Firestore only |

### Total Mobility (TM) — only when `isTM === true`
| Field (camelCase) | Field (PascalCase) | Notes |
|---|---|---|
| `isTM` | — | Boolean flag |
| `tmPassengers` | `TmPassengers` | Array of `{id, cardNumber, cardholderName, expiryDate, needsHoist}` ✅ added |
| `tmVoucherNumbers` | `TmVoucherNumbers` | Flat array of card numbers for easy dispatcher lookup ✅ added |
| `tmCouncilAmount` | — | Council subsidy amount |
| `tmPassengerAmount` | — | Passenger-pays portion |
| `tmHoistCount` | — | Number of passengers needing hoist |
| `tmHoistFeeTotal` | `TmHoistFeeTotal` | Council-covered hoist fee (separate from tmCouncilAmount) ✅ added |
| `tmCouncilIds` | `TmCouncilIds` | Flat array — one councilId per TM passenger (null if card not in registry). Mirrors `tmVoucherNumbers` structure. ✅ added |

> **TM passenger objects** now include `councilId?: string` per entry. The flat `tmCouncilIds` array gives the dispatcher and SA portal direct access without digging into the nested `tmPassengers` array.

> **`tmCards/{cardNumber}` record shape (confirmed by SA portal dev):**
> `active: boolean` — `false` = suspended/blocked (NOT a string "status" field)
> `passengerName: string`, `councilId: string`, `cardRegion: string`
> `usageLimitMonthly: number | null`, `usageLimitDaily: number | null`
> `notes: string`, `updatedAt: number` (Unix ms)
> Passenger app checks: no record → block; `active === false` → block; otherwise → valid.

> **TM voucher field note:** Driver app reads `extras.tmVoucherNo` (single string). Passenger app writes `tmVoucherNumbers` (array) and `tmPassengers[0].cardNumber`. Clarify with driver dev team whether the dispatcher maps `tmVoucherNumbers[0]` → `extras.tmVoucherNo` on assignment, or whether the driver app needs a fallback read from `tmVoucherNumbers[0]`.

### Business Account — only when `payment === "business_account"`
| Field (camelCase) | Field (PascalCase) |
|---|---|
| `businessAccountId` | `BusinessAccountId` |
| `businessAccountName` | `BusinessAccountName` |
| `purchaseOrderId` | `PurchaseOrderId` |
| `purchaseOrderNumber` | `PurchaseOrderNumber` |

### ACC — only when `payment === "acc"`
| Field (camelCase) | Field (PascalCase) |
|---|---|
| `accClaimNumber` | `AccClaimNumber` |
| `accClientId` | `AccClientId` |
| `accClientName` | `AccClientName` |

---

## 3. Timezone Rules (set by super-admin — non-negotiable)

| Action | Wrong pattern | Correct pattern |
|---|---|---|
| Store a timestamp | `Date.now()` alone or `toLocaleDateString()` | `new Date().toISOString()` (UTC) |
| Get today's date string | `new Date().toISOString().slice(0,10)` | `getTZDateString(tz)` from `lib/timezone.ts` |
| Get midnight (start of day) | `new Date().setHours(0,0,0,0)` | `_tzTodayStart(tz)` from `lib/timezone.ts` |
| Display a time to user | `new Date(ts).toLocaleString()` without options | `displayTZTimestamp(ts, tz)` from `lib/timezone.ts` |
| `toLocaleDateString` / `toLocaleTimeString` | Called without `timeZone` option | Always pass `timeZone: tz` (or `timeZone: FALLBACK_TZ`) |

**Company timezone source:** `companyProfiles/{cid}/timezone` in RTDB (IANA string).  
**Fallback:** `"Pacific/Auckland"` (`FALLBACK_TZ` constant in `lib/timezone.ts`).

---

## 3b. Cross-Team Integration Audit — Passenger App Sign-Off (2026-05-07)

Confirmed by cross-team audit lead. No code changes required.

| Item | Status |
|---|---|
| Uses `"PendingPayment"` — agreed platform standard for card-hold status | ✅ Confirmed correct |
| Writes `PaymentMethod` + `paymentMethod` (both casings) | ✅ Confirmed correct |
| Calls `/api/job/create` for job IDs with correct 3-attempt retry logic | ✅ Confirmed correct |
| Writes `pickupLocation` / `dropoffLocation` as nested `{address, lat, lng}` objects AND flat fields | ✅ Confirmed correct |

**⚠️ Open awareness item for dispatch team:**
Card bookings from the passenger app appear in `pendingjobs/{cid}/{jobId}` immediately on booking creation with `Status: "PendingPayment"`. The dispatcher's hold gate **must check for this exact string** before releasing the job to drivers. The job is upgraded to `Status: "Waiting"` after Stripe payment is confirmed. If the dispatcher's hold gate checks a different string (e.g. `"PaymentPending"`), card bookings will be dispatched before payment clears.

---

## 4. Passenger App — Current Status (as of audit)

| Check | Status | Detail |
|---|---|---|
| Writes to `pendingjobs/{cid}/{jobId}` | ✅ | Primary dispatcher inbox |
| Writes to `allbookings/{cid}/{jobId}` (RTDB) | ✅ | Mirror |
| Writes to `Passengerjobs/{uid}/{jobId}` (RTDB) | ✅ | Capital P — correct |
| Writes to `allbookings/{cid}/rides/{jobId}` (Firestore) | ✅ | Canonical record |
| `requestedAt` UTC ISO string | ✅ Fixed | Was missing entirely |
| `pickupLocation` / `dropoffLocation` aliases | ✅ Fixed | Were missing |
| `paymentType` alias | ✅ Fixed | Was missing |
| TM card numbers (`tmPassengers`, `tmVoucherNumbers`) | ✅ Fixed | Were silently dropped |
| `passengerName` source | ✅ Fixed | Now uses RTDB `users/{uid}/name` not `fbUser.displayName` |
| `HistoryCard` timezone | ✅ Fixed | Added `timeZone: FALLBACK_TZ` |
| Home screen recent-rides timezone | ✅ Fixed | Added `timeZone: FALLBACK_TZ` |
| Scheduled tab timezone | ✅ Fixed | `formatScheduledTime` now uses IANA tz, not device local |
| `rentalApi.toDateStr()` | ✅ Fixed | Replaced `toISOString().slice(0,10)` with `Intl.DateTimeFormat` |
| Passenger star rating written to Firebase | ✅ Fixed | Was silently dropped — `rating` param passed to `completeRide()` but never written anywhere. Now patches `allbookings/{cid}/rides/{jobId}` (Firestore), `driverRatings/{cid}/{jobId}` (RTDB, via `update()`), and `allbookings/{cid}/{jobId}` (RTDB) with `passengerRating` + `passengerRatedAt` |

---

## 5. Driver App Audit Reply — Cross-Check Results

### What the driver app confirmed ✅

| Item | Driver-app claim | Cross-check result |
|---|---|---|
| GPS writes to `online/{cid}/{vid}/current` | `{lat, lng, hasGps: true, time: ISO}` every 2s, Firebase rate-limited to 1 write/10s | ✅ Resolved — driver app now also writes `DriverLat`/`DriverLng` directly to `allbookings/{cid}/{bookingId}` on every active-job GPS cycle. No dispatcher bridge needed. |
| TM trip flagging | `extras.tmVoucherNo` triggers TM mode in meter | ✅ Resolved — job normalizer now falls back: `tmVoucherNo` → `tmVoucherNumbers[0]` → `tmPassengers[0].cardNumber`. Works regardless of which field the dispatcher writes. |
| All payment types in `completeJob` / `completeHailTrip` | cash, card, wallet, account, business_account, acc | ✅ Matches passenger app payment types |
| ACC `tripsUsed` increment | Transaction on `accClients/{cid}/{clientId}/purchaseOrders/{poId}/tripsUsed` | ✅ Correct path |
| Cancellation path | Fixed — now writes to `allbookings/{cid}/{bookingId}` | ✅ Passenger app listens to this path |
| Freight POD | Writes to `freightOrders/{cid}/{bookingId}` | ℹ️ Passenger freight is demo-only, not wired up yet |
| Post-trip rating modal | Writes to `driverRatings/{cid}/{bookingId}` + patches `allbookings/{cid}/{bookingId}/driverRating` | ✅ Passenger app now writes `passengerRating` to same `driverRatings` doc via `update()` |

### ✅ All driver questions resolved

Both items that were flagged as open are now closed:

1. **Driver location** — Driver app now writes `DriverLat`/`DriverLng` directly to `allbookings/{cid}/{bookingId}` on every GPS presence cycle (once per 10s) whenever a job is active. The dispatcher does not need to bridge paths.

2. **TM voucher field** — Job normalizers now fall back through `tmVoucherNo` → `tmVoucherNumbers[0]` → `tmPassengers[0].cardNumber`. Works end-to-end regardless of which field the dispatcher writes.

---

## 6. Owner Portal Audit Reply — Confirmed Revenue Architecture

### Revenue paths (confirmed live, all five merged by bookingId)

| RTDB Path | Content | Notes |
|---|---|---|
| `completedJobs/{cid}` | Hail trips — taxi, TM, hail food/freight | Primary completed-trip store |
| `foodOrders/{cid}` | Dispatched food delivery | ✅ confirmed live |
| `freightOrders/{cid}` | Dispatched freight | ✅ confirmed live |
| `joback` | Global job log | `limitToLast:500`, cross-company |
| `allbookings/{cid}` | Full booking mirror | Also read for reports — see field-name gotchas below |

**De-duplication:** All five sources are merged by `bookingId` before any totals are computed. A booking that appears in multiple paths collapses to one row — no double-counting.

### ⚠️ allbookings/{cid} field-name gotchas (bug fixed during audit)

These fields are **Title-Case** in `allbookings`, not camelCase. Any portal reading `allbookings` for reports must use the Title-Case names or records silently contribute $0:

| Data | Wrong (camelCase — not in allbookings) | Correct (Title-Case) |
|---|---|---|
| Fare | `finalFare`, `fare` | **`FinalFare`** |
| Completion timestamp | `completedAt`, `completedAt_iso` | **`CompletedAt_ISO`** |

Owner portal fixed both pickers during this audit. SA portal and any other reporting consumer must verify the same.

---

## 6b. SA Portal Audit — Page-by-Page Results

| Page | Timestamp handling | allbookings coverage | Status |
|---|---|---|---|
| `SA-PlatformHealth.aspx` | ✅ All three timestamp fallbacks defined correctly in a config object | N/A | ✅ Closed |
| `Home.aspx` | ✅ Confirmed correct | N/A | ✅ Closed |
| `SA-MasterReport.aspx` | ✅ Confirmed by SA team (2026-05-06) | Already fetches `allbookings/{cid}` and merges with `completedJobs/{cid}`. Only `status: "completed"` records included; `completedJobs` wins on key conflict. No fix required. | ✅ **Closed** |

### ✅ SA-MasterReport.aspx — resolved (2026-05-06)

~~The master report only queries `completedJobs/{cid}`. Dispatched food, freight, and any booking that flows through `allbookings/{cid}` but not `completedJobs/{cid}` is entirely missing from its totals.~~

**SA team confirmed:** `SA-MasterReport.aspx` already fetches both `allbookings/{cid}` and `completedJobs/{cid}`, merging them before render. Only `status: "completed"` records are included; `completedJobs` wins on key conflict for deduplication. No fix required.


### ⚠️ Payout gap — gross fare only, no commission deduction

The deduction config lives at `companies/{cid}/cardSettings` (company commission %, driver card fee) but is **not wired into any report calculation** in any portal yet. Every portal currently shows gross fare. Once card commission is activated, gross ≠ net payout — reports will need a gross/net split per payment method. Logged as a future sprint item; no ETA.

---

## 6d. Passenger App — E2E Bug Report (2026-05-06)

Bug report filed after solo end-to-end test. Items are addressed below with fix status.

| # | Severity | Bug | Status | Fix applied |
|---|---|---|---|---|
| 1 | 🔴 Critical | App not receiving driver offers / ride matches after booking | ✅ **Fixed 2026-05-06** | Added RTDB listener on `rideStatus/{cid}/{bookingId}` (contract-required path). App was already listening to `pendingjobs` and `allbookings` but missed this third path the dispatcher uses to push driver assignments. All three paths now feed `handleRtdbUpdate`. |
| 2 | ℹ️ Info | Live driver GPS not updating during trip | ✅ **Fixed 2026-05-06** | When dispatcher assigns a driver, app now starts an RTDB listener on `online/{cid}/{vehicleId}/current`. Reads `lat`/`lng` from the `current` node (not top-level) as per the 2026-05-05 GPS bug fix. GPS listener is cleaned up on ride completion, cancellation, and unmount. |
| 3 | ℹ️ Info | Test passenger account needed | See note below | |

### Test account

The passenger app supports two login paths — no test account creation is needed:

1. **Email + password** — create an account via the Register screen with any email/password. The test account `test@bookawaka.com` can be created this way. Firebase Auth handles persistence — the account survives app restarts.

2. **Guest / anonymous** — the app routes unauthenticated users to `/auth/login`. There is currently **no anonymous sign-in flow** — a registered account is required to complete a booking. If E2E testing needs a zero-friction entry point, anonymous sign-in can be added (Firebase `signInAnonymously()`), but this is not currently built.

**Recommended for E2E testing:** create one named test account (`test@bookawaka.com` / password of your choice) and reuse it across all test runs.

### Firebase field contract — passenger app compliance

| Contract requirement | Passenger app status |
|---|---|
| Listen to `rideStatus/{cid}/{bookingId}` after booking | ✅ **Fixed 2026-05-06** — listener added |
| Driver GPS from `online/{cid}/{vid}/current` → `{lat, lng}` (under `current` node) | ✅ **Fixed 2026-05-06** — live GPS listener added on driver assignment |
| Build GPS path from `vehicleId` + `companyId` in allbookings record | ✅ vehicleId extracted from dispatcher write; GPS path constructed dynamically |
| Card payments via Stripe / `POST /api/payment-config` for publishable key | ✅ Already implemented via `lib/stripePayment.ts` |

---

## 6c. Driver App — E2E Bug Report (2026-05-06)

Bug report filed after solo end-to-end test. All ten items are in the driver app codebase (separate repo). None require passenger app changes except BUG 7's root cause, which is now fixed on the passenger side — see note.

| # | Severity | Bug | Root cause | Fix required |
|---|---|---|---|---|
| 1 | 🔴 Critical | Interacting with a new job offer while on an active job **cancels the active job** | Offer accept/reject handlers share state with the active job context | Incoming offer UI must be fully isolated — accept/reject must never touch active job state |
| 2 | 🟠 High | Map is static during a trip — GPS does not update or animate | No real-time GPS update loop wired to the map during active trip | Implement real-time GPS position → map camera updates while trip is active |
| 3 | 🟠 High | App disconnects when backgrounded — GPS stops, offers stop, active trip stops | No foreground service; app relies on foreground React state only | Implement Android foreground service to keep GPS, Firebase listeners, and job state alive off-screen |
| 4 | 🟠 High | Hail trips get device-generated IDs (`hail-{timestamp}`) | No call to `/api/job/create` before starting hail meter | Call `POST /api/job/create` before hail start; retry 3×; **no local fallback** |
| 5 | 🟠 High | TM subsidy fields are zero on completed hail trips even when voucher entered | Subsidy calculation not written to `completedJobs/{cid}/{jobId}` | Write `tmSubsidy`, `tmSubsidyFare`, `tmPassengerPays`, `tmVoucherNo`, `tmPassengerName`, `tmTripCategory` on completion |
| 6 | 🟠 High | Cash hail trips record `tariffName: "Total Mobility"` / `tariffId: "5"` when no TM voucher used | Tariff selection bleeds over from previous TM trip | Reset tariff to default taxi tariff when starting a new hail trip |
| 7 | 🟠 High | Driver sees "Job cancelled by dispatcher" when the app self-cancelled (BUG 1) | Driver app shows "cancelled by dispatcher" for any cancellation, regardless of source | Only show "cancelled by dispatcher" when `CancelledBy === 'dispatcher'` in the Firebase record. **Passenger app fix applied 2026-05-06:** passenger cancels now write `CancelledBy: 'passenger'`, `CancelledAt` (ISO) to both `pendingjobs` and `allbookings`. Driver app must read this field. |
| 8 | 🟡 Medium | No sign-out button — only workaround is clearing app data | Missing UI | Add sign-out button; call `firebase.auth().signOut()` and return to login screen |
| 9 | 🟡 Medium | Hail flow shows job type selector (taxi / food / freight) | Unnecessary step — hail is always taxi | Auto-set type to `"taxi"` for hail; remove type-selection step from hail flow |
| 10 | 🟡 Medium | Drivers created via Owner Portal show "No vehicles available" in driver app | Field name mismatch: Owner Portal writes `allocatedVehicles: {"Taxi02": true}` (object); driver app reads `assignedVehicles: ["Taxi02"]` (array) + `vehicleId: "TAXI02"` (string) | **Coordinate with Owner Portal dev.** Either: (a) Owner Portal writes both field shapes, or (b) driver app reads both. Decision must be made together to avoid a second migration. |

### Driver App — Firebase Field Contract (from bug report)

Fields the driver app **must** write when it cancels a job:

| Field | Value | Path |
|---|---|---|
| `status` | `'Cancelled'` | `allbookings/{cid}/{jobId}` |
| `Status` | `'Cancelled'` | `allbookings/{cid}/{jobId}` |
| `CancelledAt` | ISO UTC string | `allbookings/{cid}/{jobId}` |
| `CancelledBy` | `'driver'` | `allbookings/{cid}/{jobId}` |

GPS writes: `online/{cid}/{vid}/current` → `{ lat, lng, hasGps: true, time }` (already confirmed ✅)

Rating writes: `driverRatings/{cid}/{jobId}` + patch `allbookings/{cid}/{jobId}/driverRating` (already confirmed ✅)

All job IDs: `POST /api/job/create` — BUG 4 confirms this is broken for hail trips, must be fixed.

---

## 7. Parked Items — Build When Triggered

These are known gaps, confirmed and scoped. **No action needed today.** Each has a named trigger condition.

| Item | Current state | Firebase paths involved | Trigger to act | Who to loop in |
|---|---|---|---|---|
| **Card commission / payout deduction** | Config exists at `companies/{cid}/cardSettings` (commission %, driver card fee) but not wired into any report. All portals show gross fare. | `companies/{cid}/cardSettings` | When card commission feature is being activated | SA portal dev + owner portal dev — must build together so numbers agree |
| **Food delivery — real-time order status** | ✅ **Done** — RTDB `onValue` listener on `foodOrders/{cid}/{bookingId}/status` wired in passenger app. Status timeline: pending → accepted → preparing → out_for_delivery → delivered. | `foodOrders/{cid}/{bookingId}/status` | Dispatcher food job routing confirmed wired (2026-05-06) | ✅ Closed — see below |
| **Food delivery — dispatch routing** | ✅ **Fixed 2026-05-06** — `handleOrder` writes to `pendingjobs/{cid}/{jobId}` with `serviceType: "food"`. Dispatcher's `_normFbJob()` preserves service type and routes to food-capable drivers within 10 s. No SQL `InsertBookingv4` call needed. `foodOrders/{cid}/{jobId}` retained for restaurant-facing tracking. | `pendingjobs/{cid}/{jobId}`, `foodOrders/{cid}/{jobId}` | — | ✅ Closed |
| **Freight — post-booking tracking** | ✅ **Done** — RTDB `onValue` listener on `freightOrders/{cid}/{bookingId}` wired in passenger app. Derives status from `pickupConfirmed` + `deliveryConfirmed` + timestamps. | `freightOrders/{cid}/{bookingId}` | Needs end-to-end smoke test with dispatcher writing the fields | Dispatcher dev — confirm `pickupConfirmed`, `deliveryConfirmed`, `deliveredAt` writes reach passenger screen |

---

## 8. How to Verify a Dev Reply

When a dev from another portal (dispatcher, owner panel, SA portal) replies to the audit:

### Step 1 — Timezone
Ask: "Which `timeZone` option do you pass to `toLocaleDateString` / `toLocaleTimeString`?"
- ✅ Pass: names an IANA tz string loaded from `companyProfiles/{cid}/timezone`
- ❌ Fail: "we don't pass one" or "we use the device timezone" or hardcodes `"NZ"`

Ask: "How do you get today's date as a YYYY-MM-DD string?"
- ✅ Pass: uses `Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date())`
- ❌ Fail: `new Date().toISOString().slice(0,10)` or `new Date().toLocaleDateString()`

### Step 2 — Firebase paths
Cross-reference any path they name against the table in section 1.
- Common mistakes: `passengerjobs` (lowercase p) instead of `Passengerjobs`, `bookings` instead of `allbookings`, wrong subcollection depth in Firestore

### Step 3 — Required fields
Ask them to confirm each field in section 2 that their service reads.
- If they read `paymentType` but the passenger app only wrote `paymentMethod` before this fix — that's a data gap going back to every booking before the fix date.
- If they read `tmPassengers` or `tmVoucherNumbers` — confirm the fix date so they know which bookings have the data.
- If they display `requestedAt` — confirm they treat it as a UTC ISO string and pass the company `timeZone` when formatting it.

---

## 9. Website Dev Audit — Three Required Checks

The website booking pages (`.aspx` on taxitime.co.nz) are a separate codebase. The three questions below must be answered by that team. The pass/fail criteria are exact — "we do something similar" is not a pass.

---

### Check 1: Does the website call POST /api/job/create for every booking? Is local ID generation completely absent?

**Ask them to show the code that produces the `jobId` written to Firebase.**

| Answer | Verdict |
|---|---|
| Every booking hits `POST /api/job/create` (or `bookawaka.replit.app/api/job/create`) and writes the returned `jobId` | ✅ Pass |
| There is a fallback that generates an ID locally if the API is unavailable | ⚠️ Acceptable **only** if the local format matches `{last3ofCompanyId}{YY}{MM}{DD}{sequence}` — confirm this exactly |
| ID is generated with `Date.now()`, `Math.random()`, or a UUID | 🔴 **Fail** — IDs won't appear in SA reports, won't match dispatcher records |
| ID is the Firestore `push()` auto-key | 🔴 **Fail** — same problem, different format |

**What to check in their code:**
```
// WRONG — do not accept any of these
const jobId = Date.now().toString();
const jobId = Math.random().toString(36);
const jobId = db.ref().push().key;
const jobId = uuidv4();

// RIGHT — must look like this
const res = await fetch("https://bookawaka.replit.app/api/job/create", { method: "POST", ... });
const { jobId } = await res.json();
```

---

### Check 2: Are pickupLocation and dropoffLocation written as `{address, lat, lng}` objects — not flat strings?

**Ask them to show the Firebase write payload for a booking.**

The passenger app writes (and the dispatcher reads):
```json
"pickupLocation":  { "address": "12 Main St", "lat": -36.87, "lng": 174.76 },
"dropoffLocation": { "address": "4 Queen St",  "lat": -36.86, "lng": 174.77 }
```

| Answer | Verdict |
|---|---|
| Both fields are objects with `address`, `lat`, `lng` keys | ✅ Pass |
| Fields are written as flat strings: `pickupLocation: "12 Main St"` | 🔴 **Fail** — dispatcher map and fare recalculation will break |
| Fields use different key names inside the object (e.g. `latitude`/`longitude`) | 🔴 **Fail** — the dispatcher reads `lat`/`lng` specifically |
| Fields are not written at all (pickup written only as `PickupAddress`/`PickupLat`/`PickupLng`) | ⚠️ Acceptable only if the dispatcher doesn't use `pickupLocation` — verify with dispatcher team |

**Note:** The RTDB booking record must also include the flat aliases for backward compatibility:
```
PickupAddress / pickupAddress  ← flat string
PickupLat / pickupLat          ← number
PickupLng / pickupLng          ← number
```
Both the object form AND the flat aliases must be present.

---

### Check 3: Does the website hide cash payment if `bwConfig/paymentMethods/cashEnabled === false`?

**Ask them to show where the payment method list is built and whether it reads the platform flag.**

The platform cash switch lives at:
```
RTDB: bwConfig/paymentMethods/cashEnabled   ← boolean, defaults true if absent
```

There is also a per-company switch (optional but recommended):
```
RTDB: companySettings/{cid}/paymentMethods/cashEnabled
```

| Answer | Verdict |
|---|---|
| Reads `bwConfig/paymentMethods/cashEnabled` and excludes the cash option when `false` | ✅ Pass |
| Also reads `companySettings/{cid}/paymentMethods/cashEnabled` and AND's both flags | ✅ Better — matches passenger app behaviour |
| Cash is always shown regardless of any Firebase flag | 🔴 **Fail** — SA can't disable cash platform-wide |
| Reads a different path (e.g. `appSettings/cashEnabled`) | 🔴 **Fail** — wrong path; change to `bwConfig/paymentMethods/cashEnabled` |

**Important:** If the flag is missing or null, cash must **default to enabled** — only `=== false` (explicit) should disable it. A missing flag must not block cash payments.

---

### Website Dev — Self-Certification Template

Send this to the website dev and ask them to fill in each cell:

```
[ ] Job ID — source code line / function name that calls the central API: _______________
[ ] Fallback ID generation: none / format is _______________
[ ] pickupLocation written as object: yes / no — paste sample payload: _______________
[ ] dropoffLocation written as object: yes / no — paste sample payload: _______________
[ ] Cash gate: reads bwConfig/paymentMethods/cashEnabled at path: _______________
[ ] Default when flag is missing: enabled / disabled
```

---

## 10. Step 3 — End-to-End Smoke Test Protocol

### Purpose
Confirm that a booking placed through any client app appears correctly in all three SA report surfaces. This catches field-name mismatches that code review alone cannot find.

### Setup — one-time
1. Create a **test company** in Firebase SA portal (e.g. `TEST_CO`) with a known company ID
2. Create a test driver account linked to `TEST_CO`
3. Confirm the test company appears in the passenger app company list
4. Note the test company's `cid` — you will need it to query Firebase directly

### The Three Smoke Tests

Run each test independently. For each: place the booking → complete the trip → immediately check all three SA surfaces.

---

#### Smoke Test A — Standard taxi ride (passenger app)

**Book:** Open passenger app → taxi → pick any route → pay Cash → book with the test company

**Complete:** In the dispatcher, accept → dispatch → mark completed. Set a non-zero `FinalFare`.

**Verify in Firebase (direct check first):**
```
RTDB:       allbookings/{TEST_CO_cid}/{jobId}
  - Status: "Completed"  (capital S)
  - status: "completed"  (lowercase)
  - FinalFare: <number>  (Title-Case — not finalFare)
  - CompletedAt_ISO: <ISO string>  (Title-Case — not completedAt)
Firestore:  allbookings/{TEST_CO_cid}/rides/{jobId}
  - status: "completed"
  - fare / finalFare: <number>
```

**Verify in SA reports:**
| Report | What to check | Pass |
|---|---|---|
| `SA-MasterReport.aspx` | Trip appears in the list; fare is non-zero | ✅ / ❌ |
| `SA-Payouts.aspx` | Trip counted in driver payout; fare matches `FinalFare` | ✅ / ❌ |
| Owner portal earnings | Trip visible; fare matches; timestamp in company timezone | ✅ / ❌ |

**If trip is missing from SA-MasterReport:** Confirm the booking status is `"completed"` — the report only includes completed trips from both `allbookings/{cid}` and `completedJobs/{cid}` (SA team confirmed this is the merge logic as of 2026-05-06).

**If fare shows as $0:** The report is reading `finalFare` (camelCase) instead of `FinalFare` (Title-Case).

**If timestamp is wrong timezone:** The report is not passing the company IANA tz to the date formatter.

---

#### Smoke Test B — Scheduled ride (passenger app)

**Book:** Same as Test A but select a future date/time (minimum 30 min ahead)

**Complete:** Wait for scheduled time → dispatcher confirms → complete as above

**Verify additionally:**
- `scheduledAt` field is present and is a UTC ISO string (not a device-local string)
- SA reports show the scheduled time in the company's timezone, not UTC or device time
- `Status: "Scheduled"` was set at booking time, then updated to `"Waiting"` → `"Completed"` through the lifecycle

---

#### Smoke Test C — Website booking (website dev)

**Book:** Place a booking through the taxitime.co.nz web form using the test company

**Verify in Firebase:**
- `jobId` matches the format from the central API (not a UUID or timestamp)
- `pickupLocation` and `dropoffLocation` are objects with `address`, `lat`, `lng`
- `Source` field is present (website should set `Source: "Website"` or similar)

**Verify in SA reports:** Same three surfaces as Test A

**If the booking doesn't appear at all in any SA report:** The website is writing to a different Firebase path, or the company ID used doesn't match `TEST_CO`.

---

### Recording Results

Fill this table after each smoke test:

| Test | SA-MasterReport | SA-Payouts | Owner earnings | Fare correct | Timezone correct | Notes |
|---|---|---|---|---|---|---|
| A — Taxi (passenger app) | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| B — Scheduled ride | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| C — Website booking | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |

Any ❌ in SA-MasterReport for Test A or B: confirm the booking's `status` is `"completed"` in both `allbookings/{cid}` and/or `completedJobs/{cid}`. The SA report merges both sources (confirmed 2026-05-06) but only shows completed records.

---

### Smoke Test D — Cancellation (passenger app, optional but high-value)

**Book and immediately cancel** within the grace window.

**Verify in RTDB `allbookings/{cid}/{jobId}`:**
```
Status: "Cancelled"   ← capital S (dispatcher reads this)
status: "Cancelled"   ← lowercase (fixed in passenger app 2026-05-06)
```

Both must be `"Cancelled"`. If only `Status` is set, the fix wasn't deployed — check the checkpoint from 2026-05-06.

**Verify wallet refund** (if card/wallet payment): balance should increase by fare amount.
