/**
 * Geographic + trip-length guards for Places autocomplete and fare/route.
 * Prevents same-name streets far from the operating city (e.g. 2652 km / $7460).
 */

import type { PlacesBias } from "@/lib/placesBias";

/** Soft autocomplete radius stays 50 km; post-select reject beyond this from bias centre. */
export const MAX_PLACE_FROM_BIAS_KM = 80;

/** Destination/stop vs pickup — hard reject beyond this (local taxi ops). */
export const MAX_PLACE_FROM_PICKUP_KM = 150;

/** Route distance hard block (Directions km). */
export const MAX_TRIP_DISTANCE_KM = 150;

/** Confirm dialog when route is long but under the hard max. */
export const WARN_TRIP_DISTANCE_KM = 80;

/** Absolute fare ceiling for a normal local trip. */
export const MAX_TRIP_FARE = 500;

export function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type PlaceGeoCheckOpts = {
  location: { latitude: number; longitude: number };
  address?: string;
  /** Company / city bias centre */
  bias?: PlacesBias | null;
  /** When selecting destination/stop, also compare to pickup */
  pickup?: { latitude: number; longitude: number } | null;
  /** 'pickup' only checks bias; 'destination'|'stop' also checks vs pickup */
  role?: "pickup" | "destination" | "stop";
};

export type PlaceGeoCheckResult =
  | { ok: true }
  | { ok: false; reason: string; distanceKm: number };

/**
 * Reject places that geocode far from the operating city (or pickup).
 * Catches same-name streets in other NZ cities after an early tap.
 */
export function checkPlaceGeography(opts: PlaceGeoCheckOpts): PlaceGeoCheckResult {
  const loc = opts.location;
  if (!Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) {
    return { ok: false, reason: "That address has no map location. Please pick another.", distanceKm: 0 };
  }

  const bias = opts.bias;
  if (bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lng)) {
    const dBias = haversineKm(loc, { latitude: bias.lat, longitude: bias.lng });
    if (dBias > MAX_PLACE_FROM_BIAS_KM) {
      const city = bias.city || "your area";
      return {
        ok: false,
        reason: `That address is about ${Math.round(dBias)} km from ${city} — likely the wrong street. Pick a local result (check the suburb/city under the name).`,
        distanceKm: dBias,
      };
    }
  }

  const role = opts.role || "destination";
  if (role !== "pickup" && opts.pickup) {
    const dPick = haversineKm(loc, opts.pickup);
    if (dPick > MAX_PLACE_FROM_PICKUP_KM) {
      return {
        ok: false,
        reason: `That location is about ${Math.round(dPick)} km from your pickup — too far for this trip. Choose a nearer address.`,
        distanceKm: dPick,
      };
    }
  }

  return { ok: true };
}

export type TripSanityResult =
  | { ok: true; warn?: string }
  | { ok: false; reason: string };

/** Block (or warn on) implausible Directions distance / fare before book or mid-ride edit. */
export function checkTripSanity(opts: {
  distanceMeters: number;
  fareTotal: number;
}): TripSanityResult {
  const km = opts.distanceMeters / 1000;
  if (!Number.isFinite(km) || km <= 0) {
    return { ok: false, reason: "Could not calculate a valid route distance. Check your addresses." };
  }
  if (km > MAX_TRIP_DISTANCE_KM) {
    return {
      ok: false,
      reason: `This route is ${km.toFixed(0)} km — far beyond a normal local trip. One of the addresses is probably wrong (same street name in another city). Please re-select pickup/destination.`,
    };
  }
  if (!Number.isFinite(opts.fareTotal) || opts.fareTotal <= 0) {
    return { ok: false, reason: "Could not calculate a valid fare. Check your addresses." };
  }
  if (opts.fareTotal > MAX_TRIP_FARE) {
    return {
      ok: false,
      reason: `Estimated fare ${opts.fareTotal.toFixed(2)} is unrealistically high for a local trip. Re-check the addresses before booking.`,
    };
  }
  if (km > WARN_TRIP_DISTANCE_KM) {
    return {
      ok: true,
      warn: `This route is ${km.toFixed(0)} km (about $${opts.fareTotal.toFixed(0)}). Confirm the destination city/suburb is correct before continuing.`,
    };
  }
  return { ok: true };
}
