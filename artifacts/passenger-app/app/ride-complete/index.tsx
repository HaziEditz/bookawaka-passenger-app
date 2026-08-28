import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRide } from "@/context/RideContext";
import { useTripHistory } from "@/context/TripContext";
import { formatCurrency } from "@/lib/fareCalculator";
import { useColors } from "@/hooks/useColors";

const TIPS = [0, 2, 5, 10];
const FAV_KEY = "@fav_drivers";

function goHome() {
  try {
    router.replace("/(tabs)");
  } catch {
    try {
      router.navigate("/(tabs)");
    } catch {
      /* last resort — avoid blank screen */
    }
  }
}

export default function RideCompleteScreen() {
  const colors = useColors();
  const { activeRide, completeRide } = useRide();
  const { addToHistory } = useTripHistory();
  const insets = useSafeAreaInsets();

  const [rating, setRating] = useState(5);
  const [tip, setTip] = useState(0);
  const [comment, setComment] = useState("");
  const [isFav, setIsFav] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [snapshot, setSnapshot] = useState(activeRide);
  const didComplete = useRef(false);
  const navigatedHome = useRef(false);

  // Keep a local snapshot so clearing activeRide does not blank this screen mid-Done.
  useEffect(() => {
    if (activeRide) setSnapshot(activeRide);
  }, [activeRide]);

  useEffect(() => {
    if (!activeRide && !snapshot && !didComplete.current) {
      navigatedHome.current = true;
      goHome();
    }
  }, []);

  const ride = activeRide ?? snapshot;

  if (!ride) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.leavingText, { color: colors.mutedForeground }]}>Returning home…</Text>
      </View>
    );
  }

  const { pickup, destination, driver, fare, payment, rideshare, passengerCount, firestoreId, id } = ride;
  const splitFare = rideshare && passengerCount && passengerCount > 1 ? Math.round((fare / passengerCount) * 100) / 100 : null;
  const yourFare = splitFare ?? fare;
  const total = yourFare + tip;

  const handleDone = async () => {
    if (submitting || navigatedHome.current) return;
    setSubmitting(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Clear Active Ride before navigating home so the banner cannot flash.
    navigatedHome.current = true;
    didComplete.current = true;

    const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | void> =>
      Promise.race([
        p,
        new Promise<void>((resolve) => setTimeout(resolve, ms)),
      ]);

    // completeRide snapshots then clearRide() synchronously at start.
    const completeP = completeRide(rating, tip);
    goHome();

    void (async () => {
      if (isFav && driver) {
        try {
          const raw = await AsyncStorage.getItem(FAV_KEY);
          const favs = raw ? JSON.parse(raw) : [];
          const alreadyFav = favs.some((f: any) => f.name === driver.name);
          if (!alreadyFav) {
            favs.push({ name: driver.name, cab: driver.cab, plate: driver.plate, rating: driver.rating });
            await AsyncStorage.setItem(FAV_KEY, JSON.stringify(favs));
          }
        } catch {}
      }

      try {
        await withTimeout(
          addToHistory({
            serviceType: "taxi",
            status: "completed",
            from: pickup.address,
            to: destination.address,
            price: total,
            paymentMethod:
              payment === "wallet" ? "wallet"
              : payment === "cash" ? "cash"
              : payment === "account" || payment === "business_account" || payment === "acc" ? "account"
              : payment === "gift_card" ? "gift_card"
              : "card",
            driverName: driver?.name,
            driverRating: rating,
            bookingId: firestoreId || id,
          }),
          4000,
        );
      } catch {}

      try {
        await withTimeout(completeP, 4000);
      } catch {}
    })();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 110 }]}
      >
        <View style={[styles.successIcon, { backgroundColor: colors.success + "20" }]}>
          <Feather name="check-circle" size={52} color={colors.success} />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>Ride Complete!</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {pickup.address.split(",")[0]} → {destination.address.split(",")[0]}
        </Text>

        {rideshare && passengerCount && passengerCount > 1 && (
          <View style={[styles.splitBadge, { backgroundColor: colors.primary + "15", borderColor: colors.primary }]}>
            <Feather name="users" size={14} color={colors.primary} />
            <Text style={[styles.splitText, { color: colors.primary }]}>
              Shared ride · {passengerCount} people · you pay {formatCurrency(yourFare)}
            </Text>
          </View>
        )}

        {driver && (
          <View style={[styles.driverCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.driverAvatar, { backgroundColor: colors.primary }]}>
              <Feather name="user" size={24} color="#fff" />
            </View>
            <View style={styles.driverInfo}>
              <Text style={[styles.driverName, { color: colors.foreground }]}>{driver.name}</Text>
              <Text style={[styles.driverCar, { color: colors.mutedForeground }]}>{driver.cab} · {driver.plate}</Text>
            </View>
            <Pressable
              onPress={() => { Haptics.selectionAsync(); setIsFav(!isFav); }}
              style={({ pressed }) => [styles.favBtn, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Feather name="heart" size={22} color={isFav ? colors.destructive : colors.border} />
            </Pressable>
          </View>
        )}
        {driver && isFav && (
          <Text style={[styles.favHint, { color: colors.success }]}>Added to Favourite Drivers</Text>
        )}

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>RATE YOUR DRIVER</Text>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((s) => (
              <Pressable key={s} onPress={() => { Haptics.selectionAsync(); setRating(s); }}>
                <Feather name="star" size={38} color={s <= rating ? colors.warning : colors.border} />
              </Pressable>
            ))}
          </View>
        </View>

        <View style={[styles.commentBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TextInput
            style={[styles.commentInput, { color: colors.foreground }]}
            placeholder="Leave a comment (optional)..."
            placeholderTextColor={colors.mutedForeground}
            value={comment}
            onChangeText={setComment}
            multiline
            numberOfLines={3}
          />
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ADD A TIP</Text>
          <Text style={[styles.tipHint, { color: colors.mutedForeground }]}>
            Tips are recorded for your driver. Card tip capture may require a follow-up charge.
          </Text>
          <View style={styles.tipRow}>
            {TIPS.map((t) => (
              <Pressable
                key={t}
                hitSlop={8}
                // onPressIn so tip selection wins even if a focused TextInput
                // would otherwise swallow the first tap (ScrollView default).
                onPressIn={() => {
                  Haptics.selectionAsync();
                  setTip(t);
                }}
                style={({ pressed }) => [
                  styles.tipBtn,
                  { backgroundColor: tip === t ? colors.primary : colors.card, borderColor: tip === t ? colors.primary : colors.border, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Text style={[styles.tipText, { color: tip === t ? "#fff" : colors.foreground }]}>
                  {t === 0 ? "No tip" : formatCurrency(t)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={[styles.receiptCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>RECEIPT</Text>
          {splitFare ? (
            <>
              <View style={styles.receiptRow}>
                <Text style={[styles.receiptLabel, { color: colors.mutedForeground }]}>Total ride fare</Text>
                <Text style={[styles.receiptValue, { color: colors.mutedForeground }]}>{formatCurrency(fare)}</Text>
              </View>
              <View style={styles.receiptRow}>
                <Text style={[styles.receiptLabel, { color: colors.foreground }]}>Your share (÷{passengerCount})</Text>
                <Text style={[styles.receiptValue, { color: colors.primary }]}>{formatCurrency(yourFare)}</Text>
              </View>
            </>
          ) : (
            <View style={styles.receiptRow}>
              <Text style={[styles.receiptLabel, { color: colors.mutedForeground }]}>Ride fare</Text>
              <Text style={[styles.receiptValue, { color: colors.foreground }]}>{formatCurrency(fare)}</Text>
            </View>
          )}
          {tip > 0 && (
            <View style={styles.receiptRow}>
              <Text style={[styles.receiptLabel, { color: colors.mutedForeground }]}>Tip</Text>
              <Text style={[styles.receiptValue, { color: colors.foreground }]}>{formatCurrency(tip)}</Text>
            </View>
          )}
          <View style={[styles.receiptDivider, { backgroundColor: colors.border }]} />
          <View style={styles.receiptRow}>
            <Text style={[styles.receiptTotal, { color: colors.foreground }]}>You Pay</Text>
            <Text style={[styles.receiptTotalValue, { color: colors.primary }]}>{formatCurrency(total)}</Text>
          </View>
          <View style={styles.receiptRow}>
            <Text style={[styles.receiptLabel, { color: colors.mutedForeground }]}>Payment</Text>
            <Text style={[styles.receiptValue, { color: colors.foreground }]}>
              {payment === "card" ? "Card" : payment === "wallet" ? "Wallet" : payment === "cash" ? "Cash" : "Account"}
            </Text>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16, backgroundColor: colors.background, borderTopColor: colors.border }]}>
        <Pressable
          onPress={handleDone}
          disabled={submitting}
          style={({ pressed }) => [styles.doneBtn, { backgroundColor: colors.primary, opacity: pressed || submitting ? 0.7 : 1 }]}
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.doneBtnText}>Done</Text>
          }
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center", gap: 12 },
  leavingText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  content: { paddingHorizontal: 24, gap: 20, alignItems: "center" },
  successIcon: { width: 100, height: 100, borderRadius: 50, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", textAlign: "center" },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  splitBadge: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, width: "100%" },
  splitText: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  driverCard: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 14, borderWidth: 1, padding: 16, width: "100%" },
  driverAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  driverInfo: { flex: 1, gap: 3 },
  driverName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  driverCar: { fontSize: 13, fontFamily: "Inter_400Regular" },
  favBtn: { padding: 4 },
  favHint: { fontSize: 12, fontFamily: "Inter_500Medium", alignSelf: "flex-start" },
  section: { gap: 10, width: "100%", alignItems: "center" },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1, alignSelf: "flex-start" },
  tipHint: { fontSize: 12, fontFamily: "Inter_400Regular", alignSelf: "flex-start", lineHeight: 16 },
  stars: { flexDirection: "row", gap: 8 },
  commentBox: { width: "100%", borderRadius: 12, borderWidth: 1, padding: 14 },
  commentInput: { fontSize: 14, fontFamily: "Inter_400Regular", minHeight: 70 },
  tipRow: { flexDirection: "row", gap: 8, width: "100%" },
  tipBtn: { flex: 1, borderRadius: 10, borderWidth: 1.5, paddingVertical: 10, alignItems: "center" },
  tipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  receiptCard: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 10, width: "100%" },
  receiptRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  receiptLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  receiptValue: { fontSize: 13, fontFamily: "Inter_500Medium" },
  receiptDivider: { height: 1 },
  receiptTotal: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  receiptTotalValue: { fontSize: 20, fontFamily: "Inter_700Bold" },
  bottomBar: { padding: 20, borderTopWidth: 1 },
  doneBtn: { borderRadius: 14, paddingVertical: 16, alignItems: "center", width: "100%" },
  doneBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
