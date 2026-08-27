import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  doc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import {
  ref as rtdbRef,
  set as rtdbSet,
  update as rtdbUpdate,
  onValue as rtdbOnValue,
  off as rtdbOff,
  get as rtdbGet,
} from "firebase/database";
import { auth, db, rtdb } from "@/lib/firebase";
import { registerForPushNotificationsAsync } from "@/lib/pushNotifications";
import { MOCK_DRIVERS, VehicleType } from "@/constants/companies";
import { LatLng, PlaceDetail } from "@/lib/googlePlaces";
import { RouteResult } from "@/lib/directions";
import { calculateFare, formatCurrency } from "@/lib/fareCalculator";
import { useNotification } from "./NotificationContext";
import { alertPassengerDriverArrived } from "@/lib/arrivalAlert";
import { createJobId } from "@/lib/jobApi";
import { useAuth } from "@/context/AuthContext";
import {
  createBookingOnServer,
  cancelBookingOnServer,
  editBookingOnServer,
} from "@/lib/bookingApi";

export type RideStatus =
  | "idle"
  | "searching"
  | "scheduled"
  | "confirmed"
  | "on_the_way"
  | "arrived"
  | "in_progress"
  | "completed"
  | "cancelled"
  // Optimistic state: app has sent a cancel request to backend; waiting for confirmation.
  // All listeners remain active — backend writes the final "cancelled" status.
  | "cancel_requested"
  // Driver waited at pickup but passenger didn't appear — ride ended without trip.
  | "no_show";

export type PaymentMethodRide = "card" | "wallet" | "cash" | "account" | "business_account" | "acc" | "gift_card";

export interface TMPassenger {
  id: string;
  cardNumber: string;
  cardholderName: string;
  expiryDate: string;
  needsHoist: boolean;
  councilId?: string;
  /** "camera" = photo was taken; "manual" = number typed. Matches §113 cardCaptureMethod field. */
  cardCaptureMethod?: "camera" | "manual";
  /** Local photo URI — held in memory only until Firebase Storage rules land. Never uploaded yet. */
  cardPhotoUri?: string;
}

export interface Stop {
  id: string;
  place: PlaceDetail;
}

export interface Driver {
  name: string;
  rating: number;
  cab: string;
  plate: string;
  color: string;
  location: LatLng;
}

// What the dispatcher has done with the job so far (passenger-facing queue status)
export type SearchPhase = "writing" | "waiting" | "offered" | "queued";

export interface ActiveRide {
  id: string;
  firestoreId: string;
  pickup: PlaceDetail;
  destination: PlaceDetail;
  stops: Stop[];
  companyId: string;
  vehicleType: VehicleType;
  payment: PaymentMethodRide;
  walletAmountPending?: number;
  fare: number;
  status: RideStatus;
  searchPhase?: SearchPhase;
  driver?: Driver;
  route?: RouteResult;
  promoCode?: string;
  discount?: number;
  scheduledAt?: string;
  rideshare?: boolean;
  passengerCount?: number;
  isTM?: boolean;
  tmPassengers?: TMPassenger[];
  tmCouncilAmount?: number;
  tmPassengerAmount?: number;
  tmHoistCount?: number;
  tmHoistFeeTotal?: number;
  eta?: number | null;
  paymentStatus?: "pending" | "confirmed" | "failed";
  trackingToken?: string;
  // Business Account payment
  businessAccountId?: string;
  businessAccountName?: string;
  purchaseOrderId?: string;
  purchaseOrderNumber?: string;
  // ACC payment
  accClaimNumber?: string;
  accClientId?: string;
  accClientName?: string;
  // Gift Card payment
  giftCardCode?: string;
  giftCardId?: string;
  /** Optional note for the driver / dispatcher (pickup instructions). */
  pickupNote?: string;
  /** 4-digit PIN — show to passenger; tell driver verbally at pickup. */
  pickupPin?: string;
  imComingAt?: string;
  noShowDeadlineAt?: string;
  // Cancellation policy tracking
  acceptedAt?: number;                  // timestamp (ms) when driver was first confirmed
  driverStartDistanceToPickup?: number; // km from driver's position at acceptance to pickup
}

export interface BookingFirestore {
  passengerId: string;
  passengerName: string;
  passengerPhone: string;
  status: RideStatus;
  pickup: { address: string; lat: number; lng: number };
  destination: { address: string; lat: number; lng: number };
  stops: { id: string; address: string; lat: number; lng: number }[];
  companyId: string;
  vehicleType: string;
  estimatedFare: number;
  finalFare?: number;
  paymentMethod: PaymentMethodRide;
  /** Alias for paymentMethod — some dispatcher integrations read this field name */
  paymentType?: string;
  paymentStatus: "pending" | "confirmed" | "failed";
  /** UTC ISO string — e.g. "2026-05-07T09:30:00.000Z". Use this for display with the company TZ. */
  requestedAt?: string;
  scheduledAt?: string | null;
  promoCode?: string | null;
  discount?: number | null;
  rideshare?: boolean;
  passengerCount?: number;
  isTM?: boolean;
  /** Full TM card details — includes cardNumber (voucher), cardholderName, expiryDate, needsHoist */
  tmPassengers?: TMPassenger[];
  /** Council's share of the FARE subsidy (50% up to cap). Does NOT include hoist — see tmHoistFeeTotal. */
  tmCouncilAmount?: number | null;
  /** Passenger's share of the fare after council subsidy. Does NOT include hoist (council covers it). */
  tmPassengerAmount?: number | null;
  tmHoistCount?: number | null;
  /** Council-covered hoist fee total (tmHoistCount × hoistFeePerLift). Separate from fare subsidy. */
  tmHoistFeeTotal?: number | null;
  // Business Account payment fields
  businessAccountId?: string | null;
  businessAccountName?: string | null;
  purchaseOrderId?: string | null;
  purchaseOrderNumber?: string | null;
  // ACC payment fields
  accClaimNumber?: string | null;
  accClientId?: string | null;
  accClientName?: string | null;
  // Gift Card payment fields
  giftCardCode?: string | null;
  giftCardId?: string | null;
  driverName?: string;
  driverPhone?: string;
  driverVehicle?: string;
  driverPlate?: string;
  driverColor?: string;
  driverRating?: number;
  driverLocation?: { lat: number; lng: number } | null;
  driverId?: string;
  eta?: number | null;
  trackingToken: string;
  // Flat aliases required by the shared schema
  phone?: string;
  pickupAddress?: string;
  dropoffAddress?: string;
  /** Alias for pickup — some dispatcher integrations read this field name */
  pickupLocation?: { address: string; lat: number; lng: number };
  /** Alias for destination — some dispatcher integrations read this field name */
  dropoffLocation?: { address: string; lat: number; lng: number };
  // Push notification target — written by passenger app on booking creation
  deviceUid?: string;
  // Server-issued job ID from the central job ID system
  jobId?: string;
  // Written when a cancellation charge is retained (late cancel / no-show)
  chargeReason?: string;
  // Written on any cancellation — identifies who cancelled so driver/dispatcher can distinguish source
  cancelledBy?: "passenger" | "passenger_app" | "driver" | "dispatcher";
  /** UTC ISO string of when the cancellation was recorded */
  cancelledAt?: string;
  createdAt: unknown;
  updatedAt: unknown;
}

interface RideContextType {
  activeRide: ActiveRide | null;
  driverLocation: LatLng | null;
  startRide: (
    params: Omit<ActiveRide, "id" | "firestoreId" | "status">,
    onRetry?: (attempt: number, total: number) => void,
  ) => Promise<string>;
  cancelRide: (cancelOutcome?: "refund" | "free" | "charge", reason?: string) => Promise<void>;
  abortRide: () => void;
  addStop: (stop: Stop) => void;
  completeRide: (rating: number, tip: number) => Promise<void>;
  /** Clear local ride without writing completion (Skip on complete modal). */
  clearRide: () => void;
  setRideStatus: (status: RideStatus) => void;
  /** Mark local ride payment as confirmed after Stripe verify-and-dispatch. */
  markPaymentConfirmed: () => void;
  /** One-shot extension of the no-show wait after driver Arrived. */
  signalImComing: () => Promise<boolean>;
}

const RideContext = createContext<RideContextType | null>(null);

