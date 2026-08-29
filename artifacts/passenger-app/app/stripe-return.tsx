import { Redirect, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useRide } from "@/context/RideContext";
import { verifyAndDispatchBooking } from "@/lib/stripePayment";

/**
 * Deep-link target for Stripe return: passenger-app://stripe-return?booking&cid&session_id
 * Must verify payment + restore Active Ride — AuthSession often remounts with empty memory
 * or never finishes when the user taps "Go back to app".
 */
export default function StripeReturnScreen() {
  const { activeRide, resumeActiveRide, hydrateReady, markPaymentConfirmed } = useRide();
  const params = useLocalSearchParams<{
    booking?: string;
    cid?: string;
    companyId?: string;
    session_id?: string;
    sessionId?: string;
    kind?: string;
  }>();

  const booking = String(params.booking || "").trim();
  const cid = String(params.cid || params.companyId || "").trim();
  const sessionId = String(params.session_id || params.sessionId || "").trim();
  const kind = String(params.kind || "success").trim().toLowerCase();
  const [phase, setPhase] = useState<"working" | "done" | "fail">("working");
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (!hydrateReady || ran.current) return;
    if (!booking) {
      setPhase("done");
      return;
    }
    ran.current = true;
    let cancelled = false;

    (async () => {
      try {
        if (kind !== "cancel" && cid && sessionId) {
          await verifyAndDispatchBooking({
            companyId: cid,
            bookingId: booking,
            sessionId,
          });
          try {
            markPaymentConfirmed();
          } catch {
            /* optional if ride not in memory yet */
          }
        }
        if (cid) {
          await resumeActiveRide(cid, booking);
        }
        if (!cancelled) setPhase("done");
      } catch (e) {
        console.warn("[stripe-return] restore failed:", e);
        // Still try resume — verify may have already succeeded server-side.
        if (cid) {
          try {
            await resumeActiveRide(cid, booking);
          } catch {
            /* ignore */
          }
        }
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setPhase(activeRide ? "done" : "fail");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    hydrateReady,
    booking,
    cid,
    sessionId,
    kind,
    resumeActiveRide,
    markPaymentConfirmed,
    activeRide,
  ]);

  if (phase === "working" || (!hydrateReady && booking)) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 12, textAlign: "center", opacity: 0.7 }}>
          Confirming payment and restoring your ride…
        </Text>
      </View>
    );
  }

  if (phase === "fail" && !activeRide) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ textAlign: "center", marginBottom: 8 }}>
          {error || "Could not restore your ride."}
        </Text>
        <Text style={{ textAlign: "center", opacity: 0.7 }}>
          Check My Rides before booking again — do not pay twice.
        </Text>
        <Redirect href="/(tabs)" />
      </View>
    );
  }

  // Keep booking + cid so Active Ride can resume if memory is still empty.
  if (booking && cid) {
    return (
      <Redirect
        href={{
          pathname: "/active-ride",
          params: { booking, cid },
        }}
      />
    );
  }

  if (activeRide) {
    return <Redirect href="/active-ride" />;
  }

  return <Redirect href="/(tabs)" />;
}
