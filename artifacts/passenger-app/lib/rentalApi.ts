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

export interface RentalVehicle {
  id: string;
  cid: string;
  make: string;
  model: string;
  year?: number;
  category: string;
  seats?: number;
  transmission?: string;
  fuelType?: string;
  dailyRate: number;
  imageUrl?: string;
  available: boolean;
  features?: string[];
}

export interface InsuranceTier {
  id: string;
  name: string;
  description?: string;
  dailyRate: number;
  excess?: number;
}

export interface RentalAddon {
  id: string;
  name: string;
  description?: string;
  dailyRate?: number;
  oneOffRate?: number;
}

export interface RentalDetail extends RentalVehicle {
  insuranceTiers?: InsuranceTier[];
  addons?: RentalAddon[];
  pricing?: {
    days: number;
    baseTotal: number;
    insuranceTotal?: number;
    addonsTotal?: number;
    depositAmount?: number;
    grandTotal?: number;
  };
  companyName?: string;
  companyPhone?: string;
  companyAddress?: string;
}

export interface RentalBookingRequest {
  cid: string;
  vid: string;
  pickupDate: string;
  returnDate: string;
  customer: {
    name: string;
    email: string;
    phone: string;
  };
  insuranceTier?: string;
  selectedAddons?: string[];
  rentalPaymentIntentId?: string;
  depositPaymentIntentId?: string;
}

export interface RentalBookingResponse {
  ok: boolean;
  jobId: string;
  reservationId?: string;
  companyName?: string;
  companyPhone?: string;
  companyId?: string;
  /** Server-authoritative cancel permission */
  canCancel?: boolean;
  /** Policy as plain string (legacy) or object with .text field (new API) */
  cancellationPolicy?: { text: string } | string;
  pricing?: {
    days: number;
    baseTotal: number;
    insuranceTotal?: number;
    addonsTotal?: number;
    depositAmount?: number;
    grandTotal?: number;
  };
  promoCode?: string;
}

/** Extract the displayable cancellation policy string from either API shape */
export function getRentalCancellationPolicyText(policy?: { text: string } | string): string | undefined {
  if (!policy) return undefined;
  if (typeof policy === "string") return policy;
  return policy.text;
}

export interface RentalBookingStatus {
  status: string;
  jobId: string;
  vehicle?: { make: string; model: string; year?: number };
  customer?: { name: string };
  pickupDate?: string;
  returnDate?: string;
  companyName?: string;
  companyPhone?: string;
  companyAddress?: string;
  totalAmount?: number;
}

export function searchVehicles(params: {
  pickup: string;
  return: string;
  category?: string;
}): Promise<RentalVehicle[]> {
  const qs = new URLSearchParams({
    pickup: params.pickup,
    return: params.return,
    ...(params.category ? { category: params.category } : {}),
  }).toString();
  return api<RentalVehicle[]>("GET", `/api/passenger/rental/search?${qs}`);
}

export function getVehicleDetail(params: {
  cid: string;
  vid: string;
  pickup: string;
  return: string;
}): Promise<RentalDetail> {
  const qs = new URLSearchParams({
    cid: params.cid,
    vid: params.vid,
    pickup: params.pickup,
    return: params.return,
  }).toString();
  return api<RentalDetail>("GET", `/api/passenger/rental/vehicle?${qs}`);
}

export function bookRental(data: RentalBookingRequest): Promise<RentalBookingResponse> {
  return api<RentalBookingResponse>("POST", "/api/passenger/rental/book", data);
}

export function getRentalBooking(jobId: string): Promise<RentalBookingStatus> {
  return api<RentalBookingStatus>("GET", `/api/passenger/rental/booking/${jobId}`);
}

export function cancelRentalBooking(
  jobId: string,
  opts?: { customerEmail?: string },
): Promise<{ ok: boolean; message?: string }> {
  return api<{ ok: boolean; message?: string }>("POST", `/api/passenger/rental/cancel/${jobId}`, opts ?? {});
}

/** Format a Date as YYYY-MM-DD in the company timezone (defaults to Pacific/Auckland).
 *  Never use toISOString().slice(0,10) — that returns the UTC date, not the local date. */
export function toDateStr(d: Date, tz = "Pacific/Auckland"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
}

/** Add `n` days to a date */
export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Friendly display e.g. "Mon 5 May" */
export function fmtDate(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" });
}
