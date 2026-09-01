import { Redirect, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { get as rtdbGet, ref as rtdbRef } from "firebase/database";
import { useNotification } from "@/context/NotificationContext";
import { useRide } from "@/context/RideContext";
import { rtdb } from "@/lib/firebase";
import { isPreDispatchScheduledJob, pickAuthoritativeStatus } from "@/lib/passengerJobRecover";
import { verifyAndDispatchBooking } from "@/lib/stripePayment";

const VERIFY_TIMEOUT_MS = 12_000;
const HARD_FINISH_MS = 15_000;

type Phase = "working" | "done" | "fail" | "scheduled_done";

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
 * setPhase on a cancelled flag tied to activeRide; hard wall-clock finish.
 *
 * Later/scheduled: never hand off to /active-ride "Finding your driver…" — confirm
 * and send Home; job lives on Schedule tab.
 */
export default function StripeReturnScreen() {
  const { activeRide, resumeActiveRide, hydrateReady, markPaymentConfirmed, clearRide } = useRide();
  const { notify } = useNotification();
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
  const [phase, setPhase] = useState<Phase>("working");
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);
  const resumeRef = useRef(resumeActiveRide);
  const markPaidRef = useRef(markPaymentConfirmed);
  const clearRideRef = useRef(clearRide);
  const notifyRef = useRef(notify);
  resumeRef.current = resumeActiveRide;
  markPaidRef.current = markPaymentConfirmed;
  clearRideRef.current = clearRide;
  notifyRef.current = notify;

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
          } catch (e) {
            verifyErr = e instanceof Error ? e.message : String(e);
            console.warn("[stripe-return] verify (non-fatal):", verifyErr);
          }
        }

        // Detect Later booking BEFORE resume — resume must not create Active Ride for Scheduled.
        let scheduled = false;
        if (cid && booking) {
          try {
            const [abSnap, pendSnap] = await Promise.all([
              rtdbGet(rtdbRef(rtdb, `allbookings/${cid}/${booking}`)).catch(() => null),
              rtdbGet(rtdbRef(rtdb, `pendingjobs/${cid}/${booking}`)).catch(() => null),
            ]);
            const ab = abSnap?.exists?.() ? (abSnap.val() as Record<string, unknown>) : null;
            const pend = pendSnap?.exists?.() ? (pendSnap.val() as Record<string, unknown>) : null;
            const st = pickAuthoritativeStatus(pend, ab, null);
            const merged = { ...(ab || {}), ...(pend || {}) };
            scheduled = isPreDispatchScheduledJob(st, merged);
          } catch {
            /* fall through */
          }
        }

        if (scheduled) {
          try {
            clearRideRef.current();
          } catch {
            /* ignore */
          }
          notifyRef.current(
            "Booking confirmed",
            "Booking done, company notified — check your Schedule tab to edit or cancel.",
            "success",
          );
          setPhase("scheduled_done");
          return;
        }

        if (cid) {
          await resumeRef.current(cid, booking);
        }

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
        setPhase("done");
      }
    })();
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

  if (phase === "scheduled_done") {
    return <Redirect href="/(tabs)" />;
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

  // ASAP only — Later was handled above as scheduled_done.
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
