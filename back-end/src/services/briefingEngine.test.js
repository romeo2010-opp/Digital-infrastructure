import { describe, expect, it } from "vitest"
import { generateBriefing, validateInput } from "./briefingEngine.js"

const baseData = {
  lastLoginAt: "2026-05-07T06:00:00.000Z",
  tanks: [
    {
      id: "TANK-PETROL",
      fuelType: "PETROL",
      capacityLitres: 10000,
      currentLitres: 6000,
      resupplyScheduledAt: "2026-05-07T18:00:00.000Z",
    },
  ],
  pumps: [
    {
      id: "PUMP-1",
      label: "Pump 1",
      faultEventsCount: 0,
      lastFaultAt: "2026-05-07T08:00:00.000Z",
      status: "active",
    },
  ],
  sales: {
    totalRevenueMWK: 100000,
    totalLitres: 100,
    transactionCount: 10,
    previousDayRevenueMWK: 100000,
    previousDayLitres: 100,
    byFuelType: [{ fuelType: "PETROL", litres: 100 }],
  },
  queue: {
    driversServed: 20,
    avgWaitMinutes: 10,
    targetWaitMinutes: 10,
    dropOffs: 0,
    peakHours: [{ hour: "09:00", vehicleCount: 8 }],
  },
  deliveries: [
    {
      fuelType: "PETROL",
      scheduledAt: "2026-05-07T18:00:00.000Z",
      estimatedLitres: 5000,
      status: "scheduled",
    },
  ],
}

function data(overrides = {}) {
  return {
    ...baseData,
    ...overrides,
    tanks: overrides.tanks ?? baseData.tanks.map((row) => ({ ...row })),
    pumps: overrides.pumps ?? baseData.pumps.map((row) => ({ ...row })),
    sales: {
      ...baseData.sales,
      ...(overrides.sales || {}),
      byFuelType: overrides.sales?.byFuelType ?? baseData.sales.byFuelType.map((row) => ({ ...row })),
    },
    queue: {
      ...baseData.queue,
      ...(overrides.queue || {}),
      peakHours: overrides.queue?.peakHours ?? baseData.queue.peakHours.map((row) => ({ ...row })),
    },
    deliveries: overrides.deliveries ?? baseData.deliveries.map((row) => ({ ...row })),
  }
}

function titlesForSeverity(briefing, severity) {
  return briefing.alerts.filter((alert) => alert.severity === severity).map((alert) => alert.title)
}

describe("generateBriefing critical alerts", () => {
  it("flags tanks below 15 percent when no resupply is within 6 hours", () => {
    const briefing = generateBriefing(
      data({
        tanks: [
          {
            id: "TANK-DIESEL",
            fuelType: "DIESEL",
            capacityLitres: 10000,
            currentLitres: 1400,
            resupplyScheduledAt: "2026-05-07T18:00:00.000Z",
          },
        ],
      })
    )

    expect(titlesForSeverity(briefing, "critical")).toContain("DIESEL tank needs urgent resupply")
  })

  it("flags tanks below 10 percent regardless of resupply timing", () => {
    const briefing = generateBriefing(
      data({
        tanks: [
          {
            id: "TANK-PETROL",
            fuelType: "PETROL",
            capacityLitres: 10000,
            currentLitres: 900,
            resupplyScheduledAt: "2026-05-07T09:00:00.000Z",
          },
        ],
      })
    )

    expect(titlesForSeverity(briefing, "critical")).toContain("PETROL tank is critically low")
  })

  it("flags offline pumps", () => {
    const briefing = generateBriefing(
      data({
        pumps: [
          {
            id: "PUMP-2",
            label: "Pump 2",
            faultEventsCount: 0,
            lastFaultAt: "2026-05-07T08:00:00.000Z",
            status: "offline",
          },
        ],
      })
    )

    expect(titlesForSeverity(briefing, "critical")).toContain("Pump 2 is offline")
  })
})

describe("generateBriefing warning alerts", () => {
  it("flags tanks below 25 percent", () => {
    const briefing = generateBriefing(
      data({
        tanks: [
          {
            id: "TANK-PETROL",
            fuelType: "PETROL",
            capacityLitres: 10000,
            currentLitres: 2400,
            resupplyScheduledAt: "2026-05-07T18:00:00.000Z",
          },
        ],
      })
    )

    expect(titlesForSeverity(briefing, "warning")).toContain("PETROL tank is running low")
  })

  it("flags pumps with at least three fault events", () => {
    const briefing = generateBriefing(
      data({
        pumps: [
          {
            id: "PUMP-1",
            label: "Pump 1",
            faultEventsCount: 3,
            lastFaultAt: "2026-05-07T08:00:00.000Z",
            status: "active",
          },
        ],
      })
    )

    expect(titlesForSeverity(briefing, "warning")).toContain("Pump 1 has repeated faults")
  })

  it("flags queue drop-offs greater than ten", () => {
    const briefing = generateBriefing(data({ queue: { dropOffs: 11 } }))

    expect(titlesForSeverity(briefing, "warning")).toContain("Queue drop-offs are elevated")
  })

  it("flags average wait time more than five minutes above target", () => {
    const briefing = generateBriefing(data({ queue: { avgWaitMinutes: 16, targetWaitMinutes: 10 } }))

    expect(titlesForSeverity(briefing, "warning")).toContain("Queue wait time is above target")
  })
})

