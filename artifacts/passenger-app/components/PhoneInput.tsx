/**
 * PhoneInput — country-code selector (default +64 NZ) + local number field.
 *
 * Returns a canonical digits-only string via onChangeCanonical:
 *   countryCode digits + localNumber digits = e.g. "64276698294"
 *
 * The displayed value is kept human-readable (countryCode picker + local field).
 */
import React, { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

export interface CountryCode {
  code: string;   // e.g. "64"
  flag: string;   // emoji flag
  name: string;   // e.g. "New Zealand"
  label: string;  // e.g. "+64"
}

export const COUNTRY_CODES: CountryCode[] = [
  { code: "64", flag: "🇳🇿", name: "New Zealand", label: "+64" },
  { code: "61", flag: "🇦🇺", name: "Australia",   label: "+61" },
  { code: "1",  flag: "🇺🇸", name: "USA / Canada", label: "+1"  },
  { code: "44", flag: "🇬🇧", name: "United Kingdom", label: "+44" },
  { code: "65", flag: "🇸🇬", name: "Singapore",   label: "+65" },
  { code: "91", flag: "🇮🇳", name: "India",       label: "+91" },
  { code: "86", flag: "🇨🇳", name: "China",       label: "+86" },
  { code: "81", flag: "🇯🇵", name: "Japan",       label: "+81" },
  { code: "82", flag: "🇰🇷", name: "South Korea", label: "+82" },
  { code: "33", flag: "🇫🇷", name: "France",      label: "+33" },
  { code: "49", flag: "🇩🇪", name: "Germany",     label: "+49" },
  { code: "39", flag: "🇮🇹", name: "Italy",       label: "+39" },
  { code: "34", flag: "🇪🇸", name: "Spain",       label: "+34" },
  { code: "7",  flag: "🇷🇺", name: "Russia",      label: "+7"  },
  { code: "55", flag: "🇧🇷", name: "Brazil",      label: "+55" },
  { code: "52", flag: "🇲🇽", name: "Mexico",      label: "+52" },
  { code: "27", flag: "🇿🇦", name: "South Africa", label: "+27" },
  { code: "234",flag: "🇳🇬", name: "Nigeria",     label: "+234" },
  { code: "20", flag: "🇪🇬", name: "Egypt",       label: "+20" },
  { code: "66", flag: "🇹🇭", name: "Thailand",    label: "+66" },
  { code: "62", flag: "🇮🇩", name: "Indonesia",   label: "+62" },
  { code: "63", flag: "🇵🇭", name: "Philippines", label: "+63" },
  { code: "84", flag: "🇻🇳", name: "Vietnam",     label: "+84" },
  { code: "60", flag: "🇲🇾", name: "Malaysia",    label: "+60" },
  { code: "64", flag: "🇳🇿", name: "New Zealand", label: "+64" }, // duplicate removed at runtime
];

// De-dupe by code
export const COUNTRY_CODES_UNIQUE = COUNTRY_CODES.filter(
  (c, i, arr) => arr.findIndex((x) => x.code === c.code) === i,
);

/**
 * Strip a leading zero that NZ/AU users may type after selecting +64/+61.
 * e.g. user selects +64 then types "021..." → strip leading 0 → "21..."
 */
function stripLeadingZero(local: string): string {
  return local.replace(/^0+/, "");
}

/**
 * Build canonical digits: countryCode + local digits (no leading zero).
 * e.g. code="64", local="21 123 4567" → "6421123567"
 */
export function buildCanonical(countryCode: string, localRaw: string): string {
  const localDigits = localRaw.replace(/\D/g, "");
  const stripped = stripLeadingZero(localDigits);
  return stripped ? countryCode + stripped : "";
}

interface Props {
  /** Called on every change with the canonical digits-only string (e.g. "6421123567") */
  onChangeCanonical: (canonical: string) => void;
  /** Initial canonical value to pre-populate (e.g. from saved profile "6421123567") */
  initialCanonical?: string;
  /** Optional placeholder for the local number field */
  placeholder?: string;
  autoFocus?: boolean;
}

export function PhoneInput({ onChangeCanonical, initialCanonical, placeholder, autoFocus }: Props) {
  const colors = useColors();

  // Parse initialCanonical back into code + local
  const parseInitial = (): { country: CountryCode; local: string } => {
    const defaultCountry = COUNTRY_CODES_UNIQUE[0]; // NZ
    if (!initialCanonical) return { country: defaultCountry, local: "" };
    const digits = initialCanonical.replace(/\D/g, "");
    const matched = COUNTRY_CODES_UNIQUE.find((c) => digits.startsWith(c.code));
    if (matched) {
      return { country: matched, local: digits.slice(matched.code.length) };
    }
    return { country: defaultCountry, local: digits };
  };

  const { country: initialCountry, local: initialLocal } = parseInitial();
  const [country, setCountry] = useState<CountryCode>(initialCountry);
  const [local, setLocal] = useState(initialLocal);
  const [pickerVisible, setPickerVisible] = useState(false);

  const handleLocalChange = (text: string) => {
    // Allow digits, spaces, dashes, parens for UX but strip on canonical
    const clean = text.replace(/[^0-9\s\-()]/g, "");
    setLocal(clean);
    onChangeCanonical(buildCanonical(country.code, clean));
  };

  const handleCountrySelect = (c: CountryCode) => {
    setCountry(c);
    setPickerVisible(false);
    onChangeCanonical(buildCanonical(c.code, local));
  };

  return (
    <>
      <View style={[styles.row, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Pressable
          onPress={() => setPickerVisible(true)}
          style={[styles.countryBtn, { borderRightColor: colors.border }]}
        >
          <Text style={[styles.flag]}>{country.flag}</Text>
          <Text style={[styles.codeText, { color: colors.foreground }]}>{country.label}</Text>
          <Feather name="chevron-down" size={14} color={colors.mutedForeground} />
        </Pressable>
        <TextInput
          style={[styles.localInput, { color: colors.foreground }]}
          value={local}
          onChangeText={handleLocalChange}
          keyboardType="phone-pad"
          placeholder={placeholder ?? "21 123 4567"}
          placeholderTextColor={colors.mutedForeground}
          autoCorrect={false}
          autoFocus={autoFocus}
        />
      </View>

      <Modal visible={pickerVisible} transparent animationType="slide" onRequestClose={() => setPickerVisible(false)}>
        <Pressable style={styles.overlay} onPress={() => setPickerVisible(false)} />
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Select country code</Text>
          <ScrollView>
            {COUNTRY_CODES_UNIQUE.map((c) => (
              <Pressable
                key={c.code}
                onPress={() => handleCountrySelect(c)}
                style={({ pressed }) => [
                  styles.countryRow,
                  { borderBottomColor: colors.border, backgroundColor: pressed ? colors.muted : "transparent" },
                  country.code === c.code && { backgroundColor: colors.primary + "22" },
                ]}
              >
                <Text style={styles.flag}>{c.flag}</Text>
                <Text style={[styles.countryName, { color: colors.foreground }]}>{c.name}</Text>
                <Text style={[styles.countryCode, { color: colors.mutedForeground }]}>{c.label}</Text>
                {country.code === c.code && (
                  <Feather name="check" size={16} color={colors.primary} />
                )}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  countryBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 14,
    gap: 4,
    borderRightWidth: 1,
  },
  flag: { fontSize: 20 },
  codeText: { fontSize: 15, fontFamily: "Inter_600SemiBold", minWidth: 36 },
  localInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", paddingHorizontal: 12, paddingVertical: 14 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    maxHeight: "70%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: 16,
  },
  sheetTitle: { fontSize: 16, fontFamily: "Inter_700Bold", textAlign: "center", marginBottom: 8, paddingHorizontal: 16 },
  countryRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  countryName: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  countryCode: { fontSize: 15, fontFamily: "Inter_400Regular" },
});
