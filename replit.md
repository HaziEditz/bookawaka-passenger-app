# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

---

## External Backend Server (taxitime.co.nz / bookawaka.replit.app)

This is a **separate** server project — not inside this monorepo — that the passenger app calls for job creation, Stripe payments, towing, and rental.

### ⚠️ Entry point changed

The server was restructured. `server.ts` at the root **no longer exists**.

| | Old | New |
|---|---|---|
| Entry point | `server.ts` | `src/app.ts` |
| Run command | `npx ts-node server.ts` | `npx ts-node src/app.ts` |

### New directory layout

```
src/
  app.ts          ← entry point (start here)
  firebase.ts     ← Firebase admin SDK
  utils.ts        ← shared helpers
  sessions.ts     ← session management
  routes/         ← one file per feature area (10 total)
    jobs.ts
    passenger.ts
    towing.ts
    stripe.ts
    freight.ts
    council.ts
    earnings.ts
    restaurant.ts
    rental.ts
    sa-admin.ts
```

### What has NOT changed

- All API endpoints and request/response shapes are identical
- The `.aspx` frontend files are untouched
- Firebase, Stripe, Resend config — unchanged
- All environment variables / secrets — unchanged

### Who needs to know

- **Frontend-only devs** (editing `.aspx` pages) — no action needed
- **Devs editing server-side API routes** — use `src/app.ts` as the entry point; do not look for `server.ts`

---

## Passenger App (`artifacts/passenger-app`)

Expo Router + React Native + Firebase (project: `taxilatest`).

### Features Built

- **Firebase Auth** — email/password login & registration, anonymous sign-in for guest users, token persistence via AsyncStorage
- **Realtime Database** — user profiles + wallet balance (`users/{uid}`), dispatcher job inbox (`pendingjobs/{cid}/{jobId}`), booking mirror (`allbookings/{cid}/{jobId}`), passenger copy (`Passengerjobs/{uid}/{jobId}`)
- **Firestore** — canonical booking records (`allbookings/{cid}/rides/{jobId}`), trip history (`trips` collection)
- **Home screen** — services grid, Firebase company list with live driver-availability, wallet balance, active ride banner
- **Booking flow** (3-step: Location → Vehicle → Confirm)
  - Google Places autocomplete, multi-stop, GPS auto-fill
  - Company & vehicle selector (filtered by TM-approved flag when TM mode on)
  - Fare calculator (distance + time + stops + tariff)
  - Promo codes (hardcoded WELCOME10/RIDE20/VIP15, and Firebase R2R-XXXXXX rental codes)
  - Payment: Card (Stripe Checkout), Wallet, Cash, Account
  - Wallet-split: wallet credit reduces Stripe charge / deducts from balance for cash & wallet payments
  - Total Mobility (TM) — council subsidy calc, hoist fee, card scanning
  - Scheduled rides — 14-day date picker, 15-min time steps, 30-min minimum lead time
  - Email notification to company owner on scheduled bookings
- **Active ride screen**
  - RTDB + Firestore dual listeners for live dispatcher updates (driver name, location, ETA, status)
  - Status progression: searching → confirmed → on_the_way → arrived → in_progress → completed
  - Live `searchPhase` banner (writing / waiting / offered / queued) while dispatcher assigns
  - Recall detection (`RecallStatus: "Recalled"`) — resets to searching with re-simulation
  - Driver card, ETA, payment status badge
  - SOS button, share tracking link, in-app chat modal
  - Add stop mid-trip
  - Smart cancellation: grace-window policy (`computeCancelPolicy`), refund/free/charge outcomes, confirmation modal with contextual banners
- **Ride complete screen** — star rating, tip, receipt breakdown, saves to Firestore history
- **Scheduled rides tab** — reads `Passengerjobs/{uid}` from RTDB, shows Status=Scheduled jobs, cancel writes "Cancelled" to RTDB
- **History tab** — Firestore `trips` collection, filter by service type
- **Profile tab** — wallet top-up, saved addresses (AsyncStorage), favourite drivers, edit name/phone, sign-out
- **Services**
  - Food delivery — demo (mock restaurants, cart, order flow)
  - Freight/courier — demo (package type selector)
  - Towing (`services/tow.tsx`) — native 3-step form → POST `/api/passenger/towing/request` to taxitime.co.nz; tracking via `services/tow-track.tsx` (polls every 20 s)
  - Car rental (`services/rental.tsx`) — search → list → detail (addons/insurance) → confirm → POST `/api/passenger/rental/book` to taxitime.co.nz

