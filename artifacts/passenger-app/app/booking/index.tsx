import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PlacesAutocomplete } from "@/components/PlacesAutocomplete";
import { RouteMap } from "@/components/RouteMap";
import { TMCardScanner } from "@/components/TMCardScanner";
import { Company, VehicleType, VEHICLES, VEHICLE_CAPACITY, VEHICLE_LABELS } from "@/constants/companies";
import { useCompanies, getVehicleTariff, isLoadTestCompanyId } from "@/context/CompaniesContext";
import { useAuth } from "@/context/AuthContext";
import { useNotification } from "@/context/NotificationContext";
import { useRide, Stop, PaymentMethodRide, TMPassenger } from "@/context/RideContext";
import { ref, onValue, get, set, update } from "firebase/database";
import { rtdb } from "@/lib/firebase";
import { getRoute, RouteResult } from "@/lib/directions";
import { calculateFare, formatCurrency } from "@/lib/fareCalculator";
import { PlaceDetail, reverseGeocode } from "@/lib/googlePlaces";
import { resolvePlacesBias, PlacesBias } from "@/lib/placesBias";
import { checkTripSanity } from "@/lib/tripGeoGuard";
import { useTMSettings, calcTMSubsidy } from "@/lib/tmSettings";
import { useColors } from "@/hooks/useColors";
import { openStripeCheckout, verifyAndDispatchBooking, StripeCheckoutCancelledError } from "@/lib/stripePayment";
import { useAppConfig } from "@/context/AppConfigContext";
import {
  FALLBACK_TZ,
  getTZTimeParts,
  buildTZScheduledDate,
  getTZDateChipLabel,
  formatTZScheduledLabel,
} from "@/lib/timezone";

type Step = "location" | "vehicle" | "confirm";

