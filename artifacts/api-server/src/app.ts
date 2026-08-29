import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * Stripe Checkout return pages for the native passenger app.
 * AuthSession watches these HTTPS prefixes; we also deep-link into the app with
 * booking/cid/session_id so Active Ride restores even when AuthSession dismisses
 * without completing (Android "Go back to app" / task switch).
 *
 * Served under /api/… because production routes the Express API there; bare
 * /passenger-app-return is intercepted by the public website SPA — keep both.
 */
function passengerAppReturnHtml(
  kind: "success" | "cancel",
  qs: { booking?: string; cid?: string; sessionId?: string },
): string {
  const title = kind === "success" ? "Payment complete" : "Payment cancelled";
  const body =
    kind === "success"
      ? "Payment received. Returning you to BookaWaka…"
      : "Payment was cancelled. Returning you to BookaWaka…";
  const booking = encodeURIComponent(String(qs.booking || "").trim());
  const cid = encodeURIComponent(String(qs.cid || "").trim());
  const sessionId = encodeURIComponent(String(qs.sessionId || "").trim());
  const path = kind === "success" ? "stripe-return" : "stripe-return";
  const deep = `passenger-app://${path}?booking=${booking}&cid=${cid}&session_id=${sessionId}&kind=${kind}`;
  const deepJson = JSON.stringify(deep);
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#f8fafc;text-align:center;padding:24px}
  h1{font-size:1.35rem;margin:0 0 8px}p{opacity:.85;margin:0 0 16px;line-height:1.45}
  a{display:inline-block;padding:12px 18px;border-radius:10px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600}
</style>
</head><body>
  <div>
    <h1>${title}</h1>
    <p>${body}</p>
    <a id="openApp" href=${deepJson}>Open BookaWaka</a>
  </div>
  <script>
    (function () {
      var deep = ${deepJson};
      try { window.location.href = deep; } catch (e) {}
      setTimeout(function () {
        try { window.location.replace(deep); } catch (e) {}
      }, 250);
      setTimeout(function () { try { window.close(); } catch (e) {} }, 1200);
    })();
  </script>
</body></html>`;
}

function sendPassengerReturn(kind: "success" | "cancel", req: Request, res: Response) {
  const booking = typeof req.query.booking === "string" ? req.query.booking : "";
  const cid = typeof req.query.cid === "string" ? req.query.cid : "";
  const sessionId =
    typeof req.query.session_id === "string"
      ? req.query.session_id
      : typeof req.query.sessionId === "string"
        ? req.query.sessionId
        : "";
  res.status(200).type("html").send(passengerAppReturnHtml(kind, { booking, cid, sessionId }));
}

app.get("/passenger-app-return", (req, res) => sendPassengerReturn("success", req, res));
app.get("/passenger-app-cancel", (req, res) => sendPassengerReturn("cancel", req, res));
app.get("/api/passenger-app-return", (req, res) => sendPassengerReturn("success", req, res));
app.get("/api/passenger-app-cancel", (req, res) => sendPassengerReturn("cancel", req, res));

app.use("/api", router);

export default app;
