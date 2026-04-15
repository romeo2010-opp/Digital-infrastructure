import { useMemo, useState } from 'react'
import {
  AccountIcon,
  BellIcon,
  ChevronRightIcon,
  EyeIcon,
  HeadphonesIcon,
  InfoIcon,
  ReservationIcon,
  SavedIcon,
  SearchIcon,
  ShieldIcon,
  WalletIcon,
} from '../icons'

const primaryItems = [
  { key: 'account', label: 'Account', path: '/m/account', Icon: AccountIcon },
  { key: 'notifications', label: 'Notifications', path: '/m/alerts', Icon: BellIcon },
  { key: 'appearance', label: 'Appearance', path: '/m/settings', Icon: EyeIcon },
  { key: 'privacy', label: 'Privacy & Security', path: '/m/settings', Icon: ShieldIcon },
  { key: 'help', label: 'Help and Support', path: '/m/help', Icon: HeadphonesIcon },
  { key: 'about', label: 'About', path: '/m/help', Icon: InfoIcon },
]

const secondaryItems = [
  { key: 'saved', label: 'Saved Stations', path: '/m/saved', Icon: SavedIcon },
  { key: 'reservations', label: 'Reservations', path: '/m/reservations', Icon: ReservationIcon },
  { key: 'history', label: 'History', path: '/m/history', Icon: WalletIcon },
]

function filterItems(items, query) {
  const needle = String(query || '').trim().toLowerCase()
  if (!needle) return items
  return items.filter((item) => String(item.label || '').toLowerCase().includes(needle))
}

export function MoreScreen({ onNavigate, onLogout, unreadAlertsCount = 0 }) {
  const [query, setQuery] = useState('')

  const filteredPrimaryItems = useMemo(() => filterItems(primaryItems, query), [query])
  const filteredSecondaryItems = useMemo(() => filterItems(secondaryItems, query), [query])
  const hasMatches = filteredPrimaryItems.length > 0 || filteredSecondaryItems.length > 0

  return (
    <section className='more-settings-screen'>
      <header className='screen-header more-settings-header'>
        <h2>Settings</h2>
      </header>

      <label className='more-settings-search' aria-label='Search settings'>
        <SearchIcon size={16} />
        <input
          type='search'
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder='Search for a setting...'
        />
      </label>

      {hasMatches ? (
        <>
          <section className='more-settings-list' aria-label='Settings links'>
            {filteredPrimaryItems.map((item) => {
              const showUnreadBadge = item.key === 'notifications' && Number(unreadAlertsCount || 0) > 0
              return (
                <button
                  key={item.key}
                  type='button'
                  className='more-settings-row'
                  onClick={() => onNavigate?.(item.path)}
                >
                  <span className='more-settings-row-left'>
                    <span className={`more-settings-icon ${showUnreadBadge ? 'has-badge' : ''}`}>
                      <item.Icon size={18} />
                      {showUnreadBadge ? <span className='more-settings-badge' aria-hidden='true' /> : null}
                    </span>
                    <span className='more-settings-copy'>{item.label}</span>
                  </span>
                  <ChevronRightIcon size={18} />
                </button>
              )
            })}
          </section>

          {filteredSecondaryItems.length ? (
            <section className='more-settings-section'>
              <p className='more-settings-section-title'>Quick Access</p>
              <section className='more-settings-list' aria-label='Quick links'>
                {filteredSecondaryItems.map((item) => (
                  <button
                    key={item.key}
                    type='button'
                    className='more-settings-row'
                    onClick={() => onNavigate?.(item.path)}
                  >
                    <span className='more-settings-row-left'>
                      <span className='more-settings-icon'>
                        <item.Icon size={18} />
                      </span>
                      <span className='more-settings-copy'>{item.label}</span>
                    </span>
                    <ChevronRightIcon size={18} />
                  </button>
                ))}
              </section>
            </section>
          ) : null}
        </>
      ) : (
        <section className='station-card coming-soon'>
          <p>No settings matched "{query}".</p>
        </section>
      )}

      <button type='button' className='more-settings-logout' onClick={() => onLogout?.()}>
        Sign out
      </button>
    </section>
  )
}
