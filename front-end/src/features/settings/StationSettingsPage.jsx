import { useEffect, useMemo, useState } from "react";
import Navbar from "../../components/Navbar";
import { useAuth } from "../../auth/AuthContext";
import { settingsApi } from "../../api/settingsApi";
import { STATION_PLAN_FEATURES } from "../../subscription/planCatalog";
import { useStationPlan } from "../../subscription/useStationPlan";
import "./settings.css";

const avatar =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' rx='40' fill='%23dbe8ff'/%3E%3Ccircle cx='40' cy='30' r='14' fill='%2357779f'/%3E%3Cpath d='M14 73c4-14 16-22 26-22s22 8 26 22' fill='%2357779f'/%3E%3C/svg%3E";

const sections = ["station", "tanks", "pumps", "staff", "queue", "profile"];
const FALLBACK_TIME_ZONES = Object.freeze([
  "Africa/Blantyre",
  "Africa/Johannesburg",
  "Africa/Lusaka",
  "Africa/Harare",
  "Africa/Nairobi",
  "Africa/Lagos",
  "UTC",
]);

function LoadingScreen() {
  return (
    <div className="settings-loading-container">
      <div className="settings-loading-content">
        <div className="settings-loading-spinner">
          <div className="settings-spinner-circle"></div>
        </div>
        <h2>Loading Settings</h2>
        <p>Fetching your station configuration...</p>
        <div className="settings-loading-skeleton-section">
          <div className="settings-skeleton-item"></div>
          <div className="settings-skeleton-item"></div>
          <div className="settings-skeleton-item"></div>
        </div>
      </div>
    </div>
  );
}

function getSupportedTimeZones(currentValue) {
  const current = String(currentValue || "").trim();
  let zones = [];
  if (typeof Intl?.supportedValuesOf === "function") {
    try {
      zones = Intl.supportedValuesOf("timeZone");
    } catch {
      zones = [];
    }
  }

  const unique = new Set(
    [current, ...zones, ...FALLBACK_TIME_ZONES].filter(Boolean),
  );
  return Array.from(unique).sort((left, right) => {
    if (left === current) return -1;
    if (right === current) return 1;
    return left.localeCompare(right);
  });
}

const sectionMeta = {
  station: {
    title: "Station Profile",
    detail: "Identity, location and timezone used across operations.",
  },
  tanks: {
    title: "Tank Management",
    detail: "Configure tank names, fuel mapping and capacities.",
  },
  pumps: {
    title: "Dispenser Management",
    detail: "Manage dispenser groups and configure multiple nozzles per pump.",
  },
  staff: {
    title: "Staff Access",
    detail: "Update roles and activation state for station staff.",
  },
  queue: {
    title: "Queue Rules",
    detail: "Control joins, priorities and queue capacity limits.",
  },
  profile: {
    title: "My Profile",
    detail: "Update your personal display name.",
  },
};

const PUMP_QR_IMAGE_SIZE = 280;

function buildPumpQrImageUrl(payload, size = PUMP_QR_IMAGE_SIZE) {
  const normalizedPayload = String(payload || "").trim();
  if (!normalizedPayload) return "";
  return `https://api.qrserver.com/v1/create-qr-code/?format=svg&margin=0&size=${size}x${size}&data=${encodeURIComponent(normalizedPayload)}`;
}

