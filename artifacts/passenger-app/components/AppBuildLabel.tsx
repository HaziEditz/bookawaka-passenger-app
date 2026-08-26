import { getAppBuildLabel } from "@/lib/appBuildInfo";
import { useColors } from "@/hooks/useColors";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";

type Props = {
  style?: ViewStyle;
  /** Optional prefix, e.g. "Build" */
  prefix?: string;
};

/** Small non-intrusive build marker (version + git short SHA). */
export function AppBuildLabel({ style, prefix }: Props) {
  const colors = useColors();
  const label = prefix ? `${prefix} ${getAppBuildLabel()}` : getAppBuildLabel();
  return (
    <View style={[styles.wrap, style]} accessibilityLabel={`App build ${getAppBuildLabel()}`}>
      <Text style={[styles.text, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    paddingVertical: 8,
  },
  text: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.2,
  },
});
