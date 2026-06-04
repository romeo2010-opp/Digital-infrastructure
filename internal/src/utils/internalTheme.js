export const INTERNAL_THEME_STORAGE_KEY = "smartlink.internal.theme"
export const INTERNAL_MERA_LIGHT_THEME = "mera-light"

export function applyInternalLightTheme() {
  if (typeof document === "undefined") return
  const root = document.documentElement
  root.dataset.internalTheme = INTERNAL_MERA_LIGHT_THEME
  root.dataset.meraTheme = "light"
  root.classList.remove("dark")
  delete root.dataset.theme
  try {
    window.localStorage?.setItem(INTERNAL_THEME_STORAGE_KEY, INTERNAL_MERA_LIGHT_THEME)
    window.localStorage?.setItem("sl-theme", "light")
  } catch {
    // Theme storage is best-effort only.
  }
}
