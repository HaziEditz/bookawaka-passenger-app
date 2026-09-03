import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { HistoryItem } from "@/context/TripContext";
import { FALLBACK_TZ } from "@/lib/timezone";
import { formatCurrency } from "@/lib/fareCalculator";

const SERVICE_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  taxi: "navigation",
  food: "shopping-bag",
  freight: "package",
};

const SERVICE_COLORS: Record<string, string> = {
  taxi: "#1e40af",
  food: "#f97316",
  freight: "#7c3aed",
};

const STATUS_COLORS: Record<string, string> = {
  completed: "#22c55e",
  cancelled: "#ef4444",
  en_route: "#1e40af",
};

export function HistoryCard({
  item,
  onPress,
}: {
  item: HistoryItem;
  onPress?: () => void;
}) {
  const colors = useColors();
  const serviceColor = SERVICE_COLORS[item.serviceType] ?? colors.primary;
  const statusColor = STATUS_COLORS[item.status] ?? colors.mutedForeground;

  const title =
    item.serviceType === "taxi"
      ? `${item.from} → ${item.to}`
      : item.serviceType === "food"
      ? item.restaurantName ?? "Food Order"
      : item.description ?? "Freight";

  const dateStr = new Date(item.date).toLocaleDateString("en-NZ", {
    timeZone: FALLBACK_TZ,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed && onPress ? 0.85 : 1,
        },
      ]}
    >
      <View style={[styles.iconBox, { backgroundColor: serviceColor + "20" }]}>
        <Feather name={SERVICE_ICONS[item.serviceType] ?? "circle"} size={20} color={serviceColor} />
      </View>
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.date, { color: colors.mutedForeground }]}>{dateStr}</Text>
        <View style={styles.bottomRow}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + "20" }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>
              {item.status.replace("_", " ")}
            </Text>
          </View>
          <Text style={[styles.price, { color: colors.foreground }]}>{formatCurrency(item.price)}</Text>
        </View>
      </View>
      {onPress ? (
        <Feather name="chevron-right" size={18} color={colors.mutedForeground} style={{ marginTop: 12 }} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "flex-start",
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { flex: 1, gap: 4 },
  title: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  date: { fontSize: 12, fontFamily: "Inter_400Regular" },
  bottomRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  statusText: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "capitalize" },
  price: { fontSize: 15, fontFamily: "Inter_700Bold" },
});
