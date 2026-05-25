import { DEFAULT_TARIFFS, TariffRates, VehicleType } from "@/constants/companies";

export function calculateFare(
  distanceMeters: number,
  durationSeconds: number,
  vehicleType: VehicleType,
  stopCount: number = 0,
  customRates?: TariffRates
): { total: number; breakdown: { base: number; distance: number; time: number; stops: number } } {
  const rates: TariffRates = customRates ?? DEFAULT_TARIFFS[vehicleType];
  const km = distanceMeters / 1000;
  const minutes = durationSeconds / 60;
  const base = rates.baseFare;
  const distance = km * rates.perKm;
  const time = minutes * rates.perMin;
  const stops = stopCount * rates.stopFee;
  const total = Math.max(base + distance + time + stops, rates.baseFare);
  return {
    total: Math.round(total * 100) / 100,
    breakdown: {
      base: Math.round(base * 100) / 100,
      distance: Math.round(distance * 100) / 100,
      time: Math.round(time * 100) / 100,
      stops: Math.round(stops * 100) / 100,
    },
  };
}

export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}
