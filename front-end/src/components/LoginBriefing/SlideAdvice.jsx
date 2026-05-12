import React from "react"

export default function SlideAdvice({ aiAdvice }) {
  const recommendations = Array.isArray(aiAdvice?.recommendations) ? aiAdvice.recommendations : []

  return (
    <section className="briefing-slide" aria-live="polite">
      <div className="briefing-card">
        <p className="briefing-slide__label">Slide 2 of 5 - AI revenue actions</p>
        <h2 className="briefing-slide__title">Specific moves to grow today's revenue</h2>

        {recommendations.length ? (
          <ol className="briefing-recommendation-list">
            {recommendations.map((recommendation, index) => (
              <li key={`${recommendation.title}-${index}`} className="briefing-recommendation">
                <div className="briefing-recommendation__rank">{index + 1}</div>
                <div className="briefing-recommendation__body">
                  <div className="briefing-recommendation__head">
                    <h3>{recommendation.title}</h3>
                    <span>{recommendation.revenueImpact || "unknown"}</span>
                  </div>
                  {recommendation.reasoning ? <p>{recommendation.reasoning}</p> : null}
                  {recommendation.action ? <strong>{recommendation.action}</strong> : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="briefing-empty">
            AI revenue recommendations are unavailable for this briefing.
          </p>
        )}

        {aiAdvice?.riskFlag ? (
          <article className="briefing-priority briefing-priority--risk">
            <p className="briefing-priority__label">Risk flag</p>
            <p>{aiAdvice.riskFlag}</p>
          </article>
        ) : null}
      </div>
    </section>
  )
}
