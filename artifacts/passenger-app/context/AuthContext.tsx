import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  User as FirebaseUser,
} from "firebase/auth";
import { get, onValue, ref, set, update } from "firebase/database";
import React, { createContext, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";
import { auth, rtdb } from "@/lib/firebase";
import { registerForPushNotificationsAsync } from "@/lib/pushNotifications";

/**
 * Strip all non-digit characters so phone numbers are stored consistently
 * regardless of how the user typed them (+64 21 123 4567 → 6421123567).
 * This matches the `phoneDigitsOnly` key format used by the driver app and
 * Owner Panel at `passengerRatings/{cid}/{phoneDigitsOnly}/{bookingId}`.
 */
function normalisePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

function looksLikeEmail(raw: string): boolean {
  return raw.includes("@");
}

/** Synthetic email for phone-only accounts (Firebase Auth requires an email). */
function phoneAuthEmail(digits: string): string {
  return `p${digits}@phone.bookawaka.users`;
}

/** Returns a human-readable name from Firebase Auth displayName only.
 *  Never uses the email address or its prefix — those are not names.
 *  Falls back to empty so the profile screen can prompt for a name. */
function resolveName(displayName: string | null): string {
  if (displayName) {
    const trimmed = displayName.trim();
    if (trimmed && !/^\d+$/.test(trimmed) && !trimmed.includes("@")) return trimmed;
  }
  return "";
}

async function resolveLoginEmail(identifier: string): Promise<string> {
  const trimmed = identifier.trim();
  if (looksLikeEmail(trimmed)) return trimmed.toLowerCase();

  const digits = normalisePhone(trimmed);
  if (!digits || digits.length < 7) {
    throw Object.assign(new Error("Enter a valid email or phone number."), {
      code: "auth/invalid-email",
    });
  }

  const candidates = [digits];
  if (digits.startsWith("0")) candidates.push(digits.slice(1));
  else candidates.push(`0${digits}`);
  if (digits.startsWith("64") && digits.length > 2) candidates.push(digits.slice(2));
  else if (!digits.startsWith("64")) candidates.push(`64${digits}`);

  for (const c of candidates) {
    try {
      const snap = await get(ref(rtdb, `passengerIndex/phone/${c}`));
      if (snap.exists()) {
        const row = snap.val() as Record<string, unknown>;
        const email = String(row.email ?? "").trim();
        if (email) return email.toLowerCase();
        // Legacy rows only stored key — try synthetic phone email
      }
    } catch {
      // continue
    }
  }

  // Phone-only accounts created by this app use a deterministic email.
  return phoneAuthEmail(digits);
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  walletBalance: number;
}

interface AuthContextType {
  user: UserProfile | null;
  firebaseUser: FirebaseUser | null;
  isLoading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (name: string, email: string, phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (identifier: string) => Promise<string>;
  updateWallet: (amount: number) => Promise<void>;
  updateUserProfile: (name: string, phone: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

async function persistExpoPushToken(uid: string) {
  if (Platform.OS === "web") return;
  try {
    const token = await registerForPushNotificationsAsync();
    if (!token) return;
    await update(ref(rtdb, `users/${uid}`), {
      expoPushToken: token,
      deviceUid: token,
      pushUpdatedAt: Date.now(),
    });
  } catch (err) {
    console.warn("[Auth] push token persist failed:", (err as Error)?.message);
  }
}

async function writePhoneIndex(digits: string, uid: string, email: string) {
  if (!digits) return;
  const payload = { key: uid, email, uid, updatedAt: Date.now() };
  const candidates = [digits];
  if (digits.startsWith("0")) candidates.push(digits.slice(1));
  else candidates.push(`0${digits}`);
  if (digits.startsWith("64") && digits.length > 2) candidates.push(digits.slice(2));
  else if (!digits.startsWith("64")) candidates.push(`64${digits}`);
  await Promise.all(
    [...new Set(candidates)].map((c) =>
      set(ref(rtdb, `passengerIndex/phone/${c}`), payload).catch(() => undefined),
    ),
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (fbUser) => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      if (!fbUser) {
        setUser(null);
        setFirebaseUser(null);
        setIsLoading(false);
        return;
      }

      // No guest / anonymous sessions — sign them out and show login.
      if (fbUser.isAnonymous) {
        signOut(auth).catch(() => undefined);
        setUser(null);
        setFirebaseUser(null);
        setIsLoading(false);
        return;
      }

      setFirebaseUser(fbUser);
      void persistExpoPushToken(fbUser.uid);

      unsubProfile = onValue(
        ref(rtdb, `users/${fbUser.uid}`),
        (snap) => {
          if (snap.exists()) {
            const data = snap.val() as Record<string, unknown>;
            const savedName = String(data.name ?? "").trim();
            const looksLikeEmailPrefix =
              savedName &&
              !savedName.includes(" ") &&
              savedName === savedName.toLowerCase() &&
              savedName.length > 10;
            const name =
              savedName &&
              !/^\d+$/.test(savedName) &&
              !savedName.includes("@") &&
              !looksLikeEmailPrefix
                ? savedName
                : resolveName(fbUser.displayName);
            setUser({
              id: fbUser.uid,
              name,
              email: String(data.email ?? fbUser.email ?? ""),
              phone: String(data.phone ?? data.phoneNumber ?? fbUser.phoneNumber ?? ""),
              walletBalance: Number(data.walletBalance ?? data.wallet ?? data.balance ?? 0),
            });
          } else {
            setUser({
              id: fbUser.uid,
              name: resolveName(fbUser.displayName),
              email: fbUser.email ?? "",
              phone: fbUser.phoneNumber ?? "",
              walletBalance: 0,
            });
          }
          setIsLoading(false);
        },
        (err) => {
          console.warn("[Auth] RTDB user read failed:", err.message);
          setUser({
            id: fbUser.uid,
            name: resolveName(fbUser.displayName),
            email: fbUser.email ?? "",
            phone: fbUser.phoneNumber ?? "",
            walletBalance: 0,
          });
          setIsLoading(false);
        },
      );
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const login = async (identifier: string, password: string) => {
    const email = await resolveLoginEmail(identifier);
    await signInWithEmailAndPassword(auth, email, password);
  };

  const register = async (name: string, email: string, phone: string, password: string) => {
    const phoneDigits = normalisePhone(phone);
    const emailTrim = email.trim().toLowerCase();
    if (!phoneDigits && !emailTrim) {
      throw Object.assign(new Error("Email or phone number is required."), {
        code: "auth/invalid-email",
      });
    }
    if (!phoneDigits || phoneDigits.length < 7) {
      throw Object.assign(new Error("Please enter a valid phone number."), {
        code: "auth/invalid-phone",
      });
    }
    const authEmail = emailTrim || phoneAuthEmail(phoneDigits);
    const cred = await createUserWithEmailAndPassword(auth, authEmail, password);
    await updateProfile(cred.user, { displayName: name });
    try {
      await set(ref(rtdb, `users/${cred.user.uid}`), {
        name,
        email: authEmail,
        phone: phoneDigits,
        walletBalance: 0,
        createdAt: Date.now(),
      });
      await writePhoneIndex(phoneDigits, cred.user.uid, authEmail);
      if (emailTrim) {
        const emailKey = emailTrim.replace(/\./g, ",").replace(/@/g, "__at__");
        await set(ref(rtdb, `passengerIndex/email/${emailKey}`), {
          key: cred.user.uid,
          uid: cred.user.uid,
          email: authEmail,
        }).catch(() => undefined);
      }
    } catch (err: unknown) {
      console.warn("[Auth] RTDB profile write failed:", (err as Error)?.message);
      setUser({
        id: cred.user.uid,
        name,
        email: authEmail,
        phone: phoneDigits,
        walletBalance: 0,
      });
    }
    void persistExpoPushToken(cred.user.uid);
  };

  const resetPassword = async (identifier: string): Promise<string> => {
    const email = await resolveLoginEmail(identifier);
    await sendPasswordResetEmail(auth, email);
    return email;
  };

  const logout = async () => {
    await signOut(auth);
    setUser(null);
    setFirebaseUser(null);
  };

  const updateWallet = async (amount: number) => {
    if (!firebaseUser || !user) return;
    const newBalance = user.walletBalance + amount;
    await update(ref(rtdb, `users/${firebaseUser.uid}`), { walletBalance: newBalance });
    setUser((prev) => (prev ? { ...prev, walletBalance: newBalance } : prev));
  };

  const updateUserProfile = async (name: string, phone: string) => {
    if (!firebaseUser || !user) return;
    const phoneDigits = normalisePhone(phone);
    await updateProfile(firebaseUser, { displayName: name });
    await update(ref(rtdb, `users/${firebaseUser.uid}`), { name, phone: phoneDigits });
    if (phoneDigits && user.email) {
      await writePhoneIndex(phoneDigits, firebaseUser.uid, user.email);
    }
    setUser((prev) => (prev ? { ...prev, name, phone: phoneDigits } : prev));
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        firebaseUser,
        isLoading,
        login,
        register,
        logout,
        resetPassword,
        updateWallet,
        updateUserProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
