import { motion as _motion, useReducedMotion } from 'framer-motion'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LandingMapboxPanel } from '../components/LandingMapboxPanel'
import { LandingGlyph } from '../components/LandingGlyph'

const STATION_ROWS = [
  { id: 'row-1', name: 'BP Ginnery Corner', queue: '14 min', fuel: 'PETROL', lat: -15.7858, lng: 35.0036, eta: '9 min', reserveKey: 'available' },
  { id: 'row-2', name: 'Engen Naperi', queue: '8 min', fuel: 'DIESEL', lat: -15.7794, lng: 35.0028, eta: '6 min', reserveKey: 'available' },
  { id: 'row-3', name: 'Puma Limbe Market', queue: '18 min', fuel: 'PETROL', lat: -15.8171, lng: 35.0482, eta: '14 min', reserveKey: 'windowed' },
]

const BULLET_KEYS = ['bullet1', 'bullet2', 'bullet3']

export function LiveMapSection({ onPrimaryAction }) {
  const { t } = useTranslation()
  const prefersReducedMotion = useReducedMotion()
  const [selectedStationId, setSelectedStationId] = useState(STATION_ROWS[0]?.id || '')
  const selectedStation = useMemo(
    () => STATION_ROWS.find((station) => station.id === selectedStationId) || STATION_ROWS[0],
    [selectedStationId]
  )

  return (
    <_motion.section
      id='drivers'
      className='landing-section landing-map-section'
      initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
      whileInView={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.32, ease: 'easeOut' }}
    >
      <div className='landing-split-section landing-map-shell'>
        <div className='landing-section-copy landing-map-copy'>
          <p className='landing-kicker'>{t('landing.mapPreview.eyebrow')}</p>
          <h2>{t('landing.mapPreview.title')}</h2>
          <p>{t('landing.mapPreview.subtitle')}</p>
          <ul className='landing-benefit-list'>
            {BULLET_KEYS.map((key) => (
              <li key={key}>
                <LandingGlyph name='shield' className='landing-benefit-icon' />
                <span>{t(`landing.mapPreview.${key}`)}</span>
              </li>
            ))}
          </ul>
          <button type='button' className='landing-btn primary' onClick={onPrimaryAction}>
            {t('landing.mapPreview.view')}
          </button>
        </div>

        <div className='landing-live-map-grid'>
          <LandingMapboxPanel
            stations={STATION_ROWS}
            selectedStationId={selectedStationId}
            onSelectStation={setSelectedStationId}
            interactive
            className='landing-live-map-panel'
          />

          <article className='landing-live-map-card'>
            <div className='landing-live-map-card-header'>
              <div>
                <p className='landing-card-kicker'>{t('landing.mapPreview.cardTitle')}</p>
                <h3>{selectedStation?.name}</h3>
              </div>
              <span>{t(`landing.mapPreview.reserveState.${selectedStation?.reserveKey || 'available'}`)}</span>
            </div>
            <div className='landing-live-map-stat-grid'>
              <div>
                <span>{t('landing.mapPreview.queue')}</span>
                <strong>{selectedStation?.queue}</strong>
              </div>
              <div>
                <span>{t('landing.mapPreview.eta')}</span>
                <strong>{selectedStation?.eta}</strong>
              </div>
              <div>
                <span>{t('landing.mapPreview.fuel')}</span>
                <strong>{selectedStation?.fuel}</strong>
              </div>
              <div>
                <span>{t('landing.mapPreview.reserve')}</span>
                <strong>{t(`landing.mapPreview.reserveState.${selectedStation?.reserveKey || 'available'}`)}</strong>
              </div>
            </div>
            <div className='landing-live-map-list'>
              {STATION_ROWS.map((station) => (
                <button
                  key={station.id}
                  type='button'
                  className={`landing-live-map-list-item ${selectedStationId === station.id ? 'is-selected' : ''}`}
                  onClick={() => setSelectedStationId(station.id)}
                >
                  <span>{station.name}</span>
                  <small>
                    {station.fuel} · {station.queue}
                  </small>
                </button>
              ))}
            </div>
            <div className='landing-live-map-insight'>
              <p className='landing-card-kicker'>{t('landing.mapPreview.insightTitle')}</p>
              <ul>
                <li>{t('landing.mapPreview.insight1')}</li>
                <li>{t('landing.mapPreview.insight2')}</li>
                <li>{t('landing.mapPreview.insight3')}</li>
              </ul>
            </div>
          </article>
        </div>
      </div>
    </_motion.section>
  )
}
