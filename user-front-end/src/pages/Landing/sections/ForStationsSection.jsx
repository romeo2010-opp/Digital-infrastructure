import { motion as _motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { LandingGlyph } from '../components/LandingGlyph'

const PLATFORM_KEYS = [
  { key: 'drivers', icon: 'driver' },
  { key: 'stations', icon: 'station' },
  { key: 'enterprise', icon: 'network' },
]

export function ForStationsSection({ onPrimaryAction }) {
  const { t } = useTranslation()
  const prefersReducedMotion = useReducedMotion()

  return (
    <_motion.section
      id='platform'
      className='landing-section landing-platform-section'
      initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
      whileInView={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.3, ease: 'easeOut' }}
    >
      <div className='landing-platform-shell'>
        <div className='landing-station-pitch'>
          <div className='landing-section-copy'>
            <p className='landing-kicker'>{t('landing.stations.eyebrow')}</p>
            <h2>{t('landing.stations.title')}</h2>
            <p className='landing-station-subtitle'>{t('landing.stations.subtitle')}</p>
            <p>{t('landing.stations.description')}</p>
          </div>
          <button type='button' className='landing-btn primary' onClick={onPrimaryAction}>
            {t('landing.stations.cta')}
          </button>
        </div>

        <div className='landing-pricing-wrap'>
          <div className='landing-pricing-grid'>
            {PLATFORM_KEYS.map((item) => (
              <article key={item.key} className='landing-pricing-card'>
                <span className='landing-feature-icon'>
                  <LandingGlyph name={item.icon} className='landing-glyph' />
                </span>
                <h4>{t(`landing.stations.${item.key}Title`)}</h4>
                <p>{t(`landing.stations.${item.key}Body`)}</p>
                <ul className='landing-card-points'>
                  <li>{t(`landing.stations.${item.key}Point1`)}</li>
                  <li>{t(`landing.stations.${item.key}Point2`)}</li>
                  <li>{t(`landing.stations.${item.key}Point3`)}</li>
                </ul>
              </article>
            ))}
          </div>
          <article className='landing-platform-card'>
            <div className='landing-platform-card-copy'>
              <p className='landing-card-kicker'>{t('landing.stations.devEyebrow')}</p>
              <h3>{t('landing.stations.devTitle')}</h3>
              <p>{t('landing.stations.devBody')}</p>
            </div>
            <div className='landing-platform-chip-row'>
              <span>{t('landing.stations.devChip1')}</span>
              <span>{t('landing.stations.devChip2')}</span>
              <span>{t('landing.stations.devChip3')}</span>
              <span>{t('landing.stations.devChip4')}</span>
            </div>
          </article>
        </div>
      </div>
    </_motion.section>
  )
}
