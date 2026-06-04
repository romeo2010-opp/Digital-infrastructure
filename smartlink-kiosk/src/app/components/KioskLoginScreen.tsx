import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { RefreshCw, ShieldCheck, Smartphone } from "lucide-react"
import { useAuth } from "../auth/AuthContext"
import { kioskAuthApi } from "../api/kioskAuthApi"

const FINGERPRINT_STORAGE_KEY = "smartlink:kiosk-device-fingerprint"
type ChallengeMode = "staff" | "registration"

function getKioskDeviceFingerprint() {
  const configured = String(import.meta.env.VITE_KIOSK_DEVICE_FINGERPRINT || "").trim()
  if (configured) return configured

  const existing = window.localStorage.getItem(FINGERPRINT_STORAGE_KEY)
  if (existing) return existing

  const generated =
    typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `kiosk-${Date.now()}-${Math.random().toString(36).slice(2)}`
  window.localStorage.setItem(FINGERPRINT_STORAGE_KEY, generated)
  return generated
}

function formatCountdown(expiresAt?: string | null) {
  if (!expiresAt) return 0
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000))
}

function shouldRequestRegistration(error: unknown) {
  const status = (error as Error & { status?: number })?.status
  const message = error instanceof Error ? error.message : ""
  return status === 401 || /not registered|disabled/i.test(message)
}

