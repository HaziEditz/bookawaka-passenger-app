/**
 * ASAP booking eligibility — company dispatch online + operating hours.
 * Individual driver online/busy is intentionally ignored (Option 1 pool).
 */

/**
 * Keep in sync with website api-server companyBookingAvailability.ts.
 * 12m (not 5m): backgrounded dispatch tabs throttle the 60s heartbeat timer.
 */
export const DISPATCH_HEARTBEAT_STALE_MS = 12 * 60 * 1000;

export type ActiveDispatcherSession = {
  lastSeen?: number | string | null;
  heartbeat?: number | string | null;
  active?: boolean | string | null;
  [key: string]: unknown;
};

/** True when company has at least one fresh activeDispatchers/{cid}/{session} heartbeat. */
export function isCompanyDispatchOnline(
  sessions: Record<string, ActiveDispatcherSession> | null | undefined,
  nowMs: number = Date.now(),
  staleMs: number = DISPATCH_HEARTBEAT_STALE_MS,
): boolean {
  if (!sessions || typeof sessions !== "object") return false;
  const entries = Object.values(sessions).filter((s) => s && typeof s === "object");
  if (entries.length === 0) return false;
  // Any session with a recent heartbeat/lastSeen counts; missing timestamps still
  // count if the node exists (legacy Default.aspx may only refresh every 60s).
  for (const s of entries) {
    if (s.active === false || s.active === "false" || s.active === 0) continue;
    const ts = Number(s.heartbeat ?? s.lastSeen ?? 0);
    if (!Number.isFinite(ts) || ts <= 0) return true; // presence without clock → treat online
    const ms = ts < 1e12 ? ts * 1000 : ts;
    if (nowMs - ms <= staleMs) return true;
  }
  return false;
}

/**
 * Best-effort open-now check for Owner Panel free-text operatingHours.
 * Empty / unparseable → open (hours not configured yet).
 * Recognises: 24/7, 24 hours, Mon-Fri 6am-11pm, 06:00-23:00, Closed.
 */
export function isWithinOperatingHours(
  hoursText: string | null | undefined,
  now: Date = new Date(),
  timeZone?: string | null,
): boolean {
  const raw = String(hoursText || "").trim();
  if (!raw) return true;

  const lower = raw.toLowerCase();
  if (/24\s*\/\s*7|24\s*hours|always\s*open|open\s*24/.test(lower)) return true;
  if (/^closed\b|permanently\s*closed|not\s*accepting/.test(lower)) return false;

  const local = localParts(now, timeZone);
  const day = local.weekday; // 0=Sun … 6=Sat
  const mins = local.hour * 60 + local.minute;

  // "Mon-Fri 6am-11pm" / "Mon – Fri: 06:00-23:00"
  const range = raw.match(
    /(mon|tue|wed|thu|fri|sat|sun)\w*\s*[-–to]+\s*(mon|tue|wed|thu|fri|sat|sun)\w*[:\s,]+([0-9:.apm\s]+)\s*[-–to]+\s*([0-9:.apm\s]+)/i,
  );
  if (range) {
    const fromD = weekdayIndex(range[1]);
    const toD = weekdayIndex(range[2]);
    const start = parseClockToMinutes(range[3]);
    const end = parseClockToMinutes(range[4]);
    if (fromD >= 0 && toD >= 0 && start != null && end != null) {
      if (!dayInInclusiveRange(day, fromD, toD)) return false;
      return minuteInRange(mins, start, end);
    }
  }

  // Bare "6am-11pm" / "06:00-23:00" (every day)
  const daily = raw.match(
    /(?:^|[^\w])([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)\s*[-–to]+\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)(?:$|[^\w])/i,
  );
  if (daily) {
    const start = parseClockToMinutes(daily[1]);
    const end = parseClockToMinutes(daily[2]);
    if (start != null && end != null) return minuteInRange(mins, start, end);
  }

  // Unrecognised free text — do not block ASAP.
  return true;
}

export function asapBookingAllowed(opts: {
  dispatchOnline: boolean;
  operatingHours?: string | null;
  timezone?: string | null;
  now?: Date;
  /** Scheduled / later bookings skip the ASAP gate. */
  isScheduled?: boolean;
}): { allowed: boolean; reason: "ok" | "dispatch_offline" | "outside_hours" } {
  if (opts.isScheduled) return { allowed: true, reason: "ok" };
  if (!opts.dispatchOnline) return { allowed: false, reason: "dispatch_offline" };
  if (!isWithinOperatingHours(opts.operatingHours, opts.now ?? new Date(), opts.timezone)) {
    return { allowed: false, reason: "outside_hours" };
  }
  return { allowed: true, reason: "ok" };
}

function localParts(now: Date, timeZone?: string | null): { weekday: number; hour: number; minute: number } {
  try {
    const tz = String(timeZone || "").trim() || "Pacific/Auckland";
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const wd = parts.find((p) => p.type === "weekday")?.value || "Mon";
    const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
    const minute = Number(parts.find((p) => p.type === "minute")?.value || 0);
    return { weekday: weekdayIndex(wd), hour: hour === 24 ? 0 : hour, minute };
  } catch {
    return { weekday: now.getDay(), hour: now.getHours(), minute: now.getMinutes() };
  }
}

function weekdayIndex(token: string): number {
  const t = token.trim().toLowerCase().slice(0, 3);
  const map: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };
  return map[t] ?? -1;
}

function dayInInclusiveRange(day: number, from: number, to: number): boolean {
  if (from <= to) return day >= from && day <= to;
  return day >= from || day <= to;
}

function minuteInRange(mins: number, start: number, end: number): boolean {
  if (start === end) return true;
  if (start < end) return mins >= start && mins < end;
  // Overnight window e.g. 22:00-06:00
  return mins >= start || mins < end;
}

function parseClockToMinutes(raw: string): number | null {
  const s = String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ap = m[3];
  if (!Number.isFinite(h) || !Number.isFinite(min) || min < 0 || min > 59) return null;
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (!ap && h > 23) return null;
  if (h < 0 || h > 23) return null;
  return h * 60 + min;
}
