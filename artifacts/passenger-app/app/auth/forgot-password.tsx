import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
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
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function ForgotPasswordScreen() {
  const colors = useColors();
  const { resetPassword } = useAuth();
  const insets = useSafeAreaInsets();
  const [identifier, setIdentifier] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");

  const handleReset = async () => {
    setError("");
    setSentTo("");
    if (!identifier.trim()) {
      setError("Enter the email or phone number for your account.");
      return;
    }
    setLoading(true);
    try {
      const email = await resetPassword(identifier.trim());
      setSentTo(email);
    } catch (e: any) {
      const code = e?.code ?? "";
      if (code === "auth/user-not-found" || code === "auth/invalid-credential") {
        setError("No account found with that email or phone. Please register first.");
      } else if (code === "auth/invalid-email") {
        setError(e.message ?? "Please enter a valid email or phone number.");
      } else {
        setError(e.message ?? "Could not send reset email. Try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable onPress={() => router.back()} style={styles.back}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </Pressable>

          <Text style={[styles.title, { color: colors.foreground }]}>Forgot password</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Enter your email or phone number and we will send a reset link to the email on your
            account.
          </Text>

          <View style={styles.form}>
            <View style={[styles.inputBox, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Feather name="user" size={18} color={colors.mutedForeground} />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                placeholder="Email or phone number"
                placeholderTextColor={colors.mutedForeground}
                value={identifier}
                onChangeText={(t) => {
                  setIdentifier(t);
                  setError("");
                  setSentTo("");
                }}
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>

            {error ? (
              <View
                style={[
                  styles.errorBox,
                  { backgroundColor: colors.destructive + "18", borderColor: colors.destructive },
                ]}
              >
                <Feather name="alert-circle" size={15} color={colors.destructive} />
                <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
              </View>
            ) : null}

            {sentTo ? (
              <View
                style={[
                  styles.errorBox,
                  { backgroundColor: colors.success + "18", borderColor: colors.success },
                ]}
              >
                <Feather name="check-circle" size={15} color={colors.success} />
                <Text style={[styles.errorText, { color: colors.success }]}>
                  Password reset email sent to {sentTo}. Check your inbox and spam folder.
                </Text>
              </View>
            ) : null}

            <Pressable
              onPress={handleReset}
              disabled={loading}
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: colors.primary, opacity: pressed || loading ? 0.7 : 1 },
              ]}
            >
              <Text style={styles.btnText}>{loading ? "Sending..." : "Send reset link"}</Text>
            </Pressable>

            <Pressable onPress={() => router.replace("/auth/login")} style={styles.linkRow}>
              <Text style={[styles.linkText, { color: colors.primary }]}>Back to Sign In</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 24 },
  back: { marginBottom: 20, alignSelf: "flex-start" },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", marginBottom: 6 },
  subtitle: { fontSize: 15, fontFamily: "Inter_400Regular", marginBottom: 28, lineHeight: 22 },
  form: { width: "100%", gap: 14 },
  inputBox: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  btn: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  linkRow: { alignItems: "center", paddingVertical: 8 },
  linkText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
});
