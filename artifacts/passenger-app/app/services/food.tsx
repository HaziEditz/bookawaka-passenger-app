import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ref as rtdbRef, set as rtdbSet, onValue as rtdbOnValue } from "firebase/database";
import { rtdb } from "@/lib/firebase";
import { PaymentSelector } from "@/components/PaymentSelector";
import { useAuth } from "@/context/AuthContext";
import { useCompanies } from "@/context/CompaniesContext";
import { useTripHistory } from "@/context/TripContext";
import { PaymentMethod } from "@/context/TripContext";
import { useColors } from "@/hooks/useColors";
import { createJobId } from "@/lib/jobApi";
import { openStripeCheckout } from "@/lib/stripePayment";

const RESTAURANTS = [
  {
    id: "1",
    name: "Burger Palace",
    cuisine: "American",
    eta: "20-30 min",
    rating: 4.7,
    items: [
      { name: "Classic Burger", price: 9.99 },
      { name: "Cheese Burger", price: 11.49 },
      { name: "Fries", price: 3.99 },
    ],
  },
  {
    id: "2",
    name: "Pizza Express",
    cuisine: "Italian",
    eta: "25-35 min",
    rating: 4.5,
    items: [
      { name: "Margherita", price: 12.99 },
      { name: "Pepperoni", price: 14.99 },
      { name: "Garlic Bread", price: 4.49 },
    ],
  },
  {
    id: "3",
    name: "Sushi World",
    cuisine: "Japanese",
    eta: "30-40 min",
    rating: 4.8,
    items: [
      { name: "Salmon Roll", price: 13.99 },
      { name: "Tuna Sashimi", price: 16.99 },
      { name: "Miso Soup", price: 3.49 },
    ],
  },
];

type CartItem = { name: string; price: number; qty: number };

const FOOD_STATUS_CONFIG: Record<string, {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
}> = {
  pending:          { label: "Order received",         icon: "clock",        color: "#6b7280" },
  accepted:         { label: "Restaurant accepted",    icon: "check-circle", color: "#2563eb" },
  preparing:        { label: "Preparing your order",   icon: "activity",     color: "#d97706" },
  out_for_delivery: { label: "Out for delivery",       icon: "truck",        color: "#7c3aed" },
  delivered:        { label: "Delivered!",             icon: "package",      color: "#16a34a" },
};

const STATUS_ORDER = ["pending", "accepted", "preparing", "out_for_delivery", "delivered"];

