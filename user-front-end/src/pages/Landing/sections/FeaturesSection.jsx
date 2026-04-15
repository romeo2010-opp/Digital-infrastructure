import { motion as _motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { LandingGlyph } from '../components/LandingGlyph'

const FEATURES = [
  { key: 'availability', icon: 'signal' },
  { key: 'queue', icon: 'queue' },
  { key: 'reservation', icon: 'reservation' },
  { key: 'verified', icon: 'station' },
  { key: 'alerts', icon: 'report' },
  { key: 'transparency', icon: 'wallet' },
]

export function FeaturesSection() {
  const { t } = useTranslation()
  const prefersReducedMotion = useReducedMotion()

  return (
    <_motion.section
      id='capabilities'
      className='landing-section landing-features-section'
      initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
      whileInView={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.3, ease: 'easeOut' }}
    >
      <div className='landing-section-header landing-features-header'>
        <div>
          <p className='landing-kicker'>{t('landing.features.eyebrow')}</p>
          <h2>{t('landing.features.title')}</h2>
        </div>
        <p>{t('landing.features.subtitle')}</p>
      </div>

      <div className='landing-features-shell'>
        <div className='landing-features-grid'>
          {FEATURES.map((feature, index) => (
            <_motion.article
              key={feature.key}
              className='landing-feature-card'
              whileHover={prefersReducedMotion ? undefined : { y: -3 }}
              whileTap={prefersReducedMotion ? undefined : { scale: 0.995 }}
            >
              <div className='landing-feature-card-top'>
                <span className='landing-feature-icon'>
                  <LandingGlyph name={feature.icon} className='landing-glyph' />
                </span>
                <small>{String(index + 1).padStart(2, '0')}</small>
              </div>
              <h3>{t(`landing.features.${feature.key}Title`)}</h3>
              <p>{t(`landing.features.${feature.key}Body`)}</p>
            </_motion.article>
          ))}
        </div>
      </div>
    </_motion.section>
  )
}
