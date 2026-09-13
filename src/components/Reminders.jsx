import React, { useState, useEffect, useRef } from 'react'
import { api } from '../api.js'
import { due, nextAt, dayKey, GRACE } from '../reminders.mjs'

const Ico = ({ d, s = 14 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
const BELL = <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></>
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// Reminders live on the server (DATA/reminders.json), so remind.js can fire them while Cram is closed.
// One shared copy in this module; components re-render on the 'cram:reminders' event.
let state = { list: [], fired: {}, whenClosed: true, cron: false }
const emit = () => window.dispatchEvent(new Event('cram:reminders'))
export async function loadReminders() {
  const r = await api.get('/api/reminders').catch(() => ({ error: 'unreachable' }))
  if (r.error) return state
  state = r
  try { // one-time move from localStorage, where reminders lived before
    const old = JSON.parse(localStorage.getItem('cram:reminders') || 'null')
    if (Array.isArray(old) && old.length && !state.list.length) await saveReminders({ list: old.map(({ snoozeUntil, ...x }) => x) })
    localStorage.removeItem('cram:reminders'); localStorage.removeItem('cram:reminders-fired')
  } catch {}
  emit(); return state
}
export async function saveReminders(patch) {
  state = { ...state, ...patch }; emit() // optimistic, then the server's cleaned copy
  const r = await api.post('/api/reminders', patch)
  if (!r.error) { state = r; emit() }
  return r
}
const useReminders = () => { const [s, setS] = useState(state); useEffect(() => { const f = () => setS(state); window.addEventListener('cram:reminders', f); loadReminders().then(f); return () => window.removeEventListener('cram:reminders', f) }, []); return s }

// three soft rising notes; Web Audio, no asset file
function chime() {
  try {
    const ctx = new AudioContext()
    ;[660, 880, 1100].forEach((f, i) => { const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * 0.18
      o.frequency.value = f; o.type = 'sine'; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.55) })
    setTimeout(() => ctx.close(), 1500)
  } catch {}
}
function notify(r) {
  try {
    const show = () => { const n = new Notification(r.label || 'Time to study', { body: `Cram reminder · ${r.time}`, requireInteraction: true, tag: `cram-${r.id}` }); n.onclick = () => { window.focus(); n.close() } }
    if (Notification.permission === 'granted') show(); else if (Notification.permission !== 'denied') Notification.requestPermission().then(p => p === 'granted' && show())
  } catch {}
}
export function fire(r) { chime(); notify(r); window.dispatchEvent(new CustomEvent('cram:alert', { detail: r })) }

// Mounted once in App: checks every 20s, and again when the window wakes up.
export function ReminderHost() {
  const [alert, setAlert] = useState(null); const title = useRef(document.title)
  useEffect(() => {
    const tick = async () => {
      const cur = await loadReminders() // fresh: the closed-app job may have fired some already
      const now = new Date(), hits = cur.list.filter(r => due(r, now, cur.fired))
      if (!hits.length) return
      const day = dayKey(now), ids = new Set(hits.map(r => r.id))
      state = { ...state, fired: { ...state.fired, ...Object.fromEntries([...ids].map(id => [id, day])) }, list: state.list.map(r => ids.has(r.id) ? { ...r, snoozeUntil: null } : r) }; emit()
      api.post('/api/reminders/fired', { ids: [...ids], day })
      hits.forEach(fire)
    }
    const onAlert = e => setAlert(e.detail)
    window.addEventListener('cram:alert', onAlert) // listen before the first tick, or a reminder already due at launch fires into nothing
    const wake = () => { if (!document.hidden) tick() } // only on becoming visible: a check while the page unloads would mark a reminder fired and never show it
    tick(); const t = setInterval(tick, 20000)
    document.addEventListener('visibilitychange', wake); window.addEventListener('focus', wake)
    return () => { clearInterval(t); window.removeEventListener('cram:alert', onAlert); document.removeEventListener('visibilitychange', wake); window.removeEventListener('focus', wake) }
  }, [])
  // blink the window title until the alert is handled, so it is noticed from the taskbar
  useEffect(() => {
    if (!alert) return; const base = title.current; let on = false
    const t = setInterval(() => { on = !on; document.title = on ? `⏰ ${alert.label || 'Time to study'}` : base }, 1000)
    return () => { clearInterval(t); document.title = base }
  }, [alert])
  useEffect(() => { if (!alert) return; const k = e => e.key === 'Escape' && setAlert(null); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [alert])
  if (!alert) return null
  const snooze = min => { saveReminders({ list: state.list.map(r => r.id === alert.id ? { ...r, snoozeUntil: Date.now() + min * 6e4 } : r) }); setAlert(null) }
  const isTest = alert.id === 'test'
  return (
    <div className="fixed inset-0 z-[95] bg-black/70 backdrop-blur-[2px] flex items-center justify-center p-6 animate-fade-up" role="alertdialog" aria-modal="true" aria-labelledby="rem-title">
      <style>{`@keyframes rem-ring { 0%,100% { transform: rotate(0) } 10%,30% { transform: rotate(-14deg) } 20%,40% { transform: rotate(14deg) } 50% { transform: rotate(0) } }
        @keyframes rem-halo { 0% { transform: scale(1); opacity: .6 } 100% { transform: scale(2.4); opacity: 0 } }`}</style>
      <div className="island w-full max-w-sm p-6 relative overflow-hidden text-center">
        <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-64 h-40 rounded-full blur-3xl bg-accent/25" />
        <div className="relative mx-auto w-16 h-16 mb-4">
          {[0, 1].map(i => <span key={i} className="absolute inset-0 rounded-2xl border border-accent/50" style={{ animation: `rem-halo 2s ease-out ${i}s infinite` }} />)}
          <div className="relative w-16 h-16 rounded-2xl bg-accent/15 text-accent grid place-items-center" style={{ animation: 'rem-ring 1.6s ease-in-out infinite' }}><Ico s={30} d={BELL} /></div>
        </div>
        <div className="relative text-[10px] uppercase tracking-[0.18em] text-dim">Reminder · {alert.time}</div>
        <div id="rem-title" className="relative text-lg font-semibold text-white mt-1" dir="auto">{alert.label || 'Time to study'}</div>
        <div className="relative text-xs text-dim mt-1">{isTest ? 'This is how your reminders will look.' : 'Ten focused minutes beat none.'}</div>
        <div className="relative flex flex-col gap-2 mt-5">
          <button autoFocus className="btn btn-primary w-full py-2.5" onClick={() => setAlert(null)}>Got it</button>
          {!isTest && <div className="grid grid-cols-3 gap-2">{[5, 10, 30].map(m => <button key={m} className="btn btn-ghost text-xs" onClick={() => snooze(m)}>Snooze {m}m</button>)}</div>}
        </div>
      </div>
    </div>
  )
}

// Settings panel: add, toggle, edit days, delete, test.
export function RemindersPanel() {
  const s = useReminders(), list = s.list
  const [time, setTime] = useState('19:00'); const [days, setDays] = useState([0, 1, 2, 3, 4, 5, 6]); const [label, setLabel] = useState('')
  const [perm, setPerm] = useState(() => { try { return Notification.permission } catch { return 'unsupported' } })
  const upd = (id, patch) => saveReminders({ list: list.map(r => r.id === id ? { ...r, ...patch } : r) })
  const add = () => { if (!time || !days.length) return; saveReminders({ list: [...list, { id: Date.now().toString(36), time, days: [...days].sort(), label: label.trim() || 'Time to study', on: true }] }); setLabel('') }
  const askPerm = () => { try { Notification.requestPermission().then(setPerm) } catch {} }
  const DayPills = ({ value, onChange }) => (
    <div className="flex gap-0.5">{DAYS.map((d, i) => { const on = value.includes(i); return <button key={i} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter(x => x !== i) : [...value, i])} className={`w-7 h-6 rounded text-[10px] font-medium transition-colors ${on ? 'bg-accent/20 text-accent' : 'text-dim hover:text-white bg-app'}`}>{d.slice(0, 2)}</button> })}</div>
  )
  const when = r => { const n = nextAt(r, new Date(), s.fired); if (!n) return r.on ? 'no days picked' : 'off'; const today = dayKey(n) === dayKey(new Date()); return `${r.snoozeUntil ? 'snoozed until' : 'next'} ${today ? 'today' : DAYS[n.getDay()]} ${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}` }
  return (
    <div className="panel p-3 mb-3 flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <span className="text-accent"><Ico d={BELL} /></span><span className="text-xs font-semibold text-white flex-1">Reminders <span className="font-normal text-dim">· your own times</span></span>
        <button className="btn-ghost text-[11px]" onClick={() => fire({ id: 'test', time: new Date().toTimeString().slice(0, 5), label: label.trim() || 'Time to study' })}>Test alert</button>
      </div>
      {list.length > 0 && <div className="flex flex-col gap-1.5">{list.map(r => (
        <div key={r.id} className={`rounded-lg bg-app border border-border px-2.5 py-2 flex flex-col gap-1.5 ${r.on ? '' : 'opacity-60'}`}>
          <div className="flex items-center gap-2">
            <input type="time" className="bg-transparent text-sm font-mono text-white outline-none w-[112px] flex-shrink-0" value={r.time} onChange={e => e.target.value && upd(r.id, { time: e.target.value, snoozeUntil: null })} aria-label="Reminder time" />
            <input key={`${r.id}:${r.label}`} className="bg-transparent text-xs text-gray-200 outline-none flex-1 min-w-0" dir="auto" defaultValue={r.label} onBlur={e => e.target.value.trim() && e.target.value !== r.label && upd(r.id, { label: e.target.value.trim() })} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} aria-label="Reminder label" />
            <button role="switch" aria-checked={r.on} aria-label={r.on ? 'Turn reminder off' : 'Turn reminder on'} onClick={() => upd(r.id, { on: !r.on, snoozeUntil: null })} className={`w-8 h-[18px] rounded-full relative transition-colors flex-shrink-0 ${r.on ? 'bg-accent' : 'bg-panel-2'}`}><span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all ${r.on ? 'left-[16px]' : 'left-[2px]'}`} /></button>
            <button onClick={() => saveReminders({ list: list.filter(x => x.id !== r.id) })} className="w-6 h-6 rounded text-dim hover:text-error hover:bg-white/5 grid place-items-center flex-shrink-0" title="Delete reminder" aria-label="Delete reminder"><Ico s={12} d={<><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/></>} /></button>
          </div>
          <div className="flex items-center gap-2"><DayPills value={r.days} onChange={v => upd(r.id, { days: v.sort() })} /><span className="ml-auto text-[10px] text-dim">{when(r)}</span></div>
        </div>))}
      </div>}
      <div className="rounded-lg border border-dashed border-border px-2.5 py-2 flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <input type="time" className="input w-auto py-1 text-xs font-mono" value={time} onChange={e => setTime(e.target.value)} aria-label="New reminder time" />
          <input className="input flex-1 min-w-0 py-1 text-xs" dir="auto" placeholder="Label, e.g. Review flashcards" value={label} onChange={e => setLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
          <button className="btn btn-primary py-1 px-3 text-xs" disabled={!time || !days.length} onClick={add}>Add</button>
        </div>
        <DayPills value={days} onChange={setDays} />
      </div>
      {s.cron && <label className="flex items-center gap-2 text-xs text-gray-200 cursor-pointer select-none">
        <button type="button" role="switch" aria-checked={s.whenClosed !== false} onClick={() => saveReminders({ whenClosed: s.whenClosed === false })} className={`w-8 h-[18px] rounded-full relative transition-colors flex-shrink-0 ${s.whenClosed !== false ? 'bg-accent' : 'bg-panel-2'}`}><span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all ${s.whenClosed !== false ? 'left-[16px]' : 'left-[2px]'}`} /></button>
        Also remind me when Cram is closed
      </label>}
      {s.cronOk === false && <div className="text-[11px] text-error -mt-1">Could not set up reminders for when Cram is closed (crontab failed). They still work while the app is open.</div>}
      <p className="text-[11px] text-dim -mt-0.5">
        {perm === 'denied' ? 'Desktop notifications are blocked in the app, so while it is open you only get the in-app alert and chime.' : perm === 'default' ? <>While Cram is open you get an in-app alert with a chime. <button className="text-accent hover:underline" onClick={askPerm}>Allow desktop notifications</button> too.</> : 'While Cram is open you get an in-app alert, a chime and a desktop notification.'}
        {' '}{s.cron && s.whenClosed !== false ? 'When it is closed, a desktop notification fires instead.' : 'Nothing fires while Cram is closed.'} A reminder missed by up to {GRACE} minutes still fires.
      </p>
    </div>
  )
}
