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

export function UserAccountOverview({
  profile = null,
  station = null,
  onOpenSettings,
  onOpenWallet,
  onLogout,
}) {
  const initials = buildInitials(profile?.fullName, profile?.email)

  return (
    <div className='user-account-overview'>
      <section className='user-settings-card user-settings-hero-card'>
        <div className='user-settings-identity'>
          <div className='user-settings-avatar' aria-hidden='true'>
            {initials}
          </div>
          <div className='user-settings-identity-copy'>
            <h3>{profile?.fullName || 'SmartLink User'}</h3>
            <p>{profile?.phone || profile?.email || 'No primary contact saved yet.'}</p>
            <small>{profile?.email || 'Add an email address from Settings to receive receipts and notices.'}</small>
          </div>
        </div>

        <div className='user-settings-hero-meta'>
          <span>Account role</span>
          <strong>{station?.name ? 'Linked station account' : 'Personal user account'}</strong>
          <small>{profile?.publicId || 'Pending sync'}</small>
        </div>
      </section>

      <section className='user-settings-card'>
        <header className='user-settings-section-head'>
          <div>
            <h3>Quick actions</h3>
            <p>Jump into profile settings, wallet billing, or end this session.</p>
          </div>
        </header>

        <div className='user-settings-actions'>
          <button type='button' className='details-action-button is-primary' onClick={() => onOpenSettings?.()}>
            Open settings
          </button>
          <button type='button' className='details-action-button' onClick={() => onOpenWallet?.()}>
            Open wallet
          </button>
          <button type='button' className='details-action-button' onClick={() => onLogout?.()}>
            Sign out
          </button>
        </div>
      </section>
    </div>
  )
}
