import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ActiveRide } from "@/context/RideContext";

const KEY = "bookawaka.activeRide.v1";

/** Persist a serializable snapshot of the in-progress passenger ride. */
export async function saveActiveRideSnapshot(ride: ActiveRide | null): Promise<void> {
  try {
    if (!ride || !ride.firestoreId || !ride.companyId) {
      await AsyncStorage.removeItem(KEY);
      return;
    }
    // Terminal local statuses — don't keep rehydrating a finished ride.
    if (
      ride.status === "completed" ||
      ride.status === "cancelled" ||
      ride.status === "no_show" ||
      ride.status === "cancel_requested"
    ) {
      await AsyncStorage.removeItem(KEY);
      return;
    }
    await AsyncStorage.setItem(KEY, JSON.stringify(ride));
  } catch (e) {
    console.warn("[activeRidePersist] save failed:", e);
  }
}

export async function loadActiveRideSnapshot(): Promise<ActiveRide | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveRide;
    if (!parsed?.firestoreId || !parsed?.companyId) return null;
    if (
      parsed.status === "completed" ||
      parsed.status === "cancelled" ||
      parsed.status === "no_show" ||
      parsed.status === "cancel_requested"
    ) {
      await AsyncStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch (e) {
    console.warn("[activeRidePersist] load failed:", e);
    return null;
  }
}

export async function clearActiveRideSnapshot(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
