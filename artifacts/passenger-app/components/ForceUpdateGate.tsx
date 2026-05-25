import Constants from "expo-constants";
import { Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";

interface Props {
  minVersion: string;
}

/** Compares two "major.minor.patch" version strings. Returns true if a < b. */
function isVersionBelow(a: string, b: string): boolean {
  const parse = (v: string) =>
    v
      .split(".")
      .slice(0, 3)
      .map((n) => parseInt(n, 10) || 0);
  const [aMaj, aMin, aPatch] = parse(a);
  const [bMaj, bMin, bPatch] = parse(b);
  if (aMaj !== bMaj) return aMaj < bMaj;
  if (aMin !== bMin) return aMin < bMin;
  return aPatch < bPatch;
}

/** Returns the current app version from Expo config, or "0.0.0" as fallback. */
export function getCurrentVersion(): string {
  return Constants.expoConfig?.version ?? "0.0.0";
}

/** True when the current build is below the platform minimum. */
export function isUpdateRequired(minVersion: string | null): boolean {
  if (!minVersion) return false;
  return isVersionBelow(getCurrentVersion(), minVersion);
}

export default function ForceUpdateGate({ minVersion }: Props) {
  const storeUrl =
    Platform.OS === "ios"
      ? "https://apps.apple.com/app/id0" // replace with real App Store link
      : "https://play.google.com/store/apps/details?id=com.bookawaka.passenger"; // replace with real Play Store link

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.icon}>🚕</Text>
        <Text style={styles.title}>Update Required</Text>
        <Text style={styles.body}>
          A newer version of the app is required to continue. Please update to
          version {minVersion} or later.
        </Text>
        <Text style={styles.current}>
          Your version: {getCurrentVersion()}
        </Text>
        {Platform.OS !== "web" && (
          <TouchableOpacity
            style={styles.button}
            onPress={() => Linking.openURL(storeUrl)}
          >
            <Text style={styles.buttonText}>Update Now</Text>
          </TouchableOpacity>
        )}
        {Platform.OS === "web" && (
          <Text style={styles.hint}>
            Please reload the page or clear your browser cache to get the
            latest version.
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#EBF5FF",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
    maxWidth: 360,
    width: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 6,
  },
  icon: { fontSize: 56, marginBottom: 16 },
  title: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#1E3A5F",
    marginBottom: 12,
    textAlign: "center",
  },
  body: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#4B5563",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 8,
  },
  current: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#9CA3AF",
    marginBottom: 24,
  },
  button: {
    backgroundColor: "#2563EB",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  hint: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 20,
  },
});