function offsetLatLng(center: LatLng, kmLat: number, kmLng: number): LatLng {
  return {
    latitude: center.latitude + kmLat / 111,
    longitude: center.longitude + kmLng / (111 * Math.cos((center.latitude * Math.PI) / 180)),
  };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function generateToken(): string {
  return Math.random().toString(36).substr(2, 10) + Date.now().toString(36);
}

/** Map server/client payment status strings onto passenger UI enum. */
export function normalizePaymentStatus(
  raw: unknown,
): "pending" | "confirmed" | "failed" | undefined {
  if (raw == null || raw === "") return undefined;
  const s = String(raw).trim().toLowerCase();
  if (!s) return undefined;
  if (s === "failed" || s === "unpaid" || s === "canceled" || s === "cancelled") return "failed";
  // Server Stripe path writes "paid"; passenger UI historically only knew "confirmed".
  if (
    s === "confirmed" ||
    s === "paid" ||
    s === "succeeded" ||
    s === "success" ||
    s === "complete" ||
    s === "completed"
  ) {
    return "confirmed";
  }
  if (s === "pending" || s === "processing" || s === "requires_payment") return "pending";
  return "pending";
}

/** Straight-line distance between two lat/lng points in kilometres (Haversine). */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) *
      Math.cos((b.latitude * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function vehicleMetaLooksUseful(v: Record<string, unknown>): boolean {
  return !!(
    v.registration ||
    v.Registration ||
    v.rego ||
    v.plate ||
    v.Plate ||
    v.make ||
    v.model ||
    v.Make ||
    v.Model
  );
}

function applyVehicleMetaToRide(
  setActiveRide: React.Dispatch<React.SetStateAction<ActiveRide | null>>,
  rawVehicleId: string,
  v: Record<string, unknown>,
) {
  const rego = String(
    v.registration ?? v.Registration ?? v.rego ?? v.Rego ?? v.plate ?? v.Plate ?? "",
  ).trim();
  const makeModel = [v.make ?? v.Make, v.model ?? v.Model].filter(Boolean).join(" ").trim();
  const color = String(v.color ?? v.Colour ?? v.Color ?? "").trim();
  const taxiNum = String(v.taxiNumber ?? v.TaxiNumber ?? v.vehicleNumber ?? v.number ?? "").trim();
  const cabLabel = makeModel || taxiNum || rawVehicleId;
  setActiveRide((prev) => {
    if (!prev?.driver) return prev;
    const plateBlank = !prev.driver.plate || prev.driver.plate === "—";
    const cabBlank =
      !prev.driver.cab ||
      prev.driver.cab === "Vehicle" ||
      prev.driver.cab === rawVehicleId;
    if (!plateBlank && !cabBlank && prev.driver.color) return prev;
    return {
      ...prev,
      driver: {
        ...prev.driver,
        plate: rego || prev.driver.plate,
        cab: cabBlank ? cabLabel || prev.driver.cab : prev.driver.cab || cabLabel,
        color: color || prev.driver.color,
      },
    };
  });
}

/** Enrich driver cab/plate from fleet registry (direct key, uppercase, or scan by taxi number). */
function enrichVehicleFromFleet(
  companyId: string,
  rawVehicleId: string,
  setActiveRide: React.Dispatch<React.SetStateAction<ActiveRide | null>>,
) {
  const id = String(rawVehicleId || "").trim();
  if (!companyId || !id || id === "Vehicle" || id === "—") return;

  const tryApply = (snap: { exists: () => boolean; val: () => unknown }) => {
    if (!snap.exists()) return false;
    const v = snap.val() as Record<string, unknown>;
    if (!v || typeof v !== "object") return false;
    if (!vehicleMetaLooksUseful(v)) return false;
    applyVehicleMetaToRide(setActiveRide, id, v);
    return true;
  };

  const upper = id.toUpperCase();
  rtdbGet(rtdbRef(rtdb, `vehicles/${companyId}/${id}`))
    .then(async (vehSnap) => {
      if (tryApply(vehSnap)) return;
      if (upper !== id) {
        const upSnap = await rtdbGet(rtdbRef(rtdb, `vehicles/${companyId}/${upper}`));
        if (tryApply(upSnap)) return;
      }
      // Scan company fleet for matching key / taxiNumber / plate
      const allSnap = await rtdbGet(rtdbRef(rtdb, `vehicles/${companyId}`));
      if (!allSnap.exists()) return;
      const registry = allSnap.val() as Record<string, Record<string, unknown>>;
      if (!registry || typeof registry !== "object") return;
      const needle = upper;
      for (const [key, meta] of Object.entries(registry)) {
        if (!meta || typeof meta !== "object") continue;
        const candidates = [
          key,
          String(meta.taxiNumber ?? ""),
          String(meta.TaxiNumber ?? ""),
          String(meta.vehicleNumber ?? ""),
          String(meta.number ?? ""),
          String(meta.plate ?? ""),
          String(meta.registration ?? ""),
        ].map((x) => x.trim().toUpperCase());
        if (candidates.includes(needle)) {
          applyVehicleMetaToRide(setActiveRide, id, meta);
          return;
        }
      }
    })
    .catch(() => {});
}

export interface CancelPolicy {
  /**
   * "refund"  — fare credited to wallet (card/wallet/gift_card under 70%)
   * "charge"  — real charge applies; account types always; card/wallet/gift_card past 70%
   * "free"    — cash always; account types with no driver yet
   * "locked"  — cancellation blocked (arrived / in_progress / no_show)
   */
  outcome: "refund" | "charge" | "free" | "locked";
  title: string;
  detail: string;
  canCancel: boolean;
}

/**
 * Pure function — compute what happens if the passenger cancels right now.
 *
 * Single rule: 70% driver distance to pickup (no time window).
 *
 * Cash → always free, any distance.
 * Card / wallet / gift_card:
 *   under 70% → "refund" (fare credited to wallet, NOT returned to card)
 *   over  70% → "charge" (full fare retained / Stripe captured)
 * Account / business_account / ACC:
 *   driver assigned → "charge" (invoiced) regardless of distance
 *   no driver yet   → "free"
 *
 * TM: council NEVER charged. Only passenger co-payment is at stake.
 *   Cash TM → always free.
 *   Card/wallet/gift_card TM: under 70% → wallet credit; over 70% → charge passenger %.
 *   Account/ACC/business_account TM: always charge passenger % (never council %).
 *
 * No-show (driver waited 5 min at pickup): handled server-side; app receives "no_show" status.
 * Same charge rules as "over 70%" apply — server processes payment, app shows notification.
 */
export function computeCancelPolicy(
  status: RideStatus,
  payment: PaymentMethodRide,
  fare: number,
  acceptedAt: number | undefined,   // kept for API compat but no longer used for timing
  driverDistancePct: number,
  isTM = false,
  tmPassengerAmount?: number | null,
): CancelPolicy {
  const fmtFare = formatCurrency(fare);
  const fmtPassAmt = tmPassengerAmount ? formatCurrency(tmPassengerAmount) : fmtFare;
  const pct = Math.round(driverDistancePct * 100);

  const isCash       = payment === "cash";
  const isCardWallet = payment === "card" || payment === "wallet" || payment === "gift_card";

  // ── Locked states ────────────────────────────────────────────────────────
  if (status === "arrived" || status === "in_progress" || status === "no_show") {
    return {
      outcome: "locked",
      title: "Cannot Cancel",
      detail: "The driver has arrived — cancellation is not available at this stage.",
      canCancel: false,
    };
  }
  if (status === "cancel_requested") {
    return {
      outcome: "locked",
      title: "Cancellation Requested",
      detail: "Your cancellation request has been sent. Waiting for confirmation.",
      canCancel: false,
    };
  }
  if (status === "cancelled") {
    return {
      outcome: "locked",
      title: "Booking Cancelled",
      detail: "This booking was cancelled by the operator.",
      canCancel: false,
    };
  }

  // ── No driver yet ────────────────────────────────────────────────────────
  if (status === "searching" || status === "scheduled") {
    if (isCardWallet) {
      return {
        outcome: "refund",
        title: "Cancel Ride?",
        detail: `No driver assigned yet — your ${isTM ? fmtPassAmt : fmtFare} will be credited to your wallet.`,
        canCancel: true,
      };
    }
    return {
      outcome: "free",
      title: "Cancel Ride?",
      detail: "No driver assigned yet — your booking will be cancelled at no charge.",
      canCancel: true,
    };
  }

  // ── Driver assigned — cash is always free ────────────────────────────────
  if (isCash) {
    return {
      outcome: "free",
      title: "Cancel Ride?",
      detail: "Cash booking — cancelled at no charge. Your driver will be notified.",
      canCancel: true,
    };
  }

  // ── TM rides (council never charged) ─────────────────────────────────────
  if (isTM) {
    if (driverDistancePct < 0.7) {
      if (isCardWallet) {
        return {
          outcome: "refund",
          title: "Cancel TM Ride?",
          detail: `Driver is ${pct}% of the way — within free-cancel distance. Your passenger co-payment of ${fmtPassAmt} will be credited to your wallet. No council charge.`,
          canCancel: true,
        };
      }
      return {
        outcome: "charge",
        title: "TM Co-payment Applies",
        detail: `A driver has been dispatched. Your passenger co-payment of ${fmtPassAmt} will be charged to your account. No council charge.`,
        canCancel: true,
      };
    }
    // Over 70%
    if (isCardWallet) {
      return {
        outcome: "charge",
        title: "TM Co-payment Applies",
        detail: `Driver is ${pct}% of the way. Your passenger co-payment of ${fmtPassAmt} will be charged. No council charge.`,
        canCancel: true,
      };
    }
    return {
      outcome: "charge",
      title: "TM Co-payment Applies",
      detail: `Driver is ${pct}% of the way. Your passenger co-payment of ${fmtPassAmt} will be charged to your account. No council charge.`,
      canCancel: true,
    };
  }

  // ── Standard (non-TM) rides ──────────────────────────────────────────────
  if (driverDistancePct < 0.7) {
    if (isCardWallet) {
      return {
        outcome: "refund",
        title: "Cancel Ride?",
        detail: `Driver is ${pct}% of the way — within free-cancel distance. Your ${fmtFare} fare will be credited to your wallet for your next ride (no refund to original payment).`,
        canCancel: true,
      };
    }
    // Account / business_account / ACC — charged even under 70%
    return {
      outcome: "charge",
      title: "Cancellation Fee Applies",
      detail: `A driver has been dispatched to you. Your ${fmtFare} fare will be charged to your account.`,
      canCancel: true,
    };
  }

  // Over 70% — full charge for all non-cash
  return {
    outcome: "charge",
    title: "Cancellation Fee Applies",
    detail: `Driver is ${pct}% of the way — your ${fmtFare} fare will be charged in full. The driver is already on the way and will be paid.`,
    canCancel: true,
  };
}

function RideProviderInner({ children }: { children: React.ReactNode }) {
  const { notify } = useNotification();
  const { updateWallet, user: authUser } = useAuth();
  const [activeRide, setActiveRide] = useState<ActiveRide | null>(null);
  const [driverLocation, setDriverLocation] = useState<LatLng | null>(null);
  const simulationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mockDriverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressRef = useRef(0);
  const firestoreUnsubRef = useRef<(() => void) | null>(null);
  const rtdbJobRef = useRef<ReturnType<typeof rtdbRef> | null>(null);
  const rtdbAllbookingsRef = useRef<ReturnType<typeof rtdbRef> | null>(null);
  const rtdbRideStatusRef = useRef<ReturnType<typeof rtdbRef> | null>(null);
  const gpsListenerRef = useRef<ReturnType<typeof rtdbRef> | null>(null);
  const dispatchOverrideRef = useRef(false);
  const activeRideRef = useRef<ActiveRide | null>(null);
  activeRideRef.current = activeRide;
  // Stores the pending job immediately after IDs are allocated — before React state settles —
  // so abortRide can cancel RTDB even if activeRide state hasn't propagated yet.
  const pendingJobRef = useRef<{ companyId: string; jobId: string } | null>(null);

  // Holds payment context while a cancel request is in-flight (status = "cancel_requested").
  // Cleared the moment backend confirms "cancelled". Used to apply wallet credit/refund
  // only after backend confirmation — never assumed locally.
  const pendingCancelRef = useRef<{
    payment: PaymentMethodRide;
    fare: number;
    isTM: boolean;
    tmPassengerAmount?: number | null;
    outcome: "refund" | "free" | "charge";
  } | null>(null);

  const stopMockDriverTimer = () => {
    if (mockDriverTimerRef.current) {
      clearTimeout(mockDriverTimerRef.current);
      mockDriverTimerRef.current = null;
    }
  };

  const stopSimulation = () => {
    if (simulationRef.current) {
      clearInterval(simulationRef.current);
      simulationRef.current = null;
    }
  };

  const stopFirestoreListener = () => {
    if (firestoreUnsubRef.current) {
      firestoreUnsubRef.current();
      firestoreUnsubRef.current = null;
    }
  };

  const stopRtdbJobListener = () => {
    if (rtdbJobRef.current) {
      rtdbOff(rtdbJobRef.current);
      rtdbJobRef.current = null;
    }
    if (rtdbAllbookingsRef.current) {
      rtdbOff(rtdbAllbookingsRef.current);
      rtdbAllbookingsRef.current = null;
    }
    if (rtdbRideStatusRef.current) {
      rtdbOff(rtdbRideStatusRef.current);
      rtdbRideStatusRef.current = null;
    }
    if (gpsListenerRef.current) {
      rtdbOff(gpsListenerRef.current);
      gpsListenerRef.current = null;
    }
  };

  const startDriverSimulation = useCallback((pickup: LatLng, destination: LatLng) => {
    stopSimulation();
    progressRef.current = 0;
    const startLoc = offsetLatLng(pickup, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2);
    setDriverLocation(startLoc);

    simulationRef.current = setInterval(() => {
      if (dispatchOverrideRef.current) return;
      setActiveRide((prev) => {
        if (!prev) return prev;

        if (prev.status === "on_the_way" || prev.status === "confirmed") {
          // Only increment while actually simulating the pickup leg
          progressRef.current += 0.05;
          const t = Math.min(progressRef.current, 1);
          const newLoc = {
            latitude: lerp(startLoc.latitude, pickup.latitude, t),
            longitude: lerp(startLoc.longitude, pickup.longitude, t),
          };
          setDriverLocation(newLoc);

          if (t >= 1) {
            progressRef.current = 0;  // reset for the in_progress leg
            setTimeout(() => {
              notify("Driver Arrived", `${prev.driver?.name} is waiting at your pickup.`, "success");
              void alertPassengerDriverArrived();
            }, 0);
            // Simulation is display-only — do NOT write status to Firestore/RTDB.
            // Backend/dispatcher owns all status transitions.
            return { ...prev, status: "arrived" };
          }
        } else if (prev.status === "in_progress") {
          // Only increment while actually simulating the trip leg.
          // progressRef is reset to 0 when we transition arrived → in_progress,
          // so there is no carry-over from the waiting time at pickup.
          progressRef.current += 0.05;
          const t = Math.min(progressRef.current, 1);
          const newLoc = {
            latitude: lerp(pickup.latitude, destination.latitude, t),
            longitude: lerp(pickup.longitude, destination.longitude, t),
          };
          setDriverLocation(newLoc);

          if (t >= 1) {
            stopSimulation();
            setTimeout(() => notify("You've Arrived!", "Please rate your driver.", "success"), 0);
            // Simulation is display-only — do NOT write status to Firestore/RTDB.
            // Backend/dispatcher owns all status transitions.
            return { ...prev, status: "completed" };
          }
        }
        // "arrived" and all other statuses — do nothing, keep waiting for real status update
        return prev;
      });
    }, 800);
  }, [notify]);

  async function updateFirestoreStatus(companyId: string, firestoreId: string, status: RideStatus, extra?: Partial<BookingFirestore>) {
    if (!firestoreId) return;
    try {
      await updateDoc(doc(db, "allbookings", companyId, "rides", firestoreId), {
        status,
        updatedAt: serverTimestamp(),
        ...extra,
      });
    } catch (e) {
      console.warn("Firestore booking update failed:", e);
    }
  }

  const listenToRideStatus = useCallback((companyId: string, firestoreId: string, pickup: LatLng, destination: LatLng) => {
    stopFirestoreListener();
    const unsub = onSnapshot(
      doc(db, "rideStatus", companyId, "rides", firestoreId),
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as BookingFirestore;

        if (data.driverLocation) {
          dispatchOverrideRef.current = true;
          setDriverLocation({
            latitude: data.driverLocation.lat,
            longitude: data.driverLocation.lng,
          });
        }

        if (data.eta !== undefined) {
          setActiveRide((prev) => prev ? { ...prev, eta: data.eta } : prev);
        }

        if (data.paymentStatus) {
          const normalized = normalizePaymentStatus(data.paymentStatus);
          if (normalized) {
            setActiveRide((prev) => (prev ? { ...prev, paymentStatus: normalized } : prev));
          }
        }

        if (data.driverName) {
          setActiveRide((prev) => {
            if (!prev) return prev;
            if (!prev.driver || prev.driver.name !== data.driverName) {
              // vehicleId comes from dispatch; fall back to whatever we already have
              const vehicleLabel = (data as any).vehicleId ?? prev.driver?.cab ?? "Vehicle";
              const dispatchDriver: Driver = {
                name: data.driverName!,
                rating: prev.driver?.rating ?? 4.8,
                cab: vehicleLabel,
                plate: prev.driver?.plate ?? "—",
                color: prev.driver?.color ?? "",
                location: data.driverLocation
                  ? { latitude: data.driverLocation.lat, longitude: data.driverLocation.lng }
                  : prev.driver?.location ?? pickup,
              };
              const dispatchLoc = dispatchDriver.location;
              const startDist = haversineKm(dispatchLoc, pickup);
              // Enrich fleet details asynchronously (same path as RTDB assign)
              const vid = String((data as any).vehicleId ?? "").trim();
              if (vid && vid !== "Vehicle") {
                enrichVehicleFromFleet(companyId, vid, setActiveRide);
              }
              return {
                ...prev,
                driver: dispatchDriver,
                status: prev.status === "searching" ? "confirmed" : prev.status,
                acceptedAt: prev.acceptedAt ?? Date.now(),
                driverStartDistanceToPickup:
                  prev.driverStartDistanceToPickup ?? (startDist > 0.01 ? startDist : 1),
              };
            }
            // Name already set — still try vehicle enrich if plate/cab blank
            const vid = String((data as any).vehicleId ?? prev.driver?.cab ?? "").trim();
            if (
              vid &&
              vid !== "Vehicle" &&
              (!prev.driver.plate || prev.driver.plate === "—" || prev.driver.cab === "Vehicle" || prev.driver.cab === vid)
            ) {
              enrichVehicleFromFleet(companyId, vid, setActiveRide);
            }
            return prev;
          });
        }

        // Map dispatcher status strings → internal RideStatus
        const RAW_STATUS_MAP: Record<string, RideStatus> = {
          Offered:    "confirmed",
          Picking:    "on_the_way",
          Busy:       "in_progress",
          // also accept our own internal strings in case dispatch uses them
          confirmed:  "confirmed",
          on_the_way: "on_the_way",
          in_progress:"in_progress",
          completed:  "completed",
          cancelled:  "cancelled",
        };

        const rawStatus = data.status as string | undefined;
        if (rawStatus && rawStatus !== "pending" && rawStatus !== "searching") {
          const mapped = RAW_STATUS_MAP[rawStatus];
          if (mapped) {
            setActiveRide((prev) => {
              if (!prev || prev.status === mapped) return prev;
              if (mapped === "on_the_way" && !dispatchOverrideRef.current) return prev;
              return { ...prev, status: mapped };
            });
          }
        }

        // Recall detection — dispatcher backend writes RecallStatus: "Recalled" to rideStatus
        const recallStatus = (data as any).RecallStatus as string | undefined;
        if (recallStatus === "Recalled") {
          notify(
            "Driver Recalled",
            "Your driver had to return your booking to queue. A new driver will be allocated shortly.",
            "warning"
          );
          stopMockDriverTimer();
          stopSimulation();
          dispatchOverrideRef.current = false;
          // Reset to searching state — clear driver, ETA
          setActiveRide((prev) => {
            if (!prev) return prev;
            // Re-run mock simulation after a short delay as fallback
            setTimeout(() => startDriverSimulation(pickup, destination), 4000);
            return { ...prev, status: "searching", driver: undefined, eta: null };
          });
        }
      },
      (err) => console.warn("Booking listener error:", err.message)
    );
    firestoreUnsubRef.current = unsub;
  }, [notify]);

  const startRide = async (
    params: Omit<ActiveRide, "id" | "firestoreId" | "status">,
    onRetry?: (attempt: number, total: number) => void,
  ): Promise<string> => {
    const trackingToken = generateToken();
    dispatchOverrideRef.current = false;

    // ── Get a server-issued job ID ──────────────────────────────────────────
    // createJobId tries the central API 3 times, then falls back to a locally-
    // generated ID in the exact super admin format for dev/testing. When the
    // API goes live it always responds first and the fallback is never reached.
    const fbUser = auth.currentUser;
    const jobId = await createJobId(
      {
        companyId: params.companyId,
        passenger: {
          name: fbUser?.displayName ?? "Passenger",
          phone: authUser?.phone || fbUser?.phoneNumber || "",
        },
        pickup: {
          address: params.pickup.address,
          lat: params.pickup.location.latitude,
          lng: params.pickup.location.longitude,
        },
        dropoff: {
          address: params.destination.address,
          lat: params.destination.location.latitude,
          lng: params.destination.location.longitude,
        },
        tariffId: params.vehicleType,
        notes: params.pickupNote ?? "",
      },
      onRetry,
    );

    const id = jobId;
    const firestoreId = jobId;
    const pickupPin = String(Math.floor(Math.random() * 9000) + 1000);

    // Store immediately in a ref so abortRide can cancel RTDB even before state settles
    pendingJobRef.current = { companyId: params.companyId, jobId: firestoreId };

    const ride: ActiveRide = {
      ...params,
      id,
      firestoreId,
      status: "searching",
      eta: null,
      paymentStatus: "pending",
      trackingToken,
      pickupPin,
    };
    if (!params.scheduledAt) {
      setActiveRide(ride);
      // Card holds: don't claim "searching" until Stripe confirms — payment can still fail.
      if (params.payment !== "card") {
        notify("Searching for driver...", "Looking for the nearest driver for you.", "info");
      }
    } else {
      notify("Ride Scheduled!", "Your booking is saved — we'll dispatch before your pickup time.", "success");
    }

    const passengerPhone =
      String(authUser?.phone || fbUser?.phoneNumber || "").trim();

    const bookingData: BookingFirestore = {
      // Core identity fields
      passengerId: fbUser?.uid ?? "guest",
      passengerName: authUser?.name ?? fbUser?.displayName ?? "Passenger",
      passengerPhone,
      // Flat aliases — required by shared schema (other Repls read these exact names)
      phone: passengerPhone,
      pickupAddress: params.pickup.address,
      dropoffAddress: params.destination.address,
      status: params.scheduledAt ? "scheduled" : "searching",
      // Full nested location objects (for the passenger app & mapping)
      pickup: {
        address: params.pickup.address,
        lat: params.pickup.location.latitude,
        lng: params.pickup.location.longitude,
      },
      destination: {
        address: params.destination.address,
        lat: params.destination.location.latitude,
        lng: params.destination.location.longitude,
      },
      stops: params.stops.map((s) => ({
        id: s.id,
        address: s.place.address,
        lat: s.place.location.latitude,
        lng: s.place.location.longitude,
      })),
      companyId: params.companyId,
      vehicleType: params.vehicleType,
      estimatedFare: params.fare,
      paymentMethod: params.payment,
      paymentStatus: "pending",
      scheduledAt: params.scheduledAt ?? null,
      promoCode: params.promoCode ?? null,
      discount: params.discount ?? null,
      rideshare: params.rideshare ?? false,
      passengerCount: params.passengerCount ?? 1,
      isTM: params.isTM ?? false,
      // TM card details — omit entirely when not a TM booking so Firestore
      // never receives an undefined field value (which it rejects with an error)
      ...(params.tmPassengers && params.tmPassengers.length > 0
        ? { tmPassengers: params.tmPassengers }
        : {}),
      // tmCouncilAmount = fare subsidy only. tmHoistFeeTotal = council-covered hoist. Both go on council's claim.
      tmCouncilAmount: params.tmCouncilAmount ?? null,
      // tmPassengerAmount = passenger's share of fare only (hoist is council-covered, NOT added here)
      tmPassengerAmount: params.tmPassengerAmount ?? null,
      tmHoistCount: params.tmHoistCount ?? null,
      tmHoistFeeTotal: params.tmHoistFeeTotal ?? null,
      // Timestamp aliases — requestedAt is a UTC ISO string for timezone-safe display
      requestedAt: new Date().toISOString(),
      // Location aliases used by some dispatcher integrations
      pickupLocation: {
        address: params.pickup.address,
        lat: params.pickup.location.latitude,
        lng: params.pickup.location.longitude,
      },
      dropoffLocation: {
        address: params.destination.address,
        lat: params.destination.location.latitude,
        lng: params.destination.location.longitude,
      },
      // Payment aliases
      paymentType: params.payment,
      // Business Account
      businessAccountId: params.businessAccountId ?? null,
      businessAccountName: params.businessAccountName ?? null,
      purchaseOrderId: params.purchaseOrderId ?? null,
      purchaseOrderNumber: params.purchaseOrderNumber ?? null,
      // ACC
      accClaimNumber: params.accClaimNumber ?? null,
      accClientId: params.accClientId ?? null,
      accClientName: params.accClientName ?? null,
      // Gift Card
      giftCardCode: params.giftCardCode ?? null,
      giftCardId: params.giftCardId ?? null,
      eta: null,
      driverLocation: null,
      trackingToken,
      jobId,
      // createdAt / updatedAt are set by the API server using server-side timestamps
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const companyId = params.companyId;
    const passengerUid = fbUser?.uid ?? "guest";

    // ── Build RTDB job payload ────────────────────────────────────────────
    // Sent to the API server which writes to all required Firebase paths.
    const rtdbJobData = {
      // Identity
      Id: firestoreId,
      jobId: firestoreId,
      CompanyId: companyId,
      Source: "PassengerApp",
      BookingSource: "PassengerApp",
      CreatedBy: "APP",
      PickupPin: pickupPin,
      pickupPin,
      // Status logic:
      //   Scheduled → future booking, held for timed dispatch
      //   PendingPayment → card booking, held until Stripe payment is confirmed
      //   Waiting → cash/wallet/account, dispatch immediately
      Status: params.scheduledAt ? "Scheduled" : params.payment === "card" ? "PendingPayment" : "Waiting",
      status: params.scheduledAt ? "Scheduled" : params.payment === "card" ? "PendingPayment" : "Waiting",
      // Passenger
      PassengerName: authUser?.name ?? fbUser?.displayName ?? "Passenger",
      passengerName: authUser?.name ?? fbUser?.displayName ?? "Passenger",
      PhoneNo: passengerPhone,
      phone: passengerPhone,
      passengerPhone,
      passengerId: passengerUid,
      // Pickup
      PickupAddress: params.pickup.address,
      pickupAddress: params.pickup.address,
      PickupLat: params.pickup.location.latitude,
      PickupLng: params.pickup.location.longitude,
      pickupLat: params.pickup.location.latitude,
      pickupLng: params.pickup.location.longitude,
      // Dropoff
      DropoffAddress: params.destination.address,
      dropoffAddress: params.destination.address,
      DropoffLat: params.destination.location.latitude,
      DropoffLng: params.destination.location.longitude,
      dropoffLat: params.destination.location.latitude,
      dropoffLng: params.destination.location.longitude,
      // Booking details
      VehicleType: params.vehicleType,
      vehicleType: params.vehicleType,
      EstimatedFare: params.fare,
      estimatedFare: params.fare,
      PaymentMethod: params.payment,
      paymentMethod: params.payment,
      ...(params.pickupNote && params.pickupNote.trim()
        ? {
            Notes: params.pickupNote.trim(),
            notes: params.pickupNote.trim(),
            Info: params.pickupNote.trim(),
            PickupNote: params.pickupNote.trim(),
            pickupNote: params.pickupNote.trim(),
          }
        : {}),
      // Card + known fare/dropoff → Fixed (no live meter), matching website bookings.ts.
      ...(params.payment === "card" && typeof params.fare === "number" && params.fare > 0
        ? {
            TarriffId: "-1",
            TariffId: "-1",
            tariffId: "-1",
            TarriffType: "Fixed",
            TariffType: "Fixed",
            TariffName: "Fixed",
            tariffName: "Fixed",
            CustomeRate: params.fare,
            Fare: String(params.fare),
            isFixedPrice: true,
          }
        : {}),
      ...(params.walletAmountPending && params.walletAmountPending > 0
        ? {
            walletAmountPending: params.walletAmountPending,
            WalletAmountPending: params.walletAmountPending,
          }
        : {}),
      ...(params.payment === "card"
        ? { paymentStatus: "pending", PaymentStatus: "pending" }
        : {}),
      // Business Account (written when payment === "business_account")
      ...(params.businessAccountId ? {
        BusinessAccountId: params.businessAccountId,
        businessAccountId: params.businessAccountId,
        BusinessAccountName: params.businessAccountName ?? "",
        businessAccountName: params.businessAccountName ?? "",
        PurchaseOrderId: params.purchaseOrderId ?? "",
        purchaseOrderId: params.purchaseOrderId ?? "",
        PurchaseOrderNumber: params.purchaseOrderNumber ?? "",
        purchaseOrderNumber: params.purchaseOrderNumber ?? "",
      } : {}),
      // ACC (written when payment === "acc")
      ...(params.accClaimNumber ? {
        AccClaimNumber: params.accClaimNumber,
        accClaimNumber: params.accClaimNumber,
        AccClientId: params.accClientId ?? "",
        accClientId: params.accClientId ?? "",
        AccClientName: params.accClientName ?? "",
        accClientName: params.accClientName ?? "",
      } : {}),
      // Gift Card (written when payment === "gift_card")
      ...(params.giftCardCode ? {
        GiftCardCode: params.giftCardCode,
        giftCardCode: params.giftCardCode,
        GiftCardId: params.giftCardId ?? "",
        giftCardId: params.giftCardId ?? "",
      } : {}),
      // TM card details (PascalCase + camelCase for dispatcher compatibility)
      // cardNumber on each entry is the TM voucher number
      ...(params.tmPassengers && params.tmPassengers.length > 0 ? {
        TmPassengers: params.tmPassengers,
        tmPassengers: params.tmPassengers,
        // Flat array of voucher/card numbers for easy dispatcher lookup
        TmVoucherNumbers: params.tmPassengers.map((p) => p.cardNumber),
        tmVoucherNumbers: params.tmPassengers.map((p) => p.cardNumber),
        // Flat array of council IDs — one per passenger, for subsidy calc
        TmCouncilIds: params.tmPassengers.map((p) => p.councilId ?? null),
        tmCouncilIds: params.tmPassengers.map((p) => p.councilId ?? null),
        // §113 — how the first (primary) TM card was captured; "manual" is the safe fallback
        CardCaptureMethod: params.tmPassengers[0]?.cardCaptureMethod ?? "manual",
        cardCaptureMethod: params.tmPassengers[0]?.cardCaptureMethod ?? "manual",
      } : {}),
      // tmHoistFeeTotal = council-covered hoist (separate from fare subsidy, both go on council claim)
      ...(params.tmHoistFeeTotal != null ? {
        TmHoistFeeTotal: params.tmHoistFeeTotal,
        tmHoistFeeTotal: params.tmHoistFeeTotal,
      } : {}),
      // Location aliases used by some dispatcher integrations
      PickupLocation: { address: params.pickup.address, lat: params.pickup.location.latitude, lng: params.pickup.location.longitude },
      pickupLocation: { address: params.pickup.address, lat: params.pickup.location.latitude, lng: params.pickup.location.longitude },
      DropoffLocation: { address: params.destination.address, lat: params.destination.location.latitude, lng: params.destination.location.longitude },
      dropoffLocation: { address: params.destination.address, lat: params.destination.location.latitude, lng: params.destination.location.longitude },
      // Payment type alias
      PaymentType: params.payment,
      paymentType: params.payment,
      // Timestamps — requestedAt is a UTC ISO string; CreatedAt/createdAt kept as ms for legacy dispatcher compat
      RequestedAt: new Date().toISOString(),
      requestedAt: new Date().toISOString(),
      CreatedAt: Date.now(),
      createdAt: Date.now(),
      // Scheduled booking fields (omitted for immediate jobs)
      ...(params.scheduledAt
        ? {
            ScheduledFor: new Date(params.scheduledAt).getTime(),
            scheduledFor: new Date(params.scheduledAt).getTime(),
            ScheduledAt: params.scheduledAt,
            scheduledAt: params.scheduledAt,
          }
        : {}),
    };

    // ── Send booking to API — all Firebase writes happen server-side ─────
    // The API server writes to all required paths:
    //   pendingjobs/{cid}/{jobId}   — primary dispatcher inbox (awaited on server)
    //   allbookings/{cid}/{jobId}   — RTDB mirror (background on server)
    //   Passengerjobs/{uid}/{jobId} — passenger copy (background on server)
    //   Firestore allbookings/{cid}/rides/{jobId} — history record (background)
    // pendingRef is kept for the RTDB listener that reads updates back from dispatcher
    const pendingRef = rtdbRef(rtdb, `pendingjobs/${companyId}/${firestoreId}`);

    // ── Write booking to Firebase ─────────────────────────────────────────
    // Primary path: API server writes to pendingjobs (server-side, clean).
    // Fallback: if the API server is unreachable, write pendingjobs directly
    // using the passenger's Firebase SDK auth — same security rules apply.
    // If both fail, clear ride state and show a clear error on booking screen.
    try {
      await createBookingOnServer({
        companyId,
        jobId: firestoreId,
        passengerUid,
        rtdbData: rtdbJobData as Record<string, unknown>,
        firestoreData: bookingData as unknown as Record<string, unknown>,
      });
    } catch (apiErr) {
      console.warn("[BookingAPI] API server unreachable — trying direct RTDB fallback:", (apiErr as Error).message);
      try {
        const hold =
          String(rtdbJobData.Status || "").toLowerCase() === "pendingpayment";
        if (!hold) {
          await rtdbSet(rtdbRef(rtdb, `pendingjobs/${companyId}/${firestoreId}`), rtdbJobData);
        }
        rtdbSet(rtdbRef(rtdb, `allbookings/${companyId}/${firestoreId}`), rtdbJobData).catch(() => {});
        rtdbSet(rtdbRef(rtdb, `Passengerjobs/${passengerUid}/${firestoreId}`), rtdbJobData).catch(() => {});
        console.warn("[BookingAPI] Fallback RTDB write succeeded — job dispatched via direct write");
      } catch (rtdbErr) {
        // Both API and direct write failed — booking cannot reach dispatcher
        setActiveRide(null);
        pendingJobRef.current = null;
        throw apiErr;
      }
    }

    // ── Scheduled bookings: skip real-time listener and active-ride state ──
    // The job sits in RTDB as Status:"Scheduled" until server-side dispatch fires.
    if (params.scheduledAt) {
      return firestoreId;
    }

    // ── Listen to RTDB for dispatcher status updates ─────────────────────
    // The dispatcher may write updates to pendingjobs OR allbookings — we
    // listen to both so we don't miss whichever path the dispatcher uses.
    const RTDB_STATUS_MAP: Record<string, RideStatus> = {
      // NOTE: "Offered/Dispatched/Accepted/Assigned" are intentionally NOT mapped here.
      // They mean "the dispatcher system queued the job" — NOT "a driver accepted".
      // Status only moves to "confirmed" when an actual DriverName arrives (see driverName block below).
      // These statuses update searchPhase ("offered"/"queued") for queue-progress feedback.
      // Driver en-route to pickup
      Picking: "on_the_way",   picking: "on_the_way",
      Enroute: "on_the_way",   enroute: "on_the_way",
      OnWay: "on_the_way",     onway: "on_the_way",
      "On Way": "on_the_way",
      // Driver arrived at pickup
      Arrived: "arrived",         arrived: "arrived",
      ArrivedAtPickup: "arrived", arrivedatpickup: "arrived",
      "Arrived At Pickup": "arrived",
      // Passenger on board / trip in progress
      Busy: "in_progress",       busy: "in_progress",
      InProgress: "in_progress", inprogress: "in_progress",
      OnBoard: "in_progress",    onboard: "in_progress",
      "On Board": "in_progress",
      PassengerOnBoard: "in_progress", passengeronboard: "in_progress",
      Boarded: "in_progress",    boarded: "in_progress",
      Active: "in_progress",     active: "in_progress",
      OnTrip: "in_progress",     ontrip: "in_progress",
      "On Trip": "in_progress",
      // Trip done
      Done: "completed",       done: "completed",
      Completed: "completed",  completed: "completed",
      Finished: "completed",   finished: "completed",
      // Cancelled
      Cancelled: "cancelled",  cancelled: "cancelled",
      Rejected: "cancelled",   rejected: "cancelled",
      // No-show — driver waited at pickup but passenger didn't appear
      NoShow: "no_show",         noshow: "no_show",
      "No Show": "no_show",      no_show: "no_show",
      NoShowCharge: "no_show",   noshowcharge: "no_show",
      "No Show Charge": "no_show",
    };

    const STATUS_NOTIFY: Partial<Record<RideStatus, [string, string, "success" | "info" | "warning" | "error"]>> = {
      on_the_way: ["Driver is on the way", "Your driver is heading to the pickup location", "info"],
      arrived:    ["Driver has arrived!", "Your driver is waiting at the pickup point", "success"],
      in_progress:["Trip started", "You're on your way!", "success"],
      completed:  ["Trip complete!", "Please rate your driver", "success"],
    };

    const handleRtdbUpdate = (snap: { exists(): boolean; val(): unknown }, source: string) => {
      if (!snap.exists()) return;
      const d = snap.val() as Record<string, unknown>;

      // Log what the dispatcher actually sent so we can see the real field names
      console.log(`[Dispatch:${source}] keys=${Object.keys(d).join(",")} Status=${d.Status ?? d.status} DriverName=${d.DriverName ?? d.driverName ?? d.drivername} DriverId=${d.DriverId ?? d.driverId ?? d.driverid}`);

      const rawStatus = String(d.Status ?? d.status ?? "").trim();
      const rawStatusLower = rawStatus.toLowerCase();

      // ── Update search phase so the passenger sees live queue status ──────
      setActiveRide((prev) => {
        if (!prev || prev.status !== "searching") return prev;
        let searchPhase: SearchPhase = prev.searchPhase ?? "waiting";
        if (rawStatusLower === "offered" || rawStatusLower === "dispatched" || rawStatusLower === "accepted" || rawStatusLower === "assigned")
          searchPhase = "offered";
        else if (rawStatusLower === "queued")  searchPhase = "queued";
        else if (rawStatusLower === "waiting") searchPhase = "waiting";
        if (searchPhase === prev.searchPhase) return prev;
        return { ...prev, searchPhase };
      });

      // ── Driver assigned by dispatcher ────────────────────────────────────
      // Prefer a real display name; fall back to driver id only if nothing else.
      const driverDisplayName = String(
        d.DriverName ?? d.driverName ?? d.drivername ??
        d.AssignedDriverName ?? d.assignedDriverName ??
        d.DriverFullName ?? d.driverFullName ?? ""
      ).trim();
      const driverIdOnly = String(
        d.DriverId ?? d.driverId ?? d.driverid ?? ""
      ).trim();
      const driverName = driverDisplayName || driverIdOnly;
      const vehicleLabel = String(
        d.VehicleId ?? d.vehicleId ?? d.vehicleid ??
        d.VehicleNo ?? d.vehicleNo ?? d.vehicleno ??
        d.VehicleNumber ?? d.vehicleNumber ?? d.vehiclenumber ??
        d.TaxiNumber ?? d.taxiNumber ?? "Vehicle"
      ).trim();
      const plateLabel = String(
        d.Plate ?? d.plate ?? d.Registration ?? d.registration ??
        d.Rego ?? d.rego ?? "—"
      ).trim() || "—";

      if (driverName) {
        // Start live GPS listener: online/{cid}/{vehicleId}/current → {lat, lng}
        const rawVehicleId = String(
          d.VehicleId ?? d.vehicleId ?? d.vehicleid ??
          d.VehicleNo ?? d.vehicleNo ?? d.vehicleno ??
          d.VehicleNumber ?? d.vehicleNumber ?? d.vehiclenumber ??
          d.TaxiNumber ?? d.taxiNumber ?? ""
        ).trim();
        if (rawVehicleId && rawVehicleId !== "Vehicle") {
          if (gpsListenerRef.current) rtdbOff(gpsListenerRef.current);
          const gpsPath = rtdbRef(rtdb, `online/${companyId}/${rawVehicleId}/current`);
          rtdbOnValue(gpsPath, (gpsSnap) => {
            if (!gpsSnap.exists()) return;
            const gd = gpsSnap.val() as { lat?: number; lng?: number; hasGps?: boolean };
            if (gd.lat && gd.lng && dispatchOverrideRef.current) {
              setDriverLocation({ latitude: gd.lat, longitude: gd.lng });
            }
          });
          gpsListenerRef.current = gpsPath;

          // Enrich plate / vehicle label from fleet record when dispatch omitted them
          enrichVehicleFromFleet(companyId, rawVehicleId, setActiveRide);
        }

        setActiveRide((prev) => {
          if (!prev || (prev.driver && prev.driver.name === driverName && prev.driver.cab === vehicleLabel && prev.driver.plate !== "—")) return prev;
          const driverLat = Number(d.DriverLat ?? d.driverLat ?? d.driverlat ?? 0);
          const driverLng = Number(d.DriverLng ?? d.driverLng ?? d.driverlng ?? 0);
          const loc: LatLng = driverLat && driverLng
            ? { latitude: driverLat, longitude: driverLng }
            : params.pickup.location;
          const startDist = haversineKm(loc, params.pickup.location);
          const niceName = driverDisplayName || `Driver ${driverIdOnly}`;
          notify("Driver Found!", `${niceName} has been assigned to your ride.`, "success");
          stopMockDriverTimer();
          stopSimulation();
          dispatchOverrideRef.current = true;
          if (rawVehicleId && rawVehicleId !== "Vehicle") {
            enrichVehicleFromFleet(companyId, rawVehicleId, setActiveRide);
          }
          return {
            ...prev,
            status: "confirmed",
            searchPhase: undefined,
            driver: { name: niceName, rating: 4.8, cab: vehicleLabel, plate: plateLabel, color: "", location: loc },
            acceptedAt: prev.acceptedAt ?? Date.now(),
            driverStartDistanceToPickup: prev.driverStartDistanceToPickup ?? (startDist > 0.01 ? startDist : 1),
          };
        });
      }

      // ── Driver live location ─────────────────────────────────────────────
      const dLat = Number(d.DriverLat ?? d.driverLat ?? d.driverlat ?? 0);
      const dLng = Number(d.DriverLng ?? d.driverLng ?? d.driverlng ?? 0);
      if (dLat && dLng && dispatchOverrideRef.current) {
        setDriverLocation({ latitude: dLat, longitude: dLng });
      }

      // ── ETA ──────────────────────────────────────────────────────────────
      const eta = d.ETA ?? d.eta ?? d.Eta;
      if (eta != null) {
        setActiveRide((prev) => prev ? { ...prev, eta: Number(eta) } : prev);
      }

      // ── Pickup PIN / I'm coming deadline (fanout from dispatch) ───────────
      const pinFromRtdb = String(d.PickupPin ?? d.pickupPin ?? "").trim();
      const imComingAt = String(d.imComingAt ?? d.ImComingAt ?? "").trim();
      const noShowDeadlineAt = String(d.noShowDeadlineAt ?? "").trim();
      if (pinFromRtdb || imComingAt || noShowDeadlineAt) {
        setActiveRide((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            ...(pinFromRtdb && !prev.pickupPin ? { pickupPin: pinFromRtdb } : {}),
            ...(imComingAt ? { imComingAt } : {}),
            ...(noShowDeadlineAt ? { noShowDeadlineAt } : {}),
          };
        });
      }

      // ── Status transition ────────────────────────────────────────────────
      // Ignore statuses that don't represent meaningful ride-state changes
      // Only ignore pure queue-position strings — "offered"/"dispatched"/"accepted"/"assigned"
      // ARE meaningful (driver found) and must flow through RTDB_STATUS_MAP → "confirmed".
      const ignoreForStatus = new Set([
        "waiting",        // still in dispatcher queue, no state change needed
        "queued",         // still in dispatcher queue, no state change needed
        "pendingpayment", // payment pending, no dispatch state change
        // Ignore echo of our own cancel request — we already set it optimistically
        "cancelrequested",
        "cancel_requested",
      ]);
      if (rawStatus && !ignoreForStatus.has(rawStatusLower)) {
        const mapped = RTDB_STATUS_MAP[rawStatus];
        if (mapped === "cancelled") {
          // Backend has confirmed cancellation. Prevent duplicate processing across
          // all 3 RTDB listeners by consuming pendingCancelRef atomically.
          const pending = pendingCancelRef.current;
          pendingCancelRef.current = null;

          if (pending) {
            // Passenger-initiated cancel confirmed by backend — apply wallet logic based on stored outcome
            if (pending.outcome === "refund") {
              // Credit the relevant amount to wallet (full fare for regular; passenger % for TM)
              const creditAmt = pending.isTM && pending.tmPassengerAmount
                ? pending.tmPassengerAmount
                : pending.fare;
              updateWallet(creditAmt).catch(() => {});
              setTimeout(() => notify(
                pending.isTM ? "TM Co-payment Credited" : "Fare Credited to Wallet",
                `${formatCurrency(creditAmt)} added to your wallet for your next ride.${pending.isTM ? " The council is not charged." : ""}`,
                "success",
              ), 0);
            } else if (pending.outcome === "charge") {
              const chargeAmt = pending.isTM && pending.tmPassengerAmount
                ? pending.tmPassengerAmount
                : pending.fare;
              setTimeout(() => notify(
                pending.isTM ? "TM Co-payment Charged" : "Cancellation Fee Charged",
                `${formatCurrency(chargeAmt)} has been charged.${pending.isTM ? " No council charge applies." : " The driver has been paid."}`,
                "warning",
              ), 0);
            } else {
              // "free" — cash or no-driver-yet
              setTimeout(() => notify("Ride Cancelled", "Your booking has been cancelled at no charge.", "info"), 0);
            }
            // Clear ride now that backend has confirmed
            stopMockDriverTimer();
            stopSimulation();
            stopFirestoreListener();
            setTimeout(() => stopRtdbJobListener(), 0);
            pendingJobRef.current = null;
            setActiveRide(null);
            setDriverLocation(null);
          } else {
            // Cancellation was NOT initiated by the passenger (operator/dispatcher cancelled).
            // Show the "cancelled" state and let the user navigate away — do not auto-clear,
            // so the user can see what happened before leaving the screen.
            setActiveRide((prev) => {
              if (!prev || prev.status === "cancelled") return prev;
              setTimeout(() => notify(
                "Booking Cancelled",
                "Your booking was cancelled by the operator.",
                "warning",
              ), 0);
              return { ...prev, status: "cancelled" };
            });
          }
        } else if (mapped === "no_show") {
          // Driver-initiated no-show — apply charge logic server-side;
          // app shows notification, sets status, and lets user navigate home.
          setActiveRide((prev) => {
            if (!prev || prev.status === "no_show") return prev;
            const isCashPmt = prev.payment === "cash";
            const isTMRide  = prev.isTM ?? false;
            const passAmt   = prev.tmPassengerAmount;
            const amt       = isTMRide && passAmt ? formatCurrency(passAmt) : formatCurrency(prev.fare);
            let title: string;
            let msg: string;
            if (isCashPmt) {
              title = "No Show Recorded";
              msg   = "Your driver waited but couldn't reach you. No charge for cash bookings.";
            } else if (isTMRide) {
              title = "TM No Show — Co-payment Charged";
              msg   = `${amt} has been charged as a no-show fee. No council charge applies.`;
            } else {
              title = "No Show — Fare Charged";
              msg   = `${amt} has been charged. Your driver waited but couldn't reach you.`;
            }
            setTimeout(() => notify(title, msg, "warning"), 0);
            return { ...prev, status: "no_show" };
          });
        } else if (mapped) {
          setActiveRide((prev) => {
            if (!prev || prev.status === mapped) return prev;
            // Fire notification on the transition (setTimeout keeps setState pure)
            const n = STATUS_NOTIFY[mapped];
            if (n) {
              setTimeout(() => {
                notify(n[0], n[1], n[2]);
                if (mapped === "arrived") void alertPassengerDriverArrived();
              }, 0);
            }
            return { ...prev, status: mapped };
          });
        }
      }
    };

    // Listen on pendingjobs — the primary dispatcher inbox we wrote the job to
    rtdbJobRef.current = pendingRef;
    rtdbOnValue(pendingRef, (snap) => handleRtdbUpdate(snap, "pendingjobs"));

    // Also listen on allbookings — some dispatcher systems write status back here
    rtdbAllbookingsRef.current = rtdbRef(rtdb, `allbookings/${companyId}/${firestoreId}`);
    rtdbOnValue(rtdbAllbookingsRef.current, (snap) => handleRtdbUpdate(snap, "allbookings"));

    // Also listen on rideStatus/{cid}/{bookingId} — contract-required RTDB path the
    // dispatcher uses to push driver assignment and status updates to the passenger.
    rtdbRideStatusRef.current = rtdbRef(rtdb, `rideStatus/${companyId}/${firestoreId}`);
    rtdbOnValue(rtdbRideStatusRef.current, (snap) => handleRtdbUpdate(snap, "rideStatus"));

    // Register for push notifications in the background — does NOT block booking flow
    registerForPushNotificationsAsync().then((deviceUid) => {
      if (!deviceUid) return;
      updateDoc(doc(db, "allbookings", companyId, "rides", firestoreId), { deviceUid }).catch(() => {});
    }).catch(() => {});

    listenToRideStatus(companyId, firestoreId, params.pickup.location, params.destination.location);

    // No auto-cancel timer — the job stays live in RTDB until:
    //   a) The real dispatcher assigns a driver, OR
    //   b) The passenger manually cancels via the Cancel button.
    // The passenger can see live queue status on the active-ride screen.

    return firestoreId;
  };

  // cancelRide is a THIN CLIENT — it only sends a cancel request to the backend.
  // It does NOT assume the driver is freed, the queue is restored, or money changes hands.
  // All final decisions (status, refund, driver availability) come from the backend.
  // Wallet logic runs only after backend confirms "cancelled" via the RTDB listener above.
  const cancelRide = async (cancelOutcome?: "refund" | "free" | "charge", reason?: string) => {
    if (!activeRide) return;
    // Don't double-send
    if (activeRide.status === "cancel_requested") return;

    // Store cancel context so the RTDB listener can apply wallet logic on confirmation.
    // outcome defaults to "free" if caller didn't supply it (e.g. cash or no-driver-yet).
    pendingCancelRef.current = {
      payment: activeRide.payment,
      fare: activeRide.fare,
      isTM: activeRide.isTM ?? false,
      tmPassengerAmount: activeRide.tmPassengerAmount,
      outcome: cancelOutcome ?? "free",
    };

    // Optimistic UI: show "cancel_requested" while waiting for backend confirmation.
    // All RTDB/Firestore listeners stay active — backend writes the final "cancelled".
    setActiveRide((prev) => prev ? { ...prev, status: "cancel_requested" } : prev);

    const cancelledAt = new Date().toISOString();

    // Write cancel request to RTDB. The dispatcher reads this and decides:
    //   - whether to free the driver
    //   - whether to restore the queue
    //   - what fee (if any) applies
    // We write "CancelRequested" — NOT "Cancelled" — so the backend controls the outcome.
    const rtdbCancelFields = {
      Status: "CancelRequested",
      status: "cancel_requested",
      CancelledBy: "passenger_app",
      cancelledBy: "passenger_app",
      CancelledAt: cancelledAt,
      cancelledAt,
      ...(reason ? { CancelReason: reason, cancelReason: reason } : {}),
      ...(activeRide.isTM ? { CouncilCharged: false, councilCharged: false } : {}),
    };

    // Send cancel request via API — dispatcher makes all final decisions
    cancelBookingOnServer({
      companyId: activeRide.companyId,
      jobId: activeRide.firestoreId,
      cancelFields: rtdbCancelFields as Record<string, unknown>,
    }).catch((e) => console.warn("[BookingAPI] Cancel write failed:", (e as Error).message));

    dispatchOverrideRef.current = false;
  };

  const abortRide = () => {
    // Use the ref first — it is set synchronously in startRide before any state updates,
    // so it reliably holds the job info even if React hasn't flushed activeRide yet.
    const pending = pendingJobRef.current ?? (activeRide ? { companyId: activeRide.companyId, jobId: activeRide.firestoreId } : null);
    stopMockDriverTimer();
    stopSimulation();
    stopFirestoreListener();
    stopRtdbJobListener();
    if (pending) {
      const cancelledAt = new Date().toISOString();
      // Early abort (pre-accept, no driver assigned) — write directly as Cancelled via API
      // Use same field values the dispatcher expects — keep original strings for compat
      cancelBookingOnServer({
        companyId: pending.companyId,
        jobId: pending.jobId,
        cancelFields: {
          Status: "Cancelled",
          status: "Cancelled",
          CancelledBy: "passenger",
          cancelledBy: "passenger",
          CancelledAt: cancelledAt,
          cancelledAt,
        },
      }).catch((e) => console.warn("[BookingAPI] Abort cancel failed:", (e as Error).message));
    }
    pendingJobRef.current = null;
    setActiveRide(null);
    setDriverLocation(null);
    dispatchOverrideRef.current = false;
  };

  const addStop = (stop: Stop) => {
    setActiveRide((prev) => {
      if (!prev) return prev;
      const newStops = [...prev.stops, stop];
      let newFare = prev.fare;
      if (prev.route) {
        const recalculated = calculateFare(
          prev.route.distanceMeters,
          prev.route.durationSeconds,
          prev.vehicleType,
          newStops.length
        );
        newFare = prev.discount
          ? Math.round(recalculated.total * (1 - prev.discount) * 100) / 100
          : recalculated.total;
      }
      const updated = { ...prev, stops: newStops, fare: newFare };
      if (prev.firestoreId && prev.companyId) {
        // Send stop edit via API — only valid before driver accepts
        editBookingOnServer({
          companyId: prev.companyId,
          jobId: prev.firestoreId,
          editFields: {
            stops: newStops.map((s) => ({
              id: s.id,
              address: s.place.address,
              lat: s.place.location.latitude,
              lng: s.place.location.longitude,
            })),
            estimatedFare: newFare,
          },
        }).catch((e) => console.warn("[BookingAPI] Stop edit failed:", (e as Error).message));
      }
      return updated;
    });
    notify("Stop Added", `${stop.place.address.split(",")[0]} — fare updated`, "info");
  };

  const clearRide = () => {
    stopMockDriverTimer();
    stopSimulation();
    stopFirestoreListener();
    stopRtdbJobListener();
    pendingJobRef.current = null;
    setActiveRide(null);
    setDriverLocation(null);
    dispatchOverrideRef.current = false;
  };

  const markPaymentConfirmed = () => {
    setActiveRide((prev) => (prev ? { ...prev, paymentStatus: "confirmed" } : prev));
  };

  const signalImComing = async (): Promise<boolean> => {
    if (!activeRide?.firestoreId || !activeRide.companyId) return false;
    if (activeRide.imComingAt) return true;
    if (activeRide.status !== "arrived") return false;
    try {
      const dispatchBase =
        process.env.EXPO_PUBLIC_DISPATCH_URL ||
        "https://invt-production.up.railway.app";
      const res = await fetch(`${dispatchBase.replace(/\/$/, "")}/api/job/im-coming`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId: activeRide.firestoreId,
          companyId: activeRide.companyId,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        notify("Could not extend wait", String(json?.error || "Try again"), "error");
        return false;
      }
      setActiveRide((prev) =>
        prev
          ? {
              ...prev,
              imComingAt: json.imComingAt || new Date().toISOString(),
              noShowDeadlineAt: json.noShowDeadlineAt || prev.noShowDeadlineAt,
            }
          : prev,
      );
      notify("Driver notified", "You've got a bit more time — head to the pickup now.", "success");
      return true;
    } catch {
      notify("Could not extend wait", "Check your connection and try again.", "error");
      return false;
    }
  };

  const completeRide = async (rating: number, tip: number) => {
    // Snapshot first, then clear immediately so Home never keeps showing Active Ride
    // while Firestore/history writes are still in flight.
    const ride = activeRideRef.current;
    clearRide();
    try {
      if (ride?.firestoreId && ride?.companyId) {
        const finalFare = ride.fare + tip;
        await updateFirestoreStatus(ride.companyId, ride.firestoreId, "completed", {
          finalFare,
          tip,
          paymentStatus: "confirmed",
        });

        // Write passenger's star rating to shared paths so driver app + SA portal can read it
        if (rating > 0) {
          const cid = ride.companyId;
          const jobId = ride.firestoreId;
          const passengerId = auth.currentUser?.uid ?? "guest";
          const ratedAt = new Date().toISOString();

          updateDoc(doc(db, "allbookings", cid, "rides", jobId), {
            passengerRating: rating,
            passengerRatedAt: ratedAt,
            tip,
          }).catch(() => {});

          rtdbUpdate(rtdbRef(rtdb, `driverRatings/${cid}/${jobId}`), {
            passengerRating: rating,
            passengerRatedAt: ratedAt,
            passengerId,
            tip,
            driverName: ride.driver?.name ?? null,
            bookingId: jobId,
            companyId: cid,
          }).catch(() => {});

          rtdbUpdate(rtdbRef(rtdb, `allbookings/${cid}/${jobId}`), {
            passengerRating: rating,
            passengerRatedAt: ratedAt,
            tip,
            Tip: tip,
          }).catch(() => {});
        }
      }
    } catch (e) {
      console.warn("[Ride] completeRide write failed:", e);
    }
  };

  const setRideStatus = (status: RideStatus) => {
    setActiveRide((prev) => {
      if (!prev) return prev;
      if (prev.firestoreId && prev.companyId) {
        updateFirestoreStatus(prev.companyId, prev.firestoreId, status).catch(() => {});
      }
      return { ...prev, status };
    });
    if (status === "in_progress") {
      progressRef.current = 0;
      notify("Trip started!", "Enjoy your ride.", "success");
    }
  };

  useEffect(() => {
    return () => {
      stopMockDriverTimer();
      stopSimulation();
      stopFirestoreListener();
      stopRtdbJobListener();
    };
  }, []);

  return (
    <RideContext.Provider
      value={{ activeRide, driverLocation, startRide, cancelRide, abortRide, addStop, completeRide, clearRide, setRideStatus, markPaymentConfirmed, signalImComing }}
    >
      {children}
    </RideContext.Provider>
  );
}

export function RideProvider({ children }: { children: React.ReactNode }) {
  return <RideProviderInner>{children}</RideProviderInner>;
}

export function useRide() {
  const ctx = useContext(RideContext);
  if (!ctx) throw new Error("useRide must be used within RideProvider");
  return ctx;
}
