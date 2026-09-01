import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveCreateStatus,
  shouldToastScheduledSuccess,
  isScheduledTabVisible,
} from "../artifacts/passenger-app/lib/scheduledBookingRules.ts";

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
});
