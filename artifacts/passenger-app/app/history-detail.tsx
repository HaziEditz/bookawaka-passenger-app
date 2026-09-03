import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTripHistory } from "@/context/TripContext";
import { formatCurrency } from "@/lib/fareCalculator";
import { useColors } from "@/hooks/useColors";
import { FALLBACK_TZ } from "@/lib/timezone";

export default function HistoryDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { history } = useTripHistory();

  const item = useMemo(() => history.find((h) => h.id === id), [history, id]);

  if (!item) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 16 }]}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backRow}
          hitSlop={12}
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
          <Text style={[styles.backText, { color: colors.foreground }]}>Back</Text>
        </Pressable>
        <Text style={[styles.missing, { color: colors.mutedForeground }]}>Trip not found.</Text>
      </View>
    );
  }

  const dateStr = new Date(item.date).toLocaleString("en-NZ", {
    timeZone: FALLBACK_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  const title =
    item.serviceType === "taxi"
      ? "Taxi trip"
      : item.serviceType === "food"
        ? item.restaurantName ?? "Food order"
        : item.description ?? "Freight";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            router.back();
          }}
          hitSlop={12}
          style={styles.backRow}
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Trip detail</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>{dateStr}</Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {item.from ? (
            <Row label="From" value={item.from} colors={colors} />
          ) : null}
          {item.to ? (
            <Row label="To" value={item.to} colors={colors} />
          ) : null}
          {item.items ? (
            <Row label="Items" value={item.items} colors={colors} />
          ) : null}
          <Row label="Status" value={item.status.replace("_", " ")} colors={colors} />
          <Row label="Payment" value={String(item.paymentMethod || "—")} colors={colors} />
          <Row label="Fare" value={formatCurrency(item.price)} colors={colors} />
          {item.driverName ? (
            <Row label="Driver" value={item.driverName} colors={colors} />
          ) : null}
          {item.bookingId ? (
            <Row label="Booking ID" value={item.bookingId} colors={colors} />
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function Row({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: { mutedForeground: string; foreground: string; border: string };
}) {
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  backRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  backText: { fontSize: 16, fontFamily: "Inter_500Medium" },
  missing: { marginTop: 40, textAlign: "center", fontFamily: "Inter_400Regular" },
  body: { padding: 20, gap: 10 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  meta: { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 8 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    marginTop: 8,
  },
  row: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  rowLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "uppercase" },
  rowValue: { fontSize: 15, fontFamily: "Inter_400Regular" },
});
