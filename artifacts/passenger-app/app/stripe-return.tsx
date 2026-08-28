import { Redirect, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useRide } from "@/context/RideContext";

/**
 * Deep-link target for Stripe return: passenger-app://stripe-return?...
 * Must restore Active Ride by booking id — AuthSession often remounts with empty memory.
 */
export default function StripeReturnScreen() {
  const { activeRide, resumeActiveRide, hydrateReady } = useRide();
  const params = useLocalSearchParams<{ booking?: string; cid?: string; companyId?: string }>();
  const booking = String(params.booking || "").trim();
  const cid = String(params.cid || params.companyId || "").trim();
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!hydrateReady || tried || activeRide || !booking) return;
    let cancelled = false;
    (async () => {
      if (cid) {
        await resumeActiveRide(cid, booking);
      } else {
        // cid missing — try common company from snapshot paths via resume after Passengerjobs scan
        // resumeActiveRide needs cid; home recover effect will pick it up.
      }
      if (!cancelled) setTried(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrateReady, tried, activeRide, booking, cid, resumeActiveRide]);

  if (!hydrateReady || (booking && !activeRide && !tried)) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (activeRide || booking) {
    return <Redirect href="/active-ride" />;
  }
  return <Redirect href="/(tabs)" />;
}
