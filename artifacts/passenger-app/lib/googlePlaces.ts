import { Platform } from "react-native";

const DIRECT_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const _rawBase =
  process.env.EXPO_PUBLIC_API_URL ??
  (process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`
    : "");
// Strip explicit port numbers — Replit proxies all traffic through standard HTTPS (port 8080 is internal only)
const API_BASE = _rawBase.replace(/^(https?:\/\/[^/:]+):\d+(\/|$)/, "$1$2");

async function fetchGoogle(path: string, params: URLSearchParams): Promise<any> {
  // On native, always call Google directly — key is embedded in the bundle
  if (Platform.OS !== "web" && DIRECT_KEY) {
    const directPaths: Record<string, string> = {
      "places/autocomplete": "place/autocomplete/json",
      "places/details": "place/details/json",
      "places/geocode": "geocode/json",
      "places/reversegeocode": "geocode/json",
    };
    params.set("key", DIRECT_KEY);
    const googlePath = directPaths[path] ?? path;
    const url = `https://maps.googleapis.com/maps/api/${googlePath}?${params}`;
    const res = await fetch(url);
    return res.json();
  }
  // On web, proxy through the API server to hide the key
  if (API_BASE) {
    const url = `${API_BASE}/${path}?${params}`;
    const res = await fetch(url);
    return res.json();
  }
  return {};
}

export interface PlaceSuggestion {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface PlaceDetail {
  placeId: string;
  name: string;
  address: string;
  location: LatLng;
}

const placeCache = new Map<string, PlaceDetail>();

export async function searchPlaces(
  input: string,
  bias?: { lat: number; lng: number; radius?: number; country?: string } | null,
): Promise<PlaceSuggestion[]> {
  if (!input || input.length < 2) return [];
  try {
    const params = new URLSearchParams({ input });
    const country = String(bias?.country || "nz").trim().toLowerCase() || "nz";
    params.set("components", `country:${country}`);
    if (bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lng)) {
      params.set("location", `${bias.lat},${bias.lng}`);
      params.set("radius", String(bias.radius && bias.radius > 0 ? bias.radius : 50000));
      // Hard fence: only suggestions strictly inside location+radius (not soft rank bias).
      params.set("strictbounds", "true");
    }
    const data = await fetchGoogle("places/autocomplete", params);
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") return [];
    return (data.predictions ?? []).map((p: any) => ({
      placeId: p.place_id,
      description: p.description,
      mainText: p.structured_formatting?.main_text ?? p.description,
      secondaryText: p.structured_formatting?.secondary_text ?? "",
    }));
  } catch (e) {
    console.warn("searchPlaces error:", e);
    return [];
  }
}

export async function geocodePlace(placeId: string): Promise<PlaceDetail | null> {
  if (placeCache.has(placeId)) return placeCache.get(placeId)!;
  try {
    const params = new URLSearchParams({ place_id: placeId });
    const data = await fetchGoogle("places/details", params);
    if (data.status !== "OK" || !data.result) return null;
    const result = data.result;
    const detail: PlaceDetail = {
      placeId,
      name: result.formatted_address,
      address: result.formatted_address,
      location: {
        latitude: result.geometry.location.lat,
        longitude: result.geometry.location.lng,
      },
    };
    placeCache.set(placeId, detail);
    return detail;
  } catch {
    return null;
  }
}

export async function reverseGeocode(latitude: number, longitude: number): Promise<PlaceDetail | null> {
  try {
    const latlng = `${latitude},${longitude}`;
    const params = new URLSearchParams({ latlng });
    const data = await fetchGoogle("places/reversegeocode", params);
    if (data.status !== "OK" || !data.results?.[0]) return null;
    const result = data.results[0];
    const detail: PlaceDetail = {
      placeId: result.place_id,
      name: result.formatted_address,
      address: result.formatted_address,
      location: { latitude, longitude },
    };
    if (result.place_id) placeCache.set(result.place_id, detail);
    return detail;
  } catch {
    return null;
  }
}

export async function geocodeText(text: string): Promise<PlaceDetail | null> {
  try {
    const params = new URLSearchParams({ address: text });
    const data = await fetchGoogle("places/geocode", params);
    if (data.status !== "OK" || !data.results?.[0]) return null;
    const result = data.results[0];
    return {
      placeId: result.place_id,
      name: result.formatted_address,
      address: result.formatted_address,
      location: {
        latitude: result.geometry.location.lat,
        longitude: result.geometry.location.lng,
      },
    };
  } catch {
    return null;
  }
}
