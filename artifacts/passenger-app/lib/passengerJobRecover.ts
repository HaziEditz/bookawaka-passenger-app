/**
 * Rebuild ActiveRide / history payloads from Passengerjobs + allbookings nodes.
 * Passengerjobs status is often stale (stuck PendingPayment); prefer allbookings Status.
 */
import type { ActiveRide, RideStatus, VehicleType, PaymentMethodRide } from "@/context/RideContext";
import type { HistoryWriteInput } from "@/context/TripContext";
import type { PlaceDetail } from "@/lib/googlePlaces";

const TERMINAL = new Set([
  "completed",
  "done",
  "finished",
  "cancelled",
  "canceled",
  "no show",
  "noshow",
  "no_show",
  "closed",
]);

const LIVE_IGNORE = new Set([
  "pendingpayment",
  "pending_payment",
]);

export function isTerminalJobStatus(raw: unknown): boolean {
  const s = String(raw || "").trim().toLowerCase();
  return TERMINAL.has(s);
}

export function mapJobStatusToRide(raw: unknown): RideStatus | null {
  const s = String(raw || "").trim();
  const lower = s.toLowerCase();
  if (!s) return null;
  if (TERMINAL.has(lower)) {
    if (lower.includes("cancel")) return "cancelled";
    if (lower.includes("no")) return "no_show";
    return "completed";
  }
  if (LIVE_IGNORE.has(lower.replace(/\s+/g, ""))) return "searching";
  const map: Record<string, RideStatus> = {
    waiting: "searching",
    pending: "searching",
    queued: "searching",
    offered: "searching",
    dispatched: "searching",
    assigned: "confirmed",
    accepted: "confirmed",
    picking: "on_the_way",
    enroute: "on_the_way",
    "on way": "on_the_way",
    arrived: "arrived",
    busy: "in_progress",
    onboard: "in_progress",
    "on board": "in_progress",
    active: "in_progress",
    ontrip: "in_progress",
    "on trip": "in_progress",
    scheduled: "searching",
  };
  return map[lower] || map[s] || null;
}

function placeFrom(d: Record<string, unknown>, kind: "pickup" | "dropoff"): PlaceDetail {
  const address =
    kind === "pickup"
      ? String(d.PickupAddress || d.pickupAddress || d.pickup || "Pickup")
      : String(d.DropoffAddress || d.dropoffAddress || d.DropAddress || d.dropoff || "Dropoff");
  const lat = Number(
    kind === "pickup" ? d.PickupLat ?? d.pickupLat ?? d.pickup_lat : d.DropoffLat ?? d.dropoffLat ?? d.dropoff_lat,
  );
  const lng = Number(
    kind === "pickup" ? d.PickupLng ?? d.pickupLng ?? d.pickup_lng : d.DropoffLng ?? d.dropoffLng ?? d.dropoff_lng,
  );
  return {
    placeId: "",
    name: address.split(",")[0] || address,
    address,
    location: {
      latitude: Number.isFinite(lat) ? lat : 0,
      longitude: Number.isFinite(lng) ? lng : 0,
    },
  };
}

function paymentFrom(d: Record<string, unknown>): PaymentMethodRide {
  const raw = String(d.PaymentMethod || d.paymentMethod || d.PaymentType || d.paymentType || "cash").toLowerCase();
  if (raw.includes("wallet")) return "wallet";
  if (raw.includes("account") || raw === "acc") return "account";
  if (raw.includes("gift")) return "gift_card";
  if (raw.includes("card") || raw.includes("stripe")) return "card";
  return "cash";
}

/** Merge Passengerjobs stub with authoritative allbookings row. */
export function buildActiveRideFromJobNodes(
  jobId: string,
  passengerJob: Record<string, unknown>,
  allbookings?: Record<string, unknown> | null,
): ActiveRide | null {
  const d = { ...passengerJob, ...(allbookings || {}) };
  const companyId = String(d.CompanyId || d.companyId || "").trim();
  if (!companyId || !jobId) return null;
  const statusRaw = allbookings
    ? allbookings.Status ?? allbookings.status ?? allbookings.BookingStatus
    : d.Status ?? d.status ?? d.BookingStatus;
  if (isTerminalJobStatus(statusRaw)) return null;
  const mapped = mapJobStatusToRide(statusRaw) || "searching";
  const payStatus = String(d.PaymentStatus || d.paymentStatus || "").toLowerCase();
  return {
    id: jobId,
    firestoreId: jobId,
    companyId,
    pickup: placeFrom(d, "pickup"),
    destination: placeFrom(d, "dropoff"),
    stops: [],
    vehicleType: (String(d.VehicleType || d.vehicleType || "standard") as VehicleType) || "standard",
    payment: paymentFrom(d),
    fare: Number(d.EstimatedFare ?? d.estimatedFare ?? d.CustomeRate ?? d.fare ?? 0) || 0,
    status: mapped,
    paymentStatus: payStatus === "paid" || payStatus === "confirmed" ? "confirmed" : "pending",
    pickupPin: String(d.PickupPin || d.pickupPin || "") || undefined,
    trackingToken: String(d.trackingToken || d.TrackingToken || "") || undefined,
  };
}

export function historyFromJobNodes(
  jobId: string,
  passengerJob: Record<string, unknown>,
  allbookings?: Record<string, unknown> | null,
): HistoryWriteInput | null {
  const d = { ...passengerJob, ...(allbookings || {}) };
  const statusRaw = allbookings
    ? allbookings.Status ?? allbookings.status ?? allbookings.BookingStatus
    : d.Status ?? d.status ?? d.BookingStatus;
  if (!isTerminalJobStatus(statusRaw)) return null;
  const lower = String(statusRaw).toLowerCase();
  const cancelled = lower.includes("cancel") || lower.includes("no");
  return {
    serviceType: "taxi",
    status: cancelled ? "cancelled" : "completed",
    from: String(d.PickupAddress || d.pickupAddress || d.pickup || ""),
    to: String(d.DropoffAddress || d.dropoffAddress || d.DropAddress || d.dropoff || ""),
    price: Number(d.TotalFare ?? d.totalFare ?? d.EstimatedFare ?? d.estimatedFare ?? d.CustomeRate ?? 0) || 0,
    paymentMethod:
      paymentFrom(d) === "wallet"
        ? "wallet"
        : paymentFrom(d) === "account"
          ? "account"
          : paymentFrom(d) === "gift_card"
            ? "gift_card"
            : paymentFrom(d) === "card"
              ? "card"
              : "cash",
    driverName: String(d.DriverName || d.driverName || "") || undefined,
    bookingId: String(jobId),
  };
}
