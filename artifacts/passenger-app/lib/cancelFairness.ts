/**
 * Keep in sync with INVT/lib/cancelFairness.cjs — passenger UI preview only.
 * Real money is applied by Dispatch POST /api/cancel.
 * 3-minute grace is NOT implemented (distance tiers only).
 */
export const SUPPORT_EMAIL = "info@bookawaka.com";
export const FULL_PROGRESS_THRESHOLD = 0.6;

export type CancelFairness = {
  canSelfServe: boolean;
  stage: string;
  gpsUnknown: boolean;
  outcome: "refund" | "partial_charge" | "charge" | "free" | "locked";
  title: string;
  detail: string;
  passengerMessage: string;
  confirmMessage: string;
  chargeAmount: number;
  creditAmount: number;
  billableKind: string;
  isTM: boolean;
};

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function formatMoney(n: number): string {
  return `$${roundMoney(n).toFixed(2)}`;
}

function normPay(raw: string): string {
  const s = String(raw || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!s || s === "cash") return "cash";
  if (s === "card" || s === "creditcard" || s === "stripe") return "card";
  if (s === "wallet") return "wallet";
  if (s === "giftcard" || s === "gift") return "gift_card";
  if (s === "account" || s === "businessaccount" || s === "business") return "account";
  if (s === "acc") return "acc";
  if (s === "tm" || s === "totalmobility") return "tm";
  return s || "cash";
}

function prepaid(k: string) {
  return k === "card" || k === "wallet" || k === "gift_card";
}
function accountish(k: string) {
  return k === "account" || k === "acc";
}

