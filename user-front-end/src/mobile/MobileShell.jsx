import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AssistantIcon,
  HomeIcon,
  ListIcon,
  OrdersIcon,
  WalletIcon,
} from './icons'

const ASSISTANT_LAUNCHER_STORAGE_KEY = 'smartlink.assistantLauncherPosition'
const DRAG_THRESHOLD_PX = 6
const ASSISTANT_IDLE_FADE_MS = 4000

const tabs = [
  { key: 'home', label: 'Home', path: '/m/home', Icon: HomeIcon },
  { key: 'orders', label: 'Orders', path: '/m/orders', Icon: OrdersIcon },
  { key: 'activity', label: 'Queue', path: '/m/activity', Icon: ListIcon },
  { key: 'wallet', label: 'Wallet', path: '/m/wallet', Icon: WalletIcon },
  { key: 'more', label: 'More', path: '/m/more', Icon: ListIcon },
]

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function readStoredLauncherPosition() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(ASSISTANT_LAUNCHER_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const x = Number(parsed?.x)
    const y = Number(parsed?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    return { x, y }
  } catch {
    return null
  }
}

function writeStoredLauncherPosition(position) {
  if (typeof window === 'undefined') return
  try {
    if (!position) {
      window.localStorage.removeItem(ASSISTANT_LAUNCHER_STORAGE_KEY)
      return
    }
    window.localStorage.setItem(ASSISTANT_LAUNCHER_STORAGE_KEY, JSON.stringify(position))
  } catch {
    // Ignore storage errors and keep the launcher draggable for the current session.
  }
}

