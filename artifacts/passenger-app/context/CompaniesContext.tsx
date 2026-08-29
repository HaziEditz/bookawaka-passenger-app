import { onValue, ref } from "firebase/database";
import { onAuthStateChanged } from "firebase/auth";
import React, { createContext, useContext, useEffect, useState } from "react";
import {
  Company,
  DEFAULT_TARIFFS,
  TariffRates,
  VehicleType,
} from "@/constants/companies";
import { auth, rtdb } from "@/lib/firebase";
import {
  asapBookingAllowed,
  isCompanyDispatchOnline,
} from "@/lib/companyBookingAvailability";

const BRAND_COLORS = [
  "#1e40af", "#0891b2", "#7c3aed", "#16a34a", "#dc2626",
  "#d97706", "#0f766e", "#9333ea", "#c2410c", "#0369a1",
];

/** Map vehicleClass / make-model hints to a VehicleType */
function classToVehicleType(
  cls: string,
  capacity: number,
  wheelchairCap: number,
  make: string,
  model: string,
): VehicleType {
  const s = (cls + " " + make + " " + model).toLowerCase();
  if (wheelchairCap > 0 || s.includes("wheel") || s.includes("access") || s.includes("hoist")) return "Wheelchair";
  if (s.includes("electric") || s.includes(" ev") || s.includes("tesla") || s.includes("leaf") || s.includes("ioniq")) return "Electric";
  if (s.includes("luxury") || s.includes("exec") || s.includes("premium") || s.includes("bmw") || s.includes("mercedes") || s.includes("lexus") || s.includes("audi")) return "Luxury";
  if (s.includes("van") || s.includes("hiace") || s.includes("transit") || s.includes("maxi") || capacity >= 7) return "Van";
  if (s.includes("suv") || s.includes("4wd") || s.includes("rav") || s.includes("crv") || s.includes("fortuner") || (capacity >= 5 && capacity <= 6)) return "SUV";
  return "Sedan";
}

function toTariff(obj: Record<string, unknown>): TariffRates | null {
  const base = Number(
    obj.baseFare ?? obj.base ?? obj.basefare ?? obj.base_fare ??
    obj.flagFall ?? obj.flag_fall ?? obj.flagfall ?? obj.startFare ?? obj.startFee ?? 0
  );
  const km = Number(
    obj.perKm ?? obj.per_km ?? obj.perkm ?? obj.km ??
    // Firebase dispatcher uses pricePerKm / price_per_km
    obj.pricePerKm ?? obj.price_per_km ?? obj.priceperKm ?? obj.pricePerKilometer ??
    obj.ratePerKm ?? obj.rate_per_km ?? obj.kmRate ?? obj.perKilometre ?? 0
  );
  // NOTE: waitingRate / waitingInterval are WAITING-METER fields (charge only when stationary).
  // They must NOT be used as the per-minute travel rate — that would inflate moving-trip estimates.
  // Only map explicit travel-time fields (perMin, ratePerMin, minuteRate, perMinute) to perMin.
  const min = Number(
    obj.perMin ?? obj.per_min ?? obj.permin ?? obj.min ??
    obj.ratePerMin ?? obj.minuteRate ?? obj.perMinute ?? 0
  );
  const stop = Number(obj.stopFee ?? obj.stop_fee ?? obj.stopfee ?? obj.stop ?? obj.waitFee ?? 0);
  if (base <= 0 && km <= 0) return null;
  return { baseFare: base, perKm: km, perMin: min, stopFee: stop };
}

function resolveName(id: string, data: Record<string, unknown>): string {
  const priorityKeys = [
    "name", "clientName", "businessName", "tradingName", "companyName",
    "displayName", "operatorName", "title", "label", "company", "brand",
    "agency", "organisation", "organization", "client", "operator",
    "firmName", "entityName", "accountName", "providerName",
  ];
  for (const key of priorityKeys) {
    const v = data[key];
    if (v == null) continue;
    const str = String(v).trim();
    if (str && str !== id && str !== String(Number(id)) && !/^\d+$/.test(str)) return str;
  }
  // Scan all string fields as last resort
  const SKIP = new Set(["active","inactive","pending","disabled","suspended","enabled",
    "online","offline","yes","no","true","false","away","available","busy"]);
  for (const [, v] of Object.entries(data)) {
    if (typeof v !== "string") continue;
    const str = v.trim();
    if (str.length < 3 || /^\d+$/.test(str) || str === id) continue;
    if (str.includes("@") || str.startsWith("http") || /^\+?\d[\d\s\-().]{5,}$/.test(str)) continue;
    if (SKIP.has(str.toLowerCase())) continue;
    return str;
  }
  console.warn("[Company] No name found for id=" + id + " keys=" + Object.keys(data).join(","));
  return `Company ${id}`;
}

