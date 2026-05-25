/**
 * bookingApi.ts — Thin client for all passenger booking actions.
 *
 * ALL booking writes go through these functions → local API server → Firebase.
 * The passenger app never writes to Firebase directly for booking state.
 *
 * Allowed actions: create, cancel, edit (before accept only).
 * Not allowed: touching driver state, queue, offers, or internal dispatch paths.
 *
 * URL resolution priority:
 *   1. EXPO_PUBLIC_BOOKING_API_URL  — dedicated booking API base (recommended)
 *   2. EXPO_PUBLIC_API_URL          — general API base (strips trailing /api if present)
 *   Both should point to the LOCAL Replit API server, not the external bookawaka server.
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

const BOOKING_BASE = resolveBookingBase();

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

// ─── Edit Booking ─────────────────────────────────────────────────────────────
// Only valid before a driver accepts. Send stop/fare updates to the dispatcher.

export async function editBookingOnServer(params: {
  companyId: string;
  jobId: string;
  editFields: Record<string, unknown>;
}): Promise<void> {
  const idToken = await getIdToken();
  await apiPost("/edit", params, idToken);
}
