const BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`
  : "";
const DISPATCH_PATH = "/DataManager/Data.aspx";

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${DISPATCH_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string })?.error ?? `Dispatch API failed (${res.status})`);
  return json as T;
}

export type BookingSource = "PassengerApp" | "Website";
export type ServiceType = "taxi" | "food" | "freight" | "towing" | "rental";

export interface InsertBookingParams {
  serviceType: ServiceType;
  BookingSource: BookingSource;
  ExternalJobId: string;
  pickupAddress: string;
  dropoffAddress: string;
  companyId: string;
  passengerName?: string;
  passengerPhone?: string;
  totalFare?: number;
  paymentMethod?: string;
  notes?: string;
  items?: string;
}

export interface InsertBookingResponse {
  ok: boolean;
  bookingId?: string;
  message?: string;
}

/**
 * Submit a booking to the SQL dispatch system via InsertBookingv4.
 * Must be called after /api/job/create so dispatch receives a server-issued jobId.
 *
 * Throws immediately if ExternalJobId is empty — if this guard fires it means
 * /api/job/create failed silently (should never happen; createJobId always throws
 * or falls back to a local ID, but this catches any future regression).
 */
export async function insertDispatchBooking(params: InsertBookingParams): Promise<InsertBookingResponse> {
  if (!params.ExternalJobId?.trim()) {
    throw new Error(
      "[DispatchAPI] ExternalJobId is required for InsertBookingv4. " +
      "Ensure /api/job/create was called and returned a valid jobId before this call.",
    );
  }
  return post<InsertBookingResponse>({
    action: "InsertBookingv4",
    params,
  });
}
