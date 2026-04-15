import { motion as _motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'

const TRUST_KEYS = ['item1', 'item2', 'item3', 'item4']

export function TrustSection() {
  const { t } = useTranslation()
  const prefersReducedMotion = useReducedMotion()

  return (
    <_motion.section
      id='security'
      className='landing-section landing-trust-section'
      initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
      whileInView={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.3, ease: 'easeOut' }}
    >
      <div className='landing-trust-band'>
        <div className='landing-trust-strip'>
          <div className='landing-trust-copy'>
            <p className='landing-kicker'>{t('landing.trust.eyebrow')}</p>
            <h2>{t('landing.trust.title')}</h2>
          </div>

          <div className='landing-trust-list'>
            {TRUST_KEYS.map((key) => (
              <article key={key}>
                <strong>{t(`landing.trust.${key}Value`)}</strong>
                <span>{t(`landing.trust.${key}Label`)}</span>
              </article>
            ))}
          </div>
        </div>
      </div>
    </_motion.section>
  )
}
