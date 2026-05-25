import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ref as rtdbRef, get as rtdbGet } from "firebase/database";
import { rtdb } from "@/lib/firebase";
import { useColors } from "@/hooks/useColors";
import { TMPassenger } from "@/context/RideContext";

interface TMCardScannerProps {
  visible: boolean;
  onClose: () => void;
  onSave: (passenger: TMPassenger) => void;
  existingCard?: TMPassenger;
  /** Pre-loaded from user profile — triggers the "Saved card — confirm to add" flow. */
  prefillCard?: TMPassenger;
}

type Mode =
  | "capture_guide"    // framing instructions + open-camera button
  | "manual"           // type card details (with optional photo thumbnail)
  | "review"           // viewing an already-added card in edit mode
  | "profile_confirm"; // profile card pre-filled, re-validate & confirm

interface CardRecord {
  active: boolean;
  passengerName: string;
  councilId?: string;
  cardRegion?: string;
  usageLimitMonthly?: number | null;
  usageLimitDaily?: number | null;
  notes?: string;
  updatedAt?: number;
}

export function TMCardScanner({ visible, onClose, onSave, existingCard, prefillCard }: TMCardScannerProps) {
  const colors = useColors();
  const isWeb = Platform.OS === "web";

  const initialMode = (): Mode => {
    if (prefillCard) return "profile_confirm";
    if (existingCard) return "review";
    return "capture_guide";
  };

  const [mode, setMode] = useState<Mode>(initialMode());
  const [capturedPhotoUri, setCapturedPhotoUri] = useState<string | null>(null);
  const [cardCaptureMethod, setCardCaptureMethod] = useState<"camera" | "manual">("manual");
  const [cardNumber, setCardNumber] = useState(existingCard?.cardNumber ?? prefillCard?.cardNumber ?? "");
  const [cardholderName, setCardholderName] = useState(existingCard?.cardholderName ?? prefillCard?.cardholderName ?? "");
  const [expiryDate, setExpiryDate] = useState(existingCard?.expiryDate ?? prefillCard?.expiryDate ?? "");
  const [needsHoist, setNeedsHoist] = useState(existingCard?.needsHoist ?? prefillCard?.needsHoist ?? false);
  const [error, setError] = useState("");
  const [validating, setValidating] = useState(false);
  const [registryRecord, setRegistryRecord] = useState<CardRecord | null>(
    existingCard?.councilId ? { active: true, passengerName: existingCard.cardholderName, councilId: existingCard.councilId } : null
  );
  const [profileAutoValidating, setProfileAutoValidating] = useState(false);

  // Re-initialise all state whenever the modal becomes visible or the card context changes
  useEffect(() => {
    if (!visible) return;
    const m = initialMode();
    setMode(m);
    setCardNumber(existingCard?.cardNumber ?? prefillCard?.cardNumber ?? "");
    setCardholderName(existingCard?.cardholderName ?? prefillCard?.cardholderName ?? "");
    setExpiryDate(existingCard?.expiryDate ?? prefillCard?.expiryDate ?? "");
    setNeedsHoist(existingCard?.needsHoist ?? prefillCard?.needsHoist ?? false);
    setError("");
    setValidating(false);
    setCapturedPhotoUri(null);
    setCardCaptureMethod("manual");
    setRegistryRecord(
      existingCard?.councilId
        ? { active: true, passengerName: existingCard.cardholderName, councilId: existingCard.councilId }
        : null
    );
    setProfileAutoValidating(false);
  }, [visible]);

  // Auto-run registry lookup when profile_confirm mode opens
  useEffect(() => {
    if (!visible || mode !== "profile_confirm" || !prefillCard) return;
    autoValidateProfileCard(prefillCard);
  }, [visible, mode]);

  const autoValidateProfileCard = async (card: TMPassenger) => {
    setProfileAutoValidating(true);
    setError("");
    try {
      const rec = await lookupCard(card.cardNumber);
      setRegistryRecord(rec);
      setCardholderName(rec.passengerName);
      // Check expiry
      const parts = card.expiryDate.split("/");
      const mm = parseInt(parts[0] ?? "0", 10);
      const yy = parseInt(parts[1] ?? "0", 10);
      const expiry = new Date(2000 + yy, mm - 1);
      if (expiry < new Date()) {
        setError("This saved card has expired. Please enter your new card details.");
        setMode("manual");
      }
    } catch (e: any) {
      setError(e.message ?? "Could not verify saved card. Please check the details.");
      setMode("manual");
    } finally {
      setProfileAutoValidating(false);
    }
  };

  const lookupCard = async (num: string): Promise<CardRecord> => {
    const snap = await rtdbGet(rtdbRef(rtdb, `tmCards/${num.trim()}`));
    if (!snap.exists()) {
      throw new Error("Card number not recognised. Please check and try again.");
    }
    const data = snap.val() as CardRecord;
    if (data.active === false) {
      throw new Error("This card has been suspended. Please contact your council.");
    }
    return data;
  };

  const handleCapture = async () => {
    Haptics.selectionAsync();
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: "images",
      quality: 0.8,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      setCapturedPhotoUri(result.assets[0].uri);
      setCardCaptureMethod("camera");
      setMode("manual");
    }
  };

  const handlePickFromLibrary = async () => {
    Haptics.selectionAsync();
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setCapturedPhotoUri(result.assets[0].uri);
      setCardCaptureMethod("camera");
      setMode("manual");
    }
  };

  const handleSave = async () => {
    if (validating) return;
    if (!cardNumber.trim()) { setError("Card number is required"); return; }
    if (!expiryDate.trim()) { setError("Expiry date is required"); return; }
    const expiryRegex = /^(0[1-9]|1[0-2])\/\d{2}$/;
    if (!expiryRegex.test(expiryDate.trim())) { setError("Expiry format must be MM/YY"); return; }
    const parts = expiryDate.split("/");
    const expiry = new Date(2000 + parseInt(parts[1] ?? "0", 10), parseInt(parts[0] ?? "0", 10) - 1);
    if (expiry < new Date()) { setError("This card has expired"); return; }

    let record = registryRecord;
    if (!record) {
      setValidating(true);
      setError("");
      try {
        record = await lookupCard(cardNumber);
        setRegistryRecord(record);
        setCardholderName(record.passengerName);
      } catch (e: any) {
        setError(e.message ?? "Could not verify card. Please try again.");
        setValidating(false);
        return;
      }
      setValidating(false);
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSave({
      id: existingCard?.id ?? prefillCard?.id ?? Date.now().toString(),
      cardNumber: cardNumber.trim(),
      cardholderName: record.passengerName,
      expiryDate: expiryDate.trim(),
      needsHoist,
      councilId: record.councilId,
      cardCaptureMethod,
      cardPhotoUri: capturedPhotoUri ?? undefined,
    });
    reset();
  };

  const reset = () => {
    setMode("capture_guide");
    setCapturedPhotoUri(null);
    setCardCaptureMethod("manual");
    setCardNumber("");
    setCardholderName("");
    setExpiryDate("");
    setNeedsHoist(false);
    setError("");
    setValidating(false);
    setRegistryRecord(null);
    setProfileAutoValidating(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const formatExpiry = (text: string) => {
    const digits = text.replace(/\D/g, "");
    if (digits.length <= 2) return digits;
    return digits.slice(0, 2) + "/" + digits.slice(2, 4);
  };

  const handleCardNumberChange = (text: string) => {
    setCardNumber(text);
    if (registryRecord) setRegistryRecord(null);
    setError("");
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={handleClose} style={styles.closeBtn}>
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>Total Mobility Card</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          {/* ── Profile Confirm ────────────────────────────────────────── */}
          {mode === "profile_confirm" && (
            <View style={styles.section}>
              <View style={[styles.badge, { backgroundColor: colors.primary + "20" }]}>
                <Feather name="user-check" size={16} color={colors.primary} />
                <Text style={[styles.badgeText, { color: colors.primary }]}>Saved card found</Text>
              </View>

              {profileAutoValidating ? (
                <View style={styles.centerRow}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={[styles.hintText, { color: colors.mutedForeground }]}>Checking with council registry…</Text>
                </View>
              ) : error ? (
                <View style={[styles.errorBox, { backgroundColor: colors.destructive + "15", borderColor: colors.destructive + "40" }]}>
                  <Feather name="alert-circle" size={14} color={colors.destructive} />
                  <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
                </View>
              ) : registryRecord ? (
                <View style={[styles.cardPreview, { backgroundColor: colors.card, borderColor: "#16a34a50" }]}>
                  <View style={[styles.verifiedHeader, { backgroundColor: "#16a34a12" }]}>
                    <Feather name="check-circle" size={14} color="#16a34a" />
                    <Text style={[styles.verifiedHeaderText, { color: "#16a34a" }]}>Registry verified</Text>
                  </View>
                  <View style={styles.cardRows}>
                    {[
                      { label: "Name", val: registryRecord.passengerName },
                      { label: "Card Number", val: cardNumber },
                      { label: "Expires", val: expiryDate },
                      { label: "Hoist lift", val: needsHoist ? "Required" : "No" },
                    ].map(({ label, val }) => (
                      <View key={label} style={styles.cardPreviewRow}>
                        <Text style={[styles.cardPreviewLabel, { color: colors.mutedForeground }]}>{label}</Text>
                        <Text style={[styles.cardPreviewValue, { color: label === "Hoist lift" && needsHoist ? colors.primary : colors.foreground }]}>{val}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {!profileAutoValidating && (
                <Pressable
                  onPress={() => {
                    setCardNumber(prefillCard?.cardNumber ?? "");
                    setExpiryDate(prefillCard?.expiryDate ?? "");
                    setNeedsHoist(prefillCard?.needsHoist ?? false);
                    setError("");
                    setRegistryRecord(null);
                    setMode("manual");
                  }}
                  style={[styles.secondaryBtn, { borderColor: colors.border }]}
                >
                  <Feather name="edit-3" size={14} color={colors.mutedForeground} />
                  <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>Use a different card</Text>
                </Pressable>
              )}
            </View>
          )}

          {/* ── Capture Guide ──────────────────────────────────────────── */}
          {mode === "capture_guide" && (
            <View style={styles.section}>
              <View style={[styles.badge, { backgroundColor: colors.primary + "20" }]}>
                <Feather name="camera" size={16} color={colors.primary} />
                <Text style={[styles.badgeText, { color: colors.primary }]}>Capture your TM card</Text>
              </View>
              <Text style={[styles.captureHint, { color: colors.mutedForeground }]}>
                Take a clear photo of the front of your TM card. The photo is stored with your booking for council audit records.
              </Text>

              {/* Card frame illustration */}
              <View style={[styles.cardFrame, { borderColor: colors.primary + "60", backgroundColor: colors.card }]}>
                <Feather name="credit-card" size={52} color={colors.primary + "50"} />
                <Text style={[styles.cardFrameLabel, { color: colors.mutedForeground }]}>
                  Frame your card to fill this area
                </Text>
              </View>

              {!isWeb ? (
                <Pressable onPress={handleCapture} style={[styles.primaryBtn, { backgroundColor: colors.primary }]}>
                  <Feather name="camera" size={18} color="#fff" />
                  <Text style={styles.primaryBtnText}>Open camera</Text>
                </Pressable>
              ) : (
                <Pressable onPress={handlePickFromLibrary} style={[styles.primaryBtn, { backgroundColor: colors.primary }]}>
                  <Feather name="upload" size={18} color="#fff" />
                  <Text style={styles.primaryBtnText}>Upload card photo</Text>
                </Pressable>
              )}

              <Pressable
                onPress={() => { setCardCaptureMethod("manual"); setMode("manual"); }}
                style={[styles.secondaryBtn, { borderColor: colors.border }]}
              >
                <Feather name="edit-3" size={14} color={colors.mutedForeground} />
                <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>Enter card details manually</Text>
              </Pressable>
            </View>
          )}

          {/* ── Manual Entry ───────────────────────────────────────────── */}
          {mode === "manual" && (
            <View style={styles.section}>
              <View style={[styles.badge, { backgroundColor: colors.primary + "20" }]}>
                <Feather name="credit-card" size={16} color={colors.primary} />
                <Text style={[styles.badgeText, { color: colors.primary }]}>
                  {capturedPhotoUri ? "Enter card details" : "TM card details"}
                </Text>
              </View>

              {/* Photo thumbnail if captured */}
              {capturedPhotoUri && (
                <View style={styles.photoRow}>
                  <Image source={{ uri: capturedPhotoUri }} style={styles.photoThumb} resizeMode="cover" />
                  <View style={styles.photoMeta}>
                    <View style={[styles.photoBadge, { backgroundColor: "#16a34a12", borderColor: "#16a34a30" }]}>
                      <Feather name="camera" size={11} color="#16a34a" />
                      <Text style={[styles.photoBadgeText, { color: "#16a34a" }]}>Photo captured</Text>
                    </View>
                    <Text style={[styles.photoHint, { color: colors.mutedForeground }]}>
                      Enter the card number shown in the photo
                    </Text>
                    <Pressable
                      onPress={isWeb ? handlePickFromLibrary : handleCapture}
                      style={[styles.retakeBtn, { borderColor: colors.border }]}
                    >
                      <Feather name="rotate-ccw" size={12} color={colors.mutedForeground} />
                      <Text style={[styles.retakeBtnText, { color: colors.mutedForeground }]}>Retake</Text>
                    </Pressable>
                  </View>
                </View>
              )}

              <View style={[styles.field, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Card Number</Text>
                <TextInput
                  style={[styles.fieldInput, { color: colors.foreground }]}
                  value={cardNumber}
                  onChangeText={handleCardNumberChange}
                  placeholder="e.g. TM-123456"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="characters"
                />
              </View>

              <View style={[styles.field, {
                borderColor: registryRecord ? "#16a34a60" : colors.border,
                backgroundColor: registryRecord ? "#16a34a08" : colors.card,
              }]}>
                <View style={styles.fieldLabelRow}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Cardholder Name</Text>
                  {registryRecord && (
                    <View style={styles.verifiedPill}>
                      <Feather name="check-circle" size={11} color="#16a34a" />
                      <Text style={styles.verifiedPillText}>From registry</Text>
                    </View>
                  )}
                </View>
                <TextInput
                  style={[styles.fieldInput, { color: registryRecord ? "#16a34a" : colors.foreground }]}
                  value={registryRecord ? registryRecord.passengerName : cardholderName}
                  onChangeText={registryRecord ? undefined : setCardholderName}
                  editable={!registryRecord}
                  placeholder={registryRecord ? "" : "Full name on card"}
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="words"
                />
              </View>

              <View style={[styles.field, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Expiry Date</Text>
                <TextInput
                  style={[styles.fieldInput, { color: colors.foreground }]}
                  value={expiryDate}
                  onChangeText={(t) => setExpiryDate(formatExpiry(t))}
                  placeholder="MM/YY"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="numeric"
                  maxLength={5}
                />
              </View>

              <View style={[styles.hoistRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.hoistLeft}>
                  <Feather name="arrow-up" size={18} color={colors.primary} />
                  <View>
                    <Text style={[styles.hoistTitle, { color: colors.foreground }]}>Needs wheelchair hoist lift</Text>
                    <Text style={[styles.hoistSub, { color: colors.mutedForeground }]}>Council covers the hoist fee</Text>
                  </View>
                </View>
                <Pressable
                  onPress={() => { Haptics.selectionAsync(); setNeedsHoist(!needsHoist); }}
                  style={[styles.toggle, { backgroundColor: needsHoist ? colors.primary : colors.muted }]}
                >
                  <View style={[styles.toggleThumb, { transform: [{ translateX: needsHoist ? 18 : 2 }] }]} />
                </Pressable>
              </View>

              {error ? (
                <View style={[styles.errorBox, { backgroundColor: colors.destructive + "15", borderColor: colors.destructive + "40" }]}>
                  <Feather name="alert-circle" size={14} color={colors.destructive} />
                  <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
                </View>
              ) : null}

              {/* Offer camera capture if they skipped the guide step */}
              {!capturedPhotoUri && !isWeb && (
                <Pressable onPress={handleCapture} style={[styles.secondaryBtn, { borderColor: colors.border }]}>
                  <Feather name="camera" size={14} color={colors.mutedForeground} />
                  <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>Take card photo (for council records)</Text>
                </Pressable>
              )}
            </View>
          )}

          {/* ── Review existing card ───────────────────────────────────── */}
          {mode === "review" && existingCard && (
            <View style={styles.section}>
              <View style={[styles.badge, { backgroundColor: "#16a34a20" }]}>
                <Feather name="check-circle" size={16} color="#16a34a" />
                <Text style={[styles.badgeText, { color: "#16a34a" }]}>TM Card verified</Text>
              </View>
              <View style={[styles.cardPreview, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.cardRows}>
                  {[
                    { label: "Card Number", val: existingCard.cardNumber },
                    { label: "Name", val: existingCard.cardholderName },
                    { label: "Expires", val: existingCard.expiryDate },
                    { label: "Hoist needed", val: existingCard.needsHoist ? "Yes" : "No" },
                    ...(existingCard.councilId ? [{ label: "Council ID", val: existingCard.councilId }] : []),
                  ].map(({ label, val }) => (
                    <View key={label} style={styles.cardPreviewRow}>
                      <Text style={[styles.cardPreviewLabel, { color: colors.mutedForeground }]}>{label}</Text>
                      <Text style={[styles.cardPreviewValue, { color: colors.foreground }]}>{val}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <Pressable
                onPress={() => {
                  setCardNumber(existingCard.cardNumber);
                  setCardholderName(existingCard.cardholderName);
                  setExpiryDate(existingCard.expiryDate);
                  setNeedsHoist(existingCard.needsHoist);
                  setRegistryRecord(existingCard.councilId ? { active: true, passengerName: existingCard.cardholderName, councilId: existingCard.councilId } : null);
                  setMode("manual");
                }}
                style={[styles.secondaryBtn, { borderColor: colors.border }]}
              >
                <Feather name="edit-3" size={14} color={colors.mutedForeground} />
                <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>Edit card details</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>

        {/* ── Footer CTAs ────────────────────────────────────────────── */}
        {mode === "manual" && (
          <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
            <Pressable
              onPress={handleSave}
              disabled={validating}
              style={[styles.btn, { backgroundColor: validating ? colors.muted : colors.primary }]}
            >
              {validating ? (
                <>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.btnText}>Verifying card…</Text>
                </>
              ) : (
                <>
                  <Feather name="check" size={18} color="#fff" />
                  <Text style={styles.btnText}>
                    {registryRecord ? "Confirm TM Card" : "Verify & Save Card"}
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        )}
        {mode === "review" && (
          <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
            <Pressable onPress={handleClose} style={[styles.btn, { backgroundColor: colors.primary }]}>
              <Text style={styles.btnText}>Use This Card</Text>
            </Pressable>
          </View>
        )}
        {mode === "profile_confirm" && !profileAutoValidating && registryRecord && !error && (
          <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
            <Pressable onPress={handleSave} style={[styles.btn, { backgroundColor: colors.primary }]}>
              <Feather name="check" size={18} color="#fff" />
              <Text style={styles.btnText}>Confirm — Add to booking</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
  closeBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  scroll: { flex: 1 },
  content: { padding: 20, gap: 16 },
  section: { gap: 14 },
  badge: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10 },
  badgeText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  centerRow: { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "center", paddingVertical: 20 },
  hintText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  captureHint: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  cardFrame: {
    borderWidth: 2,
    borderStyle: "dashed",
    borderRadius: 16,
    height: 200,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  cardFrameLabel: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 15 },
  primaryBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  secondaryBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, alignSelf: "center" },
  secondaryBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  photoRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  photoThumb: { width: 90, height: 60, borderRadius: 8 },
  photoMeta: { flex: 1, gap: 6 },
  photoBadge: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, alignSelf: "flex-start" },
  photoBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  photoHint: { fontSize: 12, fontFamily: "Inter_400Regular" },
  retakeBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, alignSelf: "flex-start" },
  retakeBtnText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  field: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 4 },
  fieldLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  fieldLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5, textTransform: "uppercase" },
  fieldInput: { fontSize: 15, fontFamily: "Inter_400Regular", paddingVertical: 4 },
  verifiedPill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#16a34a15", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  verifiedPillText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#16a34a" },
  hoistRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderRadius: 12, padding: 14 },
  hoistLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  hoistTitle: { fontSize: 14, fontFamily: "Inter_500Medium" },
  hoistSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  toggle: { width: 42, height: 24, borderRadius: 12, justifyContent: "center" },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1 },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  cardPreview: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  verifiedHeader: { flexDirection: "row", alignItems: "center", gap: 6, padding: 10, paddingHorizontal: 14 },
  verifiedHeaderText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  cardRows: { padding: 14, gap: 12 },
  cardPreviewRow: { flexDirection: "row", justifyContent: "space-between" },
  cardPreviewLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  cardPreviewValue: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  footer: { padding: 20, borderTopWidth: 1 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 16 },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
