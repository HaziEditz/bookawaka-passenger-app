import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ref as rtdbRef, set as rtdbSet, onValue as rtdbOnValue } from "firebase/database";
import { rtdb } from "@/lib/firebase";
import { createJobId } from "@/lib/jobApi";
import { openStripeCheckout } from "@/lib/stripePayment";
import { PaymentSelector } from "@/components/PaymentSelector";
import { useAuth } from "@/context/AuthContext";
import { useCompanies } from "@/context/CompaniesContext";
import { useTripHistory } from "@/context/TripContext";
import { PaymentMethod } from "@/context/TripContext";
import { useColors } from "@/hooks/useColors";

const FREIGHT_TYPES = [
  { id: "small",  label: "Small Package", price: 6,  icon: "package" as const, desc: "Up to 5kg" },
  { id: "medium", label: "Medium Box",    price: 14, icon: "archive" as const, desc: "5–20kg"   },
  { id: "large",  label: "Large Freight", price: 35, icon: "truck"   as const, desc: "20kg+"    },
];

const ACCENT = "#7c3aed";

interface FreightRecord {
  status?: string;
  pickupConfirmed?: boolean;
  pickupConfirmedAt?: number;
  deliveryConfirmed?: boolean;
  deliveredAt?: number;
  driverName?: string;
  driverPhone?: string;
}

function deriveStatus(r: FreightRecord): "awaiting_pickup" | "in_transit" | "delivered" {
  if (r.deliveryConfirmed) return "delivered";
  if (r.pickupConfirmed)   return "in_transit";
  return "awaiting_pickup";
}

const STATUS_CONFIG = {
  awaiting_pickup: { label: "Awaiting pickup",    icon: "clock"   as const, color: "#6b7280" },
  in_transit:      { label: "In transit",          icon: "truck"   as const, color: "#d97706" },
  delivered:       { label: "Package delivered",   icon: "package" as const, color: "#16a34a" },
};

const STATUS_ORDER: Array<keyof typeof STATUS_CONFIG> = [
  "awaiting_pickup",
  "in_transit",
  "delivered",
];

