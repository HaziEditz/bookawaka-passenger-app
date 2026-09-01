import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import ForceUpdateGate, { isUpdateRequired } from "@/components/ForceUpdateGate";
import LinkPasswordGate from "@/components/LinkPasswordGate";
import { AuthProvider } from "@/context/AuthContext";
import { AppConfigProvider, useAppConfig } from "@/context/AppConfigContext";
import { CompaniesProvider } from "@/context/CompaniesContext";
import { TripProvider } from "@/context/TripContext";
import { RideProvider } from "@/context/RideContext";
import { NotificationProvider } from "@/context/NotificationContext";
import {
  addNotificationReceivedListener,
  addNotificationResponseListener,
} from "@/lib/pushNotifications";
import * as Updates from "expo-updates";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="auth/login" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="auth/register" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="services/taxi" options={{ headerShown: false }} />
      <Stack.Screen name="services/food" options={{ headerShown: false }} />
      <Stack.Screen name="services/freight" options={{ headerShown: false }} />
      <Stack.Screen name="services/tow" options={{ headerShown: false }} />
      <Stack.Screen name="services/tow-track" options={{ headerShown: false }} />
      <Stack.Screen name="services/rental" options={{ headerShown: false }} />
      <Stack.Screen name="booking/index" options={{ headerShown: false }} />
      <Stack.Screen name="active-ride/index" options={{ headerShown: false }} />
      <Stack.Screen name="ride-complete/index" options={{ headerShown: false }} />
      <Stack.Screen name="stripe-return" options={{ headerShown: false }} />
      <Stack.Screen name="stripe-cancel" options={{ headerShown: false }} />
      <Stack.Screen name="edit-scheduled" options={{ headerShown: false }} />
    </Stack>
  );
}

/** Explicit OTA check — default ON_LOAD alone was not reliably applying preview updates. */
async function checkAndApplyOtaUpdate() {
  if (__DEV__ || Platform.OS === "web") return;
  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) return;
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync();
  } catch (err) {
    console.warn("[Updates] check/apply failed:", err);
  }
}

/** Reads app config from Firebase and gates access before rendering the main app. */
function AppGate() {
  const { minVersion, linkPassword, loading } = useAppConfig();
  const [passwordVerified, setPasswordVerified] = useState(false);

  // Still fetching config — splash screen is still visible, so just return null
  if (loading) return null;

  // Force-update gate (blocks everything — no navigation, no password bypass)
  if (isUpdateRequired(minVersion)) {
    return <ForceUpdateGate minVersion={minVersion!} />;
  }

  // Link-password gate (only shown when a password is set and not yet verified)
  if (linkPassword && !passwordVerified) {
    return (
      <LinkPasswordGate
        password={linkPassword}
        onVerified={() => setPasswordVerified(true)}
      />
    );
  }

  return <RootLayoutNav />;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    checkAndApplyOtaUpdate();
  }, []);

  // Set up push notification listeners (no-op on web)
  useEffect(() => {
    if (Platform.OS === "web") return;

    const receivedSub = addNotificationReceivedListener((_notification) => {
      // In-app: the rideStatus listener already handles recall in-app,
      // but this covers any other backend push that arrives while the app is open
    });

    const responseSub = addNotificationResponseListener((response) => {
      const data = response.notification.request.content.data as any;
      // If the backend included a bookingId, deep-link to the active ride screen
      if (data?.bookingId) {
        router.push("/active-ride");
      }
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, []);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <AppConfigProvider>
                <AuthProvider>
                  <CompaniesProvider>
                    <TripProvider>
                      <NotificationProvider>
                        <RideProvider>
                          <AppGate />
                        </RideProvider>
                      </NotificationProvider>
                    </TripProvider>
                  </CompaniesProvider>
                </AuthProvider>
              </AppConfigProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