### Timezone Architecture

**Rule (set by super-admin):** All apps must use per-company IANA timezone strings for display. Never use raw `new Date()` for local time — it varies by device/server.

| Rule | Wrong | Right |
|---|---|---|
| Store timestamps | `new Date().toLocaleDateString()` | `new Date().toISOString()` (UTC) |
| Get "today's date" | `new Date().toISOString().slice(0,10)` | `getTZDateString(tz)` |
| Get "midnight" | `new Date().setHours(0,0,0,0)` | `_tzTodayStart(tz)` |
| Display a time | `new Date(ts).toLocaleString()` | `displayTZTimestamp(ts, tz)` |

**How it works:**
- Each company stores its IANA timezone in Firebase at `companyProfiles/{cid}/timezone` (e.g. `"Pacific/Auckland"`, `"Australia/Sydney"`)
- `CompaniesContext` reads this and exposes it as `company.timezone`
- The booking screen derives `bookingTZ` from the selected company's timezone, falling back through first real company → `"Pacific/Auckland"`
- All scheduler logic (date chips, `buildTZScheduledDate`, labels) uses `bookingTZ`
- **Stored** `scheduledAt` is always a UTC ISO string (`Date.toISOString()`) — timezone-agnostic

**Key file:** `lib/timezone.ts` — all timezone helpers live here. No other file should hardcode `"Pacific/Auckland"` or call `new Date().toLocaleString()` without a `timeZone` option.

### Key Files

| File | Purpose |
|---|---|
| `lib/timezone.ts` | All timezone-aware date/time helpers (uses company IANA tz) |
| `context/RideContext.tsx` | Active ride state, RTDB/Firestore listeners, driver simulation, cancel/refund logic |
| `context/AuthContext.tsx` | Firebase Auth, RTDB profile, wallet balance |
| `context/TripContext.tsx` | Trip history (Firestore `trips` collection) |
| `context/CompaniesContext.tsx` | Live company list from RTDB |
| `context/AppConfigContext.tsx` | Platform-wide feature flags (e.g. cashEnabled) |
| `lib/jobApi.ts` | Server-issued job ID allocation with retry + local fallback |
| `lib/stripePayment.ts` | Opens Stripe Checkout via expo-web-browser |
| `lib/towingApi.ts` | Towing API client (taxitime.co.nz) |
| `lib/rentalApi.ts` | Rental API client (taxitime.co.nz) |
| `lib/googlePlaces.ts` | Places autocomplete + reverse geocoding |
| `lib/directions.ts` | Routes API + polyline decoder |
| `lib/fareCalculator.ts` | Distance/time/stop-based fare calculation |
| `lib/tmSettings.ts` | Total Mobility subsidy config from Firebase |
| `components/PlacesAutocomplete.tsx` | Debounced address search dropdown |
| `components/RouteMap.tsx` / `RouteMap.native.tsx` | Platform-split map (web SVG / native Maps) |
| `constants/companies.ts` | Vehicle types, tariff defaults, VEHICLES list |

### External Services Called by the App

| Service | Base URL | Used for |
|---|---|---|
| Job ID API | `https://bookawaka.replit.app/api/job/create` | Allocating server-issued job IDs |
| Stripe checkout | `EXPO_PUBLIC_API_URL` or `EXPO_PUBLIC_DOMAIN` + `/api/stripe/create-booking-payment` | Card payment |
| Towing & Rental | `https://taxitime.co.nz` | Towing requests/tracking, rental search/booking |
| Booking notification | `EXPO_PUBLIC_DOMAIN` + `/api/notify-booking` | Email alert for scheduled rides |
| Google Maps | via `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | Places autocomplete, reverse geocode, directions |

### Environment Variables

- `EXPO_PUBLIC_FIREBASE_*` — Firebase config (project: taxilatest)
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` — Google Maps/Places/Directions key
- `EXPO_PUBLIC_API_URL` or `EXPO_PUBLIC_DOMAIN` — Base URL for the booking/Stripe API
- `SESSION_SECRET` — Server session secret

### Promo Codes

| Code | Discount |
|---|---|
| `WELCOME10` | 10% |
| `RIDE20` | 20% |
| `VIP15` | 15% |
| `R2R-XXXXXX` | Variable — validated against `rentalPromos/{code}` in RTDB |

