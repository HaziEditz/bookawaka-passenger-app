/**
 * In-place edit for a scheduled/later booking (any payment method).
 * Mirrors Active Ride destination/stop edit — does not cancel the job.
 */
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { get as rtdbGet, ref as rtdbRef } from "firebase/database";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PlacesAutocomplete } from "@/components/PlacesAutocomplete";
import { useAuth } from "@/context/AuthContext";
import { useNotification } from "@/context/NotificationContext";
import { useRide } from "@/context/RideContext";
import { useColors } from "@/hooks/useColors";
import { cancelBookingOnServer } from "@/lib/bookingApi";
import { getRoute } from "@/lib/directions";
import { calculateFare, formatCurrency } from "@/lib/fareCalculator";
import { rtdb } from "@/lib/firebase";
import { PlaceDetail } from "@/lib/googlePlaces";
import type { PlacesBias } from "@/lib/placesBias";

type StopRow = { id: string; address: string; lat: number; lng: number };

export default function EditScheduledScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { notify } = useNotification();
  const { firebaseUser } = useAuth();
  const { editScheduledBooking } = useRide();
  const params = useLocalSearchParams<{ jobId?: string; companyId?: string }>();
  const jobId = String(params.jobId || "").trim();
  const companyId = String(params.companyId || "").trim();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pickup, setPickup] = useState<{ address: string; lat: number; lng: number } | null>(null);
  const [destination, setDestination] = useState<PlaceDetail | null>(null);
  const [stops, setStops] = useState<StopRow[]>([]);
  const [notes, setNotes] = useState("");
  const [fare, setFare] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [vehicleType, setVehicleType] = useState("Sedan");

  useEffect(() => {
    if (!jobId || !companyId || !firebaseUser?.uid) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const [ab, pax] = await Promise.all([
          rtdbGet(rtdbRef(rtdb, `allbookings/${companyId}/${jobId}`)),
          rtdbGet(rtdbRef(rtdb, `Passengerjobs/${firebaseUser.uid}/${jobId}`)),
        ]);
        const row = {
          ...(pax.exists() ? pax.val() : {}),
          ...(ab.exists() ? ab.val() : {}),
        } as Record<string, any>;

        const pickAddr = String(row.PickupAddress ?? row.PickAddress ?? row.pickupAddress ?? "");
        const pickLat = Number(row.PickupLat ?? row.pickupLat ?? 0);
        const pickLng = Number(row.PickupLng ?? row.pickupLng ?? 0);
        setPickup({ address: pickAddr, lat: pickLat, lng: pickLng });

        const dropAddr = String(row.DropAddress ?? row.DropoffAddress ?? row.dropoffAddress ?? "");
        const dropLat = Number(row.DropLat ?? row.DropoffLat ?? row.dropoffLat ?? 0);
        const dropLng = Number(row.DropLng ?? row.DropoffLng ?? row.dropoffLng ?? 0);
        setDestination({
          placeId: "",
          name: dropAddr.split(",")[0] || dropAddr,
          address: dropAddr,
          location: { latitude: dropLat, longitude: dropLng },
        });

        let parsedStops: StopRow[] = [];
        try {
          const raw = row.nextstopdata || row.Nextstopdata;
          if (typeof raw === "string" && raw.trim()) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) {
              parsedStops = arr.map((s: any, i: number) => ({
                id: String(s.id || `s${i}`),
                address: String(s.address || s.Address || ""),
                lat: Number(s.lat || s.Lat || 0),
                lng: Number(s.lng || s.Lng || 0),
              }));
            }
          } else if (Array.isArray(row.Stops)) {
            parsedStops = row.Stops.map((a: string, i: number) => ({
              id: `s${i}`,
              address: String(a),
              lat: 0,
              lng: 0,
            }));
          }
        } catch {
          /* ignore */
        }
        setStops(parsedStops.filter((s) => s.address));
        setNotes(String(row.Info ?? row.Notes ?? row.notes ?? ""));
        setFare(Number(row.EstimatedFare ?? row.CustomeRate ?? row.Fare ?? 0) || 0);
        setPaymentMethod(String(row.PaymentMethod ?? row.paymentMethod ?? "cash"));
        setVehicleType(String(row.VehicleType ?? row.vehicleType ?? "Sedan"));
      } finally {
        setLoading(false);
      }
    })();
  }, [jobId, companyId, firebaseUser?.uid]);

  const locationBias: PlacesBias | null = useMemo(
    () =>
      pickup
        ? { lat: pickup.lat, lng: pickup.lng, country: "nz", radius: 40000 }
        : null,
    [pickup],
  );

  const recalc = async (dest: PlaceDetail, nextStops: StopRow[]) => {
    if (!pickup) return;
    const route = await getRoute(
      { latitude: pickup.lat, longitude: pickup.lng },
      dest.location,
      nextStops.filter((s) => s.lat && s.lng).map((s) => ({ latitude: s.lat, longitude: s.lng })),
    );
    if (!route) return;
    const calc = calculateFare(
      route.distanceMeters,
      route.durationSeconds,
      vehicleType as any,
      nextStops.length,
    );
    setFare(calc.total);
  };

  const onChangeDestination = async (place: PlaceDetail) => {
    setDestination(place);
    await recalc(place, stops);
  };

  const onAddStop = async (place: PlaceDetail) => {
    const row: StopRow = {
      id: `s${Date.now()}`,
      address: place.address,
      lat: place.location.latitude,
      lng: place.location.longitude,
    };
    const next = [...stops, row];
    setStops(next);
    if (destination) await recalc(destination, next);
  };

  const onRemoveStop = async (id: string) => {
    const next = stops.filter((s) => s.id !== id);
    setStops(next);
    if (destination) await recalc(destination, next);
  };

  const onSave = async () => {
    if (!jobId || !companyId || !destination) return;
    setSaving(true);
    try {
      const stopPayload = stops.map((s) => ({
        id: s.id,
        address: s.address,
        lat: s.lat,
        lng: s.lng,
      }));
      const changeSummary = [
        `Drop-off → ${destination.address}`,
        stops.length ? `Stops → ${stops.map((s) => s.address).join("; ")}` : "Stops cleared",
        notes.trim() ? `Notes → ${notes.trim()}` : null,
        fare > 0 ? `Fare → ${formatCurrency(fare)}` : null,
      ].filter(Boolean) as string[];

      const ok = await editScheduledBooking({
        companyId,
        jobId,
        editFields: {
          DropAddress: destination.address,
          dropoff: destination.address,
          DropoffAddress: destination.address,
          DropLatLng: `${destination.location.latitude},${destination.location.longitude}`,
          dropLatLng: `${destination.location.latitude},${destination.location.longitude}`,
          EstimatedFare: fare,
          CustomeRate: fare,
          RideCost: fare,
          Stops: stops.map((s) => s.address),
          stops: stopPayload,
          Nextstop: String(stops.length),
          nextstopdata: JSON.stringify(stopPayload),
          Notes: notes.trim(),
          notes: notes.trim(),
          Info: notes.trim(),
          PaymentMethod: paymentMethod,
          paymentMethod,
        },
        changeSummary,
      });
      if (ok) {
        notify("Booking updated", "Changes saved — dispatch has the latest details.", "success");
        router.replace("/(tabs)/scheduled");
      }
    } finally {
      setSaving(false);
    }
  };

  const onCancelBooking = () => {
    Alert.alert("Cancel this booking?", "The company will be notified.", [
      { text: "Keep", style: "cancel" },
      {
        text: "Cancel booking",
        style: "destructive",
        onPress: async () => {
          try {
            const cancelledAt = new Date().toISOString();
            await cancelBookingOnServer({
              companyId,
              jobId,
              cancelFields: {
                Status: "Cancelled",
                status: "Cancelled",
                CancelledBy: "passenger",
                cancelledBy: "passenger",
                CancelledAt: cancelledAt,
                cancelledAt,
                CancelReason: "passenger_scheduled_cancel",
              },
              mode: "intentional",
            });
            notify("Booking cancelled", "Your scheduled ride was cancelled.", "info");
            router.replace("/(tabs)/scheduled");
          } catch (e) {
            notify("Cancel failed", (e as Error).message || "Try again.", "error");
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!jobId || !companyId || !pickup || !destination) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 24 }]}>
        <Text style={{ color: colors.foreground, textAlign: "center" }}>
          Booking not found. Go back to Scheduled and try again.
        </Text>
        <Pressable
          onPress={() => router.back()}
          style={[styles.btn, { backgroundColor: colors.primary, marginTop: 16 }]}
        >
          <Text style={styles.btnText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Edit scheduled ride</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120, gap: 14 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={[styles.label, { color: colors.mutedForeground }]}>PICKUP</Text>
        <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium" }}>{pickup.address}</Text>

        <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 8 }]}>DESTINATION</Text>
        <PlacesAutocomplete
          placeholder="Change destination…"
          value=""
          onSelect={(p) => void onChangeDestination(p)}
          icon="navigation"
          iconColor={colors.primary}
          locationBias={locationBias}
          nearPickup={{ latitude: pickup.lat, longitude: pickup.lng }}
          role="destination"
        />
        <Text style={{ color: colors.foreground }}>{destination.address}</Text>

        <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 8 }]}>STOPS</Text>
        {stops.map((s) => (
          <View key={s.id} style={styles.stopRow}>
            <Text style={{ flex: 1, color: colors.foreground }}>{s.address}</Text>
            <Pressable onPress={() => void onRemoveStop(s.id)}>
              <Feather name="x" size={18} color={colors.destructive} />
            </Pressable>
          </View>
        ))}
        <PlacesAutocomplete
          key={`add-stop-${stops.length}`}
          placeholder="Add a stop…"
          value=""
          onSelect={(p) => void onAddStop(p)}
          icon="map-pin"
          iconColor={colors.warning}
          locationBias={locationBias}
          nearPickup={{ latitude: pickup.lat, longitude: pickup.lng }}
          role="stop"
        />

        <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 8 }]}>NOTES</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Driver notes…"
          placeholderTextColor={colors.mutedForeground}
          style={[
            styles.input,
            { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card },
          ]}
          multiline
        />

        <Text style={{ color: colors.mutedForeground }}>
          Payment: {paymentMethod} · Est. fare {formatCurrency(fare)}
        </Text>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12, borderTopColor: colors.border }]}>
        <Pressable
          onPress={onCancelBooking}
          style={[styles.btn, { backgroundColor: colors.destructive + "22", flex: 1 }]}
        >
          <Text style={[styles.btnText, { color: colors.destructive }]}>Cancel booking</Text>
        </Pressable>
        <Pressable
          onPress={() => void onSave()}
          disabled={saving}
          style={[styles.btn, { backgroundColor: colors.primary, flex: 1, opacity: saving ? 0.7 : 1 }]}
        >
          <Text style={styles.btnText}>{saving ? "Saving…" : "Save changes"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.6 },
  stopRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    minHeight: 72,
    textAlignVertical: "top",
    fontFamily: "Inter_400Regular",
  },
  footer: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  btn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 },
});
