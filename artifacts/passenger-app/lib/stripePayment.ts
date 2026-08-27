import { Platform, Linking } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { auth } from "@/lib/firebase";

const apiBase = (): string => {
  const raw = process.env.EXPO_PUBLIC_API_URL ?? "";
  const url = raw || (process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}/api` : "");
  const clean = url.replace(/^(https?:\/\/[^/:]+):\d+(\/|$)/, "$1$2");
  return clean.replace(/\/api$/, "");
};

export interface StripeCheckoutParams {
  cid: string;
  bookingId: string;
  description: string;
  amount: number;
  currency?: string;
  email?: string;
  walletAmountPending?: number;
}

export interface StripeCheckoutResult {
  sessionId: string;
  url: string;
}

/**
 * Creates a Stripe Checkout session and opens the URL.
 * Returns sessionId so the caller can verify-and-dispatch after the browser closes.
 *
 * Native return URLs must be HTTPS on our allowlisted host (not passenger-app://).
 * Stripe → custom-scheme redirects show Chrome "site can't be reached" when the
 * Custom Tab fails to hand off the scheme; AuthSession completes cleanly on HTTPS.
 */
export async function openStripeCheckout(params: StripeCheckoutParams): Promise<StripeCheckoutResult> {
  const base = apiBase();
  const endpoint = base
    ? `${base}/api/stripe/create-booking-payment`
    : "/api/stripe/create-booking-payment";

  const useAppReturn = Platform.OS !== "web";
  const returnHost = base || "https://bookawaka-production.up.railway.app";
  // Must be under /api/… — bare /passenger-app-return hits the public website SPA on this host.
  const successUrl = useAppReturn
    ? `${returnHost}/api/passenger-app-return?booking=${encodeURIComponent(params.bookingId)}&cid=${encodeURIComponent(params.cid)}&session_id={CHECKOUT_SESSION_ID}`
    : undefined;
  const cancelUrl = useAppReturn
    ? `${returnHost}/api/passenger-app-cancel?booking=${encodeURIComponent(params.bookingId)}&cid=${encodeURIComponent(params.cid)}`
    : undefined;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cid: params.cid,
        bookingId: params.bookingId,
        description: params.description,
        amount: params.amount,
        currency: params.currency ?? "nzd",
        email: params.email ?? undefined,
        walletAmountPending: params.walletAmountPending ?? 0,
        ...(successUrl ? { successUrl } : {}),
        ...(cancelUrl ? { cancelUrl } : {}),
      }),
    });
  } catch {
    throw new Error("Could not reach the payment server. Please check your connection.");
  }

  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new Error("Unexpected response from payment server.");
  }

  if (!res.ok) {
    throw new Error(json?.error ?? `Payment error (${res.status}). Please try another method.`);
  }

  const url: string = json?.url;
  const sessionId: string = json?.sessionId;
  if (!url) throw new Error("No checkout URL returned from server.");
  if (!sessionId) throw new Error("No Stripe session id returned from server.");

  if (Platform.OS === "web") {
    await Linking.openURL(url);
  } else {
    // Match the HTTPS return path prefix so Custom Tabs dismiss into the app
    // instead of trying to render passenger-app:// as a website.
    const redirectUrl = `${returnHost}/api/passenger-app-return`;
    const AUTH_SESSION_TIMEOUT_MS = 6 * 60 * 1000;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      void WebBrowser.dismissBrowser().catch(() => undefined);
    }, AUTH_SESSION_TIMEOUT_MS);
    try {
      await WebBrowser.openAuthSessionAsync(url, redirectUrl);
    } finally {
      clearTimeout(timeoutId);
    }
    if (timedOut) {
      console.warn("[stripePayment] AuthSession dismissed after timeout — continuing verify path");
    }
  }

  return { sessionId, url };
}

export interface VerifyDispatchParams {
  companyId: string;
  bookingId: string;
  sessionId?: string;
  walletOnly?: boolean;
  walletAmountPending?: number;
  walletAmountApplied?: number;
}

/** After Stripe (or wallet-only), release the card hold into pendingjobs. */
export async function verifyAndDispatchBooking(params: VerifyDispatchParams): Promise<void> {
  const base = apiBase();
  const endpoint = base
    ? `${base}/api/stripe/verify-and-dispatch`
    : "/api/stripe/verify-and-dispatch";

  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Not signed in — cannot confirm payment.");

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    });
  } catch {
    throw new Error("Could not confirm payment with the server. Please check My Rides — do not rebook.");
  }

  let json: any = {};
  try {
    json = await res.json();
  } catch {
    /* ignore */
  }

  if (!res.ok) {
    throw new Error(json?.error ?? `Payment confirmation failed (${res.status}).`);
  }
}
