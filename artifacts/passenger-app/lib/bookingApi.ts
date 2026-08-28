/**
 * bookingApi.ts — Thin client for all passenger booking actions.
 *
 * Create/cancel historically targeted EXPO_PUBLIC_API_URL (bookawaka Railway),
 * which 404s on /api/booking/* — those paths keep RTDB fallbacks in RideContext.
 *
 * Edit goes to INVT dispatch (`/api/job/passenger-edit`) so updateBooking appends
 * editHistory, fans out DropAddress, and notifies the driver — no RTDB workaround.
 */

import { auth } from "@/lib/firebase";

const FETCH_TIMEOUT_MS = 8000;

function resolveBookingBase(): string {
  const booking = (process.env.EXPO_PUBLIC_BOOKING_API_URL ?? "").replace(/\/+$/, "");
  if (booking) return booking;

  const general = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
  if (general) {
    return general.replace(/\/api$/, "");
  }
  return "";
}

function resolveDispatchBase(): string {
  const dispatch = (process.env.EXPO_PUBLIC_DISPATCH_URL ?? "").replace(/\/+$/, "");
  if (dispatch) return dispatch;
  // Same default as signalImComing — live INVT production.
  return "https://invt-production.up.railway.app";
}

const BOOKING_BASE = resolveBookingBase();
const DISPATCH_BASE = resolveDispatchBase();

async function getIdToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated — cannot perform booking action");
  return user.getIdToken();
}

async function apiPost(path: string, body: unknown, idToken: string): Promise<{ success: boolean; jobId?: string }> {
  if (!BOOKING_BASE) {
    throw new Error("Booking service not configured — EXPO_PUBLIC_BOOKING_API_URL is not set");
  }
  const url = `${BOOKING_BASE}/api/booking${path}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (networkErr) {
    const msg = (networkErr as Error).message ?? "";
    if (msg.toLowerCase().includes("aborted") || msg.toLowerCase().includes("abort")) {
      throw new Error("Booking service timed out — check your connection and try again");
    }
    throw new Error(`Network error reaching booking service: ${msg}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((data as { error?: string }).error ?? `Booking service error ${res.status}`);
  }
  return res.json();
}

// ─── Create Booking ───────────────────────────────────────────────────────────

export async function createBookingOnServer(params: {
  companyId: string;
  jobId: string;
  passengerUid: string;
  rtdbData: Record<string, unknown>;
  firestoreData: Record<string, unknown>;
}): Promise<void> {
  const idToken = await getIdToken();
  await apiPost("/create", params, idToken);
}

// ─── Cancel Booking ───────────────────────────────────────────────────────────
// Sends CancelRequested to backend. The dispatcher makes all final decisions
// (refund, charge, driver release, queue restore). Never "Cancelled" from here.

export async function cancelBookingOnServer(params: {
  companyId: string;
  jobId: string;
  cancelFields: Record<string, unknown>;
}): Promise<void> {
  const idToken = await getIdToken();
  await apiPost("/cancel", params, idToken);
}

// ─── Edit Booking (INVT updateBooking path) ───────────────────────────────────

export type PassengerEditResult = {
  ok: boolean;
  idempotent?: boolean;
  seq?: number;
  eventTypes?: string[];
  driverNotified?: boolean;
  error?: string;
  error_code?: string;
};

export async function editBookingOnServer(params: {
  companyId: string;
  jobId: string;
  editFields: Record<string, unknown>;
}): Promise<PassengerEditResult> {
  const url = `${DISPATCH_BASE}/api/job/passenger-edit`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookingId: params.jobId,
        companyId: params.companyId,
        changes: params.editFields,
        actorName: "passenger_app",
      }),
      signal: controller.signal,
    });
  } catch (networkErr) {
    const msg = (networkErr as Error).message ?? "";
    if (msg.toLowerCase().includes("aborted") || msg.toLowerCase().includes("abort")) {
      throw new Error("Dispatch timed out — check your connection and try again");
    }
    throw new Error(`Network error reaching dispatch: ${msg}`);
  } finally {
    clearTimeout(timer);
  }

  const data = (await res.json().catch(() => ({}))) as PassengerEditResult;
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `Edit failed (${res.status})`);
  }
  return data;
}
