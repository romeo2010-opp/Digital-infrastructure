import React from "react"
import MetricCard from "./MetricCard"

function moneyPerLitre(value) {
  if (value === null || value === undefined || value === "") return "Not verified"
  return `MWK ${Number(value || 0).toLocaleString()}`
}

function rate(value) {
  if (value === null || value === undefined || value === "") return "Not verified"
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function fetchedAt(value) {
  if (!value) return "Market fetch time unavailable"
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "Market fetch time unavailable"
  return `Fetched ${date.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== ""
}

function sourceLabel(source) {
  const name = source?.source || source?.title || "Market source"
  const reliability = source?.reliability ? ` · ${source.reliability.replace(/_/g, " ")}` : ""
  return `${name}${reliability}`
}

export default function SlideMarket({ market, aiAdvice }) {
  const safeMarket = market || {}
  const sources = Array.isArray(safeMarket.sources) ? safeMarket.sources.slice(0, 4) : []
  const hasStructuredValues = [
    safeMarket.petrolPriceMWK,
    safeMarket.dieselPriceMWK,
    safeMarket.kerosenePriceMWK,
    safeMarket.usdMwkRate,
  ].some(hasValue)

  return (
    <section className="briefing-slide" aria-live="polite">
      <div className="briefing-card">
        <p className="briefing-slide__label">Slide 5 of 5 - Malawi market context</p>
        <h2 className="briefing-slide__title">Pricing and supply signals behind the advice</h2>

        {hasStructuredValues ? (
          <div className="briefing-metric-grid briefing-metric-grid--market">
            <MetricCard label="Petrol" value={moneyPerLitre(safeMarket.petrolPriceMWK)} helper="MWK per litre" />
            <MetricCard label="Diesel" value={moneyPerLitre(safeMarket.dieselPriceMWK)} helper="MWK per litre" />
            <MetricCard label="Kerosene" value={moneyPerLitre(safeMarket.kerosenePriceMWK)} helper="MWK per litre" />
            <MetricCard label="USD/MWK" value={rate(safeMarket.usdMwkRate)} helper="Exchange rate" />
          </div>
        ) : (
          <p className="briefing-empty">
            No verified pump-price or exchange-rate figures were found in the DuckDuckGo snippets.
          </p>
        )}

        {aiAdvice?.marketOpportunity ? (
          <article className="briefing-priority">
            <p className="briefing-priority__label">Market opportunity</p>
            <p>{aiAdvice.marketOpportunity}</p>
          </article>
        ) : null}

        {safeMarket.supplyAlert || safeMarket.marketNote ? (
          <article className="briefing-market-note">
            <p>{safeMarket.supplyAlert || safeMarket.marketNote}</p>
            <small>{fetchedAt(safeMarket.fetchedAt)}</small>
          </article>
        ) : (
          <p className="briefing-empty">No Malawi market note was available for this briefing.</p>
        )}

        {sources.length ? (
          <div className="briefing-source-list" aria-label="Market sources checked">
            <p className="briefing-priority__label">Sources checked</p>
            {sources.map((source, index) => (
              <span key={`${source?.url || source?.title || "source"}-${index}`}>
                {sourceLabel(source)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
