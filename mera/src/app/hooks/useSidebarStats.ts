import { useEffect, useMemo, useRef, useState } from 'react'
import { portalApi } from '../lib/portalApi'
import { usePortal } from '../lib/portalContext'

export type SidebarSituation = 'STABLE' | 'REGIONAL_SHORTAGE' | 'NATIONAL_OUTAGE' | 'PRICE_SPIKE' | 'MONITORING'

type SidebarStats = {
  stationsOnline: number
  stationsTotal: number
  outOfStock: number
  lowStock: number
  avgQueueWait: number
  openComplaints: number
  activeFlags: number
  activeInspections: number
  pendingEnforcement: number
  nationalSituation: SidebarSituation
  situationDetail: string
  lastSync: Date | null
}

const initialStats: SidebarStats = {
  stationsOnline: 0,
  stationsTotal: 0,
  outOfStock: 0,
  lowStock: 0,
  avgQueueWait: 0,
  openComplaints: 0,
  activeFlags: 0,
  activeInspections: 0,
  pendingEnforcement: 0,
  nationalSituation: 'STABLE',
  situationDetail: 'Awaiting live portal telemetry',
  lastSync: null,
}

function toNumber(value: any) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

export function useSidebarStats() {
  const { token } = usePortal()
  const [stats, setStats] = useState<SidebarStats>(initialStats)
  const [hasError, setHasError] = useState(false)
  const statsRef = useRef<SidebarStats>(initialStats)

  useEffect(() => {
    statsRef.current = stats
  }, [stats])

  useEffect(() => {
    if (!token) return

    let cancelled = false
    let currentController: AbortController | null = null

    const fetchStats = async () => {
      currentController?.abort()
      const controller = new AbortController()
      currentController = controller

      try {
        const payload = await portalApi.getSidebarStats(token, controller.signal)
        if (cancelled) return
        const nextStats: SidebarStats = {
          stationsOnline: toNumber(payload?.stationsOnline),
          stationsTotal: toNumber(payload?.stationsTotal),
          outOfStock: toNumber(payload?.outOfStock),
          lowStock: toNumber(payload?.lowStock),
          avgQueueWait: toNumber(payload?.avgQueueWait),
          openComplaints: toNumber(payload?.openComplaints),
          activeFlags: toNumber(payload?.activeFlags),
          activeInspections: toNumber(payload?.activeInspections),
          pendingEnforcement: toNumber(payload?.pendingEnforcement),
          nationalSituation: payload?.nationalSituation || 'STABLE',
          situationDetail: payload?.situationDetail || 'Awaiting live portal telemetry',
          lastSync: payload?.lastSync ? new Date(payload.lastSync) : new Date(),
        }
        statsRef.current = nextStats
        setStats(nextStats)
        setHasError(false)
      } catch (error: any) {
        if (cancelled || error?.name === 'AbortError') return
        setHasError(true)
        setStats(statsRef.current)
      }
    }

    fetchStats()
    const intervalId = window.setInterval(fetchStats, 30000)

    return () => {
      cancelled = true
      currentController?.abort()
      window.clearInterval(intervalId)
    }
  }, [token])

  return useMemo(
    () => ({
      ...stats,
      hasError,
    }),
    [hasError, stats],
  )
}
