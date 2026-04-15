import { useMemo, useState } from "react"
import { LockKeyhole, UserRound } from "lucide-react"
import { useAuth } from "../auth/AuthContext"

function parseIdentity(identity: string) {
  const trimmed = String(identity || "").trim()
  if (!trimmed) return {}
  if (trimmed.includes("@")) {
    return { email: trimmed.toLowerCase() }
  }
  return { phone: trimmed }
}

export function KioskLoginScreen() {
  const { login } = useAuth()
  const [identity, setIdentity] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const helperLabel = useMemo(() => {
    return identity.includes("@") ? "Signing in with email" : "Use station phone or email"
  }, [identity])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setIsSubmitting(true)
    try {
      await login({
        ...parseIdentity(identity),
        password,
      })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to sign in.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#0b1520] px-6 py-8 text-[#e7edf4]">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[32px] border border-[#1d3040] bg-[#0f1b28] shadow-[0_30px_80px_rgba(0,0,0,0.35)] lg:grid-cols-[minmax(0,1.1fr)_420px]">
        <section className="flex flex-col justify-between border-b border-[#1d3040] px-8 py-8 lg:border-b-0 lg:border-r lg:px-10 lg:py-10">
          <div>
            <div className="inline-flex rounded-full border border-[#2b4359] bg-[#122233] px-4 py-2 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[#8ea1b5]">
              SmartLink Kiosk
            </div>
            <h1 className="mt-6 max-w-xl text-[2.6rem] font-semibold leading-[1.05] text-white">
              Station operations access for live queue, wallet, and pump activity.
            </h1>
            <p className="mt-4 max-w-xl text-[1rem] leading-7 text-[#9ab0c5]">
              Sign in with your station staff account to load the active queue, nearby wallet orders, and current pump session context.
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <InfoCard label="Queue visibility" value="Live station queue state" />
            <InfoCard label="Wallet flow" value="Nearby orders and attachment" />
            <InfoCard label="Pump control" value="Authorization and session completion" />
          </div>
        </section>

        <section className="px-8 py-8 lg:px-10 lg:py-10">
          <div className="text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-[#8ea1b5]">
            Staff Login
          </div>
          <h2 className="mt-3 text-[1.9rem] font-semibold text-white">Enter kiosk credentials</h2>
          <p className="mt-2 text-sm text-[#8ea1b5]">{helperLabel}</p>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <label className="block">
              <span className="mb-2 block text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-[#8ea1b5]">
                Email or phone
              </span>
              <div className="flex h-14 items-center gap-3 rounded-[18px] border border-[#294057] bg-[#111d2a] px-4">
                <UserRound className="h-4 w-4 text-[#8ea1b5]" />
                <input
                  value={identity}
                  onChange={(event) => setIdentity(event.target.value)}
                  placeholder="staff@smartlink.mw or +265..."
                  className="h-full w-full bg-transparent text-[1rem] text-white outline-none placeholder:text-[#60778d]"
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-2 block text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-[#8ea1b5]">
                Password
              </span>
              <div className="flex h-14 items-center gap-3 rounded-[18px] border border-[#294057] bg-[#111d2a] px-4">
                <LockKeyhole className="h-4 w-4 text-[#8ea1b5]" />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter password"
                  className="h-full w-full bg-transparent text-[1rem] text-white outline-none placeholder:text-[#60778d]"
                />
              </div>
            </label>

            {error ? (
              <div className="rounded-[16px] border border-[#533a2b] bg-[#221913] px-4 py-3 text-sm text-[#d2ad8f]">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="h-14 w-full rounded-[18px] bg-[#16324f] text-[1rem] font-semibold text-white transition hover:bg-[#10273e] disabled:cursor-not-allowed disabled:bg-[#27435e]"
            >
              {isSubmitting ? "Signing in..." : "Sign In"}
            </button>
          </form>
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
