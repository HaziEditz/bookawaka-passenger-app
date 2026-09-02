import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, router, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import ForceUpdateGate, { isUpdateRequired } from "@/components/ForceUpdateGate";
import LinkPasswordGate from "@/components/LinkPasswordGate";
import { AuthProvider, useAuth } from "@/context/AuthContext";
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
      <Stack.Screen name="auth/forgot-password" options={{ headerShown: false, presentation: "modal" }} />
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

/** Require a real (non-anonymous) Firebase account — no guest browsing. */
function AuthSessionGate({ children }: { children: React.ReactNode }) {
  const { user, firebaseUser, isLoading } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return;
    const onAuth = segments[0] === "auth";
    const signedIn = !!(firebaseUser && !firebaseUser.isAnonymous && user);
    if (!signedIn && !onAuth) {
      router.replace("/auth/login");
    } else if (signedIn && onAuth) {
      router.replace("/(tabs)");
    }
  }, [isLoading, firebaseUser, user, segments]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return <>{children}</>;
}

/** Reads app config from Firebase and gates access before rendering the main app. */
function AppGate() {
  const { minVersion, linkPassword, loading } = useAppConfig();
  const [passwordVerified, setPasswordVerified] = useState(false);

  if (loading) return null;

  if (isUpdateRequired(minVersion)) {
    return <ForceUpdateGate minVersion={minVersion!} />;
  }

  if (linkPassword && !passwordVerified) {
    return (
      <LinkPasswordGate
        password={linkPassword}
        onVerified={() => setPasswordVerified(true)}
      />
    );
  }

  return (
    <AuthSessionGate>
      <RootLayoutNav />
    </AuthSessionGate>
  );
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

  useEffect(() => {
    if (Platform.OS === "web") return;

    const receivedSub = addNotificationReceivedListener((_notification) => {
      // Foreground: rideStatus / in-app toasts still apply; OS may also present.
    });

    const responseSub = addNotificationResponseListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
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
