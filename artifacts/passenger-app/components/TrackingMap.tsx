import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Platform, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

interface TrackingMapProps {
  from: string;
  to: string;
  status: string;
  driverName: string;
  eta: number;
}

export function TrackingMap({ from, to, status, driverName, eta }: TrackingMapProps) {
  const colors = useColors();
  const pulse = useRef(new Animated.Value(1)).current;
  const [dotPos, setDotPos] = useState(0.15);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.3, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setDotPos((p) => Math.min(p + 0.005, 0.85));
    }, 300);
    return () => clearInterval(interval);
  }, []);

  const statusLabel =
    status === "searching"
      ? "Finding your driver..."
      : status === "confirmed"
      ? "Driver confirmed"
      : status === "en_route"
      ? "Driver is on the way"
      : status === "arrived"
      ? "Driver has arrived"
      : "Trip in progress";

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.mapArea, { backgroundColor: "#e0f2fe" }]}>
        <View style={styles.routeLine}>
          <View style={[styles.routeLineInner, { backgroundColor: colors.primary }]} />
          <Animated.View
            style={[
              styles.driverDot,
              {
                backgroundColor: colors.primary,
                left: `${dotPos * 100}%`,
                transform: [{ scale: pulse }],
              },
            ]}
          />
          <View style={[styles.endpoint, styles.startPoint, { backgroundColor: colors.success }]} />
          <View style={[styles.endpoint, styles.endPoint, { backgroundColor: colors.destructive }]} />
        </View>
        <View style={styles.mapLabels}>
          <View style={[styles.mapLabel, { backgroundColor: colors.card }]}>
            <Feather name="map-pin" size={12} color={colors.success} />
            <Text style={[styles.mapLabelText, { color: colors.foreground }]} numberOfLines={1}>
              {from}
            </Text>
          </View>
          <View style={[styles.mapLabel, { backgroundColor: colors.card }]}>
            <Feather name="navigation" size={12} color={colors.destructive} />
            <Text style={[styles.mapLabelText, { color: colors.foreground }]} numberOfLines={1}>
              {to}
            </Text>
          </View>
        </View>
      </View>
      <View style={styles.info}>
        <View style={styles.infoRow}>
          <View style={[styles.statusBadge, { backgroundColor: colors.primary + "20" }]}>
            <Feather name="clock" size={12} color={colors.primary} />
            <Text style={[styles.statusText, { color: colors.primary }]}>{statusLabel}</Text>
          </View>
          <Text style={[styles.etaText, { color: colors.mutedForeground }]}>ETA {eta} min</Text>
        </View>
        <View style={styles.driverRow}>
          <View style={[styles.driverAvatar, { backgroundColor: colors.primary }]}>
            <Feather name="user" size={16} color="#fff" />
          </View>
          <View>
            <Text style={[styles.driverName, { color: colors.foreground }]}>{driverName}</Text>
            <View style={styles.ratingRow}>
              {[1, 2, 3, 4, 5].map((s) => (
                <Feather key={s} name="star" size={10} color={s <= 4 ? colors.warning : colors.border} />
              ))}
              <Text style={[styles.ratingText, { color: colors.mutedForeground }]}> 4.8</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  mapArea: {
    height: 180,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  routeLine: {
    width: "100%",
    height: 4,
    backgroundColor: "#bfdbfe",
    borderRadius: 2,
    position: "relative",
    justifyContent: "center",
  },
  routeLineInner: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: "80%",
    borderRadius: 2,
    opacity: 0.4,
  },
  driverDot: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 9,
    top: -7,
    borderWidth: 3,
    borderColor: "#fff",
  },
  endpoint: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    top: -4,
    borderWidth: 2,
    borderColor: "#fff",
  },
  startPoint: { left: -4 },
  endPoint: { right: -4 },
  mapLabels: {
    position: "absolute",
    bottom: 12,
    left: 12,
    right: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  mapLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    flex: 1,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  mapLabelText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
  info: {
    padding: 14,
    gap: 12,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  statusText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  etaText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  driverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  driverAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  driverName: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 1,
    marginTop: 2,
  },
  ratingText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
});
