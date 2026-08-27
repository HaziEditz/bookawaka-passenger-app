import express, { type Express } from "express";
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
 * AuthSession watches these HTTPS prefixes; the page auto-closes / tells the user
 * to return to the app so the Custom Tab dismisses instead of hanging forever.
 */
function passengerAppReturnHtml(kind: "success" | "cancel"): string {
  const title = kind === "success" ? "Payment complete" : "Payment cancelled";
  const body =
    kind === "success"
      ? "Payment received. You can close this window and return to BookaWaka."
      : "Payment was cancelled. You can close this window and return to BookaWaka.";
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#f8fafc;text-align:center;padding:24px}
  h1{font-size:1.35rem;margin:0 0 8px}p{opacity:.85;margin:0;line-height:1.45}
</style>
</head><body>
  <div>
    <h1>${title}</h1>
    <p>${body}</p>
  </div>
  <script>
    try { window.close(); } catch (e) {}
    setTimeout(function () { try { window.close(); } catch (e) {} }, 400);
  </script>
</body></html>`;
}

app.get("/passenger-app-return", (_req, res) => {
  res.status(200).type("html").send(passengerAppReturnHtml("success"));
});
app.get("/passenger-app-cancel", (_req, res) => {
  res.status(200).type("html").send(passengerAppReturnHtml("cancel"));
});

app.use("/api", router);

export default app;
