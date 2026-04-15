import { useEffect, useState } from 'react'
import { userAuthApi } from '../../mobile/api/userAuthApi'
import { userQueueApi } from '../../mobile/api/userQueueApi'
import { isPasskeyAbortError, isPasskeySupported, registerCurrentDevicePasskey } from '../../mobile/passkeys'
import { playSmartlinkCue, SMARTLINK_AUDIO_CUES } from '../../utils/smartlinkAudio'
import './settings.css'

function buildInitials(fullName, email) {
  const source = String(fullName || email || 'SmartLink User').trim()
  const initials = source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
  return initials || 'SU'
}

function toMoneyNumber(value) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 0
  return Number(numeric.toFixed(2))
}

function formatMoney(amount, currencyCode = 'MWK') {
  const normalizedAmount = toMoneyNumber(amount)
  const isWhole = Math.abs(normalizedAmount % 1) < 0.001
  return `${currencyCode} ${normalizedAmount.toLocaleString(undefined, {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

function formatDateLabel(value) {
  if (!value) return 'Not scheduled'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not scheduled'
  return date.toLocaleDateString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

function formatDateTimeLabel(value) {
  if (!value) return 'Never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function normalizeWalletSummary(payload) {
  const wallet = payload?.wallet || payload || {}
  return {
    walletNumber: String(wallet?.walletNumber || wallet?.wallet_number || '').trim() || 'Pending',
    walletPublicId: String(wallet?.walletPublicId || wallet?.wallet_public_id || '').trim() || '',
    status: String(wallet?.status || 'ACTIVE').trim().toUpperCase(),
    currencyCode: String(wallet?.currencyCode || wallet?.currency_code || 'MWK').trim() || 'MWK',
    availableBalance: toMoneyNumber(wallet?.availableBalance ?? wallet?.available_balance),
    ledgerBalance: toMoneyNumber(wallet?.ledgerBalance ?? wallet?.ledger_balance),
    activeHoldAmount: toMoneyNumber(wallet?.activeHoldAmount ?? wallet?.active_hold_amount),
  }
}

function resolveNotificationCopy(permission, enabled) {
  const normalized = String(permission || 'default').trim().toLowerCase()
  if (normalized === 'unsupported') {
    return 'Notifications are not supported on this browser.'
  }
  if (normalized === 'denied') {
    return 'Browser notification permission is denied. Enable it in device settings first.'
  }
  if (normalized === 'granted' && enabled) {
    return 'SmartLink alerts are enabled for queue and reservation updates.'
  }
  return 'Enable alerts to receive queue calls, reservation reminders, and station changes.'
}

const THEME_OPTIONS = [
  {
    id: 'light',
    label: 'Light',
    description: 'Bright surfaces for daytime use.',
  },
  {
    id: 'dark',
    label: 'Dark',
    description: 'Low-glare surfaces, including the live map.',
  },
]

export function UserSettingsWorkspace({
  layout = 'mobile',
  profile = null,
  station = null,
  theme = 'light',
  onSaveProfile,
  onOpenWallet,
  onLogout,
  notificationsEnabled = false,
  notificationsPermission = 'default',
  onToggleNotifications,
  onThemeChange,
}) {
  const [formState, setFormState] = useState({
    fullName: String(profile?.fullName || '').trim(),
    phone: String(profile?.phone || '').trim(),
    email: String(profile?.email || '').trim(),
  })
  const [profileError, setProfileError] = useState('')
  const [profileFeedback, setProfileFeedback] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [walletLoading, setWalletLoading] = useState(() => userQueueApi.isApiMode())
  const [walletError, setWalletError] = useState('')
  const [walletSummary, setWalletSummary] = useState(null)
  const [topupAmount, setTopupAmount] = useState('')
  const [topupNote, setTopupNote] = useState('')
  const [topupError, setTopupError] = useState('')
  const [topupFeedback, setTopupFeedback] = useState('')
  const [topupSubmitting, setTopupSubmitting] = useState(false)
  const [notificationFeedback, setNotificationFeedback] = useState('')
  const [passkeyFeedback, setPasskeyFeedback] = useState('')
  const [passkeyError, setPasskeyError] = useState('')
  const [passkeySubmitting, setPasskeySubmitting] = useState(false)
  const [passkeysLoading, setPasskeysLoading] = useState(true)
  const [passkeys, setPasskeys] = useState([])
  const [passkeyRemovingId, setPasskeyRemovingId] = useState('')
  const walletApiEnabled = userQueueApi.isApiMode()
  const isDesktop = layout === 'desktop'
  const subscription = station?.subscription || null
  const activeTheme = theme === 'dark' ? 'dark' : 'light'
  const passkeySupported = isPasskeySupported()

  useEffect(() => {
    setFormState({
      fullName: String(profile?.fullName || '').trim(),
      phone: String(profile?.phone || '').trim(),
      email: String(profile?.email || '').trim(),
    })
    setProfileError('')
    setProfileFeedback('')
  }, [profile?.email, profile?.fullName, profile?.phone])

  useEffect(() => {
    let active = true

    async function loadWalletSummary() {
      if (!walletApiEnabled) {
        setWalletLoading(false)
        setWalletError('Billing is available only when the user app is connected to the API.')
        setWalletSummary(null)
        return
      }

      setWalletLoading(true)
      setWalletError('')
      try {
        const payload = await userQueueApi.getWalletSummary()
        if (!active) return
        setWalletSummary(normalizeWalletSummary(payload))
      } catch (error) {
        if (!active) return
        setWalletSummary(null)
        setWalletError(error?.message || 'Unable to load billing overview.')
      } finally {
        if (active) {
          setWalletLoading(false)
        }
      }
    }

    loadWalletSummary()

    return () => {
      active = false
    }
  }, [walletApiEnabled])

  useEffect(() => {
    let active = true

    async function loadPasskeys() {
      setPasskeysLoading(true)
      try {
        const payload = await userAuthApi.listPasskeys()
        if (!active) return
        setPasskeys(Array.isArray(payload?.passkeys) ? payload.passkeys : [])
      } catch (error) {
        if (!active) return
        setPasskeyError((current) => current || error?.message || 'Unable to load saved passkeys.')
      } finally {
        if (active) {
          setPasskeysLoading(false)
        }
      }
    }

    loadPasskeys()

    return () => {
      active = false
    }
  }, [])

  const handleProfileSubmit = async (event) => {
    event.preventDefault()
    setProfileError('')
    setProfileFeedback('')

    const payload = {
      fullName: formState.fullName.trim(),
      phone: formState.phone.trim(),
      email: formState.email.trim(),
    }

    if (!payload.fullName) {
      setProfileError('Full name is required.')
      return
    }

    if (!payload.phone && !payload.email) {
      setProfileError('Add at least a phone number or email address.')
      return
    }

    setProfileSaving(true)
    try {
      await onSaveProfile?.(payload)
      setProfileFeedback('Profile updated successfully.')
    } catch (error) {
      setProfileError(error?.message || 'Unable to update your profile.')
    } finally {
      setProfileSaving(false)
    }
  }

  const handleTopupSubmit = async (event) => {
    event.preventDefault()
    setTopupError('')
    setTopupFeedback('')

    if (!walletApiEnabled) {
      setTopupError('Billing is available only in API mode.')
      return
    }

    const amount = Number(topupAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setTopupError('Enter a valid amount greater than zero.')
      return
    }

    setTopupSubmitting(true)
    try {
      const result = await userQueueApi.createWalletTopup({
        amount,
        note: topupNote.trim() || undefined,
      })
      const nextWallet = normalizeWalletSummary({ wallet: result?.wallet })
      setWalletSummary(nextWallet)
      setTopupAmount('')
      setTopupNote('')
      setTopupFeedback(`Top-up posted for ${formatMoney(amount, nextWallet.currencyCode)}.`)
      playSmartlinkCue(SMARTLINK_AUDIO_CUES.WALLET_TOPUP_SUCCESS)
    } catch (error) {
      setTopupError(error?.message || 'Unable to post wallet top-up.')
    } finally {
      setTopupSubmitting(false)
    }
  }

  const handlePasskeySetup = async () => {
    setPasskeyError('')
    setPasskeyFeedback('')

    if (!passkeySupported) {
      setPasskeyError('Passkeys are not supported on this browser or device.')
      return
    }

    setPasskeySubmitting(true)
    try {
      await registerCurrentDevicePasskey(userAuthApi, {
        name: isDesktop ? 'Desktop passkey' : 'Mobile device passkey',
      })
      const payload = await userAuthApi.listPasskeys()
      setPasskeys(Array.isArray(payload?.passkeys) ? payload.passkeys : [])
      setPasskeyFeedback('Passkey setup completed. You can now use fingerprint, Face ID, or device unlock on this device.')
    } catch (error) {
      if (isPasskeyAbortError(error)) {
        setPasskeyFeedback('Passkey setup was cancelled.')
      } else {
        setPasskeyError(error?.message || 'Unable to set up passkey on this device.')
      }
    } finally {
      setPasskeySubmitting(false)
    }
  }

  const handlePasskeyRemove = async (passkeyPublicId) => {
    const normalizedPublicId = String(passkeyPublicId || '').trim()
    if (!normalizedPublicId) return

    setPasskeyError('')
    setPasskeyFeedback('')
    setPasskeyRemovingId(normalizedPublicId)
    try {
      const result = await userAuthApi.removePasskey(normalizedPublicId)
      setPasskeys((current) => current.filter((passkey) => passkey?.publicId !== normalizedPublicId))
      setPasskeyFeedback(`${result?.passkey?.label || 'Passkey'} removed.`)
    } catch (error) {
      setPasskeyError(error?.message || 'Unable to remove this passkey.')
    } finally {
      setPasskeyRemovingId('')
    }
  }

  const initials = buildInitials(profile?.fullName, profile?.email)

  return (
    <div className={`user-settings-workspace ${isDesktop ? 'is-desktop' : 'is-mobile'}`}>
      <section className='user-settings-card user-settings-hero-card'>
        <div className='user-settings-identity'>
          <div className='user-settings-avatar' aria-hidden='true'>
            {initials}
          </div>
          <div className='user-settings-identity-copy'>
            <h3>{profile?.fullName || 'SmartLink User'}</h3>
            <p>{profile?.phone || profile?.email || 'No login identity saved yet.'}</p>
            <small>{profile?.email || 'Add an email address to receive receipts and account notices.'}</small>
          </div>
        </div>

        <div className='user-settings-hero-meta'>
          <span>Account ID</span>
          <strong>{profile?.publicId || 'Pending sync'}</strong>
          {station?.name ? <small>{station.name}</small> : <small>Personal user account</small>}
        </div>
      </section>

      <div className='user-settings-grid'>
        <section className='user-settings-card'>
          <header className='user-settings-section-head'>
            <div>
              <h3>Identity</h3>
              <p>Update the name and contact details tied to this account.</p>
            </div>
          </header>

          <form className='user-settings-form' onSubmit={handleProfileSubmit}>
            <label>
              <span>Full name</span>
              <input
                type='text'
                autoComplete='name'
                value={formState.fullName}
                onChange={(event) => setFormState((current) => ({ ...current, fullName: event.target.value }))}
                placeholder='Your full name'
              />
            </label>

            <label>
              <span>Phone number</span>
              <input
                type='tel'
                autoComplete='tel'
                value={formState.phone}
                onChange={(event) => setFormState((current) => ({ ...current, phone: event.target.value }))}
                placeholder='+265...'
              />
            </label>

            <label>
              <span>Email address</span>
              <input
                type='email'
                autoComplete='email'
                value={formState.email}
                onChange={(event) => setFormState((current) => ({ ...current, email: event.target.value }))}
                placeholder='name@example.com'
              />
            </label>

            {profileError ? <p className='user-settings-message is-error'>{profileError}</p> : null}
            {profileFeedback ? <p className='user-settings-message is-success'>{profileFeedback}</p> : null}

            <div className='user-settings-actions'>
              <button type='submit' className='details-action-button is-primary' disabled={profileSaving}>
                {profileSaving ? 'Saving…' : 'Save profile'}
              </button>
              {onLogout ? (
                <button type='button' className='details-action-button' onClick={() => onLogout()}>
                  Sign out
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className='user-settings-card'>
          <header className='user-settings-section-head'>
            <div>
              <h3>Notifications</h3>
              <p>{resolveNotificationCopy(notificationsPermission, notificationsEnabled)}</p>
            </div>
          </header>

          <div className='user-settings-inline-row'>
            <div className='user-settings-inline-copy'>
              <strong>{notificationsEnabled ? 'Alerts enabled' : 'Alerts disabled'}</strong>
              <small>Permission: {String(notificationsPermission || 'default')}</small>
            </div>
            <button
              type='button'
              className='details-action-button is-primary'
              onClick={async () => {
                setNotificationFeedback('')
                try {
                  await onToggleNotifications?.()
                } catch (error) {
                  setNotificationFeedback(error?.message || 'Unable to update notifications.')
                }
              }}
              disabled={String(notificationsPermission || '').toLowerCase() === 'unsupported'}
            >
              {notificationsEnabled ? 'Disable' : 'Enable'}
            </button>
          </div>

          {notificationFeedback ? <p className='user-settings-message is-error'>{notificationFeedback}</p> : null}
        </section>

        <section className='user-settings-card'>
          <header className='user-settings-section-head'>
            <div>
              <h3>Security</h3>
              <p>
                Set up a passkey on this device so you can sign in with fingerprint, Face ID, or your device screen lock.
              </p>
            </div>
          </header>

          <div className='user-settings-inline-row'>
            <div className='user-settings-inline-copy'>
              <strong>
                {passkeys.length > 0
                  ? `${passkeys.length} passkey${passkeys.length === 1 ? '' : 's'} saved`
                  : passkeySupported
                    ? 'Passkey supported'
                    : 'Passkey unavailable'}
              </strong>
              <small>
                {passkeySupported
                  ? 'This device can create a passkey for faster sign-in.'
                  : 'Use a supported browser with secure device lock enabled.'}
              </small>
            </div>
            <button
              type='button'
              className='details-action-button is-primary'
              disabled={passkeySubmitting || !passkeySupported}
              onClick={handlePasskeySetup}
            >
              {passkeySubmitting ? 'Setting up…' : 'Set up biometric sign-in'}
            </button>
          </div>

          {passkeysLoading ? <p className='user-settings-message'>Loading saved passkeys…</p> : null}

          {!passkeysLoading && passkeys.length > 0 ? (
            <div className='user-settings-passkey-list'>
              {passkeys.map((passkey) => {
                const isRemoving = passkeyRemovingId === passkey.publicId
                return (
                  <article key={passkey.publicId} className='user-settings-passkey-item'>
                    <div className='user-settings-passkey-copy'>
                      <strong>{passkey.label || 'Passkey'}</strong>
                      <small>Added {formatDateTimeLabel(passkey.createdAt)}</small>
                      <small>Last used {formatDateTimeLabel(passkey.lastUsedAt)}</small>
                    </div>
                    <button
                      type='button'
                      className='details-action-button'
                      disabled={Boolean(passkeySubmitting) || isRemoving}
                      onClick={() => handlePasskeyRemove(passkey.publicId)}
                    >
                      {isRemoving ? 'Removing…' : 'Remove'}
                    </button>
                  </article>
                )
              })}
            </div>
          ) : null}

          {passkeyError ? <p className='user-settings-message is-error'>{passkeyError}</p> : null}
          {passkeyFeedback ? <p className='user-settings-message is-success'>{passkeyFeedback}</p> : null}
        </section>

        <section className='user-settings-card'>
          <header className='user-settings-section-head'>
            <div>
              <h3>Appearance</h3>
              <p>Choose how SmartLink looks across the app and map.</p>
            </div>
          </header>

          <div className='user-settings-theme-grid' role='radiogroup' aria-label='Theme preference'>
            {THEME_OPTIONS.map((option) => {
              const isActive = activeTheme === option.id
              return (
                <button
                  key={option.id}
                  type='button'
                  role='radio'
                  aria-checked={isActive}
                  className={`user-settings-theme-option ${isActive ? 'is-active' : ''}`}
                  onClick={() => onThemeChange?.(option.id)}
                >
                  <span className={`user-settings-theme-swatch is-${option.id}`} aria-hidden='true'>
                    <span />
                  </span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </button>
              )
            })}
          </div>
        </section>

        <section className='user-settings-card user-settings-billing-card'>
          <header className='user-settings-section-head'>
            <div>
              <h3>Billing</h3>
              <p>Manage your wallet balance and review any subscription plan linked to this account.</p>
            </div>
          </header>

          {subscription ? (
            <div className='user-settings-subscription'>
              <div>
                <span>Plan</span>
                <strong>{subscription.planName || subscription.planCode || 'Active subscription'}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{subscription.status || 'ACTIVE'}</strong>
              </div>
              <div>
                <span>Monthly fee</span>
                <strong>{formatMoney(subscription.monthlyFeeMwk || 0, 'MWK')}</strong>
              </div>
              <div>
                <span>Renewal</span>
                <strong>{formatDateLabel(subscription.renewalDate)}</strong>
              </div>
            </div>
          ) : null}

          {walletLoading ? <p className='user-settings-message'>Loading billing overview…</p> : null}
          {!walletLoading && walletError ? <p className='user-settings-message is-error'>{walletError}</p> : null}

          {!walletLoading && !walletError && walletSummary ? (
            <>
              <div className='user-settings-balance-grid'>
                <article>
                  <span>Available balance</span>
                  <strong>{formatMoney(walletSummary.availableBalance, walletSummary.currencyCode)}</strong>
                </article>
                <article>
                  <span>Ledger balance</span>
                  <strong>{formatMoney(walletSummary.ledgerBalance, walletSummary.currencyCode)}</strong>
                </article>
                <article>
                  <span>Active holds</span>
                  <strong>{formatMoney(walletSummary.activeHoldAmount, walletSummary.currencyCode)}</strong>
                </article>
                <article>
                  <span>Wallet ID</span>
                  <strong>{walletSummary.walletPublicId || walletSummary.walletNumber}</strong>
                </article>
              </div>

              <form className='user-settings-topup-form' onSubmit={handleTopupSubmit}>
                <label>
                  <span>Top-up amount</span>
                  <input
                    type='number'
                    min='1'
                    step='1'
                    value={topupAmount}
                    onChange={(event) => setTopupAmount(event.target.value)}
                    placeholder='10000'
                  />
                </label>

                <label>
                  <span>Note</span>
                  <input
                    type='text'
                    value={topupNote}
                    onChange={(event) => setTopupNote(event.target.value)}
                    placeholder='Reference or wallet note'
                  />
                </label>

                {topupError ? <p className='user-settings-message is-error'>{topupError}</p> : null}
                {topupFeedback ? <p className='user-settings-message is-success'>{topupFeedback}</p> : null}

                <div className='user-settings-actions'>
                  <button type='submit' className='details-action-button is-primary' disabled={topupSubmitting}>
                    {topupSubmitting ? 'Processing…' : 'Top up wallet'}
                  </button>
                  {onOpenWallet ? (
                    <button type='button' className='details-action-button' onClick={() => onOpenWallet()}>
                      Open wallet
                    </button>
                  ) : null}
                </div>
              </form>
            </>
          ) : null}
        </section>
      </div>
    </div>
  )
}
