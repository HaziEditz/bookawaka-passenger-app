import { Platform } from "react-native";
import { LatLng } from "./googlePlaces";

const DIRECT_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const _rawBase =
  process.env.EXPO_PUBLIC_API_URL ??
  (process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`
    : "");
// Strip explicit port numbers — Replit proxies all traffic through standard HTTPS (port 8080 is internal only)
const API_BASE = _rawBase.replace(/^(https?:\/\/[^/:]+):\d+(\/|$)/, "$1$2");

async function fetchDirections(params: URLSearchParams): Promise<any> {
  // On native, always call Google directly — key is embedded in the bundle
  if (Platform.OS !== "web" && DIRECT_KEY) {
    params.set("key", DIRECT_KEY);
    const res = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${params}`);
    return res.json();
  }
  // On web, proxy through the API server to hide the key
  if (API_BASE) {
    const res = await fetch(`${API_BASE}/places/directions?${params}`);
    return res.json();
  }
  return {};
}

export interface RouteResult {
  distanceMeters: number;
  distanceText: string;
  durationSeconds: number;
  durationText: string;
  polylinePoints: LatLng[];
}

function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

export async function getRoute(
  origin: LatLng,
  destination: LatLng,
  waypoints?: LatLng[]
): Promise<RouteResult | null> {
  try {
    const params = new URLSearchParams({
      origin: `${origin.latitude},${origin.longitude}`,
      destination: `${destination.latitude},${destination.longitude}`,
    });
    if (waypoints && waypoints.length > 0) {
      params.set("waypoints", waypoints.map((w) => `${w.latitude},${w.longitude}`).join("|"));
    }
    const data = await fetchDirections(params);
    if (data.status !== "OK" || !data.routes?.[0]) return null;
    const route = data.routes[0];
    const totalDistance = route.legs.reduce((s: number, l: any) => s + l.distance.value, 0);
    const totalDuration = route.legs.reduce((s: number, l: any) => s + l.duration.value, 0);
    const polylinePoints = decodePolyline(route.overview_polyline.points);
    return {
      distanceMeters: totalDistance,
      distanceText: totalDistance >= 1000
        ? `${(totalDistance / 1000).toFixed(1)} km`
        : `${totalDistance} m`,
      durationSeconds: totalDuration,
      durationText: totalDuration >= 3600
        ? `${Math.floor(totalDuration / 3600)}h ${Math.floor((totalDuration % 3600) / 60)}min`
        : `${Math.ceil(totalDuration / 60)} min`,
      polylinePoints,
    };
  } catch (e) {
    console.warn("getRoute error:", e);
    return null;
  }
}
