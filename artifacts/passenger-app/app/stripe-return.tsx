import { Redirect, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useRide } from "@/context/RideContext";
import { verifyAndDispatchBooking } from "@/lib/stripePayment";

const VERIFY_TIMEOUT_MS = 12_000;
const HARD_FINISH_MS = 15_000;

/**
 * Deep-link target for Stripe return: passenger-app://stripe-return?booking&cid&session_id
 *
 * Warm-path hang (live retest): spinner forever on "Confirming payment and restoring…"
 * while cold start hydrate worked. Root causes (reproduced in
 * INVT-APP2/tmp/_probe-stripe-return-hang.mjs):
 * 1) Effect deps included `activeRide` — successful resume set activeRide → cleanup
 *    set cancelled=true → `if (!cancelled) setPhase("done")` never ran; ran.current
 *    blocked a second attempt.
 * 2) `await verify` before resume — a hung verify never reached resume.
 *
 * Fix: resume first; verify with timeout (non-blocking for navigation); never gate
 * setPhase on a cancelled flag tied to activeRide; hard wall-clock finish →
 * Redirect to /active-ride with booking+cid (same as cold-start recovery).
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
  const resumeRef = useRef(resumeActiveRide);
  const markPaidRef = useRef(markPaymentConfirmed);
  resumeRef.current = resumeActiveRide;
  markPaidRef.current = markPaymentConfirmed;

  // Hard fallback: never spin forever — hand off to /active-ride with ids.
  useEffect(() => {
    const t = setTimeout(() => {
      setPhase((p) => (p === "working" ? "done" : p));
    }, HARD_FINISH_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!hydrateReady || ran.current) return;
    if (!booking) {
      setPhase("done");
      return;
    }
    ran.current = true;

    (async () => {
      let verifyErr: string | null = null;
      try {
        // Resume FIRST — payment/driver accept may already be live (cold hydrate proves data).
        if (cid) {
          await resumeRef.current(cid, booking);
        }

        if (kind !== "cancel" && cid && sessionId) {
          try {
            await Promise.race([
              verifyAndDispatchBooking({
                companyId: cid,
                bookingId: booking,
                sessionId,
              }),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("verify-timeout")), VERIFY_TIMEOUT_MS),
              ),
            ]);
            try {
              markPaidRef.current();
            } catch {
              /* ride may still be attaching */
            }
            // Resume again after verify — pendingjobs may only exist post-dispatch.
            if (cid) await resumeRef.current(cid, booking);
          } catch (e) {
            verifyErr = e instanceof Error ? e.message : String(e);
            console.warn("[stripe-return] verify (non-fatal):", verifyErr);
            if (cid) {
              try {
                await resumeRef.current(cid, booking);
              } catch {
                /* ignore */
              }
            }
          }
        }

        // Always leave working — do NOT suppress on effect cleanup / activeRide updates.
        setPhase("done");
      } catch (e) {
        console.warn("[stripe-return] restore failed:", e);
        if (cid) {
          try {
            await resumeRef.current(cid, booking);
          } catch {
            /* ignore */
          }
        }
        setError(e instanceof Error ? e.message : String(e));
        // Prefer handoff with booking+cid over permanent fail spinner.
        setPhase("done");
      }
    })();
    // Intentionally omit activeRide / resumeActiveRide / markPaymentConfirmed —
    // those identities changing mid-flight previously cancelled setPhase("done").
  }, [hydrateReady, booking, cid, sessionId, kind]);

  if (phase === "working" || (!hydrateReady && booking && phase === "working")) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 12, textAlign: "center", opacity: 0.7 }}>
          Confirming payment and restoring your ride…
        </Text>
      </View>
    );
  }

  if (phase === "fail" && !activeRide && !(booking && cid)) {
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
