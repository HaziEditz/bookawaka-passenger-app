/**
 * Rebuild ActiveRide / history payloads from Passengerjobs + allbookings + pendingjobs.
 * Passengerjobs status is often stale (stuck PendingPayment); prefer pendingjobs, then allbookings.
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

export function isTerminalJobStatus(raw: unknown): boolean {
  const s = String(raw || "").trim().toLowerCase();
  return TERMINAL.has(s);
}

/** True when this looks like an unpaid card hold with no live dispatch node. */
export function isUnpaidCardHold(opts: {
  statusRaw: unknown;
  paymentStatus?: unknown;
  hasPendingJobsNode?: boolean;
}): boolean {
  if (opts.hasPendingJobsNode) return false;
  const st = String(opts.statusRaw || "").trim().toLowerCase().replace(/\s+/g, "");
  const pay = String(opts.paymentStatus || "").trim().toLowerCase();
  if (pay === "paid" || pay === "confirmed") return false;
  return st === "pendingpayment" || st === "pending_payment";
}

/**
 * Pre-dispatch Later booking — lives on Schedule tab only.
 * Must NOT become Active Ride / "Finding your driver…".
 * Once status advances to Pending/Offered/Assigned/… (release window), ASAP Active Ride is correct.
 * Note: do NOT treat generic "Waiting" as scheduled — ASAP pool jobs use Waiting → searching.
 */
export function isPreDispatchScheduledJob(
  statusRaw: unknown,
  job?: Record<string, unknown> | null,
): boolean {
  const st = String(statusRaw || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "");
  if (st === "scheduled") return true;
  if (st === "pendingpayment" || st === "paymentpending") {
    const schedMs = Number(
      job?.ScheduledFor ?? job?.scheduledFor ?? job?.ScheduledForMs ?? 0,
    );
    if (Number.isFinite(schedMs) && schedMs > Date.now() + 60_000) return true;
  }
  return false;
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
  const compact = lower.replace(/\s+/g, "");
  if (compact === "pendingpayment" || compact === "pending_payment") return "searching";
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
    // Later bookings stay on Schedule — never "Finding your driver…"
    scheduled: "scheduled",
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

export function pickAuthoritativeStatus(
  pendingjobs?: Record<string, unknown> | null,
  allbookings?: Record<string, unknown> | null,
  passengerJob?: Record<string, unknown> | null,
): unknown {
  const from = (n?: Record<string, unknown> | null) =>
    n ? n.Status ?? n.status ?? n.BookingStatus ?? n.bookingStatus : undefined;
  // Live dispatch inbox wins while the job is still offerable / on-trip.
  const pendSt = from(pendingjobs);
  if (pendSt != null && String(pendSt).trim() !== "" && !isTerminalJobStatus(pendSt)) {
    return pendSt;
  }
  const abSt = from(allbookings);
  if (abSt != null && String(abSt).trim() !== "") return abSt;
  if (pendSt != null && String(pendSt).trim() !== "") return pendSt;
  return from(passengerJob);
}

/** Merge Passengerjobs stub with pendingjobs + allbookings. */
export function buildActiveRideFromJobNodes(
  jobId: string,
  passengerJob: Record<string, unknown>,
  allbookings?: Record<string, unknown> | null,
  pendingjobs?: Record<string, unknown> | null,
): ActiveRide | null {
  const d = { ...passengerJob, ...(allbookings || {}), ...(pendingjobs || {}) };
  const companyId = String(d.CompanyId || d.companyId || "").trim();
  if (!companyId || !jobId) return null;
  const statusRaw = pickAuthoritativeStatus(pendingjobs, allbookings, passengerJob);
  if (isTerminalJobStatus(statusRaw)) return null;
  if (
    isUnpaidCardHold({
      statusRaw,
      paymentStatus: d.PaymentStatus ?? d.paymentStatus,
      hasPendingJobsNode: !!pendingjobs && Object.keys(pendingjobs).length > 0,
    })
  ) {
    return null;
  }
  // Later / Scheduled (pre-release) — Schedule tab only; never Active Ride search UI.
  if (isPreDispatchScheduledJob(statusRaw, d)) return null;
  const mapped = mapJobStatusToRide(statusRaw) || "searching";
  if (mapped === "scheduled") return null;
  const payStatus = String(d.PaymentStatus || d.paymentStatus || "").toLowerCase();
  const driverName = String(d.DriverName || d.driverName || d.AssignedDriverName || "").trim();
  const driverId = String(d.DriverId || d.driverId || "").trim();
  const hasDriver = !!(driverName || (driverId && driverId !== "0" && driverId !== "-1"));
  const schedMs = Number(d.ScheduledFor ?? d.scheduledFor ?? d.ScheduledForMs ?? 0);
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
    status: hasDriver && mapped === "searching" ? "confirmed" : mapped,
    paymentStatus: payStatus === "paid" || payStatus === "confirmed" ? "confirmed" : "pending",
    pickupPin: String(d.PickupPin || d.pickupPin || "") || undefined,
    trackingToken: String(d.trackingToken || d.TrackingToken || "") || undefined,
    scheduledAt:
      Number.isFinite(schedMs) && schedMs > 0 ? new Date(schedMs).toISOString() : undefined,
    driver: hasDriver
      ? {
          name: driverName || `Driver ${driverId}`,
          rating: 4.8,
          cab: String(d.VehicleId || d.vehicleId || "Vehicle"),
          plate: String(d.Plate || d.plate || "—"),
          color: "",
          location: placeFrom(d, "pickup").location,
        }
      : undefined,
    acceptedAt: hasDriver ? Date.now() : undefined,
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