/** Synthetic load-test / regression harness tenants (bwtest*) — never offer to passengers. */
export function isLoadTestCompanyId(cid: string): boolean {
  const c = String(cid || "").trim().toLowerCase();
  if (!c) return false;
  return c === "bwtest" || c === "bwtesttariff" || c.startsWith("bwtest");
}

/** Reject Firebase push-ids mistaken for company keys when profiles are unavailable. */
function looksLikeRealCompanyId(cid: string): boolean {
  const c = String(cid || "").trim();
  if (!c || c.startsWith("-")) return false;
  if (isLoadTestCompanyId(c)) return false;
  return true;
}

const ANY_COMPANY: Company = {
  id: "any",
  name: "Any Available",
  vehicles: ["Sedan", "SUV", "Van", "Luxury", "Electric", "Wheelchair"],
  rating: 4.7,
  color: "#1e40af",
  tmApproved: true,
  tmCarTariff:        { baseFare: 4.5, perKm: 1.3, perMin: 0.22, stopFee: 2.5 },
  tmWheelchairTariff: { baseFare: 6.0, perKm: 1.8, perMin: 0.28, stopFee: 3.5 },
};

export function getVehicleTariff(company: Company, vehicleType: VehicleType): TariffRates {
  return company.vehicleTariffs?.[vehicleType] ?? DEFAULT_TARIFFS[vehicleType];
}

interface CompaniesContextType {
  companies: Company[];
  loading: boolean;
}

const CompaniesContext = createContext<CompaniesContextType>({
  companies: [ANY_COMPANY],
  loading: true,
});

type RtdbVehicle = Record<string, unknown>;
type RtdbDriver = Record<string, unknown>;
type RtdbCompany = Record<string, unknown>;

