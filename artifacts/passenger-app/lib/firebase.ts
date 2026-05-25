import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApps, initializeApp } from "firebase/app";
import { getAuth, initializeAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getFirestore } from "firebase/firestore";
import { Platform } from "react-native";

const firebaseConfig = {
  apiKey: 'AIzaSyDIVSI_GRYG0hCPvc9h80QXZMxwZoejctQ',
  authDomain: 'bookawaka2026-564e1.firebaseapp.com',
  databaseURL: 'https://bookawaka2026-564e1-default-rtdb.firebaseio.com',
  projectId: 'bookawaka2026-564e1',
  storageBucket: 'bookawaka2026-564e1.firebasestorage.app',
  messagingSenderId: '909621127467',
  appId: '1:909621127467:web:504f502a533ca0a216fd6e',
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

function getFirebaseAuth() {
  if (Platform.OS === "web") {
    try { return initializeAuth(app, {}); } catch { return getAuth(app); }
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getReactNativePersistence } = require("firebase/auth") as {
      getReactNativePersistence: (s: typeof AsyncStorage) => unknown;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) } as any);
  } catch {
    return getAuth(app);
  }
}

export const auth = getFirebaseAuth();
/** Firestore — used for user profiles / auth-linked data */
export const db = getFirestore(app);
/** Realtime Database — used for companies, vehicles, drivers, tariffs, online status */
export const rtdb = getDatabase(app);
export default app;
