import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "./firebase";

export interface TMSettings {
  subsidyPercentage: number;
  subsidyCap: number;
  hoistFeePerLift: number;
}

const TM_DEFAULTS: TMSettings = {
  subsidyPercentage: 50,
  subsidyCap: 37.50,
  hoistFeePerLift: 5.00,
};

export function useTMSettings() {
  const [settings, setSettings] = useState<TMSettings>(TM_DEFAULTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ref = doc(db, "tm_settings", "config");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setSettings({
            subsidyPercentage: data.subsidyPercentage ?? TM_DEFAULTS.subsidyPercentage,
            subsidyCap: data.subsidyCap ?? TM_DEFAULTS.subsidyCap,
            hoistFeePerLift: data.hoistFeePerLift ?? TM_DEFAULTS.hoistFeePerLift,
          });
        } else {
          setDoc(ref, TM_DEFAULTS).catch(() => {});
          setSettings(TM_DEFAULTS);
        }
        setLoading(false);
      },
      () => {
        setSettings(TM_DEFAULTS);
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  return { settings, loading };
}

export function calcTMSubsidy(
  fare: number,
  settings: TMSettings
): { councilSubsidy: number; passengerPays: number } {
  const raw = (settings.subsidyPercentage / 100) * fare;
  const councilSubsidy = Math.min(raw, settings.subsidyCap);
  const passengerPays = Math.max(0, fare - councilSubsidy);
  return {
    councilSubsidy: Math.round(councilSubsidy * 100) / 100,
    passengerPays: Math.round(passengerPays * 100) / 100,
  };
}
