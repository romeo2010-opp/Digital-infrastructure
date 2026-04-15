import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { userQueueApi } from "../api/userQueueApi";
import { formatDateTime } from "../dateTime";
import { maskPublicId } from "../../utils/masking";
import {
  playSmartlinkCue,
  SMARTLINK_AUDIO_CUES,
} from "../../utils/smartlinkAudio";
import { downloadBlobFile } from "../utils/smartPayReceipt";

const TRANSACTION_FILTERS = [
  { key: "ALL", label: "All" },
  { key: "TOPUP", label: "Top-Ups" },
  { key: "PAYMENT", label: "Payments" },
  { key: "TRANSFER", label: "Transfers" },
  { key: "REFUND", label: "Refunds" },
  { key: "REVERSAL", label: "Reversals" },
];

const TRANSACTION_TYPE_LABELS = {
  TOPUP: "Top-Up",
  PAYMENT: "Payment",
  TRANSFER: "Transfer",
  REFUND: "Refund",
  REVERSAL: "Reversal",
  ADJUSTMENT: "Adjustment",
  HOLD: "Hold",
  RELEASE: "Release",
  RESERVATION_PAYMENT: "Reservation Payment",
  QUEUE_FEE: "Queue Fee",
};

const TRANSACTION_STATUS_LABELS = {
  PENDING: "Pending",
  POSTED: "Posted",
  COMPLETED: "Completed",
  FAILED: "Failed",
  REVERSED: "Reversed",
  CANCELLED: "Cancelled",
};

const HOLD_TYPE_LABELS = {
  RESERVATION: "Reservation",
  QUEUE_FEE: "Queue Fee",
  QUEUE_PREPAY: "Queue Prepay",
  MANUAL_HOLD: "Manual Hold",
};

const REFUND_REQUEST_WINDOW_HOURS = 24;
const REFUND_REQUEST_WINDOW_MS = REFUND_REQUEST_WINDOW_HOURS * 60 * 60 * 1000;

function isAbortError(error) {
  if (!error) return false;
  if (error?.name === "AbortError") return true;
  const message = String(error?.message || "").toLowerCase();
  return message.includes("abort");
}

function toMoneyNumber(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Number(numeric.toFixed(2));
}

