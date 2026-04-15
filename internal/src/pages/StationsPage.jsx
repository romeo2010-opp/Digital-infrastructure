import { useEffect, useMemo, useState } from "react"
import { internalApi } from "../api/internalApi"
import InternalShell from "../components/InternalShell"
import PreviewTablePanel from "../components/PreviewTablePanel"
import MetricGrid from "../components/MetricGrid"
import StatusPill from "../components/StatusPill"
import CursorActionMenu from "../components/CursorActionMenu"
import ExistingManagerDetailModal from "../components/ExistingManagerDetailModal"
import { formatDateTime, formatNumber } from "../utils/display"
import { createEmptyStaffDraft, formatManagerCandidateLabel } from "../utils/staffAssignment"
import { useInternalAuth } from "../auth/AuthContext"
import { useInternalApprovalRequests } from "../notifications/InternalApprovalRequestsContext"

const STATION_SUBSCRIPTION_PLANS = Object.freeze([
  { code: "TRIAL", name: "Trial Plan", monthlyFeeMwk: 0, defaultStatus: "TRIAL" },
  { code: "ESSENTIAL", name: "Essential Station", monthlyFeeMwk: 150000, defaultStatus: "ACTIVE" },
  { code: "GROWTH", name: "Growth Operations", monthlyFeeMwk: 200000, defaultStatus: "ACTIVE" },
  { code: "ENTERPRISE", name: "Enterprise Network", monthlyFeeMwk: 250000, defaultStatus: "ACTIVE" },
])

function parsePositiveInteger(value) {
  const normalized = String(value ?? "").trim()
  if (!/^\d+$/.test(normalized)) return null
  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null
  return parsed
}

function normalizeNozzleNumber(value) {
  const normalized = String(value ?? "").trim()
  return normalized || null
}

function toNumberOrZero(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function buildStationCreatePayload(profile, subscription, submitForReview) {
  return {
    ...profile,
    subscriptionPlanCode: subscription.planCode,
    subscriptionPlanName: subscription.planName,
    subscriptionStatus: subscription.status,
    monthlyFeeMwk: toNumberOrZero(subscription.monthlyFeeMwk),
    renewalDate: subscription.renewalDate || undefined,
    submitForReview,
  }
}

function buildStationSubscriptionPayload(subscription) {
  return {
    ...subscription,
    monthlyFeeMwk: toNumberOrZero(subscription.monthlyFeeMwk),
    renewalDate: subscription.renewalDate || null,
  }
}

function resolveStationSubscriptionPlan(planCode) {
  return (
    STATION_SUBSCRIPTION_PLANS.find((plan) => plan.code === String(planCode || "").trim().toUpperCase()) ||
    STATION_SUBSCRIPTION_PLANS[0]
  )
}

function normalizeChecklistItems(value) {
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        return {
          id: item.id || item.key || `check-${index}`,
          label: item.label || item.title || item.key || `Checklist item ${index + 1}`,
          status: item.status || (item.completed ? "COMPLETED" : "PENDING"),
          note: item.note || "",
        }
      }
      const label = String(item || "").trim()
      return {
        id: `check-${index}`,
        label: label || `Checklist item ${index + 1}`,
        status: "PENDING",
        note: "",
      }
    })
  }

  if (value && typeof value === "object") {
    return Object.entries(value).map(([key, completed], index) => ({
      id: key || `check-${index}`,
      label: String(key || `Checklist item ${index + 1}`).replace(/_/g, " "),
      status: completed ? "COMPLETED" : "PENDING",
      note: "",
    }))
  }

  return []
}

const PUMP_QR_IMAGE_SIZE = 280

function buildPumpQrImageUrl(payload, size = PUMP_QR_IMAGE_SIZE) {
  const normalizedPayload = String(payload || "").trim()
  if (!normalizedPayload) return ""
  return `https://api.qrserver.com/v1/create-qr-code/?format=svg&margin=0&size=${size}x${size}&data=${encodeURIComponent(normalizedPayload)}`
}

async function copyTextToClipboard(value) {
  const normalizedValue = String(value || "").trim()
  if (!normalizedValue) return false

  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(normalizedValue)
    return true
  }

  const textArea = document.createElement("textarea")
  textArea.value = normalizedValue
  textArea.setAttribute("readonly", "true")
  textArea.style.position = "absolute"
  textArea.style.left = "-9999px"
  document.body.appendChild(textArea)
  textArea.select()
  const copied = document.execCommand("copy")
  document.body.removeChild(textArea)
  return copied
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function StationAccessModal({ notice, onClose }) {
  if (!notice) return null

  return (
    <div className="internal-modal-backdrop" role="dialog" aria-modal="true" aria-label={notice.title} onClick={onClose}>
      <div className="internal-modal internal-modal--list admin-modal admin-modal--narrow" onClick={(event) => event.stopPropagation()}>
        <header className="internal-modal-header">
          <div className="internal-modal-header-copy">
            <h3>{notice.title}</h3>
            <p>{notice.subtitle}</p>
          </div>
          <div className="internal-modal-header-actions">
            <button type="button" className="secondary-action internal-modal-close" onClick={onClose}>Close</button>
          </div>
        </header>
        <div className="internal-modal-body internal-modal-body--list">
          <div className="admin-secret-card">
            <span>Person</span>
            <strong>{notice.fullName || "-"}</strong>
            <span>Login</span>
            <strong>{notice.loginIdentifier || "-"}</strong>
            <span>Temporary password</span>
            <code>{notice.temporaryPassword}</code>
          </div>
        </div>
      </div>
    </div>
  )
}

