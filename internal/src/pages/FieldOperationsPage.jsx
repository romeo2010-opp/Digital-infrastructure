import { useEffect, useMemo, useState } from "react"
import { internalApi } from "../api/internalApi"
import InternalShell from "../components/InternalShell"
import { Panel } from "../components/PanelTable"
import PreviewTablePanel from "../components/PreviewTablePanel"
import MetricGrid from "../components/MetricGrid"
import StatusPill from "../components/StatusPill"
import CursorActionMenu from "../components/CursorActionMenu"
import ExistingManagerDetailModal from "../components/ExistingManagerDetailModal"
import { formatDateTime, formatNumber } from "../utils/display"
import { createEmptyStaffDraft, formatManagerCandidateLabel } from "../utils/staffAssignment"
import { useInternalAuth } from "../auth/AuthContext"

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

function normalizeChecklistItems(value) {
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      const label = typeof item === "string" ? item : item?.label || item?.id || `Checklist item ${index + 1}`
      const status = typeof item === "object" && item?.status ? item.status : (item?.completed ? "COMPLETED" : "PENDING")
      return {
        id: item?.id || item?.key || `check-${index}`,
        label: String(label || "").replace(/_/g, " "),
        status,
      }
    })
  }

  if (value && typeof value === "object") {
    return Object.entries(value).map(([key, complete], index) => ({
      id: key || `check-${index}`,
      label: String(key || `Checklist item ${index + 1}`).replace(/_/g, " "),
      status: complete ? "COMPLETED" : "PENDING",
    }))
  }

  return []
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

