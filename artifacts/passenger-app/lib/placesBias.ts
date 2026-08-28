/**
 * Company-city location bias for Google Places autocomplete.
 * Matches bookwakacom / Invercargill-taxis website geocode bias
 * (centre -46.4132, 168.3538) when city is Invercargill / NZ default.
 */

export type PlacesBias = {
  lat: number;
  lng: number;
  /** Google `components` country code, e.g. "nz" */
  country: string;
  /** Metres — Google Autocomplete location bias radius */
  radius: number;
  city?: string;
};

/** Same centre as bookwakacom AddressInput / geocode-search DEFAULT_VIEWBOX. */
export const INVERCARGILL_PLACES_BIAS: PlacesBias = {
  lat: -46.4132,
  lng: 168.3538,
  country: "nz",
  radius: 50000,
  city: "Invercargill",
};

const CITY_CENTERS: Record<string, { lat: number; lng: number; country?: string }> = {
  invercargill: { lat: -46.4132, lng: 168.3538, country: "nz" },
  dunedin: { lat: -45.8788, lng: 170.5028, country: "nz" },
  christchurch: { lat: -43.5321, lng: 172.6362, country: "nz" },
  queenstown: { lat: -45.0312, lng: 168.6626, country: "nz" },
  auckland: { lat: -36.8509, lng: 174.7645, country: "nz" },
  wellington: { lat: -41.2865, lng: 174.7762, country: "nz" },
};

function normalizeCountry(raw?: string | null): string {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (!s) return "nz";
  if (s === "nz" || s === "new zealand" || s === "newzealand") return "nz";
  if (s === "au" || s === "australia") return "au";
  if (/^[a-z]{2}$/.test(s)) return s;
  return "nz";
}

/**
 * Resolve Places bias from company city/country (Firebase companySettings / superClients).
 * Falls back to Invercargill NZ — the live BookaWaka operating city.
 */
export function resolvePlacesBias(opts?: {
  city?: string | null;
  country?: string | null;
  companyName?: string | null;
}): PlacesBias {
  const cityRaw = String(opts?.city || "").trim().toLowerCase();
  const nameHint = String(opts?.companyName || "").trim().toLowerCase();
  const country = normalizeCountry(opts?.country);

  const cityKey =
    (cityRaw && CITY_CENTERS[cityRaw] && cityRaw) ||
    Object.keys(CITY_CENTERS).find((k) => cityRaw.includes(k) || nameHint.includes(k)) ||
    "";

  if (cityKey && CITY_CENTERS[cityKey]) {
    const c = CITY_CENTERS[cityKey];
    return {
      lat: c.lat,
      lng: c.lng,
      country: c.country || country,
      radius: 50000,
      city: cityKey.replace(/\b\w/g, (ch) => ch.toUpperCase()),
    };
  }

  return { ...INVERCARGILL_PLACES_BIAS, country };
}
