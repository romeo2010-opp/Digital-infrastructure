import { useCallback, useEffect, useMemo, useState } from 'react'
import { fleetApi } from '../../mobile/api/fleetApi'
import { userAuthApi } from '../../mobile/api/userAuthApi'
import {
  clearStoredAuthSession,
  getStoredAccessToken,
  getStoredSessionMeta,
  setStoredAccessToken,
  setStoredSessionMeta,
} from '../../mobile/authSession'
import { assertUserAppAccessToken, assertUserAppSessionMeta } from '../../mobile/userSessionGuard'
import { useMiniRouter } from '../../mobile/useMiniRouter'
import { FleetDashboard } from './FleetDashboard'
import { FleetDriverMode } from './FleetDriverMode'
import './fleet.css'

const SELECTED_FLEET_KEY = 'smartlink_fleet_selected_workspace'
const MANAGER_ROLES = new Set(['owner', 'admin', 'finance', 'dispatcher', 'auditor'])
const FLEET_SECTION_ROUTES = {
  overview: '/fleet/dashboard/overview',
  live: '/fleet/dashboard/live-operations',
  allocations: '/fleet/dashboard/fuel-allocations',
  cards: '/fleet/dashboard/fuel-cards',
  requests: '/fleet/dashboard/fuel-requests',
  transactions: '/fleet/dashboard/transactions',
  vehicles: '/fleet/dashboard/vehicles',
  team: '/fleet/dashboard/drivers-team',
  maintenance: '/fleet/dashboard/maintenance',
  wallet: '/fleet/dashboard/wallet-billing',
  policies: '/fleet/dashboard/policies-limits',
  reports: '/fleet/dashboard/reports',
  alerts: '/fleet/dashboard/alerts',
  audit: '/fleet/dashboard/audit-logs',
  settings: '/fleet/dashboard/settings',
}
const FLEET_ROUTE_SECTIONS = Object.fromEntries(Object.entries(FLEET_SECTION_ROUTES).map(([section, route]) => [route, section]))

function normalizeIdentifier(identifier) {
  const scoped = String(identifier || '').trim()
  if (!scoped) return { email: '', phone: '' }
  if (scoped.includes('@')) return { email: scoped, phone: '' }
  return { email: '', phone: scoped }
}

function readSelectedFleetId() {
  if (typeof window === 'undefined') return ''
  return String(window.localStorage.getItem(SELECTED_FLEET_KEY) || '').trim()
}

function writeSelectedFleetId(fleetId) {
  if (typeof window === 'undefined') return
  const normalized = String(fleetId || '').trim()
  if (!normalized) {
    window.localStorage.removeItem(SELECTED_FLEET_KEY)
    return
  }
  window.localStorage.setItem(SELECTED_FLEET_KEY, normalized)
}

function splitFleetMemberships(memberships = []) {
  const active = memberships.filter((item) => item.status === 'active')
  return {
    managerMemberships: active.filter((item) => MANAGER_ROLES.has(String(item.role || '').toLowerCase())),
    driverMemberships: active.filter((item) => String(item.role || '').toLowerCase() === 'driver'),
  }
}

function TrustPoint({ title, body }) {
  return (
    <div className='fleet-trust-point'>
      <span aria-hidden='true' />
      <p>
        <strong>{title}</strong>
        <small>{body}</small>
      </p>
    </div>
  )
}

