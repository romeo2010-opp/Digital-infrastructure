import { useEffect, useState } from 'react'

export type LoginMotionMode = 'entry' | 'code' | 'success'
export type LoginMotionFocus = 'email' | 'password' | 'code' | null
type LoginMotionTheme = 'light' | 'dark'

const loadingPhrases = [
  'Getting system ready',
  'Optimizing usage',
  'Loading compliance data',
  'Preparing secure workspace',
]

export function useLoginMotionTheme(): LoginMotionTheme {
  const [theme, setTheme] = useState<LoginMotionTheme>('light')

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined

    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    const update = () => {
      const root = document.documentElement
      const explicitDark =
        root.classList.contains('dark') ||
        root.dataset.theme === 'dark' ||
        root.dataset.meraTheme === 'dark'
      setTheme(explicitDark || Boolean(media?.matches) ? 'dark' : 'light')
    }

    update()
    media?.addEventListener?.('change', update)
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'data-mera-theme'],
    })

    return () => {
      media?.removeEventListener?.('change', update)
      observer.disconnect()
    }
  }, [])

  return theme
}

export function LoginMotionPanel({
  mode,
  focus: _focus = null,
  attention: _attention = 0,
  error: _error = '',
  successLoading = false,
  onSuccessAnimationComplete,
  className = '',
}: {
  mode: LoginMotionMode
  focus?: LoginMotionFocus
  attention?: number
  error?: string
  successLoading?: boolean
  onSuccessAnimationComplete?: () => void
  className?: string
}) {
  const theme = useLoginMotionTheme()

  if (mode === 'success') {
    return (
      <div className={`grid h-full w-full place-items-center ${className}`} data-login-motion-theme={theme}>
        <SmartLinkLoadingGate
          successLoading={successLoading}
          onSuccessAnimationComplete={onSuccessAnimationComplete}
        />
      </div>
    )
  }

  return (
    <div className={`grid h-full w-full place-items-center ${className}`} data-login-motion-theme={theme}>
      <SmartLinkInfrastructureVisual mode={mode} />
    </div>
  )
}

function SmartLinkInfrastructureVisual({ mode }: { mode: Exclude<LoginMotionMode, 'success'> }) {
  return (
    <div className="mera-login-visual-scene relative grid h-full min-h-[360px] w-full overflow-hidden rounded-[8px]">
      <div className="absolute inset-0 mera-login-visual-grid" />
      <div className="absolute left-7 top-7 z-10 flex items-center gap-2 text-white">
        <span className="grid size-9 place-items-center overflow-hidden rounded-full bg-white shadow-[0_14px_34px_rgba(0,0,0,0.28)]">
          <img src="/smartlink-mark-tight.png" alt="" className="size-8 object-contain" />
        </span>
        <span className="text-[12px] font-semibold tracking-[-0.01em] text-white/88">SmartLink identity fabric</span>
      </div>

      <div className="absolute inset-x-8 top-[22%] z-10 h-px bg-white/18" />
      <div className="absolute bottom-[27%] left-[14%] right-[12%] z-10 h-px bg-white/20" />
      <div className="absolute left-[20%] top-[18%] z-10 h-[52%] w-px bg-white/18" />
      <div className="absolute right-[24%] top-[20%] z-10 h-[46%] w-px bg-white/14" />

      <span className="mera-login-visual-node absolute left-[19%] top-[22%] z-20 size-3 rounded-full bg-white" />
      <span className="mera-login-visual-node absolute right-[23%] top-[33%] z-20 size-3 rounded-full bg-[#f6a318]" />
      <span className="mera-login-visual-node absolute left-[47%] bottom-[27%] z-20 size-3 rounded-full bg-white" />
      <span className="mera-login-visual-node absolute right-[11%] bottom-[18%] z-20 size-2.5 rounded-full bg-[#d1d5db]" />

      <div className="absolute left-[12%] top-[32%] z-10 grid gap-2">
        <div className="h-2 w-24 rounded-full bg-white/78" />
        <div className="h-2 w-40 rounded-full bg-white/32" />
        <div className="h-2 w-28 rounded-full bg-white/26" />
      </div>

      <div className="absolute right-7 top-[40%] z-10 grid w-40 gap-3 rounded-[8px] border border-white/12 bg-black/18 p-4 text-white shadow-[0_24px_60px_rgba(0,0,0,0.18)] backdrop-blur-md">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/48">Access Stage</div>
        <div className="text-[18px] font-semibold tracking-[-0.04em]">{mode === 'code' ? 'Verify' : 'Authorize'}</div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/14">
          <div className={`h-full rounded-full bg-[#19c7ca] transition-all duration-700 ${mode === 'code' ? 'w-[74%]' : 'w-[42%]'}`} />
        </div>
      </div>

      <div className="absolute bottom-7 left-7 right-7 z-10 grid gap-2 text-white">
        <p className="m-0 max-w-[23rem] text-[30px] font-semibold leading-[0.98] tracking-[-0.055em] text-white">
          Secure school access.
        </p>
        <p className="m-0 max-w-[27rem] text-[12px] font-medium leading-5 text-white/58">
          Device trust, account verification and school workspace data are prepared before the portal opens.
        </p>
      </div>
    </div>
  )
}

function SmartLinkLoadingGate({
  successLoading,
  onSuccessAnimationComplete,
}: {
  successLoading: boolean
  onSuccessAnimationComplete?: () => void
}) {
  const [motionPhase, setMotionPhase] = useState<'triangle' | 'orbit'>('triangle')
  const [playedOnce, setPlayedOnce] = useState(false)
  const [released, setReleased] = useState(false)
  const [phraseIndex, setPhraseIndex] = useState(0)

  useEffect(() => {
    const triangleTimer = window.setTimeout(() => setMotionPhase('orbit'), 1450)
    const loopTimer = window.setInterval(() => {
      setMotionPhase('triangle')
      window.setTimeout(() => setMotionPhase('orbit'), 1450)
    }, 3200)
    const timer = window.setTimeout(() => setPlayedOnce(true), 3200)
    return () => {
      window.clearTimeout(triangleTimer)
      window.clearInterval(loopTimer)
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPhraseIndex((current) => (current + 1) % loadingPhrases.length)
    }, 1900)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (released || successLoading || !playedOnce) return
    setReleased(true)
    onSuccessAnimationComplete?.()
  }, [onSuccessAnimationComplete, playedOnce, released, successLoading])

  return (
    <div className="grid min-h-[260px] justify-items-center gap-8 text-center">
      <div className="mera-login-dot-loader" data-motion-phase={motionPhase} aria-label="Loading SmartLink workspace">
        <span />
        <span />
        <span />
      </div>
      <div className="relative h-8 min-w-[220px] overflow-hidden">
        <div key={phraseIndex} className="mera-login-loading-word text-[12px] font-medium tracking-[-0.015em] text-[#111827]">
          {loadingPhrases[phraseIndex]}
        </div>
      </div>
    </div>
  )
}
