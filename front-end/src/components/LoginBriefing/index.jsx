import React, { useCallback, useEffect, useMemo, useState } from "react"
import SlideAdvice from "./SlideAdvice"
import SlideAlerts from "./SlideAlerts"
import SlideMarket from "./SlideMarket"
import SlideQueue from "./SlideQueue"
import SlideSales from "./SlideSales"

const SLIDE_COUNT = 5

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null)
}

function normalizeFuelRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    fuelType: firstValue(row?.fuelType, row?.fuel_type, "Fuel"),
    litres: Number(firstValue(row?.litres, 0)),
    revenueMWK: firstValue(row?.revenueMWK, row?.revenue_mwk, null),
  }))
}

function normalizePeakRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    hour: firstValue(row?.hour, "-"),
    vehicleCount: Number(firstValue(row?.vehicleCount, row?.vehicle_count, 0)),
  }))
}

function normalizeSales(sales) {
  const source = sales && typeof sales === "object" ? sales : {}
  return {
    totalRevenueMWK: Number(firstValue(source.totalRevenueMWK, source.total_revenue_mwk, 0)),
    totalLitres: Number(firstValue(source.totalLitres, source.total_litres, 0)),
    transactionCount: Number(firstValue(source.transactionCount, source.transaction_count, 0)),
    revenueChangePct: Number(firstValue(source.revenueChangePct, source.revenue_change_pct, 0)),
    litresChangePct: Number(firstValue(source.litresChangePct, source.litres_change_pct, 0)),
    byFuelType: normalizeFuelRows(firstValue(source.byFuelType, source.by_fuel_type, [])),
  }
}

function normalizeQueue(queue) {
  const source = queue && typeof queue === "object" ? queue : {}
  return {
    driversServed: Number(firstValue(source.driversServed, source.drivers_served, 0)),
    avgWaitMinutes: Number(firstValue(source.avgWaitMinutes, source.avg_wait_minutes, 0)),
    targetWaitMinutes: Number(firstValue(source.targetWaitMinutes, source.target_wait_minutes, 0)),
    dropOffs: Number(firstValue(source.dropOffs, source.drop_offs, 0)),
    peakHours: normalizePeakRows(firstValue(source.peakHours, source.peak_hours, [])),
  }
}

function normalizeAdvice(aiAdvice) {
  const source = aiAdvice && typeof aiAdvice === "object" ? aiAdvice : {}
  const recommendations = Array.isArray(source.recommendations) ? source.recommendations : []
  return {
    recommendations: recommendations.map((recommendation) => ({
      title: recommendation?.title || "Revenue recommendation",
      reasoning: recommendation?.reasoning || "",
      action: recommendation?.action || "",
      revenueImpact: firstValue(recommendation?.revenueImpact, recommendation?.revenue_impact, "unknown"),
    })),
    marketOpportunity: firstValue(source.marketOpportunity, source.market_opportunity, null),
    riskFlag: firstValue(source.riskFlag, source.risk_flag, null),
  }
}

function normalizeMarket(market) {
  const source = market && typeof market === "object" ? market : {}
  return {
    petrolPriceMWK: firstValue(source.petrolPriceMWK, source.petrol_price_mwk, null),
    dieselPriceMWK: firstValue(source.dieselPriceMWK, source.diesel_price_mwk, null),
    kerosenePriceMWK: firstValue(source.kerosenePriceMWK, source.kerosene_price_mwk, null),
    usdMwkRate: firstValue(source.usdMwkRate, source.usd_mwk_rate, null),
    supplyAlert: firstValue(source.supplyAlert, source.supply_alert, null),
    marketNote: firstValue(source.marketNote, source.market_note, null),
    fetchedAt: firstValue(source.fetchedAt, source.fetched_at, null),
    sources: Array.isArray(source.sources) ? source.sources : [],
  }
}

function normalizeBriefing(briefing) {
  const source = briefing && typeof briefing === "object" ? briefing : {}
  return {
    absenceHours: Number(firstValue(source.absenceHours, source.absence_hours, 0)),
    alerts: Array.isArray(source.alerts) ? source.alerts : [],
    sales: normalizeSales(source.sales),
    queue: normalizeQueue(source.queue),
    insight: source.insight || {},
    market: normalizeMarket(source.market),
    aiAdvice: normalizeAdvice(firstValue(source.aiAdvice, source.ai_advice, {})),
  }
}

function hasSignificantDeltas(sales) {
  return Math.abs(Number(sales?.revenueChangePct || 0)) > 5 || Math.abs(Number(sales?.litresChangePct || 0)) > 5
}

function hasBriefingContent(briefing) {
  return (
    briefing.alerts.length > 0 ||
    briefing.aiAdvice.recommendations.length > 0 ||
    Boolean(briefing.aiAdvice.marketOpportunity || briefing.aiAdvice.riskFlag) ||
    Boolean(briefing.market.marketNote || briefing.market.supplyAlert) ||
    hasSignificantDeltas(briefing.sales)
  )
}

function uniqueSortedSlides(slides) {
  return Array.from(new Set(slides)).sort((left, right) => left - right)
}