export function KioskLoginScreen() {
  const { completeKioskAuthorization } = useAuth()
  const [mode, setMode] = useState<ChallengeMode>("staff")
  const [challenge, setChallenge] = useState<Record<string, any> | null>(null)
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const pollingRef = useRef(0)

  const kioskLocation = useMemo(() => {
    if (mode === "registration") return "Pending registration"
    const parts = [challenge?.kioskName, challenge?.locationLabel].map((item) => String(item || "").trim()).filter(Boolean)
    return parts.join(" · ") || "Registered kiosk"
  }, [challenge, mode])

  const requestRegistrationChallenge = useCallback(async () => {
    window.clearInterval(pollingRef.current)
    pollingRef.current = 0
    setMode("registration")
    setError("")
    setChallenge(null)
    setIsLoading(true)
    try {
      const nextChallenge = await kioskAuthApi.createRegistrationChallenge({
        deviceFingerprint: getKioskDeviceFingerprint(),
      })
      if (nextChallenge?.alreadyRegistered) {
        setMode("staff")
        setError("")
        return
      }
      setChallenge(nextChallenge)
      setSecondsLeft(formatCountdown(nextChallenge?.expiresAt))
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create kiosk registration code.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  const requestChallenge = useCallback(async () => {
    window.clearInterval(pollingRef.current)
    pollingRef.current = 0
    setMode("staff")
    setError("")
    setIsLoading(true)
    try {
      const nextChallenge = await kioskAuthApi.createChallenge({
        deviceFingerprint: getKioskDeviceFingerprint(),
        kioskId: String(import.meta.env.VITE_KIOSK_DEVICE_ID || "").trim() || undefined,
        requestedAccessLevel: "Station kiosk operations",
      })
      setChallenge(nextChallenge)
      setSecondsLeft(formatCountdown(nextChallenge?.expiresAt))
    } catch (submitError) {
      if (shouldRequestRegistration(submitError)) {
        await requestRegistrationChallenge()
        return
      }
      setChallenge(null)
      setError(submitError instanceof Error ? submitError.message : "Unable to create kiosk authorization code.")
    } finally {
      setIsLoading(false)
    }
  }, [requestRegistrationChallenge])

  useEffect(() => {
    void requestChallenge()
    return () => {
      window.clearInterval(pollingRef.current)
    }
  }, [requestChallenge])

  useEffect(() => {
    if (!challenge?.expiresAt) return undefined
    const timer = window.setInterval(() => {
      setSecondsLeft(formatCountdown(challenge.expiresAt))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [challenge?.expiresAt])

  useEffect(() => {
    window.clearInterval(pollingRef.current)
    pollingRef.current = 0
    if (!challenge?.challengeId || !challenge?.challengeSecret) return undefined

    pollingRef.current = window.setInterval(async () => {
      try {
        const status =
          mode === "registration"
            ? await kioskAuthApi.getRegistrationChallengeStatus(challenge.challengeId, challenge.challengeSecret)
            : await kioskAuthApi.getChallengeStatus(challenge.challengeId, challenge.challengeSecret)
        const normalized = String(status?.status || "").toLowerCase()
        if (mode === "registration" && normalized === "approved") {
          window.clearInterval(pollingRef.current)
          setChallenge(null)
          setError("")
          void requestChallenge()
          return
        }
        if (mode === "staff" && normalized === "approved" && status?.session?.accessToken) {
          window.clearInterval(pollingRef.current)
          completeKioskAuthorization(status.session)
          return
        }
        if (normalized === "denied") {
          window.clearInterval(pollingRef.current)
          setError(
            mode === "registration"
              ? "Kiosk registration denied. Ask internal technical staff to scan a new code."
              : "Authorization denied. Ask your manager to scan a new code."
          )
          return
        }
        if (normalized === "expired") {
          window.clearInterval(pollingRef.current)
          if (mode === "registration") {
            void requestRegistrationChallenge()
          } else {
            void requestChallenge()
          }
        }
      } catch (pollError) {
        setError(
          pollError instanceof Error
            ? pollError.message
            : mode === "registration"
              ? "Unable to check kiosk registration status."
              : "Unable to check kiosk authorization status."
        )
      }
    }, 2500)

    return () => window.clearInterval(pollingRef.current)
  }, [
    challenge?.challengeId,
    challenge?.challengeSecret,
    completeKioskAuthorization,
    mode,
    requestChallenge,
    requestRegistrationChallenge,
  ])

  const isRegistrationMode = mode === "registration"
  const refreshActiveQr = isRegistrationMode ? requestRegistrationChallenge : requestChallenge

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#0b1520] px-6 py-8 text-[#e7edf4]">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[32px] border border-[#1d3040] bg-[#0f1b28] shadow-[0_30px_80px_rgba(0,0,0,0.35)] lg:grid-cols-[minmax(0,1.1fr)_420px]">
        <section className="flex flex-col justify-between border-b border-[#1d3040] px-8 py-8 lg:border-b-0 lg:border-r lg:px-10 lg:py-10">
          <div>
            <div className="inline-flex rounded-full border border-[#2b4359] bg-[#122233] px-4 py-2 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[#8ea1b5]">
              SmartLink Kiosk
            </div>
            <h1 className="mt-6 max-w-xl text-[2.6rem] font-semibold leading-[1.05] text-white">
              {isRegistrationMode ? "Register this SmartLink kiosk." : "Scan to unlock station operations on this kiosk."}
            </h1>
            <p className="mt-4 max-w-xl text-[1rem] leading-7 text-[#9ab0c5]">
              {isRegistrationMode
                ? "Internal technical registration is required before station staff can authorize kiosk sessions."
                : "Public kiosks stay locked until authorized station staff approve a short-lived session from their phone."}
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <InfoCard label="Station" value={isRegistrationMode ? "Not assigned yet" : challenge?.stationName || "Awaiting registration"} />
            <InfoCard label="Kiosk" value={kioskLocation} />
            <InfoCard label="Session" value={isRegistrationMode ? "Internal setup required" : "Limited kiosk permissions"} />
          </div>
        </section>

        <section className="px-8 py-8 lg:px-10 lg:py-10">
          <div className="text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-[#8ea1b5]">
            {isRegistrationMode ? "Kiosk Registration" : "Phone Authorization"}
          </div>
          <h2 className="mt-3 text-[1.9rem] font-semibold text-white">
            {isRegistrationMode ? "Scan with internal app" : "Approve on staff phone"}
          </h2>
          <p className="mt-2 text-sm text-[#8ea1b5]">
            {isRegistrationMode
              ? "Scan the code as a platform owner or infrastructure engineer, then assign the station and kiosk details."
              : "Scan the code with a logged-in station staff phone. Do not enter staff passwords on this kiosk."}
          </p>

          <div className="mt-8 space-y-5">
            <div className="flex justify-center">
              <div className="rounded-[26px] border border-[#294057] bg-white p-4 shadow-[0_18px_42px_rgba(0,0,0,0.2)]">
                {challenge?.qrImageDataUrl ? (
                  <img
                    src={challenge.qrImageDataUrl}
                    alt={isRegistrationMode ? "Kiosk registration QR code" : "Kiosk authorization QR code"}
                    className="h-[252px] w-[252px] rounded-[18px] bg-white"
                  />
                ) : (
                  <div className="grid h-[252px] w-[252px] place-items-center rounded-[18px] bg-[#eef4f8] text-center text-sm font-semibold text-[#35516d]">
                    {isLoading ? "Creating QR..." : "QR unavailable"}
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-3 rounded-[20px] border border-[#294057] bg-[#111d2a] px-5 py-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-[#8ea1b5]">
                  Display code
                </span>
                <span className="rounded-[12px] border border-[#3b536a] bg-[#172638] px-3 py-1 text-[1.25rem] font-semibold tracking-[0.16em] text-white">
                  {challenge?.displayCode || "--- ---"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 text-sm text-[#9ab0c5]">
                <span>Expires in</span>
                <strong className="text-[#ecf3fb]">{secondsLeft}s</strong>
              </div>
            </div>

            {error ? (
              <div className="rounded-[16px] border border-[#533a2b] bg-[#221913] px-4 py-3 text-sm text-[#d2ad8f]">
                {error}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => void refreshActiveQr()}
              disabled={isLoading}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-[18px] bg-[#16324f] text-[1rem] font-semibold text-white transition hover:bg-[#10273e] disabled:cursor-not-allowed disabled:bg-[#27435e]"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              {isLoading ? "Refreshing..." : "Refresh QR"}
            </button>

            <div className="grid gap-3 rounded-[18px] border border-[#1d3040] bg-[#0d1824] px-4 py-4 text-sm text-[#9ab0c5]">
              <div className="flex items-start gap-3">
                <Smartphone className="mt-0.5 h-4 w-4 text-[#8ea1b5]" />
                <span>
                  {isRegistrationMode
                    ? "Internal staff must sign in on their own device to register this kiosk."
                    : "Staff approve on their own phone after normal SmartLink login."}
                </span>
              </div>
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-[#8ea1b5]" />
                <span>
                  {isRegistrationMode
                    ? "Registration only links this device to a station; it does not unlock staff operations."
                    : "The kiosk receives only a short-lived, scoped operations session."}
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-[#1d3040] bg-[#111d2a] px-5 py-5">
      <div className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[#8ea1b5]">{label}</div>
      <div className="mt-3 text-[1rem] font-semibold text-[#ecf3fb]">{value}</div>
    </div>
  )
}
