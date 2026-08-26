import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PlacesAutocomplete } from "@/components/PlacesAutocomplete";
import { RouteMap } from "@/components/RouteMap";
import { useRide, SearchPhase, computeCancelPolicy, haversineKm } from "@/context/RideContext";
import { useNotification } from "@/context/NotificationContext";
import { formatCurrency } from "@/lib/fareCalculator";
import { useColors } from "@/hooks/useColors";
import { PlaceDetail } from "@/lib/googlePlaces";

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
    case "offered":  return `Booking received — allocating a driver for you (${elapsed})`;
    case "queued":   return `In queue — a driver will be assigned shortly (${elapsed})`;
    case "waiting":  return `Waiting for an available driver… (${elapsed})`;
    default:         return `Sending booking to company… (${elapsed})`;
  }
}

export default function ActiveRideScreen() {
  const colors = useColors();
  const { notify } = useNotification();
  const { activeRide, driverLocation, cancelRide, addStop, setRideStatus, clearRide } = useRide();
  const insets = useSafeAreaInsets();
  const elapsed = useElapsedTime(activeRide?.status === "searching");
  const [chatOpen, setChatOpen] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ text: string; mine: boolean }[]>([
    { text: "On my way!", mine: false },
  ]);
  const [chatInput, setChatInput] = useState("");

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

  useEffect(() => {
    if (settled && !activeRide) {
      router.replace("/(tabs)");
    }
  }, [settled, activeRide]);

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
    return (
      <View style={[styles.container, { backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }]}>
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium" }}>Returning home…</Text>
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
    addStop(stop);
  };

  const handleStartTrip = () => {
    if (status === "arrived") {
      setRideStatus("in_progress");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  };

  const handleComplete = () => {
    if (status === "completed") {
      router.replace("/ride-complete");
    }
  };

  const sendMessage = () => {
    if (!chatInput.trim()) return;
    setChatMessages((prev) => [...prev, { text: chatInput, mine: true }]);
    setChatInput("");
    setTimeout(() => {
      setChatMessages((prev) => [...prev, { text: "Got it, thanks!", mine: false }]);
    }, 1500);
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

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}>
        {/* Map */}
        <RouteMap
          pickup={pickup.location}
          destination={destination.location}
          driverLocation={driverLocation}
          polyline={activeRide.route?.polylinePoints}
          distanceText={activeRide.route?.distanceText}
          durationText={activeRide.route?.durationText}
          height={240}
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
            <Pressable onPress={() => setChatOpen(true)} style={[styles.chatBtn, { backgroundColor: colors.primary + "15", borderColor: colors.primary }]}>
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

        {/* Add stop (in progress only) */}
        {status === "in_progress" && (
          <View style={styles.addStopSection}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ADD A STOP</Text>
            <PlacesAutocomplete
              placeholder="Add stop to route..."
              value=""
              onSelect={handleAddStop}
              icon="map-pin"
              iconColor={colors.warning}
            />
          </View>
        )}
      </ScrollView>

      {/* Bottom Actions */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16, backgroundColor: colors.background, borderTopColor: colors.border }]}>
        {status === "completed" ? (
        driver ? (
          <Pressable onPress={handleComplete} style={[styles.actionBtn, { backgroundColor: colors.success }]}>
            <Text style={styles.actionBtnText}>Rate & Complete</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => router.replace("/(tabs)")} style={[styles.actionBtn, { backgroundColor: colors.muted }]}>
            <Text style={[styles.actionBtnText, { color: colors.foreground }]}>Booking Closed — Back to Home</Text>
          </Pressable>
        )
        ) : status === "arrived" ? (
          // Cancel is LOCKED once the driver is at the pickup address
          <View style={styles.arrivedActions}>
            <Pressable onPress={handleStartTrip} style={[styles.actionBtn, { backgroundColor: colors.primary, flex: 1 }]}>
              <Text style={styles.actionBtnText}>Start Trip</Text>
            </Pressable>
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
                  clearRide();
                  router.replace("/(tabs)");
                }}
                style={[styles.confirmBtn, { backgroundColor: colors.muted, width: "100%" }]}
              >
                <Text style={[styles.confirmBtnText, { color: colors.foreground }]}>Skip — Back to Home</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Chat Modal */}
      <Modal visible={chatOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setChatOpen(false)}>
        <View style={[styles.chatModal, { backgroundColor: colors.background }]}>
          <View style={[styles.chatHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.chatTitle, { color: colors.foreground }]}>Chat with {driver?.name ?? "Driver"}</Text>
            <Pressable onPress={() => setChatOpen(false)}>
              <Feather name="x" size={22} color={colors.foreground} />
            </Pressable>
          </View>
          <ScrollView style={styles.chatMessages} contentContainerStyle={{ padding: 16, gap: 10 }}>
            {chatMessages.map((m, i) => (
              <View key={i} style={[styles.bubble, m.mine ? styles.bubbleMine : styles.bubbleDriver]}>
                <Text style={[styles.bubbleText, { color: m.mine ? "#fff" : colors.foreground }]}>{m.text}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={[styles.chatInputRow, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: insets.bottom + 10 }]}>
            <TextInput
              style={[styles.chatInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              placeholder="Type a message..."
              placeholderTextColor={colors.mutedForeground}
              value={chatInput}
              onChangeText={setChatInput}
              onSubmitEditing={sendMessage}
              returnKeyType="send"
            />
            <Pressable onPress={sendMessage} style={[styles.sendBtn, { backgroundColor: colors.primary }]}>
              <Feather name="send" size={18} color="#fff" />
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
  content: { padding: 16, gap: 14 },
  bookingReceivedBanner: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  bookingReceivedTop: { flexDirection: "row", gap: 10, padding: 14, alignItems: "flex-start" },
  bookingReceivedIcon: { marginTop: 1 },
  bookingReceivedTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  bookingReceivedBody: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  bookingRefRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1 },
  bookingRefText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6b7280" },
  routeCard: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  routeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  routeDot: { width: 10, height: 10, borderRadius: 5 },
  routeText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  driverCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, padding: 14 },
  driverAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  driverInfo: { flex: 1, gap: 3 },
  driverName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  driverMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  driverMetaText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  plate: { fontSize: 13, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  chatBtn: { width: 38, height: 38, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerIconBtn: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  fareRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 14 },
  fareLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },
  fareValue: { fontSize: 20, fontFamily: "Inter_700Bold" },
  infoCard: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 0 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
  infoDivider: { height: 1 },
  etaBadge: { flexDirection: "row", alignItems: "center", gap: 5 },
  etaText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  payStatusBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  payStatusText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  shareIconBox: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  trackingLinkBox: { borderRadius: 10, borderWidth: 1, padding: 12, width: "100%" },
  trackingLinkText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  refLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 13, paddingHorizontal: 28, borderRadius: 12 },
  copyBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  dismissBtn: { paddingVertical: 8 },
  dismissText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  addStopSection: { gap: 8 },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1 },
  bottomBar: { padding: 16, borderTopWidth: 1 },
  arrivedActions: { flexDirection: "row", gap: 10 },
  actionBtn: { borderRadius: 14, paddingVertical: 16, alignItems: "center", justifyContent: "center" },
  actionBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
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
  cancelPolicyCard: { borderRadius: 12, borderWidth: 1, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  cancelPolicyText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 },
});
