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
  const created = job.CreatedAt ?? job.createdAt;
  const n =
    typeof updated === "number"
      ? updated
      : Date.parse(String(updated || "")) ||
        (typeof created === "number" ? created : Date.parse(String(created || "")) || 0);
  return Number.isFinite(n) ? n : 0;
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
