import { useCallback, useEffect, useMemo, useState } from "react"
import Navbar from "../../components/Navbar"
import { queueData, pumpsData } from "../../config/dataSource"
import { useStationChangeWatcher } from "../../hooks/useStationChangeWatcher"
import QueueHeaderBar from "./QueueHeaderBar"
import QueueControls from "./QueueControls"
import FiltersBar from "./FiltersBar"
import QueueList from "./QueueList"
import CurrentCallPanel from "./CurrentCallPanel"
import PumpStatusPanel from "./PumpStatusPanel"
import WalkInModePanel from "./WalkInModePanel"
import QueueRulesPanel from "./QueueRulesPanel"
import ActivityLogPanel from "./ActivityLogPanel"
import { formatDateTime } from "../../utils/dateTime"
import "./queueConsole.css"

const avatar =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' rx='40' fill='%23dbe8ff'/%3E%3Ccircle cx='40' cy='30' r='14' fill='%2357779f'/%3E%3Cpath d='M14 73c4-14 16-22 26-22s22 8 26 22' fill='%2357779f'/%3E%3C/svg%3E"

const HIDDEN_QUEUE_STATUSES = new Set(["Served", "Completed", "Cancelled"])
const ACTIVE_QUEUE_STATUSES = ["Waiting", "Called", "Ready on site", "Assigned", "Fueling", "Late"]

function formatMinutesDuration(isoValue) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(isoValue).getTime()) / 1000))
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return `${minutes}m ${String(remaining).padStart(2, "0")}s`
}

function enrichEntries(entries) {
  const activeForPosition = entries.filter((entry) =>
    ACTIVE_QUEUE_STATUSES.includes(entry.status)
  )
  const positionById = new Map(activeForPosition.map((entry, idx) => [entry.id, idx + 1]))

  return entries.map((entry) => ({
    ...entry,
    positionText: positionById.get(entry.id) ? `#${positionById.get(entry.id)}` : "-",
    waitDuration: formatMinutesDuration(entry.joinedAt),
    etaLabel: `${entry.etaMinutes} min`,
    calledAtLabel: formatDateTime(entry.calledAt),
  }))
}

export default function ManagerQueueConsole() {
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("All")
  const [searchText, setSearchText] = useState("")
  const [actionError, setActionError] = useState("")

  const refreshSnapshot = useCallback(async ({ showLoader = true } = {}) => {
    try {
      if (showLoader) setLoading(true)
      const next = await queueData.getSnapshot()
      setSnapshot(next)
    } catch (error) {
      setActionError(error?.message || "Failed to load queue snapshot.")
    } finally {
      if (showLoader) setLoading(false)
    }
  }, [])

  async function runAction(action) {
    // TODO: swap queueService for API client + optimistic cache updates when backend is available.
    try {
      setActionError("")
      await action()
      const next = await queueData.getSnapshot()
      setSnapshot(next)
    } catch (error) {
      setActionError(error?.message || "Action failed. Please try again.")
    }
  }

  useEffect(() => {
    refreshSnapshot()
  }, [refreshSnapshot])

  useStationChangeWatcher({
    onChange: async () => {
      await refreshSnapshot({ showLoader: false })
    },
  })

  const entries = useMemo(
    () =>
      enrichEntries(snapshot?.entries || []).filter((entry) => !HIDDEN_QUEUE_STATUSES.has(entry.status)),
    [snapshot?.entries]
  )
  const filteredEntries = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    return entries.filter((entry) => {
      const byStatus = statusFilter === "All" || entry.status === statusFilter
      const bySearch =
        !q ||
        entry.id.toLowerCase().includes(q) ||
        entry.plate.toLowerCase().includes(q) ||
        entry.maskedIdentifier.toLowerCase().includes(q)
      return byStatus && bySearch
    })
  }, [entries, searchText, statusFilter])

  const queueLength = useMemo(
    () => entries.filter((entry) => ACTIVE_QUEUE_STATUSES.includes(entry.status)).length,
    [entries]
  )

  const calledEntry = useMemo(
    () => entries.find((entry) => entry.id === snapshot?.currentCall?.entryId) || null,
    [entries, snapshot?.currentCall?.entryId]
  )

  if (!snapshot || loading) {
    return (
      <div className="queue-page">
        <Navbar pagetitle="Digital Queue Console" image={avatar} count={0} />
        <section className="qc-console">
          <p className="qc-empty">Loading queue console...</p>
        </section>
      </div>
    )
  }

  return (
    <div className="queue-page">
      <Navbar pagetitle="Digital Queue Console" image={avatar} count={queueLength} />

      <section className="qc-console">
        <QueueHeaderBar
          stationName={snapshot.stationName}
          stationStatus={snapshot.stationStatus}
          lastUpdatedAt={formatDateTime(snapshot.lastUpdatedAt)}
          onRefresh={refreshSnapshot}
        />
        {actionError ? <p className="qc-empty">{actionError}</p> : null}

        <div className="qc-grid-top">
          <QueueControls
            onCallNext={() => runAction(() => queueData.callNext())}
            onRecall={() => runAction(() => queueData.recall())}
            onCallPosition={(position, reason) => runAction(() => queueData.callPosition(position, reason))}
          />
          <CurrentCallPanel currentCall={snapshot.currentCall} calledEntry={calledEntry} />
          <FiltersBar
            statusFilter={statusFilter}
            onStatusChange={setStatusFilter}
            searchText={searchText}
            onSearchChange={setSearchText}
          />
        </div>

        <QueueList
          entries={filteredEntries}
          queueLength={queueLength}
          lastMovementLabel={formatDateTime(snapshot.lastMovementAt)}
          onMarkServed={(entryId) =>
            runAction(() => queueData.markServed(entryId, { pump: "P1", liters: 40 }))
          }
          onMarkNoShow={(entryId) => runAction(() => queueData.markNoShow(entryId, "remove"))}
          onMarkLate={(entryId) => runAction(() => queueData.markLate(entryId))}
          onSkip={(entryId, reason) =>
            runAction(async () => {
              await queueData.markNoShow(entryId, "move_to_end")
              return queueData.appendAudit("SKIP", { entryId, reason })
            })
          }
        />

        <div className="qc-grid-bottom">
          <PumpStatusPanel
            pumps={snapshot.pumps}
            onUpdatePumpStatus={(pumpId, status, reason) =>
              runAction(async () => {
                await pumpsData.updatePumpStatus(pumpId, status, reason)
                if (queueData.updatePumpStatus) {
                  await queueData.updatePumpStatus(pumpId, status, reason)
                }
              })
            }
          />
          <WalkInModePanel
            mode={snapshot.priorityMode}
            hybridRatio={snapshot.hybridRatio}
            onSetPriorityMode={(mode, ratio) => runAction(() => queueData.setPriorityMode(mode, ratio))}
          />
          <QueueRulesPanel
            settings={snapshot.settings}
            onUpdateSettings={(settings) => runAction(() => queueData.updateSettings(settings))}
            onPauseJoins={() => runAction(() => queueData.pauseJoins())}
            onResumeJoins={() => runAction(() => queueData.resumeJoins())}
          />
          <ActivityLogPanel auditLogs={snapshot.auditLogs} />
        </div>
      </section>
    </div>
  )
}
