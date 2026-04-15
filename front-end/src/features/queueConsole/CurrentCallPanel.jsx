import { useEffect, useMemo, useState } from "react"

function secondsRemaining(graceExpiresAt, nowMs) {
  if (!graceExpiresAt) return 0
  const diffMs = new Date(graceExpiresAt).getTime() - nowMs
  return Math.max(0, Math.floor(diffMs / 1000))
}

function toClock(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

export default function CurrentCallPanel({ currentCall, calledEntry }) {
  const [tickMs, setTickMs] = useState(Date.now())

  useEffect(() => {
    const timerId = window.setInterval(() => setTickMs(Date.now()), 1000)
    return () => window.clearInterval(timerId)
  }, [])

  const countdown = useMemo(() => {
    if (!currentCall?.graceExpiresAt) return "00:00"
    return toClock(secondsRemaining(currentCall.graceExpiresAt, tickMs))
  }, [currentCall?.graceExpiresAt, tickMs])

  return (
    <section className="qc-panel qc-current-call">
      <h3>Current Call</h3>
      {currentCall && calledEntry ? (
        <div className="qc-current-call-body">
          <p><strong>{calledEntry.maskedIdentifier}</strong> is currently called.</p>
          <small>Called At: {calledEntry.calledAtLabel || "-"}</small>
          <small>Grace Countdown: {countdown}</small>
          <small>Recall Count: {currentCall.recallCount || 0}</small>
        </div>
      ) : (
        <p className="qc-empty">No active call at the moment.</p>
      )}
    </section>
  )
}