function FleetWorkspaceSelector({ memberships, onContinue, onDriverMode }) {
  return (
    <section className='fleet-access-panel'>
      <header>
        <span className='fleet-kicker'>Fleet workspaces</span>
        <h2>Select a fleet account</h2>
        <p>Choose the workspace you want to manage in this session.</p>
      </header>

      <div className='fleet-workspace-list'>
        {memberships.map((membership) => (
          <article className='fleet-workspace-row' key={membership.publicId}>
            <div>
              <strong>{membership.fleet?.name || 'Fleet account'}</strong>
              <span>{membership.fleet?.publicId}</span>
            </div>
            <div>
              <span className='fleet-status-chip'>{membership.roleLabel || membership.role}</span>
              <span className='fleet-muted'>{membership.status}</span>
            </div>
            <div>
              <span className='fleet-muted'>Last accessed</span>
              <strong>{membership.lastAccessedAt ? new Date(membership.lastAccessedAt).toLocaleString() : 'Not yet'}</strong>
            </div>
            {MANAGER_ROLES.has(String(membership.role || '').toLowerCase()) ? (
              <button type='button' className='fleet-primary-button' onClick={() => onContinue(membership)}>
                Continue
              </button>
            ) : (
              <button type='button' className='fleet-secondary-button' onClick={onDriverMode}>
                Driver mode
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}

function NoFleetAccess({ onReturn, onRequestAccess, onContactAdmin, requestSent }) {
  return (
    <section className='fleet-access-panel'>
      <header>
        <span className='fleet-kicker'>Access required</span>
        <h2>You do not currently belong to a fleet account.</h2>
        <p>Fleet workspaces are assigned by a fleet owner, admin, or finance manager.</p>
      </header>
      {requestSent ? <p className='fleet-success-note'>Fleet access request recorded for review.</p> : null}
      <div className='fleet-action-row'>
        <button type='button' className='fleet-secondary-button' onClick={onReturn}>
          Return to SmartLink app
        </button>
        <button type='button' className='fleet-primary-button' onClick={onRequestAccess}>
          Request fleet access
        </button>
        <button type='button' className='fleet-secondary-button' onClick={onContactAdmin}>
          Contact fleet administrator
        </button>
      </div>
    </section>
  )
}

function FleetLogin({ onAuthenticated, onOpenDriverMode }) {
  const { navigate } = useMiniRouter()
  const existingSession = getStoredSessionMeta()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [memberships, setMemberships] = useState([])
  const [accessState, setAccessState] = useState('form')
  const [requestSent, setRequestSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const routeMemberships = useCallback((items) => {
    const { managerMemberships, driverMemberships } = splitFleetMemberships(items)
    if (managerMemberships.length === 1) {
      writeSelectedFleetId(managerMemberships[0].fleet?.publicId)
      onAuthenticated(managerMemberships[0])
      return
    }
    if (managerMemberships.length > 1) {
      setMemberships(items)
      setAccessState('selector')
      return
    }
    if (driverMemberships.length > 0) {
      onOpenDriverMode()
      return
    }
    setMemberships(items)
    setAccessState('none')
  }, [onAuthenticated, onOpenDriverMode])

  const handleExistingSession = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      const data = await fleetApi.memberships()
      routeMemberships(data.memberships || [])
    } catch (requestError) {
      setError(requestError?.message || 'Unable to check fleet access.')
    } finally {
      setLoading(false)
    }
  }, [routeMemberships])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const identity = normalizeIdentifier(identifier)
      const loginData = await userAuthApi.login({
        email: identity.email,
        phone: identity.phone,
        password,
      })
      const token = String(loginData?.accessToken || '').trim()
      assertUserAppAccessToken(token)
      setStoredAccessToken(token)
      const me = await userAuthApi.me(token)
      const sessionMeta = {
        user: me?.user || loginData?.user || null,
        station: me?.station || null,
        role: me?.role || 'USER',
        loginAt: new Date().toISOString(),
      }
      assertUserAppSessionMeta(sessionMeta)
      setStoredSessionMeta(sessionMeta)
      const data = await fleetApi.memberships()
      routeMemberships(data.memberships || [])
    } catch (requestError) {
      clearStoredAuthSession()
      setError(requestError?.message || 'Unable to sign in to Fleet.')
    } finally {
      setLoading(false)
    }
  }

  async function handleRequestAccess() {
    setError('')
    try {
      await fleetApi.requestAccess({
        fleetName: '',
        contactName: existingSession?.user?.fullName || '',
        contactPhone: existingSession?.user?.phone || '',
        contactEmail: existingSession?.user?.email || '',
        message: 'User requested fleet access from the SmartLink Fleet login page.',
      })
      setRequestSent(true)
    } catch (requestError) {
      setError(requestError?.message || 'Unable to record fleet access request.')
    }
  }

  return (
    <main className='fleet-login-page'>
      <section className='fleet-login-positioning'>
        <div className='fleet-brand-lockup'>
          <span>SmartLink Fleet</span>
          <strong>Fuel account control for serious operators.</strong>
        </div>
        <h1>Manage fuel spending, vehicles, drivers, approvals, and fleet reports from one SmartLink workspace.</h1>
        <div className='fleet-trust-grid'>
          <TrustPoint title='Driver and vehicle controls' body='Assign vehicles, suspend access, and keep usage tied to accountable operators.' />
          <TrustPoint title='Real-time fuel transactions' body='Track litres, spend, station, odometer, and risk context as records are created.' />
          <TrustPoint title='Wallet and approval management' body='Reserve funds during approvals and protect the fleet balance from negative spend.' />
          <TrustPoint title='Audit-ready reports' body='Keep approvals, wallet changes, policy edits, and transaction actions traceable.' />
        </div>
      </section>

      <section className='fleet-login-card-wrap'>
        {accessState === 'form' ? (
          <section className='fleet-login-card'>
            <header>
              <span className='fleet-kicker'>Fleet access</span>
              <h2>Sign in</h2>
              <p>Use your existing SmartLink account. Fleet access depends on your active fleet membership.</p>
            </header>

            {existingSession?.user?.fullName ? (
              <button type='button' className='fleet-existing-session' onClick={handleExistingSession} disabled={loading}>
                Continue as {existingSession.user.fullName}
              </button>
            ) : null}

            <form className='fleet-form' onSubmit={handleSubmit}>
              <label>
                <span>Email or phone</span>
                <input value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete='username' required />
              </label>
              <label>
                <span>Password</span>
                <input type='password' value={password} onChange={(event) => setPassword(event.target.value)} autoComplete='current-password' required />
              </label>
              {error ? <p className='fleet-error-note'>{error}</p> : null}
              <button type='submit' className='fleet-primary-button' disabled={loading}>
                {loading ? 'Checking access...' : 'Continue to Fleet'}
              </button>
            </form>

            <button type='button' className='fleet-link-button' onClick={() => navigate('/d/login')}>
              Return to SmartLink app
            </button>
          </section>
        ) : null}

        {accessState === 'selector' ? (
          <FleetWorkspaceSelector
            memberships={memberships}
            onContinue={(membership) => {
              writeSelectedFleetId(membership.fleet?.publicId)
              onAuthenticated(membership)
            }}
            onDriverMode={onOpenDriverMode}
          />
        ) : null}

        {accessState === 'none' ? (
          <NoFleetAccess
            requestSent={requestSent}
            onReturn={() => navigate('/d/overview')}
            onRequestAccess={handleRequestAccess}
            onContactAdmin={() => {
              window.location.href = 'mailto:?subject=SmartLink Fleet access request'
            }}
          />
        ) : null}
      </section>
    </main>
  )
}

export function FleetApp({ theme = 'light', onThemeChange }) {
  const { pathname, navigate } = useMiniRouter()
  const [selectedFleetId, setSelectedFleetId] = useState(readSelectedFleetId)

  useEffect(() => {
    document.title = pathname === '/fleet/login' ? 'Fleet Login | SmartLink' : 'Fleet Dashboard | SmartLink'
  }, [pathname])

  useEffect(() => {
    if (pathname === '/fleet') {
      navigate('/fleet/login', { replace: true })
    }
  }, [navigate, pathname])

  const selectedFleetFromStorage = useMemo(() => selectedFleetId || readSelectedFleetId(), [selectedFleetId])

  if (pathname.startsWith('/fleet/driver')) {
    return <FleetDriverMode layout='fleet' onBack={() => navigate('/fleet/login')} />
  }

  if (pathname.startsWith('/fleet/dashboard')) {
    if (pathname === '/fleet/dashboard') {
      navigate('/fleet/dashboard/overview', { replace: true })
      return null
    }
    const activeSection = FLEET_ROUTE_SECTIONS[pathname] || 'overview'
    return (
      <FleetDashboard
        fleetId={selectedFleetFromStorage}
        activeSection={activeSection}
        theme={theme}
        onThemeChange={onThemeChange}
        onNavigateSection={(section) => navigate(FLEET_SECTION_ROUTES[section] || FLEET_SECTION_ROUTES.overview)}
        onSwitchFleet={() => navigate('/fleet/login')}
        onMissingFleet={() => navigate('/fleet/login', { replace: true })}
      />
    )
  }

  return (
    <FleetLogin
      onAuthenticated={(membership) => {
        const fleetId = membership?.fleet?.publicId || readSelectedFleetId()
        writeSelectedFleetId(fleetId)
        setSelectedFleetId(fleetId)
        navigate('/fleet/dashboard/overview', { replace: true })
      }}
      onOpenDriverMode={() => navigate('/fleet/driver', { replace: true })}
    />
  )
}
