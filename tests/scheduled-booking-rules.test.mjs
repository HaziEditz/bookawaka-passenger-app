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
});
