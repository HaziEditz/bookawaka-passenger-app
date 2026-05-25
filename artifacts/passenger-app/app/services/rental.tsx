import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  RentalAddon,
  RentalDetail,
  RentalVehicle,
  addDays,
  bookRental,
  cancelRentalBooking,
  fmtDate,
  getVehicleDetail,
  getRentalCancellationPolicyText,
  searchVehicles,
  toDateStr,
} from "@/lib/rentalApi";

type Step = "search" | "list" | "detail" | "confirm" | "done";

const CATEGORIES = ["Any", "Economy", "SUV", "Van", "Ute", "Luxury", "Electric"];

// Quick pick-up presets (days from today)
const DURATION_PRESETS = [
  { label: "1 day", days: 1 },
  { label: "3 days", days: 3 },
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
];

export default function RentalScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, firebaseUser } = useAuth();
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const today = new Date();
  const [pickupDate, setPickupDate] = useState(toDateStr(today));
  const [returnDate, setReturnDate] = useState(toDateStr(addDays(today, 3)));
  const [category, setCategory] = useState("Any");
  const [step, setStep] = useState<Step>("search");

  const [vehicles, setVehicles] = useState<RentalVehicle[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedVehicle, setSelectedVehicle] = useState<RentalVehicle | null>(null);
  const [detail, setDetail] = useState<RentalDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [selectedInsurance, setSelectedInsurance] = useState<string | null>(null);
  const [selectedAddons, setSelectedAddons] = useState<string[]>([]);

  const [custName, setCustName] = useState(user?.name ?? firebaseUser?.displayName ?? "");
  const [custEmail, setCustEmail] = useState(user?.email ?? firebaseUser?.email ?? "");
  const [custPhone, setCustPhone] = useState(user?.phone ?? firebaseUser?.phoneNumber ?? "");
  const [booking, setBooking] = useState(false);
  const [doneJobId, setDoneJobId] = useState<string | null>(null);
  const [doneData, setDoneData] = useState<any>(null);
  const [cancellingRental, setCancellingRental] = useState(false);

  const handleCancelBooking = () => {
    if (!doneJobId) return;
    const policyText = getRentalCancellationPolicyText(doneData?.cancellationPolicy);
    const companyPhone = doneData?.companyPhone;

    Alert.alert(
      "Cancel Rental Booking?",
      policyText
        ? policyText
        : "Free cancellation 48+ hours before pickup. Inside 48 hours the deposit is released but no refund is guaranteed.",
      [
        { text: "Keep Booking", style: "cancel" },
        {
          text: "Cancel Booking",
          style: "destructive",
          onPress: async () => {
            setCancellingRental(true);
            try {
              await cancelRentalBooking(doneJobId, { customerEmail: custEmail.trim() || undefined });
              Alert.alert(
                "Booking Cancelled",
                "Your booking has been cancelled. Check your email for confirmation.",
                [{ text: "OK", onPress: () => router.replace("/(tabs)") }],
              );
            } catch {
              const msg = companyPhone
                ? `Please call ${companyPhone} to cancel booking ${doneJobId}.`
                : `Please contact the rental company directly to cancel booking ${doneJobId}.`;
              Alert.alert("Contact Company", msg);
            } finally {
              setCancellingRental(false);
            }
          },
        },
      ],
    );
  };

  const handleSearch = async () => {
    if (new Date(returnDate) <= new Date(pickupDate)) {
      Alert.alert("Invalid dates", "Return date must be after pickup date.");
      return;
    }
    Haptics.selectionAsync();
    setSearching(true);
    setSearchError(null);
    try {
      const results = await searchVehicles({
        pickup: pickupDate,
        return: returnDate,
        category: category === "Any" ? undefined : category,
      });
      setVehicles(results);
      setStep("list");
    } catch (e: any) {
      setSearchError(e?.message ?? "Search failed. Please try again.");
    } finally {
      setSearching(false);
    }
  };

  const handleSelectVehicle = async (v: RentalVehicle) => {
    Haptics.selectionAsync();
    setSelectedVehicle(v);
    setSelectedInsurance(null);
    setSelectedAddons([]);
    setStep("detail");
    setDetailLoading(true);
    try {
      const d = await getVehicleDetail({ cid: v.cid, vid: v.id, pickup: pickupDate, return: returnDate });
      setDetail(d);
      if (d.insuranceTiers?.[0]) setSelectedInsurance(d.insuranceTiers[0].id);
    } catch {
      // Fallback: show basic info we already have
      setDetail(v as RentalDetail);
    } finally {
      setDetailLoading(false);
    }
  };

  const toggleAddon = (id: string) => {
    Haptics.selectionAsync();
    setSelectedAddons((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  };

  const handleBook = async () => {
    if (!selectedVehicle || !custName.trim() || !custEmail.trim() || !custPhone.trim()) {
      Alert.alert("Missing details", "Please fill in your name, email, and phone number.");
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setBooking(true);
    try {
      const result = await bookRental({
        cid: selectedVehicle.cid,
        vid: selectedVehicle.id,
        pickupDate,
        returnDate,
        customer: { name: custName.trim(), email: custEmail.trim(), phone: custPhone.trim() },
        insuranceTier: selectedInsurance ?? undefined,
        selectedAddons: selectedAddons.length > 0 ? selectedAddons : undefined,
      });
      if (result.ok) {
        setDoneJobId(result.jobId);
        setDoneData(result);
        setStep("done");
      } else {
        Alert.alert("Booking failed", "Please try again.");
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not complete your booking.");
    } finally {
      setBooking(false);
    }
  };

  // Compute pricing from detail
  const pricingDetail = detail?.pricing;
  const insuranceTier = detail?.insuranceTiers?.find((t) => t.id === selectedInsurance);
  const addonObjects: RentalAddon[] = (detail?.addons ?? []).filter((a) => selectedAddons.includes(a.id));
  const days = pricingDetail?.days ?? Math.max(1, Math.ceil(
    (new Date(returnDate).getTime() - new Date(pickupDate).getTime()) / 86_400_000
  ));
  const baseTotal = pricingDetail?.baseTotal ?? (selectedVehicle?.dailyRate ?? 0) * days;
  const insuranceTotal = insuranceTier ? (insuranceTier.dailyRate ?? 0) * days : 0;
  const addonsTotal = addonObjects.reduce((s, a) => s + (a.dailyRate ? a.dailyRate * days : (a.oneOffRate ?? 0)), 0);
  const grandTotal = pricingDetail?.grandTotal ?? baseTotal + insuranceTotal + addonsTotal;

  const fmt = (n: number) => `$${n.toFixed(2)}`;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => {
            if (step === "search") router.back();
            else if (step === "list") setStep("search");
            else if (step === "detail") setStep("list");
            else if (step === "confirm") setStep("detail");
            else router.replace("/(tabs)");
          }}
          style={styles.backBtn} hitSlop={12}
        >
          <Feather name={step === "done" ? "x" : "arrow-left"} size={22} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerCenter}>
          <View style={[styles.headerIcon, { backgroundColor: "#0d948820" }]}>
            <Feather name="key" size={16} color="#0d9488" />
          </View>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            {step === "search" ? "Rental Cars" :
             step === "list" ? `${vehicles.length} vehicle${vehicles.length !== 1 ? "s" : ""} found` :
             step === "detail" ? (selectedVehicle?.make ?? "Vehicle details") :
             step === "confirm" ? "Confirm booking" : "Booking confirmed!"}
          </Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* ── SEARCH ───────────────────────────────────────────────────── */}
        {step === "search" && (
          <>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>When do you need a car?</Text>

              <View style={styles.dateRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Pickup date</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.muted, borderColor: colors.border, color: colors.foreground }]}
                    value={pickupDate}
                    onChangeText={setPickupDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.mutedForeground}
                  />
                  {pickupDate.length === 10 && (
                    <Text style={[styles.dateFmt, { color: colors.mutedForeground }]}>{fmtDate(pickupDate)}</Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Return date</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.muted, borderColor: colors.border, color: colors.foreground }]}
                    value={returnDate}
                    onChangeText={setReturnDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.mutedForeground}
                  />
                  {returnDate.length === 10 && (
                    <Text style={[styles.dateFmt, { color: colors.mutedForeground }]}>{fmtDate(returnDate)}</Text>
                  )}
                </View>
              </View>

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground, marginTop: 8 }]}>Duration</Text>
              <View style={styles.chipRow}>
                {DURATION_PRESETS.map(({ label, days: d }) => {
                  const ret = toDateStr(addDays(new Date(pickupDate + "T12:00:00"), d));
                  const active = returnDate === ret;
                  return (
                    <Pressable
                      key={label}
                      onPress={() => { Haptics.selectionAsync(); setReturnDate(ret); }}
                      style={[styles.chip, { backgroundColor: active ? "#0d948820" : colors.muted, borderColor: active ? "#0d9488" : colors.border }]}
                    >
                      <Text style={[styles.chipText, { color: active ? "#0d9488" : colors.foreground }]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Vehicle type</Text>
              <View style={styles.chipRow}>
                {CATEGORIES.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => { Haptics.selectionAsync(); setCategory(c); }}
                    style={[styles.chip, { backgroundColor: category === c ? "#0d948820" : colors.muted, borderColor: category === c ? "#0d9488" : colors.border }]}
                  >
                    <Text style={[styles.chipText, { color: category === c ? "#0d9488" : colors.foreground }]}>{c}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {searchError && (
              <View style={[styles.errorBanner, { backgroundColor: colors.destructive + "15", borderColor: colors.destructive + "30" }]}>
                <Feather name="alert-circle" size={14} color={colors.destructive} />
                <Text style={[styles.errorText, { color: colors.destructive }]}>{searchError}</Text>
              </View>
            )}
          </>
        )}

        {/* ── VEHICLE LIST ─────────────────────────────────────────────── */}
        {step === "list" && (
          <>
            <View style={[styles.dateChip, { backgroundColor: "#0d948815", borderColor: "#0d948840" }]}>
              <Feather name="calendar" size={13} color="#0d9488" />
              <Text style={[styles.dateChipText, { color: "#0d9488" }]}>
                {fmtDate(pickupDate)} → {fmtDate(returnDate)} · {days} day{days !== 1 ? "s" : ""}
              </Text>
            </View>
            {vehicles.length === 0 ? (
              <View style={styles.empty}>
                <Feather name="search" size={40} color={colors.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No vehicles found</Text>
                <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Try different dates or a broader category</Text>
                <Pressable onPress={() => setStep("search")} style={[styles.emptyBtn, { backgroundColor: "#0d9488" }]}>
                  <Text style={styles.emptyBtnText}>Adjust search</Text>
                </Pressable>
              </View>
            ) : (
              vehicles.map((v) => (
                <Pressable key={v.id} onPress={() => handleSelectVehicle(v)} style={[styles.vehicleCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {v.imageUrl && <Image source={{ uri: v.imageUrl }} style={styles.vehicleImg} resizeMode="cover" />}
                  <View style={styles.vehicleBody}>
                    <View style={styles.vehicleTopRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.vehicleName, { color: colors.foreground }]}>{v.make} {v.model}{v.year ? ` (${v.year})` : ""}</Text>
                        <Text style={[styles.vehicleSub, { color: colors.mutedForeground }]}>{v.category}{v.transmission ? ` · ${v.transmission}` : ""}{v.seats ? ` · ${v.seats} seats` : ""}</Text>
                      </View>
                      <View style={styles.priceBlock}>
                        <Text style={[styles.priceValue, { color: "#0d9488" }]}>${v.dailyRate.toFixed(0)}</Text>
                        <Text style={[styles.priceLabel, { color: colors.mutedForeground }]}>/day</Text>
                      </View>
                    </View>
                    {v.features && v.features.length > 0 && (
                      <View style={styles.featureRow}>
                        {v.features.slice(0, 3).map((f) => (
                          <View key={f} style={[styles.featurePill, { backgroundColor: colors.muted }]}>
                            <Text style={[styles.featureText, { color: colors.mutedForeground }]}>{f}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                    <View style={styles.vehicleFooter}>
                      <Text style={[styles.totalEst, { color: colors.mutedForeground }]}>Est. {fmt(v.dailyRate * days)} total</Text>
                      {!v.available && (
                        <View style={[styles.unavailableBadge, { backgroundColor: colors.destructive + "20" }]}>
                          <Text style={[styles.unavailableText, { color: colors.destructive }]}>Unavailable</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </Pressable>
              ))
            )}
          </>
        )}

        {/* ── DETAIL ───────────────────────────────────────────────────── */}
        {step === "detail" && (
          <>
            {detailLoading ? (
              <View style={styles.centerSpinner}>
                <ActivityIndicator size="large" color="#0d9488" />
                <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading details…</Text>
              </View>
            ) : (
              <>
                {/* Vehicle hero */}
                {(detail?.imageUrl ?? selectedVehicle?.imageUrl) && (
                  <Image source={{ uri: detail?.imageUrl ?? selectedVehicle?.imageUrl }} style={styles.heroImg} resizeMode="cover" />
                )}
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.vehicleName, { color: colors.foreground, fontSize: 18 }]}>
                    {selectedVehicle?.make} {selectedVehicle?.model}{selectedVehicle?.year ? ` (${selectedVehicle.year})` : ""}
                  </Text>
                  <Text style={[styles.vehicleSub, { color: colors.mutedForeground }]}>
                    {selectedVehicle?.category}{selectedVehicle?.transmission ? ` · ${selectedVehicle.transmission}` : ""}{selectedVehicle?.fuelType ? ` · ${selectedVehicle.fuelType}` : ""}
                  </Text>
                  {detail?.companyName && (
                    <Text style={[styles.vehicleSub, { color: colors.mutedForeground }]}>from {detail.companyName}</Text>
                  )}
                  <View style={[styles.priceHero, { backgroundColor: "#0d948810", borderColor: "#0d948830" }]}>
                    <Text style={[styles.priceHeroValue, { color: "#0d9488" }]}>{fmt(grandTotal)}</Text>
                    <Text style={[styles.priceHeroLabel, { color: colors.mutedForeground }]}>est. total · {days} day{days !== 1 ? "s" : ""}</Text>
                  </View>
                </View>

                {/* Insurance */}
                {detail?.insuranceTiers && detail.insuranceTiers.length > 0 && (
                  <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>Insurance</Text>
                    {detail.insuranceTiers.map((t) => (
                      <Pressable
                        key={t.id}
                        onPress={() => { Haptics.selectionAsync(); setSelectedInsurance(t.id); }}
                        style={[styles.optionRow, {
                          backgroundColor: selectedInsurance === t.id ? "#0d948815" : colors.muted,
                          borderColor: selectedInsurance === t.id ? "#0d9488" : colors.border,
                        }]}
                      >
                        <View style={[styles.radioOuter, { borderColor: selectedInsurance === t.id ? "#0d9488" : colors.border }]}>
                          {selectedInsurance === t.id && <View style={[styles.radioInner, { backgroundColor: "#0d9488" }]} />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.optionLabel, { color: colors.foreground }]}>{t.name}</Text>
                          {t.description && <Text style={[styles.optionSub, { color: colors.mutedForeground }]}>{t.description}</Text>}
                          {t.excess != null && <Text style={[styles.optionSub, { color: colors.mutedForeground }]}>Excess: ${t.excess}</Text>}
                        </View>
                        <Text style={[styles.optionPrice, { color: "#0d9488" }]}>
                          {t.dailyRate > 0 ? `+$${t.dailyRate}/day` : "Included"}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}

                {/* Addons */}
                {detail?.addons && detail.addons.length > 0 && (
                  <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>Add-ons</Text>
                    {detail.addons.map((a) => {
                      const active = selectedAddons.includes(a.id);
                      return (
                        <Pressable
                          key={a.id}
                          onPress={() => toggleAddon(a.id)}
                          style={[styles.optionRow, {
                            backgroundColor: active ? "#0d948815" : colors.muted,
                            borderColor: active ? "#0d9488" : colors.border,
                          }]}
                        >
                          <View style={[styles.checkbox, {
                            backgroundColor: active ? "#0d9488" : "transparent",
                            borderColor: active ? "#0d9488" : colors.border,
                          }]}>
                            {active && <Feather name="check" size={12} color="#fff" />}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.optionLabel, { color: colors.foreground }]}>{a.name}</Text>
                            {a.description && <Text style={[styles.optionSub, { color: colors.mutedForeground }]}>{a.description}</Text>}
                          </View>
                          <Text style={[styles.optionPrice, { color: "#0d9488" }]}>
                            {a.dailyRate ? `+$${a.dailyRate}/day` : a.oneOffRate ? `+$${a.oneOffRate}` : "Free"}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}

                {/* Pricing breakdown */}
                <View style={[styles.card, { backgroundColor: "#0d948808", borderColor: "#0d948830" }]}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>Price breakdown</Text>
                  <PriceRow label={`Base (${days} day${days !== 1 ? "s" : ""})`} value={fmt(baseTotal)} colors={colors} />
                  {insuranceTotal > 0 && <PriceRow label={`Insurance (${insuranceTier?.name})`} value={`+${fmt(insuranceTotal)}`} colors={colors} />}
                  {addonsTotal > 0 && <PriceRow label="Add-ons" value={`+${fmt(addonsTotal)}`} colors={colors} />}
                  {pricingDetail?.depositAmount && <PriceRow label="Security deposit" value={fmt(pricingDetail.depositAmount)} muted colors={colors} />}
                  <View style={[styles.divider, { backgroundColor: "#0d948840" }]} />
                  <View style={styles.priceRowEl}>
                    <Text style={[styles.priceLabelBold, { color: colors.foreground }]}>Total</Text>
                    <Text style={[styles.priceValueBold, { color: "#0d9488" }]}>{fmt(grandTotal)}</Text>
                  </View>
                </View>
              </>
            )}
          </>
        )}

        {/* ── CONFIRM ──────────────────────────────────────────────────── */}
        {step === "confirm" && (
          <>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Your details</Text>
              {[
                { label: "Full name", value: custName, setter: setCustName, type: "default" as const, cap: "words" as const },
                { label: "Email", value: custEmail, setter: setCustEmail, type: "email-address" as const, cap: "none" as const },
                { label: "Phone", value: custPhone, setter: setCustPhone, type: "phone-pad" as const, cap: "none" as const },
              ].map(({ label, value, setter, type, cap }) => (
                <View key={label}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label} *</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.muted, borderColor: colors.border, color: colors.foreground }]}
                    placeholder={label}
                    placeholderTextColor={colors.mutedForeground}
                    value={value}
                    onChangeText={setter}
                    keyboardType={type}
                    autoCapitalize={cap}
                  />
                </View>
              ))}
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Booking summary</Text>
              <SummaryRow icon="key" label="Vehicle" value={`${selectedVehicle?.make} ${selectedVehicle?.model}`} colors={colors} />
              <SummaryRow icon="calendar" label="From" value={fmtDate(pickupDate)} colors={colors} />
              <SummaryRow icon="calendar" label="To" value={fmtDate(returnDate)} colors={colors} />
              {insuranceTier && <SummaryRow icon="shield" label="Insurance" value={insuranceTier.name} colors={colors} />}
              {addonObjects.length > 0 && <SummaryRow icon="plus-circle" label="Add-ons" value={addonObjects.map((a) => a.name).join(", ")} colors={colors} />}
            </View>

            <View style={[styles.card, { backgroundColor: "#0d948808", borderColor: "#0d948830" }]}>
              <View style={styles.priceRowEl}>
                <Text style={[styles.priceLabelBold, { color: colors.foreground }]}>Total</Text>
                <Text style={[styles.priceValueBold, { color: "#0d9488" }]}>{fmt(grandTotal)}</Text>
              </View>
              <Text style={[styles.payNote, { color: colors.mutedForeground }]}>
                Payment and deposit collected by the rental company on pickup.
                A confirmation email will be sent to {custEmail || "your email"}.
              </Text>
            </View>
          </>
        )}

        {/* ── DONE ─────────────────────────────────────────────────────── */}
        {step === "done" && (
          <View style={styles.doneWrap}>
            <View style={[styles.doneIcon, { backgroundColor: "#0d948820" }]}>
              <Feather name="check-circle" size={48} color="#0d9488" />
            </View>
            <Text style={[styles.doneTitle, { color: colors.foreground }]}>Booking confirmed!</Text>
            <Text style={[styles.doneSub, { color: colors.mutedForeground }]}>
              A confirmation email has been sent to {custEmail}.
              Check your inbox for pickup details.
            </Text>
            {doneJobId && (
              <View style={[styles.jobIdCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.jobIdLabel, { color: colors.mutedForeground }]}>BOOKING REFERENCE</Text>
                <Text style={[styles.jobIdValue, { color: colors.foreground }]}>{doneJobId}</Text>
              </View>
            )}
            {doneData?.companyName && (
              <Text style={[styles.doneSub, { color: colors.mutedForeground }]}>
                Rental company: {doneData.companyName}
              </Text>
            )}
            {doneData?.companyPhone && (
              <Pressable
                onPress={() => Linking.openURL(`tel:${doneData.companyPhone}`)}
                style={[styles.callOperatorBtn]}
              >
                <Feather name="phone" size={15} color="#0d9488" />
                <Text style={styles.callOperatorText}>Call operator: {doneData.companyPhone}</Text>
              </Pressable>
            )}
            <Pressable onPress={() => router.replace("/(tabs)")} style={[styles.homeBtn, { backgroundColor: "#0d9488" }]}>
              <Text style={styles.homeBtnText}>Back to Home</Text>
            </Pressable>
            {/* Only show cancel when the server explicitly allows it (canCancel === true),
                or when canCancel is absent (old API) — never show if explicitly false */}
            {doneJobId && doneData?.canCancel !== false && (
              <Pressable
                onPress={handleCancelBooking}
                disabled={cancellingRental}
                style={({ pressed }) => [
                  styles.cancelBookingBtn,
                  { borderColor: "#fca5a5", opacity: pressed || cancellingRental ? 0.6 : 1 },
                ]}
              >
                {cancellingRental ? (
                  <ActivityIndicator size="small" color="#dc2626" />
                ) : (
                  <>
                    <Feather name="x" size={14} color="#dc2626" />
                    <Text style={styles.cancelBookingText}>Cancel Booking</Text>
                  </>
                )}
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>

      {/* CTA */}
      {step !== "done" && (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16, backgroundColor: colors.background, borderTopColor: colors.border }]}>
          {step === "search" && (
            <Pressable onPress={handleSearch} disabled={searching} style={[styles.ctaBtn, { backgroundColor: "#0d9488", opacity: searching ? 0.7 : 1 }]}>
              {searching ? <ActivityIndicator color="#fff" /> : <>
                <Feather name="search" size={18} color="#fff" />
                <Text style={styles.ctaBtnText}>Search vehicles</Text>
              </>}
            </Pressable>
          )}
          {step === "list" && (
            <Pressable onPress={() => setStep("search")} style={[styles.ctaBtn, { backgroundColor: colors.muted }]}>
              <Feather name="sliders" size={18} color={colors.foreground} />
              <Text style={[styles.ctaBtnText, { color: colors.foreground }]}>Adjust search</Text>
            </Pressable>
          )}
          {step === "detail" && !detailLoading && (
            <Pressable onPress={() => setStep("confirm")} style={[styles.ctaBtn, { backgroundColor: "#0d9488" }]}>
              <Text style={styles.ctaBtnText}>Continue to booking</Text>
              <Feather name="arrow-right" size={18} color="#fff" />
            </Pressable>
          )}
          {step === "confirm" && (
            <Pressable onPress={handleBook} disabled={booking} style={[styles.ctaBtn, { backgroundColor: "#0d9488", opacity: booking ? 0.7 : 1 }]}>
              {booking ? <ActivityIndicator color="#fff" /> : <>
                <Feather name="check" size={18} color="#fff" />
                <Text style={styles.ctaBtnText}>Confirm booking</Text>
              </>}
            </Pressable>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function PriceRow({ label, value, muted, colors }: { label: string; value: string; muted?: boolean; colors: any }) {
  return (
    <View style={styles.priceRowEl}>
      <Text style={[styles.priceRowLabel, { color: muted ? colors.mutedForeground : colors.foreground }]}>{label}</Text>
      <Text style={[styles.priceRowValue, { color: muted ? colors.mutedForeground : colors.foreground }]}>{value}</Text>
    </View>
  );
}

function SummaryRow({ icon, label, value, colors }: { icon: keyof typeof Feather.glyphMap; label: string; value: string; colors: any }) {
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
  scrollContent: { padding: 16, gap: 12 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 10 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  dateRow: { flexDirection: "row", gap: 12 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 4 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, fontFamily: "Inter_400Regular" },
  dateFmt: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 3 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  errorBanner: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, padding: 12 },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  dateChip: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, padding: 10, alignSelf: "flex-start" },
  dateChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  empty: { alignItems: "center", justifyContent: "center", gap: 12, padding: 40 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  emptyBtn: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  emptyBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  vehicleCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  vehicleImg: { width: "100%", height: 160 },
  vehicleBody: { padding: 14, gap: 8 },
  vehicleTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  vehicleName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  vehicleSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  priceBlock: { alignItems: "flex-end" },
  priceValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  priceLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  featureRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  featurePill: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  featureText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  vehicleFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalEst: { fontSize: 12, fontFamily: "Inter_400Regular" },
  unavailableBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  unavailableText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  centerSpinner: { alignItems: "center", justifyContent: "center", gap: 12, padding: 40 },
  loadingText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  heroImg: { width: "100%", height: 200, borderRadius: 14, overflow: "hidden" },
  priceHero: { borderRadius: 12, borderWidth: 1, padding: 16, alignItems: "center", marginTop: 4 },
  priceHeroValue: { fontSize: 28, fontFamily: "Inter_700Bold" },
  priceHeroLabel: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  optionRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, borderWidth: 1, padding: 12 },
  radioOuter: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioInner: { width: 10, height: 10, borderRadius: 5 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  optionLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  optionSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  optionPrice: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  priceRowEl: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  priceRowLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },
  priceRowValue: { fontSize: 14, fontFamily: "Inter_500Medium" },
  priceLabelBold: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  priceValueBold: { fontSize: 20, fontFamily: "Inter_700Bold" },
  divider: { height: 1, marginVertical: 4 },
  summaryRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 3 },
  summaryLabel: { fontSize: 13, fontFamily: "Inter_400Regular", width: 70 },
  summaryValue: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  payNote: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: 4 },
  doneWrap: { alignItems: "center", gap: 16, paddingTop: 40 },
  doneIcon: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center" },
  doneTitle: { fontSize: 24, fontFamily: "Inter_700Bold" },
  doneSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  jobIdCard: { borderRadius: 12, borderWidth: 1, padding: 14, alignItems: "center", width: "100%" },
  jobIdLabel: { fontSize: 11, fontFamily: "Inter_500Medium", letterSpacing: 0.8, marginBottom: 4 },
  jobIdValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  homeBtn: { borderRadius: 14, paddingVertical: 16, paddingHorizontal: 32, alignItems: "center" },
  homeBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
  cancelBookingBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 13,
    paddingHorizontal: 32,
    backgroundColor: "#fee2e2",
    marginTop: 4,
  },
  cancelBookingText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#dc2626" },
  callOperatorBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#0d948830",
    backgroundColor: "#0d948815",
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  callOperatorText: { fontSize: 14, fontFamily: "Inter_500Medium", color: "#0d9488" },
  bottomBar: { padding: 16, borderTopWidth: 1 },
  ctaBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, paddingVertical: 16 },
  ctaBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
