/**
 * Pure helpers for passenger scheduled booking status — unit-tested without Firebase.
 */
export function resolveCreateStatus(opts: {
  payment: string;
  scheduledAt?: string | null;
}): "PendingPayment" | "Scheduled" | "Waiting" {
  const pay = String(opts.payment || "").toLowerCase();
  if (pay === "card") return "PendingPayment";
  if (opts.scheduledAt) return "Scheduled";
  return "Waiting";
}

export function shouldToastScheduledSuccess(opts: {
  scheduledAt?: string | null;
  payment: string;
  createSucceeded: boolean;
  paymentSucceeded: boolean;
}): boolean {
  if (!opts.scheduledAt || !opts.createSucceeded) return false;
  if (String(opts.payment).toLowerCase() === "card") return opts.paymentSucceeded;
  return true;
}

export function isScheduledTabVisible(job: {
  Status?: string;
  status?: string;
  ScheduledFor?: number;
  scheduledFor?: number;
  ScheduledForMs?: number;
}): boolean {
  const status = String(job.Status ?? job.status ?? "")
    .toLowerCase()
    .replace(/[_\s]/g, "");
  if (["cancelled", "canceled", "completed", "closed"].includes(status)) return false;
  const schedMs = Number(job.ScheduledFor ?? job.scheduledFor ?? job.ScheduledForMs ?? 0);
  const hasFutureSched = Number.isFinite(schedMs) && schedMs > Date.now();
  return (
    status === "scheduled" ||
    (hasFutureSched && (status === "pendingpayment" || status === "paymentpending"))
  );
}