export default function BookingScreen() {
  const colors = useColors();
  const { user, firebaseUser, updateWallet } = useAuth();
  const { startRide, abortRide, markPaymentConfirmed } = useRide();
  const { notify } = useNotification();
  const { settings: tmSettings } = useTMSettings();
  const { platformCashEnabled } = useAppConfig();
  const insets = useSafeAreaInsets();
  const { companies, loading: companiesLoading } = useCompanies();

  const [step, setStep] = useState<Step>("location");
  const [pickup, setPickup] = useState<PlaceDetail | null>(null);
  const [destination, setDestination] = useState<PlaceDetail | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [addingStop, setAddingStop] = useState(false);
  const [company, setCompany] = useState<Company>(companies[0]);
  const [vehicleType, setVehicleType] = useState<VehicleType>(
    companies[0]?.vehicles?.[0] ?? "Sedan"
  );
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [payment, setPayment] = useState<PaymentMethodRide>("card");
  const [promo, setPromo] = useState("");
  const [discount, setDiscount] = useState(0);
  const [promoError, setPromoError] = useState("");
  const [promoValidating, setPromoValidating] = useState(false);
  const [promoIsRental, setPromoIsRental] = useState(false);
  const [booking, setBooking] = useState(false);
  const [bookingStatus, setBookingStatus] = useState<string | null>(null);
  const [stripeError, setStripeError] = useState<string | null>(null);
  const [useWalletCredit, setUseWalletCredit] = useState(false);
  const [rideshare, setRideshare] = useState(false);
  const [passengerCount, setPassengerCount] = useState(2);
  const [pickupNote, setPickupNote] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Business Account & ACC feature flags — read from companySettings per selected company
  const [showBusinessAccount, setShowBusinessAccount] = useState(false);
  const [showACC, setShowACC] = useState(false);
  const [placesBias, setPlacesBias] = useState<PlacesBias>(() =>
    resolvePlacesBias({ companyName: companies[0]?.name }),
  );
  useEffect(() => {
    if (!company?.id || company.id === "any") {
      setShowBusinessAccount(false);
      setShowACC(false);
      setPlacesBias(resolvePlacesBias({ companyName: company?.name }));
      return;
    }
    const settingsRef = ref(rtdb, `companySettings/${company.id}`);
    const unsub = onValue(
      settingsRef,
      (snap) => {
        const val = snap.val() as Record<string, unknown> | null;
        const features = (val?.features as Record<string, unknown> | undefined) ?? {};
        setShowBusinessAccount(features.businessAccounts === true);
        setShowACC(features.accEnabled === true);
        setPlacesBias(
          resolvePlacesBias({
            city: String(val?.city || ""),
            country: String(val?.country || ""),
            companyName: company.name,
          }),
        );
      },
      () => {
        setShowBusinessAccount(false);
        setShowACC(false);
        setPlacesBias(resolvePlacesBias({ companyName: company.name }));
      },
    );
    return () => unsub();
  }, [company?.id, company?.name]);

  // Business Account state
  const [businessAccountInput, setBusinessAccountInput] = useState("");
  const [purchaseOrderInput, setPurchaseOrderInput] = useState("");
  const [baValidating, setBaValidating] = useState(false);
  const [baError, setBaError] = useState<string | null>(null);
  const [resolvedBA, setResolvedBA] = useState<{ id: string; name: string; poId: string; poNumber: string } | null>(null);

  // ACC state
  const [accClaimInput, setAccClaimInput] = useState("");
  const [accValidating, setAccValidating] = useState(false);
  const [accError, setAccError] = useState<string | null>(null);
  const [resolvedACC, setResolvedACC] = useState<{ clientId: string; clientName: string; claimNumber: string } | null>(null);

  // Gift Card state
  const [giftCardInput, setGiftCardInput] = useState("");
  const [giftCardValidating, setGiftCardValidating] = useState(false);
  const [giftCardError, setGiftCardError] = useState<string | null>(null);
  const [resolvedGiftCard, setResolvedGiftCard] = useState<{ id: string; code: string; balance: number } | null>(null);

  // §113 Card Capture — local photo URIs (uploads pending Firebase Storage rules)
  const [prefillCard, setPrefillCard] = useState<TMPassenger | null>(null);
  const [accountCardPhotoUri, setAccountCardPhotoUri] = useState<string | null>(null);
  const [accCardPhotoUri, setAccCardPhotoUri] = useState<string | null>(null);

  // Reset resolved state when inputs change
  useEffect(() => { setResolvedBA(null); setBaError(null); }, [businessAccountInput, purchaseOrderInput]);
  useEffect(() => { setResolvedACC(null); setAccError(null); }, [accClaimInput]);

  // Non-TM only: if platform cash is disabled while Cash is selected, fall back to Card.
  // TM remainder always keeps Cash available (business rule).
  useEffect(() => {
    if (!isTM && !platformCashEnabled && payment === "cash") {
      setPayment("card");
    }
  }, [isTM, platformCashEnabled, payment]);
  useEffect(() => { setResolvedGiftCard(null); setGiftCardError(null); }, [giftCardInput]);

  // When a payment method is deselected, clear its state
  useEffect(() => {
    if (payment !== "business_account") {
      setBusinessAccountInput("");
      setPurchaseOrderInput("");
      setResolvedBA(null);
      setBaError(null);
    }
    if (payment !== "acc") {
      setAccClaimInput("");
      setResolvedACC(null);
      setAccError(null);
    }
    if (payment !== "gift_card") {
      setGiftCardInput("");
      setResolvedGiftCard(null);
      setGiftCardError(null);
    }
  }, [payment]);

  // Read URL params — used when returning from "no drivers" prompt or editing a scheduled ride
  const params = useLocalSearchParams<{ initialScheduled?: string }>();

  // Scheduled booking state
  const [isScheduled, setIsScheduled] = useState(() => params.initialScheduled === "true");
  const [pickerDaysAhead, setPickerDaysAhead] = useState(0);
  const [pickerHour, setPickerHour] = useState(() => getTZTimeParts(FALLBACK_TZ).hour12);
  const [pickerMinIdx, setPickerMinIdx] = useState(0); // 0=:00 1=:15 2=:30 3=:45
  const [pickerAmPm, setPickerAmPm] = useState<"AM" | "PM">(() => getTZTimeParts(FALLBACK_TZ).ampm);
  const PICK_MINS = ["00", "15", "30", "45"] as const;

  /** The IANA timezone for all scheduler display/logic.
   *  Driven by the selected company's timezone field (set by admin in Firebase).
   *  Falls back through: first real company's TZ → FALLBACK_TZ ("Pacific/Auckland"). */
  const bookingTZ = React.useMemo(() => {
    if (company.id !== "any" && company.timezone) return company.timezone;
    const firstReal = companies.find((c) => c.id !== "any" && c.timezone);
    return firstReal?.timezone ?? FALLBACK_TZ;
  }, [company, companies]);

  const scheduledAt = React.useMemo<Date | null>(() => {
    if (!isScheduled) return null;
    let h = pickerHour % 12;
    if (pickerAmPm === "PM") h += 12;
    return buildTZScheduledDate(bookingTZ, pickerDaysAhead, h, Number(PICK_MINS[pickerMinIdx]));
  }, [isScheduled, bookingTZ, pickerDaysAhead, pickerHour, pickerMinIdx, pickerAmPm]);

  const scheduledAtValid = !scheduledAt || scheduledAt.getTime() - Date.now() >= 30 * 60 * 1000;

  // ASAP rides require company dispatch online + within operating hours.
  // Individual driver online/busy is ignored — job sits in Pending until a driver takes it.
  // Scheduled (future) rides are always allowed.
  const anyRealAsapBookable = companies.some((c) => c.id !== "any" && c.asapBookable !== false);
  const effectiveAsapBookable = company.id === "any" ? anyRealAsapBookable : company.asapBookable !== false;
  const asapBlocked = !scheduledAt && !effectiveAsapBookable;
  const asapBlockReason =
    asapBlocked && company.dispatchOnline === false
      ? "dispatch_offline"
      : asapBlocked
        ? "outside_hours"
        : "ok";

  const scheduledAtLabel = scheduledAt ? formatTZScheduledLabel(bookingTZ, scheduledAt) : "";

  // Auto-select first ASAP-bookable company when Firebase data loads; preserve explicit user choice after that.
  // Also reset vehicleType to the company's first vehicle when company changes.
  useEffect(() => {
    if (!companiesLoading && companies.length > 0) {
      setCompany((prev) => {
        // Prefer keeping the current selection only if it is still bookable and not load-test
        const found = companies.find(
          (c) =>
            c.id === prev.id &&
            !isLoadTestCompanyId(c.id) &&
            c.asapBookable !== false,
        );
        const next =
          found ??
          companies.find(
            (c) => c.id !== "any" && !isLoadTestCompanyId(c.id) && c.asapBookable !== false,
          ) ??
          companies.find((c) => c.id !== "any" && !isLoadTestCompanyId(c.id)) ??
          companies[0];
        // If company is actually changing, reset vehicleType to first available
        if (next.id !== prev.id && next.vehicles.length > 0) {
          setVehicleType(next.vehicles[0]);
        }
        return next;
      });
    }
  }, [companies, companiesLoading]);

  // Whenever company changes explicitly (user tap), reset vehicleType to first available
  useEffect(() => {
    if (company.vehicles.length > 0 && !company.vehicles.includes(vehicleType)) {
      setVehicleType(company.vehicles[0]);
    }
  }, [company.id]);

  // TM state
  const [isTM, setIsTM] = useState(false);
  const [tmPassengers, setTMPassengers] = useState<TMPassenger[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [editingPassengerId, setEditingPassengerId] = useState<string | null>(null);

  const bookableCompanies = companies.filter(
    (c) => !isLoadTestCompanyId(c.id) && (isScheduled || c.asapBookable !== false),
  );
  const tmApprovedCompanies = bookableCompanies.filter((c) => c.tmApproved);
  const visibleCompanies = isTM ? tmApprovedCompanies : bookableCompanies;

  const hoistCount = tmPassengers.filter((p) => p.needsHoist).length;
  const totalHoistFee = hoistCount * tmSettings.hoistFeePerLift;

  const activeTMTariff = isTM
    ? (vehicleType === "Wheelchair"
        ? company.tmWheelchairTariff ?? getVehicleTariff(company, vehicleType)
        : company.tmCarTariff ?? getVehicleTariff(company, vehicleType))
    : undefined;

  const useCurrentLocation = async () => {
    setLocating(true);
    setLocationError(null);
    Haptics.selectionAsync();
    try {
      let latitude: number;
      let longitude: number;

      if (Platform.OS === "web") {
        const geo = (typeof window !== "undefined" ? (window as any).navigator?.geolocation : null) as Geolocation | null;
        if (!geo) {
          setLocationError("Location is not available in this browser. Please type your address manually.");
          return;
        }
        const position = await new Promise<{ coords: { latitude: number; longitude: number } }>((resolve, reject) =>
          geo.getCurrentPosition(resolve as any, reject, { timeout: 10000 })
        );
        latitude = position.coords.latitude;
        longitude = position.coords.longitude;
      } else {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          setLocationError("Location permission denied. Please allow location access in your device settings.");
          return;
        }
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        latitude = position.coords.latitude;
        longitude = position.coords.longitude;
      }

      const place = await reverseGeocode(latitude, longitude);
      if (place) {
        setPickup(place);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setLocationError("Could not determine your address. Please type it manually.");
      }
    } catch {
      setLocationError("Could not access your location. Please type your address manually.");
    } finally {
      setLocating(false);
    }
  };

  const toggleTM = async () => {
    Haptics.selectionAsync();
    const next = !isTM;
    setIsTM(next);
    if (next) {
      if (!tmApprovedCompanies.find((c) => c.id === company.id)) {
        setCompany(tmApprovedCompanies[0]);
      }
      setPayment("cash");
      // §113 — auto-fill from saved profile card if one exists
      if (firebaseUser?.uid) {
        try {
          const snap = await get(ref(rtdb, `users/${firebaseUser.uid}/tmCard`));
          if (snap.exists()) {
            const saved = snap.val() as Omit<TMPassenger, "id">;
            openScanner(undefined, { id: "profile_prefill", ...saved });
            return;
          }
        } catch {
          // No saved card or read error — fall through to normal flow
        }
      }
    } else {
      setTMPassengers([]);
    }
  };

  const openScanner = (passengerId?: string, prefill?: TMPassenger) => {
    setEditingPassengerId(passengerId ?? null);
    setPrefillCard(prefill ?? null);
    setScannerOpen(true);
  };

  const handleSaveCard = (passenger: TMPassenger) => {
    setScannerOpen(false);
    if (editingPassengerId) {
      setTMPassengers((prev) => prev.map((p) => p.id === editingPassengerId ? passenger : p));
    } else {
      setTMPassengers((prev) => [...prev, passenger]);
    }
    setEditingPassengerId(null);
    setPrefillCard(null);
    // §113 — persist to profile so next booking auto-fills. Strip local-only URI before saving.
    if (firebaseUser?.uid) {
      const { cardPhotoUri: _uri, id: _id, ...cardToSave } = passenger;
      set(ref(rtdb, `users/${firebaseUser.uid}/tmCard`), { ...cardToSave, savedAt: Date.now() }).catch(() => {});
    }
  };

  const removePassenger = (id: string) => {
    setTMPassengers((prev) => prev.filter((p) => p.id !== id));
  };

  const fetchRoute = async (): Promise<RouteResult | null> => {
    if (!pickup || !destination) return null;
    setLoadingRoute(true);
    const waypoints = stops.map((s) => s.place.location);
    const result = await getRoute(pickup.location, destination.location, waypoints);
    setLoadingRoute(false);
    if (!result) {
      setRoute(null);
      return null;
    }
    const previewFare = calculateFare(
      result.distanceMeters,
      result.durationSeconds,
      vehicleType,
      stops.length,
      getVehicleTariff(company, vehicleType),
    );
    const sanity = checkTripSanity({
      distanceMeters: result.distanceMeters,
      fareTotal: previewFare.total,
    });
    if (!sanity.ok) {
      setRoute(null);
      Alert.alert("Implausible trip", sanity.reason);
      return null;
    }
    if (sanity.warn) {
      const proceed = await new Promise<boolean>((resolve) => {
        Alert.alert("Long trip — confirm address", sanity.warn, [
          { text: "Go Back", style: "cancel", onPress: () => resolve(false) },
          { text: "Looks Correct", onPress: () => resolve(true) },
        ]);
      });
      if (!proceed) {
        setRoute(null);
        return null;
      }
    }
    setRoute(result);
    return result;
  };

  const activeTariff = activeTMTariff ?? getVehicleTariff(company, vehicleType);
  const fare = route
    ? calculateFare(route.distanceMeters, route.durationSeconds, vehicleType, stops.length, activeTariff)
    : null;

  const discountedFare = fare ? Math.round(fare.total * (1 - discount) * 100) / 100 : null;

  const tmSplit = isTM && discountedFare != null
    ? calcTMSubsidy(discountedFare, tmSettings)
    : null;

  // Wallet-split computation — how much wallet can cover and what's left to charge
  const walletBalance = user?.walletBalance ?? 0;
  const currentFare = discountedFare ?? fare?.total ?? 0;
  // Wallet credit only applies to Card payments (never Account/TM-cash/Cash/ACC/Gift).
  // Clear wallet toggle when leaving card (never bleed onto Account/TM-cash/Cash).
  useEffect(() => {
    if (payment !== "card" && useWalletCredit) setUseWalletCredit(false);
  }, [payment, useWalletCredit]);

  const walletEligible = payment === "card";
  const walletContribution = walletEligible && useWalletCredit && walletBalance > 0
    ? Math.min(walletBalance, currentFare)
    : 0;
  const netFare = Math.max(0, currentFare - walletContribution);

  const applyPromo = async () => {
    const code = promo.trim().toUpperCase();
    if (!code) return;
    setPromoError("");
    setDiscount(0);
    setPromoIsRental(false);

    // R2R-XXXXXX codes come from rental bookings — validate against Firebase
    if (code.startsWith("R2R-")) {
      setPromoValidating(true);
      try {
        const snap = await get(ref(rtdb, `rentalPromos/${code}`));
        if (!snap.exists()) {
          setPromoError("Promo code not found");
          return;
        }
        const data = snap.val() as { status?: string; discountPercent?: number };
        if (data.status === "used") {
          setPromoError("This promo code has already been used");
          return;
        }
        if (data.status !== "active") {
          setPromoError("This promo code is not valid");
          return;
        }
        const pct = (data.discountPercent ?? 0) / 100;
        setDiscount(pct);
        setPromoIsRental(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        setPromoError("Could not validate promo code. Please try again.");
      } finally {
        setPromoValidating(false);
      }
      return;
    }

    setPromoValidating(true);
    try {
      const snap = await get(ref(rtdb, `promoCodes/${code}`));
      if (!snap.exists()) {
        setPromoError("Invalid promo code");
        return;
      }
      const data = snap.val() as { discount?: number; discountPercent?: number };
      let rate = 0;
      if (typeof data.discountPercent === "number") {
        rate = data.discountPercent / 100;
      } else if (typeof data.discount === "number") {
        rate = data.discount;
      }
      if (rate <= 0) {
        setPromoError("Invalid promo code");
        return;
      }
      setDiscount(rate);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setPromoError("Could not validate promo code. Please try again.");
    } finally {
      setPromoValidating(false);
    }
  };

  // Effective company ID — the real company that will receive the booking.
  // Computed here so validation functions can use it before handleBook runs.
  const effectiveCompanyId = React.useMemo(() => {
    if (company.id !== "any") return company.id;
    if (scheduledAt) return companies.find((c) => c.id !== "any")?.id ?? company.id;
    return (
      companies.find((c) => c.id !== "any" && c.asapBookable !== false)?.id ??
      companies.find((c) => c.id !== "any")?.id ??
      company.id
    );
  }, [company, companies, scheduledAt]);

  // Validate Business Account + PO against Firebase
  const validateBusinessAccount = async (): Promise<boolean> => {
    const accountNum = businessAccountInput.trim();
    const poNum = purchaseOrderInput.trim();
    if (!accountNum || !poNum) {
      setBaError("Please enter both account number and purchase order number.");
      return false;
    }
    setBaValidating(true);
    setBaError(null);
    try {
      // Search businessAccounts/{cid} for matching accountNumber field
      const snap = await get(ref(rtdb, `businessAccounts/${effectiveCompanyId}`));
      if (!snap.exists()) {
        setBaError("No business accounts found for this company.");
        return false;
      }
      const accounts = snap.val() as Record<
        string,
        {
          accountNumber?: string;
          accountCode?: string;
          AccountCode?: string;
          name?: string;
          active?: boolean;
          status?: string;
          purchaseOrders?: Record<string, { poNumber?: string }>;
        }
      >;
      const matchEntry = Object.entries(accounts).find(([, v]) => {
        const num = String(v.accountNumber ?? "").toUpperCase();
        const code = String(v.accountCode ?? v.AccountCode ?? "").toUpperCase();
        const needle = accountNum.toUpperCase();
        return num === needle || code === needle;
      });
      if (!matchEntry) {
        setBaError("Account number not found. Please check and try again.");
        return false;
      }
      const [accountId, accountData] = matchEntry;
      if (accountData.active === false || (accountData.status && accountData.status !== "active")) {
        setBaError("This account is not currently active.");
        return false;
      }
      // Validate PO when the account has purchase orders on file; otherwise allow account-only.
      const pos = accountData.purchaseOrders ?? {};
      const poKeys = Object.keys(pos);
      if (poKeys.length > 0) {
        const poEntry = Object.entries(pos).find(
          ([, v]) => v.poNumber?.toUpperCase() === poNum.toUpperCase()
        );
        if (!poEntry) {
          setBaError("Purchase order number not found on this account.");
          return false;
        }
        const [poId] = poEntry;
        setResolvedBA({ id: accountId, name: accountData.name ?? accountNum, poId, poNumber: poNum });
      } else {
        if (!poNum) {
          // PO still required in UI, but accept any non-empty when account has no POs seeded
          setBaError("Please enter a purchase order / reference for this account.");
          return false;
        }
        setResolvedBA({ id: accountId, name: accountData.name ?? accountNum, poId: "manual", poNumber: poNum });
      }
      return true;
    } catch {
      setBaError("Could not verify account. Please check your connection and try again.");
      return false;
    } finally {
      setBaValidating(false);
    }
  };

  // Validate ACC claim number against Firebase accClients
  const validateACC = async (): Promise<boolean> => {
    const claimNum = accClaimInput.trim();
    if (!claimNum) {
      setAccError("Please enter your ACC claim number.");
      return false;
    }
    setAccValidating(true);
    setAccError(null);
    try {
      const snap = await get(ref(rtdb, `accClients/${effectiveCompanyId}`));
      if (!snap.exists()) {
        setAccError("No ACC clients found for this company.");
        return false;
      }
      const clients = snap.val() as Record<string, { claimNumber?: string; name?: string; status?: string }>;
      const matchEntry = Object.entries(clients).find(
        ([, v]) => v.claimNumber?.toUpperCase() === claimNum.toUpperCase()
      );
      if (!matchEntry) {
        setAccError("ACC claim number not found. Please check and try again.");
        return false;
      }
      const [clientId, clientData] = matchEntry;
      if (clientData.status && clientData.status !== "active") {
        setAccError("This ACC claim is not currently active.");
        return false;
      }
      setResolvedACC({ clientId, clientName: clientData.name ?? claimNum, claimNumber: claimNum });
      return true;
    } catch {
      setAccError("Could not verify claim. Please check your connection and try again.");
      return false;
    } finally {
      setAccValidating(false);
    }
  };

  // Validate gift card code against Firebase giftCards/{cid}/{code}
  const validateGiftCard = async (): Promise<boolean> => {
    const code = giftCardInput.trim().toUpperCase();
    if (!code) {
      setGiftCardError("Please enter your gift card code.");
      return false;
    }
    setGiftCardValidating(true);
    setGiftCardError(null);
    try {
      const gcSnap = await get(ref(rtdb, `giftCards/${effectiveCompanyId}/${code}`));
      if (!gcSnap.exists()) {
        setGiftCardError("Gift card not found. Please check your code.");
        return false;
      }
      const cardData = gcSnap.val() as { status?: string; balance?: number };
      if (cardData.status && cardData.status !== "active") {
        setGiftCardError(
          cardData.status === "used"
            ? "This gift card has already been used."
            : "This gift card is no longer active.",
        );
        return false;
      }
      setResolvedGiftCard({ id: code, code, balance: cardData.balance ?? 0 });
      return true;
    } catch {
      setGiftCardError("Could not verify gift card. Please check your connection and try again.");
      return false;
    } finally {
      setGiftCardValidating(false);
    }
  };

  const addStop = (place: PlaceDetail) => {
    const stop: Stop = { id: Date.now().toString(), place };
    setStops((prev) => [...prev, stop]);
    setAddingStop(false);
  };

  const removeStop = (id: string) => {
    setStops((prev) => prev.filter((s) => s.id !== id));
  };

  const goToVehicle = async () => {
    if (!pickup || !destination) {
      Alert.alert("Missing Info", "Please enter both pickup and destination.");
      return;
    }
    // ASAP blocked when company dispatch is offline or outside operating hours
    if (asapBlocked && !isScheduled) {
      Alert.alert(
        asapBlockReason === "outside_hours" ? "Outside operating hours" : "Dispatch offline",
        asapBlockReason === "outside_hours"
          ? "This company is outside its configured operating hours. You can schedule a ride for a later time instead."
          : "This company's dispatch is not online right now. You can schedule a ride for a later time instead.",
        [
          { text: "Go Back", style: "cancel" },
          {
            text: "Book for Later",
            onPress: async () => {
              setIsScheduled(true);
              const result = await fetchRoute();
              if (!result) {
                Alert.alert("Route Error", "Could not calculate a route. Please check your addresses and try again.");
                return;
              }
              setStep("vehicle");
            },
          },
        ],
      );
      return;
    }
    const result = await fetchRoute();
    if (!result) {
      Alert.alert("Route Error", "Could not calculate a route. Please check your addresses and try again.");
      return;
    }
    setStep("vehicle");
  };

  const goToConfirm = () => {
    setStep("confirm");
  };

  const handleBook = async () => {
    // Allow anonymous Firebase users (guest) to book — firebaseUser has a UID for RTDB writes.
    // Only block if there is no Firebase auth token at all.
    if (!firebaseUser) { router.push("/auth/login"); return; }
    if (!pickup || !destination || !route) return;

    // Enforce scheduled time validity — must be at least 30 minutes from now
    if (isScheduled && !scheduledAtValid) {
      Alert.alert("Invalid Time", "Scheduled ride must be at least 30 minutes from now. Please pick a later time.");
      return;
    }

    if (payment === "wallet" && user && user.walletBalance < (discountedFare ?? 0)) {
      Alert.alert("Insufficient Balance", "Add funds to your wallet or choose another payment.");
      return;
    }
    if (isTM && tmPassengers.length === 0) {
      Alert.alert("TM Card Required", "Please add at least one Total Mobility card before booking.");
      return;
    }

    // Validate Business Account before proceeding
    if (payment === "business_account") {
      const valid = resolvedBA ? true : await validateBusinessAccount();
      if (!valid) return;
    }

    // Validate ACC before proceeding
    if (payment === "acc") {
      const valid = resolvedACC ? true : await validateACC();
      if (!valid) return;
    }

    // Validate Gift Card before proceeding
    if (payment === "gift_card") {
      const valid = resolvedGiftCard ? true : await validateGiftCard();
      if (!valid) return;
    }

    // Safety guard — UI should have blocked this, but double-check here
    if (asapBlocked) return;

    // If "Any Available" was selected, resolve to the first real registered company.
    // For ASAP rides, prefer companies with dispatch online + in hours. For scheduled,
    // any real company will do. Never resolve to load-test harness tenants (bwtest*).
    const realCompanies = companies.filter(
      (c) => c.id !== "any" && !isLoadTestCompanyId(c.id),
    );
    const effectiveCompany =
      company.id === "any"
        ? scheduledAt
          ? (realCompanies[0] ?? company)
          : (realCompanies.find((c) => c.asapBookable !== false) ??
             realCompanies[0] ??
             company)
        : company;

    if (isLoadTestCompanyId(effectiveCompany.id)) {
      Alert.alert(
        "Company unavailable",
        "This test company is not available for passenger bookings. Please choose Invercargill Taxis or another live company.",
      );
      return;
    }

    setStripeError(null);
    setBooking(true);
    setBookingStatus("Connecting…");
    let rideStarted = false;
    let bookingId: string | null = null;
    try {
      bookingId = await startRide(
        {
          pickup,
          destination,
          stops,
          companyId: effectiveCompany.id,
          vehicleType,
          payment,
          walletAmountPending: payment === "card" && walletContribution > 0 ? walletContribution : 0,
          fare: discountedFare ?? fare?.total ?? 0,
          route,
          promoCode: discount > 0 ? promo : undefined,
          discount: discount > 0 ? discount : undefined,
          rideshare,
          passengerCount: rideshare ? passengerCount : 1,
          isTM,
          tmPassengers: isTM ? tmPassengers : undefined,
          // tmCouncilAmount = fare subsidy only (not hoist — hoist is in tmHoistFeeTotal)
          tmCouncilAmount: tmSplit?.councilSubsidy,
          // tmPassengerAmount = passenger's share of the FARE only — council covers the hoist fee
          tmPassengerAmount: tmSplit?.passengerPays,
          tmHoistCount: hoistCount,
          // tmHoistFeeTotal = council-covered hoist fee (separate from the fare subsidy)
          tmHoistFeeTotal: isTM ? totalHoistFee : undefined,
          scheduledAt: scheduledAt?.toISOString(),
          // Business Account fields
          businessAccountId: resolvedBA?.id,
          businessAccountName: resolvedBA?.name,
          purchaseOrderId: resolvedBA?.poId,
          purchaseOrderNumber: resolvedBA?.poNumber,
          // ACC fields
          accClaimNumber: resolvedACC?.claimNumber,
          accClientId: resolvedACC?.clientId,
          accClientName: resolvedACC?.clientName,
          // Gift Card fields
          giftCardCode: resolvedGiftCard?.code,
          giftCardId: resolvedGiftCard?.id,
          pickupNote: pickupNote.trim() || undefined,
        },
        (attempt, total) => {
          setBookingStatus(`Connecting… (retry ${attempt - 1}/${total - 1})`);
        },
      );
      rideStarted = true;

      // Fire-and-forget: mark rental promo as used + record in rentalTaxiRequests
      if (promoIsRental && promo && discount > 0) {
        const rentalCode = promo.trim().toUpperCase();
        update(ref(rtdb, `rentalPromos/${rentalCode}`), { status: "used" }).catch(() => {});
        set(ref(rtdb, `rentalTaxiRequests/${bookingId}`), {
          bookingId,
          promoCode: rentalCode,
          discountPercent: Math.round(discount * 100),
          passengerName: user?.name ?? firebaseUser?.displayName ?? "Guest",
          passengerPhone: user?.phone ?? firebaseUser?.phoneNumber ?? "",
          passengerEmail: user?.email ?? firebaseUser?.email ?? "",
          pickup: pickup?.address,
          destination: destination?.address,
          companyId: effectiveCompany.id,
          companyName: effectiveCompany.name,
          vehicleType,
          fare: discountedFare ?? fare?.total ?? 0,
          originalFare: fare?.total ?? 0,
          payment,
          scheduledAt: scheduledAt?.toISOString() ?? null,
          createdAt: Date.now(),
          status: "booked",
        }).catch(() => {});
      }

      // Fire-and-forget: notify company owner by email ONLY for scheduled (pre-booked) rides.
      // ASAP bookings go straight to the dispatcher via RTDB — no email needed.
      if (scheduledAt && effectiveCompany.ownerEmail) {
        const baseDomain = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
        const apiBase = baseDomain ? `https://${baseDomain}` : "";
        fetch(`${apiBase}/api/notify-booking`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyEmail: effectiveCompany.ownerEmail,
            companyName: effectiveCompany.name,
            bookingId,
            passengerName: user?.name ?? firebaseUser?.displayName ?? "Passenger",
            passengerEmail: user?.email ?? firebaseUser?.email ?? undefined,
            passengerPhone: firebaseUser?.phoneNumber ?? undefined,
            pickup: pickup.address,
            destination: destination.address,
            stops: stops.map((s) => s.place.address),
            vehicleType: VEHICLE_LABELS[vehicleType],
            fare: formatCurrency(discountedFare ?? fare?.total ?? 0),
            payment,
            scheduledFor: scheduledAt.toISOString(),
          }),
        }).catch(() => {});
      }

      if (payment === "card") {
        // Wallet covers full fare — no Stripe; mark paid + release to dispatch.
        if (walletContribution > 0 && netFare <= 0) {
          setBookingStatus("Applying wallet…");
          await updateWallet(-walletContribution);
          await verifyAndDispatchBooking({
            companyId: effectiveCompany.id,
            bookingId: bookingId!,
            walletOnly: true,
            walletAmountApplied: walletContribution,
          });
          markPaymentConfirmed();
        } else {
          const stripeAmount = walletContribution > 0 ? netFare : (discountedFare ?? fare?.total ?? 0);
          setBookingStatus("Opening payment…");
          const session = await openStripeCheckout({
            cid: effectiveCompany.id,
            bookingId: bookingId!,
            description: `Taxi booking – ${pickup.address} to ${destination.address}`,
            amount: stripeAmount,
            currency: "nzd",
            email: user?.email ?? undefined,
            walletAmountPending: walletContribution > 0 ? walletContribution : 0,
          });
          setBookingStatus("Confirming payment…");
          await verifyAndDispatchBooking({
            companyId: effectiveCompany.id,
            bookingId: bookingId!,
            sessionId: session.sessionId,
            walletAmountPending: walletContribution > 0 ? walletContribution : 0,
          });
          // Debit wallet only after Stripe confirms (website parity).
          if (walletContribution > 0) {
            updateWallet(-walletContribution).catch(() => {});
          }
          // Server writes paymentStatus "paid"; map locally so the ride UI shows Confirmed.
          markPaymentConfirmed();
        }
        if (scheduledAt) {
          notify(
            "Ride Scheduled!",
            "Payment confirmed — your booking is saved. We'll dispatch before your pickup time.",
            "success",
          );
        } else {
          notify("Booking created", "We'll find you a driver — watch Active Ride for updates.", "info");
        }
      } else if (payment === "wallet") {
        // Pure wallet payment — deduct the full fare immediately from the wallet
        const fareToDeduct = discountedFare ?? fare?.total ?? 0;
        updateWallet(-fareToDeduct).catch(() => {});
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (scheduledAt) {
        router.replace("/(tabs)/scheduled");
      } else {
        router.replace({
          pathname: "/active-ride",
          params: {
            booking: bookingId || "",
            cid: effectiveCompany.id,
          },
        });
      }
    } catch (err: any) {
      if (err instanceof StripeCheckoutCancelledError || err?.name === "StripeCheckoutCancelledError") {
        // Explicit Stripe cancel URL only — safe to clear the unpaid hold.
        if (rideStarted) abortRide();
        setStripeError("Payment was cancelled. Your booking was not charged — you can try again.");
        return;
      }
      if (rideStarted) {
        // abortRide sends the cancel to the server via API (thin-client rule — no direct RTDB writes).
        // Only after verify failure / hard errors — never after a successful pay + deep-link dismiss.
        abortRide();
      }
      const raw: string = err?.message ?? "";
      const friendly = raw.toLowerCase().includes("booking service") || raw.toLowerCase().includes("unavailable")
        ? "Could not reach the booking service. Please check your connection and try again."
        : raw.toLowerCase().includes("stripe") || raw.toLowerCase().includes("not configured") || raw.toLowerCase().includes("payment") || raw.toLowerCase().includes("confirm")
        ? "Card payment could not be confirmed. Check My Rides before rebooking — do not pay twice."
        : raw || "Something went wrong. Please try again.";
      setStripeError(friendly);
    } finally {
      setBooking(false);
      setBookingStatus(null);
    }
  };

  const PAYMENT_OPTIONS: { id: PaymentMethodRide; label: string; icon: keyof typeof Feather.glyphMap }[] = isTM
    ? [
        // TM remainder: Cash always available regardless of company/platform cash toggle
        { id: "cash", label: "Cash", icon: "dollar-sign" },
        { id: "card", label: "Card", icon: "credit-card" },
        { id: "account", label: "Account", icon: "briefcase" },
        ...(showACC ? [{ id: "acc" as PaymentMethodRide, label: "ACC", icon: "shield" as keyof typeof Feather.glyphMap }] : []),
        { id: "gift_card" as PaymentMethodRide, label: "Gift Card", icon: "gift" as keyof typeof Feather.glyphMap },
      ]
    : [
        // Regular (non-TM): Cash only when platform cash toggle allows it
        ...(platformCashEnabled
          ? [{ id: "cash" as PaymentMethodRide, label: "Cash", icon: "dollar-sign" as keyof typeof Feather.glyphMap }]
          : []),
        { id: "card", label: "Card", icon: "credit-card" },
        ...(user ? [{ id: "wallet" as PaymentMethodRide, label: `Wallet ($${user.walletBalance.toFixed(2)})`, icon: "smartphone" as keyof typeof Feather.glyphMap }] : []),
        { id: "account", label: "Account", icon: "briefcase" },
        ...(showBusinessAccount ? [{ id: "business_account" as PaymentMethodRide, label: "Business Account", icon: "briefcase" as keyof typeof Feather.glyphMap }] : []),
        ...(showACC ? [{ id: "acc" as PaymentMethodRide, label: "ACC", icon: "shield" as keyof typeof Feather.glyphMap }] : []),
        { id: "gift_card" as PaymentMethodRide, label: "Gift Card", icon: "gift" as keyof typeof Feather.glyphMap },
      ];

  const topPad = Platform.OS === "web" ? insets.top + 67 : insets.top;

  const editingPassenger = editingPassengerId
    ? tmPassengers.find((p) => p.id === editingPassengerId)
    : undefined;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 10, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => step === "location" ? router.back() : setStep(step === "confirm" ? "vehicle" : "location")}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          {step === "location" ? "Book a Waka" : step === "vehicle" ? "Choose Vehicle" : "Confirm Ride"}
        </Text>
        <View style={styles.stepDots}>
          {(["location", "vehicle", "confirm"] as Step[]).map((s) => (
            <View key={s} style={[styles.dot, { backgroundColor: step === s ? colors.primary : colors.border }]} />
          ))}
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 220 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
      >
        {/* STEP 1: Location */}
        {step === "location" && (
          <View style={styles.section}>
            {/* TM Toggle */}
            <Pressable
              onPress={toggleTM}
              style={[
                styles.tmToggleCard,
                {
                  backgroundColor: isTM ? "#1d4ed820" : colors.card,
                  borderColor: isTM ? colors.primary : colors.border,
                },
              ]}
            >
              <View style={styles.tmToggleLeft}>
                <View style={[styles.tmIconBadge, { backgroundColor: isTM ? colors.primary : colors.muted }]}>
                  <Feather name="shield" size={18} color={isTM ? "#fff" : colors.mutedForeground} />
                </View>
                <View style={styles.tmToggleText}>
                  <Text style={[styles.tmToggleTitle, { color: colors.foreground }]}>Total Mobility Passenger</Text>
                  <Text style={[styles.tmToggleSub, { color: colors.mutedForeground }]}>
                    {isTM
                      ? `Council covers ${tmSettings.subsidyPercentage}% (up to ${formatCurrency(tmSettings.subsidyCap)})`
                      : "Toggle on if you have a TM entitlement card"}
                  </Text>
                </View>
              </View>
              <View style={[styles.toggle, { backgroundColor: isTM ? colors.primary : colors.muted }]}>
                <View style={[styles.toggleThumb, { transform: [{ translateX: isTM ? 18 : 2 }] }]} />
              </View>
            </Pressable>

            {/* TM Passengers */}
            {isTM && (
              <View style={[styles.tmPassengerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.tmPassengerHeader}>
                  <Feather name="credit-card" size={15} color={colors.primary} />
                  <Text style={[styles.tmPassengerTitle, { color: colors.foreground }]}>TM Cards</Text>
                  <Text style={[styles.tmPassengerCount, { backgroundColor: colors.primary + "20", color: colors.primary }]}>
                    {tmPassengers.length}
                  </Text>
                </View>

                {tmPassengers.map((p, i) => (
                  <View key={p.id} style={[styles.tmCardRow, { borderColor: colors.border }]}>
                    <View style={[styles.tmCardIcon, { backgroundColor: colors.primary + "15" }]}>
                      <Feather name="user" size={14} color={colors.primary} />
                    </View>
                    <View style={styles.tmCardInfo}>
                      <Text style={[styles.tmCardName, { color: colors.foreground }]}>{p.cardholderName}</Text>
                      <Text style={[styles.tmCardSub, { color: colors.mutedForeground }]}>
                        {p.cardNumber} · Exp {p.expiryDate}
                        {p.needsHoist ? " · Hoist" : ""}
                      </Text>
                    </View>
                    <Pressable onPress={() => openScanner(p.id)} style={styles.tmCardAction}>
                      <Feather name="edit-2" size={14} color={colors.mutedForeground} />
                    </Pressable>
                    <Pressable onPress={() => removePassenger(p.id)} style={styles.tmCardAction}>
                      <Feather name="x" size={14} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                ))}

                <Pressable
                  onPress={() => openScanner()}
                  style={[styles.addTMBtn, { borderColor: colors.primary }]}
                >
                  <Feather name="plus" size={14} color={colors.primary} />
                  <Text style={[styles.addTMBtnText, { color: colors.primary }]}>
                    {tmPassengers.length === 0 ? "Add your TM card" : "Add another passenger"}
                  </Text>
                </Pressable>

                {hoistCount > 0 && (
                  <View style={[styles.hoistBadge, { backgroundColor: "#f59e0b20", borderColor: "#f59e0b40" }]}>
                    <Feather name="arrow-up" size={13} color="#f59e0b" />
                    <Text style={[styles.hoistBadgeText, { color: "#f59e0b" }]}>
                      {hoistCount} hoist lift{hoistCount > 1 ? "s" : ""} — council pays {formatCurrency(totalHoistFee)}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* ── Now / Later toggle ──────────────────────────────────────── */}
            <View style={[styles.nowLaterRow, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Pressable
                onPress={() => { Haptics.selectionAsync(); setIsScheduled(false); }}
                style={[styles.nowLaterTab, !isScheduled && { backgroundColor: colors.card, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 }]}
              >
                <Feather name="zap" size={13} color={!isScheduled ? colors.primary : colors.mutedForeground} />
                <Text style={[styles.nowLaterTabText, { color: !isScheduled ? colors.primary : colors.mutedForeground, fontFamily: !isScheduled ? "Inter_600SemiBold" : "Inter_400Regular" }]}>Now</Text>
              </Pressable>
              <Pressable
                onPress={() => { Haptics.selectionAsync(); setIsScheduled(true); }}
                style={[styles.nowLaterTab, isScheduled && { backgroundColor: colors.card, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 }]}
              >
                <Feather name="calendar" size={13} color={isScheduled ? colors.primary : colors.mutedForeground} />
                <Text style={[styles.nowLaterTabText, { color: isScheduled ? colors.primary : colors.mutedForeground, fontFamily: isScheduled ? "Inter_600SemiBold" : "Inter_400Regular" }]}>Schedule</Text>
              </Pressable>
            </View>

            {/* ── Date / time picker (visible when "Later" is selected) ───── */}
            {isScheduled && (
              <View style={[styles.pickerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {/* Date chips */}
                <Text style={[styles.pickerLabel, { color: colors.mutedForeground }]}>DATE</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
                  {Array.from({ length: 14 }, (_, i) => {
                    const label = getTZDateChipLabel(bookingTZ, i);
                    const isActive = pickerDaysAhead === i;
                    return (
                      <Pressable
                        key={i}
                        onPress={() => { Haptics.selectionAsync(); setPickerDaysAhead(i); }}
                        style={[styles.pickerDateChip, { backgroundColor: isActive ? colors.primary : colors.muted, borderColor: isActive ? colors.primary : colors.border }]}
                      >
                        <Text style={[styles.pickerDateChipText, { color: isActive ? "#fff" : colors.foreground }]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                {/* Time picker — row 1: hour stepper + AM/PM */}
                <Text style={[styles.pickerLabel, { color: colors.mutedForeground, marginTop: 12 }]}>TIME</Text>
                <View style={styles.pickerTimeRow}>
                  {/* Hour */}
                  <View style={[styles.pickerStepper, { backgroundColor: colors.muted, borderColor: colors.border, flex: 1 }]}>
                    <Pressable onPress={() => { Haptics.selectionAsync(); setPickerHour((h) => (h === 1 ? 12 : h - 1)); }} hitSlop={12}>
                      <Feather name="chevron-left" size={20} color={colors.foreground} />
                    </Pressable>
                    <Text style={[styles.pickerStepperVal, { color: colors.foreground, flex: 1, textAlign: "center" }]}>{String(pickerHour).padStart(2, "0")}</Text>
                    <Pressable onPress={() => { Haptics.selectionAsync(); setPickerHour((h) => (h === 12 ? 1 : h + 1)); }} hitSlop={12}>
                      <Feather name="chevron-right" size={20} color={colors.foreground} />
                    </Pressable>
                  </View>
                  {/* AM/PM */}
                  <View style={[styles.pickerAmPmGroup, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                    {(["AM", "PM"] as const).map((v) => (
                      <Pressable
                        key={v}
                        onPress={() => { Haptics.selectionAsync(); setPickerAmPm(v); }}
                        style={[styles.pickerAmPmBtn, pickerAmPm === v && { backgroundColor: colors.primary }]}
                      >
                        <Text style={[styles.pickerAmPmText, { color: pickerAmPm === v ? "#fff" : colors.mutedForeground }]}>{v}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                {/* Time picker — row 2: minutes (full width) */}
                <Text style={[styles.pickerLabel, { color: colors.mutedForeground, marginTop: 10 }]}>MINUTES</Text>
                <View style={styles.pickerMinRow}>
                  {PICK_MINS.map((m, i) => (
                    <Pressable
                      key={m}
                      onPress={() => { Haptics.selectionAsync(); setPickerMinIdx(i); }}
                      style={[styles.pickerMinChip, { backgroundColor: pickerMinIdx === i ? colors.primary : colors.muted, borderColor: pickerMinIdx === i ? colors.primary : colors.border }]}
                    >
                      <Text style={[styles.pickerMinChipText, { color: pickerMinIdx === i ? "#fff" : colors.foreground }]}>:{m}</Text>
                    </Pressable>
                  ))}
                </View>

                {/* Preview + validation */}
                <View style={[styles.pickerPreviewRow, { borderTopColor: colors.border }]}>
                  <Feather name="clock" size={13} color={scheduledAtValid ? colors.primary : colors.destructive} />
                  {scheduledAtValid
                    ? <Text style={[styles.pickerPreviewText, { color: colors.primary }]}>Ride scheduled for {scheduledAtLabel}</Text>
                    : <Text style={[styles.pickerPreviewText, { color: colors.destructive }]}>Must be at least 30 minutes from now</Text>
                  }
                </View>
              </View>
            )}

            {/* Use my location button */}
            <Pressable
              onPress={useCurrentLocation}
              disabled={locating}
              style={({ pressed }) => [
                styles.myLocationBtn,
                { backgroundColor: colors.card, borderColor: colors.primary, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              {locating
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Feather name="navigation" size={16} color={colors.primary} />
              }
              <View style={{ flex: 1 }}>
                <Text style={[styles.myLocationTitle, { color: colors.primary }]}>
                  {locating ? "Detecting your location..." : "Use my current location"}
                </Text>
                {pickup && !locating && (
                  <Text style={[styles.myLocationSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {pickup.address}
                  </Text>
                )}
                {!pickup && !locating && (
                  <Text style={[styles.myLocationSub, { color: colors.mutedForeground }]}>
                    Auto-fill pickup with GPS
                  </Text>
                )}
              </View>
              {pickup && !locating && (
                <Feather name="check-circle" size={18} color={colors.success} />
              )}
            </Pressable>
            {locationError && (
              <View style={[styles.locationErrorBanner, { backgroundColor: "#fef2f2", borderColor: "#fecaca" }]}>
                <Feather name="alert-circle" size={13} color="#ef4444" />
                <Text style={[styles.locationErrorText, { color: "#ef4444" }]}>{locationError}</Text>
              </View>
            )}

            <View style={[styles.locationCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <PlacesAutocomplete
                placeholder="Pickup location"
                value={pickup?.address ?? ""}
                onSelect={setPickup}
                icon="circle"
                iconColor={colors.success}
                locationBias={placesBias}
                role="pickup"
              />
              {stops.map((stop) => (
                <View key={stop.id} style={styles.stopRow}>
                  <View style={[styles.stopLine, { backgroundColor: colors.border }]} />
                  <View style={[styles.stopInputRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
                    <Feather name="map-pin" size={14} color={colors.warning} />
                    <Text style={[styles.stopText, { color: colors.foreground }]} numberOfLines={1} ellipsizeMode="tail">
                      {stop.place.address}
                    </Text>
                    <Pressable onPress={() => removeStop(stop.id)}>
                      <Feather name="x" size={14} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                </View>
              ))}
              {addingStop && (
                <PlacesAutocomplete
                  placeholder="Add stop..."
                  value=""
                  onSelect={addStop}
                  icon="map-pin"
                  iconColor={colors.warning}
                  autoFocus
                  locationBias={placesBias}
                  nearPickup={pickup?.location ?? null}
                  role="stop"
                />
              )}
              <PlacesAutocomplete
                placeholder="Destination"
                value={destination?.address ?? ""}
                onSelect={setDestination}
                icon="navigation"
                iconColor={colors.destructive}
                locationBias={placesBias}
                nearPickup={pickup?.location ?? null}
                role="destination"
              />
            </View>
            <Pressable
              onPress={() => setAddingStop(true)}
              style={[styles.addStopBtn, { borderColor: colors.border }]}
            >
              <Feather name="plus" size={14} color={colors.primary} />
              <Text style={[styles.addStopText, { color: colors.primary }]}>Add a stop</Text>
            </Pressable>
          </View>
        )}

        {/* STEP 2: Vehicle */}
        {step === "vehicle" && (
          <View style={styles.section}>
            {route && pickup && destination && (
              <RouteMap
                pickup={pickup.location}
                destination={destination.location}
                polyline={route.polylinePoints}
                distanceText={route.distanceText}
                durationText={route.durationText}
              />
            )}
            {loadingRoute && <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />}

            {isTM && (
              <View style={[styles.tmInfoBanner, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
                <Feather name="shield" size={14} color={colors.primary} />
                <Text style={[styles.tmInfoBannerText, { color: colors.primary }]}>
                  Showing TM-approved companies only · {tmSettings.subsidyPercentage}% subsidy up to {formatCurrency(tmSettings.subsidyCap)}
                </Text>
              </View>
            )}

            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>TRANSPORT COMPANY</Text>
            {visibleCompanies.length === 0 && (
              <View style={[styles.noDriverBanner, { backgroundColor: "#fef3c7", borderColor: "#fbbf24" }]}>
                <Feather name="wifi-off" size={15} color="#d97706" />
                <Text style={[styles.noDriverText, { color: "#92400e" }]}>
                  {isTM
                    ? "No TM-approved companies are accepting bookings right now."
                    : "No companies are accepting ASAP bookings right now (dispatch offline or outside hours). You can schedule for later."}
                </Text>
              </View>
            )}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.companyScroll}>
              {visibleCompanies.map((c) => {
                const offline = c.asapBookable === false;
                const isSelected = company.id === c.id;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => { Haptics.selectionAsync(); setCompany(c); }}
                    style={({ pressed }) => [
                      styles.companyChip,
                      {
                        backgroundColor: isSelected ? (offline ? colors.muted : c.color) : colors.card,
                        borderColor: isSelected ? (offline ? colors.border : c.color) : colors.border,
                        opacity: pressed ? 0.8 : offline ? 0.6 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.companyChipText, { color: isSelected && !offline ? "#fff" : colors.foreground }]}>
                      {c.name}
                    </Text>
                    {offline ? (
                      <View style={styles.companyRating}>
                        <Feather name="wifi-off" size={10} color={colors.mutedForeground} />
                        <Text style={[styles.companyRatingText, { color: colors.mutedForeground }]}>
                          {c.dispatchOnline === false ? "Dispatch off" : "Closed"}
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.companyRating}>
                        <Feather name="star" size={10} color={isSelected ? "rgba(255,255,255,0.8)" : colors.warning} />
                        <Text style={[styles.companyRatingText, { color: isSelected ? "rgba(255,255,255,0.8)" : colors.mutedForeground }]}>
                          {c.rating}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* ASAP blocked: dispatch offline or outside hours — offer schedule */}
            {asapBlocked && (
              <View style={{ alignItems: "center", paddingVertical: 40, gap: 16 }}>
                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }}>
                  <Feather name="wifi-off" size={28} color={colors.mutedForeground} />
                </View>
                <Text style={{ fontSize: 17, fontFamily: "Inter_600SemiBold", color: colors.foreground, textAlign: "center" }}>
                  {asapBlockReason === "outside_hours"
                    ? "Outside operating hours"
                    : "Dispatch is offline"}
                </Text>
                <Text style={{ fontSize: 14, color: colors.mutedForeground, textAlign: "center", lineHeight: 20, paddingHorizontal: 24 }}>
                  {asapBlockReason === "outside_hours"
                    ? "This company is outside its configured hours. Schedule a ride for a time when they are open."
                    : "This company's dispatch console is not online. You can still schedule a ride for later."}
                </Text>
                <Pressable
                  onPress={() => setIsScheduled(true)}
                  style={{ backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 28, paddingVertical: 14, flexDirection: "row", alignItems: "center", gap: 8 }}
                >
                  <Feather name="calendar" size={16} color="#fff" />
                  <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 }}>Schedule a Ride</Text>
                </Pressable>
              </View>
            )}
            {!asapBlocked && (
              <View>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>VEHICLE TYPE</Text>
                <View style={styles.vehicleGrid}>
                  {company.vehicles.map((v) => {
                    const isSelected = vehicleType === v;
                    const liveTariff = getVehicleTariff(company, v);
                    const tmTariff = isTM
                      ? (v === "Wheelchair" ? company.tmWheelchairTariff : company.tmCarTariff) ?? liveTariff
                      : undefined;
                    const vFare = route ? calculateFare(route.distanceMeters, route.durationSeconds, v, stops.length, tmTariff ?? liveTariff) : null;
                    const vSplit = isTM && vFare ? calcTMSubsidy(vFare.total, tmSettings) : null;
                    const vIcon = v === "Wheelchair" ? "truck" : v === "Electric" ? "zap" : v === "Luxury" ? "award" : v === "Van" ? "truck" : "navigation";
                    return (
                      <Pressable
                        key={v}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setVehicleType(v);
                          if (company.vehicles.length === 1) {
                            setTimeout(() => goToConfirm(), 120);
                          }
                        }}
                        style={({ pressed }) => [
                          styles.vehicleCard,
                          { backgroundColor: isSelected ? colors.primary : colors.card, borderColor: isSelected ? colors.primary : colors.border, opacity: pressed ? 0.8 : 1 },
                        ]}
                      >
                        <Feather name={vIcon} size={20} color={isSelected ? "#fff" : colors.mutedForeground} />
                        <Text style={[styles.vehicleLabel, { color: isSelected ? "#fff" : colors.foreground }]}>{VEHICLE_LABELS[v]}</Text>
                        <Text style={[styles.vehicleCap, { color: isSelected ? "rgba(255,255,255,0.7)" : colors.mutedForeground }]}>
                          {VEHICLE_CAPACITY[v]} seats
                        </Text>
                        {vFare && !isTM && (
                          <Text style={[styles.vehiclePrice, { color: isSelected ? "#fff" : colors.primary }]}>
                            {formatCurrency(vFare.total)}
                          </Text>
                        )}
                        {vFare && isTM && vSplit && (
                          <View style={styles.vehicleTMPrices}>
                            <Text style={[styles.vehiclePrice, { color: isSelected ? "#fff" : colors.primary }]}>
                              {formatCurrency(vSplit.passengerPays)}
                            </Text>
                            <Text style={[styles.vehicleTMSub, { color: isSelected ? "rgba(255,255,255,0.65)" : colors.mutedForeground }]}>
                              you pay
                            </Text>
                          </View>
                        )}
                        {isTM && (
                          <View style={[styles.tmVehicleBadge, { backgroundColor: isSelected ? "rgba(255,255,255,0.25)" : colors.primary + "20" }]}>
                            <Feather name="shield" size={9} color={isSelected ? "#fff" : colors.primary} />
                            <Text style={[styles.tmVehicleBadgeText, { color: isSelected ? "#fff" : colors.primary }]}>TM rate</Text>
                          </View>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}
          </View>
        )}

        {/* STEP 3: Confirm */}
        {step === "confirm" && pickup && destination && fare && (
          <View style={styles.section}>
            <View style={[styles.confirmCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.confirmRow}>
                <View style={[styles.confirmDot, { backgroundColor: colors.success }]} />
                <Text style={[styles.confirmText, { color: colors.foreground }]} numberOfLines={2}>{pickup.address}</Text>
              </View>
              {stops.map((s) => (
                <View key={s.id} style={styles.confirmRow}>
                  <View style={[styles.confirmDot, { backgroundColor: colors.warning }]} />
                  <Text style={[styles.confirmText, { color: colors.foreground }]} numberOfLines={1}>{s.place.address}</Text>
                </View>
              ))}
              <View style={styles.confirmRow}>
                <View style={[styles.confirmDot, { backgroundColor: colors.destructive }]} />
                <Text style={[styles.confirmText, { color: colors.foreground }]} numberOfLines={2}>{destination.address}</Text>
              </View>
            </View>

            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>PICKUP NOTE (OPTIONAL)</Text>
            <View style={[styles.fareCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <TextInput
                style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: colors.foreground, minHeight: 64, textAlignVertical: "top" }}
                placeholder="e.g. Gate B, blue door, call on arrival…"
                placeholderTextColor={colors.mutedForeground}
                value={pickupNote}
                onChangeText={setPickupNote}
                multiline
                maxLength={200}
              />
            </View>

            {/* Fare Breakdown */}
            <View style={[styles.fareCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>FARE BREAKDOWN</Text>
              <View style={styles.fareRow}>
                <Text style={[styles.fareLabel, { color: colors.mutedForeground }]}>Base fare</Text>
                <Text style={[styles.fareValue, { color: colors.foreground }]}>{formatCurrency(fare.breakdown.base)}</Text>
              </View>
              <View style={styles.fareRow}>
                <Text style={[styles.fareLabel, { color: colors.mutedForeground }]}>Distance ({route?.distanceText})</Text>
                <Text style={[styles.fareValue, { color: colors.foreground }]}>{formatCurrency(fare.breakdown.distance)}</Text>
              </View>
              <View style={styles.fareRow}>
                <Text style={[styles.fareLabel, { color: colors.mutedForeground }]}>Time ({route?.durationText})</Text>
                <Text style={[styles.fareValue, { color: colors.foreground }]}>{formatCurrency(fare.breakdown.time)}</Text>
              </View>
              {stops.length > 0 && (
                <View style={styles.fareRow}>
                  <Text style={[styles.fareLabel, { color: colors.mutedForeground }]}>Extra stops ({stops.length})</Text>
                  <Text style={[styles.fareValue, { color: colors.foreground }]}>{formatCurrency(fare.breakdown.stops)}</Text>
                </View>
              )}
              {isTM && (
                <View style={[styles.tmRateBadge, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "25" }]}>
                  <Feather name="shield" size={12} color={colors.primary} />
                  <Text style={[styles.tmRateBadgeText, { color: colors.primary }]}>TM tariff rate applied</Text>
                </View>
              )}
              {discount > 0 && (
                <View style={styles.fareRow}>
                  <Text style={[styles.fareLabel, { color: colors.success }]}>Discount ({Math.round(discount * 100)}%)</Text>
                  <Text style={[styles.fareValue, { color: colors.success }]}>-{formatCurrency(fare.total * discount)}</Text>
                </View>
              )}
              <View style={[styles.fareDivider, { backgroundColor: colors.border }]} />

              {isTM && tmSplit ? (
                <>
                  <View style={styles.fareRow}>
                    <Text style={[styles.fareLabel, { color: colors.foreground }]}>Trip total</Text>
                    <Text style={[styles.fareValue, { color: colors.foreground }]}>{formatCurrency(discountedFare ?? fare.total)}</Text>
                  </View>
                  <View style={[styles.tmSplitBox, { backgroundColor: "#16a34a10", borderColor: "#16a34a30" }]}>
                    <View style={styles.fareRow}>
                      <View style={styles.tmSplitLabel}>
                        <Feather name="shield" size={12} color="#16a34a" />
                        <Text style={[styles.fareLabel, { color: "#16a34a" }]}>
                          Council pays ({tmSettings.subsidyPercentage}% up to {formatCurrency(tmSettings.subsidyCap)})
                        </Text>
                      </View>
                      <Text style={[styles.fareValue, { color: "#16a34a" }]}>-{formatCurrency(tmSplit.councilSubsidy)}</Text>
                    </View>
                    {hoistCount > 0 && (
                      <View style={styles.fareRow}>
                        <View style={styles.tmSplitLabel}>
                          <Feather name="arrow-up" size={12} color="#16a34a" />
                          <Text style={[styles.fareLabel, { color: "#16a34a" }]}>
                            Council pays hoist ({hoistCount} × {formatCurrency(tmSettings.hoistFeePerLift)})
                          </Text>
                        </View>
                        <Text style={[styles.fareValue, { color: "#16a34a" }]}>-{formatCurrency(totalHoistFee)}</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.fareRow}>
                    <Text style={[styles.fareTotal, { color: colors.foreground }]}>You pay</Text>
                    <Text style={[styles.fareTotalValue, { color: colors.primary }]}>{formatCurrency(tmSplit.passengerPays)}</Text>
                  </View>
                </>
              ) : (
                <View style={styles.fareRow}>
                  <Text style={[styles.fareTotal, { color: colors.foreground }]}>Total</Text>
                  <Text style={[styles.fareTotalValue, { color: colors.primary }]}>{formatCurrency(discountedFare ?? fare.total)}</Text>
                </View>
              )}

              <View style={styles.fareRow}>
                <Text style={[styles.fareLabel, { color: colors.mutedForeground }]}>Vehicle</Text>
                <Text style={[styles.fareValue, { color: colors.foreground }]}>{VEHICLE_LABELS[vehicleType]} · {company.name}</Text>
              </View>
            </View>

            {/* TM passengers summary on confirm */}
            {isTM && tmPassengers.length > 0 && (
              <View style={[styles.tmConfirmCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.tmConfirmHeader}>
                  <Feather name="shield" size={15} color={colors.primary} />
                  <Text style={[styles.tmConfirmTitle, { color: colors.foreground }]}>TM Passengers ({tmPassengers.length})</Text>
                  <Pressable onPress={() => openScanner()} style={[styles.tmConfirmAdd, { borderColor: colors.primary }]}>
                    <Feather name="plus" size={12} color={colors.primary} />
                    <Text style={[styles.tmConfirmAddText, { color: colors.primary }]}>Add</Text>
                  </Pressable>
                </View>
                {tmPassengers.map((p) => (
                  <View key={p.id} style={[styles.tmCardRow, { borderColor: colors.border }]}>
                    <View style={[styles.tmCardIcon, { backgroundColor: colors.primary + "15" }]}>
                      <Feather name="user" size={14} color={colors.primary} />
                    </View>
                    <View style={styles.tmCardInfo}>
                      <Text style={[styles.tmCardName, { color: colors.foreground }]}>{p.cardholderName}</Text>
                      <Text style={[styles.tmCardSub, { color: colors.mutedForeground }]}>
                        {p.cardNumber}{p.needsHoist ? " · Hoist lift" : ""}
                      </Text>
                    </View>
                    <Pressable onPress={() => openScanner(p.id)}>
                      <Feather name="edit-2" size={13} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            {/* Promo (non-TM only) */}
            {!isTM && (
              <>
                <View style={styles.promoRow}>
                  <View style={[styles.promoInput, { borderColor: discount > 0 ? colors.success : colors.border, backgroundColor: colors.card }]}>
                    <Feather name="tag" size={16} color={discount > 0 ? colors.success : colors.mutedForeground} />
                    <TextInput
                      style={[styles.promoText, { color: colors.foreground }]}
                      placeholder="Promo or R2R-XXXXXX code"
                      placeholderTextColor={colors.mutedForeground}
                      value={promo}
                      onChangeText={(t) => { setPromo(t); setPromoError(""); setDiscount(0); setPromoIsRental(false); }}
                      autoCapitalize="characters"
                      editable={!promoValidating}
                    />
                  </View>
                  <Pressable
                    onPress={applyPromo}
                    disabled={promoValidating || !promo.trim()}
                    style={[styles.promoBtn, { backgroundColor: colors.primary, opacity: promoValidating || !promo.trim() ? 0.6 : 1 }]}
                  >
                    {promoValidating
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={styles.promoBtnText}>Apply</Text>
                    }
                  </Pressable>
                </View>
                {promoError ? <Text style={[styles.promoError, { color: colors.destructive }]}>{promoError}</Text> : null}
                {discount > 0 ? (
                  <Text style={[styles.promoSuccess, { color: colors.success }]}>
                    {promoIsRental ? "Rental promo applied" : "Promo applied"} — {Math.round(discount * 100)}% off
                  </Text>
                ) : null}
              </>
            )}

            {/* Ride Sharing (non-TM only) */}
            {!isTM && (
              <View style={[styles.rideshareCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.rideshareHeader}>
                  <View style={styles.rideshareLeft}>
                    <Feather name="users" size={18} color={colors.primary} />
                    <View>
                      <Text style={[styles.rideshareTitle, { color: colors.foreground }]}>Ride Sharing</Text>
                      <Text style={[styles.rideshareSub, { color: colors.mutedForeground }]}>Split the cost with others</Text>
                    </View>
                  </View>
                  <Pressable
                    onPress={() => { Haptics.selectionAsync(); setRideshare(!rideshare); }}
                    style={[styles.toggle, { backgroundColor: rideshare ? colors.primary : colors.muted }]}
                  >
                    <View style={[styles.toggleThumb, { transform: [{ translateX: rideshare ? 18 : 2 }] }]} />
                  </Pressable>
                </View>
                {rideshare && (
                  <View style={styles.passengerRow}>
                    <Text style={[styles.passengerLabel, { color: colors.mutedForeground }]}>Passengers sharing:</Text>
                    {[2, 3, 4].map((n) => (
                      <Pressable
                        key={n}
                        onPress={() => { Haptics.selectionAsync(); setPassengerCount(n); }}
                        style={[styles.passengerBtn, { backgroundColor: passengerCount === n ? colors.primary : colors.card, borderColor: passengerCount === n ? colors.primary : colors.border }]}
                      >
                        <Text style={[styles.passengerBtnText, { color: passengerCount === n ? "#fff" : colors.foreground }]}>{n}</Text>
                      </Pressable>
                    ))}
                    {fare && (
                      <Text style={[styles.splitAmount, { color: colors.success }]}>
                        {formatCurrency(Math.round((discountedFare ?? fare.total) / passengerCount * 100) / 100)} each
                      </Text>
                    )}
                  </View>
                )}
              </View>
            )}

            {/* Wallet Credit — shown when user has a balance and isn't already paying by wallet */}
            {walletBalance > 0 && walletEligible && currentFare > 0 && (
              <View style={[styles.rideshareCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.rideshareHeader}>
                  <View style={styles.rideshareLeft}>
                    <Feather name="smartphone" size={18} color={colors.primary} />
                    <View>
                      <Text style={[styles.rideshareTitle, { color: colors.foreground }]}>Wallet Credit</Text>
                      <Text style={[styles.rideshareSub, { color: colors.mutedForeground }]}>
                        Balance: {formatCurrency(walletBalance)}
                      </Text>
                    </View>
                  </View>
                  <Pressable
                    onPress={() => { Haptics.selectionAsync(); setUseWalletCredit(!useWalletCredit); }}
                    style={[styles.toggle, { backgroundColor: useWalletCredit ? colors.primary : colors.muted }]}
                  >
                    <View style={[styles.toggleThumb, { transform: [{ translateX: useWalletCredit ? 18 : 2 }] }]} />
                  </Pressable>
                </View>
                {useWalletCredit && walletContribution > 0 && (
                  <View style={[styles.walletSplitBreakdown, { borderTopColor: colors.border }]}>
                    <View style={styles.fareRow}>
                      <Text style={[styles.fareLabel, { color: colors.mutedForeground }]}>
                        Wallet covers
                      </Text>
                      <Text style={[styles.fareValue, { color: "#16a34a" }]}>
                        -{formatCurrency(walletContribution)}
                      </Text>
                    </View>
                    <View style={styles.fareRow}>
                      <Text style={[styles.fareTotal, { color: colors.foreground }]}>
                        {payment === "card" ? "Card charge" : "Remaining to pay"}
                      </Text>
                      <Text style={[styles.fareTotalValue, { color: colors.primary }]}>
                        {netFare <= 0 ? "Free" : formatCurrency(netFare)}
                      </Text>
                    </View>
                    {netFare <= 0 && (
                      <Text style={[styles.rideshareSub, { color: "#16a34a", marginTop: 2 }]}>
                        Your wallet covers the full fare — no additional charge
                      </Text>
                    )}
                  </View>
                )}
              </View>
            )}

            {/* Payment */}
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              {isTM ? "REMAINDER PAYMENT METHOD" : "PAYMENT METHOD"}
            </Text>
            {isTM && tmSplit && (
              <Text style={[styles.tmPaymentNote, { color: colors.mutedForeground }]}>
                Your share: {formatCurrency(tmSplit.passengerPays)} — choose how to pay
              </Text>
            )}
            <View style={styles.paymentRow}>
              {PAYMENT_OPTIONS.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => { Haptics.selectionAsync(); setPayment(p.id); }}
                  style={({ pressed }) => [
                    styles.paymentOption,
                    {
                      backgroundColor: payment === p.id ? colors.primary + "15" : colors.card,
                      borderColor: payment === p.id ? colors.primary : colors.border,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <Feather name={p.icon} size={18} color={payment === p.id ? colors.primary : colors.mutedForeground} />
                  <Text style={[styles.paymentLabel, { color: payment === p.id ? colors.primary : colors.foreground }]} numberOfLines={2}>
                    {p.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Business Account inputs */}
            {payment === "business_account" && (
              <View style={[styles.accountInputCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.accountInputHeader}>
                  <Feather name="briefcase" size={15} color={colors.primary} />
                  <Text style={[styles.accountInputTitle, { color: colors.foreground }]}>Business Account</Text>
                </View>
                <View style={[styles.accountField, { borderColor: resolvedBA ? colors.success : colors.border, backgroundColor: colors.background }]}>
                  <Feather name="hash" size={14} color={resolvedBA ? colors.success : colors.mutedForeground} />
                  <TextInput
                    style={[styles.accountFieldText, { color: colors.foreground }]}
                    placeholder="Account number"
                    placeholderTextColor={colors.mutedForeground}
                    value={businessAccountInput}
                    onChangeText={setBusinessAccountInput}
                    autoCapitalize="characters"
                    editable={!baValidating && !resolvedBA}
                  />
                  {resolvedBA && <Feather name="check-circle" size={16} color={colors.success} />}
                </View>
                <View style={[styles.accountField, { borderColor: resolvedBA ? colors.success : colors.border, backgroundColor: colors.background }]}>
                  <Feather name="file-text" size={14} color={resolvedBA ? colors.success : colors.mutedForeground} />
                  <TextInput
                    style={[styles.accountFieldText, { color: colors.foreground }]}
                    placeholder="Purchase order number"
                    placeholderTextColor={colors.mutedForeground}
                    value={purchaseOrderInput}
                    onChangeText={setPurchaseOrderInput}
                    autoCapitalize="characters"
                    editable={!baValidating && !resolvedBA}
                  />
                  {resolvedBA && <Feather name="check-circle" size={16} color={colors.success} />}
                </View>
                {baError && (
                  <View style={[styles.accountError, { backgroundColor: colors.destructive + "12", borderColor: colors.destructive + "30" }]}>
                    <Feather name="alert-circle" size={13} color={colors.destructive} />
                    <Text style={[styles.accountErrorText, { color: colors.destructive }]}>{baError}</Text>
                  </View>
                )}
                {resolvedBA ? (
                  <View style={[styles.accountVerified, { backgroundColor: colors.success + "12", borderColor: colors.success + "30" }]}>
                    <Feather name="check-circle" size={13} color={colors.success} />
                    <Text style={[styles.accountVerifiedText, { color: colors.success }]}>
                      {resolvedBA.name} · PO {resolvedBA.poNumber}
                    </Text>
                    <Pressable onPress={() => { setResolvedBA(null); setBusinessAccountInput(""); setPurchaseOrderInput(""); }} style={{ marginLeft: "auto" }}>
                      <Feather name="x" size={14} color={colors.success} />
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    onPress={validateBusinessAccount}
                    disabled={baValidating || !businessAccountInput.trim() || !purchaseOrderInput.trim()}
                    style={[styles.accountVerifyBtn, { backgroundColor: colors.primary, opacity: baValidating || !businessAccountInput.trim() || !purchaseOrderInput.trim() ? 0.55 : 1 }]}
                  >
                    {baValidating
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={styles.accountVerifyBtnText}>Verify Account</Text>
                    }
                  </Pressable>
                )}
                {/* §113 — Account card photo (optional) */}
                {accountCardPhotoUri ? (
                  <View style={styles.cardPhotoRow}>
                    <Image source={{ uri: accountCardPhotoUri }} style={styles.cardPhotoThumb} resizeMode="cover" />
                    <Pressable onPress={() => setAccountCardPhotoUri(null)} style={[styles.cardPhotoRetake, { borderColor: colors.border }]}>
                      <Feather name="rotate-ccw" size={12} color={colors.mutedForeground} />
                      <Text style={[styles.cardPhotoRetakeText, { color: colors.mutedForeground }]}>Retake</Text>
                    </Pressable>
                  </View>
                ) : Platform.OS !== "web" ? (
                  <Pressable
                    onPress={async () => {
                      const r = await ImagePicker.launchCameraAsync({ mediaTypes: "images", quality: 0.7 });
                      if (!r.canceled && r.assets[0]) setAccountCardPhotoUri(r.assets[0].uri);
                    }}
                    style={[styles.cardPhotoBtn, { borderColor: colors.border }]}
                  >
                    <Feather name="camera" size={13} color={colors.mutedForeground} />
                    <Text style={[styles.cardPhotoBtnText, { color: colors.mutedForeground }]}>Take card photo (optional)</Text>
                  </Pressable>
                ) : null}
              </View>
            )}

            {/* ACC inputs */}
            {payment === "acc" && (
              <View style={[styles.accountInputCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.accountInputHeader}>
                  <Feather name="shield" size={15} color={colors.primary} />
                  <Text style={[styles.accountInputTitle, { color: colors.foreground }]}>ACC Claim</Text>
                </View>
                <View style={[styles.accountField, { borderColor: resolvedACC ? colors.success : colors.border, backgroundColor: colors.background }]}>
                  <Feather name="hash" size={14} color={resolvedACC ? colors.success : colors.mutedForeground} />
                  <TextInput
                    style={[styles.accountFieldText, { color: colors.foreground }]}
                    placeholder="ACC claim number"
                    placeholderTextColor={colors.mutedForeground}
                    value={accClaimInput}
                    onChangeText={setAccClaimInput}
                    autoCapitalize="characters"
                    editable={!accValidating && !resolvedACC}
                  />
                  {resolvedACC && <Feather name="check-circle" size={16} color={colors.success} />}
                </View>
                {accError && (
                  <View style={[styles.accountError, { backgroundColor: colors.destructive + "12", borderColor: colors.destructive + "30" }]}>
                    <Feather name="alert-circle" size={13} color={colors.destructive} />
                    <Text style={[styles.accountErrorText, { color: colors.destructive }]}>{accError}</Text>
                  </View>
                )}
                {resolvedACC ? (
                  <View style={[styles.accountVerified, { backgroundColor: colors.success + "12", borderColor: colors.success + "30" }]}>
                    <Feather name="check-circle" size={13} color={colors.success} />
                    <Text style={[styles.accountVerifiedText, { color: colors.success }]}>
                      {resolvedACC.clientName} · Claim {resolvedACC.claimNumber}
                    </Text>
                    <Pressable onPress={() => { setResolvedACC(null); setAccClaimInput(""); }} style={{ marginLeft: "auto" }}>
                      <Feather name="x" size={14} color={colors.success} />
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    onPress={validateACC}
                    disabled={accValidating || !accClaimInput.trim()}
                    style={[styles.accountVerifyBtn, { backgroundColor: colors.primary, opacity: accValidating || !accClaimInput.trim() ? 0.55 : 1 }]}
                  >
                    {accValidating
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={styles.accountVerifyBtnText}>Verify Claim</Text>
                    }
                  </Pressable>
                )}
                {/* §113 — ACC card photo (optional) */}
                {accCardPhotoUri ? (
                  <View style={styles.cardPhotoRow}>
                    <Image source={{ uri: accCardPhotoUri }} style={styles.cardPhotoThumb} resizeMode="cover" />
                    <Pressable onPress={() => setAccCardPhotoUri(null)} style={[styles.cardPhotoRetake, { borderColor: colors.border }]}>
                      <Feather name="rotate-ccw" size={12} color={colors.mutedForeground} />
                      <Text style={[styles.cardPhotoRetakeText, { color: colors.mutedForeground }]}>Retake</Text>
                    </Pressable>
                  </View>
                ) : Platform.OS !== "web" ? (
                  <Pressable
                    onPress={async () => {
                      const r = await ImagePicker.launchCameraAsync({ mediaTypes: "images", quality: 0.7 });
                      if (!r.canceled && r.assets[0]) setAccCardPhotoUri(r.assets[0].uri);
                    }}
                    style={[styles.cardPhotoBtn, { borderColor: colors.border }]}
                  >
                    <Feather name="camera" size={13} color={colors.mutedForeground} />
                    <Text style={[styles.cardPhotoBtnText, { color: colors.mutedForeground }]}>Take card photo (optional)</Text>
                  </Pressable>
                ) : null}
              </View>
            )}

            {/* Gift Card inputs */}
            {payment === "gift_card" && (
              <View style={[styles.accountInputCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.accountInputHeader}>
                  <Feather name="gift" size={15} color={colors.primary} />
                  <Text style={[styles.accountInputTitle, { color: colors.foreground }]}>Gift Card</Text>
                </View>
                <View style={[styles.accountField, { borderColor: resolvedGiftCard ? colors.success : colors.border, backgroundColor: colors.background }]}>
                  <Feather name="hash" size={14} color={resolvedGiftCard ? colors.success : colors.mutedForeground} />
                  <TextInput
                    style={[styles.accountFieldText, { color: colors.foreground }]}
                    placeholder="Gift card code"
                    placeholderTextColor={colors.mutedForeground}
                    value={giftCardInput}
                    onChangeText={(t) => setGiftCardInput(t.toUpperCase())}
                    autoCapitalize="characters"
                    editable={!giftCardValidating && !resolvedGiftCard}
                  />
                  {resolvedGiftCard && <Feather name="check-circle" size={16} color={colors.success} />}
                </View>
                {giftCardError && (
                  <View style={[styles.accountError, { backgroundColor: colors.destructive + "12", borderColor: colors.destructive + "30" }]}>
                    <Feather name="alert-circle" size={13} color={colors.destructive} />
                    <Text style={[styles.accountErrorText, { color: colors.destructive }]}>{giftCardError}</Text>
                  </View>
                )}
                {resolvedGiftCard ? (
                  <View style={[styles.accountVerified, { backgroundColor: colors.success + "12", borderColor: colors.success + "30" }]}>
                    <Feather name="check-circle" size={13} color={colors.success} />
                    <Text style={[styles.accountVerifiedText, { color: colors.success }]}>
                      Code {resolvedGiftCard.code}
                      {resolvedGiftCard.balance > 0 ? ` · Balance ${formatCurrency(resolvedGiftCard.balance)}` : ""}
                    </Text>
                    <Pressable onPress={() => { setResolvedGiftCard(null); setGiftCardInput(""); }} style={{ marginLeft: "auto" }}>
                      <Feather name="x" size={14} color={colors.success} />
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    onPress={validateGiftCard}
                    disabled={giftCardValidating || !giftCardInput.trim()}
                    style={[styles.accountVerifyBtn, { backgroundColor: colors.primary, opacity: giftCardValidating || !giftCardInput.trim() ? 0.55 : 1 }]}
                  >
                    {giftCardValidating
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={styles.accountVerifyBtnText}>Verify Gift Card</Text>
                    }
                  </Pressable>
                )}
              </View>
            )}
          </View>
        )}
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Bottom CTA */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16, backgroundColor: colors.background, borderTopColor: colors.border }]}>
        {step === "location" && (
          <Pressable
            onPress={goToVehicle}
            disabled={!pickup || !destination || (isScheduled && !scheduledAtValid)}
            style={({ pressed }) => [
              styles.cta,
              { backgroundColor: pickup && destination && !(isScheduled && !scheduledAtValid) ? colors.primary : colors.muted, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            {loadingRoute
              ? <ActivityIndicator color="#fff" />
              : <Text style={[styles.ctaText, { color: pickup && destination ? "#fff" : colors.mutedForeground }]}>Choose Vehicle</Text>
            }
          </Pressable>
        )}
        {step === "vehicle" && (
          <Pressable
            onPress={goToConfirm}
            style={({ pressed }) => [
              styles.cta,
              {
                backgroundColor: colors.primary,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text style={styles.ctaText}>
              {fare
                ? isTM && tmSplit
                  ? `Review – You pay ${formatCurrency(tmSplit.passengerPays)}`
                  : `Review – ${formatCurrency(fare.total)}`
                : "Review Fare"
              }
            </Text>
          </Pressable>
        )}
        {step === "confirm" && (
          <>
            {/* ASAP blocked: dispatch offline / outside hours — offer schedule */}
            {asapBlocked && (
              <View style={[styles.noDriverBanner, { backgroundColor: "#fef3c7", borderColor: "#fbbf24" }]}>
                <Feather name="alert-triangle" size={15} color="#d97706" />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.noDriverText, { color: "#92400e" }]}>
                    {asapBlockReason === "outside_hours"
                      ? "Outside operating hours."
                      : "Dispatch is offline right now."}
                  </Text>
                  <Pressable onPress={() => setIsScheduled(true)}>
                    <Text style={{ color: "#d97706", fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 3 }}>
                      Schedule a ride for later →
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
            {stripeError && (
              <View style={[styles.stripeErrorBox, { backgroundColor: "#fee2e2", borderColor: "#f87171" }]}>
                <Feather name="alert-circle" size={14} color="#dc2626" />
                <Text style={styles.stripeErrorText}>{stripeError}</Text>
              </View>
            )}
            <Pressable
              onPress={handleBook}
              disabled={booking || asapBlocked || (isScheduled && !scheduledAtValid)}
              style={({ pressed }) => [styles.cta, { backgroundColor: asapBlocked || (isScheduled && !scheduledAtValid) ? colors.muted : colors.primary, opacity: pressed || booking ? 0.7 : 1 }]}
            >
              {booking
                ? <>
                    <ActivityIndicator color="#fff" />
                    {bookingStatus && (
                      <Text style={[styles.ctaText, { fontSize: 12, marginTop: 2, opacity: 0.85 }]}>
                        {bookingStatus}
                      </Text>
                    )}
                  </>
                : <Text style={styles.ctaText}>
                    {payment === "card"
                      ? isTM && tmSplit
                        ? `Pay ${formatCurrency(tmSplit.passengerPays)} by Card`
                        : `Pay ${formatCurrency(discountedFare ?? fare?.total ?? 0)} by Card`
                      : isTM && tmSplit
                        ? `Confirm – You pay ${formatCurrency(tmSplit.passengerPays)}`
                        : `Confirm & Find Driver – ${formatCurrency(discountedFare ?? fare?.total ?? 0)}`
                    }
                  </Text>
              }
            </Pressable>
          </>
        )}
      </View>

      {/* TM Card Scanner Modal */}
      <TMCardScanner
        visible={scannerOpen}
        onClose={() => { setScannerOpen(false); setEditingPassengerId(null); setPrefillCard(null); }}
        onSave={handleSaveCard}
        existingCard={editingPassenger}
        prefillCard={prefillCard ?? undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    paddingTop: 14,
    gap: 12,
  },
  headerTitle: { flex: 1, fontSize: 18, fontFamily: "Inter_600SemiBold" },
  stepDots: { flexDirection: "row", gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  scroll: { flex: 1 },
  content: { padding: 20, gap: 16 },
  section: { gap: 12 },

  // TM Toggle
  tmToggleCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1.5, borderRadius: 16, padding: 14, gap: 12 },
  tmToggleLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  tmIconBadge: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  tmToggleText: { flex: 1 },
  tmToggleTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  tmToggleSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

  // TM Passengers card
  tmPassengerCard: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  tmPassengerHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  tmPassengerTitle: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  tmPassengerCount: { fontSize: 12, fontFamily: "Inter_700Bold", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  tmCardRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderTopWidth: 1 },
  tmCardIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  tmCardInfo: { flex: 1 },
  tmCardName: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  tmCardSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  tmCardAction: { padding: 4 },
  addTMBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1.5, borderRadius: 10, borderStyle: "dashed", paddingVertical: 10 },
  addTMBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  hoistBadge: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 8, padding: 8 },
  hoistBadgeText: { fontSize: 12, fontFamily: "Inter_500Medium" },

  // Location
  locationCard: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 10 },
  stopRow: { gap: 6 },
  stopLine: { height: 1, marginLeft: 20 },
  stopInputRow: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
  stopText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  myLocationBtn: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, borderStyle: "dashed" },
  myLocationTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  myLocationSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  locationErrorBanner: { flexDirection: "row", alignItems: "center", gap: 6, padding: 10, borderRadius: 10, borderWidth: 1 },
  locationErrorText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular" },
  addStopBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderRadius: 10, borderStyle: "dashed", alignSelf: "flex-start" },
  addStopText: { fontSize: 13, fontFamily: "Inter_500Medium" },

  // Vehicle
  sectionLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1, marginTop: 4 },
  tmInfoBanner: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, padding: 10 },
  tmInfoBannerText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
  companyScroll: { flexGrow: 0 },
  companyChip: { borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 8, marginRight: 8, gap: 3 },
  companyChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  companyRating: { flexDirection: "row", alignItems: "center", gap: 3 },
  companyRatingText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  vehicleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  vehicleCard: { width: "47%", borderRadius: 14, borderWidth: 1.5, padding: 14, gap: 4 },
  vehicleLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  vehicleCap: { fontSize: 11, fontFamily: "Inter_400Regular" },
  vehiclePrice: { fontSize: 16, fontFamily: "Inter_700Bold", marginTop: 4 },
  vehicleTMPrices: { gap: 0 },
  vehicleTMSub: { fontSize: 10, fontFamily: "Inter_400Regular" },
  tmVehicleBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, alignSelf: "flex-start", marginTop: 2 },
  tmVehicleBadgeText: { fontSize: 9, fontFamily: "Inter_600SemiBold" },

  // Confirm
  confirmCard: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  confirmRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  confirmDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  confirmText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  fareCard: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 8 },
  fareRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  fareLabel: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  fareValue: { fontSize: 13, fontFamily: "Inter_500Medium" },
  fareDivider: { height: 1, marginVertical: 4 },
  fareTotal: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  fareTotalValue: { fontSize: 20, fontFamily: "Inter_700Bold" },
  tmRateBadge: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 8, padding: 8 },
  tmRateBadgeText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  tmSplitBox: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 6 },
  tmSplitLabel: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  tmConfirmCard: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  tmConfirmHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  tmConfirmTitle: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  tmConfirmAdd: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  tmConfirmAddText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  tmPaymentNote: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: -6 },

  // Promo
  promoRow: { flexDirection: "row", gap: 10 },
  promoInput: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  promoText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  promoBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, justifyContent: "center" },
  promoBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  promoError: { fontSize: 12, fontFamily: "Inter_400Regular" },
  promoSuccess: { fontSize: 12, fontFamily: "Inter_500Medium" },

  // Rideshare
  rideshareCard: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 12 },
  rideshareHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rideshareLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  rideshareTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  rideshareSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  walletSplitBreakdown: { borderTopWidth: 1, paddingTop: 12, marginTop: 4, gap: 8 },
  passengerRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  passengerLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  passengerBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  passengerBtnText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  splitAmount: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginLeft: 4 },

  noDriverBanner: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8 },
  noDriverText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },

  // Payment
  paymentRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  paymentOption: { minWidth: "30%", flex: 1, borderRadius: 12, borderWidth: 1.5, padding: 12, alignItems: "center", gap: 6 },
  paymentLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", textAlign: "center" },

  // Business Account / ACC inputs
  accountInputCard: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  accountInputHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  accountInputTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  accountField: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  accountFieldText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  accountError: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 8, padding: 8 },
  accountErrorText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular" },
  accountVerified: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 8, padding: 10 },
  accountVerifiedText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  accountVerifyBtn: { borderRadius: 10, paddingVertical: 11, alignItems: "center" },
  accountVerifyBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },

  // §113 card photo (optional) — business_account / acc panels
  cardPhotoRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  cardPhotoThumb: { width: 72, height: 48, borderRadius: 6 },
  cardPhotoRetake: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  cardPhotoRetakeText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  cardPhotoBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, alignSelf: "flex-start", marginTop: 4 },
  cardPhotoBtnText: { fontSize: 12, fontFamily: "Inter_500Medium" },

  // Toggle (reused)
  toggle: { width: 42, height: 24, borderRadius: 12, justifyContent: "center" },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" },

  // Bottom
  bottomBar: { padding: 20, borderTopWidth: 1 },
  cta: { borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  ctaText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  stripeErrorBox: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  stripeErrorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#dc2626" },

  // Now / Later toggle
  nowLaterRow: { flexDirection: "row", borderRadius: 12, borderWidth: 1, padding: 3, gap: 2 },
  nowLaterTab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9, borderRadius: 10 },
  nowLaterTabText: { fontSize: 13 },

  // Date / time picker card
  pickerCard: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 4 },
  pickerLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 1 },
  pickerDateChip: { borderRadius: 10, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 7, marginRight: 6 },
  pickerDateChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  pickerTimeRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  pickerStepper: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  pickerStepperVal: { fontSize: 22, fontFamily: "Inter_700Bold", minWidth: 32, textAlign: "center" },
  pickerColon: { fontSize: 22, fontFamily: "Inter_700Bold" },
  pickerMinRow: { flexDirection: "row", gap: 8 },
  pickerMinChip: { flex: 1, borderRadius: 10, borderWidth: 1.5, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  pickerMinChipText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  pickerAmPmGroup: { flexDirection: "row", borderRadius: 10, borderWidth: 1, overflow: "hidden" },
  pickerAmPmBtn: { paddingHorizontal: 10, paddingVertical: 8 },
  pickerAmPmText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  pickerPreviewRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, paddingTop: 10, borderTopWidth: 1 },
  pickerPreviewText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
});
