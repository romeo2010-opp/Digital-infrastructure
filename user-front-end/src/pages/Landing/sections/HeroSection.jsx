import { motion as _motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'

export function HeroSection({ onPrimaryAction, onSecondaryAction }) {
  const { t } = useTranslation()
  const prefersReducedMotion = useReducedMotion()

  const staggerContainer = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: prefersReducedMotion ? 0 : 0.09,
      },
    },
  }

  const childVariant = {
    hidden: prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0 },
  }

  return (
    <section id='product' className='landing-hero-wrap'>
      <img
        src='/landing/hero-fuel-network.png'
        alt=''
        className='landing-hero-image'
        aria-hidden='true'
        loading='eager'
      />
      <div className='landing-hero-bg' aria-hidden='true' />
      <div className='landing-hero-shell'>
        <_motion.div
          className='landing-hero'
          variants={staggerContainer}
          initial='hidden'
          animate='visible'
        >
          <div className='landing-hero-copy'>
            <_motion.p className='landing-kicker' variants={childVariant}>
              {t('landing.hero.eyebrow')}
            </_motion.p>
            <_motion.h1 variants={childVariant}>
              <span className='landing-hero-title-accent'>{t('landing.hero.titleLead')}</span>
              <span className='landing-hero-title-stack'>
                <span>{t('landing.hero.titleLine1')}</span>
                <span>{t('landing.hero.titleLine2')}</span>
                <span>{t('landing.hero.titleLine3')}</span>
              </span>
            </_motion.h1>
            <_motion.p className='landing-hero-subtitle' variants={childVariant}>
              {t('landing.hero.subtitle')}
            </_motion.p>
            <_motion.div className='landing-hero-actions' variants={childVariant}>
              <_motion.button
                type='button'
                className='landing-btn primary'
                onClick={onPrimaryAction}
                whileHover={prefersReducedMotion ? undefined : { y: -1 }}
                whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}
              >
                {t('landing.hero.ctaPrimary')}
              </_motion.button>
              <_motion.button
                type='button'
                className='landing-btn secondary'
                onClick={onSecondaryAction}
                whileHover={prefersReducedMotion ? undefined : { y: -1 }}
                whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}
              >
                {t('landing.hero.ctaSecondary')}
              </_motion.button>
            </_motion.div>
            <_motion.ul className='landing-hero-badges' variants={childVariant}>
              <li>{t('landing.hero.badge1')}</li>
              <li>{t('landing.hero.badge2')}</li>
              <li>{t('landing.hero.badge3')}</li>
            </_motion.ul>
          </div>

          <_motion.div className='landing-network-console' variants={childVariant}>
            <article className='landing-hero-panel'>
              <div>
                <p className='landing-hero-panel-label'>{t('landing.hero.panelEyebrow')}</p>
                <strong className='landing-hero-panel-title'>{t('landing.hero.panelTitle')}</strong>
              </div>
              <span className='landing-console-live'>{t('landing.hero.status.active')}</span>
              <p className='landing-hero-panel-copy'>{t('landing.hero.panelSub')}</p>
            </article>

            <div className='landing-hero-proof'>
              <article>
                <strong>{t('landing.hero.metric1Value')}</strong>
                <span>{t('landing.hero.metric1Label')}</span>
              </article>
              <article>
                <strong>{t('landing.hero.metric2Value')}</strong>
                <span>{t('landing.hero.metric2Label')}</span>
              </article>
              <article>
                <strong>{t('landing.hero.metric3Value')}</strong>
                <span>{t('landing.hero.metric3Label')}</span>
              </article>
            </div>

            <div className='landing-console-feed' aria-label='SmartLink operating signals'>
              <article>
                <span>{t('landing.hero.summary1Title')}</span>
                <strong>{t('landing.hero.summary1Body')}</strong>
              </article>
              <article>
                <span>{t('landing.hero.summary2Title')}</span>
                <strong>{t('landing.hero.summary2Body')}</strong>
              </article>
              <article>
                <span>{t('landing.hero.summary3Title')}</span>
                <strong>{t('landing.hero.summary3Body')}</strong>
              </article>
            </div>
          </_motion.div>
        </_motion.div>
      </div>
    </section>
  )
}
