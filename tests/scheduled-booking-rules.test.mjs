import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveCreateStatus,
  shouldToastScheduledSuccess,
  isScheduledTabVisible,
  jobPickupLabel,
  jobDropoffLabel,
} from "../artifacts/passenger-app/lib/scheduledBookingRules.ts";
import {
  collectLocalPassengerJobKeys,
  comparePassengerJobsForRecover,
  jobCreatedAtMs,
  keysFromIndexRow,
  mergePassengerJobTrees,
  phoneIndexCandidates,
} from "../artifacts/passenger-app/lib/passengerJobKeyUtils.ts";

describe("scheduled booking payment-first rules", () => {
  it("card ASAP and card scheduled both start as PendingPayment", () => {
    assert.equal(resolveCreateStatus({ payment: "card" }), "PendingPayment");
    assert.equal(
      resolveCreateStatus({ payment: "card", scheduledAt: "2026-09-02T12:00:00.000Z" }),
      "PendingPayment",
    );
  });

  it("cash scheduled is Scheduled; cash ASAP is Waiting", () => {
    assert.equal(
      resolveCreateStatus({ payment: "cash", scheduledAt: "2026-09-02T12:00:00.000Z" }),
      "Scheduled",
    );
    assert.equal(resolveCreateStatus({ payment: "cash" }), "Waiting");
  });

  it("scheduled toast only after create; card also needs payment", () => {
    assert.equal(
      shouldToastScheduledSuccess({
        scheduledAt: "x",
        payment: "cash",
        createSucceeded: true,
        paymentSucceeded: false,
      }),
      true,
    );
    assert.equal(
      shouldToastScheduledSuccess({
        scheduledAt: "x",
        payment: "card",
        createSucceeded: true,
        paymentSucceeded: false,
      }),
      false,
    );
    assert.equal(
      shouldToastScheduledSuccess({
        scheduledAt: "x",
        payment: "card",
        createSucceeded: true,
        paymentSucceeded: true,
      }),
      true,
    );
    assert.equal(
      shouldToastScheduledSuccess({
        scheduledAt: "x",
        payment: "card",
        createSucceeded: false,
        paymentSucceeded: true,
      }),
      false,
    );
  });

  it("Scheduled tab shows Scheduled and future PendingPayment holds", () => {
    const future = Date.now() + 3600_000;
    assert.equal(isScheduledTabVisible({ Status: "Scheduled", ScheduledFor: future }), true);
    assert.equal(isScheduledTabVisible({ Status: "PendingPayment", ScheduledFor: future }), true);
    assert.equal(isScheduledTabVisible({ Status: "Cancelled", ScheduledFor: future }), false);
    assert.equal(isScheduledTabVisible({ Status: "Waiting" }), false);
  });

  it("website-style PickAddress/DropAddress labels are readable", () => {
    assert.equal(
      jobPickupLabel({ PickAddress: "88 Dee Street, Invercargill" }),
      "88 Dee Street, Invercargill",
    );
    assert.equal(
      jobDropoffLabel({ DropAddress: "Invercargill Airport" }),
      "Invercargill Airport",
    );
    assert.equal(jobPickupLabel({ PickupAddress: "App pickup" }), "App pickup");
    assert.equal(jobPickupLabel({}), "—");
  });
});

describe("passenger job tree merge / index keys", () => {
  it("drops guest and web_ keys", () => {
    const keys = collectLocalPassengerJobKeys({
      uid: "AppUid123",
      extra: ["web_abc", "guest", "OtherUid", ""],
    });
    assert.deepEqual(keys.sort(), ["AppUid123", "OtherUid"]);
  });

  it("merges website uid tree into app uid tree by booking id", () => {
    const merged = mergePassengerJobTrees([
      { "8692609991": { Status: "Scheduled", PickupAddress: "from-app", createdAt: 1 } },
      { "8692609992": { Status: "Scheduled", PickAddress: "from-web", createdAt: 2 } },
    ]);
    assert.equal(merged["8692609991"].PickupAddress, "from-app");
    assert.equal(merged["8692609992"].PickAddress, "from-web");
  });

  it("canonical NZ phone is first candidate", () => {
    const c = phoneIndexCandidates("0276698294");
    assert.equal(c[0], "64276698294");
  });

  it("parses website ISO CreatedAt so live ASAP ranks above PendingPayment zombies", () => {
    const websiteAsap = {
      Status: "Pending",
      CreatedAt: "2026-09-12T01:03:04.998Z",
      createdAt: 1789174984998,
    };
    const zombieHold = {
      Status: "PendingPayment",
      CreatedAt: 1788000000000,
      createdAt: 1788000000000,
    };
    assert.ok(jobCreatedAtMs(websiteAsap) > 1e12);
    assert.equal(Number(websiteAsap.CreatedAt), Number.NaN);
    assert.ok(comparePassengerJobsForRecover(websiteAsap, zombieHold) < 0);
    const ranked = [zombieHold, websiteAsap].sort(comparePassengerJobsForRecover);
    assert.equal(ranked[0].Status, "Pending");
  });

  it("index aliases include previous uid", () => {
    const keys = keysFromIndexRow({
      key: "AppUid",
      uid: "AppUid",
      aliases: { AppUid: true, WebUid: true },
    });
    assert.deepEqual(keys.sort(), ["AppUid", "WebUid"]);
  });
});

describe("source contracts", () => {
  it("hydrate ranks recover jobs instead of slicing Number(ISO) NaN", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const ride = readFileSync(
      join(import.meta.dirname, "../artifacts/passenger-app/context/RideContext.tsx"),
      "utf8",
    );
    assert.match(ride, /comparePassengerJobsForRecover/);
    assert.match(ride, /DUPLICATE_ACTIVE_BOOKING/);
    assert.match(ride, /ServiceType: "taxi"/);
    assert.doesNotMatch(ride, /entries\.slice\(0, 30\)/);
    assert.doesNotMatch(ride, /entries\.slice\(0, 15\)/);
  });

  it("blocks ASAP at first tap on Home and booking Now tab", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(import.meta.dirname, "../artifacts/passenger-app");
    const home = readFileSync(join(root, "app/(tabs)/index.tsx"), "utf8");
    const booking = readFileSync(join(root, "app/booking/index.tsx"), "utf8");
    const { activeRideBlocksAsap, ACTIVE_ASAP_LATER_ONLY_MSG } = await import(
      "../artifacts/passenger-app/lib/asapDuplicateUx.ts"
    );
    assert.equal(activeRideBlocksAsap({ status: "searching" }), true);
    assert.equal(activeRideBlocksAsap({ status: "scheduled" }), false);
    assert.equal(activeRideBlocksAsap(null), false);
    assert.match(home, /beginTaxiBooking/);
    assert.match(booking, /asapDuplicateBlocked/);
    assert.match(booking, /ACTIVE_ASAP_LATER_ONLY_MSG/);
    assert.match(booking, /checkActiveAsapBooking/);
    assert.match(ACTIVE_ASAP_LATER_ONLY_MSG, /Later booking/);
  });
});
