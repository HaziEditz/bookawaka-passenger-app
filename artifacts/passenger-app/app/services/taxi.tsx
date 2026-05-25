import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TrackingMap } from "@/components/TrackingMap";
import { PaymentSelector } from "@/components/PaymentSelector";
import { useAuth } from "@/context/AuthContext";
import { useTripHistory } from "@/context/TripContext";
import { useColors } from "@/hooks/useColors";
import { PaymentMethod } from "@/context/TripContext";

const RIDE_TYPES = [
  { id: "economy", label: "Economy", price: 8, icon: "navigation" as const, desc: "Affordable ride" },
  { id: "comfort", label: "Comfort", price: 14, icon: "truck" as const, desc: "Spacious & comfy" },
  { id: "xl", label: "XL", price: 20, icon: "package" as const, desc: "Up to 6 passengers" },
];

const MOCK_DRIVERS = ["Ahmed Hassan", "Mohamed Ali", "Yusuf Ibrahim", "Khalid Omar"];

export default function TaxiScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const { addToHistory } = useTripHistory();
  const insets = useSafeAreaInsets();

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rideType, setRideType] = useState("economy");
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState(false);
  const [driver] = useState(MOCK_DRIVERS[Math.floor(Math.random() * MOCK_DRIVERS.length)]);
  const [eta] = useState(Math.floor(Math.random() * 8) + 3);

  const selectedRide = RIDE_TYPES.find((r) => r.id === rideType)!;

  const handleBook = async () => {
    if (!from.trim() || !to.trim()) {
      Alert.alert("Missing Info", "Please enter pickup and destination.");
      return;
    }
    if (!user) { router.push("/auth/login"); return; }
    if (payment === "wallet" && user.walletBalance < selectedRide.price) {
      Alert.alert("Insufficient Balance", "Please add funds or choose another payment method.");
      return;
    }
    setBooking(true);
    await new Promise((r) => setTimeout(r, 1500));
    setBooking(false);
    setBooked(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await addToHistory({
      serviceType: "taxi",
      status: "en_route",
      from: from.trim(),
      to: to.trim(),
      price: selectedRide.price,
      paymentMethod: payment,
      driverName: driver,
      driverRating: 4.8,
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 20 : 0), borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Book a Taxi</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {booked ? (
          <View style={styles.trackingSection}>
            <TrackingMap
              from={from}
              to={to}
              status="en_route"
              driverName={driver}
              eta={eta}
            />
            <Pressable
              onPress={() => { setBooked(false); setFrom(""); setTo(""); }}
              style={[styles.btn, { backgroundColor: colors.destructive }]}
            >
              <Text style={styles.btnText}>Cancel Trip</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>WHERE TO?</Text>
              <View style={[styles.locationCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.locRow}>
                  <View style={[styles.dot, { backgroundColor: colors.success }]} />
                  <TextInput
                    style={[styles.locInput, { color: colors.foreground }]}
                    placeholder="Pickup location"
                    placeholderTextColor={colors.mutedForeground}
                    value={from}
                    onChangeText={setFrom}
                  />
                </View>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <View style={styles.locRow}>
                  <View style={[styles.dot, { backgroundColor: colors.destructive }]} />
                  <TextInput
                    style={[styles.locInput, { color: colors.foreground }]}
                    placeholder="Destination"
                    placeholderTextColor={colors.mutedForeground}
                    value={to}
                    onChangeText={setTo}
                  />
                </View>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>RIDE TYPE</Text>
              <View style={styles.rideTypes}>
                {RIDE_TYPES.map((r) => (
                  <Pressable
                    key={r.id}
                    onPress={() => { Haptics.selectionAsync(); setRideType(r.id); }}
                    style={({ pressed }) => [
                      styles.rideCard,
                      {
                        backgroundColor: rideType === r.id ? colors.primary : colors.card,
                        borderColor: rideType === r.id ? colors.primary : colors.border,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <Feather
                      name={r.icon}
                      size={22}
                      color={rideType === r.id ? "#fff" : colors.mutedForeground}
                    />
                    <Text
                      style={[
                        styles.rideLabel,
                        { color: rideType === r.id ? "#fff" : colors.foreground },
                      ]}
                    >
                      {r.label}
                    </Text>
                    <Text
                      style={[
                        styles.ridePrice,
                        { color: rideType === r.id ? "#fff" : colors.primary },
                      ]}
                    >
                      ${r.price}
                    </Text>
                    <Text
                      style={[
                        styles.rideDesc,
                        { color: rideType === r.id ? "rgba(255,255,255,0.7)" : colors.mutedForeground },
                      ]}
                    >
                      {r.desc}
                    </Text>
                  </Pressable>
                ))}
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
                { backgroundColor: colors.primary, opacity: pressed || booking ? 0.7 : 1 },
              ]}
            >
              <Text style={styles.btnText}>
                {booking ? "Finding Driver..." : `Book – $${selectedRide.price}`}
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

import { Platform } from "react-native";

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
  scroll: { flex: 1 },
  content: { padding: 20, gap: 20 },
  trackingSection: { gap: 16 },
  section: { gap: 10 },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1 },
  locationCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  locRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  locInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  divider: { height: 1, marginLeft: 36 },
  rideTypes: { flexDirection: "row", gap: 10 },
  rideCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
    alignItems: "center",
    gap: 4,
  },
  rideLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  ridePrice: { fontSize: 16, fontFamily: "Inter_700Bold" },
  rideDesc: { fontSize: 10, fontFamily: "Inter_400Regular", textAlign: "center" },
  btn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
