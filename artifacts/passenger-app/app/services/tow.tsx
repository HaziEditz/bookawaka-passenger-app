import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
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
import { useColors } from "@/hooks/useColors";
import { PlaceDetail } from "@/lib/googlePlaces";
import {
  getTowConfig,
  submitTowRequest,
  TowConfig,
} from "@/lib/towingApi";

type Step = "location" | "problem" | "confirm";

export default function TowingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, firebaseUser } = useAuth();
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  // Config
  const [config, setConfig] = useState<TowConfig | null>(null);
  const [configError, setConfigError] = useState(false);

  // Step
  const [step, setStep] = useState<Step>("location");

  // Location fields
  const [pickup, setPickup] = useState<PlaceDetail | null>(null);
  const [dropoff, setDropoff] = useState<PlaceDetail | null>(null);
  const [locating, setLocating] = useState(false);

  // Vehicle fields
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");

  // Problem + contact
  const [problem, setProblem] = useState("");
  const [customerName, setCustomerName] = useState(
    user?.name ?? firebaseUser?.displayName ?? ""
  );
  const [customerPhone, setCustomerPhone] = useState(
    user?.phone ?? firebaseUser?.phoneNumber ?? ""
  );

  // Payment
  const [paymentType, setPaymentType] = useState("");

  // Submission
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getTowConfig()
      .then((c) => {
        setConfig(c);
        if (c.paymentTypes?.[0]) setPaymentType(c.paymentTypes[0]);
        if (c.problems?.[0]) setProblem(c.problems[0]);
      })
      .catch(() => setConfigError(true));
  }, []);

  const useGPS = async () => {
    Haptics.selectionAsync();
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Location needed", "Please allow location access to auto-fill your pickup.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const [geo] = await Location.reverseGeocodeAsync(pos.coords);
      const address = [geo.street, geo.name, geo.city].filter(Boolean).join(", ");
      setPickup({
        address,
        location: { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
        placeId: "",
      } as PlaceDetail);
    } catch {
      Alert.alert("Location error", "Couldn't get your location. Please type your address.");
    } finally {
      setLocating(false);
    }
  };

  const nextStep = () => {
    Haptics.selectionAsync();
    if (step === "location") {
      if (!pickup) { Alert.alert("Location required", "Please enter where your vehicle is."); return; }
      if (!vehicleMake.trim()) { Alert.alert("Vehicle required", "Please enter your vehicle make."); return; }
      if (!vehicleModel.trim()) { Alert.alert("Vehicle required", "Please enter your vehicle model."); return; }
      setStep("problem");
    } else if (step === "problem") {
      if (!problem) { Alert.alert("Problem required", "Please select what's wrong with your vehicle."); return; }
      if (!customerName.trim()) { Alert.alert("Name required", "Please enter your name."); return; }
      if (!customerPhone.trim()) { Alert.alert("Phone required", "Please enter your phone number."); return; }
      setStep("confirm");
    }
  };

  const handleSubmit = async () => {
    if (!pickup || !config) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSubmitting(true);
    try {
      const result = await submitTowRequest({
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        pickup: pickup.address,
        dropoff: dropoff?.address ?? "",
        vehicleMake: vehicleMake.trim(),
        vehicleModel: vehicleModel.trim(),
        problem,
        paymentType,
      });
      if (result.ok && result.jobId) {
        router.replace({ pathname: "/services/tow-track", params: { jobId: result.jobId } });
      } else {
        Alert.alert("Error", "Booking failed. Please try again.");
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not submit your request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const STEPS: Step[] = ["location", "problem", "confirm"];
  const stepIdx = STEPS.indexOf(step);

  const calloutFee = config?.calloutFee ?? 0;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => step === "location" ? router.back() : setStep(STEPS[stepIdx - 1])} style={styles.backBtn} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerCenter}>
          <View style={[styles.headerIcon, { backgroundColor: "#b4530920" }]}>
            <Feather name="truck" size={16} color="#b45309" />
          </View>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Towing Request</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      {/* Step indicators */}
      <View style={[styles.stepRow, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        {["Location & Vehicle", "Problem", "Confirm"].map((label, i) => (
          <View key={i} style={styles.stepItem}>
            <View style={[styles.stepDot, {
              backgroundColor: i <= stepIdx ? "#b45309" : colors.muted,
            }]}>
              {i < stepIdx
                ? <Feather name="check" size={10} color="#fff" />
                : <Text style={styles.stepDotText}>{i + 1}</Text>
              }
            </View>
            <Text style={[styles.stepLabel, { color: i <= stepIdx ? "#b45309" : colors.mutedForeground }]} numberOfLines={1}>
              {label}
            </Text>
            {i < 2 && <View style={[styles.stepLine, { backgroundColor: i < stepIdx ? "#b45309" : colors.border }]} />}
          </View>
        ))}
      </View>

      {configError && (
        <View style={[styles.errorBanner, { backgroundColor: colors.destructive + "15", borderColor: colors.destructive + "30" }]}>
          <Feather name="alert-circle" size={14} color={colors.destructive} />
          <Text style={[styles.errorBannerText, { color: colors.destructive }]}>
            Couldn't load config — defaults will be used. You can still submit.
          </Text>
        </View>
      )}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* ── STEP 1: Location & Vehicle ─────────────────────────────────── */}
        {step === "location" && (
          <>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Vehicle Location</Text>

              <Pressable onPress={useGPS} style={[styles.gpsBtn, { borderColor: colors.border, backgroundColor: colors.muted }]} disabled={locating}>
                {locating
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <Feather name="crosshair" size={16} color={colors.primary} />
                }
                <Text style={[styles.gpsBtnText, { color: colors.primary }]}>
                  {locating ? "Getting location…" : "Use my current location"}
                </Text>
              </Pressable>

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Pickup address *</Text>
              <PlacesAutocomplete
                placeholder="Where is your vehicle?"
                value={pickup?.address ?? ""}
                onSelect={setPickup}
                icon="map-pin"
                iconColor="#b45309"
              />

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground, marginTop: 12 }]}>Tow destination (optional)</Text>
              <PlacesAutocomplete
                placeholder="Where should we tow it? (optional)"
                value={dropoff?.address ?? ""}
                onSelect={setDropoff}
                icon="flag"
              />
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Your Vehicle</Text>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Make *</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.muted, borderColor: colors.border, color: colors.foreground }]}
                    placeholder="e.g. Toyota"
                    placeholderTextColor={colors.mutedForeground}
                    value={vehicleMake}
                    onChangeText={setVehicleMake}
                    autoCapitalize="words"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Model *</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.muted, borderColor: colors.border, color: colors.foreground }]}
                    placeholder="e.g. Corolla"
                    placeholderTextColor={colors.mutedForeground}
                    value={vehicleModel}
                    onChangeText={setVehicleModel}
                    autoCapitalize="words"
                  />
                </View>
              </View>
            </View>
          </>
        )}

        {/* ── STEP 2: Problem + Contact ──────────────────────────────────── */}
        {step === "problem" && (
          <>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>What's wrong?</Text>
              {config ? (
                <View style={styles.chipGrid}>
                  {config.problems.map((p) => (
                    <Pressable
                      key={p}
                      onPress={() => { Haptics.selectionAsync(); setProblem(p); }}
                      style={[styles.chip, {
                        backgroundColor: problem === p ? "#b4530920" : colors.muted,
                        borderColor: problem === p ? "#b45309" : colors.border,
                      }]}
                    >
                      <Text style={[styles.chipText, { color: problem === p ? "#b45309" : colors.foreground }]}>{p}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <TextInput
                  style={[styles.input, { backgroundColor: colors.muted, borderColor: colors.border, color: colors.foreground }]}
                  placeholder="Describe the issue (e.g. flat tyre, won't start)"
                  placeholderTextColor={colors.mutedForeground}
                  value={problem}
                  onChangeText={setProblem}
                />
              )}
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Your Contact Details</Text>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Full name *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.muted, borderColor: colors.border, color: colors.foreground }]}
                placeholder="Your name"
                placeholderTextColor={colors.mutedForeground}
                value={customerName}
                onChangeText={setCustomerName}
                autoCapitalize="words"
              />
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground, marginTop: 12 }]}>Phone number *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.muted, borderColor: colors.border, color: colors.foreground }]}
                placeholder="e.g. 027 123 4567"
                placeholderTextColor={colors.mutedForeground}
                value={customerPhone}
                onChangeText={setCustomerPhone}
                keyboardType="phone-pad"
              />
            </View>
          </>
        )}

        {/* ── STEP 3: Payment + Confirm ──────────────────────────────────── */}
        {step === "confirm" && (
          <>
            {/* Summary */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Booking Summary</Text>
              <SummaryRow icon="map-pin" label="From" value={pickup?.address ?? ""} colors={colors} />
              {dropoff && <SummaryRow icon="flag" label="To" value={dropoff.address} colors={colors} />}
              <SummaryRow icon="truck" label="Vehicle" value={`${vehicleMake} ${vehicleModel}`} colors={colors} />
              <SummaryRow icon="alert-circle" label="Problem" value={problem} colors={colors} />
              <SummaryRow icon="user" label="Name" value={customerName} colors={colors} />
              <SummaryRow icon="phone" label="Phone" value={customerPhone} colors={colors} />
            </View>

            {/* Callout fee */}
            {calloutFee > 0 && (
              <View style={[styles.feeCard, { backgroundColor: "#b4530910", borderColor: "#b4530930" }]}>
                <View style={styles.feeRow}>
                  <Text style={[styles.feeLabel, { color: colors.foreground }]}>Callout fee</Text>
                  <Text style={[styles.feeValue, { color: "#b45309" }]}>
                    ${calloutFee.toFixed(2)}
                  </Text>
                </View>
                <Text style={[styles.feeSub, { color: colors.mutedForeground }]}>
                  Payable on arrival — additional towing charges may apply
                </Text>
              </View>
            )}

            {/* Payment type */}
            {config && config.paymentTypes.length > 0 && (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Payment Method</Text>
                <View style={styles.chipGrid}>
                  {config.paymentTypes.map((pt) => (
                    <Pressable
                      key={pt}
                      onPress={() => { Haptics.selectionAsync(); setPaymentType(pt); }}
                      style={[styles.chip, {
                        backgroundColor: paymentType === pt ? "#b4530920" : colors.muted,
                        borderColor: paymentType === pt ? "#b45309" : colors.border,
                      }]}
                    >
                      <Text style={[styles.chipText, { color: paymentType === pt ? "#b45309" : colors.foreground }]}>{pt}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* CTA */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16, backgroundColor: colors.background, borderTopColor: colors.border }]}>
        {step !== "confirm" ? (
          <Pressable onPress={nextStep} style={[styles.ctaBtn, { backgroundColor: "#b45309" }]}>
            <Text style={styles.ctaBtnText}>Continue</Text>
            <Feather name="arrow-right" size={18} color="#fff" />
          </Pressable>
        ) : (
          <Pressable
            onPress={handleSubmit}
            disabled={submitting}
            style={[styles.ctaBtn, { backgroundColor: "#b45309", opacity: submitting ? 0.7 : 1 }]}
          >
            {submitting
              ? <ActivityIndicator color="#fff" />
              : <>
                  <Feather name="send" size={18} color="#fff" />
                  <Text style={styles.ctaBtnText}>Request Tow</Text>
                </>
            }
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function SummaryRow({ icon, label, value, colors }: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  colors: any;
}) {
  return (
    <View style={styles.summaryRow}>
      <Feather name={icon} size={14} color={colors.mutedForeground} style={{ width: 18 }} />
      <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.summaryValue, { color: colors.foreground }]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, gap: 12 },
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  headerIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  stepRow: { flexDirection: "row", paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, alignItems: "center" },
  stepItem: { flex: 1, flexDirection: "row", alignItems: "center", gap: 4 },
  stepDot: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  stepDotText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" },
  stepLabel: { fontSize: 10, fontFamily: "Inter_500Medium", flex: 1 },
  stepLine: { height: 1, width: 12, marginHorizontal: 2 },
  errorBanner: { flexDirection: "row", alignItems: "center", gap: 8, margin: 16, borderRadius: 10, borderWidth: 1, padding: 12 },
  errorBannerText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  scrollContent: { padding: 16, gap: 12 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 10 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  gpsBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, padding: 11 },
  gpsBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 4 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, fontFamily: "Inter_400Regular" },
  row: { flexDirection: "row", gap: 10 },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  summaryRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 4 },
  summaryLabel: { fontSize: 13, fontFamily: "Inter_400Regular", width: 54 },
  summaryValue: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  feeCard: { borderRadius: 14, borderWidth: 1, padding: 16 },
  feeRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  feeLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  feeValue: { fontSize: 20, fontFamily: "Inter_700Bold" },
  feeSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  bottomBar: { padding: 16, borderTopWidth: 1 },
  ctaBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, paddingVertical: 16 },
  ctaBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
