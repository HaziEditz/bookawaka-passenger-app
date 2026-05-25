import MapView, { Marker, Polyline } from "react-native-maps";
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

export function RouteMap({ pickup, destination, driverLocation, polyline, distanceText, durationText, height = 220 }: Props) {
  const colors = useColors();
  const allPoints = [pickup, destination, ...(driverLocation ? [driverLocation] : [])];
  const latitudes = allPoints.map((p) => p.latitude);
  const longitudes = allPoints.map((p) => p.longitude);
  const midLat = (Math.max(...latitudes) + Math.min(...latitudes)) / 2;
  const midLng = (Math.max(...longitudes) + Math.min(...longitudes)) / 2;
  const deltaLat = Math.max(Math.max(...latitudes) - Math.min(...latitudes), 0.008) * 1.5;
  const deltaLng = Math.max(Math.max(...longitudes) - Math.min(...longitudes), 0.008) * 1.5;

  return (
    <View style={[styles.mapContainer, { height }]}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: midLat, longitude: midLng, latitudeDelta: deltaLat, longitudeDelta: deltaLng }}
        showsUserLocation={false}
        showsCompass={false}
        showsMyLocationButton={false}
      >
        {polyline && polyline.length > 0 && (
          <Polyline coordinates={polyline} strokeColor={colors.primary} strokeWidth={4} lineDashPattern={undefined} />
        )}
        <Marker coordinate={pickup} pinColor="green" title="Pickup" />
        <Marker coordinate={destination} pinColor="red" title="Destination" />
        {driverLocation && (
          <Marker coordinate={driverLocation} title="Driver">
            <View style={[styles.driverMarker, { backgroundColor: colors.primary }]}>
              <Feather name="navigation" size={14} color="#fff" />
            </View>
          </Marker>
        )}
      </MapView>
      {(distanceText || durationText) && (
        <View style={[styles.overlay, { backgroundColor: colors.card }]}>
          {distanceText && <Text style={[styles.overlayText, { color: colors.foreground }]}>{distanceText}</Text>}
          {durationText && <Text style={[styles.overlayMuted, { color: colors.mutedForeground }]}>{durationText}</Text>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  mapContainer: { borderRadius: 16, overflow: "hidden" },
  driverMarker: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  overlay: {
    position: "absolute",
    bottom: 10,
    left: 10,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  overlayText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  overlayMuted: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
