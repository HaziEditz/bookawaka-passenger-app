/** Inline Active Ride trace — what the passenger app checked and decided. */

export type ActiveRideDiagProbe = {
  jobId: string;
  companyId: string;
  passengerjobsStatus: string;
  pendingjobsStatus: string;
  allbookingsStatus: string;
  paymentStatus: string;
  driverId: string;
  hasPendingJobsNode: boolean;
  authoritativeStatus: string;
  decision: string;
};

export type ActiveRideDiag = {
  at: string;
  phase: string;
  uid: string;
  hydrateReady: boolean;
  asyncStorageJobId: string;
  activeRideJobId: string;
  activeRideStatus: string;
  listenersKey: string;
  lastLiveRtdbStatus: string;
  decision: string;
  probes: ActiveRideDiagProbe[];
};

export function emptyActiveRideDiag(): ActiveRideDiag {
  return {
    at: new Date().toISOString(),
    phase: "boot",
    uid: "",
    hydrateReady: false,
    asyncStorageJobId: "—",
    activeRideJobId: "—",
    activeRideStatus: "—",
    listenersKey: "—",
    lastLiveRtdbStatus: "—",
    decision: "starting…",
    probes: [],
  };
}

export function statusOf(node: Record<string, unknown> | null | undefined): string {
  if (!node) return "(missing)";
  const v = node.Status ?? node.status ?? node.BookingStatus ?? node.bookingStatus;
  if (v == null || String(v).trim() === "") return "(empty)";
  return String(v);
}

export function payOf(node: Record<string, unknown> | null | undefined): string {
  if (!node) return "—";
  const v = node.PaymentStatus ?? node.paymentStatus;
  if (v == null || String(v).trim() === "") return "—";
  return String(v);
}

export function driverOf(node: Record<string, unknown> | null | undefined): string {
  if (!node) return "—";
  const id = node.DriverId ?? node.driverId;
  const name = node.DriverName ?? node.driverName;
  const parts = [id != null && String(id).trim() ? String(id) : "", name != null && String(name).trim() ? String(name) : ""].filter(
    Boolean,
  );
  return parts.length ? parts.join(" / ") : "—";
}
