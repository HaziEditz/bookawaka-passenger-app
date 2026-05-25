import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
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
}

interface TripContextType {
  history: HistoryItem[];
  addToHistory: (item: Omit<HistoryItem, "id" | "date">) => Promise<void>;
  clearHistory: () => Promise<void>;
}

const TripContext = createContext<TripContextType | null>(null);

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
        };
      });
      setHistory(items);
    });
    return () => unsub();
  }, [userId]);

  const addToHistory = async (item: Omit<HistoryItem, "id" | "date">) => {
    if (!userId) return;
    await addDoc(collection(db, "trips"), {
      ...item,
      userId,
      createdAt: serverTimestamp(),
    });
  };

  const clearHistory = async () => {
    if (!userId) return;
    const q = query(collection(db, "trips"), where("userId", "==", userId));
    const { getDocs } = await import("firebase/firestore");
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map((d) => deleteDoc(doc(db, "trips", d.id))));
  };

  return (
    <TripContext.Provider value={{ history, addToHistory, clearHistory }}>
      {children}
    </TripContext.Provider>
  );
}

export function useTripHistory() {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error("useTripHistory must be used within TripProvider");
  return ctx;
}
