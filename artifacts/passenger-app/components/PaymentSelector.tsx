import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { PaymentMethod } from "@/context/TripContext";

interface PaymentSelectorProps {
  selected: PaymentMethod;
  onSelect: (method: PaymentMethod) => void;
}

const METHODS: { id: PaymentMethod; label: string; icon: keyof typeof Feather.glyphMap; desc: string }[] = [
  { id: "card", label: "Card", icon: "credit-card", desc: "Visa / Mastercard" },
  { id: "wallet", label: "Wallet", icon: "smartphone", desc: "In-app balance" },
  { id: "account", label: "Account", icon: "briefcase", desc: "Invoice account" },
  { id: "gift_card", label: "Gift Card", icon: "gift", desc: "Redeem gift card" },
];

export function PaymentSelector({ selected, onSelect }: PaymentSelectorProps) {
  const colors = useColors();
  const { user } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>Payment Method</Text>
      <View style={styles.row}>
        {METHODS.map((m) => {
          const isSelected = selected === m.id;
          return (
            <Pressable
              key={m.id}
              onPress={() => {
                Haptics.selectionAsync();
                onSelect(m.id);
              }}
              style={({ pressed }) => [
                styles.option,
                {
                  backgroundColor: isSelected ? colors.primary + "15" : colors.card,
                  borderColor: isSelected ? colors.primary : colors.border,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Feather
                name={m.icon}
                size={18}
                color={isSelected ? colors.primary : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.optionLabel,
                  { color: isSelected ? colors.primary : colors.foreground },
                ]}
              >
                {m.label}
              </Text>
              {m.id === "wallet" && user && (
                <Text style={[styles.balance, { color: colors.mutedForeground }]}>
                  ${user.walletBalance.toFixed(2)}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: {
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 12,
    alignItems: "center",
    gap: 4,
    minWidth: 80,
  },
  optionLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  balance: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
  },
});
