import { AnimatePresence, motion as _motion, useReducedMotion } from 'framer-motion'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

function focusableNodes(container) {
  if (!container) return []
  const selector = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',')
  return Array.from(container.querySelectorAll(selector))
}

export function LanguageModal({ open, onChooseLanguage }) {
  const { t } = useTranslation()
  const prefersReducedMotion = useReducedMotion()
  const dialogRef = useRef(null)
  const englishButtonRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    window.setTimeout(() => {
      englishButtonRef.current?.focus()
    }, 0)

    const onKeyDown = (event) => {
      if (event.key !== 'Tab') return
      const nodes = focusableNodes(dialogRef.current)
      if (!nodes.length) return

      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement

      if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const transition = useMemo(
    () => (prefersReducedMotion ? { duration: 0 } : { duration: 0.22, ease: 'easeOut' }),
    [prefersReducedMotion]
  )

  return (
    <AnimatePresence>
      {open ? (
        <_motion.div
          className='landing-language-modal-backdrop'
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition}
          role='presentation'
        >
          <_motion.div
            ref={dialogRef}
            className='landing-language-modal'
            role='dialog'
            aria-modal='true'
            aria-labelledby='landing-language-title'
            aria-describedby='landing-language-description'
            initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
            transition={transition}
          >
            <div className='landing-language-modal-top'>
              <div className='landing-language-modal-brand'>
                <img src='/smartlogo.png' alt='' />
                <span>SmartLink</span>
              </div>
              <span className='landing-language-modal-tag'>{t('landing.modal.tag')}</span>
            </div>

            <div className='landing-language-modal-copy'>
              <h2 id='landing-language-title'>{t('landing.modal.title')}</h2>
              <p id='landing-language-description'>{t('landing.modal.description')}</p>
            </div>

            <div className='landing-language-actions' role='group' aria-label={t('landing.modal.title')}>
              <button
                ref={englishButtonRef}
                type='button'
                className='landing-language-option'
                onClick={() => onChooseLanguage('en')}
              >
                <span className='landing-language-option-code'>EN</span>
                <span className='landing-language-option-copy'>
                  <strong>{t('landing.modal.english')}</strong>
                  <small>{t('landing.modal.englishDescription')}</small>
                </span>
              </button>
              <button
                type='button'
                className='landing-language-option is-primary'
                onClick={() => onChooseLanguage('ny')}
              >
                <span className='landing-language-option-code'>NY</span>
                <span className='landing-language-option-copy'>
                  <strong>{t('landing.modal.chichewa')}</strong>
                  <small>{t('landing.modal.chichewaDescription')}</small>
                </span>
              </button>
            </div>

            <p className='landing-language-modal-note'>{t('landing.modal.note')}</p>
          </_motion.div>
        </_motion.div>
      ) : null}
    </AnimatePresence>
  )
}
