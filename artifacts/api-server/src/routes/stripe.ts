import { Router, type Request, type Response } from "express";

const router = Router();
const STRIPE_SECRET_KEY = process.env["STRIPE_SECRET_KEY"] ?? "";
const RTDB_BASE = "https://bookawaka2026-564e1-default-rtdb.firebaseio.com";

function extractToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

/** Decode Firebase ID token payload (no signature verify — RTDB auth= already gates writes). */
function uidFromIdToken(idToken: string): string | null {
  try {
    const part = idToken.split(".")[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const payload = JSON.parse(json) as { user_id?: string; sub?: string; uid?: string };
    const uid = String(payload.user_id || payload.sub || payload.uid || "").trim();
    return uid || null;
  } catch {
    return null;
  }
}

async function rtdbGet(path: string, idToken: string): Promise<any> {
  const res = await fetch(`${RTDB_BASE}/${path}.json?auth=${idToken}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`RTDB GET ${path} failed: ${res.status} ${body}`);
  }
  return res.json();
}

async function rtdbPut(path: string, data: unknown, idToken: string): Promise<void> {
  const res = await fetch(`${RTDB_BASE}/${path}.json?auth=${idToken}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`RTDB PUT ${path} failed: ${res.status} ${body}`);
  }
}

async function rtdbPatch(path: string, data: unknown, idToken: string): Promise<void> {
  const res = await fetch(`${RTDB_BASE}/${path}.json?auth=${idToken}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`RTDB PATCH ${path} failed: ${res.status} ${body}`);
  }
}

/** Allow HTTPS return URLs on BookaWaka hosts (or localhost for dev). */
function isAllowedCheckoutReturnUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || !raw.trim()) return false;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (u.protocol === "http:" && (host === "localhost" || host === "127.0.0.1")) return true;
    if (u.protocol !== "https:") return false;
    return (
      host === "localhost" ||
      host.endsWith(".up.railway.app") ||
      host.endsWith(".replit.app") ||
      host.endsWith(".replit.dev") ||
      host === "bookawaka.com" ||
      host.endsWith(".bookawaka.com") ||
      host.includes("bookawaka")
    );
  } catch {
    return false;
  }
}

router.post("/stripe/create-booking-payment", async (req, res) => {
  if (!STRIPE_SECRET_KEY) {
    res.status(503).json({ error: "Card payments are not configured yet. Please use cash or wallet." });
    return;
  }

  const {
    cid,
    bookingId,
    description,
    amount,
    currency = "nzd",
    email,
    walletAmountPending,
    successUrl: clientSuccessUrl,
    cancelUrl: clientCancelUrl,
  } = req.body;

  if (!bookingId || !amount || !description) {
    res.status(400).json({ error: "bookingId, amount, and description are required" });
    return;
  }

  try {
    const amountInCents = Math.round(Number(amount) * 100);
    if (isNaN(amountInCents) || amountInCents < 50) {
      res.status(400).json({ error: "Invalid amount — minimum is $0.50" });
      return;
    }

    const replit_domains = (process.env["REPLIT_DOMAINS"] ?? "").split(",");
    const baseUrl = replit_domains[0]
      ? `https://${replit_domains[0]}`
      : `http://localhost:${process.env["PORT"] ?? 8080}`;

    // Prefer client AuthSession return URLs so the Custom Tab dismisses into the app.
    // Fall back to API-hosted return pages (not bare /?payment=…) when client omits them.
    const success_url = isAllowedCheckoutReturnUrl(clientSuccessUrl)
      ? clientSuccessUrl
      : `${baseUrl}/api/passenger-app-return?booking=${encodeURIComponent(bookingId)}&cid=${encodeURIComponent(String(cid ?? ""))}&session_id={CHECKOUT_SESSION_ID}`;
    const cancel_url = isAllowedCheckoutReturnUrl(clientCancelUrl)
      ? clientCancelUrl
      : `${baseUrl}/api/passenger-app-cancel?booking=${encodeURIComponent(bookingId)}&cid=${encodeURIComponent(String(cid ?? ""))}`;

    const payload: Record<string, any> = {
      "payment_method_types[]": "card",
      "line_items[0][price_data][currency]": currency,
      "line_items[0][price_data][product_data][name]": description,
      "line_items[0][price_data][unit_amount]": amountInCents,
      "line_items[0][quantity]": 1,
      mode: "payment",
      success_url,
      cancel_url,
      "metadata[bookingId]": bookingId,
      "metadata[companyId]": cid ?? "",
      "metadata[type]": "booking_payment",
      "metadata[walletAmountPending]": String(walletAmountPending ?? 0),
    };

    if (email) {
      payload.customer_email = email;
    }

    const body = Object.entries(payload)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    const data = (await response.json()) as any;

    if (!response.ok) {
      res.status(502).json({ error: data?.error?.message ?? "Stripe session creation failed" });
      return;
    }

    res.json({ url: data.url, sessionId: data.id });
  } catch (err) {
    res.status(500).json({ error: "Failed to create payment session" });
  }
});

