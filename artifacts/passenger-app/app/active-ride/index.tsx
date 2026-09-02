import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as Updates from "expo-updates";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PlacesAutocomplete } from "@/components/PlacesAutocomplete";
import { RouteMap } from "@/components/RouteMap";
import { useRide, SearchPhase, computeCancelPolicy, haversineKm } from "@/context/RideContext";
import { useNotification } from "@/context/NotificationContext";
import { useCompanies } from "@/context/CompaniesContext";
import { formatCurrency } from "@/lib/fareCalculator";
import { useColors } from "@/hooks/useColors";
import { PlaceDetail } from "@/lib/googlePlaces";
import { resolvePlacesBias, INVERCARGILL_PLACES_BIAS } from "@/lib/placesBias";

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Driver confirmed",
  on_the_way: "Driver is on the way",
  arrived: "Driver has arrived",
  in_progress: "Trip in progress",
  completed: "Trip complete",
  cancelled: "Cancelled by operator",
  cancel_requested: "Cancellation requested…",
  no_show: "No show — ride ended",
};

const STATUS_COLORS: Record<string, string> = {
  searching: "#f59e0b",
  confirmed: "#3b82f6",
  on_the_way: "#3b82f6",
  arrived: "#22c55e",
  in_progress: "#1e40af",
  completed: "#22c55e",
  cancelled: "#ef4444",
  cancel_requested: "#9ca3af",
  no_show: "#ef4444",
};

function useElapsedTime(running: boolean) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) { setElapsed(0); return; }
    setElapsed(0);
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function searchLabel(phase: SearchPhase | undefined, elapsed: string): string {
  switch (phase) {
    case "offered":
      return `Finding you a driver — almost there (${elapsed})`;
    case "queued":
      return `You're in the queue — a driver will take your booking shortly (${elapsed})`;
    case "waiting":
      return `Booking created — we'll find you a driver (${elapsed})`;
    default:
      return `Booking created — we'll find you a driver (${elapsed})`;
  }
}

