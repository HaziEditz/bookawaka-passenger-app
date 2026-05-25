/**
 * Timezone-aware date/time helpers for the passenger app.
 *
 * Rules (aligned with super-admin architecture):
 *  - STORE timestamps as UTC ISO strings: new Date().toISOString()
 *  - DISPLAY times using the company's IANA timezone (e.g. "Pacific/Auckland")
 *  - NEVER call new Date().toLocaleString() without a timeZone option
 *  - NEVER use new Date().setHours(0,0,0,0) for "midnight" — use _tzTodayStart()
 *
 * Each company stores its timezone as an IANA string in companySettings/{cid}/timezone.
 * All helpers here accept that string. Use FALLBACK_TZ when no company timezone is available.
 */

export const FALLBACK_TZ = "Pacific/Auckland";

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the UTC offset in whole hours for `tz` on the given date.
 * Works by comparing what hour UTC midnight shows in the target timezone.
 * Handles DST correctly because it probes the actual target date.
 */
function _getUTCOffsetHours(tz: string, utcDate: Date): number {
  const h = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).format(utcDate),
    10
  );
  // utcDate is UTC midnight of target day; h is the hour shown in tz at that moment
  return h; // e.g. 12 for NZST, 13 for NZDT, 10 for AEST
}

// ─────────────────────────────────────────────────────────────────────────────
// Public helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Current hour (1-12) and AM/PM in the given IANA timezone.
 */
export function getTZTimeParts(tz: string): { hour12: number; ampm: "AM" | "PM" } {
  const now = new Date();
  const hour24 = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(now),
    10
  );
  return {
    hour12: hour24 % 12 || 12,
    ampm: hour24 >= 12 ? "PM" : "AM",
  };
}

/**
 * Get today's calendar date in `tz` as "YYYY-MM-DD", then add `daysAhead`.
 * Uses en-CA locale because it produces ISO YYYY-MM-DD format natively.
 */
export function getTZDateString(tz: string, daysAhead = 0): string {
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  const [y, m, d] = todayStr.split("-").map(Number);
  const target = new Date(y, m - 1, d + daysAhead); // JS handles month/year rollover
  return [
    target.getFullYear(),
    String(target.getMonth() + 1).padStart(2, "0"),
    String(target.getDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Returns a Date representing midnight (00:00:00) in `tz` on the calendar date
 * that is `daysAhead` days from today in `tz`.
 *
 * Named _tzTodayStart() per super-admin pattern.
 */
export function _tzTodayStart(tz: string, daysAhead = 0): Date {
  return buildTZScheduledDate(tz, daysAhead, 0, 0);
}

/**
 * Builds a proper UTC Date representing `hour24:minute` on the calendar date
 * that is `daysAhead` days from today in `tz`.
 *
 * Correctly handles DST — the UTC offset is probed on the actual target date.
 */
export function buildTZScheduledDate(
  tz: string,
  daysAhead: number,
  hour24: number,
  minute: number
): Date {
  const nzDateStr = getTZDateString(tz, daysAhead); // "YYYY-MM-DD"
  const [y, m, d] = nzDateStr.split("-").map(Number);

  // Probe the UTC offset at UTC midnight of the target calendar day
  const utcMidnight = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const offsetHours = _getUTCOffsetHours(tz, utcMidnight);

  // UTC ms = local time - offset
  // Date.UTC handles negative hours (e.g. midnight in UTC+13 = previous UTC day 11 PM)
  return new Date(Date.UTC(y, m - 1, d, hour24 - offsetHours, minute, 0, 0));
}

/**
 * Label for a date chip `daysAhead` from today in `tz`.
 * Returns "Today", "Tomorrow", or a short weekday+day string.
 */
export function getTZDateChipLabel(tz: string, daysAhead: number): string {
  if (daysAhead === 0) return "Today";
  if (daysAhead === 1) return "Tomorrow";
  const dateStr = getTZDateString(tz, daysAhead);
  const [y, m, d] = dateStr.split("-").map(Number);
  // Build a local-only Date just for formatting the label (no timezone maths needed)
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-NZ", { weekday: "short", day: "numeric" });
}

/**
 * Human-readable label for a scheduled Date, always shown in `tz`.
 * e.g. "Wed 7 May, 3:30 pm"
 */
export function formatTZScheduledLabel(tz: string, date: Date): string {
  const datePart = date.toLocaleDateString("en-NZ", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const timePart = date.toLocaleTimeString("en-NZ", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${datePart}, ${timePart}`;
}

/**
 * Display a UTC timestamp (ms number or ISO string) in the given timezone.
 * Use this everywhere you show a stored timestamp to the user.
 */
export function displayTZTimestamp(
  ts: number | string,
  tz: string,
  opts?: Intl.DateTimeFormatOptions
): string {
  const date = typeof ts === "number" ? new Date(ts) : new Date(ts);
  return date.toLocaleString("en-NZ", {
    timeZone: tz,
    ...(opts ?? {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }),
  });
}
