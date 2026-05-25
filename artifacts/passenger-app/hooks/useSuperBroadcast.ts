import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "@/lib/firebase";

export interface Broadcast {
  id: string;
  title?: string;
  message: string;
  type: string;
  active: boolean;
}

export function useSuperBroadcast(): Broadcast[] {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);

  useEffect(() => {
    const q = query(
      collection(db, "superBroadcast"),
      where("active", "==", true),
      where("type", "==", "critical")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setBroadcasts(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Broadcast, "id">) }))
        );
      },
      () => {}
    );
    return () => unsub();
  }, []);

  return broadcasts;
}
