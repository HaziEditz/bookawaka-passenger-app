import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
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
import { PhoneInput } from "@/components/PhoneInput";

export default function RegisterScreen() {
  const colors = useColors();
  const { register } = useAuth();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  // phone holds the canonical digits-only string built by PhoneInput (e.g. "6421123567")
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleRegister = async () => {
    setError("");
    if (!name.trim() || !email.trim() || !phone.trim() || !password.trim()) {
      setError("Please fill in name, email, phone, and password.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    try {
      await register(name.trim(), email.trim(), phone.trim(), password);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/(tabs)");
    } catch (e: any) {
      console.error("Register error:", e);
      const code: string = e?.code ?? e?.errorInfo?.code ?? "";
      if (code === "auth/email-already-in-use") {
        setError("This email is already registered. Try logging in instead.");
      } else if (code === "auth/invalid-email") {
        setError("Please enter a valid email address.");
      } else if (code === "auth/weak-password") {
        setError("Password is too weak. Use at least 6 characters.");
      } else if (code === "auth/network-request-failed") {
        setError("Network error. Please check your connection and try again.");
      } else if (code === "auth/operation-not-allowed") {
        setError("Email/password sign-up is disabled in the Firebase project. Contact the app administrator.");
      } else if (code === "auth/too-many-requests") {
        setError("Too many attempts. Please wait a moment and try again.");
      } else if (code === "permission-denied" || e?.message?.includes("Missing or insufficient permissions")) {
        setError("Your account was created but the profile could not be saved. You can still sign in.");
      } else if (e?.message) {
        setError(e.message + (code ? `  [${code}]` : ""));
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const textFields: {
    placeholder: string;
    icon: keyof typeof Feather.glyphMap;
    value: string;
    onChange: (v: string) => void;
    keyboard: "default" | "email-address" | "phone-pad";
    secure?: boolean;
    capitalize?: "none" | "words";
  }[] = [
    { placeholder: "Full name", icon: "user", value: name, onChange: setName, keyboard: "default", capitalize: "words" },
    { placeholder: "Email", icon: "mail", value: email, onChange: setEmail, keyboard: "email-address", capitalize: "none" },
    { placeholder: "Password", icon: "lock", value: password, onChange: setPassword, keyboard: "default", secure: true, capitalize: "none" },
  ];

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

          <Text style={[styles.title, { color: colors.foreground }]}>Create account</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Join to start riding & ordering
          </Text>

          <View style={styles.form}>
            {textFields.slice(0, 2).map((f) => (
              <View
                key={f.placeholder}
                style={[styles.inputBox, { borderColor: colors.border, backgroundColor: colors.card }]}
              >
                <Feather name={f.icon} size={18} color={colors.mutedForeground} />
                <TextInput
                  style={[styles.input, { color: colors.foreground }]}
                  placeholder={f.placeholder}
                  placeholderTextColor={colors.mutedForeground}
                  value={f.value}
                  onChangeText={f.onChange}
                  autoCapitalize={f.capitalize ?? "none"}
                  keyboardType={f.keyboard}
                  secureTextEntry={!!f.secure}
                  autoCorrect={false}
                  spellCheck={false}
                />
              </View>
            ))}
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Phone number</Text>
            <PhoneInput onChangeCanonical={setPhone} />
            {textFields.slice(2).map((f) => (
              <View
                key={f.placeholder}
                style={[styles.inputBox, { borderColor: colors.border, backgroundColor: colors.card }]}
              >
                <Feather name={f.icon} size={18} color={colors.mutedForeground} />
                <TextInput
                  style={[styles.input, { color: colors.foreground }]}
                  placeholder={f.placeholder}
                  placeholderTextColor={colors.mutedForeground}
                  value={f.value}
                  onChangeText={f.onChange}
                  autoCapitalize={f.capitalize ?? "none"}
                  keyboardType={f.keyboard}
                  secureTextEntry={!!f.secure}
                  autoCorrect={false}
                  spellCheck={false}
                />
              </View>
            ))}

            {error ? (
              <View style={[styles.errorBox, { backgroundColor: colors.destructive + "18", borderColor: colors.destructive }]}>
                <Feather name="alert-circle" size={15} color={colors.destructive} />
                <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
              </View>
            ) : null}

            <Pressable
              onPress={handleRegister}
              disabled={loading}
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: colors.primary, opacity: pressed || loading ? 0.7 : 1 },
              ]}
            >
              <Text style={styles.btnText}>{loading ? "Creating account..." : "Create Account"}</Text>
            </Pressable>

            <Pressable onPress={() => router.back()} style={styles.linkRow}>
              <Text style={[styles.linkText, { color: colors.mutedForeground }]}>
                Already have an account?{" "}
                <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold" }}>Sign In</Text>
              </Text>
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
  back: { marginBottom: 24 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", marginBottom: 6 },
  subtitle: { fontSize: 15, fontFamily: "Inter_400Regular", marginBottom: 28 },
  form: { gap: 12 },
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
  fieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: -4 },
  btn: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  linkRow: { alignItems: "center", paddingVertical: 8 },
  linkText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  errorBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1 },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
});
