import { Redirect } from "expo-router";
import React from "react";

/** Deep-link target for Stripe cancel: passenger-app://stripe-cancel?... */
export default function StripeCancelScreen() {
  return <Redirect href="/booking" />;
}