function stageOf(status: string, isNoShow = false): string {
  const s = String(status || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (isNoShow || s === "no show" || s === "noshow") return "no_show";
  if (s === "arrived") return "arrived";
  if (s === "active" || s === "ontrip" || s === "on trip" || s === "in progress" || s === "started") return "on_trip";
  if (
    s === "assigned" || s === "accepted" || s === "picking" || s === "enroute" ||
    s === "en route" || s === "on the way" || s === "queued" || s === "confirmed"
  ) return "assigned";
  return "not_assigned";
}

export function computeCancelFairness(input: {
  status: string;
  paymentMethod: string;
  fare: number;
  isTM?: boolean;
  tmPassengerAmount?: number | null;
  remainderPayment?: string;
  progressPct?: number | null;
  gpsUnknown?: boolean;
  dispatcherTriggered?: boolean;
  forSelfServePreview?: boolean;
}): CancelFairness {
  const stage = stageOf(input.status);
  const canSelfServe = stage !== "arrived" && stage !== "on_trip" && stage !== "no_show";
  const isTM = !!input.isTM;
  const billableKind = isTM ? normPay(input.remainderPayment || input.paymentMethod) : normPay(input.paymentMethod);
  const stake = roundMoney(isTM ? (Number(input.tmPassengerAmount) || input.fare) : input.fare);
  const gpsUnknown = !!input.gpsUnknown;
  const progressPct = Number.isFinite(Number(input.progressPct)) ? Number(input.progressPct) : null;

  let chargeFraction = 0;
  if (billableKind === "cash") chargeFraction = 0;
  else if (prepaid(billableKind)) {
    if (stage === "not_assigned") chargeFraction = 0;
    else if (stage === "arrived" || stage === "on_trip" || stage === "no_show") chargeFraction = 1;
    else if (gpsUnknown || progressPct == null) chargeFraction = 0.5;
    else if (progressPct >= FULL_PROGRESS_THRESHOLD) chargeFraction = 1;
    else chargeFraction = 0.5;
  } else if (accountish(billableKind)) {
    chargeFraction = stage === "not_assigned" ? 0 : 1;
  }

  const chargeAmount = roundMoney(stake * chargeFraction);
  const creditAmount = prepaid(billableKind) ? roundMoney(stake - chargeAmount) : 0;

  let outcome: CancelFairness["outcome"] = "free";
  if (!canSelfServe && input.forSelfServePreview) outcome = "locked";
  else if (billableKind === "cash") outcome = "free";
  else if (chargeAmount <= 0 && creditAmount > 0) outcome = "refund";
  else if (chargeAmount > 0 && creditAmount > 0) outcome = "partial_charge";
  else if (chargeAmount > 0) outcome = "charge";

  const prefix = input.dispatcherTriggered ? "Dispatch cancelled this booking. " : "";
  const tm = isTM ? " The council subsidy is never charged on cancel." : "";
  const gpsNote = gpsUnknown && stage === "assigned"
    ? " Driver location was not available, so this is treated as an assigned trip — not a free cancel."
    : "";
  const stakeFmt = formatMoney(stake);
  const chargeFmt = formatMoney(chargeAmount);
  const creditFmt = formatMoney(creditAmount);

  let title = "Cancel ride?";
  let detail = "Your booking will be cancelled.";
  let after = `${prefix}Your booking was cancelled.${tm}`;

  if (outcome === "locked") {
    title = "Cannot cancel";
    detail = "The driver has arrived — cancellation is not available at this stage.";
    after = prefix + detail;
  } else if (billableKind === "cash") {
    detail = "Cash booking — cancelled at no charge. Your driver will be notified.";
    after = `${prefix}Your cash booking was cancelled at no charge.`;
  } else if (stage === "not_assigned" && prepaid(billableKind)) {
    detail = `No driver assigned yet — ${stakeFmt} will be credited to your BookaWaka wallet, not back to your card.${tm}`;
    after = `${prefix}Cancelled before a driver was assigned. ${stakeFmt} has been credited to your BookaWaka wallet (not refunded to your card). Use it on your next trip. For a real card refund, email ${SUPPORT_EMAIL} with this booking ID.${tm}`;
  } else if (stage === "not_assigned") {
    detail = "No driver assigned yet — your booking will be cancelled at no charge.";
    after = `${prefix}Cancelled before a driver was assigned. No charge to your monthly account.${tm}`;
  } else if (outcome === "partial_charge") {
    title = "Cancellation charge applies";
    detail = `Driver is still early.${gpsNote} 50% of ${stakeFmt} (${chargeFmt}) will be charged. ${creditFmt} goes to your BookaWaka wallet.${tm}`;
    after = `${prefix}A driver was assigned.${gpsNote} ${chargeFmt} (50% of ${stakeFmt}) is charged. ${creditFmt} has been credited to your BookaWaka wallet.${tm}`;
  } else if (outcome === "charge" && prepaid(billableKind)) {
    title = "Full fare charged";
    const why = stage === "no_show" ? "This was recorded as a no-show."
      : (stage === "arrived" || stage === "on_trip") ? "The driver had arrived."
      : (gpsUnknown ? "Driver location was not available." : "The driver was 60% or more of the way to pickup.");
    detail = `${why} The full ${stakeFmt} will be charged.${tm}`;
    after = `${prefix}${why} The full ${stakeFmt} has been charged. No wallet credit applies at this stage.${tm}`;
  } else if (outcome === "charge" && accountish(billableKind)) {
    title = "Account charge applies";
    const bill = billableKind === "acc" ? "ACC account" : "monthly account bill";
    detail = `A driver has been assigned. The full ${stakeFmt} will be charged to your ${bill}.${tm}`;
    after = `${prefix}A driver was assigned, so the full ${stakeFmt} will be charged to your ${bill}.${tm}`;
  }

  return {
    canSelfServe,
    stage,
    gpsUnknown: stage === "assigned" ? gpsUnknown : false,
    outcome,
    title,
    detail,
    passengerMessage: after,
    confirmMessage: after,
    chargeAmount,
    creditAmount,
    billableKind,
    isTM,
  };
}

export function bookingTimeCancelRules(kind: string, isTM = false): string {
  const k = normPay(kind);
  if (isTM) {
    return "Cancel any time until the driver arrives. The council subsidy is never charged on cancel. Your remainder follows Card rules if you pay by card (wallet credit before assignment; 50% then 100% after assignment), Account/ACC rules if that, or no charge if cash. Missing GPS is not treated as a free cancel.";
  }
  if (k === "cash") {
    return "Cash bookings can be cancelled at no charge until the driver arrives. Repeated cash cancellations may require card payment in future.";
  }
  if (prepaid(k)) {
    return `Cancel any time until the driver arrives. Before a driver is assigned, the fare is credited to your BookaWaka wallet (not back to your card). After assignment: 50% if the driver is still early; 100% if they are 60% or more of the way to you, have arrived, or if you no-show. Missing GPS is not treated as free. For a real card refund, email ${SUPPORT_EMAIL}.`;
  }
  if (accountish(k)) {
    return "Cancel any time until the driver arrives. No charge before a driver is assigned. After assignment (any later stage, including arrived or no-show), the full fare is billed to your monthly account.";
  }
  return "Cancel any time until the driver arrives.";
}
