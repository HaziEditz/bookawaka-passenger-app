import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

type NotifType = "success" | "info" | "warning" | "error";

interface Notification {
  id: string;
  title: string;
  body?: string;
  type: NotifType;
}

interface NotificationContextType {
  notify: (title: string, body?: string, type?: NotifType) => void;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

const ICONS: Record<NotifType, keyof typeof Feather.glyphMap> = {
  success: "check-circle",
  info: "info",
  warning: "alert-triangle",
  error: "x-circle",
};

const TYPE_COLORS: Record<NotifType, string> = {
  success: "#22c55e",
  info: "#3b82f6",
  warning: "#f59e0b",
  error: "#ef4444",
};

function NotificationItem({ notif, onDismiss }: { notif: Notification; onDismiss: () => void }) {
  const colors = useColors();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-20)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]).start();
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: -20, duration: 250, useNativeDriver: true }),
      ]).start(() => onDismiss());
    }, 3800);
    return () => clearTimeout(timer);
  }, []);

  const accent = TYPE_COLORS[notif.type];

  return (
    <Animated.View style={[styles.banner, { opacity, transform: [{ translateY }], backgroundColor: colors.card, borderColor: colors.border, shadowColor: "#000" }]}>
      <View style={[styles.bannerAccent, { backgroundColor: accent }]} />
      <Feather name={ICONS[notif.type]} size={18} color={accent} />
      <View style={styles.bannerText}>
        <Text style={[styles.bannerTitle, { color: colors.foreground }]}>{notif.title}</Text>
        {notif.body ? <Text style={[styles.bannerBody, { color: colors.mutedForeground }]} numberOfLines={2}>{notif.body}</Text> : null}
      </View>
      <Pressable onPress={onDismiss}>
        <Feather name="x" size={14} color={colors.mutedForeground} />
      </Pressable>
    </Animated.View>
  );
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<Notification[]>([]);

  const notify = useCallback((title: string, body?: string, type: NotifType = "info") => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2);
    setQueue((prev) => [...prev.slice(-2), { id, title, body, type }]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setQueue((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const topOffset = Platform.OS === "web" ? 74 : 54;

  return (
    <NotificationContext.Provider value={{ notify }}>
      {children}
      <View style={[styles.container, { top: topOffset }]} pointerEvents="box-none">
        {queue.map((n) => (
          <NotificationItem key={n.id} notif={n} onDismiss={() => dismiss(n.id)} />
        ))}
      </View>
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotification must be used inside NotificationProvider");
  return ctx;
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 9999,
    gap: 8,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 12,
    paddingRight: 14,
    paddingLeft: 6,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    overflow: "hidden",
  },
  bannerAccent: { width: 4, height: "100%", position: "absolute", left: 0, top: 0, borderTopLeftRadius: 14, borderBottomLeftRadius: 14 },
  bannerText: { flex: 1, gap: 2 },
  bannerTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  bannerBody: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
