import { AnimatePresence, motion as _motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'

const NAV_LINKS = [
  {
    key: 'product',
    href: '#product',
    items: [
      { labelKey: 'menuOverview', href: '#product' },
      { labelKey: 'menuCapabilities', href: '#capabilities' },
      { labelKey: 'menuFlow', href: '#how-it-works' },
    ],
  },
  {
    key: 'drivers',
    href: '#drivers',
    items: [
      { labelKey: 'menuMap', href: '#drivers' },
      { labelKey: 'menuQueues', href: '#drivers' },
      { labelKey: 'menuReserve', href: '#drivers' },
    ],
  },
  {
    key: 'stations',
    href: '#platform',
    items: [
      { labelKey: 'menuOps', href: '#platform' },
      { labelKey: 'menuDemo', href: '#platform' },
      { labelKey: 'menuReports', href: '#platform' },
    ],
  },
  {
    key: 'platform',
    href: '#platform',
    items: [
      { labelKey: 'menuEnterprise', href: '#platform' },
      { labelKey: 'menuIntegrations', href: '#platform' },
      { labelKey: 'menuTelemetry', href: '#platform' },
    ],
  },
  {
    key: 'contact',
    href: '#contact',
    items: [
      { labelKey: 'menuPartners', href: '#contact' },
      { labelKey: 'menuSupport', href: '#contact' },
      { labelKey: 'menuLegal', href: '#security' },
    ],
  },
]

export function NavSection({
  mobileMenuOpen,
  onToggleMobileMenu,
  onCloseMobileMenu,
  activeLanguage,
  onChangeLanguage,
  onPrimaryAction,
  onSecondaryAction,
}) {
  const { t } = useTranslation()
  const prefersReducedMotion = useReducedMotion()

  const drawerVariants = {
    hidden: prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -12 },
    visible: { opacity: 1, y: 0 },
    exit: prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 },
  }

  return (
    <_motion.header
      className='landing-nav'
      initial={prefersReducedMotion ? false : { opacity: 0, y: -14 }}
      animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.34, ease: 'easeOut' }}
    >
      <div className='landing-nav-inner'>
        <a className='landing-nav-brand' href='#top' aria-label='SmartLink'>
          <img src='/smartlogo.png' alt='' />
          <span>SmartLink</span>
        </a>

        <nav className='landing-nav-links' aria-label='Primary'>
          {NAV_LINKS.map((link) => (
            <div key={link.key} className='landing-nav-item'>
              <a href={link.href} className='landing-nav-link'>
                <span>{t(`landing.nav.${link.key}`)}</span>
                <svg viewBox='0 0 12 12' aria-hidden='true'>
                  <path d='M3 4.5 6 7.5 9 4.5' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' />
                </svg>
              </a>
              <div className='landing-nav-dropdown' role='menu'>
                {link.items.map((item) => (
                  <a key={item.labelKey} href={item.href} className='landing-nav-dropdown-link' role='menuitem'>
                    {t(`landing.nav.${item.labelKey}`)}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className='landing-nav-actions'>
          <div className='landing-language-switch' role='group' aria-label={t('landing.nav.language')}>
            <button
              type='button'
              className={activeLanguage === 'en' ? 'is-active' : ''}
              onClick={() => onChangeLanguage('en')}
            >
              EN
            </button>
            <button
              type='button'
              className={activeLanguage === 'ny' ? 'is-active' : ''}
              onClick={() => onChangeLanguage('ny')}
            >
              NY
            </button>
          </div>
          <_motion.button
            type='button'
            className='landing-btn secondary'
            onClick={onSecondaryAction}
            whileHover={prefersReducedMotion ? undefined : { y: -1 }}
            whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}
          >
            {t('landing.nav.login')}
          </_motion.button>
          <_motion.button
            type='button'
            className='landing-btn primary'
            onClick={onPrimaryAction}
            whileHover={prefersReducedMotion ? undefined : { y: -1 }}
            whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}
          >
            {t('landing.nav.getStarted')}
          </_motion.button>
        </div>

        <button
          type='button'
          className='landing-mobile-menu-toggle'
          aria-label='Toggle navigation menu'
          aria-expanded={mobileMenuOpen}
          onClick={onToggleMobileMenu}
        >
          <span />
          <span />
          <span />
        </button>

        <AnimatePresence>
          {mobileMenuOpen ? (
            <_motion.div
              className='landing-mobile-menu'
              initial='hidden'
              animate='visible'
              exit='exit'
              variants={drawerVariants}
              transition={{ duration: prefersReducedMotion ? 0 : 0.2, ease: 'easeOut' }}
            >
              <nav aria-label='Mobile'>
                {NAV_LINKS.map((link) => (
                  <a key={link.key} href={link.href} onClick={onCloseMobileMenu}>
                    {t(`landing.nav.${link.key}`)}
                  </a>
                ))}
              </nav>
              <div className='landing-mobile-menu-footer'>
                <div className='landing-language-switch' role='group' aria-label={t('landing.nav.language')}>
                  <button
                    type='button'
                    className={activeLanguage === 'en' ? 'is-active' : ''}
                    onClick={() => onChangeLanguage('en')}
                  >
                    EN
                  </button>
                  <button
                    type='button'
                    className={activeLanguage === 'ny' ? 'is-active' : ''}
                    onClick={() => onChangeLanguage('ny')}
                  >
                    NY
                  </button>
                </div>
                <button
                  type='button'
                  className='landing-btn secondary'
                  onClick={() => {
                    onCloseMobileMenu()
                    onSecondaryAction()
                  }}
                >
                  {t('landing.nav.login')}
                </button>
                <button
                  type='button'
                  className='landing-btn primary'
                  onClick={() => {
                    onCloseMobileMenu()
                    onPrimaryAction()
                  }}
                >
                  {t('landing.nav.getStarted')}
                </button>
              </div>
            </_motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </_motion.header>
  )
}
