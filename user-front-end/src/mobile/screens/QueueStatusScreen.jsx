import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackIcon,
  ChevronRightIcon,
  FuelPumpIcon,
  SearchIcon,
} from "../icons";
import { clearStoredActiveQueueJoinId } from "../authSession";
import { userQueueApi } from "../api/userQueueApi";
import { queueMockService } from "../queueMockService";
import { formatTime } from "../dateTime";
import {
  APP_AIRDROP_CELEBRATION_DURATION_MS,
  emitQueueServedCelebration,
} from "../walletTransferCelebration";
import { SMARTLINK_USER_ALERT_EVENT } from "../userAlertEvents";
import {
  resolveServiceRequestPaymentMode,
  serviceRequestStatusLabel,
  shouldShowServiceRequestProgress,
} from "../utils/queueStatusViewModel";

const RECONNECT_BACKOFF_MS = [1200, 2500, 5000, 10000, 15000];
const CALLED_SOUND_SRC = "/sounds/Success 3.mp3";
const LIVE_QUEUE_POLL_CONNECTED_MS = 5000;
const LIVE_QUEUE_POLL_DISCONNECTED_MS = 3000;
const ISSUE_TYPES = [
  { value: "WAIT_TIME", label: "Wait time mismatch" },
  { value: "QR_SCAN", label: "QR issue" },
  { value: "ATTENDANT", label: "Attendant interaction" },
  { value: "STATION_ACCESS", label: "Station access blocked" },
  { value: "FUEL_AVAILABILITY", label: "Fuel availability mismatch" },
  { value: "OTHER", label: "Other issue" },
];

function isFiniteNumber(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized);
}

function formatRelativeTime(isoDate) {
  if (!isoDate) return "No movement yet";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "No movement yet";
  const diffSeconds = Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / 1000),
  );
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  return `${diffHours}h ago`;
}

function movementLabel(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "paused") return "Paused";
  if (normalized === "slow") return "Slow";
  return "Normal";
}

function movementClass(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "paused") return "is-paused";
  if (normalized === "slow") return "is-slow";
  return "is-normal";
}

function guaranteeClass(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "safe") return "is-safe";
  if (normalized === "warning") return "is-warning";
  if (normalized === "critical") return "is-critical";
  return "is-none";
}

function guaranteeText(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "safe") return "Safe";
  if (normalized === "warning") return "Warning: fuel running low";
  if (normalized === "critical") return "Critical: fuel may run out";
  return "Fuel guarantee unavailable";
}

function resolveGuaranteeState(snapshot) {
  return String(
    snapshot?.guarantee?.state || snapshot?.guaranteeState || "none",
  ).toLowerCase();
}

function guaranteeCoveragePercent(snapshot) {
  const effectiveFuel = Number(
    snapshot?.guarantee?.effectiveFuelLiters ??
      snapshot?.guarantee?.fuelRemainingLiters ??
      snapshot?.fuelRemainingLiters,
  );
  const requiredFuel = Number(snapshot?.guarantee?.litersToCoverYou);
  if (
    !Number.isFinite(effectiveFuel) ||
    !Number.isFinite(requiredFuel) ||
    requiredFuel <= 0
  ) {
    return null;
  }
  return Math.max(0, Math.round((effectiveFuel / requiredFuel) * 100));
}

function fuelRemainingPercent(snapshot) {
  const directPercent = Number(
    snapshot?.guarantee?.fuelRemainingPercent ?? snapshot?.fuelRemainingPercent,
  );
  if (Number.isFinite(directPercent)) {
    return Math.max(0, Math.min(100, Math.round(directPercent)));
  }

  const remaining = Number(
    snapshot?.guarantee?.fuelRemainingLiters ?? snapshot?.fuelRemainingLiters,
  );
  const capacity = Number(snapshot?.guarantee?.fuelCapacityLiters);
  if (
    !Number.isFinite(remaining) ||
    !Number.isFinite(capacity) ||
    capacity <= 0
  ) {
    return null;
  }

  return Math.max(0, Math.min(100, Math.round((remaining / capacity) * 100)));
}

function nowServingDisplay(snapshot) {
  const carsAhead = Number(snapshot?.carsAhead);
  const position = Number(snapshot?.position);
  const hasUserTurn =
    (Number.isFinite(carsAhead) && carsAhead <= 0) ||
    (Number.isFinite(position) && position <= 1);
  if (hasUserTurn) return "You";

  if (isFiniteNumber(snapshot?.nowServing)) {
    return `#${snapshot.nowServing}`;
  }
  return "Unavailable";
}

function snapshotFromMessage(previous, message) {
  if (!message || typeof message !== "object") return previous;
  if (message.type === "queue:snapshot" && message.data) {
    return message.data;
  }

  if (!previous) return previous;
  if (message.type === "queue:update" && message.data) {
    return {
      ...previous,
      queueStatus: message.data.queueStatus ?? previous.queueStatus,
      position: message.data.position ?? previous.position,
      carsAhead: message.data.carsAhead ?? previous.carsAhead,
      totalQueued: message.data.totalQueued ?? previous.totalQueued,
      etaMinutes: message.data.etaMinutes ?? previous.etaMinutes,
    };
  }

  if (message.type === "queue:movement" && message.data) {
    return {
      ...previous,
      nowServing: message.data.nowServing ?? previous.nowServing,
      lastMovementAt: message.data.lastMovementAt ?? previous.lastMovementAt,
      movementState: message.data.movementState ?? previous.movementState,
      pauseReason: message.data.pauseReason ?? previous.pauseReason,
      expectedResumeAt:
        message.data.expectedResumeAt ?? previous.expectedResumeAt,
    };
  }

  if (message.type === "station:status") {
    return {
      ...previous,
      stationStatus: message.data ?? null,
    };
  }

  if (message.type === "queue:fuel" && message.data) {
    const guarantee = message.data.guarantee ?? previous.guarantee ?? null;
    const guaranteeState =
      message.data.guaranteeState ??
      guarantee?.state ??
      previous.guaranteeState ??
      "none";
    return {
      ...previous,
      fuelRemainingLiters:
        message.data.fuelRemainingLiters ??
        guarantee?.fuelRemainingLiters ??
        previous.fuelRemainingLiters ??
        null,
      fuelRemainingPercent:
        message.data.fuelRemainingPercent ??
        guarantee?.fuelRemainingPercent ??
        previous.fuelRemainingPercent ??
        null,
      guarantee,
      guaranteeState,
    };
  }

  return previous;
}

