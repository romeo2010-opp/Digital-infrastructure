const THEME_STORAGE_KEY = "smartlink.theme.preference"

export function getStoredThemePreference() {
  const value = window.localStorage.getItem(THEME_STORAGE_KEY)
  return value === "LIGHT" || value === "DARK" || value === "SYSTEM" ? value : null
}

export function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function resolveTheme(preference) {
  const normalized = String(preference || "SYSTEM").toUpperCase()
  if (normalized === "DARK") return "dark"
  if (normalized === "LIGHT") return "light"
  return getSystemTheme()
}

export function applyThemePreference(preference) {
  const normalized = String(preference || "SYSTEM").toUpperCase()
  const nextTheme = resolveTheme(normalized)
  document.documentElement.setAttribute("data-theme", nextTheme)
  window.localStorage.setItem(THEME_STORAGE_KEY, normalized)
  return nextTheme
}
