import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { PlaceDetail, PlaceSuggestion, geocodePlace, searchPlaces } from "@/lib/googlePlaces";
import { useColors } from "@/hooks/useColors";

interface Props {
  placeholder: string;
  value: string;
  onSelect: (place: PlaceDetail) => void;
  icon?: keyof typeof Feather.glyphMap;
  iconColor?: string;
  autoFocus?: boolean;
}

export function PlacesAutocomplete({ placeholder, value, onSelect, icon = "map-pin", iconColor, autoFocus }: Props) {
  const colors = useColors();
  const [text, setText] = useState(value);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setText(value);
  }, [value]);

  const handleChange = (input: string) => {
    setText(input);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!input || input.length < 2) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const results = await searchPlaces(input);
      setSuggestions(results);
      setLoading(false);
    }, 250);
  };

  const handleSelect = async (s: PlaceSuggestion) => {
    setText(s.description);
    setSuggestions([]);
    setFocused(false);
    setLoading(true);
    const detail = await geocodePlace(s.placeId);
    setLoading(false);
    if (detail) {
      setText(detail.address);
      onSelect(detail);
    } else {
      // Keep the typed address visible and surface failure — silent null looked like "address doesn't work"
      setText(s.description);
      console.warn("[Places] geocodePlace failed for", s.placeId);
    }
  };

  const accentColor = iconColor ?? colors.primary;
  const showDropdown = focused && suggestions.length > 0;

  return (
    <View style={styles.wrapper}>
      <View style={[styles.inputRow, { borderColor: focused ? accentColor : colors.border, backgroundColor: colors.card }]}>
        <Feather name={icon} size={16} color={accentColor} />
        <TextInput
          style={[styles.input, { color: colors.foreground }]}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          value={text}
          onChangeText={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => { setFocused(false); setSuggestions([]); }, 800)}
          autoFocus={autoFocus}
          autoCorrect={false}
          autoCapitalize="words"
          returnKeyType="search"
          numberOfLines={1}
          multiline={false}
          {...(Platform.OS === "android" ? { includeFontPadding: false } : {})}
        />
        {loading && <ActivityIndicator size="small" color={accentColor} />}
        {text.length > 0 && !loading && (
          <Pressable onPress={() => { setText(""); setSuggestions([]); }}>
            <Feather name="x" size={14} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>

      {/* Suggestions render inline (not absolutely positioned) to avoid overflow clipping */}
      {showDropdown && (
        <View style={[styles.dropdown, { backgroundColor: colors.card, borderColor: colors.border, shadowColor: colors.foreground }]}>
          {suggestions.map((item, index) => (
            <Pressable
              key={item.placeId}
              onPressIn={() => handleSelect(item)}
              style={({ pressed }) => [
                styles.suggestion,
                {
                  borderTopColor: index > 0 ? colors.border : "transparent",
                  borderTopWidth: index > 0 ? 1 : 0,
                  backgroundColor: pressed ? colors.muted : "transparent",
                },
              ]}
            >
              <Feather name="map-pin" size={14} color={colors.mutedForeground} style={{ marginTop: 2 }} />
              <View style={styles.suggestionText}>
                <Text style={[styles.mainText, { color: colors.foreground }]} numberOfLines={1}>
                  {item.mainText}
                </Text>
                {item.secondaryText ? (
                  <Text style={[styles.secondaryText, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {item.secondaryText}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { zIndex: 100, width: "100%" },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
    minHeight: 48,
  },
  input: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    padding: 0,
    margin: 0,
  },
  dropdown: {
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 4,
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 8,
    overflow: "hidden",
    maxHeight: 220,
  },
  suggestion: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12 },
  suggestionText: { flex: 1, minWidth: 0 },
  mainText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  secondaryText: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