export default function FreightScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const { companies } = useCompanies();
  const { addToHistory } = useTripHistory();
  const insets = useSafeAreaInsets();

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [description, setDescription] = useState("");
  const [freightType, setFreightType] = useState("small");
  const [payment, setPayment] = useState<PaymentMethod>("card");
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState(false);
  const [freightData, setFreightData] = useState<FreightRecord>({});
  const [activeBookingId, setActiveBookingId] = useState<string | null>(null);
  const listenerUnsub = useRef<(() => void) | null>(null);

  const selected = FREIGHT_TYPES.find((f) => f.id === freightType)!;

  useEffect(() => {
    return () => { listenerUnsub.current?.(); };
  }, []);

  const handleBook = async () => {
    if (!from.trim() || !to.trim()) {
      Alert.alert("Missing Info", "Please enter pickup and delivery address.");
      return;
    }
    if (!user) { router.push("/auth/login"); return; }
    setBooking(true);

    // Use first real company as the operator for this freight booking
    const cid = companies.find((c) => c.id !== "any")?.id ?? "demo";

    try {
      // Get a server-issued job ID (same format the dispatcher expects)
      const bookingId = await createJobId({
        companyId: cid,
        passenger: { name: (user as any).name ?? "Guest", phone: (user as any).phone ?? "" },
        pickup:  { address: from.trim(), lat: 0, lng: 0 },
        dropoff: { address: to.trim(),   lat: 0, lng: 0 },
        notes: `Freight: ${selected.label}${description.trim() ? ` – ${description.trim()}` : ""}`,
      });

      if (!bookingId) throw new Error("Could not get booking ID");

      const jobData = {
        jobId: bookingId,
        serviceType: "freight",
        BookingSource: "PassengerApp",
        Status: "Pending",
        status: "pending",
        pickupAddress: from.trim(),
        deliveryAddress: to.trim(),
        description: description.trim() || selected.label,
        packageType: selected.id,
        price: selected.price,
        paymentMethod: payment,
        PaymentMethod: payment,
        PassengerName: (user as any).name ?? "",
        PassengerPhone: (user as any).phone ?? "",
        passengerId: user.id,
        companyId: cid,
        pickupConfirmed: false,
        deliveryConfirmed: false,
        createdAt: Date.now(),
        requestedAt: new Date().toISOString(),
        paymentStatus: "pending" as string,
      };

      // Stripe checkout for card payments — opens before writing to Firebase
      if (payment === "card") {
        try {
          await openStripeCheckout({
            cid,
            bookingId,
            description: `Freight: ${selected.label}${description.trim() ? ` — ${description.trim()}` : ""}`,
            amount: selected.price,
            email: (user as any).email ?? undefined,
          });
          jobData.paymentStatus = "stripe_checkout_opened";
        } catch (stripeErr: any) {
          setBooking(false);
          Alert.alert(
            "Payment Failed",
            stripeErr?.message ?? "Could not open payment. Please try a different payment method.",
          );
          return;
        }
      }

      // Write to pendingjobs so dispatcher sees it
      rtdbSet(rtdbRef(rtdb, `pendingjobs/${cid}/${bookingId}`), jobData)
        .catch((e) => console.warn("[FreightOrder] pendingjobs write failed:", e));

      // Write initial booking record to freightOrders/{cid}/{bookingId}
      await rtdbSet(rtdbRef(rtdb, `freightOrders/${cid}/${bookingId}`), jobData);

      // Listen to the full freightOrders/{cid}/{bookingId} record for live status
      const recordRef = rtdbRef(rtdb, `freightOrders/${cid}/${bookingId}`);
      const unsub = rtdbOnValue(recordRef, (snap) => {
        if (snap.exists()) {
          setFreightData(snap.val() as FreightRecord);
        }
      });
      listenerUnsub.current = unsub;

      setActiveBookingId(bookingId);
      setFreightData({ pickupConfirmed: false, deliveryConfirmed: false });
    } catch (e) {
      // Fall back gracefully — still show the tracking screen
    }

    setBooking(false);
    setBooked(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    await addToHistory({
      serviceType: "freight",
      status: "en_route",
      from: from.trim(),
      to: to.trim(),
      description: description.trim() || selected.label,
      price: selected.price,
      paymentMethod: payment,
      driverName: "Courier",
    });
  };

  const handleCancel = () => {
    listenerUnsub.current?.();
    listenerUnsub.current = null;
    setBooked(false);
    setFrom("");
    setTo("");
    setDescription("");
    setFreightData({});
    setActiveBookingId(null);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 20 : 0), borderBottomColor: colors.border }]}>
        <Pressable onPress={booked ? undefined : () => router.back()}>
          <Feather name={booked ? "package" : "arrow-left"} size={22} color={booked ? ACCENT : colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          {booked ? "Freight Tracking" : "Freight & Courier"}
        </Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        {booked ? (
          <View style={styles.section}>

            {/* Booking reference */}
            {activeBookingId && (
              <View style={[styles.refCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.refLabel, { color: colors.mutedForeground }]}>BOOKING REF</Text>
                <Text style={[styles.refValue, { color: colors.foreground }]}>{activeBookingId}</Text>
              </View>
            )}

            {/* Live status hero */}
            {(() => {
              const s = deriveStatus(freightData);
              const cfg = STATUS_CONFIG[s];
              const isDelivered = s === "delivered";
              const currentIdx = STATUS_ORDER.indexOf(s);
              return (
                <>
                  <View style={[styles.statusHero, { backgroundColor: cfg.color + "12", borderColor: cfg.color + "30" }]}>
                    <View style={[styles.statusIconWrap, { backgroundColor: cfg.color + "20" }]}>
                      <Feather name={cfg.icon} size={32} color={cfg.color} />
                    </View>
                    <Text style={[styles.statusLabel, { color: cfg.color }]}>{cfg.label}</Text>
                    {freightData.pickupConfirmedAt && s === "in_transit" && (
                      <Text style={[styles.statusSub, { color: colors.mutedForeground }]}>
                        Picked up {new Date(freightData.pickupConfirmedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </Text>
                    )}
                    {freightData.deliveredAt && isDelivered && (
                      <Text style={[styles.statusSub, { color: colors.mutedForeground }]}>
                        Delivered {new Date(freightData.deliveredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </Text>
                    )}
                    {!isDelivered && (
                      <View style={styles.liveRow}>
                        <ActivityIndicator size="small" color={cfg.color} />
                        <Text style={[styles.liveText, { color: colors.mutedForeground }]}>Live updates</Text>
                      </View>
                    )}
                  </View>

                  {/* Progress timeline */}
                  <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>Progress</Text>
                    {STATUS_ORDER.map((key, i) => {
                      const done = i < currentIdx || (i === currentIdx && isDelivered);
                      const active = i === currentIdx && !isDelivered;
                      const scfg = STATUS_CONFIG[key];
                      return (
                        <View key={key} style={styles.timelineRow}>
                          <View style={styles.timelineLeft}>
                            <View style={[styles.timelineDot, {
                              backgroundColor: done ? "#16a34a" : active ? scfg.color : colors.muted,
                              borderColor:     done ? "#16a34a" : active ? scfg.color : colors.border,
                            }]}>
                              {done
                                ? <Feather name="check" size={10} color="#fff" />
                                : active
                                  ? <ActivityIndicator size="small" color="#fff" style={{ transform: [{ scale: 0.6 }] }} />
                                  : null}
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
                </>
              );
            })()}

            {/* Driver info (if dispatcher assigned one) */}
            {(freightData.driverName || freightData.driverPhone) && (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Your courier</Text>
                {freightData.driverName && (
                  <View style={styles.infoRow}>
                    <Feather name="user" size={15} color={colors.mutedForeground} />
                    <Text style={[styles.infoText, { color: colors.foreground }]}>{freightData.driverName}</Text>
                  </View>
                )}
                {freightData.driverPhone && (
                  <View style={styles.infoRow}>
                    <Feather name="phone" size={15} color={colors.mutedForeground} />
                    <Text style={[styles.infoText, { color: colors.foreground }]}>{freightData.driverPhone}</Text>
                  </View>
                )}
              </View>
            )}

            {/* Job details */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Shipment details</Text>
              <View style={styles.infoRow}>
                <Feather name="map-pin" size={14} color={colors.success} />
                <Text style={[styles.infoText, { color: colors.foreground }]}>{from}</Text>
              </View>
              <View style={styles.infoRow}>
                <Feather name="flag" size={14} color={ACCENT} />
                <Text style={[styles.infoText, { color: colors.foreground }]}>{to}</Text>
              </View>
              <View style={styles.infoRow}>
                <Feather name="package" size={14} color={colors.mutedForeground} />
                <Text style={[styles.infoText, { color: colors.foreground }]}>{description || selected.label}</Text>
              </View>
              <View style={styles.infoRow}>
                <Feather name="dollar-sign" size={14} color={colors.mutedForeground} />
                <Text style={[styles.infoText, { color: ACCENT }]}>${selected.price}</Text>
              </View>
            </View>

            {deriveStatus(freightData) === "delivered" ? (
              <Pressable onPress={handleCancel} style={[styles.btn, { backgroundColor: ACCENT }]}>
                <Text style={styles.btnText}>Done</Text>
              </Pressable>
            ) : (
              <Pressable onPress={handleCancel} style={[styles.btn, { backgroundColor: colors.destructive }]}>
                <Text style={styles.btnText}>Cancel Request</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>ADDRESSES</Text>
              <View style={[styles.locationCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.locRow}>
                  <View style={[styles.dot, { backgroundColor: colors.success }]} />
                  <TextInput
                    style={[styles.locInput, { color: colors.foreground }]}
                    placeholder="Pickup address"
                    placeholderTextColor={colors.mutedForeground}
                    value={from}
                    onChangeText={setFrom}
                  />
                </View>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <View style={styles.locRow}>
                  <View style={[styles.dot, { backgroundColor: ACCENT }]} />
                  <TextInput
                    style={[styles.locInput, { color: colors.foreground }]}
                    placeholder="Delivery address"
                    placeholderTextColor={colors.mutedForeground}
                    value={to}
                    onChangeText={setTo}
                  />
                </View>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>PACKAGE DESCRIPTION</Text>
              <View style={[styles.inputBox, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <Feather name="file-text" size={18} color={colors.mutedForeground} />
                <TextInput
                  style={[styles.input, { color: colors.foreground }]}
                  placeholder="What are you sending? (optional)"
                  placeholderTextColor={colors.mutedForeground}
                  value={description}
                  onChangeText={setDescription}
                />
              </View>
            </View>

            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>PACKAGE SIZE</Text>
              <View style={styles.freightTypes}>
                {FREIGHT_TYPES.map((f) => {
                  const isSelected = freightType === f.id;
                  return (
                    <Pressable
                      key={f.id}
                      onPress={() => { Haptics.selectionAsync(); setFreightType(f.id); }}
                      style={({ pressed }) => [
                        styles.freightCard,
                        {
                          backgroundColor: isSelected ? ACCENT : colors.card,
                          borderColor: isSelected ? ACCENT : colors.border,
                          opacity: pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      <Feather name={f.icon} size={22} color={isSelected ? "#fff" : colors.mutedForeground} />
                      <Text style={[styles.freightLabel, { color: isSelected ? "#fff" : colors.foreground }]}>
                        {f.label}
                      </Text>
                      <Text style={[styles.freightPrice, { color: isSelected ? "#fff" : ACCENT }]}>
                        ${f.price}
                      </Text>
                      <Text style={[styles.freightDesc, { color: isSelected ? "rgba(255,255,255,0.7)" : colors.mutedForeground }]}>
                        {f.desc}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.section}>
              <PaymentSelector selected={payment} onSelect={setPayment} />
            </View>

            <Pressable
              onPress={handleBook}
              disabled={booking}
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: ACCENT, opacity: pressed || booking ? 0.7 : 1 },
              ]}
            >
              <Text style={styles.btnText}>
                {booking ? "Processing..." : `Request Courier – $${selected.price}`}
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
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
  headerTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  content: { padding: 20, gap: 20 },
  section: { gap: 10 },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1 },
  refCard: { borderRadius: 12, borderWidth: 1, padding: 12, alignItems: "center" },
  refLabel: { fontSize: 10, fontFamily: "Inter_500Medium", letterSpacing: 0.8, marginBottom: 2 },
  refValue: { fontSize: 13, fontFamily: "Inter_700Bold" },
  statusHero: { borderRadius: 16, borderWidth: 1, padding: 24, alignItems: "center", gap: 10 },
  statusIconWrap: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  statusLabel: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  statusSub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  liveText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 10 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  timelineRow: { flexDirection: "row", gap: 12 },
  timelineLeft: { alignItems: "center", width: 20 },
  timelineDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  timelineLine: { width: 1.5, flex: 1, marginVertical: 3, minHeight: 18 },
  timelineContent: { flex: 1, paddingBottom: 16 },
  timelineLabel: { fontSize: 14, lineHeight: 20 },
  locationCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  locRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  locInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  divider: { height: 1, marginLeft: 36 },
  inputBox: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, gap: 10 },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  freightTypes: { flexDirection: "row", gap: 10 },
  freightCard: { flex: 1, borderRadius: 14, borderWidth: 1.5, padding: 12, alignItems: "center", gap: 4 },
  freightLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  freightPrice: { fontSize: 16, fontFamily: "Inter_700Bold" },
  freightDesc: { fontSize: 10, fontFamily: "Inter_400Regular", textAlign: "center" },
  btn: { borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  infoText: { fontSize: 14, fontFamily: "Inter_500Medium", flex: 1 },
});
