import { useEffect, useMemo, useRef, useState } from 'react'
import { DESKTOP_PROFILE_MENU } from './desktopNav'

function ToggleIcon({ collapsed }) {
  return (
    <svg viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden='true'>
      {collapsed ? <path d='m9 6 6 6-6 6' /> : <path d='m15 6-6 6 6 6' />}
    </svg>
  )
}

function BellIcon() {
  return (
    <svg viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='currentColor' strokeWidth='1.9' aria-hidden='true'>
      <path d='M6.5 16.5h11l-1.1-1.8V10a4.9 4.9 0 1 0-9.8 0v4.7z' />
      <path d='M10 18.5a2 2 0 0 0 4 0' />
    </svg>
  )
}

export function UserDesktopLayout({
  navItems,
  activePath,
  title,
  subtitle,
  profileName,
  isCollapsed,
  unreadAlertsCount = 0,
  onToggleCollapse,
  onNavigate,
  onOpenAlerts,
  onProfileAction,
  children,
}) {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef(null)

  const primaryItems = useMemo(() => navItems.filter((item) => item.section === 'primary'), [navItems])
  const secondaryItems = useMemo(() => navItems.filter((item) => item.section === 'secondary'), [navItems])

  useEffect(() => {
    const onClickOutside = (event) => {
      if (!profileMenuRef.current || profileMenuRef.current.contains(event.target)) return
      setProfileMenuOpen(false)
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setProfileMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const firstName = String(profileName || 'User').trim().split(' ')[0] || 'User'

  return (
    <div className='desktop-app-root'>
      <aside className={`desktop-sidebar ${isCollapsed ? 'is-collapsed' : ''}`} aria-label='Primary'>
        <div className='desktop-sidebar-header'>
          <button
            type='button'
            className='desktop-logo-button'
            onClick={() => onNavigate('/d/overview')}
            title='SmartLink Home'
            aria-label='Go to SmartLink overview'
          >
            <span className='desktop-logo-mark'>S</span>
            <span className='desktop-logo-text'>SmartLink</span>
          </button>

          <button
            type='button'
            className='desktop-collapse-toggle'
            onClick={onToggleCollapse}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ToggleIcon collapsed={isCollapsed} />
          </button>
        </div>

        <nav className='desktop-nav' aria-label='Main navigation'>
          <p className='desktop-nav-heading'>Main</p>
          {primaryItems.map((item) => {
            const isActive = activePath === item.path
            return (
              <button
                key={item.key}
                type='button'
                className={`desktop-nav-item ${isActive ? 'is-active' : ''}`}
                onClick={() => onNavigate(item.path)}
                title={isCollapsed ? item.label : undefined}
                aria-label={item.label}
              >
                <item.Icon size={18} />
                <span>{item.label}</span>
              </button>
            )
          })}

          <p className='desktop-nav-heading secondary'>Support</p>
          {secondaryItems.map((item) => {
            const isActive = activePath === item.path
            return (
              <button
                key={item.key}
                type='button'
                className={`desktop-nav-item ${isActive ? 'is-active' : ''}`}
                onClick={() => onNavigate(item.path)}
                title={isCollapsed ? item.label : undefined}
                aria-label={item.label}
              >
                <item.Icon size={18} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>
      </aside>

      <div className='desktop-content-wrap'>
        <header className='desktop-topbar'>
          <div className='desktop-topbar-title'>
            <p className='desktop-topbar-kicker'>SmartLink User</p>
            <h1 title={title}>{title}</h1>
            {subtitle ? <p className='desktop-topbar-subtitle'>{subtitle}</p> : null}
          </div>

          <div className='desktop-topbar-actions'>
            <button
              type='button'
              className={`desktop-icon-button ${activePath === '/d/alerts' ? 'is-active' : ''}`}
              aria-label='Notifications'
              title='Notifications'
              onClick={() => onOpenAlerts?.()}
            >
              <BellIcon />
              {Number(unreadAlertsCount || 0) > 0 ? <span className='desktop-icon-badge' aria-hidden='true' /> : null}
            </button>

            <div className='desktop-profile-menu' ref={profileMenuRef}>
              <button
                type='button'
                className='desktop-profile-trigger'
                aria-haspopup='menu'
                aria-expanded={profileMenuOpen}
                onClick={() => setProfileMenuOpen((open) => !open)}
              >
                <span className='desktop-profile-avatar' aria-hidden='true'>
                  {firstName.slice(0, 1).toUpperCase()}
                </span>
                <span className='desktop-profile-name'>{firstName}</span>
              </button>

              {profileMenuOpen ? (
                <div className='desktop-profile-panel' role='menu' aria-label='Profile'>
                  {DESKTOP_PROFILE_MENU.map((item) => (
                    <button
                      key={item.key}
                      type='button'
                      className='desktop-profile-action'
                      role='menuitem'
                      onClick={() => {
                        setProfileMenuOpen(false)
                        onProfileAction(item)
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className='desktop-main-content' id='desktop-main-content'>
          {children}
        </main>
      </div>
    </div>
  )
}
