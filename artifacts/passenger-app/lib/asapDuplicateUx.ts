/**
 * Block a second ASAP at the first tap. Later/Scheduled stays allowed.
 */
export const ACTIVE_ASAP_LATER_ONLY_TITLE = "You already have an active job";

export const ACTIVE_ASAP_LATER_ONLY_MSG =
  "You have an active job. You can only create a Later booking right now, not another ASAP, until this one's done.";

const LIVE_ASAP_BLOCKED = new Set([
  "cancelled",
  "completed",
  "no_show",
  "cancel_requested",
  "scheduled",
]);

export function activeRideBlocksAsap(ride: { status?: string } | null | undefined): boolean {
  if (!ride) return false;
  return !LIVE_ASAP_BLOCKED.has(String(ride.status || ""));
}