function formatMoney(amount, currencyCode = "MWK") {
  const normalizedAmount = toMoneyNumber(amount);
  const isWhole = Math.abs(normalizedAmount % 1) < 0.001;
  return `${currencyCode} ${normalizedAmount.toLocaleString(undefined, {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatSignedMoney(amount, currencyCode, direction) {
  const prefix =
    direction === "INFLOW" ? "+" : direction === "OUTFLOW" ? "-" : "";
  return `${prefix}${formatMoney(amount, currencyCode)}`;
}

function normalizeWalletSummary(payload) {
  const wallet = payload?.wallet || payload || {};
  return {
    walletId: String(wallet?.walletId || wallet?.id || "").trim(),
    walletPublicId: String(
      wallet?.walletPublicId || wallet?.wallet_public_id || "",
    ).trim(),
    walletNumber: String(
      wallet?.walletNumber || wallet?.wallet_number || "",
    ).trim(),
    internalWalletNumber: String(
      wallet?.internalWalletNumber || wallet?.internal_wallet_number || "",
    ).trim(),
    status: String(wallet?.status || "ACTIVE")
      .trim()
      .toUpperCase(),
    currencyCode:
      String(wallet?.currencyCode || wallet?.currency_code || "MWK").trim() ||
      "MWK",
    ledgerBalance: toMoneyNumber(
      wallet?.ledgerBalance ?? wallet?.ledger_balance,
    ),
    availableBalance: toMoneyNumber(
      wallet?.availableBalance ?? wallet?.available_balance,
    ),
    lockedBalance: toMoneyNumber(
      wallet?.lockedBalance ?? wallet?.locked_balance,
    ),
    pendingInflow: toMoneyNumber(
      wallet?.pendingInflow ?? wallet?.pending_inflow,
    ),
    pendingOutflow: toMoneyNumber(
      wallet?.pendingOutflow ?? wallet?.pending_outflow,
    ),
    activeHoldAmount: toMoneyNumber(
      wallet?.activeHoldAmount ?? wallet?.active_hold_amount,
    ),
    initializedNow: Boolean(wallet?.initializedNow),
    createdAt: wallet?.createdAt || wallet?.created_at || null,
    updatedAt: wallet?.updatedAt || wallet?.updated_at || null,
  };
}

function normalizeTransaction(item, index = 0) {
  const reference = String(
    item?.reference || item?.transactionReference || `wallet-tx-${index}`,
  ).trim();
  return {
    id:
      String(item?.id || reference || `wallet-tx-${index}`).trim() ||
      `wallet-tx-${index}`,
    reference,
    type: String(item?.type || item?.transactionType || "ADJUSTMENT")
      .trim()
      .toUpperCase(),
    typeCode:
      String(item?.typeCode || item?.transactionTypeCode || "")
        .trim()
        .toUpperCase() || null,
    typeGroup: String(
      item?.typeGroup ||
        item?.transactionTypeGroup ||
        item?.type ||
        item?.transactionType ||
        "ADJUSTMENT",
    )
      .trim()
      .toUpperCase(),
    status: String(item?.status || item?.transactionStatus || "PENDING")
      .trim()
      .toUpperCase(),
    amount: toMoneyNumber(item?.amount ?? item?.netAmount ?? item?.net_amount),
    currencyCode:
      String(item?.currencyCode || item?.currency_code || "MWK").trim() ||
      "MWK",
    direction: String(item?.direction || "NEUTRAL")
      .trim()
      .toUpperCase(),
    description: String(item?.description || "").trim() || null,
    transactionPublicId:
      String(
        item?.transactionPublicId || item?.transaction_public_id || "",
      ).trim() || null,
    transactionOccurredAt:
      item?.transactionOccurredAt || item?.transaction_occurred_at || null,
    externalReference:
      String(
        item?.externalReference || item?.external_reference || "",
      ).trim() || null,
    relatedEntityType:
      String(
        item?.relatedEntityType || item?.related_entity_type || "",
      ).trim() || null,
    relatedEntityId:
      String(item?.relatedEntityId || item?.related_entity_id || "").trim() ||
      null,
    createdAt: item?.createdAt || item?.created_at || null,
    postedAt: item?.postedAt || item?.posted_at || null,
  };
}

function getRefundEligibilityTimestamp(transaction) {
  return (
    transaction?.transactionOccurredAt ||
    transaction?.postedAt ||
    transaction?.createdAt ||
    null
  );
}

function isRefundWindowOpen(transaction, now = Date.now()) {
  const timestamp = getRefundEligibilityTimestamp(transaction);
  if (!timestamp) return false;
  const occurredAt = new Date(timestamp);
  if (Number.isNaN(occurredAt.getTime())) return false;
  const elapsedMs = now - occurredAt.getTime();
  if (elapsedMs < 0) return true;
  return elapsedMs <= REFUND_REQUEST_WINDOW_MS;
}

function isPostedPaymentTransaction(transaction) {
  return (
    String(transaction?.typeGroup || transaction?.type || "")
      .trim()
      .toUpperCase() === "PAYMENT" &&
    String(transaction?.status || "")
      .trim()
      .toUpperCase() === "POSTED"
  );
}

function canSubmitRefundForTransaction(transaction) {
  return (
    isPostedPaymentTransaction(transaction) &&
    Boolean(String(transaction?.transactionPublicId || "").trim())
  );
}

function normalizeHold(item, index = 0) {
  const reference = String(item?.reference || `hold-${index}`).trim();
  return {
    id:
      String(item?.id || reference || `hold-${index}`).trim() ||
      `hold-${index}`,
    reference,
    holdType: String(item?.holdType || item?.hold_type || "RESERVATION")
      .trim()
      .toUpperCase(),
    status: String(item?.status || "ACTIVE")
      .trim()
      .toUpperCase(),
    amount: toMoneyNumber(item?.amount),
    currencyCode:
      String(item?.currencyCode || item?.currency_code || "MWK").trim() ||
      "MWK",
    expiresAt: item?.expiresAt || item?.expires_at || null,
    createdAt: item?.createdAt || item?.created_at || null,
    relatedEntityType:
      String(
        item?.relatedEntityType || item?.related_entity_type || "",
      ).trim() || null,
    relatedEntityId:
      String(item?.relatedEntityId || item?.related_entity_id || "").trim() ||
      null,
  };
}

function normalizeRefundRequest(item, index = 0) {
  return {
    id:
      String(item?.publicId || item?.id || `refund-${index}`).trim() ||
      `refund-${index}`,
    publicId:
      String(item?.publicId || item?.public_id || `refund-${index}`).trim() ||
      `refund-${index}`,
    transactionPublicId:
      String(
        item?.transactionPublicId || item?.transaction_public_id || "",
      ).trim() || null,
    walletTransactionReference:
      String(
        item?.walletTransactionReference ||
          item?.wallet_transaction_reference ||
          "",
      ).trim() || null,
    amountMwk: toMoneyNumber(item?.amountMwk ?? item?.amount_mwk),
    priority: String(item?.priority || "MEDIUM")
      .trim()
      .toUpperCase(),
    status: String(item?.status || "PENDING_SUPPORT_REVIEW")
      .trim()
      .toUpperCase(),
    createdAt: item?.createdAt || item?.created_at || null,
    reviewedAt: item?.reviewedAt || item?.reviewed_at || null,
    creditedAt: item?.creditedAt || item?.credited_at || null,
  };
}

function normalizeStationLockedBalances(payload) {
  return {
    walletId:
      String(payload?.walletId || payload?.wallet_id || "").trim() || null,
    walletPublicId:
      String(
        payload?.walletPublicId || payload?.wallet_public_id || "",
      ).trim() || null,
    currencyCode:
      String(payload?.currencyCode || payload?.currency_code || "MWK").trim() ||
      "MWK",
    totalLockedBalance: toMoneyNumber(
      payload?.totalLockedBalance ?? payload?.total_locked_balance,
    ),
    items: Array.isArray(payload?.items)
      ? payload.items.map((item, index) => ({
          id:
            String(
              item?.stationPublicId ||
                item?.station_id ||
                `station-lock-${index}`,
            ).trim() || `station-lock-${index}`,
          stationId:
            String(item?.stationId || item?.station_id || "").trim() || null,
          stationPublicId:
            String(
              item?.stationPublicId || item?.station_public_id || "",
            ).trim() || null,
          stationName:
            String(item?.stationName || item?.station_name || "").trim() ||
            "Station",
          amountMwk: toMoneyNumber(item?.amountMwk ?? item?.amount_mwk),
          currencyCode:
            String(
              item?.currencyCode ||
                item?.currency_code ||
                payload?.currencyCode ||
                "MWK",
            ).trim() || "MWK",
          activeLockCount:
            Number((item?.activeLockCount ?? item?.active_lock_count) || 0) ||
            0,
          latestCreatedAt:
            item?.latestCreatedAt || item?.latest_created_at || null,
        }))
      : [],
  };
}

function normalizeTransferHistoryItem(item, index = 0) {
  const publicId =
    String(
      item?.publicId || item?.public_id || `wallet-transfer-${index}`,
    ).trim() || `wallet-transfer-${index}`;
  const direction = String(item?.direction || "NEUTRAL")
    .trim()
    .toUpperCase();
  const counterparty = item?.counterparty || {};

  return {
    id: publicId,
    publicId,
    amountMwk: toMoneyNumber(item?.amountMwk ?? item?.amount_mwk),
    currencyCode:
      String(item?.currencyCode || item?.currency_code || "MWK").trim() ||
      "MWK",
    transferMode: String(item?.transferMode || item?.transfer_mode || "NORMAL")
      .trim()
      .toUpperCase(),
    status: String(item?.status || "PENDING")
      .trim()
      .toUpperCase(),
    direction,
    initiatedVia: String(item?.initiatedVia || item?.initiated_via || "USER_ID")
      .trim()
      .toUpperCase(),
    qrReference:
      String(item?.qrReference || item?.qr_reference || "").trim() || null,
    note: String(item?.note || "").trim() || null,
    createdAt: item?.createdAt || item?.created_at || null,
    completedAt: item?.completedAt || item?.completed_at || null,
    failedAt: item?.failedAt || item?.failed_at || null,
    station: item?.station
      ? {
          id: String(item.station?.id || "").trim() || null,
          publicId:
            String(
              item.station?.publicId || item.station?.public_id || "",
            ).trim() || null,
          name: String(item.station?.name || "").trim() || "Station",
        }
      : null,
    counterparty: {
      userId:
        String(counterparty?.userId || counterparty?.user_id || "").trim() ||
        null,
      publicId:
        String(
          counterparty?.publicId || counterparty?.public_id || "",
        ).trim() || null,
      fullName:
        String(
          counterparty?.fullName || counterparty?.full_name || "",
        ).trim() || "SmartLink user",
    },
  };
}

function transactionTypeLabel(type) {
  return (
    TRANSACTION_TYPE_LABELS[
      String(type || "")
        .trim()
        .toUpperCase()
    ] || "Transaction"
  );
}

function transactionStatusLabel(status) {
  return (
    TRANSACTION_STATUS_LABELS[
      String(status || "")
        .trim()
        .toUpperCase()
    ] || "Pending"
  );
}

function holdTypeLabel(type) {
  return (
    HOLD_TYPE_LABELS[
      String(type || "")
        .trim()
        .toUpperCase()
    ] || "Hold"
  );
}

function transferModeLabel(mode) {
  return String(mode || "")
    .trim()
    .toUpperCase() === "STATION_LOCKED"
    ? "Station Locked"
    : "Normal Credit";
}

function walletStatusClass(status) {
  if (status === "SUSPENDED") return "is-suspended";
  if (status === "CLOSED") return "is-closed";
  return "is-active";
}

function transactionStatusClass(status) {
  if (status === "FAILED" || status === "CANCELLED") return "is-error";
  if (status === "REVERSED") return "is-warning";
  if (status === "PENDING") return "is-pending";
  return "is-posted";
}

function getReceiptDownloadConfig(transaction) {
  const relatedEntityType = String(transaction?.relatedEntityType || "")
    .trim()
    .toUpperCase();
  const relatedEntityId = String(transaction?.relatedEntityId || "").trim();
  if (!relatedEntityId) return null;
  if (relatedEntityType === "QUEUE") {
    return { receiptType: "queue", reference: relatedEntityId };
  }
  if (relatedEntityType === "RESERVATION") {
    return { receiptType: "reservation", reference: relatedEntityId };
  }
  return null;
}

function paymentPurposeLabel(transaction) {
  const relatedEntityType = String(transaction?.relatedEntityType || "")
    .trim()
    .toUpperCase();
  const relatedEntityId = String(transaction?.relatedEntityId || "").trim();

  if (relatedEntityType === "QUEUE") {
    return relatedEntityId
      ? `Queue service · ${relatedEntityId}`
      : "Queue service";
  }
  if (relatedEntityType === "RESERVATION") {
    return relatedEntityId
      ? `Reservation service · ${relatedEntityId}`
      : "Reservation service";
  }
  return (
    transaction?.description ||
    transaction?.externalReference ||
    "Wallet payment"
  );
}

export function WalletScreen({ onOpenSendCredit }) {
  const walletApi = useMemo(
    () => (userQueueApi.isApiMode() ? userQueueApi : null),
    [],
  );
  const historyRef = useRef(null);
  const transferHistoryRef = useRef(null);
  const [wallet, setWallet] = useState(null);
  const [holds, setHolds] = useState([]);
  const [stationLockedBalances, setStationLockedBalances] = useState({
    totalLockedBalance: 0,
    currencyCode: "MWK",
    items: [],
  });
  const [transactions, setTransactions] = useState([]);
  const [transferHistory, setTransferHistory] = useState([]);
  const [refundRequests, setRefundRequests] = useState([]);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [stationLocksLoading, setStationLocksLoading] = useState(true);
  const [transactionsLoading, setTransactionsLoading] = useState(true);
  const [transferHistoryLoading, setTransferHistoryLoading] = useState(true);
  const [refundsLoading, setRefundsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingMoreTransfers, setLoadingMoreTransfers] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [stationLocksError, setStationLocksError] = useState("");
  const [transactionsError, setTransactionsError] = useState("");
  const [transferHistoryError, setTransferHistoryError] = useState("");
  const [refundsError, setRefundsError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [transactionPage, setTransactionPage] = useState(1);
  const [transferHistoryPage, setTransferHistoryPage] = useState(1);
  const [hasMoreTransactions, setHasMoreTransactions] = useState(false);
  const [hasMoreTransfers, setHasMoreTransfers] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);
  const [topupAmount, setTopupAmount] = useState("");
  const [topupNote, setTopupNote] = useState("");
  const [topupError, setTopupError] = useState("");
  const [topupSubmitting, setTopupSubmitting] = useState(false);
  const [refundModalTransaction, setRefundModalTransaction] = useState(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundError, setRefundError] = useState("");
  const [refundSubmitting, setRefundSubmitting] = useState(false);
  const [detailsModalTransaction, setDetailsModalTransaction] = useState(null);
  const [openTransactionMenuId, setOpenTransactionMenuId] = useState("");
  const transactionMenuRootRef = useRef(null);

  useEffect(() => {
    if (!openTransactionMenuId) return undefined;
    const handlePointerDown = (event) => {
      if (transactionMenuRootRef.current?.contains(event.target)) return;
      setOpenTransactionMenuId("");
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openTransactionMenuId]);

  const loadWalletSnapshot = useCallback(
    async ({ signal } = {}) => {
      if (!walletApi) {
        setSummaryLoading(false);
        setSummaryError(
          "Wallet is available only when the user app is connected to the API.",
        );
        setWallet(null);
        setHolds([]);
        return;
      }

      setSummaryLoading(true);
      setSummaryError("");
      try {
        const [summaryPayload, holdsPayload] = await Promise.all([
          walletApi.getWalletSummary({ signal }),
          walletApi.getWalletHolds({ signal, status: "ACTIVE", limit: 10 }),
        ]);
        if (signal?.aborted) return;
        setWallet(normalizeWalletSummary(summaryPayload));
        setHolds(
          Array.isArray(holdsPayload?.items)
            ? holdsPayload.items.map(normalizeHold)
            : [],
        );
      } catch (requestError) {
        if (signal?.aborted || isAbortError(requestError)) return;
        setWallet(null);
        setHolds([]);
        setSummaryError(
          requestError?.message || "Unable to load wallet overview.",
        );
      } finally {
        if (!signal?.aborted) {
          setSummaryLoading(false);
        }
      }
    },
    [walletApi],
  );

  const loadStationLockedBalances = useCallback(
    async ({ signal } = {}) => {
      if (!walletApi) {
        setStationLocksLoading(false);
        setStationLocksError(
          "Station-locked balances are available only in API mode.",
        );
        setStationLockedBalances({
          totalLockedBalance: 0,
          currencyCode: wallet?.currencyCode || "MWK",
          items: [],
        });
        return;
      }

      setStationLocksLoading(true);
      setStationLocksError("");
      try {
        const payload = await walletApi.getWalletStationLockedBalances({
          signal,
        });
        if (signal?.aborted) return;
        setStationLockedBalances(normalizeStationLockedBalances(payload));
      } catch (requestError) {
        if (signal?.aborted || isAbortError(requestError)) return;
        setStationLockedBalances({
          totalLockedBalance: 0,
          currencyCode: wallet?.currencyCode || "MWK",
          items: [],
        });
        setStationLocksError(
          requestError?.message || "Unable to load station-locked balances.",
        );
      } finally {
        if (!signal?.aborted) {
          setStationLocksLoading(false);
        }
      }
    },
    [wallet?.currencyCode, walletApi],
  );

  const loadTransactions = useCallback(
    async ({
      signal,
      page = 1,
      append = false,
      filterOverride = filter,
    } = {}) => {
      if (!walletApi) {
        setTransactionsLoading(false);
        setTransactionsError(
          "Wallet transactions are available only in API mode.",
        );
        setTransactions([]);
        setHasMoreTransactions(false);
        return;
      }

      if (append) {
        setLoadingMore(true);
      } else {
        setTransactionsLoading(true);
        setTransactionsError("");
      }

      try {
        const payload = await walletApi.getWalletTransactions({
          signal,
          page,
          limit: 10,
          type: filterOverride === "ALL" ? undefined : filterOverride,
        });
        if (signal?.aborted) return;
        const rows = Array.isArray(payload?.items)
          ? payload.items.map(normalizeTransaction)
          : [];
        setTransactions((current) => (append ? [...current, ...rows] : rows));
        setTransactionPage(page);
        setHasMoreTransactions(Boolean(payload?.hasMore));
      } catch (requestError) {
        if (signal?.aborted || isAbortError(requestError)) return;
        if (!append) {
          setTransactions([]);
          setTransactionsError(
            requestError?.message || "Unable to load wallet transactions.",
          );
        }
      } finally {
        if (!signal?.aborted) {
          setTransactionsLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [filter, walletApi],
  );

  const loadRefundRequests = useCallback(
    async ({ signal } = {}) => {
      if (!walletApi) {
        setRefundsLoading(false);
        setRefundsError("Refund requests are available only in API mode.");
        setRefundRequests([]);
        return;
      }

      setRefundsLoading(true);
      setRefundsError("");
      try {
        const payload = await walletApi.getWalletRefunds({ signal });
        if (signal?.aborted) return;
        const rows = Array.isArray(payload?.items)
          ? payload.items.map(normalizeRefundRequest)
          : [];
        setRefundRequests(rows);
      } catch (requestError) {
        if (signal?.aborted || isAbortError(requestError)) return;
        setRefundRequests([]);
        setRefundsError(
          requestError?.message || "Unable to load refund requests.",
        );
      } finally {
        if (!signal?.aborted) {
          setRefundsLoading(false);
        }
      }
    },
    [walletApi],
  );

  const loadTransferHistory = useCallback(
    async ({ signal, page = 1, append = false } = {}) => {
      if (!walletApi) {
        setTransferHistoryLoading(false);
        setTransferHistoryError(
          "Transfer history is available only in API mode.",
        );
        setTransferHistory([]);
        setHasMoreTransfers(false);
        return;
      }

      if (append) {
        setLoadingMoreTransfers(true);
      } else {
        setTransferHistoryLoading(true);
        setTransferHistoryError("");
      }

      try {
        const payload = await walletApi.getWalletTransferHistory({
          signal,
          page,
          limit: 10,
        });
        if (signal?.aborted) return;
        const rows = Array.isArray(payload?.items)
          ? payload.items.map(normalizeTransferHistoryItem)
          : [];
        setTransferHistory((current) =>
          append ? [...current, ...rows] : rows,
        );
        setTransferHistoryPage(page);
        setHasMoreTransfers(Boolean(payload?.hasMore));
      } catch (requestError) {
        if (signal?.aborted || isAbortError(requestError)) return;
        if (!append) {
          setTransferHistory([]);
          setTransferHistoryError(
            requestError?.message || "Unable to load wallet transfer history.",
          );
        }
      } finally {
        if (!signal?.aborted) {
          setTransferHistoryLoading(false);
          setLoadingMoreTransfers(false);
        }
      }
    },
    [walletApi],
  );

  const refreshWallet = useCallback(async () => {
    setFeedback("");
    await Promise.all([
      loadWalletSnapshot({}),
      loadStationLockedBalances({}),
      loadTransactions({ page: 1, append: false, filterOverride: filter }),
      loadTransferHistory({ page: 1, append: false }),
      loadRefundRequests({}),
    ]);
  }, [
    filter,
    loadRefundRequests,
    loadStationLockedBalances,
    loadTransactions,
    loadTransferHistory,
    loadWalletSnapshot,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    loadWalletSnapshot({ signal: controller.signal });
    return () => controller.abort();
  }, [loadWalletSnapshot]);

  useEffect(() => {
    const controller = new AbortController();
    loadTransactions({
      signal: controller.signal,
      page: 1,
      append: false,
      filterOverride: filter,
    });
    return () => controller.abort();
  }, [filter, loadTransactions]);

  useEffect(() => {
    const controller = new AbortController();
    loadStationLockedBalances({ signal: controller.signal });
    return () => controller.abort();
  }, [loadStationLockedBalances]);

  useEffect(() => {
    const controller = new AbortController();
    loadTransferHistory({ signal: controller.signal, page: 1, append: false });
    return () => controller.abort();
  }, [loadTransferHistory]);

  useEffect(() => {
    const controller = new AbortController();
    loadRefundRequests({ signal: controller.signal });
    return () => controller.abort();
  }, [loadRefundRequests]);

  const handleLoadMore = useCallback(() => {
    if (!hasMoreTransactions || loadingMore || transactionsLoading) return;
    loadTransactions({
      page: transactionPage + 1,
      append: true,
      filterOverride: filter,
    });
  }, [
    filter,
    hasMoreTransactions,
    loadingMore,
    loadTransactions,
    transactionPage,
    transactionsLoading,
  ]);

  const handleLoadMoreTransfers = useCallback(() => {
    if (!hasMoreTransfers || loadingMoreTransfers || transferHistoryLoading)
      return;
    loadTransferHistory({ page: transferHistoryPage + 1, append: true });
  }, [
    hasMoreTransfers,
    loadTransferHistory,
    loadingMoreTransfers,
    transferHistoryLoading,
    transferHistoryPage,
  ]);

  const handleTopupSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      setTopupError("");
      setFeedback("");

      if (!walletApi) {
        setTopupError("Wallet top-ups are available only in API mode.");
        return;
      }

      const amount = Number(topupAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        setTopupError("Enter a valid top-up amount greater than zero.");
        return;
      }

      setTopupSubmitting(true);
      try {
        await walletApi.createWalletTopup({
          amount,
          note: topupNote.trim() || undefined,
        });
        setTopupOpen(false);
        setTopupAmount("");
        setTopupNote("");
        setFeedback(
          `Top-up posted successfully for ${formatMoney(amount, wallet?.currencyCode || "MWK")}.`,
        );
        playSmartlinkCue(SMARTLINK_AUDIO_CUES.WALLET_TOPUP_SUCCESS);
        await Promise.all([
          loadWalletSnapshot({}),
          loadStationLockedBalances({}),
          loadTransactions({ page: 1, append: false, filterOverride: filter }),
          loadTransferHistory({ page: 1, append: false }),
        ]);
      } catch (requestError) {
        setTopupError(requestError?.message || "Unable to post wallet top-up.");
      } finally {
        setTopupSubmitting(false);
      }
    },
    [
      filter,
      loadStationLockedBalances,
      loadTransactions,
      loadTransferHistory,
      loadWalletSnapshot,
      topupAmount,
      topupNote,
      wallet?.currencyCode,
      walletApi,
    ],
  );

  const handleOpenRefundModal = useCallback((transaction) => {
    setOpenTransactionMenuId("");
    if (!isRefundWindowOpen(transaction)) {
      setFeedback(
        `Refund requests must be submitted within ${REFUND_REQUEST_WINDOW_HOURS} hours of the transaction.`,
      );
      return;
    }
    setRefundModalTransaction(transaction);
    setRefundAmount(transaction?.amount ? String(transaction.amount) : "");
    setRefundReason("");
    setRefundError("");
  }, []);

  const handleRefundSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      setRefundError("");
      setFeedback("");

      if (!walletApi) {
        setRefundError("Refund requests are available only in API mode.");
        return;
      }

      const transactionPublicId = String(
        refundModalTransaction?.transactionPublicId || "",
      ).trim();
      if (!transactionPublicId) {
        setRefundError(
          "This wallet transaction is missing a refundable transaction reference.",
        );
        return;
      }
      if (!isRefundWindowOpen(refundModalTransaction)) {
        setRefundError(
          `Refund requests must be submitted within ${REFUND_REQUEST_WINDOW_HOURS} hours of the transaction.`,
        );
        return;
      }

      const amount = Number(refundAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        setRefundError("Enter a valid refund amount greater than zero.");
        return;
      }

      const reason = String(refundReason || "").trim();
      if (reason.length < 5) {
        setRefundError("Add a short reason for the refund request.");
        return;
      }

      setRefundSubmitting(true);
      try {
        const result = await walletApi.createWalletRefund({
          transactionPublicId,
          amount,
          reason,
        });
        setRefundModalTransaction(null);
        setRefundAmount("");
        setRefundReason("");
        setFeedback(
          `Refund request ${result?.refundPublicId || ""} submitted for review.`.trim(),
        );
        await Promise.all([
          loadRefundRequests({}),
          loadTransactions({ page: 1, append: false, filterOverride: filter }),
        ]);
      } catch (requestError) {
        setRefundError(
          requestError?.message || "Unable to submit refund request.",
        );
      } finally {
        setRefundSubmitting(false);
      }
    },
    [
      filter,
      loadRefundRequests,
      loadTransactions,
      refundAmount,
      refundModalTransaction?.transactionPublicId,
      refundReason,
      walletApi,
    ],
  );

  const handleDownloadTransactionReceipt = useCallback(
    async (transaction) => {
      setOpenTransactionMenuId("");
      setFeedback("");

      const receiptConfig = getReceiptDownloadConfig(transaction);
      if (!walletApi || !receiptConfig) {
        setFeedback("Receipt download is not available for this payment yet.");
        return;
      }

      try {
        const result = await walletApi.downloadReceiptPdf(receiptConfig);
        downloadBlobFile(
          result?.blob,
          result?.filename ||
            `smartpay-${receiptConfig.receiptType}-receipt.pdf`,
        );
        setFeedback("Receipt download started.");
      } catch (requestError) {
        setFeedback(requestError?.message || "Unable to download receipt.");
      }
    },
    [walletApi],
  );

  const handleOpenTransactionDetails = useCallback((transaction) => {
    setOpenTransactionMenuId("");
    setDetailsModalTransaction(transaction);
  }, []);

  const activeHoldAmount = wallet?.activeHoldAmount || 0;
  const walletIsActive = !wallet || wallet.status === "ACTIVE";

  return (
    <section className="wallet-screen">
      <header className="screen-header">
        <h2>Wallet</h2>
        <p>
          {wallet
            ? `${formatMoney(wallet.availableBalance, wallet.currencyCode)} available`
            : summaryLoading
              ? "Loading wallet overview…"
              : "Wallet overview and transaction history"}
        </p>
      </header>

      {summaryError ? (
        <section className="station-card coming-soon">
          <h3>Unable to load wallet</h3>
          <p>{summaryError}</p>
          <div className="wallet-inline-actions">
            <button
              type="button"
              className="details-action-button is-secondary"
              onClick={refreshWallet}
            >
              Retry
            </button>
          </div>
        </section>
      ) : null}

      {feedback ? (
        <section className="station-card wallet-feedback-card">
          <p>{feedback}</p>
        </section>
      ) : null}

      {summaryLoading && !wallet ? (
        <article className="wallet-summary-card is-loading">
          <div className="wallet-summary-head">
            <div>
              <span className="wallet-summary-eyebrow">SmartLink Wallet</span>
              <h3>Refreshing balance</h3>
            </div>
            <span className="wallet-status-pill is-active">Loading</span>
          </div>
          <p className="wallet-summary-amount">MWK --</p>
          <div className="wallet-metric-grid">
            <div className="wallet-metric-card">
              <span>Ledger balance</span>
              <strong>MWK --</strong>
            </div>
            <div className="wallet-metric-card">
              <span>Active holds</span>
              <strong>MWK --</strong>
            </div>
          </div>
        </article>
      ) : null}

      {wallet ? (
        <article className="wallet-summary-card">
          <div className="wallet-summary-head">
            <div>
              <span className="wallet-summary-eyebrow">SmartLink Wallet</span>
              <h3>
                {wallet.walletPublicId ||
                  maskPublicId(wallet.walletNumber, { prefix: 4, suffix: 4 }) ||
                  wallet.walletNumber}
              </h3>
            </div>
            <span
              className={`wallet-status-pill ${walletStatusClass(wallet.status)}`}
            >
              {wallet.status === "SUSPENDED"
                ? "Suspended"
                : wallet.status === "CLOSED"
                  ? "Closed"
                  : "Active"}
            </span>
          </div>

          <p className="wallet-summary-caption">Available balance</p>
          <p className="wallet-summary-amount">
            {formatMoney(wallet.availableBalance, wallet.currencyCode)}
          </p>

          <div className="wallet-metric-grid">
            <div className="wallet-metric-card">
              <span>Ledger balance</span>
              <strong>
                {formatMoney(wallet.ledgerBalance, wallet.currencyCode)}
              </strong>
            </div>
            <div className="wallet-metric-card">
              <span>Station-locked credit</span>
              <strong>
                {formatMoney(wallet.lockedBalance, wallet.currencyCode)}
              </strong>
            </div>
            <div className="wallet-metric-card">
              <span>Pending inflow</span>
              <strong>
                {formatMoney(wallet.pendingInflow, wallet.currencyCode)}
              </strong>
            </div>
            <div className="wallet-metric-card">
              <span>Pending outflow</span>
              <strong>
                {formatMoney(wallet.pendingOutflow, wallet.currencyCode)}
              </strong>
            </div>
            <div className="wallet-metric-card">
              <span>Active holds</span>
              <strong>
                {formatMoney(activeHoldAmount, wallet.currencyCode)}
              </strong>
            </div>
          </div>

          <div className="wallet-summary-meta">
            <span>
              Wallet ID: {wallet.walletPublicId || wallet.walletNumber}
            </span>
            <span>
              Updated: {formatDateTime(wallet.updatedAt, undefined, "Just now")}
            </span>
          </div>
        </article>
      ) : null}

      <section className="wallet-section">
        <div className="wallet-section-head">
          <div>
            <h3>Quick actions</h3>
            <p>Prototype-safe wallet actions</p>
          </div>
        </div>

        <div className="wallet-action-grid">
          <button
            type="button"
            className="details-action-button is-primary"
            onClick={() => onOpenSendCredit?.()}
            disabled={
              summaryLoading || !walletIsActive || Boolean(summaryError)
            }
          >
            Send Credit
          </button>
          <button
            type="button"
            className="details-action-button is-secondary"
            onClick={() => {
              setTopupError("");
              setTopupOpen(true);
            }}
            disabled={
              summaryLoading || !walletIsActive || Boolean(summaryError)
            }
          >
            Top Up Wallet
          </button>
          <button
            type="button"
            className="details-action-button is-secondary"
            onClick={() =>
              historyRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              })
            }
          >
            Ledger History
          </button>
          <button
            type="button"
            className="details-action-button is-secondary"
            onClick={() =>
              transferHistoryRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              })
            }
          >
            Transfers
          </button>
        </div>

        <div className="wallet-action-grid">
          <button
            type="button"
            className="details-action-button is-secondary"
            onClick={() =>
              document
                .getElementById("wallet-refunds-section")
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            View Refunds
          </button>
          <button
            type="button"
            className="details-action-button is-secondary"
            onClick={refreshWallet}
            disabled={summaryLoading || transactionsLoading}
          >
            Refresh Balance
          </button>
        </div>
      </section>

      <section className="wallet-section">
        <div className="wallet-section-head">
          <div>
            <h3>Station-locked balances</h3>
            <p>Locked credit can only be spent at the matched station.</p>
          </div>
        </div>

        {stationLocksError ? (
          <section className="station-card coming-soon">
            <h3>Unable to load locked balances</h3>
            <p>{stationLocksError}</p>
            <div className="wallet-inline-actions">
              <button
                type="button"
                className="details-action-button is-secondary"
                onClick={() => loadStationLockedBalances({})}
              >
                Retry
              </button>
            </div>
          </section>
        ) : null}

        {stationLocksLoading ? (
          <section className="station-card coming-soon">
            <h3>Loading locked balances</h3>
            <p>Checking station-restricted credit in your wallet.</p>
          </section>
        ) : null}

        {!stationLocksLoading && !stationLocksError ? (
          stationLockedBalances.items.length ? (
            <div className="wallet-station-lock-list">
              <article className="wallet-station-lock-total-card">
                <span>Total locked balance</span>
                <strong>
                  {formatMoney(
                    stationLockedBalances.totalLockedBalance,
                    stationLockedBalances.currencyCode,
                  )}
                </strong>
              </article>

              {stationLockedBalances.items.map((item) => (
                <article key={item.id} className="wallet-station-lock-card">
                  <div className="wallet-station-lock-top">
                    <div>
                      <h4>{item.stationName}</h4>
                      <p>{item.stationPublicId || "Station lock"}</p>
                    </div>
                    <strong>
                      {formatMoney(item.amountMwk, item.currencyCode)}
                    </strong>
                  </div>
                  <div className="wallet-station-lock-meta">
                    <span>
                      <small>Active locks</small>
                      <strong>{item.activeLockCount}</strong>
                    </span>
                    <span>
                      <small>Latest credit</small>
                      <strong>
                        {formatDateTime(
                          item.latestCreatedAt,
                          undefined,
                          "Unavailable",
                        )}
                      </strong>
                    </span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <section className="station-card coming-soon">
              <h3>No station-locked credit</h3>
              <p>
                Locked balances will appear here when someone sends you
                station-restricted SmartLink credit.
              </p>
            </section>
          )
        ) : null}
      </section>

      <section className="wallet-section" ref={historyRef}>
        <div className="wallet-section-head">
          <div>
            <h3>Transaction history</h3>
            <p>Recent wallet movement</p>
          </div>
        </div>

        <div className="wallet-filter-row">
          {TRANSACTION_FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`wallet-filter-chip ${filter === item.key ? "is-active" : ""}`}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {transactionsError ? (
          <section className="station-card coming-soon">
            <h3>Unable to load transactions</h3>
            <p>{transactionsError}</p>
            <div className="wallet-inline-actions">
              <button
                type="button"
                className="details-action-button is-secondary"
                onClick={refreshWallet}
              >
                Retry
              </button>
            </div>
          </section>
        ) : null}

        {transactionsLoading ? (
          <section className="station-card coming-soon">
            <h3>Loading transactions</h3>
            <p>Fetching your latest wallet activity.</p>
          </section>
        ) : null}

        {!transactionsLoading && !transactionsError && transactions.length ? (
          <div className="wallet-transaction-list" ref={transactionMenuRootRef}>
            {transactions.map((item) => {
              const isPayment = isPostedPaymentTransaction(item);
              const receiptConfig = getReceiptDownloadConfig(item);
              const refundAvailable = canSubmitRefundForTransaction(item);
              const refundWindowOpen = isRefundWindowOpen(item);
              const isMenuOpen = openTransactionMenuId === item.id;

              return (
                <article key={item.id} className="wallet-transaction-card">
                  <div className="wallet-transaction-top">
                    <div>
                      <h4>
                        {transactionTypeLabel(item.typeCode || item.type)}
                      </h4>
                    </div>
                    <div className="wallet-transaction-actions">
                      <div
                        className={`wallet-transaction-amount ${item.direction === "INFLOW" ? "is-inflow" : item.direction === "OUTFLOW" ? "is-outflow" : ""}`}
                      >
                        {formatSignedMoney(
                          item.amount,
                          item.currencyCode,
                          item.direction,
                        )}
                      </div>

                      {isPayment ? (
                        <div
                          className="wallet-overflow-menu"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="wallet-overflow-trigger"
                            aria-label="Payment options"
                            aria-expanded={isMenuOpen}
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenTransactionMenuId((current) =>
                                current === item.id ? "" : item.id,
                              );
                            }}
                          >
                            <span aria-hidden="true">⋯</span>
                          </button>

                          {isMenuOpen ? (
                            <div className="wallet-overflow-panel" role="menu">
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() =>
                                  handleOpenTransactionDetails(item)
                                }
                              >
                                Details
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() =>
                                  handleDownloadTransactionReceipt(item)
                                }
                                disabled={!receiptConfig}
                              >
                                Download receipt
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => handleOpenRefundModal(item)}
                                disabled={!refundAvailable || !refundWindowOpen}
                              >
                                Request refund
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="wallet-transaction-meta">
                    <span>
                      <small>Status</small>
                      <strong
                        className={`wallet-inline-pill ${transactionStatusClass(item.status)}`}
                      >
                        {transactionStatusLabel(item.status)}
                      </strong>
                    </span>
                    <span>
                      <small>Reference</small>
                      <strong>
                        {maskPublicId(item.reference, { prefix: 4, suffix: 4 })}
                      </strong>
                    </span>
                    <span>
                      <small>Date</small>
                      <strong>
                        {formatDateTime(
                          item.postedAt || item.createdAt,
                          undefined,
                          "Unavailable",
                        )}
                      </strong>
                    </span>
                    <span>
                      <small>Related</small>
                      <strong>
                        {item.relatedEntityType
                          ? `${item.relatedEntityType}${item.relatedEntityId ? ` · ${item.relatedEntityId}` : ""}`
                          : "—"}
                      </strong>
                    </span>
                  </div>

                  {isPayment && !refundAvailable ? (
                    <p className="wallet-transaction-note is-warning">
                      This payment is not linked to a refundable transaction
                      reference yet.
                    </p>
                  ) : null}

                  {isPayment && refundAvailable && !refundWindowOpen ? (
                    <p className="wallet-transaction-note is-warning">
                      Refund window expired. Requests must be submitted within
                      24 hours of the transaction.
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : null}

        {!transactionsLoading && !transactionsError && !transactions.length ? (
          <section className="station-card coming-soon">
            <h3>No wallet transactions yet</h3>
            <p>
              Your top-ups, payments, refunds, and reversals will appear here.
            </p>
          </section>
        ) : null}

        {hasMoreTransactions && !transactionsLoading ? (
          <div className="wallet-inline-actions">
            <button
              type="button"
              className="details-action-button is-secondary"
              onClick={handleLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        ) : null}
      </section>

      <section className="wallet-section" ref={transferHistoryRef}>
        <div className="wallet-section-head">
          <div>
            <h3>Transfer history</h3>
            <p>Closed-loop SmartLink credit sent and received.</p>
          </div>
        </div>

        {transferHistoryError ? (
          <section className="station-card coming-soon">
            <h3>Unable to load transfers</h3>
            <p>{transferHistoryError}</p>
            <div className="wallet-inline-actions">
              <button
                type="button"
                className="details-action-button is-secondary"
                onClick={() => loadTransferHistory({ page: 1, append: false })}
              >
                Retry
              </button>
            </div>
          </section>
        ) : null}

        {transferHistoryLoading ? (
          <section className="station-card coming-soon">
            <h3>Loading transfers</h3>
            <p>Fetching sent and received wallet credit transfers.</p>
          </section>
        ) : null}

        {!transferHistoryLoading &&
        !transferHistoryError &&
        transferHistory.length ? (
          <div className="wallet-transfer-list">
            {transferHistory.map((item) => (
              <article key={item.id} className="wallet-transfer-card">
                <div className="wallet-transaction-top">
                  <div>
                    <h4>
                      {item.direction === "SENT"
                        ? "Credit sent"
                        : item.direction === "RECEIVED"
                          ? "Credit received"
                          : "Wallet transfer"}
                    </h4>
                    <p>
                      {item.counterparty.fullName}
                      {item.counterparty.publicId
                        ? ` · ${item.counterparty.publicId}`
                        : ""}
                    </p>
                  </div>
                  <div
                    className={`wallet-transaction-amount ${item.direction === "RECEIVED" ? "is-inflow" : item.direction === "SENT" ? "is-outflow" : ""}`}
                  >
                    {formatSignedMoney(
                      item.amountMwk,
                      item.currencyCode,
                      item.direction === "RECEIVED"
                        ? "INFLOW"
                        : item.direction === "SENT"
                          ? "OUTFLOW"
                          : "NEUTRAL",
                    )}
                  </div>
                </div>

                <div className="wallet-transfer-badge-row">
                  <span
                    className={`wallet-inline-pill ${item.transferMode === "STATION_LOCKED" ? "is-warning" : "is-posted"}`}
                  >
                    {transferModeLabel(item.transferMode)}
                  </span>
                  <span
                    className={`wallet-inline-pill ${transactionStatusClass(item.status)}`}
                  >
                    {transactionStatusLabel(item.status)}
                  </span>
                  <span className="wallet-inline-pill is-posted">
                    {item.initiatedVia === "QR" ? "QR" : "User ID"}
                  </span>
                </div>

                <div className="wallet-transaction-meta">
                  <span>
                    <small>Transfer ID</small>
                    <strong>
                      {maskPublicId(item.publicId, { prefix: 4, suffix: 4 })}
                    </strong>
                  </span>
                  <span>
                    <small>Completed</small>
                    <strong>
                      {formatDateTime(
                        item.completedAt || item.createdAt,
                        undefined,
                        "Unavailable",
                      )}
                    </strong>
                  </span>
                  <span>
                    <small>Station</small>
                    <strong>
                      {item.station?.name || "Any SmartLink station"}
                    </strong>
                  </span>
                  <span>
                    <small>Recipient method</small>
                    <strong>
                      {item.initiatedVia === "QR"
                        ? "Signed QR"
                        : "SmartLink user ID"}
                    </strong>
                  </span>
                </div>

                {item.note ? (
                  <p className="wallet-transaction-note">{item.note}</p>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}

        {!transferHistoryLoading &&
        !transferHistoryError &&
        !transferHistory.length ? (
          <section className="station-card coming-soon">
            <h3>No transfers yet</h3>
            <p>
              Send Credit activity will appear here after you transfer SmartLink
              wallet credit.
            </p>
          </section>
        ) : null}

        {hasMoreTransfers && !transferHistoryLoading ? (
          <div className="wallet-inline-actions">
            <button
              type="button"
              className="details-action-button is-secondary"
              onClick={handleLoadMoreTransfers}
              disabled={loadingMoreTransfers}
            >
              {loadingMoreTransfers ? "Loading…" : "Load more transfers"}
            </button>
          </div>
        ) : null}
      </section>

      <section className="wallet-section" id="wallet-refunds-section">
        <div className="wallet-section-head">
          <div>
            <h3>Refund requests</h3>
            <p>Track refund submissions and current review status.</p>
          </div>
        </div>

        {refundsError ? (
          <section className="station-card coming-soon">
            <h3>Unable to load refund requests</h3>
            <p>{refundsError}</p>
            <div className="wallet-inline-actions">
              <button
                type="button"
                className="details-action-button is-secondary"
                onClick={() => loadRefundRequests({})}
              >
                Retry
              </button>
            </div>
          </section>
        ) : null}

        {refundsLoading ? (
          <section className="station-card coming-soon">
            <h3>Loading refund requests</h3>
            <p>Checking your submitted refund requests.</p>
          </section>
        ) : null}

        {!refundsLoading && !refundsError && refundRequests.length ? (
          <div className="wallet-refund-list">
            {refundRequests.map((item) => (
              <article key={item.id} className="wallet-refund-card">
                <div className="wallet-transaction-top">
                  <div>
                    <h4>{item.publicId}</h4>
                    <p>Refund request</p>
                  </div>
                  <div className="wallet-transaction-amount is-inflow">
                    {formatMoney(item.amountMwk, wallet?.currencyCode || "MWK")}
                  </div>
                </div>

                <div className="wallet-transaction-meta">
                  <span>
                    <small>Status</small>
                    <strong
                      className={`wallet-inline-pill ${transactionStatusClass(item.status === "REJECTED" ? "FAILED" : item.status.includes("PENDING") ? "PENDING" : "POSTED")}`}
                    >
                      {item.status.replace(/_/g, " ")}
                    </strong>
                  </span>
                  <span>
                    <small>Transaction</small>
                    <strong>
                      {maskPublicId(item.transactionPublicId || "-", {
                        prefix: 4,
                        suffix: 4,
                      })}
                    </strong>
                  </span>
                  <span>
                    <small>Submitted</small>
                    <strong>
                      {formatDateTime(item.createdAt, undefined, "Unavailable")}
                    </strong>
                  </span>
                  <span>
                    <small>Credited</small>
                    <strong>
                      {formatDateTime(item.creditedAt, undefined, "Pending")}
                    </strong>
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {!refundsLoading && !refundsError && !refundRequests.length ? (
          <section className="station-card coming-soon">
            <h3>No refund requests yet</h3>
            <p>
              Open a payment in your wallet history to submit a refund request.
            </p>
          </section>
        ) : null}
      </section>

      <section className="wallet-section">
        <div className="wallet-section-head">
          <div>
            <h3>Reserved funds</h3>
            <p>Reservation and queue commitments</p>
          </div>
        </div>

        {holds.length ? (
          <div className="wallet-hold-list">
            {holds.map((hold) => (
              <article key={hold.id} className="wallet-hold-card">
                <div className="wallet-hold-top">
                  <div>
                    <h4>{holdTypeLabel(hold.holdType)}</h4>
                    <p>{hold.reference}</p>
                  </div>
                  <strong>{formatMoney(hold.amount, hold.currencyCode)}</strong>
                </div>
                <div className="wallet-hold-meta">
                  <span>Status: {hold.status}</span>
                  <span>
                    Expires:{" "}
                    {formatDateTime(hold.expiresAt, undefined, "Not set")}
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <section className="station-card coming-soon">
            <h3>No active holds</h3>
            <p>
              There are no reservation or queue fees reserved from your wallet
              right now.
            </p>
          </section>
        )}
      </section>

      {wallet?.initializedNow ? (
        <section className="station-card wallet-notice-card">
          <h3>Wallet ready</h3>
          <p>
            Your SmartLink wallet has been initialized and is ready for
            controlled top-ups.
          </p>
        </section>
      ) : null}

      {wallet?.status === "SUSPENDED" ? (
        <section className="station-card wallet-notice-card is-warning">
          <h3>Wallet suspended</h3>
          <p>
            Wallet payments and top-ups are currently unavailable for this
            account.
          </p>
        </section>
      ) : null}

      {import.meta.env.DEV ? (
        <section className="station-card wallet-notice-card">
          <h3>Prototype wallet flow</h3>
          <p>
            Top-ups on this screen post to the internal prototype wallet ledger.
            No external payment gateway is connected yet.
          </p>
        </section>
      ) : null}

      {topupOpen ? (
        <div
          className="queue-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Top up wallet"
          onClick={() => {
            if (!topupSubmitting) {
              setTopupOpen(false);
            }
          }}
        >
          <form
            className="queue-modal wallet-topup-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={handleTopupSubmit}
          >
            <header>
              <div>
                <h3>Top Up Wallet</h3>
                <p>
                  Post a controlled prototype top-up to your SmartLink wallet.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!topupSubmitting) {
                    setTopupOpen(false);
                  }
                }}
              >
                Close
              </button>
            </header>

            <label className="queue-modal-input">
              <span>Amount (MWK)</span>
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={topupAmount}
                onChange={(event) => setTopupAmount(event.target.value)}
                placeholder="Enter top-up amount"
                disabled={topupSubmitting}
              />
            </label>

            <label className="queue-modal-input">
              <span>Reference note (optional)</span>
              <textarea
                rows="3"
                value={topupNote}
                onChange={(event) => setTopupNote(event.target.value)}
                placeholder="Add context for this top-up"
                disabled={topupSubmitting}
              />
            </label>

            {topupError ? (
              <p className="details-inline-error">{topupError}</p>
            ) : null}

            <div className="queue-modal-actions">
              <button
                type="button"
                className="details-action-button is-secondary"
                onClick={() => setTopupOpen(false)}
                disabled={topupSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="details-action-button is-primary"
                disabled={topupSubmitting}
              >
                {topupSubmitting ? "Posting…" : "Submit Top-Up"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {detailsModalTransaction ? (
        <div
          className="queue-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Payment details"
          onClick={() => setDetailsModalTransaction(null)}
        >
          <section
            className="queue-modal wallet-topup-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h3>Payment Details</h3>
                <p>See what this payment was for and when it was posted.</p>
              </div>
              <button
                type="button"
                onClick={() => setDetailsModalTransaction(null)}
              >
                Close
              </button>
            </header>

            <div className="wallet-refund-summary">
              <p>
                <span>Payment for</span>
                <strong>{paymentPurposeLabel(detailsModalTransaction)}</strong>
              </p>
              <p>
                <span>Amount</span>
                <strong>
                  {formatSignedMoney(
                    detailsModalTransaction.amount,
                    detailsModalTransaction.currencyCode,
                    detailsModalTransaction.direction,
                  )}
                </strong>
              </p>
              <p>
                <span>Status</span>
                <strong>
                  {transactionStatusLabel(detailsModalTransaction.status)}
                </strong>
              </p>
              <p>
                <span>Wallet reference</span>
                <strong>
                  {detailsModalTransaction.reference || "Unavailable"}
                </strong>
              </p>
              <p>
                <span>Transaction ID</span>
                <strong>
                  {detailsModalTransaction.transactionPublicId ||
                    "Pending link"}
                </strong>
              </p>
              <p>
                <span>Posted at</span>
                <strong>
                  {formatDateTime(
                    detailsModalTransaction.postedAt ||
                      detailsModalTransaction.createdAt,
                    undefined,
                    "Unavailable",
                  )}
                </strong>
              </p>
              <p>
                <span>Occurred at</span>
                <strong>
                  {formatDateTime(
                    detailsModalTransaction.transactionOccurredAt,
                    undefined,
                    "Unavailable",
                  )}
                </strong>
              </p>
              <p>
                <span>Linked service</span>
                <strong>
                  {detailsModalTransaction.relatedEntityType
                    ? `${detailsModalTransaction.relatedEntityType}${
                        detailsModalTransaction.relatedEntityId
                          ? ` · ${detailsModalTransaction.relatedEntityId}`
                          : ""
                      }`
                    : "—"}
                </strong>
              </p>
              <p>
                <span>Description</span>
                <strong>
                  {detailsModalTransaction.description ||
                    detailsModalTransaction.externalReference ||
                    "Wallet activity"}
                </strong>
              </p>
            </div>

            <div className="queue-modal-actions">
              <button
                type="button"
                className="details-action-button is-secondary"
                onClick={() => setDetailsModalTransaction(null)}
              >
                Done
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {refundModalTransaction ? (
        <div
          className="queue-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Request refund"
          onClick={() => {
            if (!refundSubmitting) {
              setRefundModalTransaction(null);
            }
          }}
        >
          <form
            className="queue-modal wallet-topup-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={handleRefundSubmit}
          >
            <header>
              <div>
                <h3>Request Refund</h3>
                <p>Submit a refund request for this wallet payment.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!refundSubmitting) {
                    setRefundModalTransaction(null);
                  }
                }}
              >
                Close
              </button>
            </header>

            <div className="wallet-refund-summary">
              <p>
                <span>Wallet reference</span>
                <strong>
                  {maskPublicId(refundModalTransaction.reference, {
                    prefix: 4,
                    suffix: 4,
                  })}
                </strong>
              </p>
              <p>
                <span>Transaction</span>
                <strong>{refundModalTransaction.transactionPublicId}</strong>
              </p>
            </div>

            <label className="queue-modal-input">
              <span>Refund amount (MWK)</span>
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={refundAmount}
                onChange={(event) => setRefundAmount(event.target.value)}
                placeholder="Enter refund amount"
                disabled={refundSubmitting}
              />
            </label>

            <label className="queue-modal-input">
              <span>Reason</span>
              <textarea
                rows="4"
                value={refundReason}
                onChange={(event) => setRefundReason(event.target.value)}
                placeholder="Explain why you are requesting this refund"
                disabled={refundSubmitting}
              />
            </label>

            {refundError ? (
              <p className="details-inline-error">{refundError}</p>
            ) : null}

            <div className="queue-modal-actions">
              <button
                type="button"
                className="details-action-button is-secondary"
                onClick={() => setRefundModalTransaction(null)}
                disabled={refundSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="details-action-button is-primary"
                disabled={refundSubmitting}
              >
                {refundSubmitting ? "Submitting…" : "Submit Refund Request"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
