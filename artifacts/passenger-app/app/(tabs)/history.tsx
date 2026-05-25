import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HistoryCard } from "@/components/HistoryCard";
import { useTripHistory } from "@/context/TripContext";
import { useColors } from "@/hooks/useColors";
import { ServiceType } from "@/context/TripContext";

const FILTERS: { id: ServiceType | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "taxi", label: "Taxi" },
  { id: "food", label: "Food" },
  { id: "freight", label: "Freight" },
];

export default function HistoryScreen() {
  const colors = useColors();
  const { history, clearHistory } = useTripHistory();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<ServiceType | "all">("all");

  const filtered = filter === "all" ? history : history.filter((h) => h.serviceType === filter);

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 16, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>History</Text>
        {history.length > 0 && (
          <Pressable
            onPress={() => {
              Alert.alert("Clear History", "Remove all trip history?", [
                { text: "Cancel" },
                { text: "Clear", style: "destructive", onPress: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); clearHistory(); } },
              ]);
            }}
          >
            <Feather name="trash-2" size={20} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>

      <View style={[styles.filterRow, { borderBottomColor: colors.border }]}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.id}
            onPress={() => { Haptics.selectionAsync(); setFilter(f.id); }}
            style={[
              styles.filterBtn,
              {
                backgroundColor: filter === f.id ? colors.primary : "transparent",
                borderColor: filter === f.id ? colors.primary : colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.filterText,
                { color: filter === f.id ? "#fff" : colors.mutedForeground },
              ]}
            >
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 34 + 84 },
        ]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!!filtered.length}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="clock" size={44} color={colors.border} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No trips yet</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Your ride and order history will appear here.
            </Text>
          </View>
        }
        renderItem={({ item }) => <HistoryCard item={item} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  filterRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  filterBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  list: { padding: 20, gap: 10 },
  separator: { height: 10 },
  empty: { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 30 },
});
