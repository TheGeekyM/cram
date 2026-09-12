// Light/dark theme, applied as [data-theme] on <html> and persisted.
const KEY = 'cram-theme'

export function initTheme() {
  const saved = localStorage.getItem(KEY)
  const t = saved || 'dark'   // dark by default; only the user's saved choice overrides
  document.documentElement.setAttribute('data-theme', t)
  return t
}

export function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark'
}

export function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t)
  localStorage.setItem(KEY, t)
}

export function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}
