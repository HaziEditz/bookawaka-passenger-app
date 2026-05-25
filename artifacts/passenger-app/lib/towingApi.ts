const BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`
  : "";

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error ?? `Request failed (${res.status})`);
  return json as T;
}

export interface TowConfig {
  calloutFee: number;
  problems: string[];
  paymentTypes: string[];
}

export interface TowJobResponse {
  ok: boolean;
  jobId: string;
  trackUrl: string;
}

export interface TowTrackStatus {
  status: string; // "pending" | "assigned" | "en_route" | "arrived" | "completed" | "cancelled"
  driver?: { name?: string; phone?: string; vehicle?: string };
  eta?: string;
  jobId?: string;
  pickup?: string;
  dropoff?: string;
  problem?: string;
  createdAt?: string;
  updatedAt?: string;
  companyId?: string;
  companyPhone?: string;
  /** Server-authoritative cancel permission (falls back to local logic if absent) */
  canCancel?: boolean;
  /** Policy as plain string (legacy) or object with .text field (new API) */
  cancellationPolicy?: { text: string } | string;
}

/** Extract the displayable cancellation policy string from either API shape */
export function getCancellationPolicyText(policy?: { text: string } | string): string | undefined {
  if (!policy) return undefined;
  if (typeof policy === "string") return policy;
  return policy.text;
}

export interface TowRequest {
  customerName: string;
  customerPhone: string;
  pickup: string;
  dropoff: string;
  vehicleMake: string;
  vehicleModel: string;
  problem: string;
  paymentType: string;
  paymentIntentId?: string;
}

export function getTowConfig(): Promise<TowConfig> {
  return api<TowConfig>("GET", "/api/passenger/towing/config");
}

export function createTowPaymentIntent(params: {
  amount: number;
  customerEmail?: string;
  description?: string;
}): Promise<{ url?: string; clientSecret?: string; paymentIntentId?: string }> {
  return api("POST", "/api/passenger/towing/payment-intent", params);
}

export function submitTowRequest(data: TowRequest): Promise<TowJobResponse> {
  return api<TowJobResponse>("POST", "/api/passenger/towing/request", data);
}

export function trackTowJob(jobId: string): Promise<TowTrackStatus> {
  return api<TowTrackStatus>("GET", `/api/passenger/towing/track/${jobId}`);
}

export function cancelTowJob(
  jobId: string,
  opts?: { customerPhone?: string; reason?: string },
): Promise<{ ok: boolean; message?: string }> {
  return api<{ ok: boolean; message?: string }>("POST", `/api/passenger/towing/cancel/${jobId}`, opts ?? {});
}
