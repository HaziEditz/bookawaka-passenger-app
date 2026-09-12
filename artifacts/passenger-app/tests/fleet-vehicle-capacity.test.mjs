/**
 * Passenger booking options stay on the real fleet, with real seat counts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function load(rel) {
  return readFileSync(join(root, rel), "utf8");
}

test("booking UI prints fleet seat counts, not hardcoded Van=8", () => {
  const booking = load("app/booking/index.tsx");
  const constants = load("constants/companies.ts");
  const ctx = load("context/CompaniesContext.tsx");
  assert.match(constants, /export function getVehicleCapacity/);
  assert.match(constants, /vehicleCapacities\?: Partial<Record<VehicleType, number>>/);
  assert.match(ctx, /rememberFleetSeats/);
  assert.match(ctx, /seatCapacity/);
  assert.match(ctx, /vehicleCapacities/);
  assert.match(booking, /getVehicleCapacity\(company, v\)/);
  assert.doesNotMatch(booking, /VEHICLE_CAPACITY\[v\]/);
  assert.match(ctx, /Pricing catalog = fleet registry/);
  assert.doesNotMatch(ctx, /ref\(rtdb, "vehicleTypes"\)/);
});

test("first-tap ASAP later-only copy still present", () => {
  const home = load("app/(tabs)/index.tsx");
  const ux = load("lib/asapDuplicateUx.ts");
  assert.match(home, /beginTaxiBooking/);
  assert.match(ux, /Later booking/);
});
