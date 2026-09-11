import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

const COUNTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export function PassengerCountSelect({
  value,
  onChange,
  colors,
}: {
  value: number;
  onChange: (n: number) => void;
  colors: {
    foreground: string;
    mutedForeground: string;
    card: string;
    border: string;
    primary: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const label = `${value} ${value === 1 ? "passenger" : "passengers"}`;

  return (
    <>
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          setOpen(true);
        }}
        style={[styles.trigger, { backgroundColor: colors.card, borderColor: colors.border }]}
        accessibilityRole="button"
        accessibilityLabel="Passenger count"
      >
        <Text style={[styles.triggerText, { color: colors.foreground }]}>{label}</Text>
        <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.sheetTitle, { color: colors.mutedForeground }]}>PASSENGERS</Text>
            {COUNTS.map((n) => {
              const selected = n === value;
              return (
                <Pressable
                  key={n}
                  onPress={() => {
                    Haptics.selectionAsync();
                    onChange(n);
                    setOpen(false);
                  }}
                  style={[
                    styles.option,
                    { borderColor: colors.border, backgroundColor: selected ? colors.primary + "18" : "transparent" },
                  ]}
                >
                  <Text style={[styles.optionText, { color: selected ? colors.primary : colors.foreground }]}>
                    {n} {n === 1 ? "passenger" : "passengers"}
                    {n >= 5 ? " · van" : ""}
                  </Text>
                  {selected ? <Feather name="check" size={18} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 6,
  },
  triggerText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 24,
  },
  sheet: { borderRadius: 16, borderWidth: 1, padding: 12, maxHeight: "80%" },
  sheetTitle: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.6,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
  },
  optionText: { fontSize: 16, fontFamily: "Inter_500Medium" },
});
