import { Redirect, useLocalSearchParams } from "expo-router";
import React from "react";
import { useRide } from "@/context/RideContext";

/**
 * Deep-link target for Stripe return: passenger-app://stripe-return?...
 * Must exist — missing route showed "This screen doesn't exist" and left
 * passengers stranded after a successful card payment.
 */
export default function StripeReturnScreen() {
  const { activeRide } = useRide();
  const params = useLocalSearchParams<{ booking?: string }>();

  if (activeRide || params.booking) {
    return <Redirect href="/active-ride" />;
  }
  return <Redirect href="/(tabs)" />;
}
