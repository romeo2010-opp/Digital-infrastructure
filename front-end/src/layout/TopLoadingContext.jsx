import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

const TopLoadingContext = createContext(null)

export function TopLoadingProvider({ children }) {
  const [activeKeys, setActiveKeys] = useState(() => new Set())
  const [visible, setVisible] = useState(false)
  const [settling, setSettling] = useState(false)

  const isLoading = activeKeys.size > 0

  useEffect(() => {
    if (isLoading) {
      setSettling(false)
      setVisible(true)
      return undefined
    }

    if (!visible) return undefined
    setSettling(true)
    const timer = window.setTimeout(() => {
      setVisible(false)
      setSettling(false)
    }, 260)
    return () => window.clearTimeout(timer)
  }, [isLoading, visible])

  const setTopLoading = useCallback((key, nextActive = true) => {
    const resolvedKey = String(key || "global")
    setActiveKeys((current) => {
      const next = new Set(current)
      if (nextActive) {
        next.add(resolvedKey)
      } else {
        next.delete(resolvedKey)
      }
      return next
    })
  }, [])

  const value = useMemo(
    () => ({
      isTopLoading: isLoading,
      setTopLoading,
    }),
    [isLoading, setTopLoading]
  )

  return (
    <TopLoadingContext.Provider value={value}>
      <TopLoadBar active={visible} settling={settling} />
      {children}
    </TopLoadingContext.Provider>
  )
}

function TopLoadBar({ active, settling }) {
  return (
    <div
      className={`top-load-bar ${active ? "is-active" : ""} ${settling ? "is-settling" : ""}`}
      aria-hidden="true"
    >
      <span />
    </div>
  )
}

export function useTopLoading() {
  const context = useContext(TopLoadingContext)
  if (!context) {
    return {
      isTopLoading: false,
      setTopLoading() {},
    }
  }
  return context
}