### Cancellation Policy

**⚠️ Cross-dev note (mirrored in SA Portal replit.md):** The 70% rule is **passenger-app-only and NOT server-enforced**. Cancel endpoints on the backend (`bookawaka.replit.app`) flip `status: "cancelled"` and issue a full Stripe refund regardless of distance. If true server-side enforcement is ever needed, the app must pass `driverDistancePct` + `cancelOutcome` to the cancel endpoint so the server can act on it. Do not assume any other surface (SA Portal, Customer Web, dispatch) enforces this rule.

Logic lives in `computeCancelPolicy` in `context/RideContext.tsx`. Single rule: **70% driver distance to pickup** (no time window).

| Payment | Driver < 70% to pickup | Driver ≥ 70% to pickup |
|---|---|---|
| Cash | Free (always, any distance) | Free (always) |
| Card / wallet / gift_card | `"refund"` — fare credited to wallet (NOT to card) | `"charge"` — full fare retained |
| Account / business_account / ACC | `"charge"` — invoiced (driver was dispatched) | `"charge"` — full fare |
| TM + cash | Free, no council charge | Free, no council charge |
| TM + card / wallet / gift_card | `"refund"` — passenger % to wallet, no council charge | `"charge"` — passenger % only, no council charge |
| TM + account / ACC / business_account | `"charge"` — passenger % to account, no council charge | `"charge"` — passenger % to account, no council charge |

No-show (driver waits 5 min at pickup → dispatcher marks `NoShow`): same charge rules as ≥ 70%. App receives `"no_show"` status via RTDB, shows notification, displays "Back to Home" button. Server handles payment; app handles wallet-credit display only.

`"locked"` outcome: cancellation blocked entirely (driver arrived, trip in progress, or no-show already recorded).

### Business Account & ACC Payments — Built into Booking Flow

Both **Business Account** and **ACC** appear as payment options in Step 3 (Confirm Ride) of the booking flow, but **only when the selected company has the feature enabled** in Firebase (`companySettings/{cid}/features/businessAccounts` and `accEnabled`).

**Business Account flow:**
1. Passenger selects "Business Account" as payment method
2. A panel appears asking for account number + purchase order number
3. App validates against `businessAccounts/{cid}/{accountId}` in RTDB — matches on `accountNumber` field, then verifies the PO exists under `purchaseOrders`
4. On success, shows a green "verified" badge with account name + PO
5. `handleBook` blocks until verified; account ID, name, PO ID, and PO number are all written to both RTDB and Firestore on the booking

**ACC flow:**
1. Passenger selects "ACC" as payment method
2. A panel appears asking for claim number
3. App validates against `accClients/{cid}/{clientId}` in RTDB — matches on `claimNumber` field, checks `status !== "active"` is rejected
4. On success, shows a green "verified" badge with client name + claim number
5. Claim number, client ID, and client name are written to the booking

**What gets written to RTDB/Firestore** (both PascalCase and camelCase for dispatcher compatibility):
- Business Account: `businessAccountId`, `businessAccountName`, `purchaseOrderId`, `purchaseOrderNumber`
- ACC: `accClaimNumber`, `accClientId`, `accClientName`

**Note on general "Account" payment:** The existing `account` payment method (manual/invoiced) remains untouched — it's separate from Business Account.

### Firebase Paths — ACC & Business Accounts (back-end only)

These paths are managed entirely by the SA portal, owner panel, and dispatcher. The passenger app does not read or write any of them.

| What | Firebase Path | Written by | Read by |
|---|---|---|---|
| ACC feature flag | `companySettings/{cid}/features/accEnabled` | SA portal | Owner panel, Dispatcher |
| Business Accounts flag | `companySettings/{cid}/features/businessAccounts` | SA portal | Owner panel, Dispatcher |
| ACC Vendor ID | `companySettings/{cid}/accVendorId` | SA portal | Owner panel (invoices) |
| ACC Clients | `accClients/{cid}/{clientId}` | Owner panel | Dispatcher, SA portal |
| Purchase Orders | `accClients/{cid}/{clientId}/purchaseOrders/{poId}` | Owner panel | Dispatcher, SA portal, Driver (`tripsUsed++`) |
| Business Accounts | `businessAccounts/{cid}/{accountId}` | Owner panel | Dispatcher, SA portal |
