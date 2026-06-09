import { createContext, useContext, useEffect, useMemo, useState } from "react"

const MOBILE_BREAKPOINT_PX = 768
const DESKTOP_EXPANDED_WIDTH = 256
const SIDEBAR_WIDTH_STORAGE_KEY = "smartlink.internal.sidebarWidth"
const SIDEBAR_COLLAPSED_STORAGE_KEY = "smartlink.internal.sidebarCollapsed"

const AppShellContext = createContext(null)

function getStoredSidebarWidth() {
  const value = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) || DESKTOP_EXPANDED_WIDTH)
  if (!Number.isFinite(value)) return DESKTOP_EXPANDED_WIDTH
  return Math.min(320, Math.max(DESKTOP_EXPANDED_WIDTH, value))
}

export function AppShellProvider({ children }) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= MOBILE_BREAKPOINT_PX)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [desktopSidebarWidth, setDesktopSidebarWidth] = useState(() => getStoredSidebarWidth())

  useEffect(() => {
    function handleResize() {
      const nextIsMobile = window.innerWidth <= MOBILE_BREAKPOINT_PX
      setIsMobile(nextIsMobile)
      if (!nextIsMobile) setIsSidebarOpen(false)
    }

    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  useEffect(() => {
    window.localStorage.removeItem(SIDEBAR_COLLAPSED_STORAGE_KEY)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(desktopSidebarWidth))
  }, [desktopSidebarWidth])

  const activeSidebarWidth = isMobile ? 0 : desktopSidebarWidth

  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-width", `${activeSidebarWidth}px`)
  }, [activeSidebarWidth])

  const value = useMemo(
    () => ({
      isMobile,
      isSidebarOpen,
      isSidebarCollapsed,
      desktopSidebarWidth,
      activeSidebarWidth,
      toggleNavigation() {
        if (isMobile) {
          setIsSidebarOpen((prev) => !prev)
          return
        }
        setIsSidebarCollapsed((prev) => !prev)
      },
      closeSidebar() {
        setIsSidebarOpen(false)
      },
      collapseSidebar() {
        if (!isMobile) setIsSidebarCollapsed(true)
      },
      expandSidebar() {
        if (!isMobile) setIsSidebarCollapsed(false)
      },
      openSidebar() {
        if (isMobile) setIsSidebarOpen(true)
      },
      setDesktopSidebarWidth(width) {
        setDesktopSidebarWidth(Math.min(320, Math.max(DESKTOP_EXPANDED_WIDTH, width)))
      },
    }),
    [activeSidebarWidth, desktopSidebarWidth, isMobile, isSidebarCollapsed, isSidebarOpen]
  )

  return <AppShellContext.Provider value={value}>{children}</AppShellContext.Provider>
}

export function useAppShell() {
  const context = useContext(AppShellContext)
  if (!context) throw new Error("useAppShell must be used within AppShellProvider")
  return context
}
