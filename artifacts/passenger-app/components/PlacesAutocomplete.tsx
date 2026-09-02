import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { PlaceDetail, PlaceSuggestion, geocodePlace, searchPlaces } from "@/lib/googlePlaces";
import { PlacesBias } from "@/lib/placesBias";
import { checkPlaceGeography } from "@/lib/tripGeoGuard";
import { useColors } from "@/hooks/useColors";

interface Props {
  placeholder: string;
  value: string;
  onSelect: (place: PlaceDetail) => void;
  icon?: keyof typeof Feather.glyphMap;
  iconColor?: string;
  autoFocus?: boolean;
  /** Company-city location bias (lat/lng + country) — scopes suggestions locally. */
  locationBias?: PlacesBias | null;
  /** When set, destination/stop must also be near this pickup. */
  nearPickup?: { latitude: number; longitude: number } | null;
  role?: "pickup" | "destination" | "stop";
}

export function PlacesAutocomplete({
  placeholder,
  value,
  onSelect,
  icon = "map-pin",
  iconColor,
  autoFocus,
  locationBias,
  nearPickup,
  role = "destination",
}: Props) {
  const colors = useColors();
  const [text, setText] = useState(value);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    setText(value);
    if (value && value.length > 24) {
      requestAnimationFrame(() => {
        inputRef.current?.setNativeProps?.({
          selection: { start: 0, end: 0 },
        });
      });
    }
  }, [value]);

  const handleChange = (input: string) => {
    setText(input);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!input || input.length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const results = await searchPlaces(input, locationBias ?? undefined);
      setSuggestions(results);
      setLoading(false);
    }, 250);
  };

  const handleSelect = async (s: PlaceSuggestion) => {
    setText(s.description);
    setSuggestions([]);
    setFocused(false);
    Keyboard.dismiss();
    setLoading(true);
    const detail = await geocodePlace(s.placeId);
    setLoading(false);
    if (!detail) {
      setText(s.description);
      console.warn("[Places] geocodePlace failed for", s.placeId);
      Alert.alert("Address lookup failed", "Could not confirm that place on the map. Try another suggestion.");
      return;
    }

    const geo = checkPlaceGeography({
      location: detail.location,
      address: detail.address,
      bias: locationBias,
      pickup: nearPickup,
      role,
    });
    if (!geo.ok) {
      setText("");
      Alert.alert("Wrong area?", geo.reason);
      return;
    }

    setText(detail.address);
    onSelect(detail);
    // Keep caret at the start so street number stays visible (RN TextInput
    // otherwise scrolls to the end and looks like "suburb only").
    requestAnimationFrame(() => {
      inputRef.current?.setNativeProps?.({
        selection: { start: 0, end: 0 },
      });
    });
    setTimeout(() => {
      inputRef.current?.setNativeProps?.({
        selection: { start: 0, end: 0 },
      });
    }, 50);
  };

  const accentColor = iconColor ?? colors.primary;
  const showDropdown = focused && suggestions.length > 0;

  return (
    <View style={styles.wrapper}>
      <View
        style={[
          styles.inputRow,
          { borderColor: focused ? accentColor : colors.border, backgroundColor: colors.card },
        ]}
      >
        <Feather name={icon} size={16} color={accentColor} style={styles.leadingIcon} />
        <TextInput
          ref={inputRef}
          style={[styles.input, { color: colors.foreground }]}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          value={text}
          onChangeText={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() =>
            setTimeout(() => {
              setFocused(false);
              setSuggestions([]);
            }, 800)
          }
          autoFocus={autoFocus}
          autoCorrect={false}
          autoCapitalize="words"
          returnKeyType="search"
          numberOfLines={1}
          multiline={false}
          ellipsizeMode="tail"
          {...(Platform.OS === "android" ? { includeFontPadding: false, textAlignVertical: "center" as const } : {})}
        />
        {loading && <ActivityIndicator size="small" color={accentColor} />}
        {text.length > 0 && !loading && (
          <Pressable
            hitSlop={8}
            onPress={() => {
              setText("");
              setSuggestions([]);
            }}
          >
            <Feather name="x" size={14} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>

      {/* Inline (not absolute) so parent ScrollView can scroll suggestions above the keyboard */}
      {showDropdown && (
        <View
          style={[
            styles.dropdown,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              shadowColor: colors.foreground,
            },
          ]}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            style={styles.dropdownScroll}
            bounces={false}
          >
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
                  <Text style={[styles.mainText, { color: colors.foreground }]} numberOfLines={1} ellipsizeMode="tail">
                    {item.mainText}
                  </Text>
                  {item.secondaryText ? (
                    <Text
                      style={[styles.secondaryText, { color: colors.mutedForeground }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {item.secondaryText}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { zIndex: 100, width: "100%", alignSelf: "stretch" },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    gap: 10,
    minHeight: 48,
    maxWidth: "100%",
  },
  leadingIcon: { flexShrink: 0 },
  input: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    padding: 0,
    margin: 0,
    // Prevent long addresses from expanding the row off-screen
    ...(Platform.OS === "web" ? ({ overflow: "hidden", textOverflow: "ellipsis" } as object) : null),
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
    maxHeight: 200,
  },
  dropdownScroll: { maxHeight: 200 },
  suggestion: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12 },
  suggestionText: { flex: 1, minWidth: 0 },
  mainText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  secondaryText: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
