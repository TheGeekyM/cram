import React, { useState } from 'react'
import { api } from '../api.js'

// The first screen: who is studying, and what they are working towards. One profile is active at a
// time and owns its own studies, notes, review queue, plan, blog and coach state — so a pharmacist
// and a backend engineer can share one install without their material mixing.
// Switching reloads the window: the active profile is server-side, and a reload is one honest line
// instead of re-fetching every open pane. ponytail: revisit if switching ever needs to keep state.
const Ico = ({ d, s = 15 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
const I = {
  plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
  trash: <><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></>,
  back: <path d="m15 18-6-6 6-6"/>,
  check: <path d="M20 6 9 17l-5-5"/>,
}
const hueOf = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h }
const ago = t => { if (!t) return 'never'; const d = Math.floor((Date.now() - t) / 864e5); return d < 1 ? 'today' : d === 1 ? 'yesterday' : `${d}d ago` }

const STAGES = [['student', 'Studying'], ['job-hunting', 'Job hunting'], ['working', 'Working'], ['exam', 'Exam ahead']]
const LANGS = [['English', 'English'], ['Arabic', 'العربية']]
// only what changes how the app speaks to you — Arabic marks it in every sentence
const GENDERS = [['male', 'Male'], ['female', 'Female'], ['', 'Rather not say']]

// The questions worth asking. Everything here feeds what Cram suggests and how it talks to you:
// the target role decides which tools appear and what an interview even looks like.
function NewProfile({ onCancel, onCreated }) {
  const [p, setP] = useState({ name: '', target: '', career: '', stage: 'working', language: 'English', gender: '', country: '', hoursPerWeek: 5, examName: '', examDate: '', notes: '' })
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const set = k => e => setP(x => ({ ...x, [k]: e.target.value }))
  const F = ({ label, k, ph, rows, hint }) => (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-dim">{label}</span>
      {rows ? <textarea className="input mt-1 resize-y" rows={rows} placeholder={ph} value={p[k]} onChange={set(k)} dir="auto" />
        : <input className="input mt-1" placeholder={ph} value={p[k]} onChange={set(k)} dir="auto" />}
      {hint && <span className="block text-[11px] text-dim mt-1">{hint}</span>}
    </label>
  )
  const create = async () => {
    if (!p.name.trim()) return setErr('What should I call you?')
    if (!p.target.trim()) return setErr('Tell me what you are working towards — it decides what Cram gives you.')
    setBusy(true); setErr('')
    const r = await api.post('/api/profiles', p)
    setBusy(false)
    if (r.error) return setErr(r.error)
    onCreated(r)
  }
  return (
    <div className="w-full max-w-xl">
      <button onClick={onCancel} className="btn-ghost text-xs inline-flex items-center gap-1 mb-3"><Ico s={13} d={I.back} />Back</button>
      <div className="island p-6 flex flex-col gap-3.5">
        <div>
          <h2 className="text-lg font-semibold text-white">Tell me about you</h2>
          <p className="text-xs text-dim mt-1">Cram shapes itself around this: which tools you get, what your interviews look like, and what it suggests you study. You can change any of it later.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {F({ label: 'Your name *', k: 'name', ph: 'e.g. Mohamed' })}
          {F({ label: 'What do you do now?', k: 'career', ph: 'e.g. pharmacy student, 4th year' })}
        </div>
        {F({ label: 'What are you working towards? *', k: 'target', ph: 'e.g. Clinical nutritionist, Backend engineer, Community pharmacist', hint: 'Any job. This is what Cram tailors itself to.' })}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-dim">Where you are</span>
            <div className="flex gap-0.5 bg-app border border-border rounded-lg p-0.5 mt-1">
              {STAGES.map(([k, l]) => <button key={k} onClick={() => setP(x => ({ ...x, stage: k }))} className={`flex-1 text-[11px] px-1 py-1.5 rounded-md whitespace-nowrap ${p.stage === k ? 'bg-panel-2 text-white' : 'text-dim hover:text-white'}`}>{l}</button>)}
            </div>
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-dim">Language</span>
            <div className="flex gap-0.5 bg-app border border-border rounded-lg p-0.5 mt-1">
              {LANGS.map(([k, l]) => <button key={k} onClick={() => setP(x => ({ ...x, language: k }))} className={`flex-1 text-[11px] px-1 py-1.5 rounded-md ${p.language === k ? 'bg-panel-2 text-white' : 'text-dim hover:text-white'}`} dir="auto">{l}</button>)}
            </div>
          </label>
          {/* Arabic addresses a man and a woman differently in every sentence; unset simply says nothing */}
          <label className="block col-span-2">
            <span className="text-[11px] uppercase tracking-wider text-dim">How Cram should address you</span>
            <div className="flex gap-0.5 bg-app border border-border rounded-lg p-0.5 mt-1">
              {GENDERS.map(([k, l]) => <button key={k} onClick={() => setP(x => ({ ...x, gender: k }))} className={`flex-1 text-[11px] px-1 py-1.5 rounded-md whitespace-nowrap ${(p.gender || '') === k ? 'bg-panel-2 text-white' : 'text-dim hover:text-white'}`} dir="auto">{l}</button>)}
            </div>
          </label>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {F({ label: 'Country', k: 'country', ph: 'e.g. Egypt' })}
          <label className="block col-span-2">
            <span className="text-[11px] uppercase tracking-wider text-dim">Study time</span>
            <div className="flex gap-0.5 bg-app border border-border rounded-lg p-0.5 mt-1">
              {[3, 5, 10, 15, 20].map(h => <button key={h} onClick={() => setP(x => ({ ...x, hoursPerWeek: h }))} className={`flex-1 text-[11px] px-1 py-1.5 rounded-md whitespace-nowrap ${+p.hoursPerWeek === h ? 'bg-panel-2 text-white' : 'text-dim hover:text-white'}`}>{h}h/wk</button>)}
            </div>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {F({ label: 'Exam or deadline', k: 'examName', ph: 'optional' })}
          <label className="block"><span className="text-[11px] uppercase tracking-wider text-dim">Date</span><input type="date" className="input mt-1" value={p.examDate} onChange={set('examDate')} /></label>
        </div>
        {F({ label: 'Anything else worth knowing?', k: 'notes', ph: 'Weak spots, how you like to learn, what you are preparing for…', rows: 2 })}
        {err && <div className="text-xs text-error">{err}</div>}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-dim flex-1">* required</span>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Start'}</button>
        </div>
      </div>
    </div>
  )
}

export default function Profiles({ active, list = [], onClose }) {
  const [adding, setAdding] = useState(!list.length)
  const [busy, setBusy] = useState('')
  const switchTo = async id => { if (id === active) return onClose?.(); setBusy(id); await api.post(`/api/profiles/${id}/activate`, {}); location.reload() }
  const del = async p => {
    if (!confirm(`Delete ${p.name}'s profile? Their studies, notes, flashcards and articles go with it.`)) return
    setBusy(p.id); const r = await api.del(`/api/profiles/${p.id}`); setBusy('')
    if (r.error) return alert(r.error)
    location.reload()
  }
  return (
    <div className="h-screen bg-app overflow-y-auto flex flex-col items-center justify-center p-6 gap-5">
      {adding ? <NewProfile onCancel={() => (list.length ? setAdding(false) : onClose?.())} onCreated={() => location.reload()} /> : <>
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl grid place-items-center text-lg font-bold text-app mx-auto mb-3" style={{ background: 'rgb(var(--c-accent))' }}>C</div>
          <h1 className="text-xl font-semibold text-white">Who is studying?</h1>
          <p className="text-xs text-dim mt-1">Each profile keeps its own studies, notes, flashcards and articles.</p>
        </div>
        <div className="grid gap-2.5 w-full max-w-3xl" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
          {list.map(p => {
            const h = hueOf(p.name || p.id)
            return (
              <div key={p.id} className={`island p-4 group relative cursor-pointer transition-all hover:-translate-y-0.5 ${p.id === active ? 'border-accent/60' : 'hover:border-accent/40'}`} onClick={() => switchTo(p.id)}>
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-full grid place-items-center text-sm font-bold flex-shrink-0"
                    style={{ background: `hsl(${h} 55% 45% / 0.18)`, color: `hsl(${h} 60% 62%)` }}>{(p.name || '?')[0]?.toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-white truncate" dir="auto">{p.name}</div>
                    <div className="text-[11px] text-dim truncate" dir="auto">{p.roleTitle || p.target || p.career || 'No role yet'}</div>
                  </div>
                  {p.id === active && <span className="text-accent flex-shrink-0" title="Open now"><Ico s={14} d={I.check} /></span>}
                </div>
                <div className="text-[11px] text-dim mt-3 flex items-center gap-2">
                  <span>{p.studies} {p.studies === 1 ? 'study' : 'studies'}</span><span>·</span><span>{ago(p.lastAt)}</span>
                  {p.roleStatus === 'pending' && <span className="text-warning">· tailoring…</span>}
                  {p.id !== active && <button onClick={e => { e.stopPropagation(); del(p) }} title="Delete profile"
                    className="ms-auto opacity-0 group-hover:opacity-100 text-dim hover:text-error"><Ico s={13} d={I.trash} /></button>}
                </div>
                {busy === p.id && <div className="absolute inset-0 rounded-xl bg-app/60 grid place-items-center text-[11px] text-dim">Switching…</div>}
              </div>)
          })}
          <button onClick={() => setAdding(true)} className="island border-dashed border-accent/40 text-accent hover:bg-accent/10 flex flex-col items-center justify-center gap-2 p-6 min-h-[116px] transition-colors">
            <span className="w-10 h-10 rounded-2xl bg-accent/15 grid place-items-center"><Ico s={20} d={I.plus} /></span>
            <span className="text-sm font-semibold">New profile</span>
          </button>
        </div>
        {onClose && <button onClick={onClose} className="btn-ghost text-xs">Stay in {list.find(p => p.id === active)?.name || 'this profile'}</button>}
      </>}
    </div>
  )
}