/**
 * Confirm Stripe (or wallet-only) then write pendingjobs — website parity.
 * Card holds must NEVER enter the live dispatch pool before this succeeds.
 */
router.post("/stripe/verify-and-dispatch", async (req: Request, res: Response) => {
  const idToken = extractToken(req);
  if (!idToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const {
    sessionId,
    bookingId,
    companyId,
    walletOnly,
    walletAmountPending,
    walletAmountApplied,
  } = req.body as {
    sessionId?: string;
    bookingId?: string;
    companyId?: string;
    walletOnly?: boolean;
    walletAmountPending?: number;
    walletAmountApplied?: number;
  };

  if (!bookingId || !companyId) {
    res.status(400).json({ error: "bookingId and companyId are required" });
    return;
  }

  if (!walletOnly && !sessionId) {
    res.status(400).json({ error: "sessionId is required unless walletOnly" });
    return;
  }

  try {
    let stripeSessionId: string | null = null;

    if (!walletOnly) {
      if (!STRIPE_SECRET_KEY) {
        res.status(503).json({ error: "Stripe not configured" });
        return;
      }
      const response = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId!)}`,
        { headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } },
      );
      const session = (await response.json()) as any;
      if (!response.ok) {
        res.status(502).json({ error: session?.error?.message ?? "Stripe retrieve failed" });
        return;
      }
      if (session.payment_status !== "paid") {
        res.status(402).json({ error: "Payment not completed", payment_status: session.payment_status });
        return;
      }
      const meta = session.metadata ?? {};
      if (
        meta.bookingId !== bookingId ||
        meta.companyId !== companyId ||
        meta.type !== "booking_payment"
      ) {
        res.status(403).json({ error: "Session metadata does not match booking" });
        return;
      }
      stripeSessionId = session.id;
    }

    const existing = await rtdbGet(`allbookings/${companyId}/${bookingId}`, idToken);
    if (!existing || typeof existing !== "object") {
      res.status(404).json({ error: "Booking not found" });
      return;
    }

    const authUid = uidFromIdToken(idToken);
    const existingPassengerUid = String(
      existing.passengerId || existing.PassengerId || existing.passengerUid || existing.PassengerUid || "",
    ).trim();
    // Prefer auth uid — allbookings often loses passengerId after dispatch fanout SETs.
    const passengerUid =
      (authUid && authUid !== "guest" ? authUid : "") ||
      (existingPassengerUid && existingPassengerUid !== "guest" && existingPassengerUid.length >= 20
        ? existingPassengerUid
        : "");

    const existingSt = String(existing.Status ?? existing.status ?? "").toLowerCase();
    if (
      existingSt === "cancelled" ||
      existingSt === "canceled" ||
      existingSt === "completed" ||
      existingSt === "closed"
    ) {
      // Still heal Passengerjobs if it was left on PendingPayment.
      if (passengerUid) {
        await rtdbPatch(
          `Passengerjobs/${passengerUid}/${bookingId}`,
          {
            Status: existing.Status ?? existing.status,
            status: existing.status ?? existing.Status,
            paymentStatus: existing.paymentStatus ?? existing.PaymentStatus ?? "paid",
            PaymentStatus: existing.PaymentStatus ?? existing.paymentStatus ?? "paid",
            passengerId: passengerUid,
          },
          idToken,
        ).catch(() => {});
      }
      res.json({ ok: true, alreadyDispatched: true, terminal: existingSt });
      return;
    }

    if (String(existing.paymentStatus ?? existing.PaymentStatus ?? "").toLowerCase() === "paid") {
      const pj = await rtdbGet(`pendingjobs/${companyId}/${bookingId}`, idToken).catch(() => null);
      if (!pj) {
        const scheduledMs = Number(existing.ScheduledFor ?? existing.scheduledFor ?? 0);
        const isScheduled = Number.isFinite(scheduledMs) && scheduledMs > Date.now() + 60_000;
        if (!isScheduled) {
          await rtdbPut(`pendingjobs/${companyId}/${bookingId}`, existing, idToken);
        }
      }
      if (passengerUid) {
        const st = String(existing.Status ?? existing.status ?? "Waiting");
        await rtdbPatch(
          `Passengerjobs/${passengerUid}/${bookingId}`,
          {
            Status: st,
            status: st,
            paymentStatus: "paid",
            PaymentStatus: "paid",
            isPrePaid: true,
            IsPrePaid: true,
            passengerId: passengerUid,
          },
          idToken,
        ).catch(() => {});
      }
      res.json({ ok: true, alreadyDispatched: true });
      return;
    }

    const paidAt = new Date().toISOString();
    const scheduledMs = Number(existing.ScheduledFor ?? existing.scheduledFor ?? 0);
    const isScheduled = Number.isFinite(scheduledMs) && scheduledMs > Date.now() + 60_000;
    const postPayStatus = isScheduled ? "Scheduled" : "Waiting";

    const pendingWallet =
      Number(walletAmountPending ?? existing.walletAmountPending ?? existing.WalletAmountPending ?? 0) || 0;
    const appliedWallet =
      Number(walletAmountApplied ?? (walletOnly ? pendingWallet : pendingWallet) ?? 0) || 0;

    const paidFields: Record<string, unknown> = {
      Status: postPayStatus,
      status: postPayStatus,
      BookingStatus: postPayStatus,
      paymentMethod: walletOnly ? "wallet" : "card",
      PaymentMethod: walletOnly ? "wallet" : "card",
      paymentStatus: "paid",
      PaymentStatus: "paid",
      isPrePaid: true,
      IsPrePaid: true,
      paidAt,
      PaidAt: paidAt,
      BookingSource: existing.BookingSource || existing.Source || "PassengerApp",
      Source: existing.Source || "PassengerApp",
      CreatedBy: existing.CreatedBy || "APP",
      // Keep Firebase uid on allbookings so dispatch complete can mirror Passengerjobs.
      ...(passengerUid
        ? { passengerId: passengerUid, PassengerUid: passengerUid, passengerUid }
        : {}),
    };
    if (stripeSessionId) {
      paidFields.stripeSessionId = stripeSessionId;
      paidFields.StripeSessionId = stripeSessionId;
    }
    if (appliedWallet > 0) {
      paidFields.walletAmountApplied = appliedWallet;
      paidFields.WalletAmountApplied = appliedWallet;
      paidFields.walletAmountPending = null;
      paidFields.WalletAmountPending = null;
      paidFields.walletDebited = true;
    }

    const paidBooking = { ...existing, ...paidFields };

    await rtdbPatch(`allbookings/${companyId}/${bookingId}`, paidFields, idToken);

    if (passengerUid) {
      await rtdbPatch(`Passengerjobs/${passengerUid}/${bookingId}`, paidFields, idToken).catch((e) => {
        req.log?.warn?.({ err: (e as Error).message, passengerUid, bookingId }, "Passengerjobs paid patch failed");
      });
    } else {
      req.log?.warn?.({ bookingId, companyId }, "verify-and-dispatch: no passengerUid — Passengerjobs not updated");
    }

    if (!isScheduled) {
      await rtdbPut(`pendingjobs/${companyId}/${bookingId}`, paidBooking, idToken);
    }

    req.log?.info?.(
      { bookingId, companyId, postPayStatus, walletOnly: !!walletOnly },
      "verify-and-dispatch: card/wallet paid — released to dispatch",
    );
    res.json({ ok: true, alreadyDispatched: false, status: postPayStatus });
  } catch (err: any) {
    req.log?.error?.({ err }, "POST /stripe/verify-and-dispatch error");
    res.status(500).json({ error: err.message ?? "Verification failed" });
  }
});

export default router;
