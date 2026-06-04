import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from './ui/input-otp'
import { LoginMotionPanel, type LoginMotionFocus, useLoginMotionTheme } from './LoginMotion'

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
  successGate = false,
  successLoading = false,
  onSuccessAnimationComplete,
  loading,
  error,
}: {
  onLogin: (credentials: { email: string; password: string }) => Promise<any> | void
  onVerifyCode: (payload: { challengeId: string; code: string; trustDevice?: boolean }) => Promise<any> | void
  onResendCode: (payload?: { challengeId?: string }) => Promise<any> | void
  onCancelCode: () => void
  pendingChallenge?: LoginChallenge | null
  successGate?: boolean
  successLoading?: boolean
  onSuccessAnimationComplete?: () => void
  loading: boolean
  error: string
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [trustDevice, setTrustDevice] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [motionFocus, setMotionFocus] = useState<LoginMotionFocus>(null)

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

  const showSuccessStep = Boolean(successGate)
  const showCodeStep = !showSuccessStep && Boolean(pendingChallenge?.challengeId)
  const motionMode = showSuccessStep ? 'success' : showCodeStep ? 'code' : 'entry'
  const motionTheme = useLoginMotionTheme()
  const isDarkMotionTheme = motionTheme === 'dark'
  const motionAttention = showCodeStep
    ? code.length / 6
    : motionFocus === 'email'
    ? Math.min(1, email.length / 28)
    : motionFocus === 'password'
    ? Math.min(1, password.length / 18)
    : 0

  if (showSuccessStep) {
    return (
      <main className={`mera-login-root grid min-h-screen w-full place-items-center px-5 py-8 ${isDarkMotionTheme ? 'bg-[#0f1117] text-white' : 'bg-white text-[#111827]'}`}>
        <section className="mera-login-success-surface grid w-full max-w-[36rem] justify-items-center gap-6 text-center" aria-label="MERA workspace loading">
          <SmartLinkMark size="lg" />
          <div className="h-[min(42vh,320px)] min-h-[220px] w-[min(78vw,360px)]">
            <LoginMotionPanel
              mode="success"
              successLoading={successLoading}
              onSuccessAnimationComplete={onSuccessAnimationComplete}
            />
          </div>
          <div className="grid gap-2">
            <h1 className={`m-0 text-[22px] font-semibold leading-tight tracking-[-0.045em] ${isDarkMotionTheme ? 'text-white' : 'text-[#111827]'}`}>Access approved</h1>
            <p className={`m-0 text-[12px] font-medium leading-5 tracking-[-0.015em] ${isDarkMotionTheme ? 'text-white/64' : 'text-[#6b7280]'}`}>
              {successLoading ? 'Preparing the MERA command workspace.' : 'Opening the command workspace.'}
            </p>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="mera-login-root flex min-h-screen w-full items-center justify-center overflow-x-hidden bg-white px-4 py-5 text-[#111827] sm:px-6">
      <section className="mera-login-stage grid min-h-[min(650px,calc(100vh-32px))] w-full max-w-[76rem] items-stretch lg:grid-cols-2" data-step={showCodeStep ? 'code' : 'credentials'}>
        <div className="mera-login-form-panel grid min-w-0 content-center rounded-[8px] bg-white px-8 py-10 transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] sm:px-12 lg:px-[clamp(42px,5vw,72px)]">
          <div className="w-full max-w-[342px] justify-self-center">
          <SmartLinkMark className="mb-7" />

          <header>
            <h1 className="m-0 text-[28px] font-semibold leading-[1.02] tracking-[-0.06em] text-[#111111]">
              {showCodeStep ? 'Verify code' : 'Login'}
            </h1>
            <p className="mt-2.5 text-[12px] font-medium leading-[1.45] tracking-[-0.012em] text-[#111827]/70">
              {showCodeStep
                ? `Enter the code sent to ${pendingChallenge?.maskedEmail || 'your MERA email'}`
                : 'Enter your credentials to get in'}
            </p>
          </header>

          <div className="h-8" aria-hidden="true" />

          {showCodeStep ? (
            <form
              className="grid gap-7"
              onSubmit={(event) => {
                event.preventDefault()
                if (!pendingChallenge?.challengeId || code.length !== 6) return
                onVerifyCode({ challengeId: pendingChallenge.challengeId, code, trustDevice })
              }}
            >
              <div className="grid gap-2">
                <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b7280]">Login code</label>
                <InputOTP
                  value={code}
                  onChange={setCode}
                  maxLength={6}
                  containerClassName="gap-2"
                  onFocusCapture={() => setMotionFocus('code')}
                  onBlurCapture={() => setMotionFocus(null)}
                >
                  <InputOTPGroup className="gap-2">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <InputOTPSlot
                        // eslint-disable-next-line react/no-array-index-key
                        key={index}
                        index={index}
                        className="h-11 w-10 rounded-[6px] border border-[#d9dce3] bg-white text-[16px] font-semibold text-[#111111] shadow-none first:rounded-[6px] first:border last:rounded-[6px] focus:border-[#111111] focus:ring-2 focus:ring-[#111111]/10"
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
                {expiryLabel ? <p className="m-0 text-[12px] leading-5 text-[#747984]">Code expires at {expiryLabel}.</p> : null}
              </div>

              <label className="grid gap-2 rounded-[6px] border border-[#e2e5eb] bg-white px-3.5 py-3 text-[12px] leading-5 text-[#3f444d] shadow-none">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b7280]">Trusted browser</span>
                <span className="flex items-start gap-3">
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
                </span>
              </label>

              {error ? <p className="m-0 rounded-[8px] border border-[#efcaca] bg-[#fff1f1] px-3 py-2 text-[12px] leading-[1.45] text-[#9b3838]">{error}</p> : null}

              <Button
                type="submit"
                className="h-10 w-full rounded-[5px] border border-[#111111] bg-[#111111] text-[12px] font-semibold tracking-[-0.018em] text-white shadow-[0_8px_18px_rgba(0,0,0,0.14)] transition hover:-translate-y-px hover:bg-[#000000] hover:shadow-[0_12px_24px_rgba(0,0,0,0.16)] active:translate-y-0"
                disabled={loading || code.length !== 6}
              >
                {loading ? 'Verifying...' : 'Verify code'}
              </Button>

              <div className="flex flex-wrap items-center justify-between gap-3 text-[14px] text-[#747984]">
                <button
                  type="button"
                  onClick={onCancelCode}
                  className="inline-flex items-center gap-1.5 text-[13px] font-medium tracking-[-0.015em] text-[#6c707b] transition-colors hover:text-[#111111]"
                >
                  <ArrowLeft className="size-4" />
                  Change email
                </button>
                <button
                  type="button"
                  onClick={() => onResendCode({ challengeId: pendingChallenge?.challengeId })}
                  disabled={loading || resendWait > 0}
                  className="text-[13px] font-semibold tracking-[-0.015em] text-[#111111] underline underline-offset-4 disabled:cursor-wait disabled:text-[#9aa0aa] disabled:no-underline"
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
              <label className="block min-w-0">
                <span className="mb-1.5 block text-[13px] font-semibold tracking-[0.08em] text-[#6b7280]">Email</span>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  onFocus={() => setMotionFocus('email')}
                  onBlur={() => setMotionFocus(null)}
                  placeholder="officer@mera.mw"
                  required
                  className="h-10 rounded-[6px] border-[#d9dce3] bg-white px-3 text-[13px] font-medium text-[#111111] shadow-none placeholder:text-[#8b929d] focus-visible:border-[#111111] focus-visible:ring-[#111111]/10"
                />
              </label>

              <div className="min-w-0">
                <span className="mb-1.5 flex items-center justify-between gap-4">
                  <span className="text-[13px] font-semibold tracking-[0.08em] text-[#6b7280]">Password</span>
                  <button type="button" className="text-[12px] font-medium tracking-[-0.012em] text-[#6c707b] transition-colors hover:text-[#111111]">
                    Forgot password?
                  </button>
                </span>
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onFocus={() => setMotionFocus('password')}
                  onBlur={() => setMotionFocus(null)}
                  placeholder="Enter password"
                  required
                  className="h-10 rounded-[6px] border-[#d9dce3] bg-white px-3 text-[13px] font-medium text-[#111111] shadow-none placeholder:text-[#8b929d] focus-visible:border-[#111111] focus-visible:ring-[#111111]/10"
                />
              </div>

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
                className="mt-[-2px] h-10 w-full rounded-[5px] border border-[#111111] bg-[#111111] text-[12px] font-semibold tracking-[-0.018em] text-white shadow-[0_8px_18px_rgba(0,0,0,0.14)] transition hover:-translate-y-px hover:bg-[#000000] hover:shadow-[0_12px_24px_rgba(0,0,0,0.16)] active:translate-y-0"
                disabled={loading}
              >
                {loading ? 'Signing in...' : 'Log in'}
              </Button>

              <p className="m-0 text-center text-[12px] font-medium leading-[1.4] tracking-[-0.012em] text-[#747984]">
                First time around here?{' '}
                <button type="button" className="font-bold text-[#111111] underline underline-offset-4">
                  Contact administrator
                </button>
              </p>
            </form>
          )}
          </div>
        </div>

        <aside className="mera-login-media-panel relative min-h-[420px] min-w-0 overflow-hidden rounded-[8px] transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] lg:min-h-full" aria-label="SmartLink secure portal access">
          <div className="absolute inset-0 grid place-items-center">
            <LoginMotionPanel
              mode={motionMode}
              focus={motionFocus}
              attention={motionAttention}
              error={error}
              successLoading={successLoading}
              onSuccessAnimationComplete={onSuccessAnimationComplete}
            />
          </div>
        </aside>
      </section>
    </main>
  )
}

function SmartLinkMark({
  className = '',
  size = 'md',
  flat = false,
}: {
  className?: string
  size?: 'sm' | 'md' | 'lg'
  flat?: boolean
}) {
  const sizes = {
    sm: 'size-8 rounded-[8px]',
    md: 'size-[38px] rounded-[9px]',
    lg: 'size-14 rounded-[14px]',
  }
  const imageSizes = {
    sm: 'size-7',
    md: 'size-9',
    lg: 'size-12',
  }

  return (
    <span
      className={`inline-grid place-items-center overflow-hidden ${sizes[size]} ${
        flat ? 'bg-transparent' : 'bg-white shadow-[0_8px_24px_rgba(15,23,42,0.08)] ring-1 ring-[#dbe6ee]'
      } ${className}`}
      aria-hidden="true"
    >
      <img src="/smartlink-mark-tight.png" alt="" className={`${imageSizes[size]} object-contain`} />
    </span>
  )
}
