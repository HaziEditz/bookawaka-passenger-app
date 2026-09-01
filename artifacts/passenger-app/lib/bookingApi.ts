/**
 * bookingApi.ts — Thin client for all passenger booking actions.
 *
 * Create/cancel → bookawaka Railway `/api/booking/*` (Admin SDK RTDB + emails).
 * Edit → INVT `/api/job/passenger-edit` (editHistory + driver notify) AND
 *         bookawaka `/api/booking/edit` (RTDB fanout + company emails) so
 *         scheduled holds and jobs not yet in jobStore still persist.
 */

import { auth } from "@/lib/firebase";

const FETCH_TIMEOUT_MS = 12_000;

function resolveBookingBase(): string {
  const booking = (process.env.EXPO_PUBLIC_BOOKING_API_URL ?? "").replace(/\/+$/, "");
  if (booking) return booking;
  const general = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
  if (general) return general.replace(/\/api$/, "");
  return "";
}

function resolveDispatchBase(): string {
  const dispatch = (process.env.EXPO_PUBLIC_DISPATCH_URL ?? "").replace(/\/+$/, "");
  if (dispatch) return dispatch;
  return "https://invt-production.up.railway.app";
}

const BOOKING_BASE = resolveBookingBase();
const DISPATCH_BASE = resolveDispatchBase();

async function getIdToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated — cannot perform booking action");
  return user.getIdToken();
}

async function apiPost(
  path: string,
  body: unknown,
  idToken: string,
): Promise<Record<string, unknown>> {
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
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(String(data.error ?? `Booking service error ${res.status}`));
  }
  return data;
}

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

/**
 * Cancel a booking.
 * mode "abort" — unpaid-hold cleanup only; server refuses if already paid.
 * mode "intentional" (default) — passenger chose Cancel; emails fire for scheduled.
 */
export async function cancelBookingOnServer(params: {
  companyId: string;
  jobId: string;
  cancelFields: Record<string, unknown>;
  passengerUid?: string;
  mode?: "abort" | "intentional";
}): Promise<void> {
  const idToken = await getIdToken();
  await apiPost(
    "/cancel",
    {
      companyId: params.companyId,
      jobId: params.jobId,
      cancelFields: params.cancelFields,
      passengerUid: params.passengerUid,
      mode: params.mode ?? "intentional",
    },
    idToken,
  );
}

export type PassengerEditResult = {
  ok: boolean;
  idempotent?: boolean;
  seq?: number;
  eventTypes?: string[];
  driverNotified?: boolean;
  error?: string;
  error_code?: string;
  bookawakaOk?: boolean;
};

/**
 * Edit booking fields (stops, destination, notes, fare, schedule).
 * 1) INVT passenger-edit — editHistory + driver notify when job is in jobStore
 * 2) bookawaka /booking/edit — always updates RTDB + company/passenger emails
 */
export async function editBookingOnServer(params: {
  companyId: string;
  jobId: string;
  editFields: Record<string, unknown>;
  changeSummary?: string[];
  notifyCompany?: boolean;
}): Promise<PassengerEditResult> {
  let invt: PassengerEditResult = { ok: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${DISPATCH_BASE}/api/job/passenger-edit`, {
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
    invt = (await res.json().catch(() => ({}))) as PassengerEditResult;
    if (!res.ok) invt = { ...invt, ok: false, error: invt.error || `HTTP ${res.status}` };
  } catch (networkErr) {
    invt = {
      ok: false,
      error: (networkErr as Error).message || "dispatch unreachable",
      error_code: "network",
    };
  } finally {
    clearTimeout(timer);
  }

  // Always fan out via bookawaka so scheduled/PendingPayment jobs (not in jobStore) persist,
  // and so company edit emails + editHistory land even when INVT ingest hasn't seen the job yet.
  const idToken = await getIdToken();
  try {
    await apiPost(
      "/edit",
      {
        companyId: params.companyId,
        jobId: params.jobId,
        editFields: params.editFields,
        changeSummary: params.changeSummary ?? [],
        notifyCompany: params.notifyCompany !== false,
        invtOk: invt.ok === true,
      },
      idToken,
    );
  } catch (e) {
    if (!invt.ok) throw e;
    console.warn("[bookingApi] bookawaka edit failed after INVT ok:", (e as Error).message);
  }

  if (invt.ok) return { ...invt, bookawakaOk: true };
  // INVT miss is OK when bookawaka edit succeeded (scheduled hold / not yet ingested).
  return { ok: true, bookawakaOk: true, error: invt.error, error_code: invt.error_code };
}
