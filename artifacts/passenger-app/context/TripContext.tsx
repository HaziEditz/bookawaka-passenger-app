import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import React, { createContext, useContext, useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";

export type ServiceType = "taxi" | "food" | "freight";
export type TripStatus = "searching" | "confirmed" | "en_route" | "arrived" | "completed" | "cancelled";
export type PaymentMethod = "cash" | "card" | "wallet" | "account" | "gift_card";

export interface HistoryItem {
  id: string;
  serviceType: ServiceType;
  status: TripStatus;
  from?: string;
  to?: string;
  restaurantName?: string;
  items?: string;
  description?: string;
  price: number;
  paymentMethod: PaymentMethod;
  date: string;
  driverName?: string;
  driverRating?: number;
  bookingId?: string;
}

export type HistoryWriteInput = Omit<HistoryItem, "id" | "date"> & {
  bookingId?: string;
};

interface TripContextType {
  history: HistoryItem[];
  addToHistory: (item: HistoryWriteInput) => Promise<void>;
  /** Idempotent write — safe on Done, Skip, or server-driven complete. */
  ensureTripInHistory: (item: HistoryWriteInput) => Promise<void>;
  clearHistory: () => Promise<void>;
}

const TripContext = createContext<TripContextType | null>(null);

function historyDocId(userId: string, bookingId?: string): string | null {
  const bid = String(bookingId || "").trim();
  if (!bid) return null;
  return `${userId}_${bid}`;
}

export function TripProvider({ children }: { children: React.ReactNode }) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUserId(u?.uid ?? null);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!userId) {
      setHistory([]);
      return;
    }
    const q = query(
      collection(db, "trips"),
      where("userId", "==", userId),
      orderBy("createdAt", "desc"),
      limit(50)
    );
    const unsub = onSnapshot(q, (snap) => {
      const items: HistoryItem[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          serviceType: data.serviceType,
          status: data.status,
          from: data.from,
          to: data.to,
          restaurantName: data.restaurantName,
          items: data.items,
          description: data.description,
          price: data.price,
          paymentMethod: data.paymentMethod,
          date: data.createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
          driverName: data.driverName,
          driverRating: data.driverRating,
          bookingId: data.bookingId ? String(data.bookingId) : undefined,
        };
      });
      setHistory(items);
    });
    return () => unsub();
  }, [userId]);

  const addToHistory = async (item: HistoryWriteInput) => {
    await ensureTripInHistory(item);
  };

  const ensureTripInHistory = async (item: HistoryWriteInput) => {
    if (!userId) return;
    const payload = {
      ...item,
      userId,
      bookingId: item.bookingId ? String(item.bookingId) : null,
      createdAt: serverTimestamp(),
    };
    const id = historyDocId(userId, item.bookingId);
    try {
      if (id) {
        await setDoc(doc(db, "trips", id), payload, { merge: true });
        return;
      }
      await addDoc(collection(db, "trips"), payload);
    } catch (e) {
      console.warn("[TripHistory] ensureTripInHistory failed:", e);
    }
  };

  const clearHistory = async () => {
    if (!userId) return;
    const q = query(collection(db, "trips"), where("userId", "==", userId));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map((d) => deleteDoc(doc(db, "trips", d.id))));
  };

  return (
    <TripContext.Provider value={{ history, addToHistory, ensureTripInHistory, clearHistory }}>
      {children}
    </TripContext.Provider>
  );
}

export function useTripHistory() {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error("useTripHistory must be used within TripProvider");
  return ctx;
}
