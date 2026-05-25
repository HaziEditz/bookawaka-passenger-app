import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { trackTowJob, cancelTowJob, getCancellationPolicyText, TowTrackStatus } from "@/lib/towingApi";

const STATUS_CONFIG: Record<string, { label: string; icon: keyof typeof Feather.glyphMap; color: string; done: boolean }> = {
  pending:   { label: "Request received",        icon: "clock",           color: "#6b7280", done: false },
  assigned:  { label: "Driver assigned",          icon: "user-check",      color: "#2563eb", done: false },
  en_route:  { label: "Driver on the way",        icon: "truck",           color: "#d97706", done: false },
  arrived:   { label: "Driver has arrived",       icon: "map-pin",         color: "#7c3aed", done: false },
  completed: { label: "Tow completed",            icon: "check-circle",    color: "#16a34a", done: true },
  cancelled: { label: "Job cancelled",            icon: "x-circle",        color: "#dc2626", done: true },
};

const STATUS_ORDER = ["pending", "assigned", "en_route", "arrived", "completed"];

export default function TowTrackScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const [status, setStatus] = useState<TowTrackStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = async () => {
    if (!jobId) return;
    try {
      const s = await trackTowJob(jobId);
      setStatus(s);
      setError(null);
      // Stop polling once terminal state
      if (s.status === "completed" || s.status === "cancelled") {
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    } catch (e: any) {
      setError(e?.message ?? "Couldn't fetch job status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    intervalRef.current = setInterval(fetchStatus, 20_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [jobId]);

  const currentStatus = status?.status ?? "pending";
  const cfg = STATUS_CONFIG[currentStatus] ?? STATUS_CONFIG.pending;
  const currentIdx = STATUS_ORDER.indexOf(currentStatus);
  const isTerminal = currentStatus === "completed" || currentStatus === "cancelled";

  // Prefer server-authoritative canCancel; fall back to local logic if the field is absent
  const canCancel = status?.canCancel ?? (!isTerminal && (currentStatus === "pending" || currentStatus === "assigned"));

  const handleCancel = () => {
    if (!jobId || !canCancel) return;

    const policyText = getCancellationPolicyText(status?.cancellationPolicy);
    const policyMsg = policyText
      ? policyText
      : currentStatus === "pending"
        ? "The driver hasn't been assigned yet — this is a free cancellation."
        : "A driver has already been assigned. A cancellation fee may apply per the company's policy.";

    Alert.alert(
      "Cancel Tow Request?",
      policyMsg,
      [
        { text: "Keep Job", style: "cancel" },
        {
          text: "Cancel Job",
          style: "destructive",
          onPress: async () => {
            setCancelling(true);
            try {
              await cancelTowJob(jobId, {
                customerPhone: (user as any)?.phone ?? undefined,
              });
              setStatus((prev) => prev ? { ...prev, status: "cancelled" } : prev);
              if (intervalRef.current) clearInterval(intervalRef.current);
            } catch {
              const phone = status?.companyPhone;
              Alert.alert(
                "Contact Company to Cancel",
                phone
                  ? `Please call ${phone} to cancel your tow request (Job: ${jobId}).`
                  : `Please contact the towing company directly to cancel Job ${jobId}.`,
              );
            } finally {
              setCancelling(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.replace("/(tabs)")} style={styles.backBtn} hitSlop={12}>
          <Feather name="x" size={22} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerCenter}>
          <View style={[styles.headerIcon, { backgroundColor: cfg.color + "20" }]}>
            <Feather name="truck" size={16} color="#b45309" />
          </View>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Tracking your tow</Text>
        </View>
        <Pressable onPress={fetchStatus} style={styles.backBtn} hitSlop={12}>
          <Feather name="refresh-cw" size={18} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>

        {/* Job ID */}
        <View style={[styles.jobIdCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.jobIdLabel, { color: colors.mutedForeground }]}>JOB REFERENCE</Text>
          <Text style={[styles.jobId, { color: colors.foreground }]}>{jobId}</Text>
        </View>

        {/* Status hero */}
        {loading && !status ? (
          <View style={styles.centerSpinner}>
            <ActivityIndicator size="large" color="#b45309" />
            <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading status…</Text>
          </View>
        ) : (
          <>
            <View style={[styles.statusHero, { backgroundColor: cfg.color + "12", borderColor: cfg.color + "30" }]}>
              <View style={[styles.statusIconWrap, { backgroundColor: cfg.color + "20" }]}>
                <Feather name={cfg.icon} size={32} color={cfg.color} />
              </View>
              <Text style={[styles.statusLabel, { color: cfg.color }]}>{cfg.label}</Text>
              {status?.eta && (
                <Text style={[styles.statusEta, { color: colors.foreground }]}>
                  ETA: {status.eta}
                </Text>
              )}
              {!isTerminal && (
                <View style={styles.refreshNote}>
                  <ActivityIndicator size="small" color={cfg.color} />
                  <Text style={[styles.refreshNoteText, { color: colors.mutedForeground }]}>
                    Auto-refreshing every 20s
                  </Text>
                </View>
              )}
            </View>

            {/* Progress timeline */}
            {currentStatus !== "cancelled" && (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Progress</Text>
                {STATUS_ORDER.map((s, i) => {
                  const done = i < currentIdx || (i === currentIdx && isTerminal);
                  const active = i === currentIdx && !isTerminal;
                  const scfg = STATUS_CONFIG[s];
                  return (
                    <View key={s} style={styles.timelineRow}>
                      <View style={styles.timelineLeft}>
                        <View style={[styles.timelineDot, {
                          backgroundColor: done ? "#16a34a" : active ? scfg.color : colors.muted,
                          borderColor: done ? "#16a34a" : active ? scfg.color : colors.border,
                        }]}>
                          {done
                            ? <Feather name="check" size={10} color="#fff" />
                            : active
                              ? <ActivityIndicator size="small" color="#fff" style={{ transform: [{ scale: 0.6 }] }} />
                              : null
                          }
                        </View>
                        {i < STATUS_ORDER.length - 1 && (
                          <View style={[styles.timelineLine, { backgroundColor: done ? "#16a34a" : colors.border }]} />
                        )}
                      </View>
                      <View style={styles.timelineContent}>
                        <Text style={[styles.timelineLabel, {
                          color: done ? "#16a34a" : active ? scfg.color : colors.mutedForeground,
                          fontFamily: active ? "Inter_600SemiBold" : "Inter_400Regular",
                        }]}>
                          {scfg.label}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Driver info */}
            {status?.driver && (status.driver.name || status.driver.vehicle) && (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Your driver</Text>
                {status.driver.name && (
                  <View style={styles.driverRow}>
                    <Feather name="user" size={15} color={colors.mutedForeground} />
                    <Text style={[styles.driverText, { color: colors.foreground }]}>{status.driver.name}</Text>
                  </View>
                )}
                {status.driver.vehicle && (
                  <View style={styles.driverRow}>
                    <Feather name="truck" size={15} color={colors.mutedForeground} />
                    <Text style={[styles.driverText, { color: colors.foreground }]}>{status.driver.vehicle}</Text>
                  </View>
                )}
                {status.driver.phone && (
                  <Pressable style={[styles.callBtn, { backgroundColor: "#16a34a15", borderColor: "#16a34a30" }]}>
                    <Feather name="phone" size={15} color="#16a34a" />
                    <Text style={[styles.callBtnText, { color: "#16a34a" }]}>Call driver: {status.driver.phone}</Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* Job details */}
            {(status?.pickup || status?.problem) && (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Job details</Text>
                {status.pickup && (
                  <View style={styles.driverRow}>
                    <Feather name="map-pin" size={14} color={colors.mutedForeground} />
                    <Text style={[styles.driverText, { color: colors.foreground }]}>{status.pickup}</Text>
                  </View>
                )}
                {status.dropoff && (
                  <View style={styles.driverRow}>
                    <Feather name="flag" size={14} color={colors.mutedForeground} />
                    <Text style={[styles.driverText, { color: colors.foreground }]}>{status.dropoff}</Text>
                  </View>
                )}
                {status.problem && (
                  <View style={styles.driverRow}>
                    <Feather name="alert-circle" size={14} color={colors.mutedForeground} />
                    <Text style={[styles.driverText, { color: colors.foreground }]}>{status.problem}</Text>
                  </View>
                )}
              </View>
            )}

            {/* Call operator button — shown whenever we have a phone number */}
            {status?.companyPhone && (
              <Pressable
                onPress={() => Linking.openURL(`tel:${status.companyPhone}`)}
                style={[styles.callBtn, { backgroundColor: "#2563eb15", borderColor: "#2563eb30" }]}
              >
                <Feather name="phone" size={15} color="#2563eb" />
                <Text style={[styles.callBtnText, { color: "#2563eb" }]}>
                  Call operator: {status.companyPhone}
                </Text>
              </Pressable>
            )}

            {error && (
              <View style={[styles.errorBanner, { backgroundColor: colors.destructive + "15", borderColor: colors.destructive + "30" }]}>
                <Feather name="wifi-off" size={14} color={colors.destructive} />
                <Text style={[styles.errorText, { color: colors.destructive }]}>{error} — will retry</Text>
              </View>
            )}

            {/* Cancel button — shown when server says canCancel (falls back to local status logic) */}
            {canCancel && (
              <Pressable
                onPress={handleCancel}
                disabled={cancelling}
                style={({ pressed }) => [
                  styles.cancelBtn,
                  { borderColor: "#fca5a5", opacity: pressed || cancelling ? 0.6 : 1 },
                ]}
              >
                {cancelling ? (
                  <ActivityIndicator size="small" color="#dc2626" />
                ) : (
                  <>
                    <Feather name="x-circle" size={15} color="#dc2626" />
                    <Text style={styles.cancelBtnText}>
                      {currentStatus === "pending" ? "Cancel Job (Free)" : "Cancel Job"}
                    </Text>
                  </>
                )}
              </Pressable>
            )}

            {isTerminal && (
              <Pressable onPress={() => router.replace("/(tabs)")} style={[styles.homeBtn, { backgroundColor: colors.primary }]}>
                <Text style={styles.homeBtnText}>Back to Home</Text>
              </Pressable>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, gap: 12 },
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  headerIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  content: { padding: 16, gap: 12 },
  jobIdCard: { borderRadius: 12, borderWidth: 1, padding: 14, alignItems: "center" },
  jobIdLabel: { fontSize: 11, fontFamily: "Inter_500Medium", letterSpacing: 0.8, marginBottom: 4 },
  jobId: { fontSize: 18, fontFamily: "Inter_700Bold" },
  centerSpinner: { alignItems: "center", justifyContent: "center", gap: 12, padding: 40 },
  loadingText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  statusHero: { borderRadius: 16, borderWidth: 1, padding: 24, alignItems: "center", gap: 10 },
  statusIconWrap: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  statusLabel: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  statusEta: { fontSize: 14, fontFamily: "Inter_500Medium" },
  refreshNote: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  refreshNoteText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 10 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  timelineRow: { flexDirection: "row", gap: 12 },
  timelineLeft: { alignItems: "center", width: 20 },
  timelineDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  timelineLine: { width: 1.5, flex: 1, marginVertical: 3, minHeight: 18 },
  timelineContent: { flex: 1, paddingBottom: 16 },
  timelineLabel: { fontSize: 14, lineHeight: 20 },
  driverRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  driverText: { fontSize: 14, fontFamily: "Inter_400Regular", flex: 1 },
  callBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, padding: 12, marginTop: 4 },
  callBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  errorBanner: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, padding: 12 },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  homeBtn: { borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  homeBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
  cancelBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    backgroundColor: "#fee2e2",
  },
  cancelBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#dc2626" },
});