async function copyTextToClipboard(value) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) return false;

  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(normalizedValue);
    return true;
  }

  const textArea = document.createElement("textarea");
  textArea.value = normalizedValue;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "absolute";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textArea);
  return copied;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export default function StationSettingsPage({ modal = false, onClose = null }) {
  const { session, updateSessionStation } = useAuth();
  const stationPlan = useStationPlan();
  const isManager = session?.role === "MANAGER";
  const [active, setActive] = useState("station");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [data, setData] = useState(null);
  const [supportsAnomalyConfig, setSupportsAnomalyConfig] = useState(false);

  const [stationForm, setStationForm] = useState({
    name: "",
    operator_name: "",
    city: "",
    address: "",
    timezone: "",
  });
  const [fuelPrices, setFuelPrices] = useState([]);

  const [queueForm, setQueueForm] = useState({
    capacity: 100,
    grace_minutes: 10,
    joins_paused: false,
    petrol_enabled: true,
    diesel_enabled: true,
    priority_mode: "ON",
    hybrid_queue_n: 2,
    hybrid_walkin_n: 1,
    hybrid_pilot_enabled: false,
    pilot_pump_public_id: "",
    anomaly_warning_z: 2.5,
    anomaly_critical_z: 3.5,
    anomaly_ewma_alpha: 0.2,
    anomaly_persistence_minutes: 10,
    anomaly_enable_cusum: false,
    anomaly_cusum_threshold: 5,
  });
  const [profileName, setProfileName] = useState("");
  const [newTank, setNewTank] = useState({
    name: "",
    fuelType: "PETROL",
    capacityLitres: 0,
  });
  const [newPump, setNewPump] = useState({
    pumpNumber: 1,
    quickSetup: "MALAWI_2_NOZZLES",
    status: "ACTIVE",
    statusReason: "",
  });
  const [tankDrafts, setTankDrafts] = useState({});
  const [pumpDrafts, setPumpDrafts] = useState({});
  const [nozzleDrafts, setNozzleDrafts] = useState({});
  const [newNozzleByPump, setNewNozzleByPump] = useState({});
  const [activePumpQr, setActivePumpQr] = useState(null);

  async function refresh() {
    try {
      setLoading(true);
      setError("");
      const snapshot = await settingsApi.getSettings();
      setData(snapshot);
      const queueSettings = snapshot?.queue_settings || {};
      const anomalySupported =
        Object.prototype.hasOwnProperty.call(
          queueSettings,
          "anomaly_warning_z",
        ) ||
        Object.prototype.hasOwnProperty.call(
          queueSettings,
          "anomaly_critical_z",
        ) ||
        Object.prototype.hasOwnProperty.call(
          queueSettings,
          "anomaly_ewma_alpha",
        );
      setSupportsAnomalyConfig(anomalySupported);
      setStationForm({
        name: snapshot?.station?.name || "",
        operator_name: snapshot?.station?.operator_name || "",
        city: snapshot?.station?.city || "",
        address: snapshot?.station?.address || "",
        timezone: snapshot?.station?.timezone || "Africa/Blantyre",
      });
      setFuelPrices(
        Array.isArray(snapshot?.station?.fuel_prices)
          ? snapshot.station.fuel_prices.map((row) => ({
              label: row?.label || "",
              pricePerLitre: row?.pricePerLitre ?? "",
            }))
          : [],
      );
      setQueueForm({
        capacity: Number(queueSettings.capacity || 100),
        grace_minutes: Number(queueSettings.grace_minutes || 10),
        joins_paused: Boolean(queueSettings.joins_paused),
        petrol_enabled: Boolean(queueSettings.petrol_enabled),
        diesel_enabled: Boolean(queueSettings.diesel_enabled),
        priority_mode: queueSettings.priority_mode || "ON",
        hybrid_queue_n: Number(queueSettings.hybrid_queue_n || 2),
        hybrid_walkin_n: Number(queueSettings.hybrid_walkin_n || 1),
        hybrid_pilot_enabled: Boolean(queueSettings.hybrid_pilot_enabled),
        pilot_pump_public_id: queueSettings.pilot_pump_public_id || "",
        anomaly_warning_z: Number(queueSettings.anomaly_warning_z || 2.5),
        anomaly_critical_z: Number(queueSettings.anomaly_critical_z || 3.5),
        anomaly_ewma_alpha: Number(queueSettings.anomaly_ewma_alpha || 0.2),
        anomaly_persistence_minutes: Number(
          queueSettings.anomaly_persistence_minutes || 10,
        ),
        anomaly_enable_cusum: Boolean(queueSettings.anomaly_enable_cusum),
        anomaly_cusum_threshold: Number(
          queueSettings.anomaly_cusum_threshold || 5,
        ),
      });
      setProfileName(session?.user?.fullName || "");
    } catch (err) {
      setError(err?.message || "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!modal) return undefined;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [modal, onClose]);

  function showSaved(messageText) {
    setMessage(messageText);
    window.clearTimeout(showSaved.timer);
    showSaved.timer = window.setTimeout(() => setMessage(""), 2400);
  }
  showSaved.timer = showSaved.timer || 0;

  const tankOptions = useMemo(() => data?.tanks || [], [data]);
  const visibleSections = useMemo(() => {
    const next = ["station"];
    if (stationPlan.hasFeature(STATION_PLAN_FEATURES.SETTINGS_CORE)) {
      next.push("tanks", "pumps", "staff");
    }
    if (stationPlan.hasFeature(STATION_PLAN_FEATURES.DIGITAL_QUEUE)) {
      next.push("queue");
    }
    next.push("profile");
    return next;
  }, [stationPlan]);
  const canManageHybridPilot = stationPlan.hasFeature(
    STATION_PLAN_FEATURES.DIGITAL_QUEUE,
  );
  const hybridPilotPump = useMemo(() => {
    const pilotPumpPublicId = String(queueForm.pilot_pump_public_id || "").trim();
    if (!pilotPumpPublicId) return null;
    return (
      (data?.pumps || []).find(
        (pump) => String(pump?.public_id || "").trim() === pilotPumpPublicId,
      ) || null
    );
  }, [data?.pumps, queueForm.pilot_pump_public_id]);
  const timeZoneOptions = useMemo(
    () => getSupportedTimeZones(stationForm.timezone),
    [stationForm.timezone],
  );
  const toFiniteNumber = (value) => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "bigint") return Number(value);
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (typeof value === "object") {
      if (Array.isArray(value?.d) && value.d.length) {
        const parsed = Number(value.d[0]);
        return Number.isFinite(parsed) ? parsed : null;
      }
      if (
        value &&
        (typeof value.value === "number" || typeof value.value === "string")
      ) {
        const parsed = Number(value.value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      if (typeof value?.toString === "function") {
        const parsed = Number(value.toString());
        return Number.isFinite(parsed) ? parsed : null;
      }
    }
    return null;
  };
  const parsePositiveInteger = (value) => {
    const normalized = String(value ?? "").trim();
    if (!/^\d+$/.test(normalized)) return null;
    const parsed = Number(normalized);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
    return parsed;
  };
  const normalizeNozzleNumber = (value) => {
    const normalized = String(value ?? "").trim();
    return normalized || null;
  };
  const formatTankOptionLabel = (tank) => {
    const capacityRaw = tank?.capacity_litres ?? tank?.capacityLitres;
    const capacity = toFiniteNumber(capacityRaw);
    const capacityLabel = Number.isFinite(capacity)
      ? `${capacity.toLocaleString()} L`
      : "Capacity N/A";
    return `${tank.name} (${tank.fuel_code}) - ${capacityLabel}`;
  };
  const navbarAlerts = useMemo(() => {
    const alerts = [];
    if (error) {
      alerts.push({
        id: "settings-error",
        type: "ERROR",
        title: "System Error",
        body: error,
      });
    }
    if (message) {
      alerts.push({
        id: "settings-message",
        type: "ADMIN",
        title: "System Message",
        body: message,
      });
    }

    const pumpWarnings = (data?.pumps || [])
      .flatMap((pump) =>
        (pump.warnings || []).map((warning, index) => ({
          id: `pump-warning-${pump.public_id}-${index}`,
          type: "ERROR",
          title: `Pump ${pump.pump_number} Warning`,
          body: warning,
        })),
      )
      .slice(0, 8);

    return [...alerts, ...pumpWarnings];
  }, [data, error, message]);

  useEffect(() => {
    if (visibleSections.includes(active)) return;
    setActive(visibleSections[0] || "station");
  }, [active, visibleSections]);

  async function saveStation() {
    const normalizedFuelPrices = [];
    for (const row of fuelPrices) {
      const label = String(row?.label || "").trim();
      const pricePerLitre = toFiniteNumber(row?.pricePerLitre);
      if (!label && (pricePerLitre === null || pricePerLitre === undefined))
        continue;
      if (!label) {
        setError("Each fuel row needs a fuel type label");
        return;
      }
      if (pricePerLitre === null || pricePerLitre <= 0) {
        setError(`Enter a valid price for ${label}`);
        return;
      }
      normalizedFuelPrices.push({
        label,
        pricePerLitre,
      });
    }

    try {
      setError("");
      const updatedStation = await settingsApi.patchStation({
        ...stationForm,
        fuel_prices: normalizedFuelPrices,
      });
      updateSessionStation?.({
        publicId:
          updatedStation?.public_id || session?.station?.publicId || null,
        name: updatedStation?.name || session?.station?.name || "Station",
        timezone: updatedStation?.timezone || "Africa/Blantyre",
      });
      showSaved("Station profile updated");
      await refresh();
    } catch (err) {
      setError(err?.message || "Failed to update station profile");
    }
  }

  async function saveQueue() {
    try {
      const payload = {
        capacity: queueForm.capacity,
        grace_minutes: queueForm.grace_minutes,
        joins_paused: queueForm.joins_paused,
        petrol_enabled: queueForm.petrol_enabled,
        diesel_enabled: queueForm.diesel_enabled,
        priority_mode:
          queueForm.hybrid_pilot_enabled && queueForm.pilot_pump_public_id
            ? "HYBRID"
            : queueForm.priority_mode,
        hybrid_queue_n: queueForm.hybrid_queue_n,
        hybrid_walkin_n: queueForm.hybrid_walkin_n,
        hybrid_pilot_enabled: queueForm.hybrid_pilot_enabled,
        pilot_pump_public_id: queueForm.pilot_pump_public_id || null,
      };
      if (supportsAnomalyConfig) {
        payload.anomaly_warning_z = queueForm.anomaly_warning_z;
        payload.anomaly_critical_z = queueForm.anomaly_critical_z;
        payload.anomaly_ewma_alpha = queueForm.anomaly_ewma_alpha;
        payload.anomaly_persistence_minutes =
          queueForm.anomaly_persistence_minutes;
        payload.anomaly_enable_cusum = queueForm.anomaly_enable_cusum;
        payload.anomaly_cusum_threshold = queueForm.anomaly_cusum_threshold;
      }
      await settingsApi.patchQueue(payload);
      showSaved("Queue settings updated");
      await refresh();
    } catch (err) {
      setError(err?.message || "Failed to update queue settings");
    }
  }

  async function setHybridPilotPump(pump) {
    try {
      setError("");
      await settingsApi.patchQueue({
        hybrid_pilot_enabled: true,
        pilot_pump_public_id: pump.public_id,
        priority_mode: "HYBRID",
      });
      showSaved(`Pump ${pump.pump_number} is now the SmartLink hybrid pump`);
      await refresh();
    } catch (err) {
      setError(err?.message || "Failed to set hybrid SmartLink pump");
    }
  }

  async function clearHybridPilotPump() {
    try {
      setError("");
      await settingsApi.patchQueue({
        hybrid_pilot_enabled: false,
        pilot_pump_public_id: null,
      });
      showSaved("Hybrid SmartLink pump cleared");
      await refresh();
    } catch (err) {
      setError(err?.message || "Failed to clear hybrid SmartLink pump");
    }
  }

  async function submitNewTank() {
    try {
      await settingsApi.createTank({
        name: newTank.name,
        fuelType: newTank.fuelType,
        capacityLitres: Number(newTank.capacityLitres),
      });
      setNewTank({ name: "", fuelType: "PETROL", capacityLitres: 0 });
      showSaved("Tank created");
      await refresh();
    } catch (err) {
      setError(err?.message || "Failed to create tank");
    }
  }

  async function saveTank(tankPublicId) {
    const draft = tankDrafts[tankPublicId];
    if (!draft) return;
    if (draft.is_active === false && !window.confirm("Disable this tank?"))
      return;
    const capacityLitres = toFiniteNumber(draft.capacity_litres);
    if (capacityLitres === null || capacityLitres <= 0) {
      setError("Tank capacity must be greater than 0");
      return;
    }
    try {
      await settingsApi.patchTank(tankPublicId, {
        name: draft.name,
        capacityLitres,
        isActive: Boolean(draft.is_active),
      });
      showSaved("Tank updated");
      await refresh();
    } catch (err) {
      setError(err?.message || "Failed to update tank");
    }
  }

  async function submitNewPump() {
    const pumpNumber = parsePositiveInteger(newPump.pumpNumber);
    if (pumpNumber === null) {
      setError("Pump number must be a positive integer");
      return;
    }
    try {
      setError("");
      await settingsApi.createPump({
        pumpNumber,
        quickSetup:
          newPump.quickSetup === "CUSTOM" ? undefined : newPump.quickSetup,
        status: newPump.status,
        statusReason: newPump.statusReason || undefined,
      });
      setNewPump({
        pumpNumber: 1,
        quickSetup: "MALAWI_2_NOZZLES",
        status: "ACTIVE",
        statusReason: "",
      });
      showSaved("Pump created");
      await refresh();
    } catch (err) {
      setError(err?.message || "Failed to create pump");
    }
  }

  async function savePump(pumpPublicId) {
    const draft = pumpDrafts[pumpPublicId];
    if (!draft) return;
    const pumpNumber = parsePositiveInteger(draft.pump_number);
    if (pumpNumber === null) {
      setError("Pump number must be a positive integer");
      return;
    }
    const basePump = (data?.pumps || []).find(
      (item) => item.public_id === pumpPublicId,
    );
    const nozzleCount = Number(
      basePump?.nozzle_count ?? basePump?.nozzles?.length ?? 0,
    );
    const currentStatus = String(
      basePump?.status || draft.status || "ACTIVE",
    ).toUpperCase();
    if (draft.is_active === false && !window.confirm("Disable this pump?"))
      return;
    const nextStatus = ["ACTIVE", "PAUSED", "OFFLINE", "IDLE"].includes(
      String(draft.status || "").toUpperCase(),
    )
      ? String(draft.status).toUpperCase()
      : "ACTIVE";
    if (nozzleCount === 0 && nextStatus !== currentStatus) {
      setError(
        "Cannot change pump status: no nozzles are configured for this pump.",
      );
      return;
    }
    try {
      setError("");
      const payload = {
        status: nextStatus,
        statusReason: draft.status_reason || null,
        isActive: Boolean(draft.is_active),
      };
      if (pumpNumber !== Number(basePump?.pump_number)) {
        payload.pumpNumber = pumpNumber;
      }
      await settingsApi.patchPump(pumpPublicId, payload);
      showSaved("Pump updated");
      await refresh();
    } catch (err) {
      setError(err?.message || "Failed to update pump");
    }
  }

  async function deletePump(pumpPublicId, pumpNumber) {
    if (!window.confirm(`Delete pump ${pumpNumber}? This cannot be undone.`))
      return;
    try {
      await settingsApi.deletePump(pumpPublicId);
      if (String(queueForm.pilot_pump_public_id || "").trim() === pumpPublicId) {
        await settingsApi.patchQueue({
          hybrid_pilot_enabled: false,
          pilot_pump_public_id: null,
        });
      }
      setPumpDrafts((prev) => {
        const next = { ...prev };
        delete next[pumpPublicId];
        return next;
      });
      showSaved("Pump deleted");
      await refresh();
    } catch (err) {
      setError(err?.message || "Failed to delete pump");
    }
  }

  function createNozzleDraft(pump) {
    const numericNozzles = (pump?.nozzles || [])
      .map((nozzle) => Number(nozzle.nozzle_number))
      .filter((value) => Number.isFinite(value) && value > 0);
    const nextNumber =
      numericNozzles.length === (pump?.nozzles || []).length
        ? Math.max(0, ...numericNozzles) + 1
        : (pump?.nozzles || []).length + 1;
    return {
      nozzleNumber: String(nextNumber),
      side: "",
      fuelType: "PETROL",
      tankPublicId: "",
      status: "ACTIVE",
      hardwareChannel: "",
    };
  }

  function startNozzleDraft(pump) {
    setNewNozzleByPump((prev) => ({
      ...prev,
      [pump.public_id]: createNozzleDraft(pump),
    }));
  }

  function removeNozzleDraft(pumpPublicId) {
    setNewNozzleByPump((prev) => {
      const next = { ...prev };
      delete next[pumpPublicId];
      return next;
    });
  }

  async function addNozzle(pump) {
    const draft = newNozzleByPump[pump.public_id];
    if (!draft) {
      setError("Start by clicking Add Nozzle for this dispenser");
      return;
    }
    const nozzleNumber = normalizeNozzleNumber(draft.nozzleNumber);
    if (nozzleNumber === null) {
      setError("Nozzle code/label is required");
      return;
    }
    const side = String(draft.side || "").trim();
    if (!side) {
      setError("Side is required for nozzle");
      return;
    }
    try {
      setError("");
      await settingsApi.createPumpNozzle(pump.public_id, {
        nozzleNumber,
        side,
        fuelType: draft.fuelType,
        tankPublicId: draft.tankPublicId || undefined,
        status: draft.status || "ACTIVE",
        hardwareChannel: draft.hardwareChannel || undefined,
      });
      removeNozzleDraft(pump.public_id);
      showSaved(`Nozzle added to Pump ${pump.pump_number}`);
      await refresh();
    } catch (err) {
      setError(err?.message || "Failed to add nozzle");
    }
  }

  async function saveNozzle(nozzlePublicId) {
    const draft = nozzleDrafts[nozzlePublicId];
    if (!draft) return;
    const nozzleNumber = normalizeNozzleNumber(draft.nozzle_number);
    if (nozzleNumber === null) {
      setError("Nozzle code/label is required");
      return;
    }
    const side = String(draft.side || "").trim();
    if (!side) {
      setError("Side is required for nozzle");
      return;
    }
    try {
      setError("");
      await settingsApi.patchPumpNozzle(nozzlePublicId, {
        nozzleNumber,
        side,
        fuelType: draft.fuel_code,
        tankPublicId: draft.tank_public_id || null,
        status: draft.status,
        hardwareChannel: draft.hardware_channel || null,
        isActive: Boolean(draft.is_active),
      });
      showSaved(`Nozzle ${draft.nozzle_number} updated`);
      await refresh();
    } catch (err) {
      setError(err?.message || "Failed to update nozzle");
    }
  }

  async function deleteNozzle(nozzlePublicId, nozzleNumber) {
    if (
      !window.confirm(`Delete nozzle #${nozzleNumber}? This cannot be undone.`)
    )
      return;
    try {
      await settingsApi.deletePumpNozzle(nozzlePublicId);
      setNozzleDrafts((prev) => {
        const next = { ...prev };
        delete next[nozzlePublicId];
        return next;
      });
      showSaved(`Nozzle #${nozzleNumber} deleted`);
      await refresh();
    } catch (err) {
      setError(err?.message || "Failed to delete nozzle");
    }
  }

  async function saveStaff(staffId, nextRole, nextActive) {
    if (
      nextActive === false &&
      !window.confirm("Deactivate this staff member?")
    )
      return;
    try {
      await settingsApi.patchStaff(staffId, {
        role: nextRole,
        isActive: nextActive,
      });
      showSaved("Staff updated");
      await refresh();
    } catch (err) {
      setError(err?.message || "Failed to update staff");
    }
  }

  async function saveProfile() {
    try {
      await settingsApi.patchMe({ fullName: profileName });
      showSaved("Profile updated");
    } catch (err) {
      setError(err?.message || "Failed to update profile");
    }
  }

  async function handleCopyPumpQr(pump) {
    try {
      const copied = await copyTextToClipboard(pump?.qr_payload);
      if (!copied) {
        setError("Failed to copy pump QR payload");
        return;
      }
      showSaved(`Pump ${pump?.pump_number || ""} QR payload copied`);
    } catch (err) {
      setError(err?.message || "Failed to copy pump QR payload");
    }
  }

  function openPumpQrPrintView(pump) {
    const qrPayload = String(pump?.qr_payload || "").trim();
    if (!qrPayload) {
      setError("Pump QR payload is not available yet");
      return;
    }

    const popup = window.open(
      "",
      "_blank",
      "noopener,noreferrer,width=720,height=900",
    );
    if (!popup) {
      setError("Allow pop-ups to open the printable pump QR label");
      return;
    }

    const imageUrl = buildPumpQrImageUrl(qrPayload, 420);
    const stationPublicId = session?.station?.publicId || "Unknown Station";
    const pumpTitle = `Pump ${pump?.pump_number || "-"}`;

    popup.document.write(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(pumpTitle)} QR</title>
    <style>
      body {
        margin: 0;
        padding: 32px;
        font-family: Arial, sans-serif;
        background: #f4f7fb;
        color: #1f2937;
      }
      main {
        max-width: 520px;
        margin: 0 auto;
        padding: 28px;
        border: 1px solid #d1d5db;
        border-radius: 20px;
        background: #ffffff;
        text-align: center;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 28px;
      }
      p {
        margin: 6px 0;
      }
      img {
        display: block;
        width: 320px;
        height: 320px;
        margin: 24px auto;
      }
      code {
        display: block;
        padding: 14px;
        border-radius: 14px;
        background: #f3f4f6;
        font-size: 13px;
        word-break: break-all;
      }
      @media print {
        body {
          background: #ffffff;
          padding: 0;
        }
        main {
          border: none;
          box-shadow: none;
          padding: 0;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(pumpTitle)}</h1>
      <p>${escapeHtml(String(pump?.public_id || ""))}</p>
      <p>${escapeHtml(stationPublicId)}</p>
      <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(pumpTitle)} QR code" />
      <code>${escapeHtml(qrPayload)}</code>
    </main>
  </body>
</html>`);
    popup.document.close();
    popup.focus();
  }

  const metrics = {
    tanks: data?.tanks?.length || 0,
    pumps: data?.pumps?.length || 0,
    staff: data?.staff?.length || 0,
    role: session?.role || "N/A",
  };

  const sectionButtons = sections.map((section) =>
    visibleSections.includes(section) ? (
      <button
        key={section}
        type="button"
        className={
          section === active
            ? "active settings-tab-button"
            : "settings-tab-button"
        }
        onClick={() => setActive(section)}
      >
        <span>{sectionMeta[section].title}</span>
        <small>{sectionMeta[section].detail}</small>
      </button>
    ) : null,
  );

  const settingsNotices = (
    <>
      {!stationPlan.hasFeature(STATION_PLAN_FEATURES.SETTINGS_CORE) ? (
        <p className="settings-readonly">
          Upgrade to Essential Station to unlock tanks, pumps, and staff
          configuration.
        </p>
      ) : null}
      {!stationPlan.hasFeature(STATION_PLAN_FEATURES.DIGITAL_QUEUE) ? (
        <p className="settings-readonly">
          Queue rules unlock on Growth Operations.
        </p>
      ) : null}
      {!isManager ? (
        <p className="settings-readonly">
          Manager only: editing is disabled for your role.
        </p>
      ) : null}
      {message ? <p className="settings-message">{message}</p> : null}
      {error ? (
        <p className="settings-error">
          {error ==
          "Invalid `prisma.$executeRaw()` invocation: Raw query failed. Code: `1048`. Message: `Column 'side' cannot be null`"
            ? "A side nozzle side is required"
            : error}
        </p>
      ) : null}
    </>
  );

  let activeSectionContent = null;

  if (active === "station") {
    activeSectionContent = (
      <article className="settings-card">
        <h3>Station Profile</h3>
        <div className="settings-grid">
          <label>
            Name
            <input
              disabled={!isManager}
              value={stationForm.name}
              onChange={(e) =>
                setStationForm((x) => ({ ...x, name: e.target.value }))
              }
            />
          </label>
          <label>
            Operator
            <input
              disabled={!isManager}
              value={stationForm.operator_name || ""}
              onChange={(e) =>
                setStationForm((x) => ({ ...x, operator_name: e.target.value }))
              }
            />
          </label>
          <label>
            City
            <input
              disabled={!isManager}
              value={stationForm.city || ""}
              onChange={(e) =>
                setStationForm((x) => ({ ...x, city: e.target.value }))
              }
            />
          </label>
          <label>
            Address
            <input
              disabled={!isManager}
              value={stationForm.address || ""}
              onChange={(e) =>
                setStationForm((x) => ({ ...x, address: e.target.value }))
              }
            />
          </label>
          <label>
            Timezone
            <select
              disabled={!isManager}
              value={stationForm.timezone || "Africa/Blantyre"}
              onChange={(e) =>
                setStationForm((x) => ({ ...x, timezone: e.target.value }))
              }
            >
              {timeZoneOptions.map((timeZone) => (
                <option key={timeZone} value={timeZone}>
                  {timeZone}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="settings-table-wrap" style={{ marginTop: 18 }}>
          <table>
            <thead>
              <tr>
                <th>Fuel Type</th>
                <th>Price / Litre (MWK)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {fuelPrices.length ? (
                fuelPrices.map((row, index) => (
                  <tr key={`fuel-price-${index}`}>
                    <td>
                      <input
                        disabled={!isManager}
                        value={row.label || ""}
                        onChange={(event) =>
                          setFuelPrices((prev) =>
                            prev.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, label: event.target.value }
                                : item,
                            ),
                          )
                        }
                        placeholder="PETROL"
                      />
                    </td>
                    <td>
                      <input
                        disabled={!isManager}
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.pricePerLitre ?? ""}
                        onChange={(event) =>
                          setFuelPrices((prev) =>
                            prev.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, pricePerLitre: event.target.value }
                                : item,
                            ),
                          )
                        }
                        placeholder="2500"
                      />
                    </td>
                    <td>
                      <button
                        disabled={!isManager}
                        type="button"
                        onClick={() =>
                          setFuelPrices((prev) =>
                            prev.filter((_, itemIndex) => itemIndex !== index),
                          )
                        }
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3}>No fuel prices configured yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div
          style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}
        >
          <button
            disabled={!isManager}
            type="button"
            onClick={() =>
              setFuelPrices((prev) => [
                ...prev,
                { label: "", pricePerLitre: "" },
              ])
            }
          >
            Add Fuel Type
          </button>
          <small style={{ color: "#5f7e9f", alignSelf: "center" }}>
            Fuel prices saved here become the database-backed source used in
            station fuel details.
          </small>
        </div>
        <button disabled={!isManager} type="button" onClick={saveStation}>
          Save Changes
        </button>
      </article>
    );
  } else if (active === "tanks") {
    activeSectionContent = (
      <article className="settings-card">
        <h3>Tanks</h3>
        <div className="settings-grid">
          <label>
            Name
            <input
              disabled={!isManager}
              value={newTank.name}
              onChange={(e) =>
                setNewTank((x) => ({ ...x, name: e.target.value }))
              }
            />
          </label>
          <label>
            Fuel
            <select
              disabled={!isManager}
              value={newTank.fuelType}
              onChange={(e) =>
                setNewTank((x) => ({ ...x, fuelType: e.target.value }))
              }
            >
              <option value="PETROL">PETROL</option>
              <option value="DIESEL">DIESEL</option>
            </select>
          </label>
          <label>
            Capacity (L)
            <input
              disabled={!isManager}
              type="number"
              value={newTank.capacityLitres}
              onChange={(e) =>
                setNewTank((x) => ({ ...x, capacityLitres: e.target.value }))
              }
            />
          </label>
        </div>
        <button disabled={!isManager} type="button" onClick={submitNewTank}>
          Add Tank
        </button>
        <div className="settings-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Fuel</th>
                <th>Capacity</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.tanks.map((tank) => {
                const draft = tankDrafts[tank.public_id] || tank;
                const capacityValue = toFiniteNumber(draft.capacity_litres);
                return (
                  <tr key={tank.public_id}>
                    <td>
                      <input
                        disabled={!isManager}
                        value={draft.name || ""}
                        onChange={(e) =>
                          setTankDrafts((x) => ({
                            ...x,
                            [tank.public_id]: {
                              ...draft,
                              name: e.target.value,
                            },
                          }))
                        }
                      />
                    </td>
                    <td>{tank.fuel_code}</td>
                    <td>
                      <input
                        disabled={!isManager}
                        type="number"
                        value={capacityValue ?? ""}
                        onChange={(e) =>
                          setTankDrafts((x) => ({
                            ...x,
                            [tank.public_id]: {
                              ...draft,
                              capacity_litres: e.target.value,
                            },
                          }))
                        }
                      />
                    </td>
                    <td>
                      <input
                        disabled={!isManager}
                        type="checkbox"
                        checked={Boolean(draft.is_active)}
                        onChange={(e) =>
                          setTankDrafts((x) => ({
                            ...x,
                            [tank.public_id]: {
                              ...draft,
                              is_active: e.target.checked,
                            },
                          }))
                        }
                      />
                    </td>
                    <td>
                      <button
                        disabled={!isManager}
                        type="button"
                        onClick={() => saveTank(tank.public_id)}
                      >
                        Save
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>
    );
  } else if (active === "pumps") {
    activeSectionContent = (
      <article className="settings-card">
        <h3>Dispensers & Nozzles</h3>
        <div className="settings-grid">
          <label>
            Pump Number
            <input
              disabled={!isManager}
              type="number"
              min="1"
              step="1"
              value={newPump.pumpNumber}
              onChange={(e) =>
                setNewPump((x) => ({ ...x, pumpNumber: e.target.value }))
              }
            />
          </label>
          <label>
            Quick Setup
            <select
              disabled={!isManager}
              value={newPump.quickSetup}
              onChange={(e) =>
                setNewPump((x) => ({ ...x, quickSetup: e.target.value }))
              }
            >
              <option value="MALAWI_2_NOZZLES">
                Malawi 2 nozzles (1 petrol, 1 diesel)
              </option>
              <option value="MALAWI_4_NOZZLES">
                Malawi 4 nozzles (2 petrol, 2 diesel)
              </option>
              <option value="CUSTOM">Custom (add nozzles manually)</option>
            </select>
          </label>
          <label>
            Status
            <select
              disabled={!isManager}
              value={newPump.status}
              onChange={(e) =>
                setNewPump((x) => ({ ...x, status: e.target.value }))
              }
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="PAUSED">PAUSED</option>
              <option value="OFFLINE">OFFLINE</option>
              <option value="IDLE">IDLE</option>
            </select>
          </label>
          <label>
            Status Reason
            <input
              disabled={!isManager}
              value={newPump.statusReason}
              onChange={(e) =>
                setNewPump((x) => ({ ...x, statusReason: e.target.value }))
              }
            />
          </label>
        </div>
        <button disabled={!isManager} type="button" onClick={submitNewPump}>
          Add Dispenser
        </button>
        {data.pumps.map((pump) => {
          const draft = pumpDrafts[pump.public_id] || pump;
          const nozzleCreateDraft = newNozzleByPump[pump.public_id] || null;
          const nozzleCount = Number(
            pump.nozzle_count ?? (pump.nozzles || []).length,
          );
          const hasNozzles = nozzleCount > 0;
          const isHybridPilotPump =
            String(queueForm.pilot_pump_public_id || "").trim() ===
            String(pump.public_id || "").trim();
          return (
            <div
              key={pump.public_id}
              className="settings-table-wrap"
              style={{ marginTop: 20 }}
            >
              <h4 style={{ marginBottom: 8 }}>
                Pump {pump.pump_number} · {pump.status} · {pump.nozzle_count}{" "}
                nozzles
              </h4>
              {canManageHybridPilot ? (
                <div className="settings-pilot-pump-row">
                  <p className="settings-pilot-pump-copy">
                    {isHybridPilotPump
                      ? "This pump is currently reserved as the SmartLink hybrid pilot pump."
                      : "Use this as the next SmartLink hybrid pilot pump for digital-priority dispatch."}
                  </p>
                  <button
                    className={
                      isHybridPilotPump
                        ? "settings-hybrid-button settings-hybrid-button--active"
                        : "settings-hybrid-button"
                    }
                    disabled={!isManager}
                    type="button"
                    onClick={() =>
                      isHybridPilotPump
                        ? clearHybridPilotPump()
                        : setHybridPilotPump(pump)
                    }
                  >
                    {isHybridPilotPump
                      ? "Clear Hybrid SmartLink Pump"
                      : "Set as Hybrid SmartLink Pump"}
                  </button>
                </div>
              ) : null}
              {pump.warnings?.length ? (
                <p className="settings-error">{pump.warnings.join(" | ")}</p>
              ) : null}
              <table>
                <thead>
                  <tr>
                    <th>Pump No.</th>
                    <th>Status</th>
                    <th>Reason</th>
                    <th>Active</th>
                    <th />
                    <th />
                    <th />
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <input
                        disabled={!isManager}
                        type="number"
                        min="1"
                        step="1"
                        value={toFiniteNumber(draft.pump_number) ?? ""}
                        onChange={(e) =>
                          setPumpDrafts((x) => ({
                            ...x,
                            [pump.public_id]: {
                              ...draft,
                              pump_number: e.target.value,
                            },
                          }))
                        }
                      />
                    </td>
                    <td>
                      <select
                        disabled={!isManager || !hasNozzles}
                        title={
                          !hasNozzles
                            ? "Add at least one nozzle before changing pump status."
                            : ""
                        }
                        value={draft.status || "ACTIVE"}
                        onChange={(e) =>
                          setPumpDrafts((x) => ({
                            ...x,
                            [pump.public_id]: {
                              ...draft,
                              status: e.target.value,
                            },
                          }))
                        }
                      >
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="PAUSED">PAUSED</option>
                        <option value="OFFLINE">OFFLINE</option>
                        <option value="IDLE">IDLE</option>
                        <option value="DEGRADED">DEGRADED (derived)</option>
                        <option value="DISPENSING">DISPENSING (derived)</option>
                      </select>
                    </td>
                    <td>
                      <input
                        disabled={!isManager}
                        value={draft.status_reason || ""}
                        onChange={(e) =>
                          setPumpDrafts((x) => ({
                            ...x,
                            [pump.public_id]: {
                              ...draft,
                              status_reason: e.target.value,
                            },
                          }))
                        }
                      />
                    </td>
                    <td>
                      <input
                        disabled={!isManager}
                        type="checkbox"
                        checked={Boolean(draft.is_active)}
                        onChange={(e) =>
                          setPumpDrafts((x) => ({
                            ...x,
                            [pump.public_id]: {
                              ...draft,
                              is_active: e.target.checked,
                            },
                          }))
                        }
                      />
                    </td>
                    <td>
                      <button
                        disabled={!isManager}
                        type="button"
                        onClick={() => savePump(pump.public_id)}
                      >
                        Save
                      </button>
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => setActivePumpQr(pump)}
                      >
                        Show QR
                      </button>
                    </td>
                    <td>
                      <button
                        disabled={!isManager}
                        type="button"
                        onClick={() =>
                          deletePump(pump.public_id, pump.pump_number)
                        }
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>

              <table style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th>Nozzle Code / Label</th>
                    <th>Side</th>
                    <th>Fuel</th>
                    <th>Tank</th>
                    <th>Status</th>
                    <th>Channel</th>
                    <th>Active</th>
                    <th />
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(pump.nozzles || []).map((nozzle) => {
                    const nozzleDraft =
                      nozzleDrafts[nozzle.public_id] || nozzle;
                    return (
                      <tr key={nozzle.public_id}>
                        <td>
                          <input
                            disabled={!isManager}
                            type="text"
                            value={nozzleDraft.nozzle_number || ""}
                            onChange={(e) =>
                              setNozzleDrafts((x) => ({
                                ...x,
                                [nozzle.public_id]: {
                                  ...nozzleDraft,
                                  nozzle_number: e.target.value,
                                },
                              }))
                            }
                          />
                        </td>
                        <td>
                          <input
                            disabled={!isManager}
                            value={nozzleDraft.side || ""}
                            onChange={(e) =>
                              setNozzleDrafts((x) => ({
                                ...x,
                                [nozzle.public_id]: {
                                  ...nozzleDraft,
                                  side: e.target.value,
                                },
                              }))
                            }
                          />
                        </td>
                        <td>
                          <select
                            disabled={!isManager}
                            value={nozzleDraft.fuel_code || "PETROL"}
                            onChange={(e) =>
                              setNozzleDrafts((x) => ({
                                ...x,
                                [nozzle.public_id]: {
                                  ...nozzleDraft,
                                  fuel_code: e.target.value,
                                },
                              }))
                            }
                          >
                            <option value="PETROL">PETROL</option>
                            <option value="DIESEL">DIESEL</option>
                          </select>
                        </td>
                        <td>
                          <select
                            disabled={!isManager}
                            value={nozzleDraft.tank_public_id || ""}
                            onChange={(e) =>
                              setNozzleDrafts((x) => ({
                                ...x,
                                [nozzle.public_id]: {
                                  ...nozzleDraft,
                                  tank_public_id: e.target.value,
                                },
                              }))
                            }
                          >
                            <option value="">Unlinked</option>
                            {tankOptions.map((tank) => (
                              <option
                                key={tank.public_id}
                                value={tank.public_id}
                              >
                                {formatTankOptionLabel(tank)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            disabled={!isManager}
                            value={nozzleDraft.status || "ACTIVE"}
                            onChange={(e) =>
                              setNozzleDrafts((x) => ({
                                ...x,
                                [nozzle.public_id]: {
                                  ...nozzleDraft,
                                  status: e.target.value,
                                },
                              }))
                            }
                          >
                            <option value="ACTIVE">ACTIVE</option>
                            <option value="PAUSED">PAUSED</option>
                            <option value="OFFLINE">OFFLINE</option>
                            <option value="DISPENSING">DISPENSING</option>
                          </select>
                        </td>
                        <td>
                          <input
                            disabled={!isManager}
                            value={nozzleDraft.hardware_channel || ""}
                            onChange={(e) =>
                              setNozzleDrafts((x) => ({
                                ...x,
                                [nozzle.public_id]: {
                                  ...nozzleDraft,
                                  hardware_channel: e.target.value,
                                },
                              }))
                            }
                          />
                        </td>
                        <td>
                          <input
                            disabled={!isManager}
                            type="checkbox"
                            checked={Boolean(nozzleDraft.is_active)}
                            onChange={(e) =>
                              setNozzleDrafts((x) => ({
                                ...x,
                                [nozzle.public_id]: {
                                  ...nozzleDraft,
                                  is_active: e.target.checked,
                                },
                              }))
                            }
                          />
                        </td>
                        <td>
                          <button
                            disabled={!isManager}
                            type="button"
                            onClick={() => saveNozzle(nozzle.public_id)}
                          >
                            Save
                          </button>
                        </td>
                        <td>
                          <button
                            disabled={!isManager}
                            type="button"
                            onClick={() =>
                              deleteNozzle(
                                nozzle.public_id,
                                nozzle.nozzle_number,
                              )
                            }
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {nozzleCreateDraft ? (
                    <tr>
                      <td>
                        <input
                          disabled={!isManager}
                          type="text"
                          value={nozzleCreateDraft.nozzleNumber}
                          onChange={(e) =>
                            setNewNozzleByPump((x) => ({
                              ...x,
                              [pump.public_id]: {
                                ...nozzleCreateDraft,
                                nozzleNumber: e.target.value,
                              },
                            }))
                          }
                        />
                      </td>
                      <td>
                        <input
                          disabled={!isManager}
                          value={nozzleCreateDraft.side || ""}
                          onChange={(e) =>
                            setNewNozzleByPump((x) => ({
                              ...x,
                              [pump.public_id]: {
                                ...nozzleCreateDraft,
                                side: e.target.value,
                              },
                            }))
                          }
                        />
                      </td>
                      <td>
                        <select
                          disabled={!isManager}
                          value={nozzleCreateDraft.fuelType}
                          onChange={(e) =>
                            setNewNozzleByPump((x) => ({
                              ...x,
                              [pump.public_id]: {
                                ...nozzleCreateDraft,
                                fuelType: e.target.value,
                              },
                            }))
                          }
                        >
                          <option value="PETROL">PETROL</option>
                          <option value="DIESEL">DIESEL</option>
                        </select>
                      </td>
                      <td>
                        <select
                          disabled={!isManager}
                          value={nozzleCreateDraft.tankPublicId || ""}
                          onChange={(e) =>
                            setNewNozzleByPump((x) => ({
                              ...x,
                              [pump.public_id]: {
                                ...nozzleCreateDraft,
                                tankPublicId: e.target.value,
                              },
                            }))
                          }
                        >
                          <option value="">Unlinked</option>
                          {tankOptions.map((tank) => (
                            <option key={tank.public_id} value={tank.public_id}>
                              {formatTankOptionLabel(tank)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          disabled={!isManager}
                          value={nozzleCreateDraft.status || "ACTIVE"}
                          onChange={(e) =>
                            setNewNozzleByPump((x) => ({
                              ...x,
                              [pump.public_id]: {
                                ...nozzleCreateDraft,
                                status: e.target.value,
                              },
                            }))
                          }
                        >
                          <option value="ACTIVE">ACTIVE</option>
                          <option value="PAUSED">PAUSED</option>
                          <option value="OFFLINE">OFFLINE</option>
                        </select>
                      </td>
                      <td>
                        <input
                          disabled={!isManager}
                          value={nozzleCreateDraft.hardwareChannel || ""}
                          onChange={(e) =>
                            setNewNozzleByPump((x) => ({
                              ...x,
                              [pump.public_id]: {
                                ...nozzleCreateDraft,
                                hardwareChannel: e.target.value,
                              },
                            }))
                          }
                        />
                      </td>
                      <td>-</td>
                      <td>
                        <button
                          disabled={!isManager}
                          type="button"
                          onClick={() => addNozzle(pump)}
                        >
                          Save
                        </button>
                      </td>
                      <td>
                        <button
                          disabled={!isManager}
                          type="button"
                          onClick={() => removeNozzleDraft(pump.public_id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr>
                      <td colSpan={9}>
                        <button
                          disabled={!isManager}
                          type="button"
                          onClick={() => startNozzleDraft(pump)}
                        >
                          Add Nozzle
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          );
        })}
      </article>
    );
  } else if (active === "staff") {
    activeSectionContent = (
      <article className="settings-card">
        <h3>Staff</h3>
        <div className="settings-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email/Phone</th>
                <th>Role</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.staff.map((staff) => (
                <tr key={staff.id}>
                  <td>{staff.full_name || "N/A"}</td>
                  <td>{staff.email || staff.phone_e164 || "-"}</td>
                  <td>
                    <select
                      disabled={!isManager}
                      defaultValue={staff.role}
                      onChange={(e) => {
                        const role = e.target.value;
                        saveStaff(staff.id, role, Boolean(staff.is_active));
                      }}
                    >
                      <option value="MANAGER">MANAGER</option>
                      <option value="ATTENDANT">ATTENDANT</option>
                      <option value="VIEWER">VIEWER</option>
                    </select>
                  </td>
                  <td>{Boolean(staff.is_active) ? "Yes" : "No"}</td>
                  <td>
                    <button
                      disabled={!isManager}
                      type="button"
                      onClick={() =>
                        saveStaff(
                          staff.id,
                          staff.role,
                          !Boolean(staff.is_active),
                        )
                      }
                    >
                      {Boolean(staff.is_active) ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    );
  } else if (active === "queue") {
    activeSectionContent = (
      <article className="settings-card">
        <h3>Queue Settings</h3>
        {canManageHybridPilot ? (
          <div className="settings-pilot-summary">
            <div>
              <strong>Hybrid SmartLink Pump</strong>
              <p>
                {hybridPilotPump
                  ? `Pump ${hybridPilotPump.pump_number} is set as the pilot SmartLink pump.`
                  : "No pilot SmartLink pump has been selected yet."}
              </p>
            </div>
            {queueForm.pilot_pump_public_id ? (
              <button
                disabled={!isManager}
                type="button"
                onClick={clearHybridPilotPump}
              >
                Clear Pilot Pump
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="settings-grid">
          <label>
            Capacity
            <input
              disabled={!isManager}
              type="number"
              value={queueForm.capacity}
              onChange={(e) =>
                setQueueForm((x) => ({
                  ...x,
                  capacity: Number(e.target.value),
                }))
              }
            />
          </label>
          <label>
            Grace Minutes
            <input
              disabled={!isManager}
              type="number"
              value={queueForm.grace_minutes}
              onChange={(e) =>
                setQueueForm((x) => ({
                  ...x,
                  grace_minutes: Number(e.target.value),
                }))
              }
            />
          </label>
          <label>
            Priority Mode
            <select
              disabled={!isManager}
              value={queueForm.priority_mode}
              onChange={(e) =>
                setQueueForm((x) => ({ ...x, priority_mode: e.target.value }))
              }
            >
              <option value="OFF">OFF</option>
              <option value="ON">ON</option>
              <option value="HYBRID">HYBRID</option>
            </select>
          </label>
          <label>
            Joins Paused
            <input
              disabled={!isManager}
              type="checkbox"
              checked={queueForm.joins_paused}
              onChange={(e) =>
                setQueueForm((x) => ({ ...x, joins_paused: e.target.checked }))
              }
            />
          </label>
          <label>
            Petrol Enabled
            <input
              disabled={!isManager}
              type="checkbox"
              checked={queueForm.petrol_enabled}
              onChange={(e) =>
                setQueueForm((x) => ({
                  ...x,
                  petrol_enabled: e.target.checked,
                }))
              }
            />
          </label>
          <label>
            Diesel Enabled
            <input
              disabled={!isManager}
              type="checkbox"
              checked={queueForm.diesel_enabled}
              onChange={(e) =>
                setQueueForm((x) => ({
                  ...x,
                  diesel_enabled: e.target.checked,
                }))
              }
            />
          </label>
          {canManageHybridPilot ? (
            <label>
              Hybrid SmartLink Pump
              <select
                disabled={!isManager}
                value={queueForm.pilot_pump_public_id}
                onChange={(e) =>
                  setQueueForm((x) => ({
                    ...x,
                    pilot_pump_public_id: e.target.value,
                    hybrid_pilot_enabled: Boolean(e.target.value),
                    priority_mode: e.target.value ? "HYBRID" : x.priority_mode,
                  }))
                }
              >
                <option value="">No pilot pump selected</option>
                {(data?.pumps || []).map((pump) => (
                  <option key={pump.public_id} value={pump.public_id}>
                    Pump {pump.pump_number} · {pump.status}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {supportsAnomalyConfig ? (
            <>
              <label>
                Anomaly Warning Z
                <input
                  disabled={!isManager}
                  type="number"
                  step="0.1"
                  value={queueForm.anomaly_warning_z}
                  onChange={(e) =>
                    setQueueForm((x) => ({
                      ...x,
                      anomaly_warning_z: Number(e.target.value),
                    }))
                  }
                />
              </label>
              <label>
                Anomaly Critical Z
                <input
                  disabled={!isManager}
                  type="number"
                  step="0.1"
                  value={queueForm.anomaly_critical_z}
                  onChange={(e) =>
                    setQueueForm((x) => ({
                      ...x,
                      anomaly_critical_z: Number(e.target.value),
                    }))
                  }
                />
              </label>
              <label>
                EWMA Alpha
                <input
                  disabled={!isManager}
                  type="number"
                  min="0.01"
                  max="0.99"
                  step="0.01"
                  value={queueForm.anomaly_ewma_alpha}
                  onChange={(e) =>
                    setQueueForm((x) => ({
                      ...x,
                      anomaly_ewma_alpha: Number(e.target.value),
                    }))
                  }
                />
              </label>
              <label>
                Persistence (min)
                <input
                  disabled={!isManager}
                  type="number"
                  min="1"
                  max="120"
                  value={queueForm.anomaly_persistence_minutes}
                  onChange={(e) =>
                    setQueueForm((x) => ({
                      ...x,
                      anomaly_persistence_minutes: Number(e.target.value),
                    }))
                  }
                />
              </label>
              <label>
                Enable CUSUM
                <input
                  disabled={!isManager}
                  type="checkbox"
                  checked={queueForm.anomaly_enable_cusum}
                  onChange={(e) =>
                    setQueueForm((x) => ({
                      ...x,
                      anomaly_enable_cusum: e.target.checked,
                    }))
                  }
                />
              </label>
              <label>
                CUSUM Threshold
                <input
                  disabled={!isManager}
                  type="number"
                  step="0.1"
                  min="1"
                  max="100"
                  value={queueForm.anomaly_cusum_threshold}
                  onChange={(e) =>
                    setQueueForm((x) => ({
                      ...x,
                      anomaly_cusum_threshold: Number(e.target.value),
                    }))
                  }
                />
              </label>
            </>
          ) : null}
        </div>
        <button disabled={!isManager} type="button" onClick={saveQueue}>
          Save Changes
        </button>
      </article>
    );
  } else if (active === "profile") {
    activeSectionContent = (
      <article className="settings-card">
        <h3>My Profile</h3>
        <div className="settings-grid">
          <label>
            Full Name
            <input
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
            />
          </label>
        </div>
        <button type="button" onClick={saveProfile}>
          Update Name
        </button>
      </article>
    );
  }

  const settingsContent = (
    <section
      className={`settings-shell ${modal ? "settings-shell--modal" : ""}`}
    >
      {!modal ? (
        <>
          <header className="settings-hero">
            <div>
              <h2>Station Settings Console</h2>
              <p>
                Manage core station configuration safely with audited changes.
                Active plan: {stationPlan.planName}.
              </p>
            </div>
            <div className="settings-hero-badges">
              <article>
                <span>Tanks</span>
                <strong>{metrics.tanks}</strong>
              </article>
              <article>
                <span>Pumps</span>
                <strong>{metrics.pumps}</strong>
              </article>
              <article>
                <span>Staff</span>
                <strong>{metrics.staff}</strong>
              </article>
              <article>
                <span>Role</span>
                <strong>{metrics.role}</strong>
              </article>
            </div>
          </header>

          {loading || !data ? (
            <LoadingScreen />
          ) : (
            <>
              <div className="settings-tabs">{sectionButtons}</div>
              {settingsNotices}
              <p className="settings-active-description">
                {sectionMeta[active].detail}
              </p>
              {activeSectionContent}
            </>
          )}
        </>
      ) : (
        <div className="settings-chatgpt-layout">
          {loading || !data ? null : (
            <aside
            className="settings-chatgpt-sidebar"
            aria-label="Settings sections"
          >
            <div className="settings-chatgpt-sidebar-header">
              <h2>Settings</h2>
              <p>{stationPlan.planName}</p>
            </div>
            <nav className="settings-chatgpt-nav">{sectionButtons}</nav>
          </aside>
        )}
          
          <section className={
            loading || !data ? 'settings-chatgpt settings-loading-modal' : 'settings-chatgpt-panel'}>
            {loading || !data ? (
              <LoadingScreen />
            ) : (
              <>
                <header className="settings-chatgpt-panel-header">
                  <h3>{sectionMeta[active].title}</h3>
                  <p>{sectionMeta[active].detail}</p>
                </header>
                <section
                  className="settings-modal-summary"
                  aria-label="Settings summary"
                >
                  <article>
                    <span>Tanks</span>
                    <strong>{metrics.tanks}</strong>
                  </article>
                  <article>
                    <span>Pumps</span>
                    <strong>{metrics.pumps}</strong>
                  </article>
                  <article>
                    <span>Staff</span>
                    <strong>{metrics.staff}</strong>
                  </article>
                  <article>
                    <span>Role</span>
                    <strong>{metrics.role}</strong>
                  </article>
                </section>
                {settingsNotices}
                {activeSectionContent}
              </>
            )}
          </section>
        </div>
      )}
    </section>
  );

  const pumpQrModal = activePumpQr?.qr_payload ? (
    <div
      className="internal-modal-backdrop settings-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Pump ${activePumpQr.pump_number} QR`}
      onClick={() => setActivePumpQr(null)}
    >
      <div
        className="settings-pump-qr-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-pump-qr-header">
          <div>
            <h3>Pump {activePumpQr.pump_number} QR</h3>
            <p>{activePumpQr.public_id}</p>
          </div>
          <button type="button" onClick={() => setActivePumpQr(null)}>
            Close
          </button>
        </header>
        <div className="settings-pump-qr-body">
          <img
            src={buildPumpQrImageUrl(activePumpQr.qr_payload)}
            alt={`Pump ${activePumpQr.pump_number} QR code`}
            width={PUMP_QR_IMAGE_SIZE}
            height={PUMP_QR_IMAGE_SIZE}
          />
          <p className="settings-pump-qr-note">
            Mount this QR on the physical pump so queue users can scan it to
            confirm arrival.
          </p>
          <code>{activePumpQr.qr_payload}</code>
          <div className="settings-pump-qr-actions">
            <button
              type="button"
              onClick={() => handleCopyPumpQr(activePumpQr)}
            >
              Copy Payload
            </button>
            <button
              type="button"
              onClick={() => openPumpQrPrintView(activePumpQr)}
            >
              Open Printable View
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  if (modal) {
    return (
      <>
        <div
          className="internal-modal-backdrop settings-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Station settings"
          onClick={() => onClose?.()}
        >
          <div
            className="settings-chatgpt-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="settings-chatgpt-close"
              aria-label="Close settings"
              onClick={() => onClose?.()}
            >
              ×
            </button>
            {settingsContent}
          </div>
        </div>
        {pumpQrModal}
      </>
    );
  }

  return (
    <div className="settings-page">
      <Navbar
        pagetitle="Settings"
        image={avatar}
        count={navbarAlerts.length}
        alerts={navbarAlerts}
      />
      {settingsContent}
      {pumpQrModal}
    </div>
  );
}
