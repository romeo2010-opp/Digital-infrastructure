import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BackIcon,
  CarIcon,
  FoodIcon,
  MapIcon,
  SavedIcon,
  ToolsIcon,
} from "../icons";
import { stationsApi } from "../api/stationsApi";
import { formatTime } from "../dateTime";

const facilityIconMap = {
  Car: CarIcon,
  "Car Repair": ToolsIcon,
  Restaurant: FoodIcon,
};

const DEFAULT_HERO_IMAGE =
  "https://images.pexels.com/photos/97079/pexels-photo-97079.jpeg?auto=compress&cs=tinysrgb&w=1200";

const PRICE_LABELS = [
  "Fuel",
  "Diesel",
  "Super",
  "Fuel 2",
  "Diesel 2",
  "Super 2",
];
const DEFAULT_FACILITIES = ["Car", "Car Repair", "Restaurant"];
const FUEL_PRESET_LITERS = {
  PETROL: [10, 20, 30, 40, 50],
  DIESEL: [20, 30, 40, 60, 80],
};
const RESERVATION_DEFAULT_DEPOSIT = 3000;
const RESERVATION_SLOTS_REFRESH_MS = 2000;

function fuelPresetOptions(fuelType) {
  const normalizedFuelType = String(fuelType || "")
    .trim()
    .toUpperCase();
  return FUEL_PRESET_LITERS[normalizedFuelType] || FUEL_PRESET_LITERS.PETROL;
}

function normalizedPrices(prices) {
  const fallbackValues = ["$2.37", "$1.79", "$3.12", "$3.79", "$4.64", "$3.79"];

  const raw = Array.isArray(prices) && prices.length ? prices.slice(0, 6) : [];
  const mapped = PRICE_LABELS.map((label, index) => ({
    label,
    value: String(raw[index]?.value || fallbackValues[index]).replace("/L", ""),
  }));

  return mapped;
}

function toFuelStatusKey(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return "available";
  if (normalized.includes("out") || normalized.includes("unavailable") || normalized.includes("empty")) {
    return "unavailable";
  }
  if (normalized.includes("low")) return "low";
  if (normalized.includes("in use") || normalized.includes("busy")) return "in-use";
  return "available";
}

function fuelStatusLabel(statusKey) {
  if (statusKey === "in-use") return "In Use";
  if (statusKey === "low") return "Low";
  if (statusKey === "unavailable") return "Unavailable";
  return "Available";
}

function normalizeFuelTypeCode(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!normalized) return "";
  if (normalized.includes("PETROL") || normalized.includes("GASOLINE") || normalized === "PMS") return "PETROL";
  if (normalized.includes("DIESEL")) return "DIESEL";
  if (normalized.includes("PREMIUM") || normalized.includes("SUPER")) return "PREMIUM";
  return normalized;
}