function PumpQrModal({ pump, stationPublicId, onClose, onCopy, onPrint }) {
  if (!pump?.qr_payload) return null

  return (
    <div className="internal-modal-backdrop" role="dialog" aria-modal="true" aria-label={`Pump ${pump.pump_number} QR`} onClick={onClose}>
      <div className="internal-modal internal-modal--list admin-modal admin-modal--narrow" onClick={(event) => event.stopPropagation()}>
        <header className="internal-modal-header">
          <div className="internal-modal-header-copy">
            <h3>Pump {pump.pump_number} QR</h3>
            <p>{pump.public_id}</p>
          </div>
          <div className="internal-modal-header-actions">
            <button type="button" className="secondary-action internal-modal-close" onClick={onClose}>Close</button>
          </div>
        </header>
        <div className="internal-modal-body internal-modal-body--list" style={{ alignItems: "center" }}>
          <img
            src={buildPumpQrImageUrl(pump.qr_payload)}
            alt={`Pump ${pump.pump_number} QR code`}
            width={PUMP_QR_IMAGE_SIZE}
            height={PUMP_QR_IMAGE_SIZE}
            style={{ display: "block", maxWidth: "100%", borderRadius: 18, border: "1px solid #d9e3ee", background: "#fff", padding: 14 }}
          />
          <p style={{ margin: 0, color: "#53657a", textAlign: "center" }}>
            Place this QR on the physical pump so the user app can confirm arrival by scanning it.
          </p>
          <code style={{ display: "block", width: "100%", padding: 14, borderRadius: 16, background: "#f3f6fa", color: "#1a314b", wordBreak: "break-all" }}>
            {pump.qr_payload}
          </code>
          <div className="settings-form-actions">
            <StatusPill value={stationPublicId || "STATION"} />
            <button type="button" className="secondary-action" onClick={() => onCopy?.(pump)}>Copy Payload</button>
            <button type="button" className="secondary-action" onClick={() => onPrint?.(pump)}>Open Printable View</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function StationSetupModal({ stationPublicId, mode, canConfigure, onClose, onSaved }) {
  const isCreate = mode === "create"
  const [setup, setSetup] = useState(null)
  const [loading, setLoading] = useState(!isCreate)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const [feedback, setFeedback] = useState("")
  const [credentialNotice, setCredentialNotice] = useState(null)
  const [profile, setProfile] = useState({
    name: "",
    operatorName: "",
    countryCode: "MW",
    city: "",
    address: "",
    timezone: "Africa/Blantyre",
    open24h: false,
    openingTime: "06:00",
    closingTime: "22:00",
  })
  const [subscription, setSubscription] = useState({
    planCode: "TRIAL",
    planName: "Trial Plan",
    status: "TRIAL",
    monthlyFeeMwk: 0,
    renewalDate: "",
  })
  const [staffDraft, setStaffDraft] = useState(createEmptyStaffDraft)
  const [editingStaffId, setEditingStaffId] = useState("")
  const [staffAssignmentMode, setStaffAssignmentMode] = useState("CREATE_NEW")
  const [managerSearch, setManagerSearch] = useState("")
  const [managerOptions, setManagerOptions] = useState([])
  const [loadingManagerOptions, setLoadingManagerOptions] = useState(false)
  const [managerDetailOpen, setManagerDetailOpen] = useState(false)
  const [staffContextMenu, setStaffContextMenu] = useState(null)
  const [newTank, setNewTank] = useState({ name: "", fuelType: "PETROL", capacityLitres: 0 })
  const [tankDrafts, setTankDrafts] = useState({})
  const [newPump, setNewPump] = useState({
    pumpNumber: 1,
    quickSetup: "MALAWI_2_NOZZLES",
    status: "ACTIVE",
    statusReason: "",
  })
  const [pumpDrafts, setPumpDrafts] = useState({})
  const [newNozzleByPump, setNewNozzleByPump] = useState({})
  const [nozzleDrafts, setNozzleDrafts] = useState({})
  const [activePumpQr, setActivePumpQr] = useState(null)

  function updateNozzleDraft(nozzlePublicId, field, value) {
    setNozzleDrafts((prev) => ({
      ...prev,
      [nozzlePublicId]: {
        ...(prev[nozzlePublicId] || {}),
        [field]: value,
      },
    }))
  }

  function selectSubscriptionPlan(nextPlanCode) {
    const nextPlan = resolveStationSubscriptionPlan(nextPlanCode)
    setSubscription((prev) => ({
      ...prev,
      planCode: nextPlan.code,
      planName: nextPlan.name,
      monthlyFeeMwk: nextPlan.monthlyFeeMwk,
      status: prev.status === "PAUSED" || prev.status === "GRACE" || prev.status === "OVERDUE"
        ? prev.status
        : nextPlan.defaultStatus,
    }))
  }

  function resetStaffForm() {
    setStaffDraft(createEmptyStaffDraft())
    setEditingStaffId("")
    setStaffAssignmentMode("CREATE_NEW")
    setManagerSearch("")
    setManagerOptions([])
    setManagerDetailOpen(false)
  }

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose()
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [onClose])

  async function loadSetup(targetStationId = stationPublicId) {
    if (!targetStationId) return
    setLoading(true)
    setError("")
    setFeedback("")
    try {
      const next = await internalApi.getStationSetup(targetStationId)
      setSetup(next)
      setProfile({
        name: next?.station?.name || "",
        operatorName: next?.station?.operator_name || "",
        countryCode: next?.station?.country_code || "MW",
        city: next?.station?.city || "",
        address: next?.station?.address || "",
        timezone: next?.station?.timezone || "Africa/Blantyre",
        open24h: Boolean(next?.station?.open_24h),
        openingTime: String(next?.station?.opening_time || "").slice(0, 5) || "06:00",
        closingTime: String(next?.station?.closing_time || "").slice(0, 5) || "22:00",
      })
      setSubscription({
        planCode: next?.subscription?.planCode || "TRIAL",
        planName: next?.subscription?.planName || "Trial Plan",
        status: next?.subscription?.status || "TRIAL",
        monthlyFeeMwk: next?.subscription?.monthlyFeeMwk || 0,
        renewalDate: next?.subscription?.renewalDate || "",
      })
      setEditingStaffId("")
      setStaffContextMenu(null)
      setManagerOptions([])
    } catch (err) {
      setError(err?.message || "Failed to load station setup")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isCreate) {
      setLoading(false)
      setSetup(null)
      return
    }
    loadSetup()
  }, [isCreate, stationPublicId])

  async function loadManagerCandidates(search = "") {
    if (!stationPublicId) return
    try {
      setLoadingManagerOptions(true)
      const result = await internalApi.searchStationManagerCandidates(stationPublicId, { q: search, limit: 12 })
      setManagerOptions(result?.items || [])
    } catch (err) {
      setError(err?.message || "Failed to load existing station managers")
    } finally {
      setLoadingManagerOptions(false)
    }
  }

  useEffect(() => {
    if (!stationPublicId || isCreate || editingStaffId || staffAssignmentMode !== "EXISTING_MANAGER") return
    loadManagerCandidates(managerSearch)
  }, [stationPublicId, isCreate, editingStaffId, staffAssignmentMode])

  async function runAction(action, { refresh = true, closeAfter = false } = {}) {
    try {
      setWorking(true)
      setError("")
      setFeedback("")
      const result = await action()
      const nextSetup = result?.setup || result
      if (refresh && !isCreate && stationPublicId) {
        setSetup(nextSetup)
        await onSaved()
      } else if (refresh) {
        await onSaved()
      }
      if (closeAfter) onClose()
      return result
    } catch (err) {
      setError(err?.message || "Station setup action failed")
      return null
    } finally {
      setWorking(false)
    }
  }

  async function createStation(submitForReview) {
    await runAction(
      () => internalApi.createStation(buildStationCreatePayload(profile, subscription, submitForReview)),
      { refresh: true, closeAfter: true }
    )
  }

  async function handleCopyPumpQr(pump) {
    try {
      const copied = await copyTextToClipboard(pump?.qr_payload)
      if (!copied) {
        setError("Failed to copy pump QR payload")
        return
      }
      setFeedback(`Pump ${pump?.pump_number || ""} QR payload copied.`)
    } catch (err) {
      setError(err?.message || "Failed to copy pump QR payload")
    }
  }

  function openPumpQrPrintView(pump) {
    const qrPayload = String(pump?.qr_payload || "").trim()
    if (!qrPayload) {
      setError("Pump QR payload is not available yet")
      return
    }

    const popup = window.open("", "_blank", "noopener,noreferrer,width=720,height=900")
    if (!popup) {
      setError("Allow pop-ups to open the printable pump QR label")
      return
    }

    const imageUrl = buildPumpQrImageUrl(qrPayload, 420)
    const pumpTitle = `Pump ${pump?.pump_number || "-"}`

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
      <p>${escapeHtml(stationPublicId || "Unknown Station")}</p>
      <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(pumpTitle)} QR code" />
      <code>${escapeHtml(qrPayload)}</code>
    </main>
  </body>
</html>`)
    popup.document.close()
    popup.focus()
  }

  async function saveAllChanges() {
    if (isCreate || !stationPublicId) return

    const tankUpdates = Object.entries(tankDrafts)
    const pumpUpdates = Object.entries(pumpDrafts)
    const nozzleUpdates = Object.entries(nozzleDrafts)
    const pendingNozzleCreates = Object.entries(newNozzleByPump)
    const pumpByPublicId = new Map((setup?.pumps || []).map((pump) => [pump.public_id, pump]))
    const nozzleByPublicId = new Map(
      (setup?.pumps || []).flatMap((pump) => (pump.nozzles || []).map((nozzle) => [nozzle.public_id, nozzle]))
    )

    try {
      setWorking(true)
      setError("")
      setFeedback("")
      setCredentialNotice(null)

      await internalApi.updateStationProfile(stationPublicId, profile)
      await internalApi.updateStationSubscription(stationPublicId, buildStationSubscriptionPayload(subscription))

      for (const [tankPublicId, draft] of tankUpdates) {
        const capacityLitres = toNumberOrZero(draft.capacity_litres)
        if (capacityLitres <= 0) throw new Error("Tank capacity must be greater than zero")
        await internalApi.patchStationTank(stationPublicId, tankPublicId, {
          name: draft.name,
          capacityLitres,
          isActive: Boolean(draft.is_active),
        })
      }

      for (const [pumpPublicId, draft] of pumpUpdates) {
        const existingPump = pumpByPublicId.get(pumpPublicId)
        const payload = {}
        if (draft.pump_number !== undefined) {
          const pumpNumber = parsePositiveInteger(draft.pump_number)
          if (!pumpNumber) throw new Error("Pump number must be a positive integer")
          if (pumpNumber !== Number(existingPump?.pump_number || 0)) {
            payload.pumpNumber = pumpNumber
          }
        }
        if (draft.status !== undefined && draft.status !== existingPump?.status) {
          payload.status = draft.status
        }
        if (!Object.keys(payload).length) continue
        await internalApi.patchStationPump(stationPublicId, pumpPublicId, payload)
      }

      for (const [nozzlePublicId, draft] of nozzleUpdates) {
        const existingNozzle = nozzleByPublicId.get(nozzlePublicId)
        const payload = {}
        if (Object.prototype.hasOwnProperty.call(draft, "nozzle_number")) {
          const nozzleNumber = normalizeNozzleNumber(draft.nozzle_number)
          if (!nozzleNumber) throw new Error("Nozzle code/label is required")
          if (nozzleNumber !== String(existingNozzle?.nozzle_number || "").trim()) {
            payload.nozzleNumber = nozzleNumber
          }
        }
        if (Object.prototype.hasOwnProperty.call(draft, "status") && draft.status !== existingNozzle?.status) {
          payload.status = draft.status
        }
        if (Object.prototype.hasOwnProperty.call(draft, "fuel_code") && draft.fuel_code !== existingNozzle?.fuel_code) {
          payload.fuelType = draft.fuel_code
        }
        if (Object.prototype.hasOwnProperty.call(draft, "tank_public_id")) {
          const nextTankPublicId = draft.tank_public_id || null
          if (nextTankPublicId !== (existingNozzle?.tank_public_id || null)) {
            payload.tankPublicId = nextTankPublicId
          }
        }
        if (!Object.keys(payload).length) continue
        await internalApi.patchStationNozzle(stationPublicId, nozzlePublicId, payload)
      }

      for (const [pumpPublicId, draft] of pendingNozzleCreates) {
        const nozzleNumber = normalizeNozzleNumber(draft.nozzleNumber)
        if (!nozzleNumber) throw new Error("Nozzle code/label is required")
        await internalApi.createStationNozzle(stationPublicId, pumpPublicId, {
          nozzleNumber,
          fuelType: draft.fuelType,
          tankPublicId: draft.tankPublicId || undefined,
          status: draft.status,
        })
      }

      await loadSetup(stationPublicId)
      await onSaved()
      setTankDrafts({})
      setPumpDrafts({})
      setNozzleDrafts({})
      setNewNozzleByPump({})
      setFeedback("All station changes saved.")
    } catch (err) {
      setError(err?.message || "Failed to save station changes")
    } finally {
      setWorking(false)
    }
  }

  function openStaffContextMenu(event, member) {
    event.preventDefault()
    if (!canConfigure || working) return
    setStaffContextMenu({
      x: event.clientX,
      y: event.clientY,
      member,
      title: member.full_name || member.email || member.phone_e164 || "Staff actions",
      items: [
        {
          id: "otp",
          label: "One-time password",
          onSelect: async () => {
            if (!stationPublicId) return
            const result = await runAction(() => internalApi.resetStationStaffAccess(stationPublicId, member.id))
            if (result?.credential) {
              setCredentialNotice(result.credential)
            }
          },
        },
        {
          id: "edit",
          label: "Edit staff",
          onSelect: () => {
            setEditingStaffId(String(member.id))
            setStaffDraft({
              fullName: member.full_name || "",
              email: member.email || "",
              phone: member.phone_e164 || "",
              roleCode: member.role_code || member.role || "MANAGER",
              existingUserPublicId: "",
            })
            setStaffAssignmentMode("CREATE_NEW")
          },
        },
        {
          id: "delete",
          label: "Delete staff",
          danger: true,
          onSelect: async () => {
            if (!stationPublicId) return
            if (!window.confirm(`Remove ${member.full_name || "this staff member"} from the station?`)) return
            await runAction(() => internalApi.deleteStationStaff(stationPublicId, member.id))
            if (String(editingStaffId) === String(member.id)) {
              resetStaffForm()
            }
          },
        },
      ],
    })
  }

  async function handleSubmitStaff() {
    if (!stationPublicId) return

    const action = editingStaffId
      ? () => internalApi.patchStationStaff(stationPublicId, editingStaffId, staffDraft)
      : staffAssignmentMode === "EXISTING_MANAGER"
        ? () =>
            internalApi.assignStationStaff(stationPublicId, {
              existingUserPublicId: staffDraft.existingUserPublicId,
              roleCode: "MANAGER",
            })
        : () => internalApi.assignStationStaff(stationPublicId, staffDraft)
    const result = await runAction(action)
    if (!result) return

    const credential = result?.credential || null
    resetStaffForm()

    if (credential) {
      setCredentialNotice({
        title: credential.roleCode === "MANAGER" ? "Station manager access ready" : "Station staff access ready",
        subtitle: "Share these login details securely. The temporary password is only shown once here.",
        fullName: credential.fullName,
        loginIdentifier: credential.loginIdentifier,
        temporaryPassword: credential.temporaryPassword,
      })
    }
  }

  function createNozzleDraft(pump) {
    const numericNozzles = (pump?.nozzles || [])
      .map((nozzle) => Number(nozzle.nozzle_number))
      .filter((value) => Number.isFinite(value) && value > 0)
    const nextNumber =
      numericNozzles.length === (pump?.nozzles || []).length
        ? Math.max(0, ...numericNozzles) + 1
        : (pump?.nozzles || []).length + 1
    return {
      nozzleNumber: String(nextNumber),
      side: nextNumber % 2 === 0 ? "B" : "A",
      fuelType: "PETROL",
      tankPublicId: "",
      status: "ACTIVE",
      hardwareChannel: "",
    }
  }

  const tanks = setup?.tanks || []
  const pumps = setup?.pumps || []
  const staff = setup?.staff || []
  const checklistItems = normalizeChecklistItems(setup?.onboarding?.checklistItems)
  const selectedExistingManager = managerOptions.find((candidate) => candidate.userPublicId === staffDraft.existingUserPublicId) || null
  const staffSubmitDisabled =
    !canConfigure ||
    working ||
    (!editingStaffId &&
      staffAssignmentMode === "EXISTING_MANAGER" &&
      (!staffDraft.existingUserPublicId || Boolean(selectedExistingManager?.alreadyAssignedToStation)))

  return (
    <>
      <div className="internal-modal-backdrop" role="dialog" aria-modal="true" aria-label="Station setup" onClick={onClose}>
	      <div className="internal-modal admin-modal" onClick={(event) => event.stopPropagation()}>
	        <header className="internal-modal-header">
          <div className="internal-modal-header-copy">
            <h3>{isCreate ? "Create Station" : profile.name || "Station Setup"}</h3>
            <p>Station onboarding setup, profile configuration, staff assignment, and pump or nozzle configuration.</p>
          </div>
          <div className="internal-modal-header-actions">
            {!isCreate ? (
              <button type="button" className="secondary-action" disabled={!canConfigure || working} onClick={saveAllChanges}>
                Save All Changes
              </button>
            ) : null}
            {!isCreate && setup?.onboarding?.status ? <StatusPill value={setup.onboarding.status} /> : null}
            <button type="button" className="secondary-action internal-modal-close" onClick={onClose}>Close</button>
          </div>
        </header>

        <div className="internal-modal-body">
          {loading ? <p>Loading station setup...</p> : null}
          {!loading ? (
            <div className="stack-grid">
              {error ? <p className="settings-error">{error}</p> : null}
              {feedback ? <p className="settings-inline-feedback">{feedback}</p> : null}

              <div className="settings-form-card">
                <div className="settings-form-actions">
                  {!isCreate && setup?.station?.public_id ? <StatusPill value={Number(setup.station.is_active) ? "ACTIVE" : "INACTIVE"} /> : null}
                  {!isCreate && setup?.subscription?.status ? <StatusPill value={setup.subscription.status} /> : null}
                </div>
                <div className="settings-profile-grid">
                  <label className="settings-form-field">
                    <span>Station Name</span>
                    <input value={profile.name} onChange={(event) => setProfile((prev) => ({ ...prev, name: event.target.value }))} disabled={!canConfigure || working} />
                  </label>
                  <label className="settings-form-field">
                    <span>Operator</span>
                    <input value={profile.operatorName} onChange={(event) => setProfile((prev) => ({ ...prev, operatorName: event.target.value }))} disabled={!canConfigure || working} />
                  </label>
                  <label className="settings-form-field">
                    <span>Country Code</span>
                    <input value={profile.countryCode} maxLength={2} onChange={(event) => setProfile((prev) => ({ ...prev, countryCode: event.target.value.toUpperCase() }))} disabled={!canConfigure || working} />
                  </label>
                  <label className="settings-form-field">
                    <span>City</span>
                    <input value={profile.city} onChange={(event) => setProfile((prev) => ({ ...prev, city: event.target.value }))} disabled={!canConfigure || working} />
                  </label>
                  <label className="settings-form-field">
                    <span>Address</span>
                    <input value={profile.address} onChange={(event) => setProfile((prev) => ({ ...prev, address: event.target.value }))} disabled={!canConfigure || working} />
                  </label>
                  <label className="settings-form-field">
                    <span>Timezone</span>
                    <input value={profile.timezone} onChange={(event) => setProfile((prev) => ({ ...prev, timezone: event.target.value }))} disabled={!canConfigure || working} />
                  </label>
                  <label className="settings-form-field">
                    <span>Open 24 Hours</span>
                    <select value={profile.open24h ? "YES" : "NO"} onChange={(event) => setProfile((prev) => ({ ...prev, open24h: event.target.value === "YES" }))} disabled={!canConfigure || working}>
                      <option value="NO">No</option>
                      <option value="YES">Yes</option>
                    </select>
                  </label>
                  <label className="settings-form-field">
                    <span>Opening Time</span>
                    <input type="time" value={profile.open24h ? "00:00" : profile.openingTime} onChange={(event) => setProfile((prev) => ({ ...prev, openingTime: event.target.value }))} disabled={!canConfigure || working || profile.open24h} />
                  </label>
                  <label className="settings-form-field">
                    <span>Closing Time</span>
                    <input type="time" value={profile.open24h ? "23:59" : profile.closingTime} onChange={(event) => setProfile((prev) => ({ ...prev, closingTime: event.target.value }))} disabled={!canConfigure || working || profile.open24h} />
                  </label>
                </div>
                <div className="settings-form-actions">
                  {isCreate ? (
                    <>
                      <button type="button" className="secondary-action" disabled={!canConfigure || working} onClick={() => createStation(false)}>Save Draft Station</button>
                      <button type="button" className="secondary-action" disabled={!canConfigure || working} onClick={() => createStation(true)}>Submit Station for Review</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="secondary-action" disabled={!canConfigure || working} onClick={() => runAction(() => internalApi.updateStationProfile(stationPublicId, profile))}>Save Draft Station</button>
                      <button type="button" className="secondary-action" disabled={!canConfigure || working} onClick={() => runAction(() => internalApi.submitStationForReview(stationPublicId))}>Submit Station for Review</button>
                    </>
                  )}
                </div>
              </div>

              <div className="settings-form-card">
                <h4 style={{ margin: 0, color: "#1a314b" }}>{isCreate ? "Subscription Plan" : "Subscription Setup"}</h4>
                <div className="settings-profile-grid">
                  <label className="settings-form-field">
                    <span>Plan</span>
                    <select value={subscription.planCode} onChange={(event) => selectSubscriptionPlan(event.target.value)} disabled={!canConfigure || working}>
                      {STATION_SUBSCRIPTION_PLANS.map((plan) => (
                        <option key={plan.code} value={plan.code}>
                          {plan.name} ({plan.code})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="settings-form-field">
                    <span>Plan Name</span>
                    <input value={subscription.planName} disabled />
                  </label>
                  <label className="settings-form-field">
                    <span>Status</span>
                    <select value={subscription.status} onChange={(event) => setSubscription((prev) => ({ ...prev, status: event.target.value }))} disabled={!canConfigure || working}>
                      <option value="TRIAL">TRIAL</option>
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="PAUSED">PAUSED</option>
                      <option value="GRACE">GRACE</option>
                      <option value="OVERDUE">OVERDUE</option>
                    </select>
                  </label>
                  <label className="settings-form-field">
                    <span>Monthly Fee (MWK)</span>
                    <input type="number" min="0" value={subscription.monthlyFeeMwk} onChange={(event) => setSubscription((prev) => ({ ...prev, monthlyFeeMwk: event.target.value }))} disabled={!canConfigure || working} />
                  </label>
                  <label className="settings-form-field">
                    <span>Renewal Date</span>
                    <input type="date" value={subscription.renewalDate || ""} onChange={(event) => setSubscription((prev) => ({ ...prev, renewalDate: event.target.value }))} disabled={!canConfigure || working} />
                  </label>
                </div>
                {!isCreate ? (
                  <div className="settings-form-actions">
                    <button type="button" className="secondary-action" disabled={!canConfigure || working} onClick={() => runAction(() => internalApi.updateStationSubscription(stationPublicId, buildStationSubscriptionPayload(subscription)))}>
                      Save Subscription
                    </button>
                  </div>
                ) : null}
              </div>

              {!isCreate ? (
                <>
                  <div className="settings-form-card">
                    <h4 style={{ margin: 0, color: "#1a314b" }}>Assign Station Staff</h4>
                    <div className="settings-profile-grid">
                      {!editingStaffId ? (
                        <label className="settings-form-field">
                          <span>Assignment Mode</span>
                          <select
                            value={staffAssignmentMode}
                            onChange={(event) => {
                              const nextMode = event.target.value
                              setStaffAssignmentMode(nextMode)
                              setStaffDraft((prev) => ({
                                ...createEmptyStaffDraft(),
                                roleCode:
                                  nextMode === "EXISTING_MANAGER"
                                    ? "MANAGER"
                                    : prev.roleCode === "ATTENDANT" || prev.roleCode === "VIEWER"
                                      ? prev.roleCode
                                      : "MANAGER",
                              }))
                              setManagerSearch("")
                              setManagerOptions([])
                              setManagerDetailOpen(false)
                            }}
                            disabled={!canConfigure || working}
                          >
                            <option value="CREATE_NEW">Create New User</option>
                            <option value="EXISTING_MANAGER">Assign Existing Manager</option>
                          </select>
                        </label>
                      ) : null}
                      {!editingStaffId && staffAssignmentMode === "EXISTING_MANAGER" ? (
                        <>
                          <label className="settings-form-field">
                            <span>Search Existing Managers</span>
                            <input
                              value={managerSearch}
                              placeholder="Search by user ID, name, email, or phone"
                              onChange={(event) => setManagerSearch(event.target.value)}
                              disabled={!canConfigure || working}
                            />
                          </label>
                          <div className="settings-form-field">
                            <span>Search</span>
                            <div className="settings-form-actions">
                              <button type="button" className="secondary-action" disabled={!canConfigure || working || loadingManagerOptions} onClick={() => loadManagerCandidates(managerSearch)}>
                                {loadingManagerOptions ? "Searching..." : "Search Managers"}
                              </button>
                            </div>
                          </div>
                          <label className="settings-form-field">
                            <span>Existing Manager</span>
                            <select
                              value={staffDraft.existingUserPublicId}
                              onChange={(event) => {
                                setStaffDraft((prev) => ({ ...prev, existingUserPublicId: event.target.value, roleCode: "MANAGER" }))
                                setManagerDetailOpen(false)
                              }}
                              disabled={!canConfigure || working || loadingManagerOptions}
                            >
                              <option value="">Select a manager</option>
                              {managerOptions.map((candidate) => (
                                <option key={candidate.userPublicId} value={candidate.userPublicId}>
                                  {formatManagerCandidateLabel(candidate)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="settings-form-field">
                            <span>Role</span>
                            <input value="MANAGER" readOnly />
                          </label>
                          <div className="settings-form-field">
                            <span>Selected Manager</span>
                            <div className="existing-manager-inline-row">
                              <div className="existing-manager-inline-copy">
                                <strong>{selectedExistingManager?.fullName || "No manager selected"}</strong>
                                <small>{selectedExistingManager?.userPublicId || "Choose a manager to review full details."}</small>
                              </div>
                              <button
                                type="button"
                                className="secondary-action"
                                disabled={!selectedExistingManager}
                                onClick={() => setManagerDetailOpen(true)}
                              >
                                View Details
                              </button>
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                      <label className="settings-form-field">
                        <span>Full Name</span>
                        <input value={staffDraft.fullName} onChange={(event) => setStaffDraft((prev) => ({ ...prev, fullName: event.target.value }))} disabled={!canConfigure || working} />
                      </label>
                      <label className="settings-form-field">
                        <span>Email</span>
                        <input value={staffDraft.email} onChange={(event) => setStaffDraft((prev) => ({ ...prev, email: event.target.value }))} disabled={!canConfigure || working} />
                      </label>
                      <label className="settings-form-field">
                        <span>Phone</span>
                        <input value={staffDraft.phone} onChange={(event) => setStaffDraft((prev) => ({ ...prev, phone: event.target.value }))} disabled={!canConfigure || working} />
                      </label>
                      <label className="settings-form-field">
                        <span>Role</span>
                        <select value={staffDraft.roleCode} onChange={(event) => setStaffDraft((prev) => ({ ...prev, roleCode: event.target.value }))} disabled={!canConfigure || working}>
                          <option value="MANAGER">MANAGER</option>
                          <option value="ATTENDANT">ATTENDANT</option>
                          <option value="VIEWER">VIEWER</option>
                        </select>
                      </label>
                        </>
                      )}
                    </div>
                    <div className="settings-form-actions">
                      <button
                        type="button"
                        className="secondary-action"
                        disabled={staffSubmitDisabled}
                        onClick={handleSubmitStaff}
                      >
                        {editingStaffId ? "Save Staff Changes" : staffAssignmentMode === "EXISTING_MANAGER" ? "Assign Existing Manager" : "Assign Staff"}
                      </button>
                      {editingStaffId ? (
                        <button
                          type="button"
                          className="secondary-action"
                          disabled={!canConfigure || working}
                          onClick={resetStaffForm}
                        >
                          Cancel Edit
                        </button>
                      ) : null}
                    </div>
                    {!editingStaffId && staffAssignmentMode === "EXISTING_MANAGER" && selectedExistingManager?.alreadyAssignedToStation ? (
                      <p className="staff-edit-hint">This manager is already assigned to the selected station.</p>
                    ) : null}
                    {editingStaffId ? (
                      <p className="staff-edit-hint">Editing selected staff member. Right-click another staff row to switch actions.</p>
                    ) : null}
                    <div className="settings-summary-list admin-detail-grid">
                      {staff.map((member) => (
                        <div
                          key={member.id}
                          className="interactive-staff-row"
                          onContextMenu={(event) => openStaffContextMenu(event, member)}
                          title="Right-click for staff actions"
                        >
                          <span>{member.role_name || member.role_code || member.role}</span>
                          <strong>{member.full_name || member.email || member.phone_e164 || "Unassigned"}</strong>
                          <small>{member.email || member.phone_e164 || "No login identifier"}</small>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="settings-form-card">
                    <h4 style={{ margin: 0, color: "#1a314b" }}>Tank Configuration</h4>
                    <div className="settings-profile-grid">
                      <label className="settings-form-field">
                        <span>Tank Name</span>
                        <input value={newTank.name} onChange={(event) => setNewTank((prev) => ({ ...prev, name: event.target.value }))} disabled={!canConfigure || working} />
                      </label>
                      <label className="settings-form-field">
                        <span>Fuel Type</span>
                        <select value={newTank.fuelType} onChange={(event) => setNewTank((prev) => ({ ...prev, fuelType: event.target.value }))} disabled={!canConfigure || working}>
                          <option value="PETROL">PETROL</option>
                          <option value="DIESEL">DIESEL</option>
                        </select>
                      </label>
                      <label className="settings-form-field">
                        <span>Capacity (L)</span>
                        <input type="number" min="1" value={newTank.capacityLitres} onChange={(event) => setNewTank((prev) => ({ ...prev, capacityLitres: event.target.value }))} disabled={!canConfigure || working} />
                      </label>
                    </div>
                    <div className="settings-form-actions">
                      <button
                        type="button"
                        className="secondary-action"
                        disabled={!canConfigure || working}
                        onClick={async () => {
                          const result = await runAction(() =>
                            internalApi.createStationTank(stationPublicId, {
                              name: newTank.name,
                              fuelType: newTank.fuelType,
                              capacityLitres: toNumberOrZero(newTank.capacityLitres),
                            })
                          )
                          if (result) {
                            setNewTank({ name: "", fuelType: "PETROL", capacityLitres: 0 })
                          }
                        }}
                      >
                        Add Tank
                      </button>
                    </div>
                    <div className="timeline-list">
                      {tanks.map((tank) => {
                        const draft = tankDrafts[tank.public_id] || tank
                        return (
                          <article key={tank.public_id} className="timeline-item">
                            <div style={{ display: "grid", gap: 10, width: "100%" }}>
                              <div className="settings-profile-grid">
                                <label className="settings-form-field">
                                  <span>Name</span>
                                  <input value={draft.name || ""} onChange={(event) => setTankDrafts((prev) => ({ ...prev, [tank.public_id]: { ...draft, name: event.target.value } }))} disabled={!canConfigure || working} />
                                </label>
                                <label className="settings-form-field">
                                  <span>Capacity (L)</span>
                                  <input type="number" min="1" value={draft.capacity_litres || ""} onChange={(event) => setTankDrafts((prev) => ({ ...prev, [tank.public_id]: { ...draft, capacity_litres: event.target.value } }))} disabled={!canConfigure || working} />
                                </label>
                              </div>
                              <div className="settings-form-actions">
                                <StatusPill value={tank.fuel_code} />
                                <button
                                  type="button"
                                  className="secondary-action"
                                  disabled={!canConfigure || working}
                                  onClick={() =>
                                    runAction(() =>
                                      internalApi.patchStationTank(stationPublicId, tank.public_id, {
                                        name: draft.name,
                                        capacityLitres: toNumberOrZero(draft.capacity_litres),
                                        isActive: Boolean(draft.is_active),
                                      })
                                    )
                                  }
                                >
                                  Save Tank
                                </button>
                              </div>
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  </div>

                  <div className="settings-form-card">
                    <h4 style={{ margin: 0, color: "#1a314b" }}>Onboarding Checklist</h4>
                    <div className="timeline-list">
                      {checklistItems.map((item, index) => (
                        <article key={`${item.id || item.label || "check"}-${index}`} className="timeline-item">
                          <div style={{ display: "grid", gap: 6, width: "100%" }}>
                            <div className="settings-form-actions">
                              <strong>{item.label || `Checklist item ${index + 1}`}</strong>
                              <StatusPill value={item.status || "PENDING"} />
                            </div>
                            {item.note ? <p style={{ margin: 0, color: "#53657a" }}>{item.note}</p> : null}
                          </div>
                        </article>
                      ))}
                      {!checklistItems.length ? <p style={{ margin: 0, color: "#53657a" }}>No onboarding checklist items recorded yet.</p> : null}
                    </div>
                    {setup?.onboarding?.notes ? <p style={{ margin: 0, color: "#53657a", marginTop: 12 }}>{setup.onboarding.notes}</p> : null}
                  </div>

                  <div className="settings-form-card">
                    <h4 style={{ margin: 0, color: "#1a314b" }}>Pump and Nozzle Setup</h4>
                    <div className="settings-profile-grid">
                      <label className="settings-form-field">
                        <span>Pump Number</span>
                        <input type="number" min="1" step="1" value={newPump.pumpNumber} onChange={(event) => setNewPump((prev) => ({ ...prev, pumpNumber: event.target.value }))} disabled={!canConfigure || working} />
                      </label>
                      <label className="settings-form-field">
                        <span>Quick Setup</span>
                        <select value={newPump.quickSetup} onChange={(event) => setNewPump((prev) => ({ ...prev, quickSetup: event.target.value }))} disabled={!canConfigure || working}>
                          <option value="MALAWI_2_NOZZLES">Malawi 2 nozzles</option>
                          <option value="MALAWI_4_NOZZLES">Malawi 4 nozzles</option>
                          <option value="CUSTOM">Custom</option>
                        </select>
                      </label>
                    </div>
                    <div className="settings-form-actions">
                      <button
                        type="button"
                        className="secondary-action"
                        disabled={!canConfigure || working}
                        onClick={async () => {
                          const pumpNumber = parsePositiveInteger(newPump.pumpNumber)
                          if (!pumpNumber) {
                            setError("Pump number must be a positive integer")
                            return
                          }
                          const result = await runAction(() =>
                            internalApi.createStationPump(stationPublicId, {
                              pumpNumber,
                              quickSetup: newPump.quickSetup === "CUSTOM" ? undefined : newPump.quickSetup,
                              status: newPump.status,
                              statusReason: newPump.statusReason || undefined,
                            })
                          )
                          if (result) {
                            setNewPump({
                              pumpNumber: 1,
                              quickSetup: "MALAWI_2_NOZZLES",
                              status: "ACTIVE",
                              statusReason: "",
                            })
                          }
                        }}
                      >
                        Add Pump
                      </button>
                    </div>
                    <div className="timeline-list">
                      {pumps.map((pump) => {
                        const draft = pumpDrafts[pump.public_id] || pump
                        const nozzleDraft = newNozzleByPump[pump.public_id] || null
                        return (
                          <article key={pump.public_id} className="timeline-item" style={{ display: "grid" }}>
                            <div style={{ display: "grid", gap: 12, width: "100%" }}>
                              <div className="settings-form-actions">
                                <strong>{pump.public_id}</strong>
                                <StatusPill value={pump.status} />
                              </div>
                              <div className="settings-profile-grid">
                                <label className="settings-form-field">
                                  <span>Pump Number</span>
                                  <input type="number" min="1" step="1" value={draft.pump_number || ""} onChange={(event) => setPumpDrafts((prev) => ({ ...prev, [pump.public_id]: { ...draft, pump_number: event.target.value } }))} disabled={!canConfigure || working} />
                                </label>
                                <label className="settings-form-field">
                                  <span>Status</span>
                                  <select value={draft.status || "ACTIVE"} onChange={(event) => setPumpDrafts((prev) => ({ ...prev, [pump.public_id]: { ...draft, status: event.target.value } }))} disabled={!canConfigure || working}>
                                    <option value="ACTIVE">ACTIVE</option>
                                    <option value="PAUSED">PAUSED</option>
                                    <option value="OFFLINE">OFFLINE</option>
                                    <option value="IDLE">IDLE</option>
                                  </select>
                                </label>
                              </div>
                              <div className="settings-form-actions">
                                <button
                                  type="button"
                                  className="secondary-action"
                                  disabled={!canConfigure || working}
                                  onClick={() => {
                                    const pumpNumber = parsePositiveInteger(draft.pump_number)
                                    if (!pumpNumber) {
                                      setError("Pump number must be a positive integer")
                                      return
                                    }
                                    runAction(() => internalApi.patchStationPump(stationPublicId, pump.public_id, { pumpNumber, status: draft.status }))
                                  }}
                                >
                                  Save Pump
                                </button>
                                <button
                                  type="button"
                                  className="secondary-action"
                                  onClick={() => setActivePumpQr(pump)}
                                >
                                  Show QR
                                </button>
                                <button type="button" className="secondary-action" disabled={!canConfigure || working} onClick={() => runAction(() => internalApi.deleteStationPump(stationPublicId, pump.public_id))}>
                                  Remove Pump
                                </button>
                                <button
                                  type="button"
                                  className="secondary-action"
                                  disabled={!canConfigure || working}
                                  onClick={() => setNewNozzleByPump((prev) => ({ ...prev, [pump.public_id]: createNozzleDraft(pump) }))}
                                >
                                  Add Nozzle
                                </button>
                              </div>
                              <div className="timeline-list">
                                {(pump.nozzles || []).map((nozzle) => {
                                  const nozzleDraft = nozzleDrafts[nozzle.public_id] || {}
                                  const nozzleEditDraft = { ...nozzle, ...nozzleDraft }
                                  return (
                                    <article key={nozzle.public_id} className="timeline-item">
                                      <div style={{ display: "grid", gap: 10, width: "100%" }}>
                                        <div className="settings-profile-grid">
                                          <label className="settings-form-field">
                                            <span>Nozzle Code / Label</span>
                                            <input value={nozzleEditDraft.nozzle_number || ""} onChange={(event) => updateNozzleDraft(nozzle.public_id, "nozzle_number", event.target.value)} disabled={!canConfigure || working} />
                                          </label>
                                          <label className="settings-form-field">
                                            <span>Status</span>
                                            <select value={nozzleEditDraft.status || "ACTIVE"} onChange={(event) => updateNozzleDraft(nozzle.public_id, "status", event.target.value)} disabled={!canConfigure || working}>
                                              <option value="ACTIVE">ACTIVE</option>
                                              <option value="PAUSED">PAUSED</option>
                                              <option value="OFFLINE">OFFLINE</option>
                                            </select>
                                          </label>
                                          <label className="settings-form-field">
                                            <span>Fuel Type</span>
                                            <select value={nozzleEditDraft.fuel_code || "PETROL"} onChange={(event) => updateNozzleDraft(nozzle.public_id, "fuel_code", event.target.value)} disabled={!canConfigure || working}>
                                              <option value="PETROL">PETROL</option>
                                              <option value="DIESEL">DIESEL</option>
                                            </select>
                                          </label>
                                          <label className="settings-form-field">
                                            <span>Tank Mapping</span>
                                            <select value={nozzleEditDraft.tank_public_id || ""} onChange={(event) => updateNozzleDraft(nozzle.public_id, "tank_public_id", event.target.value)} disabled={!canConfigure || working}>
                                              <option value="">Unlinked</option>
                                              {tanks.map((tank) => (
                                                <option key={tank.public_id} value={tank.public_id}>{tank.name} ({tank.fuel_code})</option>
                                              ))}
                                            </select>
                                          </label>
                                        </div>
                                        <div className="settings-form-actions">
                                          <button
                                            type="button"
                                            className="secondary-action"
                                            disabled={!canConfigure || working}
                                            onClick={() => {
                                              const payload = {}
                                              const nozzleNumber = normalizeNozzleNumber(nozzleEditDraft.nozzle_number)
                                              const currentNozzleNumber = String(nozzle.nozzle_number || "").trim()
                                              if (Object.prototype.hasOwnProperty.call(nozzleDraft, "nozzle_number") && nozzleNumber !== currentNozzleNumber) {
                                                if (!nozzleNumber) {
                                                  setError("Nozzle code/label is required")
                                                  return
                                                }
                                                payload.nozzleNumber = nozzleNumber
                                              }
                                              if (Object.prototype.hasOwnProperty.call(nozzleDraft, "status") && nozzleEditDraft.status !== nozzle.status) payload.status = nozzleEditDraft.status
                                              if (Object.prototype.hasOwnProperty.call(nozzleDraft, "fuel_code") && nozzleEditDraft.fuel_code !== nozzle.fuel_code) payload.fuelType = nozzleEditDraft.fuel_code
                                              if (Object.prototype.hasOwnProperty.call(nozzleDraft, "tank_public_id") && (nozzleEditDraft.tank_public_id || null) !== (nozzle.tank_public_id || null)) {
                                                payload.tankPublicId = nozzleEditDraft.tank_public_id || null
                                              }
                                              if (!Object.keys(payload).length) {
                                                setFeedback("No nozzle changes to save.")
                                                return
                                              }
                                              runAction(() =>
                                                internalApi.patchStationNozzle(stationPublicId, nozzle.public_id, payload)
                                              )
                                            }}
                                          >
                                            Save Nozzle
                                          </button>
                                          <button type="button" className="secondary-action" disabled={!canConfigure || working} onClick={() => runAction(() => internalApi.deleteStationNozzle(stationPublicId, nozzle.public_id))}>
                                            Remove Nozzle
                                          </button>
                                        </div>
                                      </div>
                                    </article>
                                  )
                                })}
                                {nozzleDraft ? (
                                  <article className="timeline-item">
                                    <div style={{ display: "grid", gap: 10, width: "100%" }}>
                                      <div className="settings-profile-grid">
                                        <label className="settings-form-field">
                                          <span>Nozzle Code / Label</span>
                                          <input value={nozzleDraft.nozzleNumber} onChange={(event) => setNewNozzleByPump((prev) => ({ ...prev, [pump.public_id]: { ...nozzleDraft, nozzleNumber: event.target.value } }))} disabled={!canConfigure || working} />
                                        </label>
                                        <label className="settings-form-field">
                                          <span>Side</span>
                                          <select value={nozzleDraft.side || "A"} onChange={(event) => setNewNozzleByPump((prev) => ({ ...prev, [pump.public_id]: { ...nozzleDraft, side: event.target.value } }))} disabled={!canConfigure || working}>
                                            <option value="A">A</option>
                                            <option value="B">B</option>
                                          </select>
                                        </label>
                                        <label className="settings-form-field">
                                          <span>Fuel Type</span>
                                          <select value={nozzleDraft.fuelType} onChange={(event) => setNewNozzleByPump((prev) => ({ ...prev, [pump.public_id]: { ...nozzleDraft, fuelType: event.target.value } }))} disabled={!canConfigure || working}>
                                            <option value="PETROL">PETROL</option>
                                            <option value="DIESEL">DIESEL</option>
                                          </select>
                                        </label>
                                        <label className="settings-form-field">
                                          <span>Tank Mapping</span>
                                          <select value={nozzleDraft.tankPublicId || ""} onChange={(event) => setNewNozzleByPump((prev) => ({ ...prev, [pump.public_id]: { ...nozzleDraft, tankPublicId: event.target.value } }))} disabled={!canConfigure || working}>
                                            <option value="">Unlinked</option>
                                            {tanks.map((tank) => (
                                              <option key={tank.public_id} value={tank.public_id}>{tank.name} ({tank.fuel_code})</option>
                                            ))}
                                          </select>
                                        </label>
                                      </div>
                                      <div className="settings-form-actions">
                                        <button
                                          type="button"
                                          className="secondary-action"
                                          disabled={!canConfigure || working}
                                          onClick={async () => {
                                            const nozzleNumber = normalizeNozzleNumber(nozzleDraft.nozzleNumber)
                                            if (!nozzleNumber) {
                                              setError("Nozzle code/label is required")
                                              return
                                            }
                                            const result = await runAction(() =>
                                              internalApi.createStationNozzle(stationPublicId, pump.public_id, {
                                                nozzleNumber,
                                                side: nozzleDraft.side || "A",
                                                fuelType: nozzleDraft.fuelType,
                                                tankPublicId: nozzleDraft.tankPublicId || undefined,
                                                status: nozzleDraft.status,
                                              })
                                            )
                                            if (result) {
                                              setNewNozzleByPump((prev) => {
                                                const next = { ...prev }
                                                delete next[pump.public_id]
                                                return next
                                              })
                                            }
                                          }}
                                        >
                                          Save Nozzle
                                        </button>
                                        <button
                                          type="button"
                                          className="secondary-action"
                                          disabled={!canConfigure || working}
                                          onClick={() =>
                                            setNewNozzleByPump((prev) => {
                                              const next = { ...prev }
                                              delete next[pump.public_id]
                                              return next
                                            })
                                          }
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  </article>
                                ) : null}
                              </div>
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
	        </div>
	      </div>
	    </div>
      {managerDetailOpen && selectedExistingManager ? (
        <ExistingManagerDetailModal
          manager={selectedExistingManager}
          onClose={() => setManagerDetailOpen(false)}
        />
      ) : null}
        <CursorActionMenu menu={staffContextMenu} onClose={() => setStaffContextMenu(null)} />
	      <StationAccessModal notice={credentialNotice} onClose={() => setCredentialNotice(null)} />
        <PumpQrModal
          pump={activePumpQr}
          stationPublicId={stationPublicId}
          onClose={() => setActivePumpQr(null)}
          onCopy={handleCopyPumpQr}
          onPrint={openPumpQrPrintView}
        />
	    </>
	  )
}

export default function StationsPage() {
  const { hasPermission, session } = useInternalAuth()
  const { refreshRequests, openRequest } = useInternalApprovalRequests()
  const [data, setData] = useState(null)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [setupMode, setSetupMode] = useState("")
  const [selectedStationPublicId, setSelectedStationPublicId] = useState("")

  async function load() {
    setData(await internalApi.getStations())
  }

  useEffect(() => {
    load().catch((err) => setError(err?.message || "Failed to load stations"))
  }, [])

  async function toggleActivation(stationPublicId, current) {
    try {
      setError("")
      const result = await internalApi.patchStationActivation(stationPublicId, !current)
      await load()
      if (result?.approvalRequired && result?.requestPublicId) {
        await refreshRequests()
        openRequest(result.requestPublicId)
      }
    } catch (err) {
      setError(err?.message || "Failed to update station")
    }
  }

  async function requestDeletion(stationPublicId) {
    try {
      setError("")
      const result = await internalApi.requestStationDeletion(stationPublicId)
      await load()
      if (result?.approvalRequired && result?.requestPublicId) {
        await refreshRequests()
        openRequest(result.requestPublicId)
      }
    } catch (err) {
      setError(err?.message || "Failed to request station deletion")
    }
  }

  const rows = useMemo(() => {
    const items = data?.items || []
    if (!query.trim()) return items
    const needle = query.trim().toLowerCase()
    return items.filter((row) => `${row.name} ${row.operator_name} ${row.city} ${row.subscription_plan}`.toLowerCase().includes(needle))
  }, [data, query])
  const stationMetricColumns = useMemo(
    () => [
      { key: "public_id", label: "Station ID" },
      { key: "name", label: "Station" },
      { key: "operator_name", label: "Operator" },
      { key: "city", label: "City" },
      { key: "subscription_status", label: "Subscription", render: (row) => <StatusPill value={row.subscription_status} /> },
      { key: "onboarding_status", label: "Onboarding", render: (row) => <StatusPill value={row.onboarding_status} /> },
      { key: "last_transaction_at", label: "Last Transaction", render: (row) => formatDateTime(row.last_transaction_at) },
    ],
    []
  )
  const metricItems = useMemo(
    () => [
      {
        label: "Total Stations",
        value: formatNumber(data?.summary?.totalStations),
        drilldown: {
          title: "All Stations",
          subtitle: "Complete station registry in the current internal view.",
          rows: data?.items || [],
          columns: stationMetricColumns,
          emptyLabel: "No stations found.",
          minWidth: 980,
        },
      },
      {
        label: "Active",
        value: formatNumber(data?.summary?.activeStations),
        drilldown: {
          title: "Active Stations",
          subtitle: "Stations currently marked active.",
          rows: (data?.items || []).filter((row) => Number(row.is_active) === 1),
          columns: stationMetricColumns,
          emptyLabel: "No active stations found.",
          minWidth: 980,
        },
      },
      {
        label: "Inactive",
        value: formatNumber(data?.summary?.inactiveStations),
        drilldown: {
          title: "Inactive Stations",
          subtitle: "Stations currently marked inactive.",
          rows: (data?.items || []).filter((row) => Number(row.is_active) !== 1),
          columns: stationMetricColumns,
          emptyLabel: "No inactive stations found.",
          minWidth: 980,
        },
      },
      {
        label: "Overdue Subscriptions",
        value: formatNumber(data?.summary?.overdueSubscriptions),
        drilldown: {
          title: "Overdue Subscriptions",
          subtitle: "Stations whose subscriptions are overdue or in grace.",
          rows: (data?.items || []).filter((row) => ["OVERDUE", "GRACE"].includes(String(row.subscription_status || "").toUpperCase())),
          columns: stationMetricColumns,
          emptyLabel: "No overdue station subscriptions found.",
          minWidth: 980,
        },
      },
    ],
    [data, stationMetricColumns]
  )
  const isOnboardingManager = String(session?.profile?.primaryRole || "").toUpperCase() === "STATION_ONBOARDING_MANAGER"
  const isPlatformOwner = String(session?.profile?.primaryRole || "").toUpperCase() === "PLATFORM_OWNER"
  const canConfigureStations = hasPermission("stations:configure")

  return (
    <InternalShell title="Stations" alerts={error ? [{ id: "stations-error", type: "ERROR", title: "System Error", body: error }] : []}>
      <div className="page-toolbar">
        <input className="page-search" placeholder="Search station, operator, city, or plan" value={query} onChange={(event) => setQuery(event.target.value)} />
        {canConfigureStations ? (
          <button
            type="button"
            className="secondary-action"
            onClick={() => {
              setSelectedStationPublicId("")
              setSetupMode("create")
            }}
          >
            Create Station
          </button>
        ) : null}
      </div>

      <MetricGrid items={metricItems} />

      <PreviewTablePanel
        title="Station Registry"
        subtitle="Activation state, operator, pump footprint, and subscription state."
        previewLimit={8}
        modalTitle="All Stations"
        columns={[
          { key: "public_id", label: "Station ID" },
          { key: "name", label: "Station" },
          { key: "operator_name", label: "Operator" },
          { key: "city", label: "City" },
          { key: "subscription_status", label: "Subscription", render: (row) => <StatusPill value={row.subscription_status} /> },
          { key: "onboarding_status", label: "Onboarding", render: (row) => <StatusPill value={row.onboarding_status} /> },
          { key: "last_transaction_at", label: "Last Transaction", render: (row) => formatDateTime(row.last_transaction_at) },
          {
            key: "actions",
            label: "Actions",
            render: (row) => (
              <div className="inline-action-group inline-action-group--row">
                {canConfigureStations ? (
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => {
                      setSelectedStationPublicId(row.public_id)
                      setSetupMode("edit")
                    }}
                  >
                    Open
                  </button>
                ) : null}
                {hasPermission("stations:activate") ? (
                  <button type="button" className="secondary-action" onClick={() => toggleActivation(row.public_id, Number(row.is_active) === 1)}>
                    {Number(row.is_active)
                      ? isOnboardingManager
                        ? "Request deactivation"
                        : "Deactivate"
                      : "Activate"}
                  </button>
                ) : (
                  <StatusPill value={Number(row.is_active) ? "ACTIVE" : "OFFLINE"} />
                )}
                {isPlatformOwner ? (
                  <button type="button" className="secondary-action" onClick={() => requestDeletion(row.public_id)}>
                    Request delete
                  </button>
                ) : null}
              </div>
            ),
          },
        ]}
        rows={rows}
      />

      {setupMode ? (
        <StationSetupModal
          stationPublicId={selectedStationPublicId}
          mode={setupMode}
          canConfigure={canConfigureStations}
          onClose={() => {
            setSetupMode("")
            setSelectedStationPublicId("")
          }}
          onSaved={load}
        />
      ) : null}
    </InternalShell>
  )
}
