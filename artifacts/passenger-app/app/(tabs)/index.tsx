import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useRide } from "@/context/RideContext";
import { useTripHistory } from "@/context/TripContext";
import { formatCurrency } from "@/lib/fareCalculator";
import { useColors } from "@/hooks/useColors";
import { useSuperBroadcast } from "@/hooks/useSuperBroadcast";
import { useCompanies, isLoadTestCompanyId } from "@/context/CompaniesContext";
import { FALLBACK_TZ } from "@/lib/timezone";

const SERVICE_TILES = [
  { label: "Book a Waka", subtitle: "Taxi", icon: "navigation" as const, color: "#1e40af", route: "/booking" },
  { label: "Food Delivery", icon: "shopping-bag" as const, color: "#f97316", route: "/services/food" },
  { label: "Freight", icon: "package" as const, color: "#7c3aed", route: "/services/freight" },
  { label: "Schedule Ride", icon: "calendar" as const, color: "#0891b2", route: "/(tabs)/scheduled" },
  { label: "Towing", subtitle: "24/7 Roadside", icon: "truck" as const, color: "#b45309", route: "/services/tow" },
  { label: "Rental Cars", subtitle: "Self-drive", icon: "key" as const, color: "#0d9488", route: "/services/rental" },
];

export default function HomeScreen() {
  const colors = useColors();
  const { user, isLoading } = useAuth();
  const { activeRide } = useRide();
  const { history } = useTripHistory();
  const insets = useSafeAreaInsets();
  const broadcasts = useSuperBroadcast();
  const { companies, loading: companiesLoading } = useCompanies();
  const liveCompanies = companies.filter(
    (c) => c.id !== "any" && !isLoadTestCompanyId(c.id) && c.driversAvailable !== false,
  );
  const recent = history.slice(0, 3);
  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPadding + 20, paddingBottom: insets.bottom + 34 + 84 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Greeting */}
      <View style={styles.greetingRow}>
        <View>
          {isLoading ? (
            <>
              <View style={[styles.skeletonLine, { width: 130, backgroundColor: colors.muted }]} />
              <View style={[styles.skeletonLine, { width: 190, marginTop: 6, height: 20, backgroundColor: colors.muted }]} />
            </>
          ) : (
            <>
              <Text style={[styles.greeting, { color: colors.mutedForeground }]}>
                Hello, {user?.name?.split(" ")[0] ?? "Guest"} 👋
              </Text>
              <Text style={[styles.headline, { color: colors.foreground }]}>Where to waka?</Text>
            </>
          )}
        </View>
        <Pressable
          onPress={() => router.push("/(tabs)/profile")}
          style={[styles.avatar, { backgroundColor: isLoading ? colors.muted : colors.primary }]}
        >
          {!isLoading && (
            <Text style={styles.avatarText}>{user?.name?.charAt(0)?.toUpperCase() ?? "?"}</Text>
          )}
        </Pressable>
      </View>

      {/* Critical Broadcast Banners */}
      {broadcasts.map((b) => (
        <View key={b.id} style={styles.broadcastBanner}>
          <View style={styles.broadcastIconWrap}>
            <Feather name="alert-triangle" size={18} color="#fff" />
          </View>
          <View style={styles.broadcastBody}>
            {b.title ? (
              <Text style={styles.broadcastTitle}>{b.title}</Text>
            ) : null}
            <Text style={styles.broadcastMessage}>{b.message}</Text>
          </View>
        </View>
      ))}

      {/* Profile incomplete nudge — shown when signed in but name not yet set */}
      {user && user.name === "Guest" && !isLoading && (
        <Pressable
          onPress={() => router.push("/(tabs)/profile")}
          style={[styles.profileNudge, { backgroundColor: colors.warning + "18", borderColor: colors.warning + "50" }]}
        >
          <Feather name="user" size={15} color={colors.warning} />
          <Text style={[styles.profileNudgeText, { color: colors.warning }]}>
            Set your name so it appears correctly on bookings
          </Text>
          <Feather name="chevron-right" size={15} color={colors.warning} />
        </Pressable>
      )}

      {/* Active Ride Banner */}
      {activeRide && (
        <Pressable
          onPress={() => router.push("/active-ride")}
          style={[styles.activeBanner, { backgroundColor: colors.primary }]}
        >
          <View style={[styles.activeDot, { backgroundColor: "#4ade80" }]} />
          <View style={styles.activeBannerText}>
            <Text style={styles.activeBannerTitle}>Active Ride</Text>
            <Text style={styles.activeBannerSub}>
              {activeRide.pickup.address.split(",")[0]} → {activeRide.destination.address.split(",")[0]}
            </Text>
          </View>
          <Feather name="chevron-right" size={20} color="rgba(255,255,255,0.8)" />
        </Pressable>
      )}

      {/* Quick Book */}
      <Pressable
        onPress={() => router.push("/booking")}
        style={[styles.quickBook, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <View style={styles.quickBookLeft}>
          <Feather name="search" size={18} color={colors.mutedForeground} />
          <Text style={[styles.quickBookText, { color: colors.mutedForeground }]}>Where to?</Text>
        </View>
        <View style={[styles.quickBookBadge, { backgroundColor: colors.primary }]}>
          <Text style={styles.quickBookBadgeText}>Now</Text>
        </View>
      </Pressable>

      {/* Wallet */}
      {user && (
        <View style={[styles.walletCard, { backgroundColor: colors.primary }]}>
          <View>
            <Text style={styles.walletLabel}>Wallet Balance</Text>
            <Text style={styles.walletAmount}>{formatCurrency(user.walletBalance)}</Text>
          </View>
          {/* Top-up hidden until real card/Stripe funding exists — updateWallet alone is fake money. */}
          <View style={[styles.topUpBtn, { backgroundColor: "rgba(255,255,255,0.12)", opacity: 0.85 }]}>
            <Feather name="credit-card" size={16} color="#fff" />
            <Text style={styles.topUpBtnText}>Balance</Text>
          </View>
        </View>
      )}

      {/* Services */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>SERVICES</Text>
        <View style={styles.serviceGrid}>
          {SERVICE_TILES.map((tile) => (
            <Pressable
              key={tile.label}
              onPress={() => router.push(tile.route as any)}
              style={({ pressed }) => [
                styles.serviceTile,
                { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
              ]}
            >
              <View style={[styles.serviceIcon, { backgroundColor: tile.color + "18" }]}>
                <Feather name={tile.icon} size={22} color={tile.color} />
              </View>
              <Text style={[styles.serviceLabel, { color: colors.foreground }]}>{tile.label}</Text>
              {"subtitle" in tile && tile.subtitle ? (
                <Text style={[styles.serviceSubtitle, { color: colors.mutedForeground }]}>{tile.subtitle}</Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      </View>

      {/* Companies */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>TAXI COMPANIES</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {!companiesLoading && liveCompanies.length === 0 ? (
            <View style={[styles.companyCard, { backgroundColor: colors.card, borderColor: colors.border, width: 220, justifyContent: "center", alignItems: "center", paddingVertical: 24, gap: 8 }]}>
              <Feather name="wifi-off" size={22} color={colors.mutedForeground} />
              <Text style={[styles.companyVehicles, { color: colors.mutedForeground, textAlign: "center" }]}>
                No companies online{"\n"}right now
              </Text>
            </View>
          ) : companiesLoading ? (
            <View style={[styles.companyCard, { backgroundColor: colors.card, borderColor: colors.border, width: 200, justifyContent: "center", alignItems: "center", paddingVertical: 20 }]}>
              <Feather name="clock" size={20} color={colors.mutedForeground} />
              <Text style={[styles.companyVehicles, { color: colors.mutedForeground, textAlign: "center", marginTop: 6 }]}>
                Loading…
              </Text>
            </View>
          ) : liveCompanies.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => router.push("/booking")}
              style={[styles.companyCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.companyDotRow}>
                <View style={[styles.companyDot, { backgroundColor: c.color }]} />
                <Text style={[styles.companyAvailBadge, { color: "#16a34a" }]}>Available</Text>
              </View>
              <Text style={[styles.companyName, { color: colors.foreground }]}>{c.name}</Text>
              {c.rating != null && (
                <View style={styles.companyRating}>
                  <Feather name="star" size={11} color={colors.warning} />
                  <Text style={[styles.companyRatingText, { color: colors.mutedForeground }]}>{c.rating}</Text>
                </View>
              )}
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Recent */}
      {recent.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>RECENT TRIPS</Text>
            <Pressable onPress={() => router.push("/(tabs)/history")}>
              <Text style={[styles.seeAll, { color: colors.primary }]}>See all</Text>
            </Pressable>
          </View>
          {recent.map((item) => {
            const icon = item.serviceType === "taxi" ? "navigation" : item.serviceType === "food" ? "shopping-bag" : "package";
            const accent = item.serviceType === "taxi" ? colors.primary : item.serviceType === "food" ? "#f97316" : "#7c3aed";
            const label = item.serviceType === "taxi" ? `${item.from} → ${item.to}` : item.restaurantName ?? item.description ?? "Order";
            return (
              <View key={item.id} style={[styles.recentCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.recentIcon, { backgroundColor: accent + "18" }]}>
                  <Feather name={icon} size={16} color={accent} />
                </View>
                <View style={styles.recentInfo}>
                  <Text style={[styles.recentLabel, { color: colors.foreground }]} numberOfLines={1}>{label}</Text>
                  <Text style={[styles.recentDate, { color: colors.mutedForeground }]}>
                    {new Date(item.date).toLocaleDateString("en-NZ", { timeZone: FALLBACK_TZ, month: "short", day: "numeric" })}
                  </Text>
                </View>
                <Text style={[styles.recentPrice, { color: colors.foreground }]}>{formatCurrency(item.price)}</Text>
              </View>
            );
          })}
        </View>
      )}

      {!user && !isLoading && (
        <View style={[styles.guestBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="lock" size={16} color={colors.primary} />
          <Text style={[styles.guestText, { color: colors.foreground }]}>Sign in to track rides, save addresses & manage payments</Text>
          <Pressable onPress={() => router.push("/auth/login")} style={[styles.guestBtn, { backgroundColor: colors.primary }]}>
            <Text style={styles.guestBtnText}>Sign In</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, gap: 20 },
  greetingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  greeting: { fontSize: 14, fontFamily: "Inter_400Regular" },
  headline: { fontSize: 24, fontFamily: "Inter_700Bold", marginTop: 2 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 18, fontFamily: "Inter_700Bold" },
  profileNudge: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, padding: 12 },
  profileNudgeText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  activeBanner: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, padding: 14 },
  activeDot: { width: 10, height: 10, borderRadius: 5 },
  activeBannerText: { flex: 1 },
  activeBannerTitle: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  activeBannerSub: { color: "rgba(255,255,255,0.75)", fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  quickBook: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 14, borderWidth: 1, padding: 14 },
  quickBookLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  quickBookText: { fontSize: 15, fontFamily: "Inter_400Regular" },
  quickBookBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  quickBookBadgeText: { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  walletCard: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 16, padding: 18 },
  walletLabel: { color: "rgba(255,255,255,0.75)", fontSize: 13, fontFamily: "Inter_400Regular" },
  walletAmount: { color: "#fff", fontSize: 26, fontFamily: "Inter_700Bold", marginTop: 2 },
  topUpBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  topUpBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  section: { gap: 10 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1 },
  seeAll: { fontSize: 13, fontFamily: "Inter_500Medium" },
  serviceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  serviceTile: { width: "47%", borderRadius: 14, borderWidth: 1, padding: 16, gap: 10 },
  serviceIcon: { width: 46, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  serviceLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  serviceSubtitle: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: -4 },
  companyCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginRight: 10, width: 150, gap: 4 },
  companyDotRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  companyDot: { width: 8, height: 8, borderRadius: 4 },
  companyAvailBadge: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  companyName: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  companyRating: { flexDirection: "row", alignItems: "center", gap: 4 },
  companyRatingText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  companyVehicles: { fontSize: 11, fontFamily: "Inter_400Regular" },
  recentCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  recentIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  recentInfo: { flex: 1, gap: 2 },
  recentLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  recentDate: { fontSize: 12, fontFamily: "Inter_400Regular" },
  recentPrice: { fontSize: 14, fontFamily: "Inter_700Bold" },
  guestBanner: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 10, alignItems: "center" },
  guestText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  guestBtn: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 10 },
  guestBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  skeletonLine: { height: 14, borderRadius: 7, opacity: 0.4 },
  broadcastBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: "#dc2626",
    borderRadius: 14,
    padding: 14,
  },
  broadcastIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.18)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  broadcastBody: { flex: 1, gap: 3 },
  broadcastTitle: {
    color: "#fff",
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  broadcastMessage: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
});
