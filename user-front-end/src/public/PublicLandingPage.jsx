import { useEffect, useMemo, useState } from 'react'
import { stations as mockStations } from '../mobile/mockStations'
import './publicLanding.css'

function fuelToneLabel(level) {
  const normalized = String(level || '').trim().toLowerCase()
  if (normalized === 'high') return { label: 'High', tone: 'safe' }
  if (normalized === 'medium') return { label: 'Medium', tone: 'warning' }
  if (normalized === 'low') return { label: 'Low', tone: 'danger' }
  return { label: 'Unknown', tone: 'muted' }
}

export function PublicLandingPage({
  onOpenMap,
  onLogin,
  onSignUp,
}) {
  const [isNavOpen, setIsNavOpen] = useState(false)
  const featuredStations = useMemo(() => mockStations.slice(0, 6), [])
  const mapPins = useMemo(() => mockStations.slice(0, 5), [])

  useEffect(() => {
    document.title = 'SmartLink | Fuel Availability and Queue Access'
  }, [])

  return (
    <main className='public-landing'>
      <header className='public-nav'>
        <div className='public-nav-brand'>
          <img src='/smartlogo.png' alt='SmartLink' />
          <span>SmartLink</span>
        </div>
        <nav className='public-nav-links' aria-label='Landing sections'>
          <a href='#fuel-map'>Fuel Map</a>
          <a href='#how-it-works'>How it Works</a>
          <a href='#stations'>Stations</a>
          <a href='#benefits'>Benefits</a>
          <a href='#download'>Download</a>
        </nav>
        <button
          type='button'
          className='public-nav-toggle'
          aria-label='Toggle navigation menu'
          aria-expanded={isNavOpen}
          onClick={() => setIsNavOpen((value) => !value)}
        >
          <span />
          <span />
          <span />
        </button>
        <div className='public-nav-actions'>
          <button type='button' className='public-btn secondary' onClick={onLogin}>
            Login
          </button>
          <button type='button' className='public-btn primary' onClick={onSignUp}>
            Sign up
          </button>
        </div>
      </header>
      <div className={`public-nav-mobile-panel ${isNavOpen ? 'is-open' : ''}`}>
        <a href='#fuel-map' onClick={() => setIsNavOpen(false)}>Fuel Map</a>
        <a href='#how-it-works' onClick={() => setIsNavOpen(false)}>How it Works</a>
        <a href='#stations' onClick={() => setIsNavOpen(false)}>Stations</a>
        <a href='#benefits' onClick={() => setIsNavOpen(false)}>Benefits</a>
        <a href='#download' onClick={() => setIsNavOpen(false)}>Download</a>
        <div className='public-nav-mobile-actions'>
          <button
            type='button'
            className='public-btn secondary'
            onClick={() => {
              setIsNavOpen(false)
              onLogin?.()
            }}
          >
            Login
          </button>
          <button
            type='button'
            className='public-btn primary'
            onClick={() => {
              setIsNavOpen(false)
              onSignUp?.()
            }}
          >
            Sign up
          </button>
        </div>
      </div>

      <section id='fuel-map' className='public-hero'>
        <div className='public-hero-copy'>
          <p className='public-kicker'>Live Fuel Availability</p>
          <h1>Find fuel faster with less uncertainty</h1>
          <p>
            SmartLink shows nearby stations, fuel availability, and queue movement in one place.
            Open the map to choose a station and continue.
          </p>
          <div className='public-hero-actions'>
            <button type='button' className='public-btn primary' onClick={onOpenMap}>
              Open Fuel Map
            </button>
            <button type='button' className='public-btn secondary' onClick={onLogin}>
              Login to Continue
            </button>
          </div>
        </div>

        <article className='public-map-preview' aria-label='Fuel availability preview map'>
          <div className='public-map-grid' aria-hidden='true' />
          {mapPins.map((station, index) => {
            const tone = fuelToneLabel(station.fuelLevel)
            return (
              <div
                key={station.id}
                className={`public-map-pin tone-${tone.tone}`}
                style={{
                  left: `${20 + (index % 3) * 28}%`,
                  top: `${22 + Math.floor(index / 2) * 22}%`,
                }}
                title={`${station.name} (${tone.label})`}
              />
            )
          })}
          <div className='public-map-legend'>
            <span><em className='tone-safe' /> High</span>
            <span><em className='tone-warning' /> Medium</span>
            <span><em className='tone-danger' /> Low</span>
          </div>
        </article>
      </section>

      <section id='how-it-works' className='public-section'>
        <h2>How SmartLink Works</h2>
        <div className='public-steps'>
          <article>
            <strong>1</strong>
            <h3>Open the map</h3>
            <p>See stations with current fuel availability and activity status.</p>
          </article>
          <article>
            <strong>2</strong>
            <h3>Choose a station</h3>
            <p>Review queue conditions, fuel type options, and station details.</p>
          </article>
          <article>
            <strong>3</strong>
            <h3>Join or reserve</h3>
            <p>Secure your place and get live updates until you are served.</p>
          </article>
        </div>
      </section>

      <section id='stations' className='public-section'>
        <h2>Supported Stations</h2>
        <div className='public-station-grid'>
          {featuredStations.map((station) => {
            const fuelTone = fuelToneLabel(station.fuelLevel)
            return (
              <article key={station.id} className='public-station-card'>
                <h3>{station.name}</h3>
                <p>{station.address}</p>
                <div className='public-station-meta'>
                  <span>{Number(station.distanceKm || 0).toFixed(1)} km away</span>
                  <span className={`status-${fuelTone.tone}`}>{fuelTone.label} fuel</span>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section id='benefits' className='public-section'>
        <h2>Benefits</h2>
        <div className='public-benefits'>
          <article>
            <h3>Less queue guesswork</h3>
            <p>Track queue and serving status so you know when to move.</p>
          </article>
          <article>
            <h3>Faster decisions</h3>
            <p>Compare stations quickly by distance, ETA, and fuel status.</p>
          </article>
          <article>
            <h3>Reliable alerts</h3>
            <p>Receive manager and system notifications when timing changes.</p>
          </article>
        </div>
      </section>

      <section id='download' className='public-section public-download'>
        <div>
          <h2>Download Mobile App</h2>
          <p>Install SmartLink on your phone for realtime queue tracking and reservations.</p>
        </div>
        <div className='public-download-actions'>
          <button type='button' className='public-btn secondary' onClick={onSignUp}>
            Get Started
          </button>
          <button type='button' className='public-btn ghost' onClick={onLogin}>
            Already have account
          </button>
        </div>
      </section>

      <section className='public-section public-auth-cta'>
        <h2>Ready to continue?</h2>
        <p>Create your SmartLink account or login to access the full station map and queue tools.</p>
        <div className='public-hero-actions'>
          <button type='button' className='public-btn primary' onClick={onSignUp}>
            Sign up
          </button>
          <button type='button' className='public-btn secondary' onClick={onLogin}>
            Login
          </button>
        </div>
      </section>
    </main>
  )
}
