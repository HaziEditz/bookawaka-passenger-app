import test from "node:test";
import assert from "node:assert/strict";
import { parseJobStops } from "../lib/parseJobStops.ts";

test("parseJobStops reads Stops array objects", () => {
  const stops = parseJobStops({
    Stops: [{ address: "Countdown Invercargill", lat: -46.41, lng: 168.35 }],
  });
  assert.equal(stops.length, 1);
  assert.equal(stops[0].address, "Countdown Invercargill");
});

test("parseJobStops reads dispatch lat@lng@address= string", () => {
  const stops = parseJobStops({
    Stops: "-46.41@168.35@address=23 Gala Street Invercargill",
  });
  assert.equal(stops.length, 1);
  assert.match(stops[0].address, /23 Gala Street/);
  assert.equal(stops[0].lat, -46.41);
});

test("parseJobStops recovers nextstopdata when Stops missing", () => {
  const stops = parseJobStops({
    nextstopdata: ["88 Dee Street"],
  });
  assert.deepEqual(
    stops.map((s) => s.address),
    ["88 Dee Street"],
  );
});
