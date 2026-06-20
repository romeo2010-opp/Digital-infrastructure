import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type DashboardChromeConfig = {
  tabs: Array<{ id: string; label: string; kind: 'builtin' | 'custom' }>
  activeTabId: string
  pinnedTabIds?: string[]
  onTabChange: (id: string) => void
  onCreateView: () => void
  onEditView?: (id: string) => void
  onDeleteView?: (id: string) => void
  onDuplicateTab?: (id: string) => void
  onCopyTab?: (id: string) => void
  onPinTab?: (id: string) => void
  onRefresh?: () => void
  loading?: boolean
  lastSync?: string
}

type DashboardChromeContextValue = {
  chrome: DashboardChromeConfig | null
  setDashboardChrome: (config: DashboardChromeConfig) => void
  clearDashboardChrome: () => void
}

const DashboardChromeContext = createContext<DashboardChromeContextValue | null>(null)

export function DashboardChromeProvider({ children }: { children: ReactNode }) {
  const [chrome, setChrome] = useState<DashboardChromeConfig | null>(null)

  const setDashboardChrome = useCallback((config: DashboardChromeConfig) => {
    setChrome(config)
  }, [])

  const clearDashboardChrome = useCallback(() => {
    setChrome(null)
  }, [])

  const value = useMemo(
    () => ({
      chrome,
      setDashboardChrome,
      clearDashboardChrome,
    }),
    [chrome, clearDashboardChrome, setDashboardChrome],
  )

  return <DashboardChromeContext.Provider value={value}>{children}</DashboardChromeContext.Provider>
}

export function useDashboardChrome() {
  const context = useContext(DashboardChromeContext)
  if (!context) {
    throw new Error('useDashboardChrome must be used inside DashboardChromeProvider')
  }
  return context
}
