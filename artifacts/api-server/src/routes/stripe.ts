import { Router } from "express";

const router = Router();
const STRIPE_SECRET_KEY = process.env["STRIPE_SECRET_KEY"] ?? "";

router.post("/stripe/create-booking-payment", async (req, res) => {
  if (!STRIPE_SECRET_KEY) {
    res.status(503).json({ error: "Card payments are not configured yet. Please use cash or wallet." });
    return;
  }

  const { cid, bookingId, description, amount, currency = "nzd", email } = req.body;

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

    const payload: Record<string, any> = {
      "payment_method_types[]": "card",
      "line_items[0][price_data][currency]": currency,
      "line_items[0][price_data][product_data][name]": description,
      "line_items[0][price_data][unit_amount]": amountInCents,
      "line_items[0][quantity]": 1,
      mode: "payment",
      success_url: `${baseUrl}/?payment=success&booking=${bookingId}`,
      cancel_url: `${baseUrl}/?payment=cancelled&booking=${bookingId}`,
      "metadata[bookingId]": bookingId,
      "metadata[companyId]": cid ?? "",
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

    const data = await response.json() as any;

    if (!response.ok) {
      res.status(502).json({ error: data?.error?.message ?? "Stripe session creation failed" });
      return;
    }

    res.json({ url: data.url, sessionId: data.id });
  } catch (err) {
    res.status(500).json({ error: "Failed to create payment session" });
  }
});

export default router;
