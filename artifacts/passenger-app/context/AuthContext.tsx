import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  User as FirebaseUser,
} from "firebase/auth";
import { onValue, ref, set, update } from "firebase/database";
import React, { createContext, useContext, useEffect, useState } from "react";
import { auth, rtdb } from "@/lib/firebase";

/**
 * Strip all non-digit characters so phone numbers are stored consistently
 * regardless of how the user typed them (+64 21 123 4567 → 6421123567).
 * This matches the `phoneDigitsOnly` key format used by the driver app and
 * Owner Panel at `passengerRatings/{cid}/{phoneDigitsOnly}/{bookingId}`.
 */
function normalisePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** Returns a human-readable name from Firebase Auth displayName only.
 *  Never uses the email address or its prefix — those are not names.
 *  Falls back to "Guest" so it's obvious the user needs to set their name. */
function resolveName(displayName: string | null): string {
  if (displayName) {
    const trimmed = displayName.trim();
    // Reject purely numeric strings and anything that looks like an email
    if (trimmed && !/^\d+$/.test(trimmed) && !trimmed.includes("@")) return trimmed;
  }
  return "Guest";
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
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateWallet: (amount: number) => Promise<void>;
  updateUserProfile: (name: string, phone: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (fbUser) => {
      if (unsubProfile) { unsubProfile(); unsubProfile = null; }

      if (!fbUser) {
        // Sign in anonymously so Firebase auth token exists for RTDB rules
        signInAnonymously(auth).catch((err) => {
          console.warn("[Auth] Anonymous sign-in failed:", err.message);
          setUser(null);
          setFirebaseUser(null);
          setIsLoading(false);
        });
        return;
      }

      // Anonymous users — treat as guest, don't load a profile
      if (fbUser.isAnonymous) {
        setUser(null);
        setFirebaseUser(fbUser);
        setIsLoading(false);
        return;
      }

      setFirebaseUser(fbUser);

      // Listen to user profile in Realtime Database
      unsubProfile = onValue(
        ref(rtdb, `users/${fbUser.uid}`),
        (snap) => {
          if (snap.exists()) {
            const data = snap.val() as Record<string, unknown>;
            const savedName = String(data.name ?? "").trim();
            // Reject names that look like email prefixes (no spaces, all lowercase, no @)
            const looksLikeEmailPrefix = savedName && !savedName.includes(" ") && savedName === savedName.toLowerCase() && savedName.length > 10;
            const name = savedName && !/^\d+$/.test(savedName) && !savedName.includes("@") && !looksLikeEmailPrefix
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
        }
      );
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const login = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const register = async (name: string, email: string, phone: string, password: string) => {
    const phoneDigits = normalisePhone(phone);
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    try {
      await set(ref(rtdb, `users/${cred.user.uid}`), {
        name,
        email,
        phone: phoneDigits,
        walletBalance: 0,
        createdAt: Date.now(),
      });
    } catch (err: unknown) {
      console.warn("[Auth] RTDB profile write failed:", (err as Error)?.message);
      setUser({ id: cred.user.uid, name, email, phone: phoneDigits, walletBalance: 0 });
    }
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
    setUser((prev) => prev ? { ...prev, walletBalance: newBalance } : prev);
  };

  const updateUserProfile = async (name: string, phone: string) => {
    if (!firebaseUser || !user) return;
    const phoneDigits = normalisePhone(phone);
    await updateProfile(firebaseUser, { displayName: name });
    await update(ref(rtdb, `users/${firebaseUser.uid}`), { name, phone: phoneDigits });
    setUser((prev) => prev ? { ...prev, name, phone: phoneDigits } : prev);
  };

  return (
    <AuthContext.Provider value={{ user, firebaseUser, isLoading, login, register, logout, updateWallet, updateUserProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
