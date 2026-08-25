import { Router, type Request, type Response } from "express";

const router = Router();

const FIREBASE_PROJECT = "bookawaka2026-564e1";
const RTDB_BASE = "https://bookawaka2026-564e1-default-rtdb.firebaseio.com";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

// ─── Firebase REST helpers ────────────────────────────────────────────────────

async function rtdbWrite(
  path: string,
  data: unknown,
  idToken: string,
  method: "PUT" | "PATCH" = "PUT",
): Promise<void> {
  const url = `${RTDB_BASE}/${path}.json?auth=${idToken}`;
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`RTDB ${method} ${path} failed: ${res.status} ${body}`);
  }
}

type FSValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { mapValue: { fields: Record<string, FSValue> } }
  | { arrayValue: { values?: FSValue[] } };

function toFSValue(val: unknown): FSValue {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number") {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === "string") {
    if (/^\d{4}-\d{2}-\d{2}T[\d:.Z+-]+$/.test(val)) return { timestampValue: val };
    return { stringValue: val };
  }
  if (Array.isArray(val)) {
    return val.length > 0
      ? { arrayValue: { values: val.map(toFSValue) } }
      : { arrayValue: {} };
  }
  if (typeof val === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(val as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, toFSValue(v)]),
        ),
      },
    };
  }
  return { stringValue: String(val) };
}

function toFSDocument(data: Record<string, unknown>) {
  return {
    fields: Object.fromEntries(
      Object.entries(data)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, toFSValue(v)]),
    ),
  };
}

async function firestoreWrite(
  docPath: string,
  data: Record<string, unknown>,
  idToken: string,
): Promise<void> {
  const url = `${FIRESTORE_BASE}/${docPath}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(toFSDocument(data)),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Firestore PATCH ${docPath} failed: ${res.status} ${body}`);
  }
}

function extractToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

// ─── POST /booking/create ─────────────────────────────────────────────────────
// Writes a new booking to all required Firebase paths.
// Primary RTDB write (pendingjobs) must succeed — dispatcher watches this path.
// All other writes are best-effort and do not block the response.
router.post("/create", async (req: Request, res: Response) => {
  const idToken = extractToken(req);
  if (!idToken) return res.status(401).json({ error: "Unauthorized — missing Authorization header" });

  const { companyId, jobId, passengerUid, rtdbData, firestoreData } = req.body as {
    companyId: string;
    jobId: string;
    passengerUid: string;
    rtdbData: Record<string, unknown>;
    firestoreData?: Record<string, unknown>;
  };

  if (!companyId || !jobId || !passengerUid || !rtdbData) {
    return res.status(400).json({ error: "Missing required fields: companyId, jobId, passengerUid, rtdbData" });
  }

  try {
    const st = String(rtdbData.Status ?? rtdbData.status ?? "").toLowerCase();
    const isCardHold =
      st === "pendingpayment" ||
      st === "paymentpending" ||
      String(rtdbData.paymentMethod ?? rtdbData.PaymentMethod ?? "").toLowerCase() === "card" &&
        String(rtdbData.paymentStatus ?? "").toLowerCase() !== "paid";

    const now = new Date().toISOString();
    // Card hold: write allbookings + Passengerjobs only — NEVER pendingjobs until Stripe confirms.
    if (!isCardHold) {
      await rtdbWrite(`pendingjobs/${companyId}/${jobId}`, rtdbData, idToken);
    } else {
      req.log.info({ companyId, jobId, st }, "card hold — withheld pendingjobs until payment verified");
    }

    rtdbWrite(`allbookings/${companyId}/${jobId}`, rtdbData, idToken)
      .catch((e) => req.log.warn({ err: (e as Error).message }, "RTDB allbookings mirror failed"));
    rtdbWrite(`Passengerjobs/${passengerUid}/${jobId}`, rtdbData, idToken)
      .catch((e) => req.log.warn({ err: (e as Error).message }, "RTDB Passengerjobs write failed"));

    if (firestoreData) {
      firestoreWrite(
        `allbookings/${companyId}/rides/${jobId}`,
        { ...firestoreData, createdAt: now, updatedAt: now },
        idToken,
      ).catch((e) => req.log.warn({ err: (e as Error).message }, "Firestore booking write failed (non-blocking)"));
    }

    req.log.info({ companyId, jobId }, "Booking created via API");
    return res.json({ success: true, jobId });
  } catch (err) {
    req.log.error({ err }, "Booking create — primary RTDB write failed");
    return res.status(503).json({ error: "Booking create failed — dispatcher could not receive the job" });
  }
});

// ─── POST /booking/cancel ─────────────────────────────────────────────────────
// Writes CancelRequested to RTDB. The dispatcher reads this and makes the final
// decision (refund, charge, driver release, queue restore). Never writes "Cancelled"
// directly — that is always the dispatcher's call.
router.post("/cancel", async (req: Request, res: Response) => {
  const idToken = extractToken(req);
  if (!idToken) return res.status(401).json({ error: "Unauthorized" });

  const { companyId, jobId, cancelFields } = req.body as {
    companyId: string;
    jobId: string;
    cancelFields: Record<string, unknown>;
  };

  if (!companyId || !jobId || !cancelFields) {
    return res.status(400).json({ error: "Missing required fields: companyId, jobId, cancelFields" });
  }

  try {
    await Promise.all([
      rtdbWrite(`pendingjobs/${companyId}/${jobId}`, cancelFields, idToken, "PATCH"),
      rtdbWrite(`allbookings/${companyId}/${jobId}`, cancelFields, idToken, "PATCH"),
    ]);

    const now = new Date().toISOString();
    firestoreWrite(
      `allbookings/${companyId}/rides/${jobId}`,
      { ...cancelFields, updatedAt: now },
      idToken,
    ).catch((e) => req.log.warn({ err: (e as Error).message }, "Firestore cancel write failed (non-blocking)"));

    req.log.info({ companyId, jobId }, "Cancel request written via API");
    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Booking cancel — RTDB write failed");
    return res.status(503).json({ error: "Cancel request failed — could not reach dispatcher" });
  }
});

// ─── POST /booking/edit ───────────────────────────────────────────────────────
// Edits a booking (stop changes, fare update) — only valid before driver accepts.
// The passenger app enforces the pre-accept gate on the client; the dispatcher
// enforces it on the backend by ignoring edits on accepted jobs.
router.post("/edit", async (req: Request, res: Response) => {
  const idToken = extractToken(req);
  if (!idToken) return res.status(401).json({ error: "Unauthorized" });

  const { companyId, jobId, editFields } = req.body as {
    companyId: string;
    jobId: string;
    editFields: Record<string, unknown>;
  };

  if (!companyId || !jobId || !editFields) {
    return res.status(400).json({ error: "Missing required fields: companyId, jobId, editFields" });
  }

  try {
    await Promise.all([
      rtdbWrite(`pendingjobs/${companyId}/${jobId}`, editFields, idToken, "PATCH"),
      rtdbWrite(`allbookings/${companyId}/${jobId}`, editFields, idToken, "PATCH"),
    ]);

    const now = new Date().toISOString();
    firestoreWrite(
      `allbookings/${companyId}/rides/${jobId}`,
      { ...editFields, updatedAt: now },
      idToken,
    ).catch((e) => req.log.warn({ err: (e as Error).message }, "Firestore edit write failed (non-blocking)"));

    req.log.info({ companyId, jobId }, "Booking edit written via API");
    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Booking edit — RTDB write failed");
    return res.status(503).json({ error: "Edit failed — could not reach dispatcher" });
  }
});

export default router;
