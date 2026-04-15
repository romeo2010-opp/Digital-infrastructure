import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import ny from './locales/ny.json'

export const LANGUAGE_STORAGE_KEY = 'smartlink.language'
export const LANGUAGE_SELECTED_KEY = 'smartlink.language.selected'

function resolveInitialLanguage() {
  const hasExplicitSelection = window.localStorage.getItem(LANGUAGE_SELECTED_KEY) === '1'
  if (!hasExplicitSelection) {
    return 'en'
  }
  const saved = String(window.localStorage.getItem(LANGUAGE_STORAGE_KEY) || '').trim().toLowerCase()
  if (saved === 'ny' || saved === 'en') return saved
  return 'en'
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ny: { translation: ny },
  },
  lng: resolveInitialLanguage(),
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
})

export function setSmartLinkLanguage(languageCode) {
  const scoped = String(languageCode || '').trim().toLowerCase() === 'ny' ? 'ny' : 'en'
  // Persist both the chosen language and explicit user confirmation for modal gating.
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, scoped)
  window.localStorage.setItem(LANGUAGE_SELECTED_KEY, '1')
  return i18n.changeLanguage(scoped)
}

export function hasSelectedSmartLinkLanguage() {
  return window.localStorage.getItem(LANGUAGE_SELECTED_KEY) === '1'
}

export default i18n
