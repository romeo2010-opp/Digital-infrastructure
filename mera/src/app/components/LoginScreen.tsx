import { useEffect, useMemo, useState } from 'react'
import { DotLottieReact } from '@lottiefiles/dotlottie-react'
import { ArrowLeft, Check, MailCheck, Shield } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from './ui/input-otp'

type LoginChallenge = {
  challengeId: string
  maskedEmail?: string
  expiresAt?: string
  resendAvailableAt?: string
}

export function LoginScreen({
  onLogin,
  onVerifyCode,
  onResendCode,
  onCancelCode,
  pendingChallenge,
  loading,
  error,
}: {
  onLogin: (credentials: { email: string; password: string }) => Promise<any> | void
  onVerifyCode: (payload: { challengeId: string; code: string; trustDevice?: boolean }) => Promise<any> | void
  onResendCode: (payload?: { challengeId?: string }) => Promise<any> | void
  onCancelCode: () => void
  pendingChallenge?: LoginChallenge | null
  loading: boolean
  error: string
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [trustDevice, setTrustDevice] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!pendingChallenge) return undefined
    setCode('')
    setTrustDevice(false)
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [pendingChallenge?.challengeId])

  const resendWait = useMemo(() => {
    const date = pendingChallenge?.resendAvailableAt ? new Date(pendingChallenge.resendAvailableAt) : null
    if (!date || Number.isNaN(date.getTime())) return 0
    return Math.max(0, Math.ceil((date.getTime() - now) / 1000))
  }, [now, pendingChallenge?.resendAvailableAt])

  const expiryLabel = useMemo(() => {
    const date = pendingChallenge?.expiresAt ? new Date(pendingChallenge.expiresAt) : null
    if (!date || Number.isNaN(date.getTime())) return ''
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }, [pendingChallenge?.expiresAt])

  const showCodeStep = Boolean(pendingChallenge?.challengeId)

  return (
    <main className="flex min-h-screen w-full items-center justify-center overflow-x-hidden bg-white px-4 py-5 text-[#292a2e] sm:px-6">
      <section className="grid min-h-[min(622px,calc(100vh-40px))] w-full max-w-[76rem] items-stretch gap-8 lg:grid-cols-[minmax(340px,400px)_minmax(520px,1fr)] lg:gap-[clamp(48px,9vw,149px)]">
        <div className="grid min-w-0 content-start pt-1 sm:pt-4">
          <span className="mb-7 inline-grid size-[34px] place-items-center overflow-hidden rounded-[8px] bg-[#83e3e2] text-[#172023]" aria-hidden="true">
            <Shield className="size-[18px]" />
          </span>

          <header>
            <h1 className="m-0 text-[25px] font-bold leading-[1.12] tracking-[0] text-[#2c2d31]">
              {showCodeStep ? 'Check your email' : 'Welcome back'}
            </h1>
            <p className="mt-2.5 text-[14px] leading-[1.45] text-[#6f7480]">
              {showCodeStep
                ? `Enter the code sent to ${pendingChallenge?.maskedEmail || 'your MERA email'}`
                : 'Log in to your MERA operations account'}
            </p>
          </header>

          <div className="my-9 grid grid-cols-[1fr_auto_1fr] items-center gap-5 text-[13px] font-bold leading-none text-[#6f7480]" aria-hidden="true">
            <span className="h-px bg-[#dddddf]" />
            <strong>{showCodeStep ? 'continue with code' : 'continue with email'}</strong>
            <span className="h-px bg-[#dddddf]" />
          </div>

          {showCodeStep ? (
            <form
              className="grid gap-7"
              onSubmit={(event) => {
                event.preventDefault()
                if (!pendingChallenge?.challengeId || code.length !== 6) return
                onVerifyCode({ challengeId: pendingChallenge.challengeId, code, trustDevice })
              }}
            >
              <div className="grid gap-3">
                <label className="text-[14px] font-medium leading-[1.2] text-[#25262a]">Login code</label>
                <InputOTP value={code} onChange={setCode} maxLength={6} containerClassName="gap-2">
                  <InputOTPGroup className="gap-2">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <InputOTPSlot
                        // eslint-disable-next-line react/no-array-index-key
                        key={index}
                        index={index}
                        className="h-11 w-10 rounded-[8px] border border-[#d9e1ef] bg-[#ecfbfb] text-[16px] font-semibold text-[#111318] shadow-[0_1px_3px_rgba(17,24,39,0.08)] first:rounded-[8px] first:border last:rounded-[8px]"
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
                {expiryLabel ? <p className="m-0 text-[12px] leading-5 text-[#747984]">Code expires at {expiryLabel}.</p> : null}
              </div>

              <label className="flex items-start gap-3 rounded-[8px] border border-[#d8d8d8] bg-white px-3.5 py-3 text-[13px] leading-5 text-[#3f444d] shadow-[0_1px_2px_rgba(17,24,39,0.08)]">
                <input
                  type="checkbox"
                  checked={trustDevice}
                  onChange={(event) => setTrustDevice(event.target.checked)}
                  className="mt-1 size-4 rounded border-[#cbd5e1] accent-[#19c7ca]"
                />
                <span>
                  <span className="block font-semibold text-[#25262a]">Trust this browser for 30 days</span>
                  <span className="text-[#747984]">Skip the email code here unless MERA needs step-up verification.</span>
                </span>
              </label>

              {error ? <p className="m-0 rounded-[8px] border border-[#efcaca] bg-[#fff1f1] px-3 py-2 text-[12px] leading-[1.45] text-[#9b3838]">{error}</p> : null}

              <Button
                type="submit"
                className="h-10 w-full rounded-[8px] border border-[#24262a] bg-[#2b2d31] text-[14px] font-semibold text-white shadow-none hover:bg-[#202226]"
                disabled={loading || code.length !== 6}
              >
                {loading ? 'Verifying...' : 'Verify code'}
              </Button>

              <div className="flex flex-wrap items-center justify-between gap-3 text-[14px] text-[#747984]">
                <button
                  type="button"
                  onClick={onCancelCode}
                  className="inline-flex items-center gap-1.5 font-medium text-[#6c707b] transition-colors hover:text-[#2c2d31]"
                >
                  <ArrowLeft className="size-4" />
                  Change email
                </button>
                <button
                  type="button"
                  onClick={() => onResendCode({ challengeId: pendingChallenge?.challengeId })}
                  disabled={loading || resendWait > 0}
                  className="font-semibold text-[#292a2e] underline underline-offset-4 disabled:cursor-wait disabled:text-[#9aa0aa] disabled:no-underline"
                >
                  {resendWait > 0 ? `Resend in ${resendWait}s` : 'Resend code'}
                </button>
              </div>
            </form>
          ) : (
            <form
              className="grid gap-7"
              onSubmit={(event) => {
                event.preventDefault()
                onLogin({ email: email.trim(), password })
              }}
            >
              <label className="grid gap-3 text-[14px] font-medium leading-[1.2] text-[#25262a]">
                <span>Email</span>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="officer@mera.mw"
                  required
                  className="h-10 rounded-[8px] border-[#d9e1ef] bg-[#ecfbfb] px-3 text-[13px] text-[#111318] shadow-[0_1px_3px_rgba(17,24,39,0.08)] placeholder:text-[#1f2937]/80 focus-visible:border-[#9ddfdc] focus-visible:ring-[rgba(25,199,202,0.24)]"
                />
              </label>

              <label className="grid gap-3 text-[14px] font-medium leading-[1.2] text-[#25262a]">
                <span className="flex items-center justify-between gap-4">
                  <span>Password</span>
                  <button type="button" className="text-[14px] font-medium text-[#6c707b] transition-colors hover:text-[#2c2d31]">
                    Forgot password?
                  </button>
                </span>
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter password"
                  required
                  className="h-10 rounded-[8px] border-[#d9e1ef] bg-[#ecfbfb] px-3 text-[13px] text-[#111318] shadow-[0_1px_3px_rgba(17,24,39,0.08)] placeholder:text-[#1f2937]/80 focus-visible:border-[#9ddfdc] focus-visible:ring-[rgba(25,199,202,0.24)]"
                />
              </label>

              <div className="grid min-h-[76px] w-full max-w-[302px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[2px] border border-[#d8d8d8] bg-white px-3 py-3.5 pl-[18px] shadow-[0_1px_2px_rgba(17,24,39,0.08)]" aria-label="Verification placeholder">
                <span className="block size-[25px] rotate-[-45deg] border-2 border-r-0 border-t-0 border-[#11875d]" aria-hidden="true" />
                <span className="text-[14px] leading-[1.2] text-[#202124]">I&apos;m not a robot</span>
                <span className="grid justify-items-center gap-1 text-[10px] leading-none text-[#6c707b]" aria-hidden="true">
                  <span className="size-[29px] rounded-[6px] bg-[conic-gradient(from_45deg,#19c7ca_0_25%,transparent_0_42%,#19c7ca_0_62%,transparent_0_100%),linear-gradient(135deg,#f7f8fb,#dfe8f8)]" />
                  <small>reCAPTCHA</small>
                </span>
              </div>

              {error ? <p className="m-0 rounded-[8px] border border-[#efcaca] bg-[#fff1f1] px-3 py-2 text-[12px] leading-[1.45] text-[#9b3838]">{error}</p> : null}

              <Button
                type="submit"
                className="mt-[-2px] h-10 w-full rounded-[8px] border border-[#24262a] bg-[#2b2d31] text-[14px] font-semibold text-white shadow-none hover:bg-[#202226]"
                disabled={loading}
              >
                {loading ? 'Signing in...' : 'Log in'}
              </Button>

              <p className="m-0 text-center text-[14px] leading-[1.4] text-[#747984]">
                First time around here?{' '}
                <button type="button" className="font-bold text-[#292a2e] underline underline-offset-4">
                  Contact administrator
                </button>
              </p>
            </form>
          )}
        </div>

        <aside className="relative min-h-[360px] min-w-0 overflow-hidden rounded-[8px] bg-[#17181b] md:min-h-[440px] lg:min-h-full" aria-label="MERA secure portal access">
          <div className="absolute left-7 top-7 z-10 flex items-center gap-2 text-white">
            <span className="grid size-8 place-items-center rounded-[8px] bg-[#83e3e2] text-[#172023]">
              {showCodeStep ? <MailCheck className="size-4" /> : <Shield className="size-4" />}
            </span>
            <span className="text-[13px] font-semibold">MERA secure access</span>
          </div>
          <div className="absolute bottom-7 left-7 right-7 z-10 grid gap-2 text-white">
            <div className="inline-flex w-fit items-center gap-2 rounded-[8px] border border-white/15 bg-white/10 px-3 py-2 text-[12px] font-semibold backdrop-blur">
              <Check className="size-4 text-[#83e3e2]" />
              Email code protection
            </div>
            <p className="m-0 max-w-[26rem] text-[13px] leading-5 text-white/70">
              Regulatory access stays tied to verified MERA inboxes and trusted workstations.
            </p>
          </div>
          <div className="absolute inset-0 grid place-items-center px-8 py-14">
            <DotLottieReact
              src="/animations/mera-login.lottie"
              loop
              autoplay
              className="h-full max-h-[520px] min-h-[280px] w-full max-w-[620px]"
            />
          </div>
        </aside>
      </section>
    </main>
  )
}
