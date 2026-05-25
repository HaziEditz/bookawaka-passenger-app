import { Platform, Linking } from "react-native";
import * as WebBrowser from "expo-web-browser";

const apiBase = (): string => {
  const raw = process.env.EXPO_PUBLIC_API_URL ?? "";
  const url = raw || (process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}/api` : "");
  // Strip port — Replit proxies through standard HTTPS
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
}

/**
 * Calls the server to create a Stripe Checkout session and opens the URL.
 * On native → in-app browser via expo-web-browser.
 * On web → new tab via Linking.
 *
 * Returns `true` if the browser was opened successfully.
 */
export async function openStripeCheckout(params: StripeCheckoutParams): Promise<boolean> {
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
  if (!url) throw new Error("No checkout URL returned from server.");

  if (Platform.OS === "web") {
    await Linking.openURL(url);
  } else {
    await WebBrowser.openBrowserAsync(url, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
    });
  }

  return true;
}
