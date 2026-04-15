import { motion as _motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'

export function FinalCtaSection({ onPrimaryAction, onSecondaryAction }) {
  const { t } = useTranslation()
  const prefersReducedMotion = useReducedMotion()

  return (
    <_motion.section
      id='contact'
      className='landing-section landing-final-section'
      initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
      whileInView={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.3, ease: 'easeOut' }}
    >
      <div className='landing-final-cta'>
        <div className='landing-final-cta-copy'>
          <p className='landing-kicker'>{t('landing.finalCta.eyebrow')}</p>
          <h2>{t('landing.finalCta.title')}</h2>
          <p>{t('landing.finalCta.subtitle')}</p>
          <small>{t('landing.finalCta.note')}</small>
        </div>
        <div className='landing-final-actions'>
          <_motion.button
            type='button'
            className='landing-btn primary'
            onClick={onPrimaryAction}
            whileHover={prefersReducedMotion ? undefined : { y: -1 }}
            whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}
          >
            {t('landing.finalCta.primary')}
          </_motion.button>
          <_motion.button
            type='button'
            className='landing-btn secondary'
            onClick={onSecondaryAction}
            whileHover={prefersReducedMotion ? undefined : { y: -1 }}
            whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}
          >
            {t('landing.finalCta.secondary')}
          </_motion.button>
        </div>
      </div>

      <footer className='landing-footer'>
        <div className='landing-footer-brand'>
          <a className='landing-nav-brand' href='#top' aria-label='SmartLink'>
            <img src='/smartlogo.png' alt='' />
            <span>SmartLink</span>
          </a>
          <p>{t('landing.footer.tagline')}</p>
          <small>{t('landing.footer.rights')}</small>
        </div>
        <div className='landing-footer-grid'>
          <div>
            <h3>{t('landing.footer.productTitle')}</h3>
            <a href='#product'>{t('landing.footer.productLink1')}</a>
            <a href='#drivers'>{t('landing.footer.productLink2')}</a>
            <a href='#platform'>{t('landing.footer.productLink3')}</a>
          </div>
          <div>
            <h3>{t('landing.footer.solutionsTitle')}</h3>
            <a href='#drivers'>{t('landing.footer.solutionsLink1')}</a>
            <a href='#platform'>{t('landing.footer.solutionsLink2')}</a>
            <a href='#platform'>{t('landing.footer.solutionsLink3')}</a>
          </div>
          <div>
            <h3>{t('landing.footer.developersTitle')}</h3>
            <a href='#platform'>{t('landing.footer.developersLink1')}</a>
            <a href='#platform'>{t('landing.footer.developersLink2')}</a>
            <a href='#platform'>{t('landing.footer.developersLink3')}</a>
          </div>
          <div>
            <h3>{t('landing.footer.companyTitle')}</h3>
            <a href='#platform'>{t('landing.footer.companyLink1')}</a>
            <a href='#contact'>{t('landing.footer.companyLink2')}</a>
            <a href='#contact'>{t('landing.footer.companyLink3')}</a>
          </div>
          <div>
            <h3>{t('landing.footer.legalTitle')}</h3>
            <a href='#security'>{t('landing.footer.privacy')}</a>
            <a href='#security'>{t('landing.footer.terms')}</a>
            <a href='#contact'>{t('landing.footer.contact')}</a>
          </div>
        </div>
      </footer>
    </_motion.section>
  )
}
