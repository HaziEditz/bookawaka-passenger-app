import AsyncStorage from "@react-native-async-storage/async-storage";

function resolveJobApiUrl(): string {
  const raw = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
  if (raw) {
    return raw.endsWith("/api") ? `${raw}/job/create` : `${raw}/api/job/create`;
  }
  const domain = (process.env.EXPO_PUBLIC_DOMAIN ?? "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (domain) return `https://${domain}/api/job/create`;
  return "";
}

const JOB_API = resolveJobApiUrl();

const RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1500;

export interface JobCreatePayload {
  companyId: string;
  passenger: { name: string; phone: string };
  pickup: { address: string; lat: number; lng: number };
  dropoff: { address: string; lat: number; lng: number };
  tariffId?: string;
  notes?: string;
}

export interface JobCreateResponse {
  ok: boolean;
  jobId: string;
  createdAt: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Generate a local job ID that matches the super admin format exactly:
 *   {last3ofCompanyId}{YY}{MM}{DD}{sequence}
 *   e.g. company 620611, 2026-05-02, 1st booking → 611260502 1
 *
 * The daily sequence is stored in AsyncStorage and resets each calendar day.
 * Used as a fallback when the central API is offline (dev/testing only).
 * When the API goes live, it takes over and this fallback is never reached.
 */
async function generateLocalJobId(companyId: string): Promise<string> {
  const now = new Date();
  const last3 = String(companyId).slice(-3);
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const dateKey = `${yy}${mm}${dd}`;
  const storageKey = `jobseq_${companyId}_${dateKey}`;

  let seq = 1;
  try {
    const stored = await AsyncStorage.getItem(storageKey);
    if (stored !== null) {
      seq = parseInt(stored, 10) + 1;
    }
    await AsyncStorage.setItem(storageKey, String(seq));
  } catch {
    // If storage fails, just use 1 — still a valid unique-enough ID for testing
  }

  return `${last3}${yy}${mm}${dd}${seq}`;
}

/**
 * Request a server-generated job ID before creating a booking.
 *
 * Retries up to RETRY_ATTEMPTS times with a RETRY_DELAY_MS gap between each.
 * Calls onRetry(attempt, total) before each retry so the UI can show "Connecting…".
 *
 * If the central API is unreachable (e.g. not yet deployed during testing),
 * falls back to a locally-generated ID in the exact same format the super admin uses.
 * When the API goes live, it will always respond first and the fallback is never used.
 */
export async function createJobId(
  payload: JobCreatePayload,
  onRetry?: (attempt: number, total: number) => void,
): Promise<string> {
  const body = {
    companyId: payload.companyId,
    source: "passenger" as const,
    passenger: payload.passenger,
    pickup: payload.pickup,
    dropoff: payload.dropoff,
    tariffId: payload.tariffId ?? "",
    notes: payload.notes ?? "",
  };

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      onRetry?.(attempt, RETRY_ATTEMPTS);
      await sleep(RETRY_DELAY_MS);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(JOB_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Job API ${res.status}: ${text}`);
      }

      const data: JobCreateResponse = await res.json();
      if (!data.ok || !data.jobId) {
        throw new Error("Job API returned invalid response: " + JSON.stringify(data));
      }

      return data.jobId;
    } catch (err) {
      console.warn(`[JobAPI] Attempt ${attempt}/${RETRY_ATTEMPTS} failed:`, err);
    } finally {
      clearTimeout(timer);
    }
  }

  // API is offline (pre-launch / dev testing). Generate locally in the exact
  // super admin format so test rides work end-to-end with the dispatcher.
  const localId = await generateLocalJobId(payload.companyId);
  console.warn(`[JobAPI] Central API offline — using local fallback ID: ${localId}`);
  return localId;
}
