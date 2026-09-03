import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { PhoneInput } from "@/components/PhoneInput";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppBuildLabel } from "@/components/AppBuildLabel";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

const ADDR_KEY = "@saved_addresses";
const FAV_KEY = "@fav_drivers";

interface SavedAddress {
  id: string;
  label: string;
  address: string;
  icon: "home" | "briefcase" | "map-pin";
}

interface FavDriver {
  name: string;
  cab: string;
  plate: string;
  rating: number;
}

const PRESET_LABELS = [
  { label: "Home", icon: "home" as const },
  { label: "Work", icon: "briefcase" as const },
  { label: "Other", icon: "map-pin" as const },
];

export default function ProfileScreen() {
  const colors = useColors();
  const { user, isLoading, logout, updateUserProfile } = useAuth();
  const insets = useSafeAreaInsets();

  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [favDrivers, setFavDrivers] = useState<FavDriver[]>([]);
  const [addAddrModal, setAddAddrModal] = useState(false);
  const [addAddrError, setAddAddrError] = useState("");
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
  const [newAddrLabel, setNewAddrLabel] = useState("Home");
  const [newAddrText, setNewAddrText] = useState("");
  const [newAddrIcon, setNewAddrIcon] = useState<"home" | "briefcase" | "map-pin">("home");

  const [editProfileModal, setEditProfileModal] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [signOutModal, setSignOutModal] = useState(false);

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

  useEffect(() => {
    AsyncStorage.getItem(ADDR_KEY).then((raw) => {
      if (raw) setAddresses(JSON.parse(raw));
    });
    AsyncStorage.getItem(FAV_KEY).then((raw) => {
      if (raw) setFavDrivers(JSON.parse(raw));
    });
  }, []);

  const saveAddresses = async (list: SavedAddress[]) => {
    setAddresses(list);
    await AsyncStorage.setItem(ADDR_KEY, JSON.stringify(list));
  };

  const addAddress = async () => {
    if (!newAddrText.trim()) { setAddAddrError("Please enter an address."); return; }
    setAddAddrError("");
    const entry: SavedAddress = {
      id: Date.now().toString(),
      label: newAddrLabel,
      address: newAddrText.trim(),
      icon: newAddrIcon,
    };
    await saveAddresses([...addresses, entry]);
    setAddAddrModal(false);
    setNewAddrText("");
    setNewAddrLabel("Home");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const removeAddress = (id: string) => {
    setRemoveConfirmId(id);
  };

  const confirmRemoveAddress = async () => {
    if (!removeConfirmId) return;
    await saveAddresses(addresses.filter((a) => a.id !== removeConfirmId));
    setRemoveConfirmId(null);
  };

  const removeFav = async (name: string) => {
    const updated = favDrivers.filter((d) => d.name !== name);
    setFavDrivers(updated);
    await AsyncStorage.setItem(FAV_KEY, JSON.stringify(updated));
  };

  const openEditProfile = () => {
    // Don't pre-fill "Guest" — show an empty field so user types their real name
    const currentName = user?.name ?? "";
    setEditName(currentName === "Guest" ? "" : currentName);
    setEditPhone(user?.phone ?? "");
    setProfileError("");
    setEditProfileModal(true);
  };

  const handleSaveProfile = async () => {
    if (!editName.trim()) { setProfileError("Name cannot be empty"); return; }
    setSavingProfile(true);
    setProfileError("");
    try {
      await updateUserProfile(editName.trim(), editPhone.trim());
      setEditProfileModal(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setProfileError("Failed to save. Please try again.");
    } finally {
      setSavingProfile(false);
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPadding + 16, borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>Profile</Text>
        </View>
        <View style={styles.guestState}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (!user) {
    const perks = [
      { icon: "map-pin" as const, text: "Save your home, work & favourite addresses" },
      { icon: "clock" as const, text: "View your full ride history & receipts" },
      { icon: "credit-card" as const, text: "Manage wallet, cards & payment methods" },
      { icon: "heart" as const, text: "Save favourite drivers for future rides" },
    ];
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPadding + 16, borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>Profile</Text>
        </View>
        <ScrollView contentContainerStyle={styles.guestScroll} showsVerticalScrollIndicator={false}>
          {/* Hero */}
          <View style={[styles.guestHero, { backgroundColor: colors.primary + "12" }]}>
            <View style={[styles.guestAvatarLg, { backgroundColor: colors.primary + "20", borderColor: colors.primary + "30" }]}>
              <Feather name="user" size={52} color={colors.primary} />
            </View>
            <Text style={[styles.guestTitle, { color: colors.foreground }]}>Sign in to your account</Text>
            <Text style={[styles.guestSubtitle, { color: colors.mutedForeground }]}>
              Get the most out of the app — track rides, save places, and pay faster.
            </Text>
          </View>

          {/* Perks */}
          <View style={[styles.perksCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {perks.map((p, i) => (
              <React.Fragment key={p.text}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
                <View style={styles.perkRow}>
                  <View style={[styles.perkIcon, { backgroundColor: colors.primary + "15" }]}>
                    <Feather name={p.icon} size={16} color={colors.primary} />
                  </View>
                  <Text style={[styles.perkText, { color: colors.foreground }]}>{p.text}</Text>
                </View>
              </React.Fragment>
            ))}
          </View>

          {/* Actions */}
          <Pressable
            onPress={() => router.push("/auth/login")}
            style={({ pressed }) => [styles.signInBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
          >
            <Feather name="log-in" size={18} color="#fff" />
            <Text style={styles.signInBtnText}>Sign In</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/auth/register")}
            style={({ pressed }) => [styles.createBtn, { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.8 : 1 }]}
          >
            <Text style={[styles.createBtnText, { color: colors.foreground }]}>Create an Account</Text>
          </Pressable>
          <Text style={[styles.guestDisclaimer, { color: colors.mutedForeground }]}>
            Sign in is required to book rides and manage your account
          </Text>
          <AppBuildLabel style={{ marginTop: 12, marginBottom: 4 }} />
        </ScrollView>
      </View>
    );
  }

  // Wallet top-up via updateWallet alone has no payment backend — do not expose it.

  const handleLogout = async () => {
    await logout();
    router.replace("/(tabs)");
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 16, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Profile</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 34 + 84 }]}>
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          <View style={[styles.bigAvatar, { backgroundColor: colors.primary }]}>
            <Text style={styles.bigAvatarText}>{user.name.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={[styles.userName, { color: colors.foreground }]}>{user.name}</Text>
          <Text style={[styles.userEmail, { color: colors.mutedForeground }]}>{user.email}</Text>
          <Pressable
            onPress={openEditProfile}
            style={({ pressed }) => [styles.editProfileBtn, { backgroundColor: colors.primary + "15", opacity: pressed ? 0.7 : 1 }]}
          >
            <Feather name="edit-2" size={13} color={colors.primary} />
            <Text style={[styles.editProfileBtnText, { color: colors.primary }]}>Edit Profile</Text>
          </Pressable>
        </View>

        {/* Prompt to set name when still showing fallback */}
        {user.name === "Guest" && (
          <Pressable
            onPress={openEditProfile}
            style={({ pressed }) => [styles.namePromptBanner, { backgroundColor: "#f59e0b18", borderColor: "#f59e0b50", opacity: pressed ? 0.75 : 1 }]}
          >
            <Feather name="alert-circle" size={15} color="#d97706" />
            <Text style={styles.namePromptText}>Tap to set your name — drivers will see it when you book.</Text>
            <Feather name="chevron-right" size={15} color="#d97706" />
          </Pressable>
        )}

        {/* Wallet */}
        <View style={[styles.walletCard, { backgroundColor: colors.primary }]}>
          <View>
            <Text style={styles.walletLabel}>Wallet Balance</Text>
            <Text style={styles.walletAmount}>${user.walletBalance.toFixed(2)}</Text>
          </View>
          <View style={[styles.walletIconBox, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
            <Feather name="credit-card" size={22} color="#fff" />
          </View>
        </View>

        {/* Top-up disabled until a real payment flow exists (no Stripe/card charge behind updateWallet). */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>WALLET</Text>
          <View style={[styles.inlineFeedback, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Feather name="info" size={14} color={colors.mutedForeground} />
            <Text style={[styles.inlineFeedbackText, { color: colors.mutedForeground }]}>
              Top-up is temporarily unavailable. Your balance still applies to bookings when you have credit.
            </Text>
          </View>
        </View>

        {/* Saved Addresses */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>SAVED ADDRESSES</Text>
            <Pressable onPress={() => setAddAddrModal(true)} style={[styles.addBtn, { backgroundColor: colors.primary + "15" }]}>
              <Feather name="plus" size={14} color={colors.primary} />
              <Text style={[styles.addBtnText, { color: colors.primary }]}>Add</Text>
            </Pressable>
          </View>
          {addresses.length === 0 ? (
            <Pressable onPress={() => setAddAddrModal(true)} style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border, borderStyle: "dashed" }]}>
              <Feather name="map-pin" size={20} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Add Home, Work or custom addresses</Text>
            </Pressable>
          ) : (
            <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {addresses.map((addr, i) => (
                <React.Fragment key={addr.id}>
                  {i > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
                  <Pressable
                    onPress={() => router.push("/booking")}
                    style={styles.listRow}
                  >
                    <View style={[styles.listIcon, { backgroundColor: colors.primary + "15" }]}>
                      <Feather name={addr.icon} size={16} color={colors.primary} />
                    </View>
                    <View style={styles.listInfo}>
                      <Text style={[styles.listLabel, { color: colors.foreground }]}>{addr.label}</Text>
                      <Text style={[styles.listSub, { color: colors.mutedForeground }]} numberOfLines={1}>{addr.address}</Text>
                    </View>
                    <Pressable onPress={() => removeAddress(addr.id)} hitSlop={10}>
                      <Feather name="trash-2" size={15} color={colors.destructive} />
                    </Pressable>
                  </Pressable>
                </React.Fragment>
              ))}
            </View>
          )}
        </View>

        {/* Favourite Drivers */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>FAVOURITE DRIVERS</Text>
          {favDrivers.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border, borderStyle: "dashed" }]}>
              <Feather name="star" size={20} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Favourite drivers appear here after your rides</Text>
            </View>
          ) : (
            <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {favDrivers.map((d, i) => (
                <React.Fragment key={d.name}>
                  {i > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
                  <View style={styles.listRow}>
                    <View style={[styles.driverAvatar, { backgroundColor: colors.primary }]}>
                      <Feather name="user" size={16} color="#fff" />
                    </View>
                    <View style={styles.listInfo}>
                      <Text style={[styles.listLabel, { color: colors.foreground }]}>{d.name}</Text>
                      <View style={styles.driverMeta}>
                        <Feather name="star" size={11} color={colors.warning} />
                        <Text style={[styles.listSub, { color: colors.mutedForeground }]}>{d.rating} · {d.cab} · {d.plate}</Text>
                      </View>
                    </View>
                    <Pressable onPress={() => removeFav(d.name)} hitSlop={10}>
                      <Feather name="heart" size={16} color={colors.destructive} />
                    </Pressable>
                  </View>
                </React.Fragment>
              ))}
            </View>
          )}
        </View>

        {/* Account Info */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>ACCOUNT INFO</Text>
          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {[
              { icon: "user" as const, label: "Full Name", value: user.name },
              { icon: "mail" as const, label: "Email", value: user.email },
              { icon: "phone" as const, label: "Phone", value: user.phone || "Not set" },
            ].map((row, i) => (
              <React.Fragment key={row.label}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
                <View style={styles.listRow}>
                  <Feather name={row.icon} size={16} color={colors.mutedForeground} />
                  <View style={styles.listInfo}>
                    <Text style={[styles.listSub, { color: colors.mutedForeground }]}>{row.label}</Text>
                    <Text style={[styles.listLabel, { color: colors.foreground }]}>{row.value}</Text>
                  </View>
                </View>
              </React.Fragment>
            ))}
          </View>
        </View>

        {/* Sign Out */}
        <Pressable
          onPress={() => setSignOutModal(true)}
          style={({ pressed }) => [
            styles.signOutBtn,
            { borderColor: colors.destructive + "50", backgroundColor: colors.destructive + "10", opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather name="log-out" size={18} color={colors.destructive} />
          <Text style={[styles.signOutBtnText, { color: colors.destructive }]}>Sign Out</Text>
        </Pressable>
        <AppBuildLabel style={{ marginTop: 16, marginBottom: 8 }} />
      </ScrollView>

      {/* Remove Address Confirmation Modal */}
      <Modal visible={!!removeConfirmId} transparent animationType="fade" onRequestClose={() => setRemoveConfirmId(null)}>
        <View style={styles.signOutOverlay}>
          <View style={[styles.signOutCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.signOutIconBox, { backgroundColor: colors.destructive + "15" }]}>
              <Feather name="trash-2" size={28} color={colors.destructive} />
            </View>
            <Text style={[styles.signOutTitle, { color: colors.foreground }]}>Remove Address?</Text>
            <Text style={[styles.signOutSub, { color: colors.mutedForeground }]}>
              This address will be permanently deleted.
            </Text>
            <View style={styles.signOutActions}>
              <Pressable
                onPress={() => setRemoveConfirmId(null)}
                style={({ pressed }) => [styles.signOutCancel, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={[styles.signOutCancelText, { color: colors.foreground }]}>Keep</Text>
              </Pressable>
              <Pressable
                onPress={confirmRemoveAddress}
                style={({ pressed }) => [styles.signOutConfirm, { backgroundColor: colors.destructive, opacity: pressed ? 0.8 : 1 }]}
              >
                <Text style={styles.signOutConfirmText}>Remove</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Sign Out Confirmation Modal */}
      <Modal visible={signOutModal} transparent animationType="fade" onRequestClose={() => setSignOutModal(false)}>
        <View style={styles.signOutOverlay}>
          <View style={[styles.signOutCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.signOutIconBox, { backgroundColor: colors.destructive + "15" }]}>
              <Feather name="log-out" size={28} color={colors.destructive} />
            </View>
            <Text style={[styles.signOutTitle, { color: colors.foreground }]}>Sign Out?</Text>
            <Text style={[styles.signOutSub, { color: colors.mutedForeground }]}>
              You will be returned to the sign-in screen.
            </Text>
            <View style={styles.signOutActions}>
              <Pressable
                onPress={() => setSignOutModal(false)}
                style={({ pressed }) => [styles.signOutCancel, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={[styles.signOutCancelText, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => { setSignOutModal(false); handleLogout(); }}
                style={({ pressed }) => [styles.signOutConfirm, { backgroundColor: colors.destructive, opacity: pressed ? 0.8 : 1 }]}
              >
                <Text style={styles.signOutConfirmText}>Sign Out</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Profile Modal */}
      <Modal visible={editProfileModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditProfileModal(false)}>
        <View style={[styles.modal, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              {user?.name === "Guest" ? "Set Your Name" : "Edit Profile"}
            </Text>
            <Pressable onPress={() => setEditProfileModal(false)}>
              <Feather name="x" size={22} color={colors.foreground} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>FULL NAME</Text>
            <View style={[styles.addrInput, { borderColor: colors.border, backgroundColor: colors.card, minHeight: 0 }]}>
              <Feather name="user" size={16} color={colors.mutedForeground} />
              <TextInput
                style={[styles.addrTextField, { color: colors.foreground }]}
                placeholder="Your full name"
                placeholderTextColor={colors.mutedForeground}
                value={editName}
                onChangeText={setEditName}
                autoCapitalize="words"
                autoFocus
              />
            </View>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground, marginTop: 16 }]}>PHONE NUMBER</Text>
            <PhoneInput
              onChangeCanonical={setEditPhone}
              initialCanonical={editPhone}
            />
            {profileError ? (
              <View style={[styles.errorBox, { backgroundColor: colors.destructive + "15", borderColor: colors.destructive + "40" }]}>
                <Feather name="alert-circle" size={14} color={colors.destructive} />
                <Text style={[styles.errorText, { color: colors.destructive }]}>{profileError}</Text>
              </View>
            ) : null}
            <Pressable
              onPress={handleSaveProfile}
              disabled={savingProfile}
              style={({ pressed }) => [styles.saveAddrBtn, { backgroundColor: colors.primary, opacity: pressed || savingProfile ? 0.7 : 1 }]}
            >
              {savingProfile
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.saveAddrBtnText}>Save Changes</Text>
              }
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      {/* Add Address Modal */}
      <Modal visible={addAddrModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAddAddrModal(false)}>
        <View style={[styles.modal, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Add Address</Text>
            <Pressable onPress={() => setAddAddrModal(false)}>
              <Feather name="x" size={22} color={colors.foreground} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>LABEL</Text>
            <View style={styles.labelRow}>
              {PRESET_LABELS.map((p) => (
                <Pressable
                  key={p.label}
                  onPress={() => { Haptics.selectionAsync(); setNewAddrLabel(p.label); setNewAddrIcon(p.icon); }}
                  style={({ pressed }) => [
                    styles.labelChip,
                    { backgroundColor: newAddrLabel === p.label ? colors.primary : colors.card, borderColor: newAddrLabel === p.label ? colors.primary : colors.border, opacity: pressed ? 0.8 : 1 },
                  ]}
                >
                  <Feather name={p.icon} size={14} color={newAddrLabel === p.label ? "#fff" : colors.mutedForeground} />
                  <Text style={[styles.labelChipText, { color: newAddrLabel === p.label ? "#fff" : colors.foreground }]}>{p.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground, marginTop: 16 }]}>ADDRESS</Text>
            <View style={[styles.addrInput, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Feather name="map-pin" size={16} color={colors.mutedForeground} />
              <TextInput
                style={[styles.addrTextField, { color: colors.foreground }]}
                placeholder="Enter full address..."
                placeholderTextColor={colors.mutedForeground}
                value={newAddrText}
                onChangeText={setNewAddrText}
                multiline
                autoFocus
              />
            </View>
            {addAddrError ? (
              <View style={[styles.inlineFeedback, { backgroundColor: colors.destructive + "15", borderColor: colors.destructive + "40" }]}>
                <Feather name="alert-circle" size={14} color={colors.destructive} />
                <Text style={[styles.inlineFeedbackText, { color: colors.destructive }]}>{addAddrError}</Text>
              </View>
            ) : null}
            <Pressable
              onPress={addAddress}
              style={({ pressed }) => [styles.saveAddrBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
            >
              <Text style={styles.saveAddrBtnText}>Save Address</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  content: { padding: 20, gap: 24 },
  profileHeader: { alignItems: "center", gap: 8, paddingVertical: 8 },
  bigAvatar: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  bigAvatarText: { color: "#fff", fontSize: 36, fontFamily: "Inter_700Bold" },
  userName: { fontSize: 22, fontFamily: "Inter_700Bold" },
  userEmail: { fontSize: 14, fontFamily: "Inter_400Regular" },
  walletCard: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 18, borderRadius: 16 },
  walletLabel: { color: "rgba(255,255,255,0.75)", fontSize: 13, fontFamily: "Inter_400Regular" },
  walletAmount: { color: "#fff", fontSize: 28, fontFamily: "Inter_700Bold", marginTop: 2 },
  walletIconBox: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  section: { gap: 10 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  addBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  topupRow: { flexDirection: "row", gap: 10 },
  topupInput: { flex: 1, flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  currencySymbol: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  amountInput: { flex: 1, fontSize: 18, fontFamily: "Inter_600SemiBold" },
  topupBtn: { width: 52, height: 52, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  quickAmounts: { flexDirection: "row", gap: 8 },
  quickBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, alignItems: "center" },
  quickBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  inlineFeedback: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, padding: 10 },
  inlineFeedbackText: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  emptyCard: { borderRadius: 14, borderWidth: 1.5, padding: 20, alignItems: "center", gap: 8 },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  listCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  listRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  listIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  driverAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  listInfo: { flex: 1, gap: 2 },
  listLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  listSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  driverMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  divider: { height: 1, marginLeft: 14 },
  guestState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 30 },
  guestScroll: { padding: 20, gap: 16, paddingBottom: 40 },
  guestHero: { borderRadius: 20, padding: 28, alignItems: "center", gap: 12 },
  guestAvatarLg: { width: 100, height: 100, borderRadius: 50, borderWidth: 2, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  guestAvatar: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  guestTitle: { fontSize: 21, fontFamily: "Inter_700Bold", textAlign: "center" },
  guestSubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  perksCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  perkRow: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14 },
  perkIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  perkText: { fontSize: 14, fontFamily: "Inter_400Regular", flex: 1 },
  signInBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 15, borderRadius: 14 },
  signInBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  createBtn: { paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, alignItems: "center" },
  createBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  guestDisclaimer: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  registerLink: { fontSize: 14, fontFamily: "Inter_500Medium" },
  signOutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderWidth: 1.5, borderRadius: 14, paddingVertical: 15, marginTop: 4 },
  signOutBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  signOutOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 24 },
  signOutCard: { width: "100%", borderRadius: 20, borderWidth: 1, padding: 24, alignItems: "center", gap: 10 },
  signOutIconBox: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  signOutTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  signOutSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  signOutActions: { flexDirection: "row", gap: 12, marginTop: 8, width: "100%" },
  signOutCancel: { flex: 1, borderWidth: 1.5, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  signOutCancelText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  signOutConfirm: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  signOutConfirmText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  editProfileBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, marginTop: 4 },
  editProfileBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  namePromptBanner: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 10, borderWidth: 1 },
  namePromptText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#d97706" },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, marginTop: 4 },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  modal: { flex: 1 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  modalContent: { padding: 20, gap: 10 },
  labelRow: { flexDirection: "row", gap: 10 },
  labelChip: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 10, borderWidth: 1.5, paddingVertical: 10 },
  labelChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  addrInput: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderWidth: 1, borderRadius: 12, padding: 14, minHeight: 80 },
  addrTextField: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  saveAddrBtn: { borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  saveAddrBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
