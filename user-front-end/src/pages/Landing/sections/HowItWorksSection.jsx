import { motion as _motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'

const STEP_KEYS = ['step1', 'step2', 'step3']

export function HowItWorksSection() {
  const { t } = useTranslation()
  const prefersReducedMotion = useReducedMotion()

  return (
    <_motion.section
      id='how-it-works'
      className='landing-section landing-how-section'
      initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
      whileInView={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.3, ease: 'easeOut' }}
    >
      <div className='landing-section-header landing-how-header'>
        <div>
          <p className='landing-kicker'>{t('landing.how.eyebrow')}</p>
          <h2>{t('landing.how.title')}</h2>
        </div>
        <p>{t('landing.how.subtitle')}</p>
      </div>
      <div className='landing-steps-shell'>
        <div className='landing-steps-grid'>
          {STEP_KEYS.map((step, index) => (
            <_motion.article
              key={step}
              className='landing-step-card'
              initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
              whileInView={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.26, delay: prefersReducedMotion ? 0 : index * 0.08 }}
            >
              <span className='landing-step-index'>{index + 1}</span>
              <span className='landing-step-tag'>{t(`landing.how.${step}Tag`)}</span>
              <h3>{t(`landing.how.${step}Title`)}</h3>
              <p>{t(`landing.how.${step}Body`)}</p>
            </_motion.article>
          ))}
        </div>
      </div>
    </_motion.section>
  )
}