function queueProgressValue(snapshot) {
  if (!snapshot) return 0;
  if (
    !isFiniteNumber(snapshot.totalQueued) ||
    !isFiniteNumber(snapshot.position)
  )
    return 0;
  const totalQueued = Math.max(1, Number(snapshot.totalQueued));
  const position = Math.max(1, Number(snapshot.position));
  const completed = Math.max(0, totalQueued - position + 1);
  return Math.min(100, Math.round((completed / totalQueued) * 100));
}

function nearQueueInstructions(carsAhead) {
  if (carsAhead <= 5) {
    return [
      "Prepare to enter the station",
      "Wait for staff to direct you to a pump",
      "Scan the QR sticker on that pump",
      "Proceed to the pump",
    ];
  }

  return [
    "Keep this screen open for live queue movement",
    "Drive toward the station as your position drops",
    "Avoid leaving the queue unless necessary",
    "Tap Scan Pump QR when staff assigns your pump",
  ];
}

function fuelTypeLabel(fuelType) {
  const normalized = String(fuelType || "").toUpperCase();
  if (normalized === "DIESEL") return "Diesel";
  return "Petrol";
}

function paymentModeLabel(value) {
  return String(value || "").trim().toUpperCase() === "PREPAY"
    ? "Wallet prepay"
    : "Pay at pump";
}

function formatMoney(amount, currencyCode = "MWK") {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return null;
  try {
    return new Intl.NumberFormat("en-MW", {
      style: "currency",
      currency: String(currencyCode || "MWK").trim() || "MWK",
      maximumFractionDigits: 2,
    }).format(numeric);
  } catch {
    return `${currencyCode} ${numeric.toFixed(2)}`;
  }
}

function formatLitresValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return "0.00 L";
  return `${numeric.toFixed(numeric >= 10 ? 1 : 2)} L`;
}

function isQueueEntryMissingError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (!message) return false;
  return message.includes("queue entry not found");
}