export default function ActiveRideScreen() {
  const colors = useColors();
  const { notify } = useNotification();
  const { activeRide, driverLocation, cancelRide, addStop, editDestination, clearRide, signalImComing, recordCompletedTripHistory, hydrateReady, resumeActiveRide } = useRide();
  const { companies } = useCompanies();
  const params = useLocalSearchParams<{ booking?: string; cid?: string; companyId?: string }>();
  const insets = useSafeAreaInsets();
  const placesBias = useMemo(() => {
    const cid = String(activeRide?.companyId || "").trim();
    const co = companies.find((c) => c.id === cid);
    if (!co) return INVERCARGILL_PLACES_BIAS;
    return resolvePlacesBias({
      city: (co as { city?: string }).city,
      country: (co as { country?: string }).country,
      companyName: co.name,
    });
  }, [activeRide?.companyId, companies]);
  const elapsed = useElapsedTime(activeRide?.status === "searching");
  const [chatOpen, setChatOpen] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);

  const [shareModal, setShareModal] = useState(false);
  const [copiedRef, setCopiedRef] = useState(false);

  // Give the RideContext a moment to settle after navigation before redirecting.
  // Without this, a fast render cycle can see activeRide=null momentarily and
  // redirect back to home even though a ride was just created.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 400);
    return () => clearTimeout(t);
  }, []);

  // Deep link / Stripe return: restore by booking id before giving up.
  const [resumeAttempted, setResumeAttempted] = useState(false);
  const [resumeFailed, setResumeFailed] = useState(false);
  useEffect(() => {
    const booking = String(params.booking || "").trim();
    const cid = String(params.cid || params.companyId || "").trim();
    if (!hydrateReady || activeRide || !booking || !cid || resumeAttempted) return;
    setResumeAttempted(true);
    void (async () => {
      const ok = await resumeActiveRide(cid, booking);
      if (!ok) setResumeFailed(true);
    })();
  }, [hydrateReady, activeRide, params.booking, params.cid, params.companyId, resumeActiveRide, resumeAttempted]);

  // Later booking mis-routed to Active Ride — bounce to Schedule (never Finding driver dead-end).
  useEffect(() => {
    if (activeRide?.status === "scheduled") {
      router.replace("/(tabs)/scheduled");
    }
  }, [activeRide?.status]);

  // Wait for cold-start / Passengerjobs recover before treating null as "no ride".
  // If resume refused (Cancelled / unpaid hold / Scheduled / missing), leave the spinner —
  // prefer Scheduled tab when deep-link looked like a booking restore.
  useEffect(() => {
    const booking = String(params.booking || "").trim();
    const cid = String(params.cid || params.companyId || "").trim();
    if (settled && hydrateReady && !activeRide && !(booking && cid)) {
      router.replace("/(tabs)");
      return;
    }
    if (settled && hydrateReady && !activeRide && booking && cid && resumeFailed) {
      router.replace("/(tabs)/scheduled");
    }
  }, [settled, hydrateReady, activeRide, params.booking, params.cid, params.companyId, resumeFailed]);

  // Hard fallback: never spin forever if resume hangs.
  useEffect(() => {
    const booking = String(params.booking || "").trim();
    const cid = String(params.cid || params.companyId || "").trim();
    if (!booking || !cid || activeRide) return;
    const t = setTimeout(() => setResumeFailed(true), 12_000);
    return () => clearTimeout(t);
  }, [params.booking, params.cid, params.companyId, activeRide]);

  // Show ride-complete modal when dispatcher/driver marks the trip done.
  // Uses a modal (not auto-navigate) so an accidental "complete" from the
  // driver doesn't immediately hijack the passenger screen mid-trip.
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  useEffect(() => {
    if (activeRide?.status === "completed") setShowCompleteModal(true);
  }, [activeRide?.status]);

  // Refresh cancel policy every 10 s while driver is en-route so the grace
  // countdown stays accurate without a busy re-render loop.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const s = activeRide?.status;
    if (s !== "confirmed" && s !== "on_the_way") return;
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, [activeRide?.status]);

  // What fraction of the way to pickup has the driver already covered?
  // 0 = just accepted, 1 = arrived at pickup.
  const driverDistancePct = useMemo(() => {
    if (!driverLocation || !activeRide?.driverStartDistanceToPickup || activeRide.driverStartDistanceToPickup <= 0) return 0;
    const currentDist = haversineKm(driverLocation, activeRide.pickup.location);
    return Math.min(1, Math.max(0, 1 - currentDist / activeRide.driverStartDistanceToPickup));
  }, [driverLocation, activeRide?.driverStartDistanceToPickup, activeRide?.pickup.location]);

  // Live cancellation policy — what would happen if the passenger cancelled RIGHT NOW.
  const cancelPolicy = useMemo(() => {
    if (!activeRide) return null;
    return computeCancelPolicy(
      activeRide.status,
      activeRide.payment,
      activeRide.fare,
      activeRide.acceptedAt,
      driverDistancePct,
      activeRide.isTM,
      activeRide.tmPassengerAmount,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRide?.status, activeRide?.payment, activeRide?.fare, activeRide?.acceptedAt, activeRide?.isTM, activeRide?.tmPassengerAmount, driverDistancePct, now]);

  if (!activeRide) {
    const booking = String(params.booking || "").trim();
    const cid = String(params.cid || params.companyId || "").trim();
    // Avoid post-pay flash: keep a stable restoring frame while params resume in flight.
    if (booking && cid) {
      return (
        <View style={[styles.container, { backgroundColor: colors.background, padding: 16, paddingTop: insets.top + 24, alignItems: "center", justifyContent: "center" }]}>
          <ActivityIndicator />
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", marginTop: 12, textAlign: "center" }}>
            {resumeFailed ? "Could not restore this ride — opening Scheduled…" : "Restoring your ride…"}
          </Text>
        </View>
      );
    }
    return (
      <View style={[styles.container, { backgroundColor: colors.background, padding: 16, paddingTop: insets.top + 24 }]}>
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", marginBottom: 12, textAlign: "center" }}>
          {hydrateReady ? "No Active Ride in memory — returning home…" : "Restoring your trip…"}
        </Text>
      </View>
    );
  }

  const { pickup, destination, driver, status, fare, vehicleType, stops, searchPhase } = activeRide;
  const statusColor = STATUS_COLORS[status] ?? colors.primary;
  // Cancel is not available once already requested or when operator has cancelled
  const canCancel = (cancelPolicy?.canCancel ?? false) &&
    status !== "cancel_requested" &&
    status !== "cancelled" &&
    status !== "no_show";
  const statusLabel = status === "searching"
    ? searchLabel(searchPhase, elapsed)
    : (STATUS_LABELS[status] ?? status);

  const trackingRef = activeRide.firestoreId ?? activeRide.id;
  const trackingUrl = `https://track.yourtaxi.app/ride/${activeRide.trackingToken ?? trackingRef}`;

  const handleShare = async () => {
    try {
      if (Platform.OS === "web") {
        setShareModal(true);
      } else {
        await Share.share({
          message: `Track my ride in real time:\n${trackingUrl}\n\nBooking ref: ${trackingRef}`,
          title: "Track My Ride",
        });
      }
    } catch {
      setShareModal(true);
    }
  };

  const handleCopyRef = async () => {
    await Clipboard.setStringAsync(trackingUrl);
    setCopiedRef(true);
    setTimeout(() => setCopiedRef(false), 2500);
  };
  const topPad = Platform.OS === "web" ? insets.top + 67 : insets.top;

  const handleCancel = () => {
    if (!canCancel) return;
    setCancelConfirm(true);
  };

  const confirmCancel = async () => {
    setCancelConfirm(false);
    // Pass the computed outcome so the RTDB listener knows whether to credit wallet,
    // show a charge notification, or just confirm free cancellation.
    // cancelRide is a thin client — all final decisions come from the backend.
    const outcome = cancelPolicy?.outcome;
    await cancelRide(
      outcome === "refund" || outcome === "free" || outcome === "charge" ? outcome : undefined,
    );
  };

  const handleSOS = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    notify(
      "SOS Alert Sent",
      "Emergency services and your emergency contact have been notified of your location.",
      "error"
    );
  };

  const handleAddStop = (place: PlaceDetail) => {
    const stop = { id: Date.now().toString(), place };
    void addStop(stop);
  };

  const handleEditDestination = (place: PlaceDetail) => {
    void editDestination(place);
  };

  const canEditTrip =
    status === "searching" || status === "confirmed" || status === "on_the_way";

  const openChatUnavailable = () => {
    setChatOpen(true);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 10, borderBottomColor: colors.border }]}>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + "20" }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={handleShare} style={[styles.headerIconBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="share-2" size={16} color={colors.foreground} />
          </Pressable>
          <Pressable onPress={handleSOS} style={[styles.sosBtn, { backgroundColor: "#ef444420" }]}>
            <Feather name="alert-triangle" size={16} color="#ef4444" />
            <Text style={[styles.sosBtnText]}>SOS</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >

        {/* Map */}
        <RouteMap
          pickup={pickup.location}
          destination={destination.location}
          driverLocation={driverLocation}
          polyline={activeRide.route?.polylinePoints}
          distanceText={activeRide.route?.distanceText}
          durationText={activeRide.route?.durationText}
          height={180}
        />

        {/* Booking received banner — shown while dispatcher hasn't assigned a driver yet */}
        {status === "searching" && (
          <View style={[styles.bookingReceivedBanner, { backgroundColor: "#1e40af12", borderColor: "#2563eb30" }]}>
            <View style={styles.bookingReceivedTop}>
              <View style={styles.bookingReceivedIcon}>
                <Feather name="check-circle" size={18} color="#2563eb" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.bookingReceivedTitle, { color: "#1e3a5f" }]}>
                  Booking received
                </Text>
                <Text style={[styles.bookingReceivedBody, { color: "#374151" }]}>
                  Your booking is with the dispatcher. A driver will be assigned as soon as one becomes free — no action needed.
                </Text>
              </View>
            </View>
            <View style={[styles.bookingRefRow, { borderTopColor: "#2563eb20" }]}>
              <Feather name="hash" size={12} color="#6b7280" />
              <Text style={styles.bookingRefText}>
                Ref: {activeRide.firestoreId ?? activeRide.id}
              </Text>
            </View>
            <Text style={{ fontSize: 10, color: "#9ca3af", marginTop: 6 }}>
              Build{" "}
              {Updates.updateId
                ? String(Updates.updateId).slice(0, 8)
                : Updates.isEmbeddedLaunch
                  ? "embedded"
                  : "local"}
              {" · "}
              {Updates.channel || "no-channel"}
            </Text>
          </View>
        )}

        {/* Route Summary */}
        <View style={[styles.routeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.routeRow}>
            <View style={[styles.routeDot, { backgroundColor: colors.success }]} />
            <Text style={[styles.routeText, { color: colors.foreground }]} numberOfLines={1}>{pickup.address}</Text>
          </View>
          {stops.map((s) => (
            <View key={s.id} style={styles.routeRow}>
              <View style={[styles.routeDot, { backgroundColor: colors.warning }]} />
              <Text style={[styles.routeText, { color: colors.foreground }]} numberOfLines={1}>{s.place.address}</Text>
            </View>
          ))}
          <View style={styles.routeRow}>
            <View style={[styles.routeDot, { backgroundColor: colors.destructive }]} />
            <Text style={[styles.routeText, { color: colors.foreground }]} numberOfLines={1}>{destination.address}</Text>
          </View>
        </View>

        {/* Driver at pickup — passive only; trip starts when driver marks On Board */}
        {status === "arrived" && (
          <View style={[styles.bookingReceivedBanner, { backgroundColor: "#22c55e12", borderColor: "#22c55e40" }]}>
            <View style={styles.bookingReceivedTop}>
              <View style={[styles.bookingReceivedIcon, { backgroundColor: "#22c55e20" }]}>
                <Feather name="map-pin" size={18} color="#16a34a" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.bookingReceivedTitle, { color: "#14532d" }]}>
                  Driver has arrived — waiting for pickup
                </Text>
                <Text style={[styles.bookingReceivedBody, { color: "#374151" }]}>
                  No action needed. Tell the driver your name and PIN. Your trip starts automatically once you&apos;re on board.
                </Text>
              </View>
            </View>
            {!activeRide.imComingAt ? (
              <Pressable
                onPress={() => { void signalImComing(); }}
                style={{ marginTop: 10, alignSelf: "flex-start", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "#16a34a20" }}
              >
                <Text style={{ color: "#14532d", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                  I&apos;m coming — need a bit more time
                </Text>
              </Pressable>
            ) : (
              <Text style={{ marginTop: 10, color: "#166534", fontFamily: "Inter_500Medium", fontSize: 13 }}>
                Extra wait requested — head to the pickup now.
              </Text>
            )}
          </View>
        )}

        {/* Pickup PIN — tell the driver verbally */}
        {!!activeRide.pickupPin && status !== "completed" && status !== "cancelled" && status !== "no_show" && (
          <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>PICKUP PIN</Text>
            <Text style={[styles.fareValue, { color: colors.primary, letterSpacing: 4 }]}>
              {activeRide.pickupPin}
            </Text>
            <Text style={[styles.fareLabel, { color: colors.mutedForeground, marginTop: 4 }]}>
              Tell this code to your driver when they arrive.
            </Text>
          </View>
        )}

        {/* Trip started — clear indication when driver marks On Board */}
        {status === "in_progress" && (
          <View style={[styles.bookingReceivedBanner, { backgroundColor: "#1e40af18", borderColor: "#1e40af40" }]}>
            <View style={styles.bookingReceivedTop}>
              <View style={[styles.bookingReceivedIcon, { backgroundColor: "#1e40af20" }]}>
                <Feather name="navigation" size={18} color="#1e40af" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.bookingReceivedTitle, { color: "#1e3a5f" }]}>
                  Trip in progress
                </Text>
                <Text style={[styles.bookingReceivedBody, { color: "#374151" }]}>
                  You&apos;re on board — heading to your destination.
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Driver Card */}
        {driver ? (
          <View style={[styles.driverCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.driverAvatar, { backgroundColor: colors.primary }]}>
              <Feather name="user" size={22} color="#fff" />
            </View>
            <View style={styles.driverInfo}>
              <Text style={[styles.driverName, { color: colors.foreground }]}>{driver.name}</Text>
              <View style={styles.driverMeta}>
                <Feather name="star" size={12} color={colors.warning} />
                <Text style={[styles.driverMetaText, { color: colors.mutedForeground }]}>
                {driver.rating}{driver.cab ? ` • ${driver.cab}` : ""}{driver.color ? ` • ${driver.color}` : ""}
              </Text>
              </View>
              <Text style={[styles.plate, { color: colors.foreground }]}>{driver.plate}</Text>
            </View>
            <Pressable onPress={openChatUnavailable} style={[styles.chatBtn, { backgroundColor: colors.primary + "15", borderColor: colors.primary }]}>
              <Feather name="message-circle" size={18} color={colors.primary} />
            </Pressable>
          </View>
        ) : status !== "searching" ? (
          <View style={[styles.driverCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.driverAvatar, { backgroundColor: colors.muted }]}>
              <Feather name="user" size={22} color={colors.mutedForeground} />
            </View>
            <View style={styles.driverInfo}>
              <Text style={[styles.driverName, { color: colors.foreground }]}>Driver assigned</Text>
              <Text style={[styles.driverMetaText, { color: colors.mutedForeground }]}>
                Vehicle details will appear when the dispatcher shares them.
              </Text>
            </View>
          </View>
        ) : null}

        {/* Fare + ETA + Payment Status */}
        <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.infoRow}>
            <Text style={[styles.fareLabel, { color: colors.mutedForeground }]}>Estimated Fare</Text>
            <Text style={[styles.fareValue, { color: colors.primary }]}>{formatCurrency(fare)}</Text>
          </View>
          {activeRide.eta != null && (
            <>
              <View style={[styles.infoDivider, { backgroundColor: colors.border }]} />
              <View style={styles.infoRow}>
                <Text style={[styles.fareLabel, { color: colors.mutedForeground }]}>ETA</Text>
                <View style={styles.etaBadge}>
                  <Feather name="clock" size={13} color={colors.primary} />
                  <Text style={[styles.etaText, { color: colors.primary }]}>
                    {activeRide.eta < 1 ? "Arriving now" : `${Math.round(activeRide.eta)} min`}
                  </Text>
                </View>
              </View>
            </>
          )}
          {activeRide.paymentStatus && (
            <>
              <View style={[styles.infoDivider, { backgroundColor: colors.border }]} />
              <View style={styles.infoRow}>
                <Text style={[styles.fareLabel, { color: colors.mutedForeground }]}>Payment</Text>
                <View style={[
                  styles.payStatusBadge,
                  {
                    backgroundColor: activeRide.paymentStatus === "confirmed"
                      ? colors.success + "15"
                      : activeRide.paymentStatus === "failed"
                      ? "#ef444415"
                      : colors.warning + "15",
                  },
                ]}>
                  <Feather
                    name={activeRide.paymentStatus === "confirmed" ? "check-circle" : activeRide.paymentStatus === "failed" ? "x-circle" : "clock"}
                    size={13}
                    color={activeRide.paymentStatus === "confirmed" ? colors.success : activeRide.paymentStatus === "failed" ? "#ef4444" : colors.warning}
                  />
                  <Text style={[
                    styles.payStatusText,
                    { color: activeRide.paymentStatus === "confirmed" ? colors.success : activeRide.paymentStatus === "failed" ? "#ef4444" : colors.warning },
                  ]}>
                    {activeRide.paymentStatus === "confirmed" ? "Confirmed" : activeRide.paymentStatus === "failed" ? "Failed" : "Pending"}
                  </Text>
                </View>
              </View>
            </>
          )}
        </View>

        {/* Cancellation policy hint — shown when driver is en-route */}
        {(status === "confirmed" || status === "on_the_way") && cancelPolicy && (
          <View style={[
            styles.cancelPolicyCard,
            {
              backgroundColor: cancelPolicy.outcome === "charge" ? colors.warning + "12" : colors.success + "12",
              borderColor: cancelPolicy.outcome === "charge" ? colors.warning + "40" : colors.success + "40",
            },
          ]}>
            <Feather
              name={cancelPolicy.outcome === "charge" ? "alert-triangle" : "check-circle"}
              size={15}
              color={cancelPolicy.outcome === "charge" ? colors.warning : colors.success}
            />
            <Text style={[styles.cancelPolicyText, { color: cancelPolicy.outcome === "charge" ? colors.warning : colors.success }]}>
              {cancelPolicy.outcome === "charge"
                ? "Cancellation fee applies if you cancel now"
                : "Free cancel — 3 min grace & driver < 70% to you"}
            </Text>
          </View>
        )}

        {/* Edit trip — destination + stops before driver arrives */}
        {canEditTrip && (
          <View style={styles.addStopSection}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>EDIT TRIP</Text>
            <Text style={[styles.fareLabel, { color: colors.mutedForeground, marginBottom: 4 }]}>
              Change destination
            </Text>
            <PlacesAutocomplete
              placeholder="New destination…"
              value=""
              onSelect={handleEditDestination}
              icon="navigation"
              iconColor={colors.primary}
              locationBias={placesBias}
              nearPickup={activeRide.pickup.location}
              role="destination"
            />
            <Text style={[styles.fareLabel, { color: colors.mutedForeground, marginTop: 10, marginBottom: 4 }]}>
              Add a stop
            </Text>
            <PlacesAutocomplete
              placeholder="Add stop to route…"
              value=""
              onSelect={handleAddStop}
              icon="map-pin"
              iconColor={colors.warning}
              locationBias={placesBias}
              nearPickup={activeRide.pickup.location}
              role="stop"
            />
          </View>
        )}
      </ScrollView>

      {/* Bottom Actions */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16, backgroundColor: colors.background, borderTopColor: colors.border }]}>
        {status === "completed" ? (
          // Modal owns the completed CTA — avoid a second "Rate & Complete" bar underneath.
          <View style={[styles.actionBtn, { backgroundColor: colors.success + "18" }]}>
            <Text style={[styles.actionBtnText, { color: colors.success }]}>Trip complete — choose an option above</Text>
          </View>
        ) : status === "arrived" ? (
          // Cancel locked at pickup; passenger does not start the trip — driver On Board flips status.
          <View style={[styles.actionBtn, { backgroundColor: colors.success + "18" }]}>
            <Text style={[styles.actionBtnText, { color: colors.success }]}>
              Driver has arrived — waiting for pickup
            </Text>
          </View>
        ) : status === "cancel_requested" ? (
          // Waiting for backend to confirm the cancellation — show spinner-style feedback
          <View style={[styles.actionBtn, { backgroundColor: colors.muted, opacity: 0.8 }]}>
            <Text style={[styles.actionBtnText, { color: colors.mutedForeground }]}>
              Cancellation Requested — Waiting…
            </Text>
          </View>
        ) : status === "no_show" ? (
          // Driver marked no-show — payment handled server-side; take passenger home
          <Pressable onPress={() => router.replace("/(tabs)")} style={[styles.actionBtn, { backgroundColor: colors.muted }]}>
            <Text style={[styles.actionBtnText, { color: colors.foreground }]}>No Show — Back to Home</Text>
          </Pressable>
        ) : status === "cancelled" ? (
          // Operator or driver cancelled this booking
          <Pressable onPress={() => router.replace("/(tabs)")} style={[styles.actionBtn, { backgroundColor: colors.muted }]}>
            <Text style={[styles.actionBtnText, { color: colors.foreground }]}>Booking Cancelled — Back to Home</Text>
          </Pressable>
        ) : (
          <View style={styles.arrivedActions}>
            <Pressable
              onPress={handleCancel}
              disabled={!canCancel}
              style={({ pressed }) => [
                styles.actionBtn,
                { backgroundColor: canCancel ? colors.destructive + "15" : colors.muted, opacity: pressed ? 0.8 : 1, flex: 1 },
              ]}
            >
              <Text style={[styles.actionBtnText, { color: canCancel ? colors.destructive : colors.mutedForeground }]}>
                {canCancel ? "Cancel Ride" : "Cannot Cancel"}
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Cancel Confirmation — smart policy-aware modal */}
      <Modal visible={cancelConfirm} transparent animationType="fade" onRequestClose={() => setCancelConfirm(false)}>
        <View style={styles.overlay}>
          <View style={[styles.confirmCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather
              name={cancelPolicy?.outcome === "charge" ? "alert-triangle" : "x-circle"}
              size={36}
              color={cancelPolicy?.outcome === "charge" ? colors.warning : colors.destructive}
            />
            <Text style={[styles.confirmTitle, { color: colors.foreground }]}>
              {cancelPolicy?.title ?? "Cancel Ride?"}
            </Text>
            <Text style={[styles.confirmSub, { color: colors.mutedForeground }]}>
              {cancelPolicy?.detail ?? "Are you sure you want to cancel?"}
            </Text>
            {cancelPolicy?.outcome === "charge" && activeRide?.isTM && (
              <View style={[styles.chargeBanner, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "40" }]}>
                <Feather name="rotate-ccw" size={14} color={colors.primary} />
                <Text style={[styles.chargeBannerText, { color: colors.primary }]}>
                  Co-payment credited to your wallet — council not charged
                </Text>
              </View>
            )}
            {cancelPolicy?.outcome === "charge" && !activeRide?.isTM && (
              <View style={[styles.chargeBanner, { backgroundColor: colors.warning + "15", borderColor: colors.warning + "40" }]}>
                <Feather name="credit-card" size={14} color={colors.warning} />
                <Text style={[styles.chargeBannerText, { color: colors.warning }]}>
                  Full fare will be charged — no refund
                </Text>
              </View>
            )}
            {cancelPolicy?.outcome === "refund" && (
              <View style={[styles.chargeBanner, { backgroundColor: colors.success + "15", borderColor: colors.success + "40" }]}>
                <Feather name="check-circle" size={14} color={colors.success} />
                <Text style={[styles.chargeBannerText, { color: colors.success }]}>
                  Fare refunded to your wallet
                </Text>
              </View>
            )}
            {cancelPolicy?.outcome === "free" && (
              <View style={[styles.chargeBanner, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
                <Feather name="check-circle" size={14} color={colors.primary} />
                <Text style={[styles.chargeBannerText, { color: colors.primary }]}>
                  No charge — booking cancelled at no cost
                </Text>
              </View>
            )}
            <View style={styles.confirmBtns}>
              <Pressable
                onPress={() => setCancelConfirm(false)}
                style={[styles.confirmBtn, { backgroundColor: colors.muted, flex: 1 }]}
              >
                <Text style={[styles.confirmBtnText, { color: colors.foreground }]}>Keep Ride</Text>
              </Pressable>
              <Pressable
                onPress={confirmCancel}
                style={[styles.confirmBtn, { backgroundColor: cancelPolicy?.outcome === "charge" ? colors.warning : colors.destructive, flex: 1 }]}
              >
                <Text style={[styles.confirmBtnText, { color: "#fff" }]}>
                  {cancelPolicy?.outcome === "charge" ? "Accept & Cancel" : "Yes, Cancel"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Share Tracking Modal */}
      <Modal visible={shareModal} transparent animationType="fade" onRequestClose={() => setShareModal(false)}>
        <View style={styles.overlay}>
          <View style={[styles.confirmCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.shareIconBox, { backgroundColor: colors.primary + "15" }]}>
              <Feather name="share-2" size={26} color={colors.primary} />
            </View>
            <Text style={[styles.confirmTitle, { color: colors.foreground }]}>Share Tracking Link</Text>
            <Text style={[styles.confirmSub, { color: colors.mutedForeground }]}>
              Share this link so others can track your ride in real time.
            </Text>
            <View style={[styles.trackingLinkBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={[styles.trackingLinkText, { color: colors.foreground }]} numberOfLines={2}>{trackingUrl}</Text>
            </View>
            <Text style={[styles.refLabel, { color: colors.mutedForeground }]}>
              Booking ref: <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>{trackingRef}</Text>
            </Text>
            <Pressable
              onPress={handleCopyRef}
              style={({ pressed }) => [styles.copyBtn, { backgroundColor: copiedRef ? colors.success : colors.primary, opacity: pressed ? 0.85 : 1 }]}
            >
              <Feather name={copiedRef ? "check" : "copy"} size={16} color="#fff" />
              <Text style={styles.copyBtnText}>{copiedRef ? "Copied!" : "Copy Link"}</Text>
            </Pressable>
            <Pressable onPress={() => setShareModal(false)} style={styles.dismissBtn}>
              <Text style={[styles.dismissText, { color: colors.mutedForeground }]}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Ride Complete Modal — shown when driver/dispatcher marks trip done */}
      <Modal visible={showCompleteModal} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.overlay}>
          <View style={[styles.confirmCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.shareIconBox, { backgroundColor: colors.success + "20" }]}>
              <Feather name="check-circle" size={36} color={colors.success} />
            </View>
            <Text style={[styles.confirmTitle, { color: colors.foreground }]}>Ride Complete!</Text>
            <Text style={[styles.confirmSub, { color: colors.mutedForeground }]}>
              Your trip has ended. Would you like to rate your driver?
            </Text>
            {fare > 0 && (
              <View style={[styles.chargeBanner, { backgroundColor: colors.success + "15", borderColor: colors.success + "40" }]}>
                <Feather name="dollar-sign" size={14} color={colors.success} />
                <Text style={[styles.chargeBannerText, { color: colors.success }]}>
                  Total fare: {formatCurrency(fare)}
                </Text>
              </View>
            )}
            <View style={[styles.confirmBtns, { flexDirection: "column" }]}>
              <Pressable
                onPress={() => { setShowCompleteModal(false); router.replace("/ride-complete"); }}
                style={[styles.confirmBtn, { backgroundColor: colors.success, width: "100%" }]}
              >
                <Text style={[styles.confirmBtnText, { color: "#fff" }]}>Rate My Driver</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setShowCompleteModal(false);
                  const snap = activeRide;
                  void (async () => {
                    if (snap) await recordCompletedTripHistory(snap);
                    clearRide();
                    router.replace("/(tabs)");
                  })();
                }}
                style={[styles.confirmBtn, { backgroundColor: colors.muted, width: "100%" }]}
              >
                <Text style={[styles.confirmBtnText, { color: colors.foreground }]}>Skip — Back to Home</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Chat unavailable — honest stub (no fake driver auto-reply) */}
      <Modal visible={chatOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setChatOpen(false)}>
        <View style={[styles.chatModal, { backgroundColor: colors.background }]}>
          <View style={[styles.chatHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.chatTitle, { color: colors.foreground }]}>Messaging</Text>
            <Pressable onPress={() => setChatOpen(false)}>
              <Feather name="x" size={22} color={colors.foreground} />
            </Pressable>
          </View>
          <View style={{ flex: 1, padding: 24, justifyContent: "center", gap: 14 }}>
            <View style={[styles.shareIconBox, { backgroundColor: colors.muted, alignSelf: "center" }]}>
              <Feather name="message-circle" size={28} color={colors.mutedForeground} />
            </View>
            <Text style={[styles.confirmTitle, { color: colors.foreground, textAlign: "center" }]}>
              In-app chat coming soon
            </Text>
            <Text style={[styles.confirmSub, { color: colors.mutedForeground, textAlign: "center" }]}>
              Messaging is not live yet — messages are not delivered to your driver. Use a phone call if you need to reach them.
            </Text>
            <Pressable
              onPress={() => setChatOpen(false)}
              style={[styles.confirmBtn, { backgroundColor: colors.primary, alignSelf: "stretch" }]}
            >
              <Text style={[styles.confirmBtnText, { color: "#fff", textAlign: "center" }]}>Got it</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    paddingTop: 14,
  },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  sosBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  sosBtnText: { color: "#ef4444", fontSize: 13, fontFamily: "Inter_700Bold" },
  content: { padding: 12, gap: 10 },
  bookingReceivedBanner: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  bookingReceivedTop: { flexDirection: "row", gap: 8, padding: 10, alignItems: "flex-start" },
  bookingReceivedIcon: { marginTop: 1 },
  bookingReceivedTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  bookingReceivedBody: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  bookingRefRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderTopWidth: 1 },
  bookingRefText: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6b7280" },
  routeCard: { borderRadius: 12, borderWidth: 1, padding: 10, gap: 6 },
  routeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  routeDot: { width: 8, height: 8, borderRadius: 4 },
  routeText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular" },
  driverCard: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, padding: 10 },
  driverAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  driverInfo: { flex: 1, gap: 2 },
  driverName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  driverMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  driverMetaText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  plate: { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  chatBtn: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerIconBtn: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  fareRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 10, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 12 },
  fareLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  fareValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  infoCard: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6, gap: 0 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  infoDivider: { height: 1 },
  etaBadge: { flexDirection: "row", alignItems: "center", gap: 5 },
  etaText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  payStatusBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  payStatusText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  shareIconBox: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  trackingLinkBox: { borderRadius: 10, borderWidth: 1, padding: 12, width: "100%" },
  trackingLinkText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  refLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 13, paddingHorizontal: 28, borderRadius: 12 },
  copyBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  dismissBtn: { paddingVertical: 8 },
  dismissText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  addStopSection: { gap: 6 },
  sectionLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 1 },
  bottomBar: { paddingHorizontal: 12, paddingTop: 10, borderTopWidth: 1 },
  arrivedActions: { flexDirection: "row", gap: 10 },
  actionBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  actionBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  chatModal: { flex: 1 },
  chatHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1 },
  chatTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  chatMessages: { flex: 1 },
  bubble: { maxWidth: "75%", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMine: { alignSelf: "flex-end", backgroundColor: "#1e40af" },
  bubbleDriver: { alignSelf: "flex-start", backgroundColor: "#f1f5f9" },
  bubbleText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  chatInputRow: { flexDirection: "row", gap: 10, padding: 12, borderTopWidth: 1 },
  chatInput: { flex: 1, borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 },
  confirmCard: { width: "100%", borderRadius: 20, borderWidth: 1, padding: 24, alignItems: "center", gap: 12 },
  confirmTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  confirmSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  confirmBtns: { flexDirection: "row", gap: 12, marginTop: 8, width: "100%" },
  confirmBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  confirmBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  chargeBanner: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, width: "100%" },
  chargeBannerText: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  cancelPolicyCard: { borderRadius: 10, borderWidth: 1, paddingVertical: 8, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  cancelPolicyText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 16 },
});
