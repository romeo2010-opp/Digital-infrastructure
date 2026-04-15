import { AuthProvider, useAuth } from "./auth/AuthContext"
import { KioskLoginScreen } from "./components/KioskLoginScreen"
import { SmartLinkKiosk } from "./components/SmartLinkKiosk"
import { Toaster } from "./components/ui/sonner"

export default function App() {
  return (
    <AuthProvider>
      <KioskApp />
      <Toaster />
    </AuthProvider>
  )
}

function KioskApp() {
  const { loading, isAuthenticated } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#0b1520] px-6 text-[#d8e1ec]">
        <div className="rounded-[24px] border border-[#213243] bg-[#0f1b28] px-8 py-6 text-center shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
          <div className="text-[0.76rem] font-semibold uppercase tracking-[0.18em] text-[#8ea1b5]">
            SmartLink Kiosk
          </div>
          <div className="mt-3 text-[1.05rem] font-semibold text-[#ecf3fb]">
            Loading station session...
          </div>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <KioskLoginScreen />
  }

  return <SmartLinkKiosk />
}
