import { Router } from "express";
import { getUncachableResendClient } from "../lib/resend.js";
import { logger } from "../lib/logger.js";

const router = Router();

function bookingEmailHtml(b: {
  passengerName: string;
  pickup: string;
  destination: string;
  vehicleType: string;
  fare: string;
  payment: string;
  scheduledFor?: string;
  bookingId: string;
  companyName: string;
  passengerPhone?: string;
  passengerEmail?: string;
  stops?: string[];
}): string {
  const isScheduled = !!b.scheduledFor;
  const accentColor = isScheduled ? "#7c3aed" : "#1e40af";
  const badgeText = isScheduled ? "SCHEDULED BOOKING" : "NEW BOOKING";
  const stopsHtml = b.stops && b.stops.length > 0
    ? b.stops.map((s, i) => `
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:13px;">Stop ${i + 1}</td>
          <td style="padding:6px 0;color:#111827;font-size:13px;">${s}</td>
        </tr>`).join("")
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:${accentColor};padding:28px 32px;">
            <p style="margin:0;color:rgba(255,255,255,0.8);font-size:11px;letter-spacing:1.5px;font-weight:600;">${badgeText}</p>
            <h1 style="margin:6px 0 0;color:#ffffff;font-size:22px;font-weight:700;">
              ${b.passengerName} needs a ${b.vehicleType}
            </h1>
            <p style="margin:4px 0 0;color:rgba(255,255,255,0.75);font-size:13px;">Booking #${b.bookingId.slice(-8).toUpperCase()}</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:28px 32px;">

            ${isScheduled ? `
            <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:14px 16px;margin-bottom:24px;">
              <p style="margin:0;font-size:12px;color:#7c3aed;font-weight:600;letter-spacing:1px;">SCHEDULED FOR</p>
              <p style="margin:4px 0 0;font-size:18px;color:#4c1d95;font-weight:700;">${b.scheduledFor}</p>
            </div>` : ""}

            <!-- Route -->
            <p style="margin:0 0 12px;font-size:11px;color:#9ca3af;font-weight:600;letter-spacing:1px;">ROUTE</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td style="padding:6px 0;color:#6b7280;font-size:13px;">Pickup</td>
                <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;">${b.pickup}</td>
              </tr>
              ${stopsHtml}
              <tr>
                <td style="padding:6px 0;color:#6b7280;font-size:13px;">Drop-off</td>
                <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;">${b.destination}</td>
              </tr>
            </table>

            <!-- Details -->
            <p style="margin:0 0 12px;font-size:11px;color:#9ca3af;font-weight:600;letter-spacing:1px;">BOOKING DETAILS</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td style="padding:6px 0;color:#6b7280;font-size:13px;">Vehicle</td>
                <td style="padding:6px 0;color:#111827;font-size:13px;">${b.vehicleType}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#6b7280;font-size:13px;">Est. Fare</td>
                <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;">${b.fare}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#6b7280;font-size:13px;">Payment</td>
                <td style="padding:6px 0;color:#111827;font-size:13px;">${b.payment}</td>
              </tr>
            </table>

            ${(b.passengerPhone || b.passengerEmail) ? `
            <!-- Passenger Contact -->
            <p style="margin:0 0 12px;font-size:11px;color:#9ca3af;font-weight:600;letter-spacing:1px;">PASSENGER CONTACT</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              ${b.passengerPhone ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Phone</td><td style="padding:6px 0;color:#111827;font-size:13px;">${b.passengerPhone}</td></tr>` : ""}
              ${b.passengerEmail ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Email</td><td style="padding:6px 0;color:#111827;font-size:13px;">${b.passengerEmail}</td></tr>` : ""}
            </table>` : ""}

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:18px 32px;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">
              This booking was placed through the Waka passenger app for <strong style="color:#6b7280;">${b.companyName}</strong>.
              Please log in to your dispatcher to accept or manage this job.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

router.post("/notify-booking", async (req, res) => {
  const {
    companyEmail,
    companyName,
    passengerName,
    pickup,
    destination,
    vehicleType,
    fare,
    payment,
    scheduledFor,
    bookingId,
    passengerPhone,
    passengerEmail,
    stops,
  } = req.body as Record<string, any>;

  if (!companyEmail || !bookingId || !pickup || !destination) {
    res.status(400).json({ error: "companyEmail, bookingId, pickup and destination are required" });
    return;
  }

  try {
    const { client, fromEmail } = await getUncachableResendClient();

    const isScheduled = !!scheduledFor;
    const subject = isScheduled
      ? `Scheduled booking from ${passengerName ?? "Passenger"} — ${new Date(scheduledFor).toLocaleString("en-NZ")}`
      : `New booking from ${passengerName ?? "Passenger"} — ${pickup?.split(",")[0]} to ${destination?.split(",")[0]}`;

    const html = bookingEmailHtml({
      passengerName: passengerName ?? "Passenger",
      pickup,
      destination,
      vehicleType: vehicleType ?? "Taxi",
      fare: fare ?? "TBC",
      payment: payment ?? "Cash",
      scheduledFor: isScheduled ? new Date(scheduledFor).toLocaleString("en-NZ", { dateStyle: "full", timeStyle: "short" }) : undefined,
      bookingId,
      companyName: companyName ?? "Your Company",
      passengerPhone,
      passengerEmail,
      stops: Array.isArray(stops) ? stops : [],
    });

    const result = await client.emails.send({
      from: fromEmail ?? "bookings@yourtaxi.app",
      to: companyEmail,
      subject,
      html,
    });

    req.log.info({ bookingId, companyEmail, resendId: result.data?.id }, "Booking email sent");
    res.json({ ok: true, id: result.data?.id });
  } catch (err: any) {
    logger.error({ err: err.message }, "Failed to send booking email");
    res.status(500).json({ error: "Email send failed", detail: err.message });
  }
});

export default router;
