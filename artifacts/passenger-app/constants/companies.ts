export type VehicleType = "Sedan" | "SUV" | "Van" | "Luxury" | "Wheelchair" | "Electric";

export interface TariffRates {
  baseFare: number;
  perKm: number;
  perMin: number;
  stopFee: number;
}

export interface Vehicle extends TariffRates {
  type: VehicleType;
  label: string;
  capacity: number;
}

export interface Company {
  id: string;
  name: string;
  vehicles: VehicleType[];
  vehicleTariffs?: Partial<Record<VehicleType, TariffRates>>;
  rating?: number;
  color: string;
  isTotalMobility?: boolean;
  tmApproved?: boolean;
  tmCarTariff?: TariffRates;
  tmWheelchairTariff?: TariffRates;
  /** Informational only — never gates ASAP booking (Option 1 pool). */
  driversAvailable?: boolean;
  /**
   * ASAP allowed when company dispatch console is online (activeDispatchers)
   * AND within configured operating hours. Ignores individual driver status.
   */
  asapBookable?: boolean;
  dispatchOnline?: boolean;
  operatingHours?: string;
  ownerEmail?: string;
  /** IANA timezone string, e.g. "Pacific/Auckland", "Australia/Sydney".
   *  Stored in companySettings/{cid}/timezone in Firebase.
   *  All date/time display for this company's rides uses this timezone. */
  timezone?: string;
}

export const VEHICLE_LABELS: Record<VehicleType, string> = {
  Sedan: "Sedan",
  SUV: "SUV",
  Van: "Van",
  Luxury: "Luxury",
  Wheelchair: "Accessible Van",
  Electric: "Electric",
};

export const VEHICLE_CAPACITY: Record<VehicleType, number> = {
  Sedan: 4,
  SUV: 6,
  Van: 8,
  Luxury: 4,
  Wheelchair: 2,
  Electric: 4,
};

export const DEFAULT_TARIFFS: Record<VehicleType, TariffRates> = {
  Sedan:     { baseFare: 5,  perKm: 1.5,  perMin: 0.25, stopFee: 3 },
  SUV:       { baseFare: 6,  perKm: 2.0,  perMin: 0.30, stopFee: 4 },
  Van:       { baseFare: 8,  perKm: 2.5,  perMin: 0.35, stopFee: 5 },
  Luxury:    { baseFare: 12, perKm: 3.5,  perMin: 0.50, stopFee: 6 },
  Wheelchair:{ baseFare: 7,  perKm: 2.0,  perMin: 0.30, stopFee: 4 },
  Electric:  { baseFare: 6,  perKm: 1.8,  perMin: 0.28, stopFee: 3 },
};

export const VEHICLES: Record<VehicleType, Vehicle> = {
  Sedan:     { type: "Sedan",     label: "Sedan",          capacity: 4, ...DEFAULT_TARIFFS.Sedan },
  SUV:       { type: "SUV",       label: "SUV",            capacity: 6, ...DEFAULT_TARIFFS.SUV },
  Van:       { type: "Van",       label: "Van",            capacity: 8, ...DEFAULT_TARIFFS.Van },
  Luxury:    { type: "Luxury",    label: "Luxury",         capacity: 4, ...DEFAULT_TARIFFS.Luxury },
  Wheelchair:{ type: "Wheelchair",label: "Accessible Van", capacity: 2, ...DEFAULT_TARIFFS.Wheelchair },
  Electric:  { type: "Electric",  label: "Electric",       capacity: 4, ...DEFAULT_TARIFFS.Electric },
};

// No mock drivers — the app waits for the real dispatcher to assign a real driver.
export const MOCK_DRIVERS: Record<string, { name: string; rating: number; cab: string; plate: string; color: string }[]> = {};
