import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/**
 * Audible + haptic alert when the driver arrives at pickup.
 * Uses the OS notification channel sound when available; always fires a haptic.
 */
export async function alertPassengerDriverArrived(): Promise<void> {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    /* haptics unavailable */
  }

  try {
    const Notifications = await import("expo-notifications");
    const soundName = Platform.OS === "android" ? "default" : "default";
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Driver has arrived!",
        body: "Your driver is waiting at the pickup point",
        sound: soundName,
        data: { kind: "driver_arrived" },
      },
      trigger: null,
    });
  } catch (err) {
    console.warn("[arrivalAlert] notification sound failed:", err);
  }
}