export default function LoginBriefing({ briefing, managerName = "Manager", onDismiss }) {
  const memoBriefing = useMemo(() => normalizeBriefing(briefing), [briefing])
  const briefingTimestamp = useMemo(
    () =>
      new Date().toLocaleString("en-GB", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
    []
  )
  const [currentSlide, setCurrentSlide] = useState(0)
  const [slidesViewed, setSlidesViewed] = useState([1])
  const alertCount = memoBriefing.alerts.length
  const recommendationCount = memoBriefing.aiAdvice.recommendations.length
  const absenceHoursText = memoBriefing.absenceHours.toLocaleString(undefined, { maximumFractionDigits: 1 })

  const markViewed = useCallback((slideIndex) => {
    setSlidesViewed((current) => uniqueSortedSlides([...current, slideIndex + 1]))
  }, [])

  const dismiss = useCallback(() => {
    onDismiss?.({ slidesViewed: uniqueSortedSlides(slidesViewed) })
  }, [onDismiss, slidesViewed])

  const goToSlide = useCallback(
    (nextIndex) => {
      const boundedIndex = Math.min(SLIDE_COUNT - 1, Math.max(0, nextIndex))
      setCurrentSlide(boundedIndex)
      markViewed(boundedIndex)
    },
    [markViewed]
  )

  const goPrevious = useCallback(() => {
    goToSlide(currentSlide - 1)
  }, [currentSlide, goToSlide])

  const goNext = useCallback(() => {
    if (currentSlide >= SLIDE_COUNT - 1) {
      dismiss()
      return
    }
    goToSlide(currentSlide + 1)
  }, [currentSlide, dismiss, goToSlide])

  useEffect(() => {
    if (hasBriefingContent(memoBriefing)) return undefined
    const timer = window.setTimeout(() => {
      onDismiss?.({ slidesViewed: [] })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [memoBriefing, onDismiss])

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        goPrevious()
      }
      if (event.key === "ArrowRight") {
        event.preventDefault()
        goNext()
      }
      if (event.key === "Escape") {
        event.preventDefault()
        dismiss()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [dismiss, goNext, goPrevious])

  return (
    <section
      role="dialog"
      aria-label="Station briefing"
      className="login-briefing"
    >
      <header className="login-briefing__header">
        <div className="login-briefing__topline">
          <span className="login-briefing__badge">● Live briefing</span>
          <span className="login-briefing__timestamp">{briefingTimestamp}</span>
        </div>
        <h1>Welcome back, {managerName}.</h1>
        <p>
          Here is what happened while you were gone — you were away for approximately {absenceHoursText} hours.
          {alertCount ? ` ${alertCount} ${alertCount === 1 ? "item needs" : "items need"} attention.` : ""}
          {recommendationCount ? ` SmartLink AI has ${recommendationCount} revenue ${recommendationCount === 1 ? "move" : "moves"} for today.` : ""}
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="login-briefing__dismiss"
          aria-label="Dismiss station briefing"
        >
          Dismiss
        </button>
      </header>

      <div className="login-briefing__viewport">
        <div className="login-briefing__track" style={{ transform: `translateX(-${currentSlide * 100}%)` }}>
          <div className="login-briefing__slide">
            <SlideAlerts alerts={memoBriefing.alerts} />
          </div>
          <div className="login-briefing__slide">
            <SlideAdvice aiAdvice={memoBriefing.aiAdvice} />
          </div>
          <div className="login-briefing__slide">
            <SlideSales sales={memoBriefing.sales} />
          </div>
          <div className="login-briefing__slide">
            <SlideQueue queue={memoBriefing.queue} insight={memoBriefing.insight} />
          </div>
          <div className="login-briefing__slide">
            <SlideMarket market={memoBriefing.market} aiAdvice={memoBriefing.aiAdvice} />
          </div>
        </div>
      </div>

      <footer className="login-briefing__footer">
        <button
          type="button"
          onClick={goPrevious}
          disabled={currentSlide === 0}
          className="login-briefing__nav-btn"
          aria-label="View previous briefing slide"
        >
          Previous
        </button>

        <div className="login-briefing__progress">
          <div className="login-briefing__dots" aria-label="Briefing slide indicators">
            {Array.from({ length: SLIDE_COUNT }, (_, index) => (
              <button
                key={index}
                type="button"
                onClick={() => goToSlide(index)}
                className={currentSlide === index ? "is-active" : ""}
                aria-label={`View briefing slide ${index + 1}`}
                aria-current={currentSlide === index ? "step" : undefined}
              />
            ))}
          </div>
          <span className="login-briefing__counter">{currentSlide + 1} / {SLIDE_COUNT}</span>
        </div>

        <button
          type="button"
          onClick={goNext}
          className="login-briefing__nav-btn login-briefing__nav-btn--primary"
          aria-label={currentSlide === SLIDE_COUNT - 1 ? "Finish station briefing" : "View next briefing slide"}
        >
          {currentSlide === SLIDE_COUNT - 1 ? "Finish" : "Next"}
        </button>
      </footer>
    </section>
  )
}
