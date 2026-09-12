/**
 * Shared passenger-index / Passengerjobs merge helpers (no Firebase import).
 */
function addJobKey(keys: Set<string>, raw: unknown): void {
  const s = String(raw || "").trim();
  if (!s || s === "guest" || s.startsWith("web_")) return;
  keys.add(s);
}

export function collectLocalPassengerJobKeys(opts: {
  uid?: string | null;
  extra?: unknown[];
}): string[] {
  const keys = new Set<string>();
  addJobKey(keys, opts.uid);
  for (const extra of opts.extra || []) addJobKey(keys, extra);
  return [...keys];
}

export function emailIndexKey(email: string): string {
  const e = String(email || "").trim();
  if (!e) return "";
  if (!e.includes("@")) return e;
  return e.toLowerCase().replace(/\./g, ",").replace(/@/g, "__at__");
}

const KNOWN_CC = [
  "64", "61", "1", "44", "65", "91", "86", "81", "82", "33", "49", "39", "34", "7", "55", "52", "27", "66", "62", "63", "84", "60",
];

export function toCanonicalPhone(phone: string): string {
  let d = String(phone || "").replace(/[^0-9]/g, "");
  if (!d) return "";
  const hadTrunkZero = d.startsWith("0");
  if (hadTrunkZero) d = d.replace(/^0+/, "");
  if (hadTrunkZero) return d ? `64${d}` : "";
  if (KNOWN_CC.some((cc) => d.startsWith(cc) && d.length >= cc.length + 8)) return d;
  return `64${d}`;
}

export function phoneIndexCandidates(digits: string): string[] {
  const out: string[] = [];
  const d = String(digits || "").replace(/[^0-9]/g, "");
  if (!d) return [];
  const canonical = toCanonicalPhone(d);
  out.push(canonical);
  if (d !== canonical) out.push(d);
  if (d.startsWith("0")) {
    const bare = d.slice(1);
    if (bare && !out.includes(bare)) out.push(bare);
    if (!out.includes(`64${bare}`)) out.push(`64${bare}`);
  } else if (!d.startsWith("64") && d.length >= 8) {
    if (!out.includes(`0${d}`)) out.push(`0${d}`);
  }
  if (d.startsWith("64") && d.length > 2) {
    const bare = d.slice(2);
    if (bare && !out.includes(bare)) out.push(bare);
    if (!out.includes(`0${bare}`)) out.push(`0${bare}`);
  }
  return [...new Set(out)];
}

function jobStamp(job: Record<string, unknown>): number {
  const updated = job.UpdatedAt ?? job.updatedAt;
  if (typeof updated === "number" && Number.isFinite(updated) && updated > 0) {
    return updated < 1e12 ? updated * 1000 : updated;
  }
  const parsedUpdated = Date.parse(String(updated || ""));
  if (Number.isFinite(parsedUpdated) && parsedUpdated > 0) return parsedUpdated;
  return jobCreatedAtMs(job);
}

/** Website stamps CreatedAt as ISO; the app often stamps createdAt as ms. Number(ISO) is NaN. */
export function jobCreatedAtMs(job: Record<string, unknown> | null | undefined): number {
  if (!job) return 0;
  const numericCandidates = [job.createdAt, job.CreatedAtMs];
  for (const raw of numericCandidates) {
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      return raw < 1e12 ? raw * 1000 : raw;
    }
    if (typeof raw === "string" && /^\d+(\.\d+)?$/.test(raw.trim())) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
    }
  }
  const parsed = Date.parse(String(job.CreatedAt ?? job.createdAt ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Higher = more likely a live ASAP / in-progress ride the Home banner should show. */
export function liveRecoverRank(job: Record<string, unknown> | null | undefined): number {
  const st = String(job?.Status ?? job?.status ?? "")
    .toLowerCase()
    .replace(/[_\s]/g, "");
  if (["cancelled", "canceled", "completed", "closed", "noshow", "declined"].includes(st)) return 0;
  if (st === "pendingpayment" || st === "paymentpending") return 1;
  if (st === "scheduled") return 2;
  return 3;
}

export function comparePassengerJobsForRecover(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): number {
  const rd = liveRecoverRank(b) - liveRecoverRank(a);
  if (rd !== 0) return rd;
  return jobCreatedAtMs(b) - jobCreatedAtMs(a);
}

export function keysFromIndexRow(val: unknown): string[] {
  const keys = new Set<string>();
  addJobKey(keys, (val as { key?: unknown } | null)?.key);
  addJobKey(keys, (val as { uid?: unknown } | null)?.uid);
  const aliases = (val as { aliases?: unknown } | null)?.aliases;
  if (Array.isArray(aliases)) {
    for (const a of aliases) addJobKey(keys, a);
  } else if (aliases && typeof aliases === "object") {
    for (const k of Object.keys(aliases as Record<string, unknown>)) addJobKey(keys, k);
  }
  return [...keys];
}

export function mergePassengerJobTrees(
  trees: Array<Record<string, Record<string, unknown>> | null | undefined>,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const tree of trees) {
    if (!tree || typeof tree !== "object") continue;
    for (const [id, job] of Object.entries(tree)) {
      if (!job || typeof job !== "object") continue;
      const prev = out[id];
      if (!prev) {
        out[id] = job;
        continue;
      }
      out[id] = jobStamp(job) >= jobStamp(prev) ? { ...prev, ...job } : { ...job, ...prev };
    }
  }
  return out;
}
