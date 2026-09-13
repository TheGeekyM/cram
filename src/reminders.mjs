// Timing rules for study reminders (a time, days of the week and a label). Pure functions shared by the app
// (src/components/Reminders.jsx) and the closed-app job (remind.js --custom). Storage lives on the server.
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
// next time a reminder will fire, for the settings list. Inside the grace window and not yet fired, that is today's time.
export function nextAt(r, now = new Date(), fired = {}) {
  if (!r.on || !r.days?.length) return null
  if (r.snoozeUntil) return new Date(r.snoozeUntil)
  const [h, m] = String(r.time || '').split(':').map(Number); if (Number.isNaN(h) || Number.isNaN(m)) return null
  for (let i = 0; i < 8; i++) {
    const d = new Date(now); d.setDate(d.getDate() + i); d.setHours(h, m, 0, 0)
    if (!r.days.includes(d.getDay())) continue
    if (d > now) return d
    if (i === 0 && (now - d) / 6e4 < GRACE && fired[r.id] !== dayKey(now)) return d
  }
  return null
}
