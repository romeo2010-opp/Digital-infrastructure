import { useEffect, useMemo, useState } from "react"
import { internalApi } from "../api/internalApi"
import InternalShell from "../components/InternalShell"
import PreviewTablePanel from "../components/PreviewTablePanel"
import MetricGrid from "../components/MetricGrid"
import StatusPill from "../components/StatusPill"
import { formatDateTime, formatNumber } from "../utils/display"
import { useInternalAuth } from "../auth/AuthContext"

function formatRoles(value) {
  if (Array.isArray(value)) return value.join(", ") || "No roles assigned"
  return value || "No roles assigned"
}

function parseRoleCodes(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean)
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function InternalUserModal({ draft, roles, saving, onClose, onChange, onSubmit }) {
  return (
    <div className="internal-modal-backdrop" role="dialog" aria-modal="true" aria-label="Create internal user" onClick={onClose}>
      <div className="internal-modal internal-modal--list admin-modal" onClick={(event) => event.stopPropagation()}>
        <header className="internal-modal-header">
          <div className="internal-modal-header-copy">
            <h3>Create Internal User</h3>
            <p>Create a new internal account and assign its initial role.</p>
          </div>
          <div className="internal-modal-header-actions">
            <button type="button" className="secondary-action internal-modal-close" onClick={onClose}>Close</button>
          </div>
        </header>
        <div className="internal-modal-body internal-modal-body--list">
          <div className="admin-form-grid">
            <label className="settings-form-field">
              <span>Full name</span>
              <input value={draft.fullName} onChange={(event) => onChange("fullName", event.target.value)} />
            </label>
            <label className="settings-form-field">
              <span>Email</span>
              <input type="email" value={draft.email} onChange={(event) => onChange("email", event.target.value)} />
            </label>
            <label className="settings-form-field">
              <span>Phone</span>
              <input value={draft.phone} onChange={(event) => onChange("phone", event.target.value)} placeholder="+265..." />
            </label>
            <label className="settings-form-field">
              <span>Initial role</span>
              <select value={draft.roleCode} onChange={(event) => onChange("roleCode", event.target.value)}>
                <option value="">Select role</option>
                {roles.map((role) => (
                  <option key={role.code} value={role.code}>{role.name}</option>
                ))}
              </select>
            </label>
            <label className="settings-form-field">
              <span>Temporary password</span>
              <input value={draft.password} onChange={(event) => onChange("password", event.target.value)} placeholder="Leave blank to auto-generate" />
            </label>
          </div>
          <div className="settings-form-actions">
            <button type="button" className="secondary-action" disabled={saving} onClick={onSubmit}>
              {saving ? "Creating..." : "Create user"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function TemporaryPasswordModal({ notice, onClose }) {
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
            <span>Email</span>
            <strong>{notice.email || "-"}</strong>
            <span>Temporary password</span>
            <code>{notice.temporaryPassword}</code>
          </div>
        </div>
      </div>
    </div>
  )
}

function StaffDetailModal({
  staff,
  roles,
  roleDraft,
  canManageStaff,
  canSuspendStaff,
  canForceSignOut,
  canLockAccount,
  canResetAccess,
  onRoleDraftChange,
  onAssignRole,
  onChangeRole,
  onRevokeRole,
  onSuspendToggle,
  onForceSignOut,
  onLockAccount,
  onResetAccess,
  onClose,
}) {
  useEffect(() => {
    if (!staff) return undefined

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
  }, [staff, onClose])

  if (!staff) return null

  const hasRoleDraft = Boolean(roleDraft)
  const canShowWorkflowActions = canSuspendStaff || canForceSignOut || canLockAccount || canResetAccess
  const assignedRoleCodes = parseRoleCodes(staff.roles)
  const roleNameByCode = new Map(roles.map((role) => [role.code, role.name]))

  return (
    <div className="internal-modal-backdrop" role="dialog" aria-modal="true" aria-label="Internal staff detail" onClick={onClose}>
      <div className="internal-modal internal-modal--list admin-modal" onClick={(event) => event.stopPropagation()}>
        <header className="internal-modal-header">
          <div className="internal-modal-header-copy">
            <h3>{staff.fullName}</h3>
            <p>{staff.email}</p>
          </div>
          <div className="internal-modal-header-actions">
            <StatusPill value={staff.status} />
            <span className="internal-modal-count">{staff.publicId}</span>
            <button type="button" className="secondary-action internal-modal-close" onClick={onClose}>Close</button>
          </div>
        </header>
        <div className="internal-modal-body internal-modal-body--list">
          <div className="settings-summary-list admin-detail-grid">
            <div><span>User ID</span><strong>{staff.publicId}</strong></div>
            <div><span>Roles</span><strong>{formatRoles(staff.roles)}</strong></div>
            <div><span>Phone</span><strong>{staff.phone || "-"}</strong></div>
            <div><span>Active sessions</span><strong>{formatNumber(staff.activeSessionCount)}</strong></div>
            <div><span>Last login</span><strong>{formatDateTime(staff.lastLoginAt)}</strong></div>
            <div><span>Status</span><strong>{staff.status}</strong></div>
          </div>

          <div className="admin-detail-block">
            <span>Role management</span>
            {canManageStaff ? (
              <>
                <div className="staff-role-list" aria-label="Assigned roles">
                  {assignedRoleCodes.length ? (
                    assignedRoleCodes.map((roleCode) => (
                      <div key={roleCode} className="staff-role-chip">
                        <strong>{roleNameByCode.get(roleCode) || roleCode}</strong>
                        <button type="button" className="staff-role-chip-remove" aria-label={`Remove ${roleCode}`} onClick={() => onRevokeRole(roleCode)}>
                          -
                        </button>
                      </div>
                    ))
                  ) : (
                    <strong>No roles assigned.</strong>
                  )}
                </div>
                <label className="settings-form-field">
                  <span>Add or change role</span>
                  <select value={roleDraft} onChange={(event) => onRoleDraftChange(event.target.value)}>
                    <option value="">Select role</option>
                    {roles.map((role) => (
                      <option key={role.code} value={role.code}>{role.name}</option>
                    ))}
                  </select>
                </label>
                <div className="inline-action-group inline-action-group--row">
                  <button type="button" className="secondary-action" disabled={!hasRoleDraft} onClick={onAssignRole}>
                    Assign
                  </button>
                  <button type="button" className="secondary-action" disabled={!hasRoleDraft} onClick={onChangeRole}>
                    Change
                  </button>
                </div>
              </>
            ) : (
              <strong>You do not have permission to manage staff roles.</strong>
            )}
          </div>

          <div className="admin-detail-block">
            <span>Account actions</span>
            {canShowWorkflowActions ? (
              <div className="inline-action-group inline-action-group--row">
                {canSuspendStaff && staff.status === "ACTIVE" ? (
                  <button type="button" className="secondary-action" onClick={onSuspendToggle}>
                    Suspend
                  </button>
                ) : null}
                {canSuspendStaff && staff.status !== "ACTIVE" ? (
                  <button type="button" className="secondary-action" onClick={onSuspendToggle}>
                    Reactivate
                  </button>
                ) : null}
                {canForceSignOut ? (
                  <button type="button" className="secondary-action" onClick={onForceSignOut}>
                    Sign out
                  </button>
                ) : null}
                {canLockAccount && staff.status === "ACTIVE" ? (
                  <button type="button" className="secondary-action" onClick={onLockAccount}>
                    Lock
                  </button>
                ) : null}
                {canResetAccess ? (
                  <button type="button" className="secondary-action" onClick={onResetAccess}>
                    Reset access
                  </button>
                ) : null}
              </div>
            ) : (
              <strong>No account actions are available for your role.</strong>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function StaffPage() {
  const { hasPermission } = useInternalAuth()
  const [data, setData] = useState({ items: [], roles: [], permissionMatrix: [], summary: {} })
  const [error, setError] = useState("")
  const [drafts, setDrafts] = useState({})
  const [selectedStaffId, setSelectedStaffId] = useState(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createSaving, setCreateSaving] = useState(false)
  const [createDraft, setCreateDraft] = useState({
    fullName: "",
    email: "",
    phone: "",
    roleCode: "",
    password: "",
  })
  const [credentialNotice, setCredentialNotice] = useState(null)

  async function load() {
    const payload = await internalApi.getStaff()
    setData(payload)
  }

  useEffect(() => {
    load().catch((err) => setError(err?.message || "Failed to load internal staff"))
  }, [])

  async function runAction(action, successHandler = null) {
    try {
      setError("")
      const result = await action()
      if (typeof successHandler === "function") successHandler(result)
      await load()
    } catch (err) {
      setError(err?.message || "Failed to update internal staff")
    }
  }

  function resolveDraftRole(userPublicId) {
    return String(drafts[userPublicId] || "").trim()
  }

  async function submitCreate() {
    setCreateSaving(true)
    try {
      const result = await internalApi.createInternalUser({
        fullName: createDraft.fullName,
        email: createDraft.email,
        phone: createDraft.phone.trim() ? createDraft.phone.trim() : null,
        roleCode: createDraft.roleCode,
        password: createDraft.password.trim() || undefined,
      })
      setCreateOpen(false)
      setCreateDraft({ fullName: "", email: "", phone: "", roleCode: "", password: "" })
      setCredentialNotice({
        title: "Internal user created",
        subtitle: "Share these credentials securely. The temporary password is only shown once here.",
        email: result.email,
        temporaryPassword: result.temporaryPassword,
      })
      await load()
    } catch (err) {
      setError(err?.message || "Failed to create internal user")
    } finally {
      setCreateSaving(false)
    }
  }

  const permissionRows = useMemo(
    () =>
      (data.permissionMatrix || []).map((row) => ({
        ...row,
        permissionsPreview: row.permissionCodes.join(", "),
      })),
    [data.permissionMatrix]
  )
  const selectedStaff = useMemo(
    () => (data.items || []).find((row) => row.publicId === selectedStaffId) || null,
    [data.items, selectedStaffId]
  )
  const staffMetricColumns = useMemo(
    () => [
      { key: "publicId", label: "User ID" },
      { key: "fullName", label: "Name" },
      { key: "email", label: "Email" },
      { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
      { key: "roles", label: "Roles", render: (row) => formatRoles(row.roles) },
      { key: "activeSessionCount", label: "Sessions", render: (row) => formatNumber(row.activeSessionCount) },
    ],
    []
  )
  const departmentSummaryRows = useMemo(() => {
    const counts = new Map()

    ;(data.items || []).forEach((row) => {
      const department = String(row.department || "").trim() || "Unassigned"
      counts.set(department, (counts.get(department) || 0) + 1)
    })

    return Array.from(counts.entries())
      .map(([departmentName, userCount]) => ({
        departmentName,
        userCount,
      }))
      .sort((left, right) => left.departmentName.localeCompare(right.departmentName))
  }, [data.items])

  const metricItems = useMemo(
    () => [
      {
        label: "Total Staff",
        value: formatNumber(data.summary?.totalStaff),
        drilldown: {
          title: "All Internal Staff",
          subtitle: "Complete internal staff directory for the current environment.",
          rows: data.items || [],
          columns: staffMetricColumns,
          emptyLabel: "No internal staff found.",
          minWidth: 860,
          onRowClick: (row) => setSelectedStaffId(row.publicId),
        },
      },
      {
        label: "Active",
        value: formatNumber(data.summary?.activeStaff),
        drilldown: {
          title: "Active Internal Staff",
          subtitle: "Currently active internal user accounts.",
          rows: (data.items || []).filter((row) => String(row.status || "").toUpperCase() === "ACTIVE"),
          columns: staffMetricColumns,
          emptyLabel: "No active internal staff found.",
          minWidth: 860,
          onRowClick: (row) => setSelectedStaffId(row.publicId),
        },
      },
      {
        label: "Suspended",
        value: formatNumber(data.summary?.suspendedStaff),
        drilldown: {
          title: "Suspended Internal Staff",
          subtitle: "Accounts currently suspended or otherwise not active.",
          rows: (data.items || []).filter((row) => String(row.status || "").toUpperCase() !== "ACTIVE"),
          columns: staffMetricColumns,
          emptyLabel: "No suspended internal staff found.",
          minWidth: 860,
          onRowClick: (row) => setSelectedStaffId(row.publicId),
        },
      },
      {
        label: "Departments",
        value: formatNumber(data.summary?.departments?.length),
        drilldown: {
          title: "Departments",
          subtitle: "Departments represented in the current staff directory with assigned user counts.",
          rows: departmentSummaryRows,
          columns: [
            { key: "departmentName", label: "Department" },
            { key: "userCount", label: "Users", render: (row) => formatNumber(row.userCount) },
          ],
          emptyLabel: "No departments available.",
          minWidth: 520,
          countLabel: `${formatNumber(departmentSummaryRows.length || 0)} department${Number(departmentSummaryRows.length || 0) === 1 ? "" : "s"}`,
        },
      },
    ],
    [data.items, data.summary?.activeStaff, data.summary?.departments, data.summary?.suspendedStaff, data.summary?.totalStaff, departmentSummaryRows, staffMetricColumns]
  )
  const canManageStaff = hasPermission("staff:manage")
  const canSuspendStaff = hasPermission("staff:suspend")
  const canForceSignOut = hasPermission("security:force_sign_out")
  const canLockAccount = hasPermission("security:lock_account")
  const canResetAccess = hasPermission("staff:reset_access")

  return (
    <InternalShell title="Internal Staff" alerts={error ? [{ id: "staff-error", type: "ERROR", title: "System Error", body: error }] : []}>
      <MetricGrid items={metricItems} />

      <PreviewTablePanel
        title="Internal Staff Directory"
        previewLimit={8}
        modalTitle="All Internal Staff"
        actions={
          hasPermission("staff:create") ? (
            <button type="button" className="secondary-action" onClick={() => setCreateOpen(true)}>
              Create user
            </button>
          ) : null
        }
        columns={[
          { key: "publicId", label: "User ID" },
          { key: "fullName", label: "Name" },
          { key: "email", label: "Email" },
          { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> },
          { key: "roles", label: "Roles" },
          { key: "activeSessionCount", label: "Sessions" },
          { key: "lastLoginAt", label: "Last Login", render: (row) => formatDateTime(row.lastLoginAt) },
        ]}
        rows={data.items || []}
        onRowClick={(row) => setSelectedStaffId(row.publicId)}
      />

      {hasPermission("permissions:view_matrix") ? (
        <PreviewTablePanel
          title="Permission Matrix"
          subtitle="Role-to-permission mapping for internal governance."
          previewLimit={6}
          modalTitle="Full Permission Matrix"
          columns={[
            { key: "name", label: "Role" },
            { key: "department", label: "Department" },
            { key: "permissionCount", label: "Permission Count" },
            { key: "permissionsPreview", label: "Permissions" },
          ]}
          rows={permissionRows}
        />
      ) : null}

      {createOpen ? (
        <InternalUserModal
          draft={createDraft}
          roles={data.roles || []}
          saving={createSaving}
          onClose={() => setCreateOpen(false)}
          onChange={(key, value) => setCreateDraft((prev) => ({ ...prev, [key]: value }))}
          onSubmit={submitCreate}
        />
      ) : null}

      <StaffDetailModal
        staff={selectedStaff}
        roles={data.roles || []}
        roleDraft={selectedStaff ? drafts[selectedStaff.publicId] || "" : ""}
        canManageStaff={canManageStaff}
        canSuspendStaff={canSuspendStaff}
        canForceSignOut={canForceSignOut}
        canLockAccount={canLockAccount}
        canResetAccess={canResetAccess}
        onRoleDraftChange={(value) => {
          if (!selectedStaff) return
          setDrafts((prev) => ({ ...prev, [selectedStaff.publicId]: value }))
        }}
        onAssignRole={() => selectedStaff && runAction(() => internalApi.assignRole(selectedStaff.publicId, resolveDraftRole(selectedStaff.publicId)))}
        onChangeRole={() => selectedStaff && runAction(() => internalApi.changeRole(selectedStaff.publicId, resolveDraftRole(selectedStaff.publicId)))}
        onRevokeRole={(roleCode) =>
          selectedStaff
            && runAction(() => internalApi.revokeRole(selectedStaff.publicId, String(roleCode || "").trim() || resolveDraftRole(selectedStaff.publicId)))
        }
        onSuspendToggle={() =>
          selectedStaff
            && runAction(() =>
              selectedStaff.status === "ACTIVE"
                ? internalApi.suspendInternalUser(selectedStaff.publicId)
                : internalApi.reactivateInternalUser(selectedStaff.publicId)
            )
        }
        onForceSignOut={() => selectedStaff && runAction(() => internalApi.forceSignOutInternalUser(selectedStaff.publicId))}
        onLockAccount={() => selectedStaff && runAction(() => internalApi.lockInternalAccount(selectedStaff.publicId))}
        onResetAccess={() =>
          selectedStaff
            && runAction(
              () => internalApi.resetInternalAccess(selectedStaff.publicId),
              (result) =>
                setCredentialNotice({
                  title: "Internal access reset",
                  subtitle: "Share the new temporary password securely. Existing sessions were revoked.",
                  email: selectedStaff.email,
                  temporaryPassword: result.temporaryPassword,
                })
            )
        }
        onClose={() => setSelectedStaffId(null)}
      />

      <TemporaryPasswordModal notice={credentialNotice} onClose={() => setCredentialNotice(null)} />
    </InternalShell>
  )
}
