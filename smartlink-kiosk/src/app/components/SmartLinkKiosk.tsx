import { useEffect, useState } from "react"
import { useAuth } from "../auth/AuthContext"
import { useKioskOperations } from "../hooks/useKioskOperations"
import { useKioskStationRealtime } from "../hooks/useKioskStationRealtime"
import { useFuelStore } from "../store/fuelStore"
import { ActiveSessionPanel } from "./ActiveSessionPanel"
import { KioskSidebar } from "./KioskSidebar"
import { KioskThemeProvider } from "./KioskThemeContext"
import { QueuePanel } from "./QueuePanel"
import { TopBar } from "./TopBar"

export function SmartLinkKiosk() {
  const [currentTime, setCurrentTime] = useState(new Date())
  const { session, isApiMode } = useAuth()
  const { refreshData } = useKioskOperations()
  const { syncError, isHydrating, setApiMode, setSessionContext } = useFuelStore()

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    setApiMode(isApiMode)
    setSessionContext({
      attendantName: session?.user?.fullName || "Station Attendant",
      attendantRole: session?.role || "Attendant",
    })
  }, [isApiMode, session, setApiMode, setSessionContext])

  useEffect(() => {
    if (!session?.station?.publicId) return
    void refreshData()
  }, [refreshData, session?.station?.publicId])

  useKioskStationRealtime({
    enabled: Boolean(isApiMode && session?.station?.publicId),
    onChange: () => refreshData({ silent: true }),
  })

  const currentHour = currentTime.getHours()
  const isNightTheme = currentHour >= 18 || currentHour < 6

  return (
    <KioskThemeProvider isNightTheme={isNightTheme}>
      <div
        className={`h-dvh w-full overflow-hidden ${
          isNightTheme ? "bg-[#07111b] text-[#d8e1ec]" : "bg-[#edf2f7] text-[#101828]"
        }`}
      >
        <div className="grid h-full w-full xl:grid-cols-[minmax(0,1fr)_304px]">
          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] px-5 py-5 lg:px-8 lg:py-6">
            <TopBar currentTime={currentTime} />

            {syncError ? (
              <div
                className={`mt-4 rounded-[18px] border px-4 py-3 text-sm ${
                  isNightTheme
                    ? "border-[#533a2b] bg-[#221913] text-[#d2ad8f]"
                    : "border-[#eadfd6] bg-[#faf5f0] text-[#8b5e3c]"
                }`}
              >
                {syncError}
              </div>
            ) : null}

            {isHydrating ? (
              <div className={`mt-4 text-sm ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>
                Refreshing station operations...
              </div>
            ) : null}

            <div className="mt-6 grid min-h-0 flex-1 gap-6 xl:grid-cols-[364px_minmax(0,1fr)]">
              <div className="min-h-0">
                <QueuePanel />
              </div>
              <div className="min-h-0">
                <ActiveSessionPanel />
              </div>
            </div>
          </div>
          <KioskSidebar />
        </div>
      </div>
    </KioskThemeProvider>
  )
}
