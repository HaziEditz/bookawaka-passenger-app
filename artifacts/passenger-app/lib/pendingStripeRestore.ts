import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@bookawaka/pending_stripe_restore";

export type PendingStripeRestore = {
  bookingId: string;
  companyId: string;
  sessionId: string;
  at: number;
};

export async function savePendingStripeRestore(p: PendingStripeRestore): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export async function loadPendingStripeRestore(): Promise<PendingStripeRestore | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingStripeRestore;
    if (!p?.bookingId || !p?.companyId || !p?.sessionId) return null;
    // Discard after 30 minutes
    if (Date.now() - Number(p.at || 0) > 30 * 60 * 1000) {
      await clearPendingStripeRestore();
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

export async function clearPendingStripeRestore(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