function FieldSetupRequestModal({ onClose, onCreated }) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const [form, setForm] = useState({
    name: "",
    operatorName: "",
    countryCode: "MW",
    city: "",
    address: "",
    timezone: "Africa/Blantyre",
    open24h: false,
    openingTime: "06:00",
    closingTime: "22:00",
    note: "",
  })

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

  async function submit() {
    try {
      setWorking(true)
      setError("")
      await internalApi.createFieldSetupRequest(form)
      await onCreated()
      onClose()
    } catch (err) {
      setError(err?.message || "Failed to create station setup request")
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="internal-modal-backdrop" role="dialog" aria-modal="true" aria-label="Create station setup request" onClick={onClose}>
      <div className="internal-modal internal-modal--list admin-modal" onClick={(event) => event.stopPropagation()}>
        <header className="internal-modal-header">
          <div className="internal-modal-header-copy">
            <h3>Create Station Setup Request</h3>
            <p>Open a new field implementation record and schedule the first setup visit.</p>
          </div>
          <div className="internal-modal-header-actions">
            <button type="button" className="secondary-action internal-modal-close" onClick={onClose}>Close</button>
          </div>
        </header>
        <div className="internal-modal-body internal-modal-body--list">
          <div className="stack-grid">
            {error ? <p className="settings-error">{error}</p> : null}
            <div className="settings-form-card">
              <div className="settings-profile-grid">
                <label className="settings-form-field">
                  <span>Station name</span>
                  <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} disabled={working} />
                </label>
                <label className="settings-form-field">
                  <span>Operator</span>
                  <input value={form.operatorName} onChange={(event) => setForm((prev) => ({ ...prev, operatorName: event.target.value }))} disabled={working} />
                </label>
                <label className="settings-form-field">
                  <span>Country code</span>
                  <input value={form.countryCode} maxLength={2} onChange={(event) => setForm((prev) => ({ ...prev, countryCode: event.target.value.toUpperCase() }))} disabled={working} />
                </label>
                <label className="settings-form-field">
                  <span>City</span>
                  <input value={form.city} onChange={(event) => setForm((prev) => ({ ...prev, city: event.target.value }))} disabled={working} />
                </label>
                <label className="settings-form-field">
                  <span>Address</span>
                  <input value={form.address} onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))} disabled={working} />
                </label>
                <label className="settings-form-field">
                  <span>Timezone</span>
                  <input value={form.timezone} onChange={(event) => setForm((prev) => ({ ...prev, timezone: event.target.value }))} disabled={working} />
                </label>
                <label className="settings-form-field">
                  <span>Open 24 hours</span>
                  <select value={form.open24h ? "YES" : "NO"} onChange={(event) => setForm((prev) => ({ ...prev, open24h: event.target.value === "YES" }))} disabled={working}>
                    <option value="NO">No</option>
                    <option value="YES">Yes</option>
                  </select>
                </label>
                <label className="settings-form-field">
                  <span>Opening time</span>
                  <input type="time" value={form.open24h ? "00:00" : form.openingTime} onChange={(event) => setForm((prev) => ({ ...prev, openingTime: event.target.value }))} disabled={working || form.open24h} />
                </label>
                <label className="settings-form-field">
                  <span>Closing time</span>
                  <input type="time" value={form.open24h ? "23:59" : form.closingTime} onChange={(event) => setForm((prev) => ({ ...prev, closingTime: event.target.value }))} disabled={working || form.open24h} />
                </label>
              </div>
            </div>
            <div className="settings-form-card">
              <label className="settings-form-field">
                <span>Initial field note</span>
                <textarea rows={4} value={form.note} onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))} disabled={working} />
              </label>
              <div className="settings-form-actions">
                <button type="button" className="secondary-action" disabled={working} onClick={submit}>
                  Create Setup Request
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function FieldVisitDetailModal({ visit, canManageField, onClose, onUpdated }) {
  const [setup, setSetup] = useState(null)
  const [loadingSetup, setLoadingSetup] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const [feedback, setFeedback] = useState("")
  const [credentialNotice, setCredentialNotice] = useState(null)
  const [workflowNote, setWorkflowNote] = useState("")
  const [evidenceUrl, setEvidenceUrl] = useState("")
  const [connectivityStatus, setConnectivityStatus] = useState("GOOD")
  const [staffDraft, setStaffDraft] = useState(createEmptyStaffDraft)
  const [editingStaffId, setEditingStaffId] = useState("")
  const [staffAssignmentMode, setStaffAssignmentMode] = useState("CREATE_NEW")
  const [managerSearch, setManagerSearch] = useState("")
  const [managerOptions, setManagerOptions] = useState([])
  const [loadingManagerOptions, setLoadingManagerOptions] = useState(false)
  const [managerDetailOpen, setManagerDetailOpen] = useState(false)
  const [staffContextMenu, setStaffContextMenu] = useState(null)
  const [newPump, setNewPump] = useState({
    pumpNumber: "1",
    quickSetup: "MALAWI_2_NOZZLES",
    status: "ACTIVE",
    statusReason: "",
  })
  const [pumpDrafts, setPumpDrafts] = useState({})
  const [newNozzleByPump, setNewNozzleByPump] = useState({})
  const [nozzleDrafts, setNozzleDrafts] = useState({})

  function updateNozzleDraft(nozzlePublicId, field, value) {
    setNozzleDrafts((prev) => ({
      ...prev,
      [nozzlePublicId]: {
        ...(prev[nozzlePublicId] || {}),
        [field]: value,
      },
    }))
  }

  async function loadSetup() {
    if (!visit?.stationPublicId) {
      setSetup(null)
      return
    }

    try {
      setLoadingSetup(true)
      const next = await internalApi.getFieldStationSetup(visit.stationPublicId)
      setSetup(next)
    } catch (err) {
      setError(err?.message || "Failed to load limited station setup")
    } finally {
      setLoadingSetup(false)
    }
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

  useEffect(() => {
    setError("")
    setFeedback("")
    setWorkflowNote("")
    setEvidenceUrl("")
    resetStaffForm()
    setStaffContextMenu(null)
    setPumpDrafts({})
    setNozzleDrafts({})
    setNewNozzleByPump({})
    loadSetup()
  }, [visit?.publicId])

  function resetStaffForm() {
    setStaffDraft(createEmptyStaffDraft())
    setEditingStaffId("")
    setStaffAssignmentMode("CREATE_NEW")
    setManagerSearch("")
    setManagerOptions([])
    setManagerDetailOpen(false)
  }

  async function loadManagerCandidates(search = "") {
    if (!visit?.stationPublicId) return
    try {
      setLoadingManagerOptions(true)
      const result = await internalApi.searchFieldStationManagerCandidates(visit.stationPublicId, { q: search, limit: 12 })
      setManagerOptions(result?.items || [])
    } catch (err) {
      setError(err?.message || "Failed to load existing station managers")
    } finally {
      setLoadingManagerOptions(false)
    }
  }

  useEffect(() => {
    if (!visit?.stationPublicId || editingStaffId || staffAssignmentMode !== "EXISTING_MANAGER") return
    loadManagerCandidates(managerSearch)
  }, [visit?.stationPublicId, editingStaffId, staffAssignmentMode])

  async function handleVisitAction(action, overrides = {}) {
    try {
      setWorking(true)
      setError("")
      setFeedback("")
      await internalApi.updateFieldVisitWorkflow(visit.publicId, {
        action,
        note: overrides.note ?? workflowNote,
        evidenceUrl: overrides.evidenceUrl ?? evidenceUrl,
        connectivityStatus: overrides.connectivityStatus ?? connectivityStatus,
      })
      setWorkflowNote("")
      setEvidenceUrl("")
      await onUpdated()
      await loadSetup()
      setFeedback("Field workflow updated.")
    } catch (err) {
      setError(err?.message || "Failed to update field workflow")
    } finally {
      setWorking(false)
    }
  }

  async function handleAssignStaff() {
    if (!visit?.stationPublicId) return
    try {
      setWorking(true)
      setError("")
      setFeedback("")
      const result = editingStaffId
        ? await internalApi.patchFieldStationStaff(visit.stationPublicId, editingStaffId, staffDraft)
        : staffAssignmentMode === "EXISTING_MANAGER"
          ? await internalApi.assignFieldStationStaff(visit.stationPublicId, {
              existingUserPublicId: staffDraft.existingUserPublicId,
              roleCode: "MANAGER",
            })
          : await internalApi.assignFieldStationStaff(visit.stationPublicId, staffDraft)
      if (result?.credential) setCredentialNotice(result.credential)
      resetStaffForm()
      await onUpdated()
      await loadSetup()
      setFeedback(editingStaffId ? "Station staff updated." : staffAssignmentMode === "EXISTING_MANAGER" ? "Existing station manager assigned." : "Station staff registered.")
    } catch (err) {
      setError(err?.message || "Failed to update station staff")
    } finally {
      setWorking(false)
    }
  }

  async function handleResetStaffAccess(member) {
    if (!visit?.stationPublicId) return
    try {
      setWorking(true)
      setError("")
      setFeedback("")
      const result = await internalApi.resetFieldStationStaffAccess(visit.stationPublicId, member.id)
      if (result?.credential) setCredentialNotice(result.credential)
      await onUpdated()
      await loadSetup()
      setFeedback("One-time password generated.")
    } catch (err) {
      setError(err?.message || "Failed to reset staff access")
    } finally {
      setWorking(false)
    }
  }

  async function handleDeleteStaff(member) {
    if (!visit?.stationPublicId) return
    if (!window.confirm(`Remove ${member.full_name || "this staff member"} from the station?`)) return

    try {
      setWorking(true)
      setError("")
      setFeedback("")
      await internalApi.deleteFieldStationStaff(visit.stationPublicId, member.id)
      if (String(editingStaffId) === String(member.id)) {
        resetStaffForm()
      }
      await onUpdated()
      await loadSetup()
      setFeedback("Station staff removed.")
    } catch (err) {
      setError(err?.message || "Failed to remove station staff")
    } finally {
      setWorking(false)
    }
  }

  function openStaffContextMenu(event, member) {
    event.preventDefault()
    if (!canManageField || working) return
    setStaffContextMenu({
      x: event.clientX,
      y: event.clientY,
      member,
      title: member.full_name || member.email || member.phone_e164 || "Staff actions",
      items: [
        {
          id: "otp",
          label: "One-time password",
          onSelect: () => handleResetStaffAccess(member),
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
          onSelect: () => handleDeleteStaff(member),
        },
      ],
    })
  }

  async function handleCreatePump() {
    if (!visit?.stationPublicId) return
    const pumpNumber = parsePositiveInteger(newPump.pumpNumber)
    if (!pumpNumber) {
      setError("Pump number must be a positive integer")
      return
    }
    try {
      setWorking(true)
      setError("")
      setFeedback("")
      await internalApi.createFieldStationPump(visit.stationPublicId, {
        pumpNumber,
        quickSetup: newPump.quickSetup,
        status: newPump.status,
        statusReason: newPump.statusReason || undefined,
      })
      setNewPump({
        pumpNumber: String(pumpNumber + 1),
        quickSetup: "MALAWI_2_NOZZLES",
        status: "ACTIVE",
        statusReason: "",
      })
      await onUpdated()
      await loadSetup()
      setFeedback("Pump registered.")
    } catch (err) {
      setError(err?.message || "Failed to register pump")
    } finally {
      setWorking(false)
    }
  }

  async function handlePatchPump(pump) {
    if (!visit?.stationPublicId) return
    const draft = pumpDrafts[pump.public_id] || {}
    const pumpNumber = parsePositiveInteger(draft.pump_number ?? pump.pump_number)
    if (!pumpNumber) {
      setError("Pump number must be a positive integer")
      return
    }
    try {
      setWorking(true)
      setError("")
      setFeedback("")
      await internalApi.patchFieldStationPump(visit.stationPublicId, pump.public_id, {
        pumpNumber,
        status: draft.status || pump.status || "ACTIVE",
      })
      setPumpDrafts((prev) => {
        const next = { ...prev }
        delete next[pump.public_id]
        return next
      })
      await onUpdated()
      await loadSetup()
      setFeedback("Pump metadata updated.")
    } catch (err) {
      setError(err?.message || "Failed to update pump")
    } finally {
      setWorking(false)
    }
  }

  async function handleCreateNozzle(pump) {
    if (!visit?.stationPublicId) return
    const draft = newNozzleByPump[pump.public_id] || createNozzleDraft(pump)
    const nozzleNumber = normalizeNozzleNumber(draft.nozzleNumber)
    if (!nozzleNumber) {
      setError("Nozzle code/label is required")
      return
    }
    try {
      setWorking(true)
      setError("")
      setFeedback("")
      await internalApi.createFieldStationNozzle(visit.stationPublicId, pump.public_id, {
        nozzleNumber,
        side: draft.side || "A",
        fuelType: draft.fuelType,
        tankPublicId: draft.tankPublicId || undefined,
        status: draft.status,
        hardwareChannel: draft.hardwareChannel || undefined,
      })
      setNewNozzleByPump((prev) => {
        const next = { ...prev }
        delete next[pump.public_id]
        return next
      })
      await onUpdated()
      await loadSetup()
      setFeedback("Nozzle registered.")
    } catch (err) {
      setError(err?.message || "Failed to register nozzle")
    } finally {
      setWorking(false)
    }
  }

  async function handlePatchNozzle(nozzle) {
    if (!visit?.stationPublicId) return
    const draft = nozzleDrafts[nozzle.public_id] || {}
    const payload = {}
    const nozzleNumber = normalizeNozzleNumber(draft.nozzle_number ?? nozzle.nozzle_number)
    const currentNozzleNumber = String(nozzle.nozzle_number || "").trim()
    if (Object.prototype.hasOwnProperty.call(draft, "nozzle_number") && nozzleNumber !== currentNozzleNumber) {
      if (!nozzleNumber) {
        setError("Nozzle code/label is required")
        return
      }
      payload.nozzleNumber = nozzleNumber
    }
    if (Object.prototype.hasOwnProperty.call(draft, "status") && draft.status !== nozzle.status) payload.status = draft.status
    if (Object.prototype.hasOwnProperty.call(draft, "fuel_code") && draft.fuel_code !== nozzle.fuel_code) payload.fuelType = draft.fuel_code
    if (Object.prototype.hasOwnProperty.call(draft, "tank_public_id") && (draft.tank_public_id || null) !== (nozzle.tank_public_id || null)) {
      payload.tankPublicId = draft.tank_public_id || null
    }
    if (Object.prototype.hasOwnProperty.call(draft, "hardware_channel") && (draft.hardware_channel || null) !== (nozzle.hardware_channel || null)) {
      payload.hardwareChannel = draft.hardware_channel || null
    }
    if (!Object.keys(payload).length) {
      setFeedback("No nozzle changes to save.")
      return
    }
    try {
      setWorking(true)
      setError("")
      setFeedback("")
      await internalApi.patchFieldStationNozzle(visit.stationPublicId, nozzle.public_id, payload)
      setNozzleDrafts((prev) => {
        const next = { ...prev }
        delete next[nozzle.public_id]
        return next
      })
      await onUpdated()
      await loadSetup()
      setFeedback("Nozzle metadata updated.")
    } catch (err) {
      setError(err?.message || "Failed to update nozzle")
    } finally {
      setWorking(false)
    }
  }

  if (!visit) return null

  const checklistItems = normalizeChecklistItems(setup?.onboarding?.checklistItems)
  const staff = setup?.staff || []
  const pumps = setup?.pumps || []
  const tanks = setup?.tanks || []
  const selectedExistingManager = managerOptions.find((candidate) => candidate.userPublicId === staffDraft.existingUserPublicId) || null
  const staffSubmitDisabled =
    !canManageField ||
    working ||
    (!editingStaffId &&
      staffAssignmentMode === "EXISTING_MANAGER" &&
      (!staffDraft.existingUserPublicId || Boolean(selectedExistingManager?.alreadyAssignedToStation)))

  return (
    <>
      <div className="internal-modal-backdrop" role="dialog" aria-modal="true" aria-label="Field visit detail" onClick={onClose}>
        <div className="internal-modal admin-modal" onClick={(event) => event.stopPropagation()}>
          <header className="internal-modal-header">
            <div className="internal-modal-header-copy">
              <h3>{visit.stationName}</h3>
              <p>Field visit workflow, verification evidence, and limited operational setup controls.</p>
            </div>
            <div className="internal-modal-header-actions">
              <StatusPill value={visit.status} />
              {visit.onboardingStatus ? <StatusPill value={visit.onboardingStatus} /> : null}
              <button type="button" className="secondary-action internal-modal-close" onClick={onClose}>Close</button>
            </div>
          </header>
          <div className="internal-modal-body">
            <div className="stack-grid">
              {error ? <p className="settings-error">{error}</p> : null}
              {feedback ? <p className="settings-inline-feedback">{feedback}</p> : null}

              <div className="settings-form-card">
                <div className="settings-summary-list admin-detail-grid">
                  <div><span>Visit type</span><strong>{visit.visitType}</strong></div>
                  <div><span>Assigned agent</span><strong>{visit.assignedAgent || "Unassigned"}</strong></div>
                  <div><span>Region</span><strong>{visit.region}</strong></div>
                  <div><span>Scheduled</span><strong>{formatDateTime(visit.scheduledFor)}</strong></div>
                  <div><span>Completed</span><strong>{formatDateTime(visit.completedAt)}</strong></div>
                  <div><span>Evidence</span><strong>{visit.evidenceUrl || "None uploaded"}</strong></div>
                </div>
                <div className="admin-detail-block">
                  <span>Current visit summary</span>
                  <strong>{visit.summary || "No summary yet."}</strong>
                </div>
                <div className="admin-detail-block">
                  <span>Latest notes</span>
                  <strong>{visit.notes || "No field notes recorded."}</strong>
                </div>
              </div>

              <div className="settings-form-card">
                <h4 style={{ margin: 0, color: "#1a314b" }}>Field workflow</h4>
                <div className="settings-profile-grid">
                  <label className="settings-form-field">
                    <span>Field note</span>
                    <textarea rows={4} value={workflowNote} onChange={(event) => setWorkflowNote(event.target.value)} disabled={!canManageField || working} />
                  </label>
                  <label className="settings-form-field">
                    <span>Evidence URL</span>
                    <input value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} disabled={!canManageField || working} />
                  </label>
                  <label className="settings-form-field">
                    <span>Connectivity status</span>
                    <select value={connectivityStatus} onChange={(event) => setConnectivityStatus(event.target.value)} disabled={!canManageField || working}>
                      <option value="GOOD">Good</option>
                      <option value="LIMITED">Limited</option>
                      <option value="OFFLINE">Offline</option>
                    </select>
                  </label>
                </div>
                <div className="inline-action-group inline-action-group--row">
                  {canManageField ? (
                    <>
                      <button type="button" className="secondary-action" disabled={working} onClick={() => handleVisitAction("START_VISIT")}>Start Visit</button>
                      <button type="button" className="secondary-action" disabled={working} onClick={() => handleVisitAction("SUBMIT_VISIT_REPORT")}>Submit Report</button>
                      <button type="button" className="secondary-action" disabled={working} onClick={() => handleVisitAction("UPLOAD_STATION_PHOTOS")}>Upload Photos</button>
                      <button type="button" className="secondary-action" disabled={working} onClick={() => handleVisitAction("UPLOAD_VERIFICATION_EVIDENCE")}>Upload Evidence</button>
                      <button type="button" className="secondary-action" disabled={working} onClick={() => handleVisitAction("ADD_FIELD_NOTES")}>Add Notes</button>
                      <button type="button" className="secondary-action" disabled={working} onClick={() => handleVisitAction("MARK_HARDWARE_INSTALLED")}>Hardware Installed</button>
                      <button type="button" className="secondary-action" disabled={working} onClick={() => handleVisitAction("MARK_HARDWARE_MISSING")}>Hardware Missing</button>
                      <button type="button" className="secondary-action" disabled={working} onClick={() => handleVisitAction("MARK_TRAINING_COMPLETED")}>Training Completed</button>
                      <button type="button" className="secondary-action" disabled={working} onClick={() => handleVisitAction("MARK_TRAINING_PENDING")}>Training Pending</button>
                      <button type="button" className="secondary-action" disabled={working} onClick={() => handleVisitAction("RECORD_CONNECTIVITY_STATUS")}>Record Connectivity</button>
                      <button type="button" className="secondary-action" disabled={working} onClick={() => handleVisitAction("REQUEST_FOLLOW_UP_VISIT")}>Request Follow-Up</button>
                      <button type="button" className="secondary-action" disabled={working} onClick={() => handleVisitAction("ESCALATE_ONBOARDING_ISSUE")}>Escalate Issue</button>
                      <button type="button" className="secondary-action" disabled={working} onClick={() => handleVisitAction("MARK_VISIT_COMPLETED")}>Mark Completed</button>
                      <button type="button" className="secondary-action" disabled={working} onClick={() => handleVisitAction("MARK_VISIT_FAILED")}>Mark Failed</button>
                    </>
                  ) : (
                    <strong>No field workflow actions available for your role.</strong>
                  )}
                </div>
              </div>

              <div className="settings-form-card">
                <h4 style={{ margin: 0, color: "#1a314b" }}>Onboarding checklist</h4>
                {checklistItems.length ? (
                  <div className="timeline-list">
                    {checklistItems.map((item) => (
                      <article key={item.id} className="timeline-item">
                        <div>
                          <strong>{item.label}</strong>
                        </div>
                        <div className="timeline-meta">
                          <StatusPill value={item.status} />
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <strong>{loadingSetup ? "Loading checklist..." : "No onboarding checklist linked to this visit."}</strong>
                )}
              </div>

              {visit.stationPublicId ? (
                <>
                  <div className="settings-form-card">
                    <h4 style={{ margin: 0, color: "#1a314b" }}>Station staff registration</h4>
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
                            disabled={!canManageField || working}
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
                              disabled={!canManageField || working}
                            />
                          </label>
                          <div className="settings-form-field">
                            <span>Search</span>
                            <div className="settings-form-actions">
                              <button type="button" className="secondary-action" disabled={!canManageField || working || loadingManagerOptions} onClick={() => loadManagerCandidates(managerSearch)}>
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
                              disabled={!canManageField || working || loadingManagerOptions}
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
                        <span>Full name</span>
                        <input value={staffDraft.fullName} onChange={(event) => setStaffDraft((prev) => ({ ...prev, fullName: event.target.value }))} disabled={!canManageField || working} />
                      </label>
                      <label className="settings-form-field">
                        <span>Email</span>
                        <input value={staffDraft.email} onChange={(event) => setStaffDraft((prev) => ({ ...prev, email: event.target.value }))} disabled={!canManageField || working} />
                      </label>
                      <label className="settings-form-field">
                        <span>Phone</span>
                        <input value={staffDraft.phone} onChange={(event) => setStaffDraft((prev) => ({ ...prev, phone: event.target.value }))} disabled={!canManageField || working} />
                      </label>
                      <label className="settings-form-field">
                        <span>Role</span>
                        <select value={staffDraft.roleCode} onChange={(event) => setStaffDraft((prev) => ({ ...prev, roleCode: event.target.value }))} disabled={!canManageField || working}>
                          <option value="MANAGER">Station Manager</option>
                          <option value="ATTENDANT">Station Attendant</option>
                          <option value="VIEWER">Viewer</option>
                        </select>
                      </label>
                        </>
                      )}
                    </div>
                    <div className="settings-form-actions">
                      <button type="button" className="secondary-action" disabled={staffSubmitDisabled} onClick={handleAssignStaff}>
                        {editingStaffId ? "Save Staff Changes" : staffAssignmentMode === "EXISTING_MANAGER" ? "Assign Existing Manager" : "Register Staff"}
                      </button>
                      {editingStaffId ? (
                        <button
                          type="button"
                          className="secondary-action"
                          disabled={!canManageField || working}
                          onClick={resetStaffForm}
                        >
                          Cancel Edit
                        </button>
                      ) : null}
                    </div>
                    {!editingStaffId && staffAssignmentMode === "EXISTING_MANAGER" && selectedExistingManager?.alreadyAssignedToStation ? (
                      <p className="staff-edit-hint">This manager is already assigned to the selected station.</p>
                    ) : null}
                    {editingStaffId ? <p className="staff-edit-hint">Editing selected staff member. Right-click another staff row to switch actions.</p> : null}
                    {staff.length ? (
                      <div className="timeline-list">
                        {staff.map((member) => (
                          <article
                            key={member.id || member.user_public_id || member.user_id}
                            className="timeline-item interactive-staff-card"
                            onContextMenu={(event) => openStaffContextMenu(event, member)}
                            title="Right-click for staff actions"
                          >
                            <div>
                              <strong>{member.full_name}</strong>
                              <p>{member.role_name || member.role_code || member.role}</p>
                            </div>
                            <div className="timeline-meta">
                              <span>{member.email || member.phone_e164 || "No login identifier"}</span>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="settings-form-card">
                    <h4 style={{ margin: 0, color: "#1a314b" }}>Pump registration</h4>
                    <div className="settings-profile-grid">
                      <label className="settings-form-field">
                        <span>Pump number</span>
                        <input type="number" min="1" step="1" value={newPump.pumpNumber} onChange={(event) => setNewPump((prev) => ({ ...prev, pumpNumber: event.target.value }))} disabled={!canManageField || working} />
                      </label>
                      <label className="settings-form-field">
                        <span>Quick setup</span>
                        <select value={newPump.quickSetup} onChange={(event) => setNewPump((prev) => ({ ...prev, quickSetup: event.target.value }))} disabled={!canManageField || working}>
                          <option value="MALAWI_2_NOZZLES">Malawi 2 nozzles</option>
                          <option value="MALAWI_4_NOZZLES">Malawi 4 nozzles</option>
                        </select>
                      </label>
                      <label className="settings-form-field">
                        <span>Status</span>
                        <select value={newPump.status} onChange={(event) => setNewPump((prev) => ({ ...prev, status: event.target.value }))} disabled={!canManageField || working}>
                          <option value="ACTIVE">Active</option>
                          <option value="PAUSED">Paused</option>
                          <option value="OFFLINE">Offline</option>
                          <option value="IDLE">Idle</option>
                        </select>
                      </label>
                      <label className="settings-form-field">
                        <span>Status reason</span>
                        <input value={newPump.statusReason} onChange={(event) => setNewPump((prev) => ({ ...prev, statusReason: event.target.value }))} disabled={!canManageField || working} />
                      </label>
                    </div>
                    <div className="settings-form-actions">
                      <button type="button" className="secondary-action" disabled={!canManageField || working} onClick={handleCreatePump}>
                        Register Pump
                      </button>
                    </div>
                    {loadingSetup ? <p>Loading station equipment...</p> : null}
                    {pumps.map((pump) => {
                      const pumpDraft = pumpDrafts[pump.public_id] || pump
                      const nozzleCreateDraft = newNozzleByPump[pump.public_id] || createNozzleDraft(pump)
                      return (
                        <article key={pump.public_id} className="settings-form-card field-visit-pump-card">
                          <div className="settings-form-actions">
                            <strong>Pump {pump.pump_number}</strong>
                            <StatusPill value={pump.status} />
                          </div>
                          <div className="settings-profile-grid">
                            <label className="settings-form-field">
                              <span>Pump number</span>
                              <input type="number" min="1" step="1" value={pumpDraft.pump_number || ""} onChange={(event) => setPumpDrafts((prev) => ({ ...prev, [pump.public_id]: { ...pumpDraft, pump_number: event.target.value } }))} disabled={!canManageField || working} />
                            </label>
                            <label className="settings-form-field">
                              <span>Status</span>
                              <select value={pumpDraft.status || "ACTIVE"} onChange={(event) => setPumpDrafts((prev) => ({ ...prev, [pump.public_id]: { ...pumpDraft, status: event.target.value } }))} disabled={!canManageField || working}>
                                <option value="ACTIVE">Active</option>
                                <option value="PAUSED">Paused</option>
                                <option value="OFFLINE">Offline</option>
                                <option value="IDLE">Idle</option>
                              </select>
                            </label>
                          </div>
                          <div className="settings-form-actions">
                            <button type="button" className="secondary-action" disabled={!canManageField || working} onClick={() => handlePatchPump(pump)}>
                              Edit Pump Metadata
                            </button>
                          </div>
                          <div className="timeline-list">
                            {(pump.nozzles || []).map((nozzle) => {
                              const nozzleDraft = { ...nozzle, ...(nozzleDrafts[nozzle.public_id] || {}) }
                              return (
                                <article key={nozzle.public_id} className="timeline-item timeline-item--stacked">
                                  <div className="settings-profile-grid">
                                    <label className="settings-form-field">
                                      <span>Nozzle Code / Label</span>
                                      <input value={nozzleDraft.nozzle_number || ""} onChange={(event) => updateNozzleDraft(nozzle.public_id, "nozzle_number", event.target.value)} disabled={!canManageField || working} />
                                    </label>
                                    <label className="settings-form-field">
                                      <span>Status</span>
                                      <select value={nozzleDraft.status || "ACTIVE"} onChange={(event) => updateNozzleDraft(nozzle.public_id, "status", event.target.value)} disabled={!canManageField || working}>
                                        <option value="ACTIVE">Active</option>
                                        <option value="PAUSED">Paused</option>
                                        <option value="OFFLINE">Offline</option>
                                        <option value="DISPENSING">Dispensing</option>
                                      </select>
                                    </label>
                                    <label className="settings-form-field">
                                      <span>Fuel type</span>
                                      <select value={nozzleDraft.fuel_code || "PETROL"} onChange={(event) => updateNozzleDraft(nozzle.public_id, "fuel_code", event.target.value)} disabled={!canManageField || working}>
                                        <option value="PETROL">Petrol</option>
                                        <option value="DIESEL">Diesel</option>
                                      </select>
                                    </label>
                                    <label className="settings-form-field">
                                      <span>Tank</span>
                                      <select value={nozzleDraft.tank_public_id || ""} onChange={(event) => updateNozzleDraft(nozzle.public_id, "tank_public_id", event.target.value)} disabled={!canManageField || working}>
                                        <option value="">Unassigned</option>
                                        {tanks.map((tank) => (
                                          <option key={tank.public_id} value={tank.public_id}>
                                            {tank.name} ({tank.fuel_type})
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label className="settings-form-field">
                                      <span>Hardware channel</span>
                                      <input value={nozzleDraft.hardware_channel || ""} onChange={(event) => updateNozzleDraft(nozzle.public_id, "hardware_channel", event.target.value)} disabled={!canManageField || working} />
                                    </label>
                                  </div>
                                  <div className="settings-form-actions">
                                    <button type="button" className="secondary-action" disabled={!canManageField || working} onClick={() => handlePatchNozzle(nozzle)}>
                                      Edit Nozzle Metadata
                                    </button>
                                  </div>
                                </article>
                              )
                            })}
                          </div>
                          <div className="settings-profile-grid">
                            <label className="settings-form-field">
                              <span>New nozzle code / label</span>
                              <input value={nozzleCreateDraft.nozzleNumber} onChange={(event) => setNewNozzleByPump((prev) => ({ ...prev, [pump.public_id]: { ...nozzleCreateDraft, nozzleNumber: event.target.value } }))} disabled={!canManageField || working} />
                            </label>
                            <label className="settings-form-field">
                              <span>Side</span>
                              <select value={nozzleCreateDraft.side || "A"} onChange={(event) => setNewNozzleByPump((prev) => ({ ...prev, [pump.public_id]: { ...nozzleCreateDraft, side: event.target.value } }))} disabled={!canManageField || working}>
                                <option value="A">A</option>
                                <option value="B">B</option>
                              </select>
                            </label>
                            <label className="settings-form-field">
                              <span>Fuel type</span>
                              <select value={nozzleCreateDraft.fuelType} onChange={(event) => setNewNozzleByPump((prev) => ({ ...prev, [pump.public_id]: { ...nozzleCreateDraft, fuelType: event.target.value } }))} disabled={!canManageField || working}>
                                <option value="PETROL">Petrol</option>
                                <option value="DIESEL">Diesel</option>
                              </select>
                            </label>
                            <label className="settings-form-field">
                              <span>Tank</span>
                              <select value={nozzleCreateDraft.tankPublicId || ""} onChange={(event) => setNewNozzleByPump((prev) => ({ ...prev, [pump.public_id]: { ...nozzleCreateDraft, tankPublicId: event.target.value } }))} disabled={!canManageField || working}>
                                <option value="">Unassigned</option>
                                {tanks.map((tank) => (
                                  <option key={tank.public_id} value={tank.public_id}>
                                    {tank.name} ({tank.fuel_type})
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="settings-form-field">
                              <span>Hardware channel</span>
                              <input value={nozzleCreateDraft.hardwareChannel || ""} onChange={(event) => setNewNozzleByPump((prev) => ({ ...prev, [pump.public_id]: { ...nozzleCreateDraft, hardwareChannel: event.target.value } }))} disabled={!canManageField || working} />
                            </label>
                          </div>
                          <div className="settings-form-actions">
                            <button type="button" className="secondary-action" disabled={!canManageField || working} onClick={() => handleCreateNozzle(pump)}>
                              Register Nozzle
                            </button>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {managerDetailOpen && selectedExistingManager ? (
        <ExistingManagerDetailModal
          manager={selectedExistingManager}
          onClose={() => setManagerDetailOpen(false)}
        />
      ) : null}

      {credentialNotice ? (
        <div className="internal-modal-backdrop" role="dialog" aria-modal="true" aria-label="Station access issued" onClick={() => setCredentialNotice(null)}>
          <div className="internal-modal internal-modal--list admin-modal admin-modal--narrow" onClick={(event) => event.stopPropagation()}>
            <header className="internal-modal-header">
              <div className="internal-modal-header-copy">
                <h3>Station access issued</h3>
                <p>Share these one-time credentials with the station user.</p>
              </div>
              <div className="internal-modal-header-actions">
                <button type="button" className="secondary-action internal-modal-close" onClick={() => setCredentialNotice(null)}>Close</button>
              </div>
            </header>
            <div className="internal-modal-body internal-modal-body--list">
              <div className="admin-secret-card">
                <span>Person</span>
                <strong>{credentialNotice.fullName || "-"}</strong>
                <span>Login</span>
                <strong>{credentialNotice.loginIdentifier || "-"}</strong>
                <span>Temporary password</span>
                <code>{credentialNotice.temporaryPassword}</code>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <CursorActionMenu menu={staffContextMenu} onClose={() => setStaffContextMenu(null)} />
    </>
  )
}

export default function FieldOperationsPage() {
  const { hasPermission } = useInternalAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [selectedVisitId, setSelectedVisitId] = useState(null)
  const [isCreateRequestOpen, setIsCreateRequestOpen] = useState(false)

  const canManageField = hasPermission("field:manage")

  async function load() {
    setData(await internalApi.getFieldOperations())
  }

  useEffect(() => {
    load().catch((err) => setError(err?.message || "Failed to load field operations"))
  }, [])

  const rows = useMemo(() => {
    const items = data?.items || []
    if (!query.trim()) return items
    const needle = query.toLowerCase()
    return items.filter((row) =>
      `${row.stationName} ${row.assignedAgent} ${row.visitType} ${row.status} ${row.city}`.toLowerCase().includes(needle)
    )
  }, [data, query])

  const selectedVisit = useMemo(
    () => (data?.items || []).find((row) => row.publicId === selectedVisitId) || null,
    [data?.items, selectedVisitId]
  )
  const fieldVisitMetricColumns = useMemo(
    () => [
      { key: "stationName", label: "Station" },
      { key: "visitType", label: "Visit Type" },
      { key: "assignedAgent", label: "Assigned Agent" },
      { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
      { key: "onboardingStatus", label: "Onboarding", render: (row) => row.onboardingStatus ? <StatusPill value={row.onboardingStatus} /> : "-" },
      { key: "scheduledFor", label: "Scheduled", render: (row) => formatDateTime(row.scheduledFor) },
    ],
    []
  )
  const metricItems = useMemo(
    () => [
      {
        label: "Scheduled",
        value: formatNumber(data?.summary?.scheduled),
        drilldown: {
          title: "Scheduled Field Visits",
          subtitle: "Field work that has been scheduled but not yet started.",
          rows: (data?.items || []).filter((row) => row.status === "SCHEDULED"),
          columns: fieldVisitMetricColumns,
          emptyLabel: "No scheduled field visits.",
          minWidth: 860,
        },
      },
      {
        label: "In Progress",
        value: formatNumber(data?.summary?.inProgress),
        drilldown: {
          title: "Field Visits In Progress",
          subtitle: "Field visits actively being worked right now.",
          rows: (data?.items || []).filter((row) => row.status === "IN_PROGRESS"),
          columns: fieldVisitMetricColumns,
          emptyLabel: "No field visits are in progress.",
          minWidth: 860,
        },
      },
      {
        label: "Blocked",
        value: formatNumber(data?.summary?.blocked),
        drilldown: {
          title: "Blocked Field Visits",
          subtitle: "Visits currently blocked and needing intervention.",
          rows: (data?.items || []).filter((row) => row.status === "BLOCKED"),
          columns: fieldVisitMetricColumns,
          emptyLabel: "No blocked field visits.",
          minWidth: 860,
        },
      },
      {
        label: "Completed",
        value: formatNumber(data?.summary?.completed),
        drilldown: {
          title: "Completed Field Visits",
          subtitle: "Recently completed field visits and setup work.",
          rows: (data?.items || []).filter((row) => row.status === "COMPLETED"),
          columns: fieldVisitMetricColumns,
          emptyLabel: "No completed field visits.",
          minWidth: 860,
        },
      },
    ],
    [data, fieldVisitMetricColumns]
  )

  return (
    <InternalShell title="Field Operations" alerts={error ? [{ id: "field-error", type: "ERROR", title: "System Error", body: error }] : []}>
      <div className="page-toolbar">
        <input className="page-search" placeholder="Search station, city, agent, or visit type" value={query} onChange={(event) => setQuery(event.target.value)} />
        {canManageField ? (
          <button type="button" className="secondary-action" onClick={() => setIsCreateRequestOpen(true)}>
            Create Station Setup Request
          </button>
        ) : null}
      </div>

      <MetricGrid items={metricItems} />

      <div className="internal-page-grid internal-page-grid--two-thirds">
        <PreviewTablePanel
          title="Field Visits"
          subtitle="On-site onboarding work, field evidence, and operational setup progress."
          previewLimit={8}
          modalTitle="All Field Visits"
          columns={[
            {
              key: "stationName",
              label: "Station",
              render: (row) => (
                <button type="button" className="secondary-action" onClick={() => setSelectedVisitId(row.publicId)}>
                  {row.stationName}
                </button>
              ),
            },
            { key: "visitType", label: "Visit Type" },
            { key: "assignedAgent", label: "Assigned Agent" },
            { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
            { key: "onboardingStatus", label: "Onboarding", render: (row) => row.onboardingStatus ? <StatusPill value={row.onboardingStatus} /> : "-" },
            { key: "scheduledFor", label: "Scheduled", render: (row) => formatDateTime(row.scheduledFor) },
            {
              key: "actions",
              label: "Actions",
              render: (row) => (
                <div className="inline-action-group inline-action-group--row">
                  <button type="button" className="secondary-action" onClick={() => setSelectedVisitId(row.publicId)}>Open</button>
                  {canManageField && row.status === "SCHEDULED" ? (
                    <button type="button" className="secondary-action" onClick={async () => {
                      try {
                        setError("")
                        await internalApi.updateFieldVisitWorkflow(row.publicId, { action: "START_VISIT" })
                        await load()
                      } catch (err) {
                        setError(err?.message || "Failed to start field visit")
                      }
                    }}>
                      Start
                    </button>
                  ) : null}
                </div>
              ),
            },
          ]}
          rows={rows}
        />

        <div className="stack-grid">
          <Panel title="Delayed Visits">
            <div className="timeline-list">
              {(data?.delayedVisits || []).map((row) => (
                <article key={row.publicId} className="timeline-item">
                  <div>
                    <strong>{row.stationName}</strong>
                    <p>{row.summary || row.visitType}</p>
                  </div>
                  <div className="timeline-meta">
                    <StatusPill value={row.status} />
                    <button type="button" className="secondary-action" onClick={() => setSelectedVisitId(row.publicId)}>Open</button>
                  </div>
                </article>
              ))}
            </div>
          </Panel>

          <Panel title="Verification Uploads">
            <div className="timeline-list">
              {(data?.verificationUploads || []).map((row) => (
                <article key={row.publicId} className="timeline-item">
                  <div>
                    <strong>{row.stationName}</strong>
                    <p>{row.evidenceUrl}</p>
                  </div>
                  <div className="timeline-meta">
                    <StatusPill value={row.status} />
                    <span>{formatDateTime(row.completedAt || row.scheduledFor)}</span>
                  </div>
                </article>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {isCreateRequestOpen ? (
        <FieldSetupRequestModal
          onClose={() => setIsCreateRequestOpen(false)}
          onCreated={load}
        />
      ) : null}

      {selectedVisit ? (
        <FieldVisitDetailModal
          visit={selectedVisit}
          canManageField={canManageField}
          onClose={() => setSelectedVisitId(null)}
          onUpdated={load}
        />
      ) : null}
    </InternalShell>
  )
}
