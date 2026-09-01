import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { onValue, ref, set } from "firebase/database";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { rtdb } from "@/lib/firebase";
import { FALLBACK_TZ } from "@/lib/timezone";
import { formatCurrency } from "@/lib/fareCalculator";
import { useColors } from "@/hooks/useColors";

interface ScheduledJob {
  id: string;
  PickupAddress?: string;
  pickupAddress?: string;
  DropoffAddress?: string;
  dropoffAddress?: string;
  VehicleType?: string;
  vehicleType?: string;
  EstimatedFare?: number;
  estimatedFare?: number;
  PaymentMethod?: string;
  paymentMethod?: string;
  ScheduledFor?: number;
  scheduledFor?: number;
  ScheduledAt?: string;
  scheduledAt?: string;
  CompanyId?: string;
  companyId?: string;
}

function formatScheduledTime(ts: number): string {
  const d = new Date(ts);
  // Derive today/tomorrow in the company timezone, not device local time
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: FALLBACK_TZ }).format(new Date());
  const dayStr   = new Intl.DateTimeFormat("en-CA", { timeZone: FALLBACK_TZ }).format(d);
  const [ty, tm, td] = todayStr.split("-").map(Number);
  const tomorrow = new Date(ty, tm - 1, td + 1);
  const tomorrowStr = new Intl.DateTimeFormat("en-CA", { timeZone: FALLBACK_TZ }).format(tomorrow);

  const timeStr = d.toLocaleTimeString("en-NZ", {
    timeZone: FALLBACK_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  if (dayStr === todayStr) return `Today, ${timeStr}`;
  if (dayStr === tomorrowStr) return `Tomorrow, ${timeStr}`;
  return (
    d.toLocaleDateString("en-NZ", { timeZone: FALLBACK_TZ, weekday: "short", day: "numeric", month: "short" }) +
    `, ${timeStr}`
  );
}

function timeUntil(ts: number): string {
  const diff = ts - Date.now();
  if (diff <= 0) return "Due now";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `in ${d} day${d > 1 ? "s" : ""}`;
  }
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m} min`;
}

export default function ScheduledScreen() {
  const colors = useColors();
  const { firebaseUser, isLoading, updateWallet } = useAuth();
  const insets = useSafeAreaInsets();
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const topPad = Platform.OS === "web" ? insets.top + 67 : insets.top;

  useEffect(() => {
    if (!firebaseUser?.uid) {
      setLoading(false);
      return;
    }
    const uid = firebaseUser.uid;
    const unsubscribe = onValue(
      ref(rtdb, `Passengerjobs/${uid}`),
      (snap) => {
        if (!snap.exists()) {
          setJobs([]);
          setLoading(false);
          return;
        }
        const raw = snap.val() as Record<string, any>;
        const list: ScheduledJob[] = [];
        for (const [id, val] of Object.entries(raw)) {
          if (!val || typeof val !== "object") continue;
          const status = String(val.Status ?? val.status ?? "").toLowerCase().replace(/[_\s]/g, "");
          const schedMs = Number(val.ScheduledFor ?? val.scheduledFor ?? val.ScheduledForMs ?? 0);
          const hasFutureSched = Number.isFinite(schedMs) && schedMs > Date.now();
          // Show confirmed Scheduled + in-flight card holds (PendingPayment) for later trips.
          const visible =
            status === "scheduled" ||
            (hasFutureSched && (status === "pendingpayment" || status === "paymentpending"));
          if (!visible) continue;
          // Skip cancelled / completed even if ScheduledFor remains.
          if (status === "cancelled" || status === "canceled" || status === "completed" || status === "closed") {
            continue;
          }
          list.push({ id, ...val });
        }
        list.sort((a, b) => {
          const ta = a.ScheduledFor ?? a.scheduledFor ?? 0;
          const tb = b.ScheduledFor ?? b.scheduledFor ?? 0;
          return ta - tb;
        });
        setJobs(list);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsubscribe();
  }, [firebaseUser?.uid]);

  const doCancel = async (job: ScheduledJob) => {
    if (!firebaseUser?.uid) return;
    setCancelling(job.id);
    const uid = firebaseUser.uid;
    const cid = job.CompanyId ?? job.companyId ?? "";
    const payment = (job.PaymentMethod ?? job.paymentMethod ?? "cash").toLowerCase();
    const fare = job.EstimatedFare ?? job.estimatedFare ?? 0;
    const willRefund = (payment === "card" || payment === "wallet" || payment === "gift_card") && fare > 0;
    try {
      await set(ref(rtdb, `Passengerjobs/${uid}/${job.id}/Status`), "Cancelled");
      await set(ref(rtdb, `Passengerjobs/${uid}/${job.id}/status`), "Cancelled");
      if (cid) {
        await set(ref(rtdb, `pendingjobs/${cid}/${job.id}/Status`), "Cancelled");
        await set(ref(rtdb, `pendingjobs/${cid}/${job.id}/status`), "Cancelled");
      }
      if (willRefund) {
        updateWallet(fare).catch(() => {});
      }
    } catch {
    } finally {
      setCancelling(null);
    }
  };

  const cancelJob = (job: ScheduledJob) => {
    if (!firebaseUser?.uid) return;
    const payment = (job.PaymentMethod ?? job.paymentMethod ?? "cash").toLowerCase();
    const fare = job.EstimatedFare ?? job.estimatedFare ?? 0;
    const willRefund = (payment === "card" || payment === "wallet" || payment === "gift_card") && fare > 0;
    const isTM = String(job.PaymentMethod ?? job.paymentMethod ?? "").toLowerCase().includes("tm");

    let detail: string;
    if (isTM) {
      detail = "Your TM booking will be cancelled. No charges apply to you or the council.";
    } else if (willRefund) {
      detail = `${formatCurrency(fare)} will be refunded to your wallet.`;
    } else {
      detail = "Your booking will be cancelled at no charge.";
    }

    Alert.alert("Cancel Ride?", detail, [
      { text: "Keep Booking", style: "cancel" },
      { text: "Cancel Ride", style: "destructive", onPress: () => doCancel(job) },
    ]);
  };

  const editJob = (job: ScheduledJob) => {
    Alert.alert(
      "Edit Booking",
      "This will cancel your current booking and open a new scheduling form so you can make changes.",
      [
        { text: "Go Back", style: "cancel" },
        {
          text: "Continue",
          onPress: async () => {
            if (firebaseUser?.uid) {
              const uid = firebaseUser.uid;
              const cid = job.CompanyId ?? job.companyId ?? "";
              await set(ref(rtdb, `Passengerjobs/${uid}/${job.id}/Status`), "Cancelled").catch(() => {});
              if (cid) {
                await set(ref(rtdb, `pendingjobs/${cid}/${job.id}/Status`), "Cancelled").catch(() => {});
              }
            }
            router.push({ pathname: "/booking", params: { initialScheduled: "true" } });
          },
        },
      ],
    );
  };

  if (isLoading || loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!firebaseUser) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <Feather name="lock" size={40} color={colors.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: colors.foreground, marginTop: 16 }]}>
          Sign in to view scheduled rides
        </Text>
        <Pressable
          onPress={() => router.push("/auth/login")}
          style={[styles.actionBtn, { backgroundColor: colors.primary }]}
        >
          <Text style={styles.actionBtnText}>Sign In</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 16, paddingBottom: insets.bottom + 100 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.titleRow}>
        <View>
          <Text style={[styles.title, { color: colors.foreground }]}>Scheduled Rides</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {jobs.length > 0
              ? `${jobs.length} upcoming ride${jobs.length > 1 ? "s" : ""}`
              : "No upcoming rides"}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push("/booking")}
          style={({ pressed }) => [
            styles.newBtn,
            { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Feather name="plus" size={16} color="#fff" />
          <Text style={styles.newBtnText}>New</Text>
        </Pressable>
      </View>

      {jobs.length === 0 ? (
        <View
          style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View
            style={[styles.emptyIconCircle, { backgroundColor: colors.primary + "14" }]}
          >
            <Feather name="calendar" size={32} color={colors.primary} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            Nothing scheduled yet
          </Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            Book a ride in advance and it will appear here. Tap the button below to get started.
          </Text>
          <Pressable
            onPress={() => router.push("/booking")}
            style={({ pressed }) => [
              styles.actionBtn,
              { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1, alignSelf: "center" },
            ]}
          >
            <Feather name="calendar" size={15} color="#fff" />
            <Text style={styles.actionBtnText}>Schedule a Ride</Text>
          </Pressable>
        </View>
      ) : (
        jobs.map((job) => {
          const pickup = job.PickupAddress ?? job.pickupAddress ?? "—";
          const destination = job.DropoffAddress ?? job.dropoffAddress ?? "—";
          const vehicle = job.VehicleType ?? job.vehicleType ?? "Taxi";
          const fare = job.EstimatedFare ?? job.estimatedFare;
          const payment = job.PaymentMethod ?? job.paymentMethod ?? "cash";
          const scheduledTs = job.ScheduledFor ?? job.scheduledFor ?? 0;
          const isPast = scheduledTs > 0 && scheduledTs < Date.now();
          const isCancelling = cancelling === job.id;

          return (
            <View
              key={job.id}
              style={[
                styles.jobCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              {/* Time header */}
              <View
                style={[
                  styles.timeHeader,
                  {
                    backgroundColor: isPast
                      ? "#fee2e2"
                      : colors.primary + "12",
                    borderBottomColor: isPast ? "#fca5a5" : colors.primary + "25",
                  },
                ]}
              >
                <Feather
                  name="clock"
                  size={14}
                  color={isPast ? "#dc2626" : colors.primary}
                />
                <Text
                  style={[
                    styles.timeText,
                    { color: isPast ? "#dc2626" : colors.primary },
                  ]}
                >
                  {scheduledTs ? formatScheduledTime(scheduledTs) : "Time TBC"}
                </Text>
                {scheduledTs > 0 && (
                  <Text
                    style={[
                      styles.timeUntil,
                      { color: isPast ? "#dc2626" : colors.mutedForeground },
                    ]}
                  >
                    {timeUntil(scheduledTs)}
                  </Text>
                )}
              </View>

              {/* Route */}
              <View style={styles.routeSection}>
                <View style={styles.routeRow}>
                  <View style={[styles.routeDot, { backgroundColor: "#22c55e" }]} />
                  <Text
                    style={[styles.routeText, { color: colors.foreground }]}
                    numberOfLines={1}
                  >
                    {pickup}
                  </Text>
                </View>
                <View style={[styles.routeLine, { backgroundColor: colors.border }]} />
                <View style={styles.routeRow}>
                  <View style={[styles.routeDot, { backgroundColor: colors.destructive }]} />
                  <Text
                    style={[styles.routeText, { color: colors.foreground }]}
                    numberOfLines={1}
                  >
                    {destination}
                  </Text>
                </View>
              </View>

              {/* Details */}
              <View
                style={[styles.detailRow, { borderTopColor: colors.border }]}
              >
                <View style={styles.detailItem}>
                  <Feather name="navigation" size={11} color={colors.mutedForeground} />
                  <Text style={[styles.detailText, { color: colors.mutedForeground }]}>
                    {vehicle}
                  </Text>
                </View>
                {fare != null && (
                  <View style={styles.detailItem}>
                    <Feather name="dollar-sign" size={11} color={colors.mutedForeground} />
                    <Text style={[styles.detailText, { color: colors.mutedForeground }]}>
                      {formatCurrency(fare)}
                    </Text>
                  </View>
                )}
                <View style={styles.detailItem}>
                  <Feather name="credit-card" size={11} color={colors.mutedForeground} />
                  <Text
                    style={[
                      styles.detailText,
                      { color: colors.mutedForeground, textTransform: "capitalize" },
                    ]}
                  >
                    {payment}
                  </Text>
                </View>
              </View>

              {/* Edit + Cancel row */}
              <View style={styles.actionRow}>
                <Pressable
                  onPress={() => editJob(job)}
                  disabled={isCancelling}
                  style={({ pressed }) => [
                    styles.editBtn,
                    { borderColor: colors.primary + "50", opacity: pressed || isCancelling ? 0.6 : 1 },
                  ]}
                >
                  <Feather name="edit-2" size={13} color={colors.primary} />
                  <Text style={[styles.editText, { color: colors.primary }]}>Edit</Text>
                </Pressable>
                <Pressable
                  onPress={() => cancelJob(job)}
                  disabled={isCancelling}
                  style={({ pressed }) => [
                    styles.cancelBtn,
                    {
                      backgroundColor: "#fee2e2",
                      borderColor: "#fca5a5",
                      opacity: pressed || isCancelling ? 0.6 : 1,
                    },
                  ]}
                >
                  {isCancelling ? (
                    <ActivityIndicator size="small" color="#dc2626" />
                  ) : (
                    <>
                      <Feather name="x" size={13} color="#dc2626" />
                      <Text style={styles.cancelText}>Cancel</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, gap: 14 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 32,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  title: { fontSize: 26, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  newBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    marginTop: 4,
  },
  newBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  emptyCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 28,
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  emptySub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 4,
  },
  actionBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  jobCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  timeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderBottomWidth: 1,
  },
  timeText: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  timeUntil: { fontSize: 12, fontFamily: "Inter_400Regular" },
  routeSection: { padding: 14, gap: 6 },
  routeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  routeDot: { width: 9, height: 9, borderRadius: 5, flexShrink: 0 },
  routeLine: { width: 1, height: 14, marginLeft: 4 },
  routeText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  detailRow: {
    flexDirection: "row",
    gap: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    flexWrap: "wrap",
  },
  detailItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  detailText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  actionRow: {
    flexDirection: "row",
    gap: 8,
    margin: 12,
    marginTop: 4,
  },
  editBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: "transparent",
  },
  editText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  cancelBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  cancelText: { color: "#dc2626", fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
