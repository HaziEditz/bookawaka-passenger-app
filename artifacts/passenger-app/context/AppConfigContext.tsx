import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import { ref, onValue } from "firebase/database";
import { rtdb } from "@/lib/firebase";

interface AppConfig {
  minVersion: string | null;
  linkPassword: string | null;
  /** Platform-level master switch for cash payments. Defaults to true if not set. */
  platformCashEnabled: boolean;
  loading: boolean;
}

const AppConfigContext = createContext<AppConfig>({
  minVersion: null,
  linkPassword: null,
  platformCashEnabled: true,
  loading: true,
});

export function AppConfigProvider({ children }: { children: React.ReactNode }) {
  const [minVersion, setMinVersion] = useState<string | null>(null);
  const [linkPassword, setLinkPassword] = useState<string | null>(null);
  const [platformCashEnabled, setPlatformCashEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Listen to the whole bwConfig/appSettings node
    const settingsUnsub = onValue(
      ref(rtdb, "bwConfig/appSettings"),
      (snap) => {
        const data = snap.val() as Record<string, unknown> | null;
        if (data) {
          const mv = data.passengerAppMinVersion;
          const lp = data.passengerLinkPassword;
          setMinVersion(typeof mv === "string" && mv.trim() ? mv.trim() : null);
          setLinkPassword(
            typeof lp === "string" && lp.trim() ? lp.trim() : null,
          );
        } else {
          setMinVersion(null);
          setLinkPassword(null);
        }
        setLoading(false);
      },
      () => { setLoading(false); },
    );

    // Listen to platform-level cash enabled flag — default true if missing
    const cashUnsub = onValue(
      ref(rtdb, "bwConfig/paymentMethods/cashEnabled"),
      (snap) => {
        const val = snap.val();
        // Treat missing (null/undefined) as true; only false explicitly disables
        setPlatformCashEnabled(val === false ? false : true);
      },
      () => { setPlatformCashEnabled(true); },
    );

    return () => {
      settingsUnsub();
      cashUnsub();
    };
  }, []);

  return (
    <AppConfigContext.Provider value={{ minVersion, linkPassword, platformCashEnabled, loading }}>
      {children}
    </AppConfigContext.Provider>
  );
}

export function useAppConfig() {
  return useContext(AppConfigContext);
}
