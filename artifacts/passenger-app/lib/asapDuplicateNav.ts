import { Alert } from "react-native";
import { router } from "expo-router";
import {
  ACTIVE_ASAP_LATER_ONLY_MSG,
  ACTIVE_ASAP_LATER_ONLY_TITLE,
} from "@/lib/asapDuplicateUx";

export function beginTaxiBooking(hasLiveAsap: boolean): void {
  if (!hasLiveAsap) {
    router.push("/booking");
    return;
  }
  Alert.alert(ACTIVE_ASAP_LATER_ONLY_TITLE, ACTIVE_ASAP_LATER_ONLY_MSG, [
    { text: "View active job", onPress: () => router.push("/active-ride") },
    { text: "Book for Later", onPress: () => router.push("/booking?initialScheduled=true") },
  ]);
}

export function beginLaterBooking(): void {
  router.push("/booking?initialScheduled=true");
}
