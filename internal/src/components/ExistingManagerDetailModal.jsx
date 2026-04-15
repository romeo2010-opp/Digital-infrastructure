import { useEffect } from "react"

function formatManagerStations(manager) {
  if (!Array.isArray(manager?.managerStations) || !manager.managerStations.length) {
    return []
  }

  return manager.managerStations
    .map((station) => String(station?.stationName || "").trim())
    .filter(Boolean)
}

export default function ExistingManagerDetailModal({ manager, onClose, heading = "Existing Manager" }) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose()
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [onClose])

  if (!manager) return null

  const stations = formatManagerStations(manager)
  const loginIdentifier = manager.email || manager.phone || "No login identifier"

  return (
    <div className="internal-modal-backdrop" role="dialog" aria-modal="true" aria-label={heading} onClick={onClose}>
      <div className="internal-modal internal-modal--list admin-modal admin-modal--narrow existing-manager-modal" onClick={(event) => event.stopPropagation()}>
        <header className="internal-modal-header">
          <div className="internal-modal-header-copy">
            <h3>{heading}</h3>
            <p>Review the selected manager before assigning them to this station.</p>
          </div>
          <div className="internal-modal-header-actions">
            <button type="button" className="secondary-action internal-modal-close" onClick={onClose}>Close</button>
          </div>
        </header>

        <div className="internal-modal-body internal-modal-body--list">
          <div className="stack-grid">
            <div className="admin-form-grid">
              <div className="admin-detail-block">
                <span>Full Name</span>
                <strong>{manager.fullName || "No manager name"}</strong>
              </div>
              <div className="admin-detail-block">
                <span>User ID</span>
                <strong>{manager.userPublicId || "-"}</strong>
              </div>
              <div className="admin-detail-block">
                <span>Login</span>
                <strong>{loginIdentifier}</strong>
              </div>
              <div className="admin-detail-block">
                <span>Assignment Status</span>
                <strong>{manager.alreadyAssignedToStation ? "Already assigned to this station" : "Ready to assign"}</strong>
              </div>
            </div>

            <div className="admin-detail-block">
              <span>Current Manager Stations</span>
              {stations.length ? (
                <div className="settings-chip-row">
                  {stations.map((stationName) => (
                    <span key={stationName} className="settings-chip">{stationName}</span>
                  ))}
                </div>
              ) : (
                <strong>No current manager assignments</strong>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
