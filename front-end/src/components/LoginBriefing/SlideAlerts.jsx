import React from "react"

export default function SlideAlerts({ alerts }) {
  const rows = Array.isArray(alerts) ? alerts : []

  return (
    <section className="briefing-slide" aria-live="polite">
      <div className="briefing-card">
        <p className="briefing-slide__label">Slide 1 of 5 - Station alerts</p>
        <h2 className="briefing-slide__title">Critical items requiring your attention</h2>

        {rows.length ? (
          <ul className="briefing-alert-list">
            {rows.map((alert, index) => {
              const severity = String(alert?.severity || "info").toLowerCase()
              return (
                <li key={`${alert?.category || "alert"}-${alert?.title || index}`} className={`briefing-alert briefing-alert--${severity}`}>
                  <span className={`briefing-alert__icon briefing-alert__icon--${severity}`}>{severity === "success" ? "✓" : severity === "critical" ? "!" : "•"}</span>
                  <div className="briefing-alert__body">
                    <p className="briefing-alert__title">{alert?.title || "Station alert"}</p>
                    <p className="briefing-alert__desc">{alert?.description || "-"}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="briefing-empty">
            No alerts were triggered for this briefing.
          </p>
        )}
      </div>
    </section>
  )
}