export function MobileShell({
  children,
  activeTab,
  onNavigate,
  showTabBar = true,
  showAssistantLauncher = false,
  onOpenAssistant,
  unreadAlertsCount = 0,
}) {
  const launcherRef = useRef(null)
  const dragRef = useRef(null)
  const suppressClickRef = useRef(false)
  const idleFadeTimerRef = useRef(0)
  const [launcherPosition, setLauncherPosition] = useState(() => readStoredLauncherPosition())
  const [isDraggingLauncher, setIsDraggingLauncher] = useState(false)
  const [isLauncherIdle, setIsLauncherIdle] = useState(false)

  const clampLauncherPosition = useCallback((position) => {
    if (!position || typeof window === 'undefined') return null
    const buttonRect = launcherRef.current?.getBoundingClientRect()
    const width = Number(buttonRect?.width || 0) || 132
    const height = Number(buttonRect?.height || 0) || 48
    const gutter = 12
    const safeBottom = showTabBar ? 92 : 16

    return {
      x: clamp(position.x, gutter, Math.max(gutter, window.innerWidth - width - gutter)),
      y: clamp(position.y, gutter, Math.max(gutter, window.innerHeight - height - safeBottom)),
    }
  }, [showTabBar])

  useEffect(() => {
    if (!launcherPosition) return
    const clamped = clampLauncherPosition(launcherPosition)
    if (!clamped) return
    if (clamped.x === launcherPosition.x && clamped.y === launcherPosition.y) return
    setLauncherPosition(clamped)
    writeStoredLauncherPosition(clamped)
  }, [clampLauncherPosition, launcherPosition])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const handleResize = () => {
      setLauncherPosition((current) => {
        if (!current) return current
        const clamped = clampLauncherPosition(current)
        writeStoredLauncherPosition(clamped)
        return clamped
      })
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [clampLauncherPosition])

  const scheduleLauncherIdleFade = useCallback(() => {
    if (typeof window === 'undefined') return
    window.clearTimeout(idleFadeTimerRef.current)
    setIsLauncherIdle(false)
    idleFadeTimerRef.current = window.setTimeout(() => {
      setIsLauncherIdle(true)
    }, ASSISTANT_IDLE_FADE_MS)
  }, [])

  useEffect(() => {
    if (!showAssistantLauncher || typeof window === 'undefined') return undefined
    scheduleLauncherIdleFade()
    return () => {
      window.clearTimeout(idleFadeTimerRef.current)
    }
  }, [scheduleLauncherIdleFade, showAssistantLauncher])

  const stopDraggingLauncher = useCallback(() => {
    const activeDrag = dragRef.current
    if (activeDrag?.pointerId !== undefined) {
      launcherRef.current?.releasePointerCapture?.(activeDrag.pointerId)
    }
    dragRef.current = null
    setIsDraggingLauncher(false)
  }, [])

  const handleLauncherPointerDown = useCallback((event) => {
    if (!showAssistantLauncher) return
    scheduleLauncherIdleFade()

    const rect = launcherRef.current?.getBoundingClientRect()
    if (!rect) return

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: launcherPosition?.x ?? rect.left,
      originY: launcherPosition?.y ?? rect.top,
      moved: false,
    }

    launcherRef.current?.setPointerCapture?.(event.pointerId)
    suppressClickRef.current = false
  }, [launcherPosition, scheduleLauncherIdleFade, showAssistantLauncher])

  const handleLauncherPointerMove = useCallback((event) => {
    const activeDrag = dragRef.current
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return

    const deltaX = event.clientX - activeDrag.startX
    const deltaY = event.clientY - activeDrag.startY
    const movedEnough = Math.abs(deltaX) > DRAG_THRESHOLD_PX || Math.abs(deltaY) > DRAG_THRESHOLD_PX

    if (!activeDrag.moved && !movedEnough) return

    dragRef.current = {
      ...activeDrag,
      moved: true,
    }
    suppressClickRef.current = true
    setIsDraggingLauncher(true)
    setIsLauncherIdle(false)

    const nextPosition = clampLauncherPosition({
      x: activeDrag.originX + deltaX,
      y: activeDrag.originY + deltaY,
    })
    setLauncherPosition(nextPosition)
  }, [clampLauncherPosition])

  const handleLauncherPointerUp = useCallback((event) => {
    const activeDrag = dragRef.current
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return

    if (activeDrag.moved && launcherPosition) {
      writeStoredLauncherPosition(launcherPosition)
    }

    scheduleLauncherIdleFade()
    stopDraggingLauncher()
  }, [launcherPosition, scheduleLauncherIdleFade, stopDraggingLauncher])

  const handleLauncherClick = useCallback((event) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      event.preventDefault()
      return
    }
    scheduleLauncherIdleFade()
    onOpenAssistant?.()
  }, [onOpenAssistant, scheduleLauncherIdleFade])

  const launcherStyle = launcherPosition
    ? {
        left: `${launcherPosition.x}px`,
        top: `${launcherPosition.y}px`,
        right: 'auto',
        bottom: 'auto',
      }
    : undefined

  return (
    <div className={`mobile-shell ${showTabBar ? '' : 'no-tabbar'}`}>
      <div className='mobile-shell-inner'>
        <div className='mobile-screen'>{children}</div>
      </div>

      {showAssistantLauncher ? (
        <button
          ref={launcherRef}
          type='button'
          className={`mobile-assistant-launcher ${isDraggingLauncher ? 'is-dragging' : ''} ${isLauncherIdle ? 'is-idle' : ''}`}
          style={launcherStyle}
          onClick={handleLauncherClick}
          onPointerDown={handleLauncherPointerDown}
          onPointerMove={handleLauncherPointerMove}
          onPointerUp={handleLauncherPointerUp}
          onPointerCancel={stopDraggingLauncher}
          aria-label='Open SmartLink Assistant'
        >
          <AssistantIcon size={18} />
          <span>Assistant</span>
        </button>
      ) : null}

      {showTabBar ? (
        <nav className='mobile-tabbar' aria-label='Bottom navigation'>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key
            const showUnreadDot = tab.key === 'more' && Number(unreadAlertsCount || 0) > 0
            return (
              <button
                key={tab.key}
                type='button'
                className={`mobile-tab ${isActive ? 'is-active' : ''}`}
                onClick={() => onNavigate(tab.path)}
              >
                <span className='mobile-tab-icon-wrap'>
                  <tab.Icon size={20} />
                  {showUnreadDot ? <span className='mobile-tab-dot' aria-hidden='true' /> : null}
                </span>
                <span>{tab.label}</span>
              </button>
            )
          })}
        </nav>
      ) : null}
    </div>
  )
}
