import { AnimatePresence, motion as _motion, useReducedMotion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  hasSelectedSmartLinkLanguage,
  setSmartLinkLanguage,
} from '../../i18n'
import { LanguageModal } from './components/LanguageModal'
import { ScrollProgress } from './components/ScrollProgress'
import { FinalCtaSection } from './sections/FinalCtaSection'
import { ForStationsSection } from './sections/ForStationsSection'
import { FeaturesSection } from './sections/FeaturesSection'
import { HeroSection } from './sections/HeroSection'
import { HowItWorksSection } from './sections/HowItWorksSection'
import { LiveMapSection } from './sections/LiveMapSection'
import { NavSection } from './sections/NavSection'
import { TrustSection } from './sections/TrustSection'
import './landing.css'

export function LandingPage({ onOpenMap, onLogin, onSignUp }) {
  const { i18n, t } = useTranslation()
  const prefersReducedMotion = useReducedMotion()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [showLanguageModal, setShowLanguageModal] = useState(() => !hasSelectedSmartLinkLanguage())

  const activeLanguage = useMemo(() => (String(i18n.language || '').toLowerCase() === 'ny' ? 'ny' : 'en'), [i18n.language])

  useEffect(() => {
    document.title = t('landing.metaTitle')
  }, [t, activeLanguage])

  useEffect(() => {
    if (!mobileMenuOpen) return

    const closeOnResize = () => {
      if (window.innerWidth > 900) {
        setMobileMenuOpen(false)
      }
    }

    window.addEventListener('resize', closeOnResize)
    return () => {
      window.removeEventListener('resize', closeOnResize)
    }
  }, [mobileMenuOpen])

  const handleLanguageChoice = async (languageCode) => {
    await setSmartLinkLanguage(languageCode)
    setShowLanguageModal(false)
    setMobileMenuOpen(false)
  }

  const handleLanguageToggle = async (languageCode) => {
    const next = languageCode === 'ny' ? 'ny' : 'en'
    if (next === activeLanguage) return
    await setSmartLinkLanguage(next)
    setMobileMenuOpen(false)
  }

  return (
    <main id='top' className='landing-root'>
      <ScrollProgress />
      <NavSection
        mobileMenuOpen={mobileMenuOpen}
        onToggleMobileMenu={() => setMobileMenuOpen((value) => !value)}
        onCloseMobileMenu={() => setMobileMenuOpen(false)}
        activeLanguage={activeLanguage}
        onChangeLanguage={handleLanguageToggle}
        onPrimaryAction={onSignUp}
        onSecondaryAction={onLogin}
      />

      <AnimatePresence mode='wait'>
        <_motion.div
          key={activeLanguage}
          className='landing-content'
          initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.22, ease: 'easeOut' }}
        >
          <HeroSection onPrimaryAction={onOpenMap} onSecondaryAction={onSignUp} />
          <TrustSection />
          <FeaturesSection />
          <LiveMapSection onPrimaryAction={onOpenMap} />
          <HowItWorksSection />
          <ForStationsSection onPrimaryAction={onSignUp} />
          <FinalCtaSection onPrimaryAction={onOpenMap} onSecondaryAction={onSignUp} />
        </_motion.div>
      </AnimatePresence>

      <LanguageModal open={showLanguageModal} onChooseLanguage={handleLanguageChoice} />
    </main>
  )
}