export function QueueStatusScreen({ queueJoinId, onBack, onLeaveComplete }) {
  const queueData = useMemo(
    () => (userQueueApi.isApiMode() ? userQueueApi : queueMockService),
    [],
  );
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef(0);
  const unsubscribeSocketRef = useRef(() => {});
  const calledAudioRef = useRef(null);
  const servedExitTimerRef = useRef(0);
  const pumpScannerVideoRef = useRef(null);
  const pumpScannerStreamRef = useRef(null);
  const pumpScannerFrameRef = useRef(0);
  const pumpScannerDetectorRef = useRef(null);
  const pumpScannerLastScanAtRef = useRef(0);
  const pumpScannerLockRef = useRef(false);
  const thresholdNotificationRef = useRef({
    warnedAtFive: false,
    warnedAtOne: false,
  });
  const servedModalShownRef = useRef(new Set());
  const calledModalShownRef = useRef(new Set());
  const liveProgressModalShownRef = useRef(new Set());

  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState("");
  const [toasts, setToasts] = useState([]);
  const [showPumpScanModal, setShowPumpScanModal] = useState(false);
  const [pumpScanValue, setPumpScanValue] = useState("");
  const [pumpScanError, setPumpScanError] = useState("");
  const [isPumpScanSubmitting, setIsPumpScanSubmitting] = useState(false);
  const [isPumpScannerStarting, setIsPumpScannerStarting] = useState(false);
  const [isPumpScannerActive, setIsPumpScannerActive] = useState(false);
  const [showDispenseRequestModal, setShowDispenseRequestModal] = useState(false);
  const [dispenseLiters, setDispenseLiters] = useState("");
  const [dispenseError, setDispenseError] = useState("");
  const [isSubmittingDispenseRequest, setIsSubmittingDispenseRequest] =
    useState(false);
  const [showCalledModal, setShowCalledModal] = useState(false);
  const [showLiveProgressModal, setShowLiveProgressModal] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [leaveReason, setLeaveReason] = useState("");
  const [isLeaving, setIsLeaving] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [issueType, setIssueType] = useState(ISSUE_TYPES[0].value);
  const [issueMessage, setIssueMessage] = useState("");
  const [isReporting, setIsReporting] = useState(false);
  const [clockTick, setClockTick] = useState(0);

  const pushToast = useCallback((message, tone = "info") => {
    const toastId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev, { id: toastId, message, tone }].slice(-4));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== toastId));
    }, 4200);
  }, []);

  const playCalledSound = useCallback(() => {
    try {
      if (!calledAudioRef.current && typeof window?.Audio === "function") {
        calledAudioRef.current = new window.Audio(CALLED_SOUND_SRC);
        calledAudioRef.current.preload = "auto";
      }

      const audio = calledAudioRef.current;
      if (!audio) return;
      audio.currentTime = 0;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {});
      }
    } catch {
      // Ignore playback errors (autoplay restrictions / unsupported codecs).
    }
  }, []);

  useEffect(() => {
    if (typeof window?.Audio !== "function") return undefined;
    if (!calledAudioRef.current) {
      calledAudioRef.current = new window.Audio(CALLED_SOUND_SRC);
      calledAudioRef.current.preload = "auto";
    }

    return () => {
      const calledAudio = calledAudioRef.current;
      if (calledAudio) {
        calledAudio.pause();
        calledAudio.src = "";
      }
      calledAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (servedExitTimerRef.current) {
        window.clearTimeout(servedExitTimerRef.current);
      }
    };
  }, []);

  const refreshSnapshot = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      setError("");

      try {
        const next = await queueData.getStatus(queueJoinId);
        setSnapshot(next);
        setLastSyncedAt(new Date().toISOString());
        setIsStale(false);
      } catch (requestError) {
        if (isQueueEntryMissingError(requestError)) {
          clearStoredActiveQueueJoinId();
          setSnapshot(null);
          setIsStale(false);
          setError("Your previous queue session is no longer active.");
          onLeaveComplete?.();
          return;
        }
        setError(requestError?.message || "Failed to load queue status");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [onLeaveComplete, queueData, queueJoinId],
  );

  useEffect(() => {
    refreshSnapshot();
  }, [refreshSnapshot]);

  useEffect(() => {
    if (!queueJoinId) return undefined;

    const hasLiveSession =
      Boolean(snapshot?.serviceRequest) ||
      ["WAITING", "CALLED", "LATE"].includes(String(snapshot?.queueStatus || "").toUpperCase());
    if (!hasLiveSession) return undefined;

    const intervalMs = isConnected
      ? LIVE_QUEUE_POLL_CONNECTED_MS
      : LIVE_QUEUE_POLL_DISCONNECTED_MS;

    const timerId = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      void refreshSnapshot({ silent: true });
    }, intervalMs);

    return () => {
      window.clearInterval(timerId);
    };
  }, [
    isConnected,
    queueJoinId,
    refreshSnapshot,
    snapshot?.queueStatus,
    snapshot?.serviceRequest,
  ]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setClockTick((value) => value + 1);
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    const carsAhead = Number(snapshot.carsAhead || 0);

    if (carsAhead === 5 && !thresholdNotificationRef.current.warnedAtFive) {
      thresholdNotificationRef.current.warnedAtFive = true;
      pushToast("You're 5 cars away", "warning");
    }

    if (carsAhead <= 1 && !thresholdNotificationRef.current.warnedAtOne) {
      thresholdNotificationRef.current.warnedAtOne = true;
      pushToast("You're next", "success");
    }
  }, [pushToast, snapshot]);

  useEffect(() => {
    const serviceRequest = snapshot?.serviceRequest;
    if (!shouldShowServiceRequestProgress(serviceRequest)) {
      setShowLiveProgressModal(false);
      return;
    }

    const modalKey =
      String(serviceRequest?.pumpSessionReference || "").trim()
      || String(serviceRequest?.submittedAt || "").trim()
      || "current";

    if (liveProgressModalShownRef.current.has(modalKey)) return;
    liveProgressModalShownRef.current.add(modalKey);
    setShowLiveProgressModal(true);
  }, [
    snapshot?.serviceRequest?.dispensedLitres,
    snapshot?.serviceRequest?.liveUpdatedAt,
    snapshot?.serviceRequest?.pumpSessionReference,
    snapshot?.serviceRequest?.submittedAt,
    snapshot?.serviceRequest?.dispensingActive,
    snapshot?.serviceRequest?.pumpSessionStatus,
  ]);

  useEffect(() => {
    const queueStatus = String(snapshot?.queueStatus || "").toUpperCase();
    if (queueStatus !== "SERVED") return;
    if (!queueJoinId) return;
    if (servedModalShownRef.current.has(queueJoinId)) return;

    servedModalShownRef.current.add(queueJoinId);
    emitQueueServedCelebration({
      ...snapshot,
      queueJoinId,
    });
    if (servedExitTimerRef.current) {
      window.clearTimeout(servedExitTimerRef.current);
    }
    servedExitTimerRef.current = window.setTimeout(() => {
      servedExitTimerRef.current = 0;
      if (onLeaveComplete) {
        onLeaveComplete();
        return;
      }
      onBack?.();
    }, APP_AIRDROP_CELEBRATION_DURATION_MS + 220);
  }, [onBack, onLeaveComplete, queueJoinId, snapshot]);

  useEffect(() => {
    const queueStatus = String(snapshot?.queueStatus || "").toUpperCase();
    if (queueStatus !== "CALLED") return;
    if (!queueJoinId) return;
    if (calledModalShownRef.current.has(queueJoinId)) return;

    calledModalShownRef.current.add(queueJoinId);
    pushToast("You have been called. Proceed to the station now.", "success");
    setShowCalledModal(true);
  }, [pushToast, queueJoinId, snapshot?.queueStatus]);

  useEffect(() => {
    if (!showCalledModal) return;
    playCalledSound();
  }, [playCalledSound, showCalledModal]);

  useEffect(() => {
    if (!snapshot) return;
    const nextLiters =
      snapshot?.serviceRequest?.liters ?? snapshot?.requestedLiters ?? "";
    setDispenseLiters(nextLiters ? String(nextLiters) : "");
  }, [snapshot?.requestedLiters, snapshot?.serviceRequest?.liters]);

  useEffect(() => {
    if (!lastSyncedAt) return undefined;

    const timerId = window.setInterval(() => {
      const elapsed = Date.now() - new Date(lastSyncedAt).getTime();
      if (elapsed > 45000 && !isConnected) {
        setIsStale(true);
      }
    }, 5000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [isConnected, lastSyncedAt]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
      return undefined;
    }

    const handleUserAlert = (event) => {
      const alertPayload = event?.detail && typeof event.detail === "object" ? event.detail : null;
      if (!alertPayload) return;

      const metadata = alertPayload.metadata && typeof alertPayload.metadata === "object"
        ? alertPayload.metadata
        : {};
      const alertEvent = String(metadata.event || "").trim().toLowerCase();
      const alertQueueJoinId = String(
        metadata.queueJoinId || metadata.orderPublicId || metadata.entryPublicId || "",
      ).trim();

      if (alertEvent !== "queue_service_request_updated") return;
      if (!alertQueueJoinId || alertQueueJoinId !== String(queueJoinId || "").trim()) return;

      pushToast(
        String(alertPayload.message || "Your fuel request was updated by the station attendant.").trim(),
        "info",
      );
      refreshSnapshot({ silent: true });
    };

    window.addEventListener(SMARTLINK_USER_ALERT_EVENT, handleUserAlert);
    return () => {
      window.removeEventListener(SMARTLINK_USER_ALERT_EVENT, handleUserAlert);
    };
  }, [pushToast, queueJoinId, refreshSnapshot]);

  useEffect(() => {
    let disposed = false;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = 0;
      }
    };

    const disconnectSocket = () => {
      unsubscribeSocketRef.current?.();
      unsubscribeSocketRef.current = () => {};
    };

    const scheduleReconnect = () => {
      clearReconnectTimer();
      if (disposed) return;

      const waitMs =
        RECONNECT_BACKOFF_MS[
          Math.min(reconnectAttemptRef.current, RECONNECT_BACKOFF_MS.length - 1)
        ];
      reconnectAttemptRef.current += 1;
      setIsConnected(false);
      setIsReconnecting(true);
      setIsStale(true);

      reconnectTimerRef.current = window.setTimeout(() => {
        connectSocket();
      }, waitMs);
    };

    const connectSocket = () => {
      if (disposed) return;
      disconnectSocket();

      try {
        unsubscribeSocketRef.current = queueData.connectQueueSocket({
          queueJoinId,
          onOpen: () => {
            if (disposed) return;
            reconnectAttemptRef.current = 0;
            setIsConnected(true);
            setIsReconnecting(false);
            setIsStale(false);
            refreshSnapshot({ silent: true });
          },
          onMessage: (message) => {
            if (disposed) return;
            setSnapshot((previous) => snapshotFromMessage(previous, message));
            if (message?.type !== "pong") {
              setLastSyncedAt(new Date().toISOString());
              setIsStale(false);
              setError("");
            }
          },
          onClose: () => {
            if (disposed) return;
            scheduleReconnect();
          },
          onError: () => {
            if (disposed) return;
            scheduleReconnect();
          },
        });
      } catch {
        scheduleReconnect();
      }
    };

    connectSocket();

    return () => {
      disposed = true;
      clearReconnectTimer();
      disconnectSocket();
      setIsConnected(false);
      setIsReconnecting(false);
    };
  }, [queueData, queueJoinId, refreshSnapshot]);

  const isQueueClosed = useMemo(() => {
    const status = String(snapshot?.queueStatus || "").toUpperCase();
    return Boolean(status) && !["WAITING", "CALLED", "LATE"].includes(status);
  }, [snapshot?.queueStatus]);

  const progressValue = queueProgressValue(snapshot);
  const guaranteeState = resolveGuaranteeState(snapshot);
  const fuelCoverage = guaranteeCoveragePercent(snapshot);
  const fuelRemainingPct = fuelRemainingPercent(snapshot);
  const nowServingValue = nowServingDisplay(snapshot);
  const instructions = nearQueueInstructions(Number(snapshot?.carsAhead || 0));
  const lastMovementText = formatRelativeTime(snapshot?.lastMovementAt);
  const usingApi = queueData === userQueueApi;
  const supportsBarcodeDetection =
    typeof window !== "undefined" &&
    typeof window.BarcodeDetector === "function" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function";
  const stationStatusUnavailable =
    !snapshot?.stationStatus ||
    ["active", "dispensing", "idle", "offline"].every(
      (key) => !isFiniteNumber(snapshot?.stationStatus?.[key]),
    );

  const stopPumpScanner = useCallback(() => {
    if (pumpScannerFrameRef.current) {
      window.cancelAnimationFrame(pumpScannerFrameRef.current);
      pumpScannerFrameRef.current = 0;
    }
    pumpScannerLastScanAtRef.current = 0;
    pumpScannerLockRef.current = false;
    pumpScannerDetectorRef.current = null;

    const stream = pumpScannerStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      pumpScannerStreamRef.current = null;
    }

    const video = pumpScannerVideoRef.current;
    if (video) {
      try {
        video.pause();
      } catch {
        // Ignore pause failures during modal teardown.
      }
      video.srcObject = null;
    }

    setIsPumpScannerStarting(false);
    setIsPumpScannerActive(false);
  }, []);

  const submitPumpScan = useCallback(
    async (qrToken) => {
      const scopedQrToken = String(qrToken || "").trim();
      if (!scopedQrToken) {
        setPumpScanError("Enter or scan a pump QR value first.");
        return;
      }

      setIsPumpScanSubmitting(true);
      setPumpScanError("");
      setError("");

      try {
        const response = await queueData.scanPumpQr(queueJoinId, { qrToken: scopedQrToken });
        const nextStatus = response?.status || null;
        if (nextStatus) {
          setSnapshot(nextStatus);
        } else {
          await refreshSnapshot({ silent: true });
        }
        setPumpScanValue("");
        setShowPumpScanModal(false);
        setDispenseError("");
        setDispenseLiters(
          String(
            nextStatus?.serviceRequest?.liters ??
              nextStatus?.requestedLiters ??
              snapshot?.requestedLiters ??
              "",
          ),
        );
        if (nextStatus?.verifiedPump && !nextStatus?.serviceRequest) {
          setShowDispenseRequestModal(true);
        }
        pushToast(response?.message || "Pump verified.", "success");
      } catch (requestError) {
        const message = requestError?.message || "Failed to verify pump QR";
        setPumpScanError(message);
        setError(message);
      } finally {
        setIsPumpScanSubmitting(false);
      }
    },
    [pushToast, queueData, queueJoinId, refreshSnapshot, snapshot?.requestedLiters],
  );

  const startPumpScanner = useCallback(async () => {
    if (!supportsBarcodeDetection) {
      setPumpScanError(
        "Live QR scanning is not supported on this device. Enter the pump ID manually.",
      );
      return;
    }

    stopPumpScanner();
    setPumpScanError("");
    setIsPumpScannerStarting(true);

    try {
      if (
        typeof window.BarcodeDetector.getSupportedFormats === "function"
      ) {
        const supportedFormats =
          await window.BarcodeDetector.getSupportedFormats();
        if (
          Array.isArray(supportedFormats) &&
          !supportedFormats.includes("qr_code")
        ) {
          throw new Error(
            "This device camera cannot scan QR codes here. Enter the pump ID manually.",
          );
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
        },
      });
      pumpScannerStreamRef.current = stream;

      const video = pumpScannerVideoRef.current;
      if (!video) {
        throw new Error("Camera preview could not start.");
      }

      video.srcObject = stream;
      video.muted = true;
      video.setAttribute("playsinline", "true");
      await video.play();

      pumpScannerDetectorRef.current = new window.BarcodeDetector({
        formats: ["qr_code"],
      });
      setIsPumpScannerStarting(false);
      setIsPumpScannerActive(true);

      const scanFrame = async () => {
        if (!pumpScannerDetectorRef.current || !pumpScannerVideoRef.current) {
          return;
        }

        pumpScannerFrameRef.current = window.requestAnimationFrame(scanFrame);

        const videoElement = pumpScannerVideoRef.current;
        if (
          pumpScannerLockRef.current ||
          videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
          return;
        }

        const now = performance.now();
        if (now - pumpScannerLastScanAtRef.current < 180) {
          return;
        }
        pumpScannerLastScanAtRef.current = now;

        try {
          const detected = await pumpScannerDetectorRef.current.detect(
            videoElement,
          );
          const qrValue = String(detected?.[0]?.rawValue || "").trim();
          if (!qrValue) return;

          pumpScannerLockRef.current = true;
          setPumpScanValue(qrValue);
          stopPumpScanner();
          await submitPumpScan(qrValue);
        } catch {
          // Ignore transient detector errors while the camera stream is active.
        }
      };

      pumpScannerFrameRef.current = window.requestAnimationFrame(scanFrame);
    } catch (requestError) {
      stopPumpScanner();
      setPumpScanError(
        requestError?.message ||
          "Could not access the camera. Enter the pump ID manually.",
      );
    }
  }, [stopPumpScanner, submitPumpScan, supportsBarcodeDetection]);

  useEffect(() => {
    if (!showPumpScanModal) {
      stopPumpScanner();
      return undefined;
    }

    setPumpScanValue("");
    setPumpScanError("");
    pumpScannerLockRef.current = false;

    if (supportsBarcodeDetection) {
      startPumpScanner();
    }

    return () => {
      stopPumpScanner();
    };
  }, [showPumpScanModal, startPumpScanner, stopPumpScanner, supportsBarcodeDetection]);

  const onPumpScanSubmit = async (event) => {
    event.preventDefault();
    await submitPumpScan(pumpScanValue);
  };

  const submitDispenseRequest = useCallback(
    async (event) => {
      event.preventDefault();
      if (typeof queueData.submitDispenseRequest !== "function") {
        setDispenseError("Dispense request is unavailable in this mode.");
        return;
      }

      const parsedLiters = Number(dispenseLiters);
      if (!Number.isFinite(parsedLiters) || parsedLiters <= 0) {
        setDispenseError("Enter a valid litre amount before continuing.");
        return;
      }

      setIsSubmittingDispenseRequest(true);
      setDispenseError("");
      setError("");

      try {
        const response = await queueData.submitDispenseRequest(queueJoinId, {
          liters: parsedLiters,
          prepay: String(snapshot?.paymentMode || "").toUpperCase() === "PREPAY",
        });
        if (response?.status) {
          setSnapshot(response.status);
        } else {
          await refreshSnapshot({ silent: true });
        }
        setShowDispenseRequestModal(false);
        pushToast(response?.message || "Fuel request sent.", "success");
      } catch (requestError) {
        const message =
          requestError?.message || "Failed to submit fuel request.";
        setDispenseError(message);
        setError(message);
      } finally {
        setIsSubmittingDispenseRequest(false);
      }
    },
    [
      dispenseLiters,
      pushToast,
      queueData,
      queueJoinId,
      refreshSnapshot,
      snapshot?.paymentMode,
    ],
  );

  const onLeaveQueue = async () => {
    setIsLeaving(true);
    setError("");
    try {
      const response = await queueData.leaveQueue(queueJoinId, {
        reason: leaveReason.trim() || undefined,
      });
      if (response?.status) {
        setSnapshot(response.status);
      } else {
        await refreshSnapshot({ silent: true });
      }
      setShowLeaveModal(false);
      pushToast("Queue position released", "warning");
      onLeaveComplete?.(response);
    } catch (requestError) {
      setError(requestError?.message || "Failed to leave queue");
    } finally {
      setIsLeaving(false);
    }
  };

  const onSubmitIssue = async (event) => {
    event.preventDefault();
    setIsReporting(true);
    setError("");
    try {
      const response = await queueData.reportIssue(queueJoinId, {
        issueType,
        message: issueMessage.trim() || undefined,
      });
      setShowReportModal(false);
      setIssueMessage("");
      pushToast(
        `Issue reported (${response?.referenceId || "queued"})`,
        "success",
      );
    } catch (requestError) {
      setError(requestError?.message || "Failed to report issue");
    } finally {
      setIsReporting(false);
    }
  };

  return (
    <section className="queue-status-screen">
      <header className="queue-status-header">
        <div className="queue-status-header-row">
          {onBack ? (
            <button
              type="button"
              className="queue-back-button"
              onClick={onBack}
              aria-label="Back"
            >
              <BackIcon size={16} />
            </button>
          ) : null}
          <div>
            <h2>You are in the queue</h2>
            <p>
              {snapshot?.station?.name || "Station"} •{" "}
              {snapshot?.station?.area || "Location"}
            </p>
          </div>
        </div>
        <span className="queue-fuel-chip">
          {fuelTypeLabel(snapshot?.fuelType)}
        </span>
      </header>

      {!usingApi ? (
        <div className="queue-banner is-info">
          Demo mode active: using local queue simulation.
        </div>
      ) : null}
      {isReconnecting ? (
        <div className="queue-banner is-warning">
          Reconnecting… live updates may be delayed.
        </div>
      ) : null}
      {String(snapshot?.queueStatus || "").toUpperCase() === "CALLED" ? (
        <div className="queue-banner is-success">
          You have been called. Proceed to the station now.
        </div>
      ) : null}
      {String(snapshot?.queueStatus || "").toUpperCase() === "SERVED" ? (
        <div className="queue-banner is-success">
          Service complete. Wrapping up your queue session.
        </div>
      ) : null}
      {isStale ? (
        <div className="queue-banner is-muted">
          Stale data: showing last known queue state.
        </div>
      ) : null}
      {error ? <div className="queue-banner is-error">{error}</div> : null}

      {loading && !snapshot ? (
        <article className="station-card queue-loading-card">
          <h3>Loading queue status…</h3>
          <p>Fetching your current position and live movement.</p>
        </article>
      ) : null}

      {!loading && !snapshot ? (
        <article className="station-card queue-loading-card">
          <h3>Queue status unavailable</h3>
          <p>We could not load this queue. Please retry.</p>
          <button
            type="button"
            className="details-action-button is-primary"
            onClick={() => refreshSnapshot()}
          >
            Retry
          </button>
        </article>
      ) : null}

      {snapshot ? (
        <>
          <article className="queue-card position-card">
            <header>
              <h3>Position</h3>
              <span
                className={`queue-movement-pill ${movementClass(snapshot.movementState)}`}
              >
                {movementLabel(snapshot.movementState)}
              </span>
            </header>
            <div className="position-main-row">
              <strong>
                {isFiniteNumber(snapshot.position)
                  ? `#${snapshot.position}`
                  : "-"}
              </strong>
              <div>
                <p>Cars ahead: {Number(snapshot.carsAhead || 0)}</p>
                <p>Estimated wait: {Number(snapshot.etaMinutes || 0)} min</p>
              </div>
            </div>
            <div
              className="queue-progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressValue}
            >
              <span style={{ width: `${progressValue}%` }} />
            </div>
            <small>
              {isFiniteNumber(snapshot.position) &&
              isFiniteNumber(snapshot.totalQueued)
                ? `Position ${snapshot.position} of ${snapshot.totalQueued} (${progressValue}%)`
                : "Total queue length unavailable"}
            </small>
          </article>

          <article className="queue-card">
            <h3>Live Queue Movement</h3>
            <div className="queue-grid-two">
              <p>
                <span>Now serving</span>
                <strong>{nowServingValue}</strong>
              </p>
              <p>
                <span>Last movement</span>
                <strong>{lastMovementText}</strong>
              </p>
            </div>
            {String(snapshot.movementState || "").toLowerCase() === "paused" ? (
              <p className="queue-paused-note">
                {snapshot.pauseReason || "Queue temporarily paused."}
                {snapshot.expectedResumeAt
                  ? ` Expected resume: ${formatTime(snapshot.expectedResumeAt)}`
                  : ""}
              </p>
            ) : null}
          </article>

          <article className="queue-card">
            <h3>Fuel Availability</h3>
            <div className="queue-grid-two">
              <p>
                <span>Fuel remaining</span>
                <strong>
                  {fuelRemainingPct !== null
                    ? `${fuelRemainingPct}%`
                    : "Unavailable"}
                </strong>
                {isFiniteNumber(snapshot.fuelRemainingLiters) ? (
                  <small className="queue-fuel-subtext">
                    {Number(snapshot.fuelRemainingLiters).toFixed(0)} L
                  </small>
                ) : null}
              </p>
              <p>
                <span>Guarantee</span>
                <strong
                  className={`queue-guarantee ${guaranteeClass(guaranteeState)}`}
                >
                  {guaranteeText(guaranteeState)}
                </strong>
              </p>
            </div>
            {fuelCoverage !== null ? (
              <p className="queue-muted queue-metric-note">
                Coverage ratio: {fuelCoverage}% of the liters required before
                your turn.
              </p>
            ) : null}
          </article>

          <article className="queue-card">
            <h3>What Happens Next</h3>
            <ol className="queue-instructions-list">
              {instructions.map((item) => (
                <li key={item}>
                  <ChevronRightIcon size={14} />
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </article>

          {snapshot?.verifiedPump ? (
            <article className="queue-card">
              <h3>Verified Pump</h3>
              <div className="queue-grid-two">
                <p>
                  <span>Pump</span>
                  <strong>
                    {Number.isFinite(Number(snapshot.verifiedPump.pumpNumber))
                      ? `Pump ${snapshot.verifiedPump.pumpNumber}`
                      : snapshot.verifiedPump.pumpPublicId || "Verified"}
                  </strong>
                </p>
                <p>
                  <span>Status</span>
                  <strong>{snapshot.verifiedPump.pumpStatus || "ACTIVE"}</strong>
                </p>
                <p>
                  <span>Assigned nozzle</span>
                  <strong>
                    {snapshot.verifiedPump.nozzleNumber
                      ? `Nozzle ${snapshot.verifiedPump.nozzleNumber}`
                      : snapshot.verifiedPump.nozzlePublicId || "Pending"}
                  </strong>
                </p>
                <p>
                  <span>Fuel</span>
                  <strong>{snapshot.verifiedPump.fuelType || snapshot.fuelType || "Unknown"}</strong>
                </p>
              </div>
              <p className="queue-muted queue-metric-note">
                Scanned {formatRelativeTime(snapshot.verifiedPump.scannedAt)}
              </p>
            </article>
          ) : null}

          {snapshot?.verifiedPump && !snapshot?.serviceRequest ? (
            <article className="queue-card">
              <h3>Confirm Fuel Request</h3>
              <p className="queue-muted queue-metric-note">
                Your pump is verified. Send the litres for this fill to start
                dispensing.
              </p>
              <div className="queue-grid-two">
                <p>
                  <span>Requested litres</span>
                  <strong>
                    {Number.isFinite(Number(snapshot.requestedLiters))
                      ? `${Number(snapshot.requestedLiters)} L`
                      : "Not set"}
                  </strong>
                </p>
                <p>
                  <span>Payment</span>
                  <strong>{paymentModeLabel(snapshot.paymentMode)}</strong>
                </p>
              </div>
              <button
                type="button"
                className="details-action-button is-primary"
                onClick={() => setShowDispenseRequestModal(true)}
              >
                Send Litres
              </button>
            </article>
          ) : null}

          {snapshot?.serviceRequest ? (
            <article className="queue-card">
              <h3>Dispensing Request</h3>
              {(() => {
                const effectiveServiceRequestPaymentMode =
                  resolveServiceRequestPaymentMode(
                    snapshot.serviceRequest,
                    snapshot.paymentMode,
                  );

                return (
                  <>
              <div className="queue-grid-two">
                <p>
                  <span>Litres</span>
                  <strong>
                    {Number.isFinite(Number(snapshot.serviceRequest.liters))
                      ? `${Number(snapshot.serviceRequest.liters)} L`
                      : "Pending"}
                  </strong>
                </p>
                <p>
                  <span>Payment</span>
                  <strong>
                    {paymentModeLabel(effectiveServiceRequestPaymentMode)}
                  </strong>
                </p>
              </div>
              <div className="queue-grid-two">
                <p>
                  <span>Status</span>
                  <strong>
                    {serviceRequestStatusLabel(snapshot.serviceRequest)}
                  </strong>
                </p>
                <p>
                  <span>Unit price</span>
                  <strong>
                    {formatMoney(
                      snapshot.serviceRequest.pricePerLitre,
                      snapshot.serviceRequest.currencyCode,
                    ) || "Unavailable"}
                  </strong>
                </p>
              </div>
              <div className="queue-grid-two">
                <p>
                  <span>Estimated amount</span>
                  <strong>
                    {formatMoney(
                      snapshot.serviceRequest.estimatedAmount,
                      snapshot.serviceRequest.currencyCode,
                    ) || "Unavailable"}
                  </strong>
                </p>
              </div>
              {shouldShowServiceRequestProgress(snapshot.serviceRequest) ? (
                <div className="queue-live-progress-summary">
                  <div>
                    <span className="queue-dispense-progress-eyebrow">
                      Current session
                    </span>
                    <strong>
                      {snapshot.serviceRequest.dispensingActive
                        ? "Dispensing in progress"
                        : "Dispensing completed"}
                    </strong>
                    <p className="queue-dispense-progress-note">
                      {formatLitresValue(snapshot.serviceRequest.dispensedLitres)} dispensed
                      {snapshot.serviceRequest.liveUpdatedAt
                        ? ` • Updated ${formatRelativeTime(snapshot.serviceRequest.liveUpdatedAt)}`
                        : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="details-action-button is-secondary"
                    onClick={() => setShowLiveProgressModal(true)}
                  >
                    Open Live Progress
                  </button>
                </div>
              ) : null}
              <p className="queue-muted queue-metric-note">
                Submitted{" "}
                {formatRelativeTime(snapshot.serviceRequest.submittedAt)}
                {snapshot.serviceRequest.walletTransactionReference
                  ? ` • Wallet ref ${snapshot.serviceRequest.walletTransactionReference}`
                  : ""}
              </p>
              {snapshot.serviceRequest.needsPaymentRecheck ? (
                <p className="queue-warning-text">
                  Your request was edited by the station. The updated quote is now shown and payment will be reviewed against the edited values.
                </p>
              ) : null}
                  </>
                );
              })()}
            </article>
          ) : null}

          <article className="queue-card">
            <h3>Station Live Status</h3>
            {stationStatusUnavailable ? (
              <p className="queue-muted">Station status unavailable</p>
            ) : (
              <div className="queue-grid-four">
                <p>
                  <span>Active</span>
                  <strong>{Number(snapshot.stationStatus.active || 0)}</strong>
                </p>
                <p>
                  <span>Dispensing</span>
                  <strong>
                    {Number(snapshot.stationStatus.dispensing || 0)}
                  </strong>
                </p>
                <p>
                  <span>Idle</span>
                  <strong>{Number(snapshot.stationStatus.idle || 0)}</strong>
                </p>
                <p>
                  <span>Offline</span>
                  <strong>{Number(snapshot.stationStatus.offline || 0)}</strong>
                </p>
              </div>
            )}
          </article>

          <div className="queue-action-row">
            <button
              type="button"
              className="details-action-button is-primary"
              onClick={() =>
                snapshot?.verifiedPump && !snapshot?.serviceRequest
                  ? setShowDispenseRequestModal(true)
                  : setShowPumpScanModal(true)
              }
            >
              <SearchIcon size={16} />
              {snapshot?.verifiedPump && !snapshot?.serviceRequest
                ? "Send Litres"
                : "Scan Pump QR"}
            </button>
            <button
              type="button"
              className="details-action-button is-secondary"
              onClick={() => setShowReportModal(true)}
            >
              Report Issue
            </button>
            <button
              type="button"
              className="details-action-button is-danger"
              onClick={() => setShowLeaveModal(true)}
              disabled={isQueueClosed}
            >
              Leave Queue
            </button>
          </div>
        </>
      ) : null}

      {showPumpScanModal ? (
        <div
          className="queue-modal-backdrop"
          role="presentation"
          onClick={() => setShowPumpScanModal(false)}
        >
          <form
            className="queue-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Scan pump QR code"
            onClick={(event) => event.stopPropagation()}
            onSubmit={onPumpScanSubmit}
          >
            <header>
              <h3>Scan Pump QR</h3>
              <button type="button" onClick={() => setShowPumpScanModal(false)}>
                Close
              </button>
            </header>

            <p className="queue-info-text">
              Scan the QR sticker on the pump assigned by station staff. This verifies that the pump belongs to your current station queue.
            </p>

            {supportsBarcodeDetection ? (
              <div className="queue-scanner-panel">
                <div className="queue-scanner-preview">
                  <video
                    ref={pumpScannerVideoRef}
                    className="queue-scanner-video"
                    autoPlay
                    muted
                    playsInline
                  />
                  <div className="queue-scanner-reticle" aria-hidden="true" />
                </div>
                <div className="queue-scanner-status">
                  <strong>
                    {isPumpScannerStarting
                      ? "Starting camera…"
                      : isPumpScannerActive
                        ? "Scanning live…"
                        : "Scanner paused"}
                  </strong>
                  <span>
                    Point your camera at the pump QR sticker and hold steady.
                  </span>
                </div>
                <div className="queue-modal-actions queue-modal-actions-stacked">
                  <button
                    type="button"
                    className="details-action-button is-secondary"
                    onClick={() => startPumpScanner()}
                    disabled={isPumpScannerStarting || isPumpScanSubmitting}
                  >
                    {isPumpScannerActive ? "Restart Scanner" : "Start Scanner"}
                  </button>
                </div>
              </div>
            ) : (
              <p className="queue-muted queue-metric-note">
                This browser cannot open the live QR scanner here. Enter the pump QR value or pump ID below.
              </p>
            )}

            <label className="queue-modal-input">
              <span>Pump QR value or pump ID</span>
              <input
                type="text"
                value={pumpScanValue}
                maxLength={600}
                placeholder="Paste scanned value or enter pump public ID"
                onChange={(event) => setPumpScanValue(event.target.value)}
              />
            </label>

            {pumpScanError ? (
              <p className="queue-warning-text">{pumpScanError}</p>
            ) : null}

            {snapshot?.verifiedPump ? (
              <small className="queue-qr-token">
                Last verified pump: {snapshot.verifiedPump.pumpPublicId || `Pump ${snapshot.verifiedPump.pumpNumber || ""}`}
                {snapshot.verifiedPump.nozzleNumber ? ` · Nozzle ${snapshot.verifiedPump.nozzleNumber}` : ""}
              </small>
            ) : null}

            <div className="queue-modal-actions">
              <button
                type="button"
                className="details-action-button is-secondary"
                onClick={() => setShowPumpScanModal(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="details-action-button is-primary"
                disabled={isPumpScanSubmitting || isPumpScannerStarting}
              >
                {isPumpScanSubmitting ? "Verifying…" : "Verify Pump"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {showDispenseRequestModal ? (
        <div
          className="queue-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (isSubmittingDispenseRequest) return;
            setShowDispenseRequestModal(false);
          }}
        >
          <form
            className="queue-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm fuel request"
            onClick={(event) => event.stopPropagation()}
            onSubmit={submitDispenseRequest}
          >
            <header>
              <h3>Confirm Litres</h3>
              <button
                type="button"
                onClick={() => {
                  if (isSubmittingDispenseRequest) return;
                  setShowDispenseRequestModal(false);
                }}
              >
                Close
              </button>
            </header>

            <p className="queue-info-text">
              Send the final litre amount for the verified pump. If you joined
              with wallet prepay, the amount will be deducted now.
            </p>

            <div className="queue-grid-two">
              <p>
                <span>Pump</span>
                <strong>
                  {snapshot?.verifiedPump?.pumpPublicId ||
                    `Pump ${snapshot?.verifiedPump?.pumpNumber || ""}`}
                </strong>
              </p>
              <p>
                <span>Nozzle</span>
                <strong>
                  {snapshot?.verifiedPump?.nozzleNumber
                    ? `Nozzle ${snapshot.verifiedPump.nozzleNumber}`
                    : snapshot?.verifiedPump?.nozzlePublicId || "Pending"}
                </strong>
              </p>
              <p>
                <span>Payment</span>
                <strong>{paymentModeLabel(snapshot?.paymentMode)}</strong>
              </p>
            </div>

            <label className="queue-modal-input">
              <span>Fuel amount (liters)</span>
              <input
                type="number"
                min={1}
                max={500}
                step="0.1"
                inputMode="decimal"
                value={dispenseLiters}
                placeholder="Enter liters"
                onChange={(event) => {
                  setDispenseLiters(event.target.value);
                  if (dispenseError) setDispenseError("");
                }}
              />
            </label>

            {snapshot?.paymentMode === "PREPAY" &&
            Number.isFinite(Number(snapshot?.requestedLiters)) ? (
              <p className="queue-muted queue-metric-note">
                Joined with wallet prepay enabled for approximately{" "}
                {Number(snapshot.requestedLiters)} L.
              </p>
            ) : null}

            {dispenseError ? (
              <p className="queue-warning-text">{dispenseError}</p>
            ) : null}

            <div className="queue-modal-actions">
              <button
                type="button"
                className="details-action-button is-secondary"
                onClick={() => setShowDispenseRequestModal(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="details-action-button is-primary"
                disabled={isSubmittingDispenseRequest}
              >
                {isSubmittingDispenseRequest
                  ? "Sending…"
                  : snapshot?.paymentMode === "PREPAY"
                    ? "Prepay and Start Dispensing"
                    : "Start Dispensing"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {showLiveProgressModal && shouldShowServiceRequestProgress(snapshot?.serviceRequest) ? (
        <div
          className="queue-modal-backdrop"
          role="presentation"
          onClick={() => setShowLiveProgressModal(false)}
        >
          <div
            className="queue-modal queue-progress-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Live dispensing progress"
            onClick={(event) => event.stopPropagation()}
          >
            {(() => {
              const effectiveServiceRequestPaymentMode =
                resolveServiceRequestPaymentMode(
                  snapshot.serviceRequest,
                  snapshot.paymentMode,
                );

              return (
                <>
            <header>
              <h3>Live Progress</h3>
              <button type="button" onClick={() => setShowLiveProgressModal(false)}>
                Close
              </button>
            </header>

            <div className="queue-dispense-progress queue-dispense-progress-modal">
              <div className="queue-dispense-progress-head">
                <div>
                  <span className="queue-dispense-progress-eyebrow">
                    Current session
                  </span>
                  <strong>
                    {snapshot.serviceRequest.dispensingActive
                      ? "Dispensing now"
                      : "Dispensing completed"}
                  </strong>
                </div>
                <span className="queue-dispense-live-pill">
                  {serviceRequestStatusLabel(snapshot.serviceRequest)}
                </span>
              </div>
              <div className="queue-dispense-hero">
                <div className="queue-dispense-hero-primary">
                  <span>Progress</span>
                  <strong>
                    {Number(snapshot.serviceRequest.dispensingProgressPercent || 0)}%
                  </strong>
                </div>
                <div className="queue-dispense-hero-secondary">
                  <p>
                    <span>Dispensed</span>
                    <strong>
                      {formatLitresValue(
                        snapshot.serviceRequest.dispensedLitres,
                      )}
                    </strong>
                  </p>
                  <p>
                    <span>Live amount</span>
                    <strong>
                      {formatMoney(
                        snapshot.serviceRequest.dispensedAmount,
                        snapshot.serviceRequest.currencyCode,
                      ) || "Unavailable"}
                    </strong>
                  </p>
                </div>
              </div>
              <div
                className="queue-progress-track queue-progress-track--dispensing"
                role="progressbar"
                aria-label="Dispensing progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Number(snapshot.serviceRequest.dispensingProgressPercent || 0)}
              >
                <span
                  style={{
                    width: `${Math.max(
                      0,
                      Math.min(100, Number(snapshot.serviceRequest.dispensingProgressPercent || 0)),
                    )}%`,
                  }}
                />
              </div>
              <div className="queue-grid-two queue-grid-two--compact queue-grid-two--dispense">
                <p>
                  <span>Target</span>
                  <strong>
                    {formatLitresValue(snapshot.serviceRequest.liters)}
                  </strong>
                </p>
                <p>
                  <span>Payment</span>
                  <strong>
                    {paymentModeLabel(effectiveServiceRequestPaymentMode)}
                  </strong>
                </p>
              </div>
              <p className="queue-dispense-progress-note">
                {snapshot.serviceRequest.dispensingActive
                  ? "Pump is dispensing now"
                  : "This run has been completed"}
                {snapshot.serviceRequest.liveUpdatedAt
                  ? ` • Updated ${formatRelativeTime(snapshot.serviceRequest.liveUpdatedAt)}`
                  : ""}
                {snapshot.serviceRequest.pumpSessionReference
                  ? ` • Session ${snapshot.serviceRequest.pumpSessionReference}`
                  : ""}
              </p>
            </div>

            <div className="queue-modal-actions">
              <button
                type="button"
                className="details-action-button is-primary"
                onClick={() => setShowLiveProgressModal(false)}
              >
                Close
              </button>
            </div>
                </>
              );
            })()}
          </div>
        </div>
      ) : null}

      {showLeaveModal ? (
        <div
          className="queue-modal-backdrop"
          role="presentation"
          onClick={() => setShowLeaveModal(false)}
        >
          <div
            className="queue-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Leave queue confirmation"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <h3>Leave Queue?</h3>
              <button type="button" onClick={() => setShowLeaveModal(false)}>
                Close
              </button>
            </header>
            <p className="queue-warning-text">
              Leaving now will permanently remove your queue position.
            </p>
            <label className="queue-modal-input">
              <span>Reason (optional)</span>
              <input
                type="text"
                value={leaveReason}
                maxLength={255}
                placeholder="Optional reason"
                onChange={(event) => setLeaveReason(event.target.value)}
              />
            </label>
            <div className="queue-modal-actions">
              <button
                type="button"
                className="details-action-button is-secondary"
                onClick={() => setShowLeaveModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="details-action-button is-danger"
                onClick={onLeaveQueue}
                disabled={isLeaving}
              >
                {isLeaving ? "Leaving…" : "Confirm Leave"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showReportModal ? (
        <div
          className="queue-modal-backdrop"
          role="presentation"
          onClick={() => setShowReportModal(false)}
        >
          <form
            className="queue-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Report queue issue"
            onClick={(event) => event.stopPropagation()}
            onSubmit={onSubmitIssue}
          >
            <header>
              <h3>Report Issue</h3>
              <button type="button" onClick={() => setShowReportModal(false)}>
                Close
              </button>
            </header>

            <label className="queue-modal-input">
              <span>Issue type</span>
              <select
                value={issueType}
                onChange={(event) => setIssueType(event.target.value)}
              >
                {ISSUE_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="queue-modal-input">
              <span>Message (optional)</span>
              <textarea
                rows={4}
                maxLength={1200}
                value={issueMessage}
                placeholder="Add details to help support investigate."
                onChange={(event) => setIssueMessage(event.target.value)}
              />
            </label>

            <div className="queue-modal-actions">
              <button
                type="button"
                className="details-action-button is-secondary"
                onClick={() => setShowReportModal(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="details-action-button is-primary"
                disabled={isReporting}
              >
                {isReporting ? "Submitting…" : "Submit"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {showCalledModal ? (
        <div
          className="queue-modal-backdrop"
          role="presentation"
          onClick={() => setShowCalledModal(false)}
        >
          <div
            className="queue-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Queue call notice"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <h3>Your Turn</h3>
              <button type="button" onClick={() => setShowCalledModal(false)}>
                Close
              </button>
            </header>
            <p className="queue-warning-text">
              The manager has called you. Proceed to the station now.
            </p>
            <div className="queue-modal-actions">
              <button
                type="button"
                className="details-action-button is-primary"
                onClick={() => setShowCalledModal(false)}
              >
                On my way
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toasts.length ? (
        <div className="queue-toast-stack" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`queue-toast is-${toast.tone}`}>
              <FuelPumpIcon size={14} />
              <span>{toast.message}</span>
            </div>
          ))}
        </div>
      ) : null}

      <small className="queue-last-sync" key={clockTick}>
        {lastSyncedAt
          ? `Last synced ${formatRelativeTime(lastSyncedAt)}`
          : "Waiting for sync…"}
      </small>
    </section>
  );
}
