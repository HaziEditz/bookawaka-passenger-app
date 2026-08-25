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
 */
export async function openStripeCheckout(params: StripeCheckoutParams): Promise<StripeCheckoutResult> {
  const base = apiBase();
  const endpoint = base
    ? `${base}/api/stripe/create-booking-payment`
    : "/api/stripe/create-booking-payment";

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
    await WebBrowser.openBrowserAsync(url, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
    });
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
