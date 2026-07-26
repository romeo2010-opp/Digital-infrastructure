import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from './ui/input-otp'
import { readLastLoginAppearance } from '../lib/loginAppearanceCache'

type LoginChallenge = {
  challengeId: string
  maskedEmail?: string
  expiresAt?: string
  resendAvailableAt?: string
}

const loginFont = {
  fontFamily: 'Poppins, "Geist Variable", Geist, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
}

const fieldLabelClass = 'mb-1.5 block text-[13px] font-semibold leading-none text-[var(--login-text)]'
const inputClass = 'h-9 rounded-[6px] border-[color:var(--login-input-border)] bg-[var(--login-input-bg)] px-3 text-[13px] font-medium text-[var(--login-text)] shadow-[0_1px_4px_rgba(0,0,0,0.09)] placeholder:text-[var(--login-muted)] focus-visible:border-[color:var(--login-focus-border)] focus-visible:ring-0'
const primaryButtonClass = 'h-9 rounded-[6px] border-0 bg-[#6bdd9e] text-[14px] font-semibold text-[#111111] shadow-none transition hover:bg-[#5dd38f] active:translate-y-px'
const loginAccentPalette: Record<string, { accent: string; hover: string; foreground: string }> = {
  smartlink: { accent: '#6bdd9e', hover: '#5dd38f', foreground: '#111111' },
  navy: { accent: '#111827', hover: '#1f2937', foreground: '#ffffff' },
  emerald: { accent: '#047857', hover: '#065f46', foreground: '#ffffff' },
  graphite: { accent: '#334155', hover: '#1f2937', foreground: '#ffffff' },
  copper: { accent: '#b45309', hover: '#92400e', foreground: '#ffffff' },
}