describe("generateBriefing info and success alerts", () => {
  it("flags scheduled deliveries within 12 hours", () => {
    const briefing = generateBriefing(
      data({
        deliveries: [
          {
            fuelType: "DIESEL",
            scheduledAt: "2026-05-07T18:00:00.000Z",
            estimatedLitres: 8000,
            status: "scheduled",
          },
        ],
      })
    )

    expect(titlesForSeverity(briefing, "info")).toContain("DIESEL delivery is scheduled soon")
  })

  it("flags revenue increases greater than five percent and confirmed deliveries", () => {
    const briefing = generateBriefing(
      data({
        sales: { totalRevenueMWK: 106000, previousDayRevenueMWK: 100000 },
        deliveries: [
          {
            fuelType: "PETROL",
            scheduledAt: "2026-05-07T18:00:00.000Z",
            estimatedLitres: 5000,
            status: "confirmed",
          },
        ],
      })
    )

    expect(titlesForSeverity(briefing, "success")).toContain("Revenue is up versus previous day")
    expect(titlesForSeverity(briefing, "success")).toContain("PETROL delivery confirmed")
  })
})

describe("generateBriefing insight and deltas", () => {
  it("prioritizes critical alerts before warnings, queue issues, and positive notes", () => {
    const briefing = generateBriefing(
      data({
        tanks: [
          {
            id: "TANK-DIESEL",
            fuelType: "DIESEL",
            capacityLitres: 10000,
            currentLitres: 900,
            resupplyScheduledAt: "2026-05-07T18:00:00.000Z",
          },
        ],
        queue: { avgWaitMinutes: 20, targetWaitMinutes: 10, dropOffs: 12 },
        sales: { totalRevenueMWK: 120000, previousDayRevenueMWK: 100000 },
      })
    )

    expect(briefing.insight.priority).toBe("Act now: diesel tank needs urgent resupply.")
  })

  it("prioritizes non-queue warnings before queue warnings", () => {
    const briefing = generateBriefing(
      data({
        pumps: [
          {
            id: "PUMP-1",
            label: "Pump 1",
            faultEventsCount: 3,
            lastFaultAt: "2026-05-07T08:00:00.000Z",
            status: "active",
          },
        ],
        queue: { avgWaitMinutes: 20, targetWaitMinutes: 10 },
      })
    )

    expect(briefing.insight.priority).toBe("Address warning: pump 1 has repeated faults.")
  })

  it("uses positive notes when no critical, warning, or queue issue exists", () => {
    const briefing = generateBriefing(data({ sales: { totalRevenueMWK: 110000, previousDayRevenueMWK: 100000 } }))

    expect(briefing.insight.priority).toBe("Maintain momentum: revenue is up versus previous day.")
  })

  it("calculates revenue and litres percentage deltas", () => {
    const briefing = generateBriefing(
      data({
        sales: {
          totalRevenueMWK: 125000,
          previousDayRevenueMWK: 100000,
          totalLitres: 90,
          previousDayLitres: 120,
        },
      })
    )

    expect(briefing.sales.revenueChangePct).toBe(25)
    expect(briefing.sales.litresChangePct).toBe(-25)
  })

  it("handles zero previous-day values deterministically", () => {
    const briefing = generateBriefing(
      data({
        sales: {
          totalRevenueMWK: 1000,
          previousDayRevenueMWK: 0,
          totalLitres: 0,
          previousDayLitres: 0,
        },
      })
    )

    expect(briefing.sales.revenueChangePct).toBe(100)
    expect(briefing.sales.litresChangePct).toBe(0)
  })
})

describe("validateInput", () => {
  it("throws descriptive errors for bad input", () => {
    expect(() => validateInput({ ...baseData, lastLoginAt: "not-a-date" })).toThrow("lastLoginAt must be a valid ISO timestamp")
    expect(() => validateInput(data({ tanks: [{ ...baseData.tanks[0], capacityLitres: 0 }] }))).toThrow(
      "tanks[0].capacityLitres must be greater than or equal to"
    )
  })
})