function apiBaseUrl(): string {
  const raw = process.env.EXPO_PUBLIC_API_URL ?? "";
  const url = raw || (process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}/api` : "");
  const clean = url.replace(/^(https?:\/\/[^/:]+):\d+(\/|$)/, "$1$2");
  return clean.replace(/\/api$/, "");
}

export function CompaniesProvider({ children }: { children: React.ReactNode }) {
  const [companies, setCompanies] = useState<Company[]>([ANY_COMPANY]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // We need data from 4 nodes: companies, online, vehicles, tariffs
    // Only subscribe after Firebase auth is ready (anonymous or real user).
    // onValue returns permission_denied if called before auth token exists.
    let companyData: Record<string, RtdbCompany> = {};
    let onlineData: Record<string, RtdbDriver> = {};
    let vehicleData: Record<string, RtdbVehicle> = {};
    let tariffData: Record<string, unknown> = {};
    let activeDispatchersData: Record<string, Record<string, unknown>> = {};
    let companySettingsData: Record<string, Record<string, unknown>> = {};
    /** Names from GET /api/companies (Admin SDK) — used when RTDB companyProfiles is unreadable. */
    let apiNameById: Record<string, string> = {};
    let loaded = {
      companies: false,
      online: false,
      vehicles: false,
      tariffs: false,
      dispatchers: false,
      settings: false,
    };
    let rtdbUnsubs: Array<() => void> = [];

    function rebuild() {
      if (!loaded.companies || !loaded.online || !loaded.vehicles || !loaded.tariffs) return;

      // ── 1. Build lookups from vehicles collection ────────────────────────
      // Structure can be:
      //   vehicles/{pushId}     = direct vehicle record (has companyId field, vehicleClass, etc.)
      //   vehicles/{companyId}  = sub-collection: { [vehicleNumber]: vehicle record }
      const vehicleNumberToType = new Map<string, VehicleType>();
      // companyId → Set of vehicle types from the vehicles collection (for Away fallback)
      const companyVehicleTypes = new Map<string, Set<VehicleType>>();

      function registerVehicle(companyId: string, vehicleNum: string, cls: string, cap: number, wheelCap: number, make: string, model: string) {
        const vt = classToVehicleType(cls, cap, wheelCap, make, model);
        // Only map vehicleNum → type if we actually know the type (cls is non-empty).
        // If cls is empty we default to Sedan which may be wrong — leave it out of the
        // map so processDriverRecord can fall back to the company's full vehicle type set.
        if (vehicleNum && cls.trim()) vehicleNumberToType.set(vehicleNum.toUpperCase(), vt);
        if (companyId && cls.trim()) {
          if (!companyVehicleTypes.has(companyId)) companyVehicleTypes.set(companyId, new Set());
          companyVehicleTypes.get(companyId)!.add(vt);
        }
      }

      for (const [vKey, v] of Object.entries(vehicleData)) {
        if (!v || typeof v !== "object") continue;
        const rec = v as Record<string, unknown>;

        // Detect if this is a direct vehicle record or a nested sub-collection.
        // Direct records have vehicle-specific fields; sub-collections have object values as children.
        const hasVehicleFields = "vehicleClass" in rec || "vehicleType" in rec ||
          "capacity" in rec || "make" in rec || "vehicleNumber" in rec ||
          "vehiclenumber" in rec || "companyId" in rec || "cofNumber" in rec;

        function extractVehicleFields(r: Record<string, unknown>) {
          const vNum = String(r.vehicleNumber ?? r.vehiclenumber ?? r.VehicleNumber ??
            r.licensePlate ?? r.plate ?? r.registration ?? r.rego ?? "").trim();
          const cls = String(r.vehicleClass ?? r.VehicleClass ?? r.vehicleType ?? r.VehicleType ??
            r.type ?? r.Type ?? r.category ?? r.Category ?? r.class ?? r.Class ??
            r.carType ?? r.CarType ?? r.carClass ?? r.bodyType ?? r.vehicleModel ??
            r.VehicleModel ?? "").trim();
          const cap = Number(r.passengerCapacity ?? r.PassengerCapacity ?? r.capacity ??
            r.Capacity ?? r.seats ?? r.Seats ?? r.maxPassengers ?? 0);
          const wheelCap = Number(r.wheelchairCapacity ?? r.WheelchairCapacity ?? r.wheelchair ??
            r.Wheelchair ?? r.hoist ?? 0);
          const make = String(r.make ?? r.Make ?? r.manufacturer ?? "").trim();
          const model = String(r.model ?? r.Model ?? r.vehicleModel ?? "").trim();
          return { vNum, cls, cap, wheelCap, make, model };
        }

        if (hasVehicleFields) {
          // Direct record: vehicles/{pushId} = vehicle data
          const { vNum, cls, cap, wheelCap, make, model } = extractVehicleFields(rec);
          const coId = String(rec.companyId ?? rec.companyID ?? rec.CompanyId ?? rec.company_id ?? "").trim();
          registerVehicle(coId, vNum, cls, cap, wheelCap, make, model);
        } else {
          // Nested sub-collection: vehicles/{companyId}/{vehicleId} = vehicle data
          const coId = vKey;
          for (const [innerKey, innerVal] of Object.entries(rec)) {
            if (!innerVal || typeof innerVal !== "object") continue;
            const iv = innerVal as Record<string, unknown>;
            const { vNum, cls, cap, wheelCap, make, model } = extractVehicleFields({
              ...iv,
              vehicleNumber: iv.vehicleNumber ?? iv.vehiclenumber ?? innerKey,
            });
            registerVehicle(coId, vNum, cls, cap, wheelCap, make, model);
          }
        }
      }

      // ── 2. Build companyId → Set<VehicleType> from online ───────────────────
      // RTDB structure: online/{companyId}/{vehicleId}/{uid?} = driver record
      // The companyId IS the top-level key — no need to read a CompanyId field.
      const onlineVehiclesByCompany = new Map<string, Set<VehicleType>>();
      const onlineDriverNameByCompany = new Map<string, string>();

      function processDriverRecord(companyId: string, vehicleId: string, driver: RtdbDriver) {
        if (!driver || typeof driver !== "object") return;

        // Some dispatcher systems (e.g. zone-queue style) store the full live driver
        // data inside a nested `current` sub-object, while the top-level `vehiclestatus`
        // reflects zone-queue state only (e.g. "Away" = not queuing, NOT "not working").
        // If `current` has GPS coordinates, the driver IS actively logged in — use that
        // as the source of truth for availability and vehicle metadata.
        const currentRec = (driver.current && typeof driver.current === "object")
          ? driver.current as Record<string, unknown>
          : null;
        const hasActiveCurrent = !!(
          currentRec &&
          (currentRec.lat != null || currentRec.lng != null || currentRec.hasGps === true)
        );

        const vstatus = String(
          driver.vehiclestatus ?? driver.status ?? driver.driverStatus ?? ""
        ).trim().toLowerCase();

        // Explicit "not available" statuses — these always block this driver,
        // even if they have active GPS in their `current` record.
        // "Away" in zone-queue dispatchers means the driver has clocked off or left
        // the queue — they are NOT available for new ASAP rides.
        const UNAVAILABLE_STATUSES = new Set([
          "away", "offline", "inactive", "disabled", "suspended",
          "busy", "onride", "on ride", "break", "onbreak", "lunch",
          "end", "ended", "finished", "0", "false", "no",
        ]);
        const isExplicitlyUnavailable = vstatus !== "" && UNAVAILABLE_STATUSES.has(vstatus);
        const isAvailable = !isExplicitlyUnavailable && (
          hasActiveCurrent ||
          vstatus === "" ||
          vstatus === "available" || vstatus === "online" || vstatus === "active" ||
          vstatus === "free" || vstatus === "idle" || vstatus === "ready" ||
          vstatus === "1" || vstatus === "true"
        );
        if (!isAvailable) return;

        if (!onlineVehiclesByCompany.has(companyId)) {
          onlineVehiclesByCompany.set(companyId, new Set());
        }

        // Use `current` sub-record for metadata when available (zone-queue structure)
        const meta = currentRec ?? (driver as Record<string, unknown>);

        // Store company name hint
        const nameHint = String(
          meta.companyName ?? meta.CompanyName ?? meta.clientName ??
          driver.companyName ?? driver.CompanyName ?? ""
        ).trim();
        if (nameHint && !/^\d+$/.test(nameHint)) {
          onlineDriverNameByCompany.set(companyId, nameHint);
        }

        // vehicleId is the key at this level (e.g. "TAXI01") — use it directly
        const vehicleNum = (vehicleId || String(
          meta.VehicleId ?? meta.vehicleNumber ?? meta.vehiclenumber ??
          driver.VehicleId ?? driver.vehiclenumber ?? driver.vehicleNumber ?? ""
        )).trim().toUpperCase();

        let vt: VehicleType | null = null;
        if (vehicleNum) vt = vehicleNumberToType.get(vehicleNum) ?? null;
        if (!vt) {
          const rawType = String(
            // camelCase variants (common in JS apps)
            meta.vehicleType ?? meta.VehicleType ?? meta.carType ?? meta.CarType ??
            meta.vehicleClass ?? meta.VehicleClass ?? meta.type ?? meta.Type ??
            meta.category ?? meta.class ?? meta.bodyType ??
            // all-lowercase variants (common in older dispatcher systems)
            (meta as any).vehicletype ?? (meta as any).cartype ?? (meta as any).vehicleclass ??
            driver.vehicleType ?? driver.VehicleType ?? driver.carType ??
            driver.vehicleClass ?? driver.VehicleClass ??
            (driver as any).vehicletype ?? (driver as any).cartype ?? (driver as any).vehicleclass ?? ""
          ).trim();
          if (rawType) vt = classToVehicleType(rawType, 4, 0, "", "");
        }
        if (vt) {
          onlineVehiclesByCompany.get(companyId)!.add(vt);
        } else {
          // Can't determine this vehicle's specific type from the driver record.
          // Pick the HIGHEST-CAPACITY type the company has registered rather than
          // adding all types — if a company has a Van, the unknown driver is likely
          // that Van, not a Sedan.
          const CAPACITY_PRIORITY: VehicleType[] = ["Van", "SUV", "Luxury", "Electric", "Wheelchair", "Sedan"];
          const companyTypes = companyVehicleTypes.get(companyId);
          const best = companyTypes && companyTypes.size > 0
            ? (CAPACITY_PRIORITY.find((t) => companyTypes.has(t)) ?? "Sedan")
            : "Sedan";
          onlineVehiclesByCompany.get(companyId)!.add(best);
        }
      }

      for (const [companyId, companyOnline] of Object.entries(onlineData)) {
        if (!companyOnline || typeof companyOnline !== "object") continue;

        for (const [vehicleId, vehicleData2] of Object.entries(companyOnline as Record<string, unknown>)) {
          if (!vehicleData2 || typeof vehicleData2 !== "object") continue;
          const vd = vehicleData2 as Record<string, unknown>;

          // Check if this is a direct driver record (has vehiclestatus field)
          // or a uid-keyed map of driver records
          if ("vehiclestatus" in vd || "lat" in vd || "drivername" in vd || "Email" in vd) {
            // Direct: online/{companyId}/{vehicleId} = driver data
            processDriverRecord(companyId, vehicleId, vd as RtdbDriver);
          } else {
            // Nested: online/{companyId}/{vehicleId}/{uid} = driver data
            for (const [, uidRecord] of Object.entries(vd)) {
              if (uidRecord && typeof uidRecord === "object") {
                processDriverRecord(companyId, vehicleId, uidRecord as RtdbDriver);
              }
            }
          }
        }
      }

      const live: Company[] = [];
      let colorIdx = 1;

      // ── 3. Build company list ─────────────────────────────────────────────
      // Prefer companyProfiles (real tenants). Never surface load-test harness
      // tenants (bwtest*). If profiles are empty/unreadable, fall back to
      // vehicles + online — but still exclude load-test and Firebase push-ids.
      // (Online-only fallback previously promoted bwtest when it was the only
      // public online node and companyProfiles was permission-denied.)
      const profileIds = Object.keys(companyData).filter(looksLikeRealCompanyId);
      const fallbackIds = [
        ...onlineVehiclesByCompany.keys(),
        ...companyVehicleTypes.keys(),
      ].filter(looksLikeRealCompanyId);
      const allCompanyIds = profileIds.length > 0
        ? new Set(profileIds)
        : new Set(fallbackIds);

      for (const id of allCompanyIds) {
        if (isLoadTestCompanyId(id)) continue;
        const liveVehicles = onlineVehiclesByCompany.get(id);
        const hasAvailableDrivers = !!(liveVehicles && liveVehicles.size > 0);

        const data: RtdbCompany = (companyData[id] && typeof companyData[id] === "object")
          ? companyData[id]
          : {};

        // Skip companies explicitly marked inactive/suspended in their profile
        if (Object.keys(data).length > 0) {
          const status = String(data.status ?? data.active ?? "active").toLowerCase();
          if (["inactive","disabled","suspended","false","0"].includes(status)) continue;
        }

        // Resolve name: profile → public API (/api/companies) → online hint → fallback
        // (companyProfiles is often permission-denied for passengers; API uses Admin SDK.)
        let name: string;
        if (Object.keys(data).length > 0) {
          name = resolveName(id, data);
        } else if (apiNameById[id]) {
          name = apiNameById[id];
        } else {
          name = onlineDriverNameByCompany.get(id) ?? `Taxi Co. ${id}`;
        }

        // Resolve vehicle types: from online if available, else from vehicles collection,
        // else from profile, else default Sedan
        const vehicleTypes: VehicleType[] = hasAvailableDrivers
          ? Array.from(liveVehicles!)
          : (() => {
              // First try the vehicles collection (most accurate)
              const fromVehicles = companyVehicleTypes.get(id);
              if (fromVehicles && fromVehicles.size > 0) return Array.from(fromVehicles);
              // Then try profile array fields
              const profileVehicles = data.vehicleTypes ?? data.vehicles ?? data.vehicleClasses;
              if (Array.isArray(profileVehicles) && profileVehicles.length > 0) {
                return (profileVehicles as string[]).map((v) =>
                  classToVehicleType(String(v), 4, 0, "", "")
                );
              }
              return ["Sedan" as VehicleType];
            })();

        // Tariffs — check dedicated RTDB tariffs node first (most accurate).
        // Supported structures:
        //   (A) flat:             tariffs/{id} = { baseFare, pricePerKm, ... }
        //   (B) vehicle-keyed:   tariffs/{id} = { sedan: {...}, van: {...}, ... }
        //   (C) id-keyed records: tariffs/{id} = { 5: { baseFare, pricePerKm, ... }, ... }
        //   (D) nested in profile: data.tariffs / data.pricing / data.rates / ...
        const rtdbTariff = tariffData[id];
        const rtdbTariffObj = (rtdbTariff && typeof rtdbTariff === "object")
          ? rtdbTariff as Record<string, unknown>
          : null;
        const profileTariffObj = (
          data.tariffs ?? data.pricing ?? data.rates ?? data.vehiclePricing ?? data.prices
        );
        const tariffSrc = rtdbTariffObj
          ?? ((profileTariffObj && typeof profileTariffObj === "object") ? profileTariffObj as Record<string, unknown> : null)
          ?? {};

        const vehicleTariffs: Partial<Record<VehicleType, TariffRates>> = {};

        // First, try vehicle-keyed entries (keys look like vehicle types)
        const VEHICLE_KEY_RE = /sedan|car|standard|van|maxi|suv|4wd|luxury|exec|wheel|access|electric|ev/i;
        for (const [key, entry] of Object.entries(tariffSrc)) {
          if (!VEHICLE_KEY_RE.test(key) || !entry || typeof entry !== "object") continue;
          const k = key.toLowerCase();
          let vt: VehicleType | null = null;
          if (k.includes("sedan") || k.includes("car") || k.includes("standard")) vt = "Sedan";
          else if (k.includes("suv") || k.includes("4wd")) vt = "SUV";
          else if (k.includes("van") || k.includes("maxi")) vt = "Van";
          else if (k.includes("luxury") || k.includes("exec")) vt = "Luxury";
          else if (k.includes("wheel") || k.includes("access")) vt = "Wheelchair";
          else if (k.includes("electric") || k.includes("ev")) vt = "Electric";
          if (vt) {
            const t = toTariff(entry as Record<string, unknown>);
            if (t) vehicleTariffs[vt] = t;
          }
        }

        // If no vehicle-keyed tariffs, try flat tariff (structure A)
        if (Object.keys(vehicleTariffs).length === 0) {
          const flat = toTariff(tariffSrc);
          if (flat) {
            for (const vt of vehicleTypes) vehicleTariffs[vt] = flat;
          }
        }

        // If still nothing, try structure C: values are tariff records keyed by an ID (number/push-ID)
        // Pick the best applicable tariff (prefer scheduleType:"always" or allDay:true)
        if (Object.keys(vehicleTariffs).length === 0) {
          const candidates: TariffRates[] = [];
          for (const entry of Object.values(tariffSrc)) {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
            const t = toTariff(entry as Record<string, unknown>);
            if (t) {
              const e = entry as Record<string, unknown>;
              // Prefer always-active tariffs
              const priority = (e.scheduleType === "always" || e.allDay === true) ? 1 : 0;
              candidates.push({ ...t, _priority: priority } as TariffRates & { _priority: number });
            }
          }
          candidates.sort((a, b) => (((b as unknown) as Record<string, unknown>)._priority as number ?? 0) - (((a as unknown) as Record<string, unknown>)._priority as number ?? 0));
          if (candidates.length > 0) {
            const best = candidates[0];
            for (const vt of vehicleTypes) vehicleTariffs[vt] = best;
          }
        }

        // Last resort: company profile as a flat tariff
        if (Object.keys(vehicleTariffs).length === 0) {
          const flatProfile = toTariff(data);
          if (flatProfile) for (const vt of vehicleTypes) vehicleTariffs[vt] = flatProfile;
        }

        const tmCarRaw = data.tmCarTariff ?? data.tm_car_tariff ?? data.tmCar;
        const tmWheelRaw = data.tmWheelchairTariff ?? data.tm_wheelchair_tariff ?? data.tmWheelchair;

        // Owner email — try common field names used by owner panels
        const ownerEmailRaw = String(
          data.email ?? data.ownerEmail ?? data.owner_email ?? data.contactEmail ??
          data.contact_email ?? data.notifyEmail ?? data.notify_email ?? ""
        ).trim();
        const ownerEmail = ownerEmailRaw.includes("@") ? ownerEmailRaw : undefined;


        const settings = (companySettingsData[id] || {}) as Record<string, unknown>;
        const hoursRaw = String(
          settings.operatingHours ??
            settings.operating_hours ??
            data.operatingHours ??
            data.operating_hours ??
            "",
        ).trim();
        const tzRaw = String(
          settings.timezone ??
            settings.timeZone ??
            data.timezone ??
            data.timeZone ??
            data.time_zone ??
            data.tz ??
            "",
        ).trim();
        const timezone = tzRaw.includes("/") ? tzRaw : undefined;
        // Until activeDispatchers has loaded, do not hard-block (avoid flash of offline).
        const dispatchOnline = loaded.dispatchers
          ? isCompanyDispatchOnline(
              (activeDispatchersData[id] || null) as Record<string, Record<string, unknown>> | null,
            )
          : true;
        const asap = asapBookingAllowed({
          dispatchOnline,
          operatingHours: hoursRaw,
          timezone,
          isScheduled: false,
        });

        live.push({
          id,
          name,
          vehicles: vehicleTypes,
          vehicleTariffs: Object.keys(vehicleTariffs).length > 0 ? vehicleTariffs : undefined,
          rating: (data.rating != null || data.averageRating != null)
            ? Number(data.rating ?? data.averageRating)
            : undefined,
          color: String(data.color ?? data.brandColor ?? BRAND_COLORS[colorIdx % BRAND_COLORS.length]),
          tmApproved: Boolean(data.tmApproved ?? data.tm_approved ?? data.totalMobilityApproved ?? false),
          tmCarTariff: tmCarRaw && typeof tmCarRaw === "object"
            ? (toTariff(tmCarRaw as Record<string, unknown>) ?? undefined)
            : undefined,
          tmWheelchairTariff: tmWheelRaw && typeof tmWheelRaw === "object"
            ? (toTariff(tmWheelRaw as Record<string, unknown>) ?? undefined)
            : undefined,
          driversAvailable: hasAvailableDrivers,
          dispatchOnline,
          operatingHours: hoursRaw || undefined,
          asapBookable: asap.allowed,
          ownerEmail,
          timezone: (() => {
            const raw = String(
              data.timezone ?? data.timeZone ?? data.time_zone ?? data.tz ?? timezone ?? ""
            ).trim();
            // Accept only plausible IANA strings (must contain a slash, e.g. "Pacific/Auckland")
            return raw.includes("/") ? raw : timezone;
          })(),
        });
        colorIdx++;
      }

      // Build "Any Available" from the union of all real company vehicles — not hardcoded
      const allRealVehicles = new Set<VehicleType>();
      for (const c of live) c.vehicles.forEach((v) => allRealVehicles.add(v));
      const anyAsap = live.some((c) => c.asapBookable !== false);
      const dynamicAny: Company = {
        ...ANY_COMPANY,
        vehicles: allRealVehicles.size > 0 ? Array.from(allRealVehicles) : ["Sedan"],
        asapBookable: anyAsap,
        dispatchOnline: live.some((c) => c.dispatchOnline),
      };

      setCompanies([dynamicAny, ...live]);
      setLoading(false);
    }

    function subscribeToRtdb() {
      // Tear down any previous subscriptions before re-subscribing
      rtdbUnsubs.forEach((u) => u());
      rtdbUnsubs = [];

      // Reset loaded flags so rebuild waits for core four nodes again
      loaded = {
        companies: false,
        online: false,
        vehicles: false,
        tariffs: false,
        dispatchers: loaded.dispatchers,
        settings: loaded.settings,
      };

      const u1 = onValue(
        ref(rtdb, "companyProfiles"),
        (snap) => { companyData = (snap.val() as Record<string, RtdbCompany>) ?? {}; loaded.companies = true; rebuild(); },
        (err) => { console.warn("[Companies] RTDB error:", err.message); loaded.companies = true; rebuild(); }
      );
      const u2 = onValue(
        ref(rtdb, "online"),
        (snap) => { onlineData = (snap.val() as Record<string, RtdbDriver>) ?? {}; loaded.online = true; rebuild(); },
        (err) => { console.warn("[Online] RTDB error:", err.message); loaded.online = true; rebuild(); }
      );
      const u3 = onValue(
        ref(rtdb, "vehicles"),
        (snap) => { vehicleData = (snap.val() as Record<string, RtdbVehicle>) ?? {}; loaded.vehicles = true; rebuild(); },
        (err) => { console.warn("[Vehicles] RTDB error:", err.message); loaded.vehicles = true; rebuild(); }
      );
      const u4 = onValue(
        ref(rtdb, "tariffs"),
        (snap) => { tariffData = (snap.val() as Record<string, unknown>) ?? {}; loaded.tariffs = true; rebuild(); },
        (err) => { console.warn("[Tariffs] RTDB error:", err.message); loaded.tariffs = true; rebuild(); }
      );
      // ASAP gate: company dispatch console presence (not individual drivers).
      const u5 = onValue(
        ref(rtdb, "activeDispatchers"),
        (snap) => {
          activeDispatchersData = (snap.val() as Record<string, Record<string, unknown>>) ?? {};
          loaded.dispatchers = true;
          rebuild();
        },
        (err) => {
          console.warn("[Dispatchers] RTDB error:", err.message);
          loaded.dispatchers = true;
          rebuild();
        },
      );
      const u6 = onValue(
        ref(rtdb, "companySettings"),
        (snap) => {
          companySettingsData = (snap.val() as Record<string, Record<string, unknown>>) ?? {};
          loaded.settings = true;
          rebuild();
        },
        (err) => {
          console.warn("[CompanySettings] RTDB error:", err.message);
          loaded.settings = true;
          rebuild();
        },
      );
      rtdbUnsubs = [u1, u2, u3, u4, u5, u6];
    }

    // Public company directory (Admin SDK) — reliable names when RTDB profiles are denied.
    let cancelled = false;
    (async () => {
      const base = apiBaseUrl();
      if (!base) return;
      try {
        const res = await fetch(`${base}/api/companies`);
        if (!res.ok) return;
        const json = (await res.json()) as { companies?: Array<{ id?: string; name?: string }> };
        const map: Record<string, string> = {};
        for (const c of json.companies ?? []) {
          const id = String(c.id || "").trim();
          const name = String(c.name || "").trim();
          if (id && name && !isLoadTestCompanyId(id)) map[id] = name;
        }
        if (cancelled) return;
        apiNameById = map;
        rebuild();
      } catch (err) {
        console.warn("[Companies] /api/companies name lookup failed:", err);
      }
    })();

    // Only subscribe once Firebase auth is ready (anonymous or real user).
    // Without an auth token onValue immediately errors with permission_denied.
    let prevUid: string | null = undefined as unknown as string | null;
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      const uid = user?.uid ?? null;
      // Re-subscribe when user changes (sign-in, sign-out, anonymous→real)
      if (uid !== prevUid) {
        prevUid = uid;
        if (uid) {
          subscribeToRtdb();
        } else {
          // No auth yet — wait for anonymous sign-in (triggered by AuthContext)
          rtdbUnsubs.forEach((u) => u());
          rtdbUnsubs = [];
        }
      }
    });

    return () => {
      cancelled = true;
      unsubAuth();
      rtdbUnsubs.forEach((u) => u());
    };
  }, []);

  return (
    <CompaniesContext.Provider value={{ companies, loading }}>
      {children}
    </CompaniesContext.Provider>
  );
}

export function useCompanies(): CompaniesContextType {
  return useContext(CompaniesContext);
}

export function useCompanyById(id: string): Company | undefined {
  const { companies } = useCompanies();
  return companies.find((c) => c.id === id);
}