function boundedNumber(value: any, fallback: number, min: number, max: number) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, number))
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
  onLogin: (credentials: { email?: string; schoolCode?: string; school_code?: string; studentCode?: string; student_code?: string; password: string; loginType?: string; login_type?: string }) => Promise<any> | void
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
  const [mode, setMode] = useState<'student' | 'staff'>('student')
  const [email, setEmail] = useState('')
  const [schoolCode, setSchoolCode] = useState('')
  const [studentCode, setStudentCode] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [trustDevice, setTrustDevice] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [loginAppearance] = useState<any>(() => readLastLoginAppearance())

  useEffect(() => {
    if (!pendingChallenge) return undefined
    setCode('')
    setTrustDevice(false)
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [pendingChallenge?.challengeId])

  useEffect(() => {
    if (!successGate || successLoading || !onSuccessAnimationComplete) return undefined
    const timer = window.setTimeout(onSuccessAnimationComplete, 650)
    return () => window.clearTimeout(timer)
  }, [onSuccessAnimationComplete, successGate, successLoading])

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
  const isStudentMode = mode === 'student'
  const hasLoginWallpaper = Boolean(loginAppearance?.dashboardBackgroundImage && loginAppearance?.dashboardBackgroundEnabled !== false)
  const loginDim = boundedNumber(loginAppearance?.dashboardBackgroundDim, 74, 0, 92) / 100
  const transparentLoginForm = Boolean(loginAppearance?.transparentSectionsEnabled)
  const cardAlpha = transparentLoginForm
    ? Math.max(0.45, Math.min(1, 1 - boundedNumber(loginAppearance?.sectionTransparency, 0, 0, 75) / 100))
    : 1
  const sectionBlur = transparentLoginForm ? boundedNumber(loginAppearance?.sectionBlur, 10, 0, 28) : 0
  const useDarkLoginText = ['dark', 'black-white'].includes(String(loginAppearance?.appearance || ''))
  const loginAccent = loginAccentPalette[String(loginAppearance?.accentTone || 'smartlink')] || loginAccentPalette.smartlink
  const rootStyle = useMemo(() => {
    const base: any = {
      ...loginFont,
      '--login-text': useDarkLoginText ? '#f7f7f2' : '#191919',
      '--login-muted': useDarkLoginText ? '#d6d6cf' : '#747474',
      '--login-link': loginAccent.accent,
      '--login-accent': loginAccent.accent,
      '--login-accent-hover': loginAccent.hover,
      '--login-accent-foreground': loginAccent.foreground,
      '--login-input-bg': useDarkLoginText ? 'rgba(20,20,18,0.58)' : 'rgba(255,255,255,0.86)',
      '--login-input-border': useDarkLoginText ? 'rgba(255,255,255,0.24)' : 'rgba(210,210,210,0.86)',
      '--login-focus-border': loginAccent.accent,
    }
    if (!hasLoginWallpaper) {
      return {
        ...base,
        backgroundColor: useDarkLoginText ? '#1c1c1a' : '#eeeeee',
      }
    }
    return {
      ...base,
      backgroundImage: `linear-gradient(rgba(0,0,0,${loginDim}), rgba(0,0,0,${loginDim})), url("${loginAppearance.dashboardBackgroundImage}")`,
      backgroundPosition: `${boundedNumber(loginAppearance?.dashboardBackgroundX, 50, 0, 100)}% ${boundedNumber(loginAppearance?.dashboardBackgroundY, 50, 0, 100)}%`,
      backgroundSize: loginAppearance?.dashboardBackgroundMode === 'custom' ? `${boundedNumber(loginAppearance?.dashboardBackgroundScale, 100, 20, 300)}% auto` : String(loginAppearance?.dashboardBackgroundMode || 'cover'),
      backgroundRepeat: 'no-repeat',
      backgroundAttachment: 'fixed',
      backgroundColor: '#1c1c1a',
    }
  }, [cardAlpha, hasLoginWallpaper, loginAccent, loginAppearance, loginDim, useDarkLoginText])
  const cardStyle = useMemo(() => ({
    backgroundColor: useDarkLoginText ? `rgba(26,26,24,${cardAlpha})` : `rgba(255,255,255,${cardAlpha})`,
    border: transparentLoginForm ? `1px solid ${useDarkLoginText ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.58)'}` : '1px solid transparent',
    backdropFilter: transparentLoginForm ? `blur(${sectionBlur}px)` : undefined,
    WebkitBackdropFilter: transparentLoginForm ? `blur(${sectionBlur}px)` : undefined,
    boxShadow: transparentLoginForm ? '0 24px 80px rgba(0,0,0,0.24)' : 'none',
  }), [cardAlpha, sectionBlur, transparentLoginForm, useDarkLoginText])

  const switchMode = (nextMode: 'student' | 'staff') => {
    setMode(nextMode)
    setPassword('')
  }

  return (
    <main className="smartlink-reference-login mera-login-root flex min-h-screen w-full items-center justify-center bg-[#eeeeee] bg-cover px-4 py-8 text-[var(--login-text)] transition-[background-image,background-color] duration-300" style={rootStyle}>
      <section className="w-full max-w-[385px] rounded-[15px] px-7 py-8 sm:px-8" style={cardStyle}>
        <header className="text-center">
          <h1 className="m-0 text-[19px] font-medium uppercase leading-6 tracking-[0.035em] text-[var(--login-text)]">
            {showSuccessStep ? 'SMARTLINK SCHOOLS' : showCodeStep ? 'SMARTLINK SCHOOLS - VERIFY' : 'SMARTLINK SCHOOLS - PORTAL'}
          </h1>
          <p className="mx-auto mt-1.5 max-w-[275px] text-[13px] font-normal leading-5 text-[var(--login-muted)]">
            {showSuccessStep
              ? successLoading ? 'Preparing your school workspace' : 'Opening your school workspace'
              : showCodeStep
              ? `Enter the code sent to ${pendingChallenge?.maskedEmail || 'your school email'}`
              : isStudentMode
              ? 'Students can open results, fees, homework and notices here'
              : 'Staff and parents can enter their email and password to access their workspace'}
          </p>
        </header>

        {showSuccessStep ? (
          <div className="mt-9 grid justify-items-center gap-4">
            <span className="size-9 animate-spin rounded-full border-2 border-[#dddddd] border-t-[#6bdd9e]" aria-hidden="true" />
            <p className="m-0 text-[13px] font-semibold text-[var(--login-text)]">{successLoading ? 'Loading...' : 'Access approved'}</p>
          </div>
        ) : showCodeStep ? (
          <form
            className="mt-8 grid gap-5"
            onSubmit={(event) => {
              event.preventDefault()
              if (!pendingChallenge?.challengeId || code.length !== 6) return
              onVerifyCode({ challengeId: pendingChallenge.challengeId, code, trustDevice })
            }}
          >
            <div>
              <label className={fieldLabelClass}>Login Code</label>
              <InputOTP value={code} onChange={setCode} maxLength={6} containerClassName="justify-between gap-2">
                <InputOTPGroup className="gap-2">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <InputOTPSlot
                      // eslint-disable-next-line react/no-array-index-key
                      key={index}
                      index={index}
                      className="h-10 w-10 rounded-[6px] border border-[color:var(--login-input-border)] bg-[var(--login-input-bg)] text-[15px] font-semibold text-[var(--login-text)] shadow-[0_1px_4px_rgba(0,0,0,0.09)] first:rounded-[6px] first:border last:rounded-[6px] focus:border-[color:var(--login-focus-border)] focus:ring-0"
                    />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              {expiryLabel ? <p className="m-0 mt-2 text-[12px] leading-5 text-[var(--login-muted)]">Code expires at {expiryLabel}.</p> : null}
            </div>

            <label className="flex items-start gap-2 text-[12px] leading-5 text-[var(--login-muted)]">
              <input
                type="checkbox"
                checked={trustDevice}
                onChange={(event) => setTrustDevice(event.target.checked)}
                className="mt-1 size-4 rounded border-[#cfcfcf] accent-[#6bdd9e]"
              />
              Trust this browser for 30 days
            </label>

            {error ? <p className="m-0 rounded-[6px] border border-[#efcaca] bg-[#fff1f1] px-3 py-2 text-[12px] leading-[1.45] text-[#9b3838]">{error}</p> : null}

            <Button type="submit" className={primaryButtonClass} disabled={loading || code.length !== 6}>
              {loading ? 'Verifying...' : 'Verify Code'}
            </Button>

            <div className="flex items-center justify-between gap-3 text-[13px]">
              <button type="button" onClick={onCancelCode} className="inline-flex items-center gap-1.5 font-medium text-[var(--login-text)] hover:underline">
                <ArrowLeft className="size-3.5" />
                Change email
              </button>
              <button
                type="button"
                onClick={() => onResendCode({ challengeId: pendingChallenge?.challengeId })}
                disabled={loading || resendWait > 0}
                className="font-medium text-[var(--login-link)] hover:underline disabled:text-[#9b9b9b] disabled:no-underline"
              >
                {resendWait > 0 ? `Resend in ${resendWait}s` : 'Resend code'}
              </button>
            </div>
          </form>
        ) : (
          <form
            className="mt-8 grid gap-5"
            onSubmit={(event) => {
              event.preventDefault()
              if (isStudentMode) {
                onLogin({ login_type: 'student', school_code: schoolCode.trim(), student_code: studentCode.trim(), password })
                return
              }
              onLogin({ email: email.trim(), password })
            }}
          >
            {isStudentMode ? (
              <div className="grid gap-5">
                <label className="block">
                  <span className={fieldLabelClass}>School Code</span>
                  <Input
                    type="text"
                    value={schoolCode}
                    onChange={(event) => setSchoolCode(event.target.value)}
                    placeholder="Ask your school for its code"
                    required
                    autoComplete="organization"
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className={fieldLabelClass}>Student ID / Admission No</span>
                  <Input
                    type="text"
                    value={studentCode}
                    onChange={(event) => setStudentCode(event.target.value)}
                    placeholder="SL-P1-001"
                    required
                    autoComplete="username"
                    className={inputClass}
                  />
                </label>
              </div>
            ) : (
              <label className="block">
                <span className={fieldLabelClass}>Email</span>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@school.edu"
                  required
                  autoComplete="username"
                  className={inputClass}
                />
              </label>
            )}

            <label className="block">
              <span className={fieldLabelClass}>{isStudentMode ? 'Date of Birth' : 'Password'}</span>
              <Input
                type={isStudentMode ? 'date' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={isStudentMode ? 'YYYY-MM-DD' : 'Enter password'}
                required
                autoComplete={isStudentMode ? 'bday' : 'current-password'}
                className={inputClass}
              />
            </label>

            {error ? <p className="m-0 rounded-[6px] border border-[#efcaca] bg-[#fff1f1] px-3 py-2 text-[12px] leading-[1.45] text-[#9b3838]">{error}</p> : null}

            <Button type="submit" className={`mt-3 ${primaryButtonClass}`} disabled={loading}>
              {loading ? 'Signing in...' : isStudentMode ? 'Student Login' : 'Email Login'}
            </Button>

            <p className="m-0 pt-1 text-center text-[13px] font-normal leading-5 text-[var(--login-text)]">
              {isStudentMode ? 'Staff or parent?' : 'Student?'}{' '}
              <button
                type="button"
                className="font-normal text-[var(--login-link)] hover:underline"
                onClick={() => switchMode(isStudentMode ? 'staff' : 'student')}
              >
                {isStudentMode ? 'Click Here' : 'Student Login'}
              </button>
            </p>
          </form>
        )}
      </section>
    </main>
  )
}
