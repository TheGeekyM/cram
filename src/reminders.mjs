// Study reminders set by the learner: a time, days of the week and a label. They fire while Cram is running
// (in-app alert + desktop notification + chime). Stored in localStorage: one user, one machine.
// ponytail: app must be open; the cron-based daily nudge in Settings covers the closed-app case.
const KEY = 'cram:reminders', FIRED = 'cram:reminders-fired'
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }
export const load = () => read(KEY, [])
export const save = list => { write(KEY, list); window.dispatchEvent(new Event('cram:reminders')) }
export const loadFired = () => read(FIRED, {})
export const saveFired = f => write(FIRED, f)

const pad = n => String(n).padStart(2, '0')
export const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
// A reminder is due when it is on, today is one of its days, its time has passed within the last GRACE minutes
// (so a sleeping laptop or a throttled timer still fires it), and it has not fired today.
// A snoozed reminder is due once its snooze time passes.
export const GRACE = 15
export function due(r, now, fired = {}) {
  if (!r.on) return false
  if (r.snoozeUntil) return now.getTime() >= r.snoozeUntil
  if (!r.days?.includes(now.getDay())) return false
  const [h, m] = String(r.time || '').split(':').map(Number); if (Number.isNaN(h) || Number.isNaN(m)) return false
  const at = new Date(now); at.setHours(h, m, 0, 0)
  const late = (now - at) / 6e4
  return late >= 0 && late < GRACE && fired[r.id] !== dayKey(now)
}
// next time a reminder will fire, for the settings list
export function nextAt(r, now = new Date()) {
  if (!r.on || !r.days?.length) return null
  if (r.snoozeUntil) return new Date(r.snoozeUntil)
  const [h, m] = r.time.split(':').map(Number)
  for (let i = 0; i < 8; i++) { const d = new Date(now); d.setDate(d.getDate() + i); d.setHours(h, m, 0, 0); if (r.days.includes(d.getDay()) && d > now) return d }
  return null
}
