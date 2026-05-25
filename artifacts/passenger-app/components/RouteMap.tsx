import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { LatLng } from "@/lib/googlePlaces";
import { useColors } from "@/hooks/useColors";

interface Props {
  pickup: LatLng;
  destination: LatLng;
  driverLocation?: LatLng | null;
  polyline?: LatLng[];
  distanceText?: string;
  durationText?: string;
  height?: number;
}

export function RouteMap({ pickup, destination, distanceText, durationText, height = 220 }: Props) {
  const colors = useColors();
  return (
    <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border, minHeight: height * 0.65 }]}>
      <View style={[styles.mapIcon, { backgroundColor: colors.primary + "15" }]}>
        <Feather name="map" size={28} color={colors.primary} />
      </View>
      <Text style={[styles.infoTitle, { color: colors.foreground }]}>Route Preview</Text>
      <View style={styles.routeRows}>
        <View style={styles.routeRow}>
          <View style={[styles.dot, { backgroundColor: colors.success }]} />
          <Text style={[styles.routeLabel, { color: colors.mutedForeground }]}>Pickup</Text>
        </View>
        <View style={[styles.routeLine, { backgroundColor: colors.border }]} />
        <View style={styles.routeRow}>
          <View style={[styles.dot, { backgroundColor: colors.destructive }]} />
          <Text style={[styles.routeLabel, { color: colors.mutedForeground }]}>Destination</Text>
        </View>
      </View>
      {(distanceText || durationText) && (
        <View style={[styles.metaRow, { backgroundColor: colors.secondary, borderRadius: 10 }]}>
          {distanceText && (
            <View style={styles.metaItem}>
              <Feather name="navigation" size={12} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.foreground }]}>{distanceText}</Text>
            </View>
          )}
          {durationText && (
            <View style={styles.metaItem}>
              <Feather name="clock" size={12} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.foreground }]}>{durationText}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  infoCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    alignItems: "center",
    gap: 12,
    justifyContent: "center",
  },
  mapIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  infoTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  routeRows: { gap: 4, alignItems: "center" },
  routeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  routeLine: { width: 2, height: 20, marginLeft: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  routeLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  metaRow: { flexDirection: "row", gap: 20, paddingHorizontal: 16, paddingVertical: 8 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
