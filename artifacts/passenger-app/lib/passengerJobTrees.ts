/**
 * Website create historically wrote Passengerjobs/{websiteSessionUid} only.
 * The app always reads auth.uid. Phone/email index can point at a sibling uid
 * for the same account — merge those trees so Website→App history/schedule work.
 */
import { get as rtdbGet, ref as rtdbRef } from "firebase/database";
import { rtdb } from "@/lib/firebase";
import {
  emailIndexKey,
  keysFromIndexRow,
  mergePassengerJobTrees,
  phoneIndexCandidates,
} from "@/lib/passengerJobKeyUtils";

export {
  collectLocalPassengerJobKeys,
  emailIndexKey,
  mergePassengerJobTrees,
  phoneIndexCandidates,
  toCanonicalPhone,
} from "@/lib/passengerJobKeyUtils";

function addJobKey(keys: Set<string>, raw: unknown): void {
  const s = String(raw || "").trim();
  if (!s || s === "guest" || s.startsWith("web_")) return;
  keys.add(s);
}

export async function resolvePassengerJobTreeKeys(opts: {
  uid?: string | null;
  phone?: string | null;
  email?: string | null;
}): Promise<string[]> {
  const keys = new Set<string>();
  addJobKey(keys, opts.uid);
  const lookups: Promise<void>[] = [];
  const emailKey = emailIndexKey(opts.email || "");
  if (emailKey) {
    lookups.push(
      rtdbGet(rtdbRef(rtdb, `passengerIndex/email/${emailKey}`))
        .then((snap) => {
          if (!snap.exists()) return;
          const val = snap.val();
          for (const k of keysFromIndexRow(val)) addJobKey(keys, k);
        })
        .catch(() => undefined),
    );
  }
  for (const cand of phoneIndexCandidates(opts.phone || "")) {
    lookups.push(
      rtdbGet(rtdbRef(rtdb, `passengerIndex/phone/${cand}`))
        .then((snap) => {
          if (!snap.exists()) return;
          const val = snap.val();
          for (const k of keysFromIndexRow(val)) addJobKey(keys, k);
        })
        .catch(() => undefined),
    );
  }
  await Promise.all(lookups);
  return [...keys];
}

export async function loadMergedPassengerJobs(opts: {
  uid?: string | null;
  phone?: string | null;
  email?: string | null;
}): Promise<Record<string, Record<string, unknown>>> {
  const keys = await resolvePassengerJobTreeKeys(opts);
  const snaps = await Promise.all(
    keys.map((k) => rtdbGet(rtdbRef(rtdb, `Passengerjobs/${k}`)).catch(() => null)),
  );
  return mergePassengerJobTrees(
    snaps.map((s) =>
      s && typeof s.exists === "function" && s.exists()
        ? (s.val() as Record<string, Record<string, unknown>>)
        : null,
    ),
  );
}
