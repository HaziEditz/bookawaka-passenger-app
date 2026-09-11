/** Intermediate extra stops from Stops / nextstopdata / extraStops (creation or edit). */
export function parseJobStops(rec: Record<string, unknown>): { address: string; lat: number; lng: number }[] {
  const out: { address: string; lat: number; lng: number }[] = [];
  const seen = new Set<string>();
  const push = (address: string, lat?: number, lng?: number) => {
    const a = String(address || "").trim();
    if (!a || a === "[object Object]" || seen.has(a)) return;
    seen.add(a);
    out.push({
      address: a,
      lat: typeof lat === "number" && Number.isFinite(lat) ? lat : 0,
      lng: typeof lng === "number" && Number.isFinite(lng) ? lng : 0,
    });
  };
  const tryList = (raw: unknown) => {
    if (raw == null || raw === "") return;
    let list: unknown = raw;
    if (typeof raw === "string") {
      const s = raw.trim();
      if (!s) return;
      if (s.startsWith("[") || s.startsWith("{")) {
        try {
          list = JSON.parse(s);
        } catch {
          // Dispatch create: lat@lng@address= | …
          if (s.includes("@") && /address=/i.test(s)) {
            for (const part of s.split("|")) {
              const m = part.match(/address=([^|]*)/i);
              const latM = part.match(/^(-?\d+(?:\.\d+)?)@(-?\d+(?:\.\d+)?)@/i);
              if (m) push(m[1], latM ? Number(latM[1]) : 0, latM ? Number(latM[2]) : 0);
            }
            return;
          }
          push(s);
          return;
        }
      } else if (s.includes("@") && /address=/i.test(s)) {
        for (const part of s.split("|")) {
          const m = part.match(/address=([^|]*)/i);
          const latM = part.match(/^(-?\d+(?:\.\d+)?)@(-?\d+(?:\.\d+)?)@/i);
          if (m) push(m[1], latM ? Number(latM[1]) : 0, latM ? Number(latM[2]) : 0);
        }
        return;
      } else {
        push(s);
        return;
      }
    }
    if (Array.isArray(list)) {
      for (const item of list) {
        if (item == null) continue;
        if (typeof item === "string") {
          push(item);
          continue;
        }
        if (typeof item === "object") {
          const o = item as Record<string, unknown>;
          push(
            String(o.address ?? o.Address ?? ""),
            o.lat != null ? Number(o.lat) : o.Lat != null ? Number(o.Lat) : 0,
            o.lng != null ? Number(o.lng) : o.Lng != null ? Number(o.Lng) : 0,
          );
        }
      }
    }
  };
  tryList(rec.Stops ?? rec.stops);
  tryList(rec.nextstopdata ?? rec.Nextstopdata);
  tryList(rec.extraStops);
  return out;
}