function fuelTypeLabelFromCode(code) {
  if (code === "PETROL") return "Petrol";
  if (code === "DIESEL") return "Diesel";
  if (code === "PREMIUM") return "Premium";
  if (!code) return "Fuel";
  const plain = code.replace(/_/g, " ").toLowerCase();
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

function buildFuelTypeStatuses(station, prices) {
  const typedStatusMap =
    station?.fuelStatusByType && typeof station.fuelStatusByType === "object"
      ? station.fuelStatusByType
      : null;

  const fallbackStatus =
    String(station?.status || "").toLowerCase() === "in use"
      ? "in-use"
      : toFuelStatusKey(station?.fuelLevel || station?.status);

  if (Array.isArray(station?.fuelStatuses) && station.fuelStatuses.length) {
    return station.fuelStatuses.map((item, index) => {
      const code = normalizeFuelTypeCode(item?.code || item?.fuelType || item?.label);
      const label = String(item?.label || fuelTypeLabelFromCode(code)).trim() || `Fuel ${index + 1}`;
      const status = toFuelStatusKey(item?.status || item?.availability || item?.level);
      return {
        id: `${code || label}-${index}`,
        code,
        label,
        status,
      };
    });
  }

  const derivedCodes = [];
  (Array.isArray(prices) ? prices : []).forEach((item) => {
    const baseLabel = String(item?.label || "")
      .replace(/\s*\d+$/, "")
      .trim();
    const code = normalizeFuelTypeCode(baseLabel);
    if (!code) return;
    if (!derivedCodes.includes(code)) {
      derivedCodes.push(code);
    }
  });

  if (!derivedCodes.length) {
    derivedCodes.push("PETROL", "DIESEL");
  }

  return derivedCodes.map((code, index) => {
    const mappedStatus = typedStatusMap ? typedStatusMap[code] || typedStatusMap[code.toLowerCase()] : "";
    return {
      id: `${code}-${index}`,
      code,
      label: fuelTypeLabelFromCode(code),
      status: toFuelStatusKey(mappedStatus || fallbackStatus),
    };
  });
}

function parseHours(station) {
  if (station?.openingTime && station?.closingTime) {
    return {
      openingTime: station.openingTime,
      closingTime: station.closingTime,
    };
  }

  return {
    openingTime: "06:00 am",
    closingTime: "11:30 pm",
  };
}

function normalizedFacilities(facilities) {
  const values = Array.isArray(facilities) ? facilities : [];
  const merged = [...values];

  DEFAULT_FACILITIES.forEach((item) => {
    if (!merged.includes(item)) {
      merged.push(item);
    }
  });

  return merged.slice(0, 3);
}

function reservationErrorMessage(error) {
  const direct = String(error?.message || "").trim();
  if (direct) return direct;
  const payload = String(error?.error || "").trim();
  if (payload) return payload;
  return "Unable to create reservation";
}

function queueJoinErrorMessage(error) {
  const direct = String(error?.message || "").trim();
  if (direct) return direct;
  const payload = String(error?.error || "").trim();
  if (payload) return payload;
  return "Unable to join queue";
}

function toFiniteNumberOrNull(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function toMoneyNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Number(numeric.toFixed(2));
}

function formatMoney(value, currencyCode = "MWK") {
  const numeric = toMoneyNumber(value);
  if (numeric === null) return `${currencyCode} -`;
  const isWhole = Math.abs(numeric % 1) < 0.001;
  return `${currencyCode} ${numeric.toLocaleString(undefined, {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function countdownLabel(value, nowTick) {
  if (!value) return "Offer inactive";
  const diffMs = new Date(value).getTime() - nowTick;
  if (!Number.isFinite(diffMs) || diffMs <= 0) return "Offer ended";
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s left`;
  if (minutes > 0) return `${minutes}m ${seconds}s left`;
  return `${seconds}s left`;
}

function promotionKindLabel(offer) {
  const directDiscountAmount = toMoneyNumber(offer?.directDiscountAmount) || 0;
  const cashbackAmount = toMoneyNumber(offer?.cashbackAmount) || 0;
  if (directDiscountAmount > 0 && cashbackAmount > 0) return "Discount + Cashback";
  if (directDiscountAmount > 0) return "Direct Discount";
  if (cashbackAmount > 0) return "Cashback";
  return "Live Offer";
}

function offerCountdownLabel(value, nowTick) {
  if (!value) return "Active now";
  const label = countdownLabel(value, nowTick);
  if (label === "Offer inactive" || label === "Offer ended") return "Active now";
  return label;
}

export function StationDetailsScreen({
  station,
  onBack,
  onDirections,
  onJoinQueue,
  onReserve,
  onGetReservationSlots,
  onConnectReservationRealtime,
  isFavorite = false,
  onToggleFavorite,
  autoOpenJoinModal = false,
  onAutoOpenJoinConsumed,
}) {
  const [failedHeroImage, setFailedHeroImage] = useState("");
  const [joinError, setJoinError] = useState("");
  const [identifierError, setIdentifierError] = useState("");
  const [fuelAmountError, setFuelAmountError] = useState("");
  const [queueIdentifier, setQueueIdentifier] = useState("");
  const [selectedFuelType, setSelectedFuelType] = useState("PETROL");
  const [selectedPresetLiters, setSelectedPresetLiters] = useState(
    fuelPresetOptions("PETROL")[1],
  );
  const [customFuelLiters, setCustomFuelLiters] = useState("");
  const [queuePaymentMode, setQueuePaymentMode] = useState("PAY_AT_PUMP");
  const [apiFuelStatuses, setApiFuelStatuses] = useState([]);
  const [fuelStatusLoading, setFuelStatusLoading] = useState(false);
  const [fuelStatusResolved, setFuelStatusResolved] = useState(false);
  const [promotionPreview, setPromotionPreview] = useState(null);
  const [promotionPreviewLoading, setPromotionPreviewLoading] = useState(false);
  const [promoNowTick, setPromoNowTick] = useState(() => Date.now());
  const [showIdentifierModal, setShowIdentifierModal] = useState(false);
  const [isJoiningQueue, setIsJoiningQueue] = useState(false);
  const [showReservationModal, setShowReservationModal] = useState(false);
  const [_reservationError, setReservationError] = useState("");
  const [reservationErrorModalMessage, setReservationErrorModalMessage] = useState("");
  const [reservationIdentifier, setReservationIdentifier] = useState("");
  const [reservationFuelType, setReservationFuelType] = useState("PETROL");
  const [reservationPresetLiters, setReservationPresetLiters] = useState(
    fuelPresetOptions("PETROL")[1],
  );
  const [reservationCustomLiters, setReservationCustomLiters] = useState("");
  const [reservationDeposit, setReservationDeposit] = useState(String(RESERVATION_DEFAULT_DEPOSIT));
  const [reservationSlots, setReservationSlots] = useState([]);
  const [reservationRules, setReservationRules] = useState(null);
  const [reservationSlotStart, setReservationSlotStart] = useState("");
  const [reservationSlotsLoading, setReservationSlotsLoading] = useState(false);
  const [isCreatingReservation, setIsCreatingReservation] = useState(false);
  const [reservationGeo, setReservationGeo] = useState(null);

  const prices = normalizedPrices(station?.prices);
  const stationPublicId = String(station?.publicId || station?.id || "").trim();
  const usesApiFuelStatus = stationsApi.isApiMode();
  const queuePlanEnabled = station?.queuePlanEnabled ?? true;
  const reservationPlanEnabled = station?.reservationPlanEnabled ?? true;

  const refreshReservationSlots = useCallback(
    async ({ showLoader = false, clearError = false } = {}) => {
      if (!showReservationModal) return;
      if (typeof onGetReservationSlots !== "function") return;
      if (!station) return;

      if (showLoader) {
        setReservationSlotsLoading(true);
      }
      if (clearError) {
        setReservationError("");
      }

      try {
        const payload = await onGetReservationSlots(station, {
          fuelType: reservationFuelType,
          lookAhead: 8,
        });
        const slots = Array.isArray(payload?.slots) ? payload.slots : [];
        setReservationSlots(slots);
        setReservationRules(payload?.rules || null);
        setReservationSlotStart((current) => {
          if (slots.some((slot) => slot.slotStart === current && !slot.isFull)) {
            return current;
          }
          const firstAvailable = slots.find((slot) => !slot.isFull);
          return firstAvailable?.slotStart || "";
        });
      } catch (error) {
        setReservationError(error?.message || "Unable to load reservation slots.");
      } finally {
        if (showLoader) {
          setReservationSlotsLoading(false);
        }
      }
    },
    [onGetReservationSlots, reservationFuelType, showReservationModal, station],
  );

  useEffect(() => {
    if (!showReservationModal) return;
    let refreshTimerId = 0;
    refreshReservationSlots({ showLoader: true, clearError: true });
    refreshTimerId = window.setInterval(() => {
      refreshReservationSlots({ showLoader: false, clearError: false });
    }, RESERVATION_SLOTS_REFRESH_MS);

    return () => {
      if (refreshTimerId) {
        window.clearInterval(refreshTimerId);
      }
    };
  }, [refreshReservationSlots, showReservationModal]);

  useEffect(() => {
    if (!showReservationModal) return;
    if (typeof onConnectReservationRealtime !== "function") return;
    if (!station) return;

    let realtimeTimerId = 0;
    let disconnect = () => {};

    const scheduleRefresh = () => {
      if (realtimeTimerId) return;
      realtimeTimerId = window.setTimeout(() => {
        realtimeTimerId = 0;
        refreshReservationSlots({ showLoader: false, clearError: false });
      }, 220);
    };

    try {
      disconnect = onConnectReservationRealtime(station, {
        onMessage: (message) => {
          const type = String(message?.type || "");
          if (type !== "station_change" && type !== "station_change_ready") {
            return;
          }

          if (type === "station_change") {
            const actionType = String(message?.actionType || "").trim().toUpperCase();
            const payload = message?.payload || {};
            const slotStart = String(payload?.slotStart || "").trim();
            const remainingSpots = toFiniteNumberOrNull(payload?.remainingSpots);

            if (
              (actionType === "RESERVATION_USER_CREATE" || actionType === "RESERVATION_CREATE") &&
              slotStart &&
              remainingSpots !== null
            ) {
              setReservationSlots((current) =>
                current.map((slot) => {
                  if (String(slot?.slotStart || "").trim() !== slotStart) return slot;
                  const nextAvailableSpots = Math.max(0, Math.round(remainingSpots));
                  const capacity = Math.max(1, Number(slot?.capacity || 1));
                  return {
                    ...slot,
                    availableSpots: nextAvailableSpots,
                    reservedCount: Math.max(0, capacity - nextAvailableSpots),
                    isFull: nextAvailableSpots <= 0,
                  };
                }),
              );
            }
          }
          scheduleRefresh();
        },
      });
    } catch {
      disconnect = () => {};
    }

    return () => {
      disconnect?.();
      if (realtimeTimerId) {
        window.clearTimeout(realtimeTimerId);
      }
    };
  }, [onConnectReservationRealtime, refreshReservationSlots, showReservationModal, station]);

  useEffect(() => {
    if (!showReservationModal) return;
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setReservationGeo({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => {
        setReservationGeo(null);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 15000,
        timeout: 9000,
      },
    );
  }, [showReservationModal]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setPromoNowTick(Date.now());
    }, 1000);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    if (!stationPublicId || !stationsApi.isApiMode()) {
      setApiFuelStatuses([]);
      setFuelStatusLoading(false);
      setFuelStatusResolved(true);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setFuelStatusLoading(true);
    setFuelStatusResolved(false);

    stationsApi
      .getStationFuelStatus(stationPublicId, { signal: controller.signal })
      .then((payload) => {
        if (cancelled) return;
        const statuses = Array.isArray(payload?.statuses) ? payload.statuses : [];
        setApiFuelStatuses(statuses);
      })
      .catch(() => {
        if (cancelled) return;
        setApiFuelStatuses([]);
      })
      .finally(() => {
        if (cancelled) return;
        setFuelStatusLoading(false);
        setFuelStatusResolved(true);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [stationPublicId]);

  const selectedPreviewLitres = useMemo(() => {
    const custom = Number(customFuelLiters);
    if (Number.isFinite(custom) && custom > 0) return custom;
    const preset = Number(selectedPresetLiters);
    if (Number.isFinite(preset) && preset > 0) return preset;
    return fuelPresetOptions(selectedFuelType)[1];
  }, [customFuelLiters, selectedFuelType, selectedPresetLiters]);

  useEffect(() => {
    if (!stationPublicId || !stationsApi.isApiMode()) {
      setPromotionPreview(null);
      setPromotionPreviewLoading(false);
      return;
    }

    if (!selectedFuelType || !(selectedPreviewLitres > 0)) {
      setPromotionPreview(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setPromotionPreviewLoading(true);

    stationsApi
      .getStationPromotionPreview(stationPublicId, {
        fuelTypeCode: selectedFuelType,
        litres: selectedPreviewLitres,
        paymentMethod: queuePaymentMode === "PREPAY" ? "SMARTPAY" : "CASH",
        signal: controller.signal,
      })
      .then((payload) => {
        if (cancelled) return;
        setPromotionPreview(payload || null);
      })
      .catch(() => {
        if (cancelled) return;
        setPromotionPreview(null);
      })
      .finally(() => {
        if (cancelled) return;
        setPromotionPreviewLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [queuePaymentMode, selectedFuelType, selectedPreviewLitres, stationPublicId]);

  const fuelTypeStatuses = useMemo(() => {
    if (!station) return [];
    if (usesApiFuelStatus) {
      return apiFuelStatuses.map((item, index) => {
        const code = normalizeFuelTypeCode(item?.code || item?.fuelType || item?.label);
        const label = String(item?.label || fuelTypeLabelFromCode(code)).trim() || `Fuel ${index + 1}`;
        const status = toFuelStatusKey(item?.status);
        return {
          id: `${code || label}-${index}`,
          code,
          label,
          status,
        };
      });
    }
    return buildFuelTypeStatuses(station, prices);
  }, [apiFuelStatuses, prices, station, usesApiFuelStatus]);

  const queueFuelStatusByCode = useMemo(() => {
    const map = new Map();
    fuelTypeStatuses.forEach((item) => {
      const code = normalizeFuelTypeCode(item?.code || item?.label);
      if (!code) return;
      map.set(code, item);
    });
    return map;
  }, [fuelTypeStatuses]);

  const queueFuelOptions = useMemo(
    () =>
      ["PETROL", "DIESEL"].map((code) => {
        const statusItem = queueFuelStatusByCode.get(code);
        return {
          code,
          label: statusItem?.label || fuelTypeLabelFromCode(code),
          status: statusItem?.status || "available",
        };
      }),
    [queueFuelStatusByCode],
  );

  const selectedQueueFuelStatus = queueFuelStatusByCode.get(selectedFuelType) || null;
  const queueJoinableFuelOptions = useMemo(
    () => queueFuelOptions.filter((item) => item.status !== "unavailable"),
    [queueFuelOptions],
  );
  const hasJoinableQueueFuel = queueJoinableFuelOptions.length > 0;
  const preferredQueueFuelType = queueJoinableFuelOptions[0]?.code || "";
  const queueFuelStatusPending =
    usesApiFuelStatus && Boolean(stationPublicId) && !fuelStatusResolved;
  const selectedQueueFuelUnavailable = selectedQueueFuelStatus?.status === "unavailable";
  const selectedQueueFuelUnavailableMessage = selectedQueueFuelUnavailable
    ? `${selectedQueueFuelStatus?.label || fuelTypeLabelFromCode(selectedFuelType)} is unavailable at this station right now. Choose another fuel type to join the queue.`
    : "";
  const queueJoinBlockedMessage = queueFuelStatusPending
    ? "Checking live fuel availability before queue join."
    : !hasJoinableQueueFuel
      ? "This station does not currently have Petrol or Diesel available for the digital queue."
      : selectedQueueFuelUnavailableMessage;

  useEffect(() => {
    if (!hasJoinableQueueFuel) return;
    if (queueFuelStatusPending) return;
    if (!selectedQueueFuelUnavailable) return;
    if (!preferredQueueFuelType || preferredQueueFuelType === selectedFuelType) return;
    setSelectedFuelType(preferredQueueFuelType);
    setSelectedPresetLiters(fuelPresetOptions(preferredQueueFuelType)[1]);
    setCustomFuelLiters("");
    setFuelAmountError("");
    setJoinError("");
  }, [
    hasJoinableQueueFuel,
    preferredQueueFuelType,
    queueFuelStatusPending,
    selectedFuelType,
    selectedQueueFuelUnavailable,
  ]);

  const openIdentifierModal = useCallback(() => {
    if (!queuePlanEnabled) return;
    if (!onJoinQueue || isJoiningQueue) return;
    if (queueJoinBlockedMessage) {
      setJoinError(queueJoinBlockedMessage);
      return;
    }
    setJoinError("");
    setIdentifierError("");
    setFuelAmountError("");
    setShowIdentifierModal(true);
  }, [isJoiningQueue, onJoinQueue, queueJoinBlockedMessage, queuePlanEnabled]);

  useEffect(() => {
    if (!autoOpenJoinModal) return;
    if (!queuePlanEnabled) {
      onAutoOpenJoinConsumed?.();
      return;
    }
    if (!onJoinQueue || isJoiningQueue) return;
    openIdentifierModal();
    onAutoOpenJoinConsumed?.();
  }, [
    autoOpenJoinModal,
    isJoiningQueue,
    onAutoOpenJoinConsumed,
    onJoinQueue,
    openIdentifierModal,
    queuePlanEnabled,
  ]);

  if (!station) {
    return (
      <div>
        <button type="button" className="icon-back" onClick={onBack}>
          <BackIcon size={18} /> Back
        </button>
        <article className="station-card details-card">
          <h3>Station not found</h3>
          <p>This station may have been removed.</p>
        </article>
      </div>
    );
  }

  const hours = parseHours(station);
  const facilities = normalizedFacilities(station.facilities);
  const ratingNumber = Math.max(
    1,
    Math.min(5, Math.round(Number(station.rating || 0))),
  );
  const reviewsText = `(${station.reviewsCount || 0} reviews)`;
  const heroImage = station.heroImage || DEFAULT_HERO_IMAGE;
  const heroImageFailed = failedHeroImage === heroImage;
  const reservationMinLiters = Number(reservationRules?.minLiters || 10);
  const reservationMaxLiters = Number(reservationRules?.maxLiters || 40);
  const reservationMinDeposit = Number(reservationRules?.minDepositAmount || 3000);
  const reservationMaxDeposit = Number(reservationRules?.maxDepositAmount || 10000);
  const promoOffers = Array.isArray(promotionPreview?.offers) ? promotionPreview.offers : [];
  const promoPricing = promotionPreview?.pricing || null;
  const basePricePerLitre = toMoneyNumber(promotionPreview?.basePricePerLitre);
  const flashOffer = promoOffers.find((offer) => offer.countdownEndsAt) || null;
  const hasLiveOffers = promoOffers.length > 0;
  const hasDirectPromoDiscount = (toMoneyNumber(promoPricing?.totalDirectDiscount) || 0) > 0;
  const promoPricePerLitreLabel = hasDirectPromoDiscount ? "Effective net / litre" : "Payable / litre";
  const promoPricePerLitreValue = hasDirectPromoDiscount
    ? promoPricing?.effectivePricePerLitre
    : (promoPricing?.directPricePerLitre ?? basePricePerLitre);

  const openReservationModal = () => {
    if (!reservationPlanEnabled) return;
    if (!onReserve || isCreatingReservation) return;
    setReservationError("");
    setReservationErrorModalMessage("");
    setReservationIdentifier(queueIdentifier || "");
    setReservationFuelType(selectedFuelType);
    setReservationPresetLiters(fuelPresetOptions(selectedFuelType)[1]);
    setReservationCustomLiters("");
    setReservationDeposit(String(RESERVATION_DEFAULT_DEPOSIT));
    setShowReservationModal(true);
  };

  const handleCreateReservation = async () => {
    if (!onReserve || isCreatingReservation) return;
    const normalizedIdentifier = String(reservationIdentifier || "").trim().toUpperCase();
    if (!normalizedIdentifier) {
      setReservationError("Identifier is required before reservation.");
      return;
    }
    if (normalizedIdentifier.length < 3) {
      setReservationError("Identifier is too short.");
      return;
    }

    const hasCustomFuelInput = String(reservationCustomLiters || "").trim() !== "";
    const expectedLiters = hasCustomFuelInput
      ? Number(reservationCustomLiters)
      : Number(reservationPresetLiters);
    if (!Number.isFinite(expectedLiters)) {
      setReservationError("Choose a valid fuel amount.");
      return;
    }
    if (expectedLiters < reservationMinLiters || expectedLiters > reservationMaxLiters) {
      setReservationError(
        `Fuel amount must be between ${reservationMinLiters}L and ${reservationMaxLiters}L.`,
      );
      return;
    }

    const depositAmount = Number(reservationDeposit);
    if (!Number.isFinite(depositAmount)) {
      setReservationError("Deposit amount is required.");
      return;
    }
    if (depositAmount < reservationMinDeposit || depositAmount > reservationMaxDeposit) {
      setReservationError(
        `Deposit must be between MWK ${reservationMinDeposit.toLocaleString()} and MWK ${reservationMaxDeposit.toLocaleString()}.`,
      );
      return;
    }

    const selectedSlot = reservationSlots.find(
      (slot) => slot.slotStart === reservationSlotStart,
    );
    if (!selectedSlot || selectedSlot.isFull) {
      setReservationError("Pick an available slot first.");
      return;
    }

    setReservationError("");
    setReservationErrorModalMessage("");
    setIsCreatingReservation(true);
    try {
      const response = await onReserve(station, {
        fuelType: reservationFuelType,
        expectedLiters,
        slotStart: selectedSlot.slotStart,
        slotEnd: selectedSlot.slotEnd,
        identifier: normalizedIdentifier.slice(0, 64),
        depositAmount,
        userLat: reservationGeo?.lat,
        userLng: reservationGeo?.lng,
      });
      const responseError = String(response?.error || "").trim();
      if (response?.ok === false || responseError) {
        throw new Error(responseError || "Unable to create reservation");
      }
      const reservationId = String(
        response?.reservationId || response?.reservation?.id || "",
      ).trim();
      if (!reservationId) {
        throw new Error("Reservation was not created. Please try again.");
      }
      setShowReservationModal(false);
    } catch (error) {
      const message = reservationErrorMessage(error);
      setReservationError(message);
      setReservationErrorModalMessage(message);
    } finally {
      setIsCreatingReservation(false);
    }
  };

  const handleJoinQueue = async () => {
    if (!onJoinQueue || isJoiningQueue) return;

    if (queueJoinBlockedMessage) {
      setJoinError(queueJoinBlockedMessage);
      return;
    }

    const normalizedIdentifier = String(queueIdentifier || "")
      .trim()
      .toUpperCase();
    if (!normalizedIdentifier) {
      setIdentifierError("Identifier is required before joining queue.");
      return;
    }
    if (normalizedIdentifier.length < 3) {
      setIdentifierError("Identifier is too short.");
      return;
    }
    const hasCustomFuelInput = String(customFuelLiters || "").trim() !== "";
    const parsedFuelLiters = hasCustomFuelInput
      ? Number(customFuelLiters)
      : Number(selectedPresetLiters);
    if (!Number.isFinite(parsedFuelLiters) || parsedFuelLiters <= 0) {
      setFuelAmountError("Choose a valid fuel amount in liters.");
      return;
    }
    if (parsedFuelLiters > 500) {
      setFuelAmountError("Fuel amount must be 500 liters or less.");
      return;
    }

    setJoinError("");
    setIdentifierError("");
    setFuelAmountError("");
    setIsJoiningQueue(true);
    try {
      await onJoinQueue(station, {
        fuelType: selectedFuelType,
        maskedPlate: normalizedIdentifier.slice(0, 32),
        requestedLiters: parsedFuelLiters,
        prepay: queuePaymentMode === "PREPAY",
      });
      setShowIdentifierModal(false);
    } catch (error) {
      setJoinError(queueJoinErrorMessage(error));
    } finally {
      setIsJoiningQueue(false);
    }
  };

  return (
    <section className="station-details-screen">
      <div
        className={`details-hero ${heroImageFailed ? "image-fallback" : ""}`}
      >
        {!heroImageFailed ? (
          <img
            src={heroImage}
            alt={station.name}
            className="details-hero-image"
            onError={() => setFailedHeroImage(heroImage)}
          />
        ) : null}

        <button
          type="button"
          className="details-floating-button back"
          onClick={onBack}
          aria-label="Go back"
        >
          <BackIcon size={18} />
        </button>

        <div className="details-hero-actions">
          <button
            type="button"
            className={`details-floating-button ${isFavorite ? "is-active" : ""}`}
            onClick={() => onToggleFavorite?.(station.id)}
            aria-label={isFavorite ? "Remove station from favorites" : "Save station"}
            aria-pressed={isFavorite}
          >
            <SavedIcon size={15} />
          </button>
          <button
            type="button"
            className="details-floating-button"
            aria-label="Preview route"
          >
            <MapIcon size={15} />
          </button>
        </div>
      </div>

      <article className="details-sheet">
        <div className="details-sheet-head">
          <div className="details-station-main">
            <h2>{station.name}</h2>
            <div className="details-rating-row">
              <span className="details-rating-number">{ratingNumber}</span>
              <span className="details-rating-stars">
                 ★★★★★
              </span>
              <span className="details-review-text">{reviewsText}</span>
            </div>
          </div>

          <button
            type="button"
            className="details-go-button"
            onClick={() => onDirections(station.id)}
            aria-label="Get directions"
          >
            <span>➤</span>
          </button>
        </div>

        <section className="details-block">
          <div className="details-section-head">
            <h3>Fuel Availability</h3>
            {fuelStatusLoading ? (
              <small className="details-section-note">Updating…</small>
            ) : null}
          </div>
          {fuelTypeStatuses.length ? (
            <div className="details-fuel-grid">
              {fuelTypeStatuses.map((item) => (
                <div key={item.id} className="details-fuel-item">
                  <span className="details-fuel-name">{item.label}</span>
                  <span className={`details-fuel-status ${item.status}`}>
                    {fuelStatusLabel(item.status)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="details-section-note">Fuel status unavailable.</p>
          )}
        </section>

        <section className="details-block">
          <h3>Fuel Details</h3>
          <div className="details-price-grid">
            {prices.map((item) => (
              <div key={item.label} className="details-price-item">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </section>

        {hasLiveOffers && promoPricing ? (
          <section className="details-block">
            <div className="details-section-head">
              <h3>Live SmartLink Offers</h3>
              {promotionPreviewLoading ? (
                <small className="details-section-note">Checking eligibility…</small>
              ) : null}
            </div>
            <div className="details-offer-card">
              <div className="details-offer-head">
                <div>
                  <span className="details-offer-kicker">{fuelTypeLabelFromCode(selectedFuelType)} · {selectedPreviewLitres}L</span>
                  <strong>{promoOffers.length} live campaign{promoOffers.length === 1 ? "" : "s"}</strong>
                </div>
                <span className="details-offer-badge is-live">
                  Promo live
                </span>
              </div>
              <div className="details-offer-price-row">
                <div>
                  <span>Official price / litre</span>
                  <strong>{formatMoney(basePricePerLitre)}</strong>
                </div>
                <div>
                  <span>Payable today</span>
                  <strong>{formatMoney(promoPricing.finalPayable)}</strong>
                </div>
                <div>
                  <span>Cashback</span>
                  <strong>{formatMoney(promoPricing.cashback)}</strong>
                </div>
              </div>
              <div className="details-offer-metrics">
                <div>
                  <span>You save now</span>
                  <strong>{formatMoney(promoPricing.totalDirectDiscount)}</strong>
                </div>
                <div>
                  <span>{promoPricePerLitreLabel}</span>
                  <strong>{formatMoney(promoPricePerLitreValue)}</strong>
                </div>
                <div>
                  <span>Fastest timer</span>
                  <strong>{offerCountdownLabel(flashOffer?.countdownEndsAt, promoNowTick)}</strong>
                </div>
              </div>
              <div className="details-offer-list">
                {promoOffers.map((offer) => (
                  <article
                    key={offer.campaignPublicId || offer.campaignLabel}
                    className="details-offer-list-item"
                  >
                    <div className="details-offer-list-head">
                      <div>
                        <span className="details-offer-kicker">{promotionKindLabel(offer)}</span>
                        <strong>{offer.campaignLabel || "Live campaign"}</strong>
                      </div>
                      <span className="details-offer-chip">
                        {offerCountdownLabel(offer.countdownEndsAt, promoNowTick)}
                      </span>
                    </div>
                    <div className="details-offer-list-metrics">
                      <div>
                        <span>Discount</span>
                        <strong>{formatMoney(offer.directDiscountAmount)}</strong>
                      </div>
                      <div>
                        <span>Cashback</span>
                        <strong>{formatMoney(offer.cashbackAmount)}</strong>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              <p className="details-offer-note">
                Direct discounts reduce the amount you pay now. Cashback is credited after settlement and shown separately on your receipt.
              </p>
            </div>
          </section>
        ) : null}

        <section className="details-block">
          <h3>Working Hours</h3>
          <div className="details-hours-grid">
            <div className="details-hours-item">
              <span>Opening time</span>
              <strong>{hours.openingTime}</strong>
            </div>
            <div className="details-hours-item">
              <span>Closing time</span>
              <strong>{hours.closingTime}</strong>
            </div>
          </div>
        </section>

        <section className="details-block">
          <h3>Facilities</h3>
          <div className="details-facilities">
            {facilities.map((facility) => {
              const FacilityIcon = facilityIconMap[facility] || CarIcon;
              return (
                <div key={facility} className="details-facility-item">
                  <span className="details-facility-icon">
                    <FacilityIcon size={16} />
                  </span>
                  <span>{facility}</span>
                </div>
              );
            })}
          </div>
        </section>

        <div className="details-action-row">
          <button
            type="button"
            className="details-action-button is-primary"
            onClick={openReservationModal}
            disabled={isCreatingReservation || !onReserve || !reservationPlanEnabled}
          >
            Make a reservation
          </button>
          <button
            type="button"
            className="details-action-button is-secondary"
            onClick={openIdentifierModal}
            disabled={
              isJoiningQueue
              || !onJoinQueue
              || !queuePlanEnabled
              || queueFuelStatusPending
              || !hasJoinableQueueFuel
            }
          >
            {isJoiningQueue ? "Joining…" : "Join Queue"}
          </button>
          {queueJoinBlockedMessage ? (
            <p className="queue-warning-text">{queueJoinBlockedMessage}</p>
          ) : null}
          {joinError ? (
            <p className="details-inline-error">{joinError}</p>
          ) : null}
        </div>
      </article>

      {showReservationModal ? (
        <div
          className="queue-modal-backdrop"
          role="presentation"
        >
          <div
            className="queue-modal reservation-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Create reservation"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <h3>Create Reservation</h3>
              <button
                type="button"
                onClick={() => {
                  if (isCreatingReservation) return;
                  setShowReservationModal(false);
                  setReservationError("");
                  setReservationErrorModalMessage("");
                }}
              >
                Close
              </button>
            </header>

            <label className="queue-modal-input">
              <span>Fuel type</span>
              <select
                value={reservationFuelType}
                onChange={(event) => {
                  const nextFuelType = event.target.value;
                  setReservationFuelType(nextFuelType);
                  setReservationPresetLiters(fuelPresetOptions(nextFuelType)[1]);
                  setReservationCustomLiters("");
                  setReservationError("");
                  setReservationErrorModalMessage("");
                }}
              >
                <option value="PETROL">Petrol</option>
                <option value="DIESEL">Diesel</option>
              </select>
            </label>

            <div className="queue-fuel-amount">
              <span>Expected fuel ({reservationMinLiters}L - {reservationMaxLiters}L)</span>
              <div className="queue-fuel-preset-grid">
                {fuelPresetOptions(reservationFuelType).map((liters) => (
                  <button
                    key={`reservation-${reservationFuelType}-${liters}`}
                    type="button"
                    className={`queue-fuel-preset ${Number(reservationPresetLiters) === Number(liters) && !reservationCustomLiters ? "is-active" : ""}`}
                    onClick={() => {
                      setReservationPresetLiters(liters);
                      setReservationCustomLiters("");
                      setReservationError("");
                      setReservationErrorModalMessage("");
                    }}
                  >
                    {liters}L
                  </button>
                ))}
              </div>

              <label className="queue-modal-input queue-modal-input-inline">
                <span>Custom order</span>
                <input
                  type="number"
                  min={reservationMinLiters}
                  max={reservationMaxLiters}
                  step="0.1"
                  inputMode="decimal"
                  value={reservationCustomLiters}
                  placeholder="Enter liters"
                  onChange={(event) => {
                    setReservationCustomLiters(event.target.value);
                    setReservationError("");
                    setReservationErrorModalMessage("");
                  }}
                />
              </label>
            </div>

            <div className="queue-modal-input">
              <span>Reservation slot</span>
              {reservationSlotsLoading ? (
                <p className="queue-station-picker-empty">Loading available slots...</p>
              ) : reservationSlots.length ? (
                <div className="reservation-slot-grid">
                  {reservationSlots.map((slot) => {
                    const selected = reservationSlotStart === slot.slotStart;
                    const label = String(slot.slotLabel || "").trim() || (() => {
                      const start = formatTime(slot.slotStart, undefined, "");
                      const end = formatTime(slot.slotEnd, undefined, "");
                      return start && end ? `${start} - ${end}` : "Time slot";
                    })();
                    return (
                      <button
                        key={slot.slotStart}
                        type="button"
                        className={`reservation-slot-pill ${selected ? "is-selected" : ""}`}
                        onClick={() => {
                          if (slot.isFull) return;
                          setReservationSlotStart(slot.slotStart);
                          setReservationError("");
                          setReservationErrorModalMessage("");
                        }}
                        disabled={slot.isFull}
                      >
                        <strong>{label}</strong>
                        <small>{slot.isFull ? "Full" : `${slot.availableSpots} spots left`}</small>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="queue-station-picker-empty">No reservation slots available.</p>
              )}
            </div>

            <label className="queue-modal-input">
              <span>Deposit amount (MWK)</span>
              <input
                type="number"
                min={reservationMinDeposit}
                max={reservationMaxDeposit}
                step="100"
                inputMode="numeric"
                value={reservationDeposit}
                onChange={(event) => {
                  setReservationDeposit(event.target.value);
                  setReservationError("");
                  setReservationErrorModalMessage("");
                }}
              />
            </label>

            <label className="queue-modal-input">
              <span>Identifier (plate, phone or user code)</span>
              <input
                type="text"
                value={reservationIdentifier}
                maxLength={64}
                autoComplete="off"
                placeholder="e.g. BT1234"
                onChange={(event) => {
                  setReservationIdentifier(event.target.value);
                  setReservationError("");
                  setReservationErrorModalMessage("");
                }}
              />
            </label>

            <p className="queue-info-text">
              One active reservation per user. Arrive within your slot window to avoid expiration.
            </p>

            <div className="queue-modal-actions">
              <button
                type="button"
                className="details-action-button is-secondary"
                onClick={() => {
                  if (isCreatingReservation) return;
                  setShowReservationModal(false);
                  setReservationError("");
                  setReservationErrorModalMessage("");
                }}
                disabled={isCreatingReservation}
              >
                Cancel
              </button>
              <button
                type="button"
                className="details-action-button is-primary"
                onClick={handleCreateReservation}
                disabled={isCreatingReservation || reservationSlotsLoading}
              >
                {isCreatingReservation ? "Reserving…" : "Confirm Reservation"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reservationErrorModalMessage ? (
        <div className="queue-modal-backdrop reservation-error-backdrop" role="presentation">
          <div
            className="queue-modal reservation-error-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Reservation error"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <h3>Reservation Failed</h3>
            </header>
            <p className="reservation-error-text">{reservationErrorModalMessage}</p>
            <div className="queue-modal-actions">
              <button
                type="button"
                className="details-action-button is-primary"
                onClick={() => setReservationErrorModalMessage("")}
              >
                Okay
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showIdentifierModal ? (
        <div
          className="queue-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (isJoiningQueue) return;
            setShowIdentifierModal(false);
            setJoinError("");
            setIdentifierError("");
            setFuelAmountError("");
          }}
        >
          <div
            className="queue-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Set queue identifier"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <h3>Queue Details</h3>
              <button
                type="button"
                onClick={() => {
                  if (isJoiningQueue) return;
                  setShowIdentifierModal(false);
                  setJoinError("");
                  setIdentifierError("");
                  setFuelAmountError("");
                }}
              >
                Close
              </button>
            </header>

            <label className="queue-modal-input">
              <span>Fuel type</span>
              <select
                value={selectedFuelType}
                onChange={(event) => {
                  const nextFuelType = event.target.value;
                  setSelectedFuelType(nextFuelType);
                  setSelectedPresetLiters(fuelPresetOptions(nextFuelType)[1]);
                  setCustomFuelLiters("");
                  setFuelAmountError("");
                  setJoinError("");
                }}
              >
                {queueFuelOptions.map((item) => {
                  const unavailable = item.status === "unavailable";
                  return (
                    <option key={item.code} value={item.code} disabled={unavailable}>
                      {unavailable ? `${item.label} (Unavailable)` : item.label}
                    </option>
                  );
                })}
              </select>
            </label>

            <div className="queue-fuel-availability-row" aria-label="Queue fuel availability">
              {queueFuelOptions.map((item) => (
                <div
                  key={item.code}
                  className={`queue-fuel-availability-chip ${item.status} ${selectedFuelType === item.code ? "is-selected" : ""}`}
                >
                  <span>{item.label}</span>
                  <strong>{fuelStatusLabel(item.status)}</strong>
                </div>
              ))}
            </div>

            <div className="queue-fuel-amount">
              <span>Fuel amount (liters)</span>
              <div className="queue-fuel-preset-grid">
                {fuelPresetOptions(selectedFuelType).map((liters) => (
                  <button
                    key={`${selectedFuelType}-${liters}`}
                    type="button"
                    className={`queue-fuel-preset ${Number(selectedPresetLiters) === Number(liters) && !customFuelLiters ? "is-active" : ""}`}
                    onClick={() => {
                      setSelectedPresetLiters(liters);
                      setCustomFuelLiters("");
                      setFuelAmountError("");
                      setJoinError("");
                    }}
                  >
                    {liters}L
                  </button>
                ))}
              </div>

              <label className="queue-modal-input queue-modal-input-inline">
                <span>Custom order</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  step="0.1"
                  inputMode="decimal"
                  value={customFuelLiters}
                  placeholder="Enter liters"
                  onChange={(event) => {
                    setCustomFuelLiters(event.target.value);
                    setFuelAmountError("");
                    setJoinError("");
                  }}
                />
              </label>
            </div>

            <label className="queue-modal-input">
              <span>Identifier (plate, phone or user code)</span>
              <input
                type="text"
                value={queueIdentifier}
                maxLength={32}
                autoComplete="off"
                placeholder="e.g. BT1234"
                onChange={(event) => {
                  setQueueIdentifier(event.target.value);
                  if (identifierError) setIdentifierError("");
                  if (joinError) setJoinError("");
                }}
              />
            </label>

            <label className="queue-modal-input">
              <span>Payment option</span>
              <select
                value={queuePaymentMode}
                onChange={(event) => {
                  setQueuePaymentMode(event.target.value);
                  if (joinError) setJoinError("");
                }}
              >
                <option value="PAY_AT_PUMP">Pay at pump</option>
                <option value="PREPAY">Prepay with wallet</option>
              </select>
            </label>

            <p className="queue-info-text">
              Choose `Prepay with wallet` if you want the wallet charge to happen after pump verification.
            </p>

            {queueJoinBlockedMessage ? (
              <p className="queue-warning-text">{queueJoinBlockedMessage}</p>
            ) : null}

            {identifierError ? (
              <p className="details-inline-error">{identifierError}</p>
            ) : null}
            {fuelAmountError ? (
              <p className="details-inline-error">{fuelAmountError}</p>
            ) : null}
            {joinError ? (
              <p className="details-inline-error">{joinError}</p>
            ) : null}

            <div className="queue-modal-actions">
              <button
                type="button"
                className="details-action-button is-secondary"
                onClick={() => {
                  if (isJoiningQueue) return;
                  setShowIdentifierModal(false);
                  setJoinError("");
                  setIdentifierError("");
                  setFuelAmountError("");
                }}
                disabled={isJoiningQueue}
              >
                Cancel
              </button>
              <button
                type="button"
                className="details-action-button is-primary"
                onClick={handleJoinQueue}
                disabled={isJoiningQueue || Boolean(queueJoinBlockedMessage)}
              >
                {isJoiningQueue ? "Joining…" : "Confirm & Join"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