export default function FoodScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const { companies } = useCompanies();
  const { addToHistory } = useTripHistory();
  const insets = useSafeAreaInsets();

  const [selectedRestaurant, setSelectedRestaurant] = useState<typeof RESTAURANTS[0] | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [address, setAddress] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("card");
  const [ordering, setOrdering] = useState(false);
  const [ordered, setOrdered] = useState(false);
  const [liveStatus, setLiveStatus] = useState("pending");
  const [activeCid, setActiveCid] = useState<string | null>(null);
  const [activeBookingId, setActiveBookingId] = useState<string | null>(null);
  const listenerUnsub = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => { listenerUnsub.current?.(); };
  }, []);

  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);

  const addToCart = (item: { name: string; price: number }) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCart((c) => {
      const existing = c.find((ci) => ci.name === item.name);
      if (existing) return c.map((ci) => ci.name === item.name ? { ...ci, qty: ci.qty + 1 } : ci);
      return [...c, { ...item, qty: 1 }];
    });
  };

  const removeFromCart = (name: string) => {
    Haptics.selectionAsync();
    setCart((c) => {
      const existing = c.find((ci) => ci.name === name);
      if (!existing || existing.qty <= 1) return c.filter((ci) => ci.name !== name);
      return c.map((ci) => ci.name === name ? { ...ci, qty: ci.qty - 1 } : ci);
    });
  };

  const handleOrder = async () => {
    if (!address.trim()) { Alert.alert("Missing Address", "Please enter a delivery address."); return; }
    if (cart.length === 0) { Alert.alert("Empty Cart", "Add items to your cart."); return; }
    if (!user) { router.push("/auth/login"); return; }
    setOrdering(true);

    // Use first real company as the operator for this food order
    const cid = companies.find((c) => c.id !== "any")?.id ?? "demo";
    const restaurantName = selectedRestaurant?.name ?? "Restaurant";
    const itemsSummary = cart.map((i) => `${i.qty}x ${i.name}`).join(", ");

    try {
      // ── Step 1: Get a server-issued job ID ──────────────────────────────
      const jobId = await createJobId({
        companyId: cid,
        passenger: { name: (user as any).name ?? "Guest", phone: (user as any).phone ?? "" },
        pickup:  { address: restaurantName, lat: 0, lng: 0 },
        dropoff: { address: address.trim(), lat: 0, lng: 0 },
        notes: `Food order: ${itemsSummary}`,
      });

      // Belt-and-braces: createJobId always returns a non-empty ID (throws or
      // falls back locally), but guard here so we never write an empty key to RTDB.
      if (!jobId) throw new Error("createJobId returned empty — cannot proceed");

      const jobData = {
        jobId,
        serviceType: "food",
        BookingSource: "PassengerApp",
        Status: "Pending",
        status: "pending",
        restaurantName,
        pickupAddress: restaurantName,
        dropoffAddress: address.trim(),
        deliveryAddress: address.trim(),
        items: cart.map((i) => ({ name: i.name, price: i.price, qty: i.qty })),
        itemsSummary,
        subtotal: total,
        deliveryFee: 2.5,
        total: total + 2.5,
        TotalFare: total + 2.5,
        PaymentMethod: payment,
        paymentMethod: payment,
        PassengerName: (user as any).name ?? "",
        passengerName: (user as any).name ?? "",
        PassengerPhone: (user as any).phone ?? "",
        passengerPhone: (user as any).phone ?? "",
        passengerId: user.id,
        companyId: cid,
        CreatedAt: Date.now(),
        createdAt: Date.now(),
        requestedAt: new Date().toISOString(),
        paymentStatus: "pending" as string,
      };

      // ── Step 2: Stripe checkout for card payments ──────────────────────
      if (payment === "card") {
        try {
          await openStripeCheckout({
            cid,
            bookingId: jobId,
            description: `Food delivery from ${restaurantName}`,
            amount: total + 2.5,
            email: (user as any).email ?? undefined,
          });
          jobData.paymentStatus = "stripe_checkout_opened";
        } catch (stripeErr: any) {
          setOrdering(false);
          Alert.alert(
            "Payment Failed",
            stripeErr?.message ?? "Could not open payment. Please try a different payment method.",
          );
          return;
        }
      }

      // ── Step 3: Write to pendingjobs — dispatcher's Firebase listener fires
      // on this path. _normFbJob() preserves serviceType: 'food' and routes to
      // food-capable drivers automatically. No separate SQL call needed.
      rtdbSet(rtdbRef(rtdb, `pendingjobs/${cid}/${jobId}`), jobData)
        .catch((e) => console.warn("[FoodOrder] pendingjobs write failed:", e));

      // ── Step 3: Write to foodOrders for restaurant-facing live tracking ──
      await rtdbSet(rtdbRef(rtdb, `foodOrders/${cid}/${jobId}`), jobData);

      // Listen to status updates from foodOrders/{cid}/{jobId}/status
      const statusRef = rtdbRef(rtdb, `foodOrders/${cid}/${jobId}/status`);
      const unsub = rtdbOnValue(statusRef, (snap) => {
        if (snap.exists()) {
          const s = snap.val() as string;
          setLiveStatus(s);
        }
      });
      listenerUnsub.current = unsub;

      setActiveCid(cid);
      setActiveBookingId(jobId);
      setLiveStatus("pending");
    } catch (e) {
      // Fall back gracefully — still show the tracking screen
      console.warn("[FoodOrder] Order submission error:", e);
    }

    setOrdering(false);
    setOrdered(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    await addToHistory({
      serviceType: "food",
      status: "en_route",
      restaurantName: selectedRestaurant?.name,
      items: cart.map((i) => `${i.qty}x ${i.name}`).join(", "),
      price: total + 2.5,
      paymentMethod: payment,
      driverName: "Food Runner",
      from: selectedRestaurant?.name,
      to: address,
    });
  };

  const handleCancel = () => {
    listenerUnsub.current?.();
    listenerUnsub.current = null;
    setOrdered(false);
    setCart([]);
    setSelectedRestaurant(null);
    setAddress("");
    setLiveStatus("pending");
    setActiveCid(null);
    setActiveBookingId(null);
  };

  if (ordered) {
    const cfg = FOOD_STATUS_CONFIG[liveStatus] ?? FOOD_STATUS_CONFIG.pending;
    const currentIdx = STATUS_ORDER.indexOf(liveStatus);
    const isDelivered = liveStatus === "delivered";

    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 20 : 0), borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.back()}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Order Tracking</Text>
          <View style={{ width: 22 }} />
        </View>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>

          {/* Booking reference */}
          {activeBookingId && (
            <View style={[styles.refCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.refLabel, { color: colors.mutedForeground }]}>ORDER REF</Text>
              <Text style={[styles.refValue, { color: colors.foreground }]}>{activeBookingId}</Text>
            </View>
          )}

          {/* Live status hero */}
          <View style={[styles.statusHero, { backgroundColor: cfg.color + "12", borderColor: cfg.color + "30" }]}>
            <View style={[styles.statusIconWrap, { backgroundColor: cfg.color + "20" }]}>
              <Feather name={cfg.icon} size={32} color={cfg.color} />
            </View>
            <Text style={[styles.statusLabel, { color: cfg.color }]}>{cfg.label}</Text>
            {!isDelivered && (
              <View style={styles.liveRow}>
                <ActivityIndicator size="small" color={cfg.color} />
                <Text style={[styles.liveText, { color: colors.mutedForeground }]}>Live updates</Text>
              </View>
            )}
          </View>

          {/* Progress timeline */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Progress</Text>
            {STATUS_ORDER.map((s, i) => {
              const done = i < currentIdx || (i === currentIdx && isDelivered);
              const active = i === currentIdx && !isDelivered;
              const scfg = FOOD_STATUS_CONFIG[s];
              return (
                <View key={s} style={styles.timelineRow}>
                  <View style={styles.timelineLeft}>
                    <View style={[styles.timelineDot, {
                      backgroundColor: done ? "#16a34a" : active ? scfg.color : colors.muted,
                      borderColor:     done ? "#16a34a" : active ? scfg.color : colors.border,
                    }]}>
                      {done
                        ? <Feather name="check" size={10} color="#fff" />
                        : active
                          ? <ActivityIndicator size="small" color="#fff" style={{ transform: [{ scale: 0.6 }] }} />
                          : null}
                    </View>
                    {i < STATUS_ORDER.length - 1 && (
                      <View style={[styles.timelineLine, { backgroundColor: done ? "#16a34a" : colors.border }]} />
                    )}
                  </View>
                  <View style={styles.timelineContent}>
                    <Text style={[styles.timelineLabel, {
                      color: done ? "#16a34a" : active ? scfg.color : colors.mutedForeground,
                      fontFamily: active ? "Inter_600SemiBold" : "Inter_400Regular",
                    }]}>
                      {scfg.label}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

          {/* Order summary */}
          <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>ORDER SUMMARY</Text>
            {cart.map((i) => (
              <View key={i.name} style={styles.summaryRow}>
                <Text style={[styles.summaryItem, { color: colors.foreground }]}>{i.qty}x {i.name}</Text>
                <Text style={[styles.summaryPrice, { color: colors.foreground }]}>${(i.price * i.qty).toFixed(2)}</Text>
              </View>
            ))}
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryItem, { color: colors.mutedForeground }]}>Delivery Fee</Text>
              <Text style={[styles.summaryPrice, { color: colors.mutedForeground }]}>$2.50</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={[styles.totalLabel, { color: colors.foreground }]}>Total</Text>
              <Text style={[styles.totalAmount, { color: colors.primary }]}>${(total + 2.5).toFixed(2)}</Text>
            </View>
          </View>

          {isDelivered ? (
            <Pressable onPress={handleCancel} style={[styles.btn, { backgroundColor: colors.primary }]}>
              <Text style={styles.btnText}>Done</Text>
            </Pressable>
          ) : (
            <Pressable onPress={handleCancel} style={[styles.btn, { backgroundColor: colors.destructive }]}>
              <Text style={styles.btnText}>Cancel Order</Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
    );
  }

  if (selectedRestaurant) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 20 : 0), borderBottomColor: colors.border }]}>
          <Pressable onPress={() => setSelectedRestaurant(null)}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>{selectedRestaurant.name}</Text>
          <View style={{ width: 22 }} />
        </View>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>MENU</Text>
            <View style={styles.menuList}>
              {selectedRestaurant.items.map((item) => {
                const cartItem = cart.find((ci) => ci.name === item.name);
                return (
                  <View key={item.name} style={[styles.menuItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.menuItemInfo}>
                      <Text style={[styles.menuItemName, { color: colors.foreground }]}>{item.name}</Text>
                      <Text style={[styles.menuItemPrice, { color: colors.primary }]}>${item.price.toFixed(2)}</Text>
                    </View>
                    <View style={styles.qtyRow}>
                      {cartItem && (
                        <Pressable onPress={() => removeFromCart(item.name)} style={[styles.qtyBtn, { borderColor: colors.border }]}>
                          <Feather name="minus" size={14} color={colors.foreground} />
                        </Pressable>
                      )}
                      {cartItem && (
                        <Text style={[styles.qtyText, { color: colors.foreground }]}>{cartItem.qty}</Text>
                      )}
                      <Pressable onPress={() => addToCart(item)} style={[styles.qtyBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                        <Feather name="plus" size={14} color="#fff" />
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>DELIVERY ADDRESS</Text>
            <View style={[styles.inputBox, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Feather name="map-pin" size={18} color={colors.mutedForeground} />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                placeholder="Enter delivery address"
                placeholderTextColor={colors.mutedForeground}
                value={address}
                onChangeText={setAddress}
              />
            </View>
          </View>

          <View style={styles.section}>
            <PaymentSelector selected={payment} onSelect={setPayment} />
          </View>

          {cart.length > 0 && (
            <View style={[styles.cartSummary, { backgroundColor: colors.accent, borderColor: colors.border }]}>
              <Text style={[styles.cartItems, { color: colors.mutedForeground }]}>
                {cart.reduce((s, i) => s + i.qty, 0)} items
              </Text>
              <Text style={[styles.cartTotal, { color: colors.primary }]}>Total: ${(total + 2.5).toFixed(2)}</Text>
            </View>
          )}

          <Pressable
            onPress={handleOrder}
            disabled={ordering || cart.length === 0}
            style={({ pressed }) => [
              styles.btn,
              {
                backgroundColor: cart.length === 0 ? colors.muted : colors.orange,
                opacity: pressed || ordering ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[styles.btnText, { color: cart.length === 0 ? colors.mutedForeground : "#fff" }]}>
              {ordering ? "Placing Order..." : `Place Order – $${(total + 2.5).toFixed(2)}`}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 20 : 0), borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Food Delivery</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>RESTAURANTS NEAR YOU</Text>
        {RESTAURANTS.map((r) => (
          <Pressable
            key={r.id}
            onPress={() => { Haptics.selectionAsync(); setSelectedRestaurant(r); }}
            style={({ pressed }) => [
              styles.restaurantCard,
              { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <View style={[styles.restaurantIcon, { backgroundColor: colors.orange + "20" }]}>
              <Feather name="shopping-bag" size={24} color={colors.orange} />
            </View>
            <View style={styles.restaurantInfo}>
              <Text style={[styles.restaurantName, { color: colors.foreground }]}>{r.name}</Text>
              <Text style={[styles.restaurantCuisine, { color: colors.mutedForeground }]}>{r.cuisine}</Text>
              <View style={styles.restaurantMeta}>
                <Feather name="clock" size={12} color={colors.mutedForeground} />
                <Text style={[styles.restaurantMetaText, { color: colors.mutedForeground }]}>{r.eta}</Text>
                <Feather name="star" size={12} color={colors.warning} />
                <Text style={[styles.restaurantMetaText, { color: colors.mutedForeground }]}>{r.rating}</Text>
              </View>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    paddingTop: 14,
  },
  headerTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  content: { padding: 20, gap: 16 },
  section: { gap: 10 },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1 },
  refCard: { borderRadius: 12, borderWidth: 1, padding: 12, alignItems: "center" },
  refLabel: { fontSize: 10, fontFamily: "Inter_500Medium", letterSpacing: 0.8, marginBottom: 2 },
  refValue: { fontSize: 13, fontFamily: "Inter_700Bold" },
  statusHero: { borderRadius: 16, borderWidth: 1, padding: 24, alignItems: "center", gap: 10 },
  statusIconWrap: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  statusLabel: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  liveText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 10 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  timelineRow: { flexDirection: "row", gap: 12 },
  timelineLeft: { alignItems: "center", width: 20 },
  timelineDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  timelineLine: { width: 1.5, flex: 1, marginVertical: 3, minHeight: 18 },
  timelineContent: { flex: 1, paddingBottom: 16 },
  timelineLabel: { fontSize: 14, lineHeight: 20 },
  restaurantCard: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: 14, borderWidth: 1 },
  restaurantIcon: { width: 50, height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  restaurantInfo: { flex: 1, gap: 3 },
  restaurantName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  restaurantCuisine: { fontSize: 13, fontFamily: "Inter_400Regular" },
  restaurantMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  restaurantMetaText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  menuList: { gap: 10 },
  menuItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, borderRadius: 12, borderWidth: 1 },
  menuItemInfo: { gap: 3 },
  menuItemName: { fontSize: 14, fontFamily: "Inter_500Medium" },
  menuItemPrice: { fontSize: 14, fontFamily: "Inter_700Bold" },
  qtyRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  qtyBtn: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  qtyText: { fontSize: 14, fontFamily: "Inter_600SemiBold", minWidth: 20, textAlign: "center" },
  inputBox: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, gap: 10 },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  cartSummary: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14, borderRadius: 12, borderWidth: 1 },
  cartItems: { fontSize: 14, fontFamily: "Inter_400Regular" },
  cartTotal: { fontSize: 16, fontFamily: "Inter_700Bold" },
  btn: { borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  btnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
  summaryCard: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 10 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryItem: { fontSize: 14, fontFamily: "Inter_400Regular" },
  summaryPrice: { fontSize: 14, fontFamily: "Inter_500Medium" },
  divider: { height: 1 },
  totalLabel: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  totalAmount: { fontSize: 18, fontFamily: "Inter_700Bold" },
});
