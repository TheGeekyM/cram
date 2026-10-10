import React, { useState } from 'react'
import { api } from '../api.js'

// New-study dialog (subject or PDF) and the profile/onboarding dialog. Owned by App so any page can open them.
export function NewDialog({ mode, prefill, onClose, onCreated }) {
  const [title, setTitle] = useState(prefill?.title || ''); const [subject, setSubject] = useState(prefill?.subject || ''); const [pdf, setPdf] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [level, setLevel] = useState('mid') // pitches the chapter plan, the chat, interviews and challenges
  const pick = async () => {
    setErr(''); const r = await api.get(`/api/pick-pdf?t=${Date.now()}`) // ponytail: cache-buster so a GET never replays an old empty pick
    if (r.error) return setErr(r.error); if (!r.file) return r.canceled || setErr('No file came back from the file picker.')
    setPdf(r.file); setTitle(r.file.split(/[\\/]/).pop().replace(/\.pdf$/i, '')) // title follows the picked file, still editable
  }
  const create = async () => {
    if (!title.trim()) return setErr('Give it a title.'); if (mode === 'pdf' && !pdf) return setErr('Choose a PDF.')
    setBusy(true); const s = await api.post('/api/studies', { title, subject, level, pdfPath: mode === 'pdf' ? pdf : '' }); setBusy(false)
    if (s.error) return setErr(s.error); onCreated(s.id)
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={onClose}>
      <div className={`island w-full ${mode === 'pdf' ? 'max-w-md' : 'max-w-xl'} p-5`} onClick={e => e.stopPropagation()}>
        <div className="text-sm font-semibold text-white mb-3">{mode === 'pdf' ? 'New study from a PDF' : 'New study from a subject'}</div>
        <label className="text-[11px] uppercase tracking-wider text-dim">Title</label>
        <input autoFocus className="input mt-1 mb-3" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Operating Systems, Chapter 4" onKeyDown={e => e.key === 'Enter' && create()} />
        {mode === 'pdf' ? <>
          <label className="text-[11px] uppercase tracking-wider text-dim">PDF file</label>
          <div className="flex gap-2 mt-1 mb-3"><input readOnly className="input flex-1 font-mono text-xs" value={pdf.split(/[\\/]/).pop()} title={pdf} placeholder="No file chosen" /><button className="btn btn-ghost" onClick={pick}>Browse…</button></div>
        </> : <>
          <label className="text-[11px] uppercase tracking-wider text-dim">What to study</label>
          {/* multi-line: a pasted outline keeps its lines, and the chapters follow it in order (features.js /outline) */}
          <textarea rows={6} dir="auto" className="input mt-1 resize-y min-h-[88px] max-h-[45vh] text-[13px] leading-relaxed" value={subject} onChange={e => setSubject(e.target.value)}
            placeholder={'A line, e.g. process scheduling algorithms\n\nor paste your own outline: phases, weeks, topics…\nthe chapters will follow it, in your order.'}
            onKeyDown={e => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && create()} />
          <p className="text-[11px] text-dim mt-1 mb-3">Paste a syllabus or a list of topics and each part becomes a chapter, in the same order. Ctrl+Enter creates.</p>
        </>}
        <label className="text-[11px] uppercase tracking-wider text-dim">Your level here</label>
        <div className="flex gap-0.5 bg-app border border-border rounded-lg p-0.5 mt-1 mb-1">
          {[['beginner', 'Beginner', 'New to this'], ['mid', 'Intermediate', 'Past the basics'], ['expert', 'Expert', 'Depth and edge cases']].map(([k, l, sub]) => (
            <button key={k} onClick={() => setLevel(k)} title={sub} className={`flex-1 text-[11px] px-1 py-1.5 rounded-md ${level === k ? 'bg-panel-2 text-white' : 'text-dim hover:text-white'}`}>{l}</button>))}
        </div>
        <p className="text-[11px] text-dim mb-3">Sets where the chapter plan starts and how deep questions go.</p>
        {err && <div className="text-xs text-error mb-2">{err}</div>}
        <div className="flex justify-end gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create'}</button></div>
      </div>
    </div>
  )
}

// First-run onboarding + later edits: who you are and where you want to go, so the coach can be specific.
export function ProfileDialog({ profile, onSave, onClose }) {
  const [p, setP] = useState({ name: '', career: '', goal: '', hoursPerWeek: 5, notes: '', examName: '', examDate: '', ...profile }); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const set = k => e => setP(x => ({ ...x, [k]: e.target.value }))
  const save = async () => {
    if (!p.name.trim()) return setErr('Your name is the only required field.')
    setBusy(true); setErr('')
    try { const r = await api.post('/api/profile', p); if (r.error) throw new Error(r.error); onSave(r) }
    catch (e) { setErr(`Could not save: ${e.message}. Is the app's server running the latest version?`) }
    setBusy(false)
  }
  // plain function call, not a component: a component type created inside render remounts (and loses focus) on every keystroke
  const F = ({ label, k, ph, rows }) => <label className="block mb-3"><span className="text-[11px] uppercase tracking-wider text-dim">{label}</span>{rows ? <textarea className="input mt-1 resize-y" rows={rows} placeholder={ph} value={p[k]} onChange={set(k)} /> : <input className="input mt-1" placeholder={ph} value={p[k]} onChange={set(k)} />}</label>
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={onClose}>
      <div className="island w-full max-w-lg p-6 relative overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="absolute -top-20 -right-20 w-56 h-56 rounded-full bg-accent/20 blur-3xl" />
        <div className="relative">
          <div className="text-lg font-semibold text-white">{profile?.name ? 'Your profile' : 'Tell me about you'}</div>
          <p className="text-xs text-dim mt-1 mb-4">The coach uses this to pick what you study next, what to add, and how to get better. You can change it any time.</p>
          <div className="grid grid-cols-2 gap-x-3">
            {F({ label: 'Your name *', k: 'name', ph: 'e.g. Mohamed' })}
            <label className="block mb-3"><span className="text-[11px] uppercase tracking-wider text-dim">Study time target</span>
              <div className="flex gap-0.5 bg-app border border-border rounded-lg p-0.5 mt-1">{[3, 5, 10, 15, 20].map(h => <button key={h} onClick={() => setP(x => ({ ...x, hoursPerWeek: h }))} className={`flex-1 text-[11px] px-1 py-1.5 rounded-md whitespace-nowrap ${+p.hoursPerWeek === h ? 'bg-panel-2 text-white' : 'text-dim hover:text-white'}`}>{h}h/wk</button>)}</div></label>
          </div>
          {/* Arabic addresses a man and a woman differently in every sentence — أهلاً بيك / أهلاً بيكي */}
          <label className="block mb-3"><span className="text-[11px] uppercase tracking-wider text-dim">How Cram should address you</span>
            <div className="flex gap-0.5 bg-app border border-border rounded-lg p-0.5 mt-1">{[['male', 'Male'], ['female', 'Female'], ['', 'Rather not say']].map(([k, l]) => <button key={k} onClick={() => setP(x => ({ ...x, gender: k }))} className={`flex-1 text-[11px] px-1 py-1.5 rounded-md whitespace-nowrap ${(p.gender || '') === k ? 'bg-panel-2 text-white' : 'text-dim hover:text-white'}`} dir="auto">{l}</button>)}</div></label>
          <div className="grid grid-cols-2 gap-x-3">
          </div>
          {F({ label: 'What do you do now?', k: 'career', ph: 'e.g. backend developer, 3 years PHP; or CS student, 2nd year' })}
          {F({ label: 'What do you want to become / achieve?', k: 'goal', ph: 'e.g. senior engineer at a product company, pass the AWS SA exam in March' })}
          <div className="grid grid-cols-2 gap-x-3">
            {F({ label: 'Exam or deadline (optional)', k: 'examName', ph: 'e.g. AWS SA Associate' })}
            <label className="block mb-3"><span className="text-[11px] uppercase tracking-wider text-dim">Date</span><input type="date" className="input mt-1" value={p.examDate || ''} onChange={set('examDate')} /></label>
          </div>
          {F({ label: 'Anything else the coach should know?', k: 'notes', ph: 'Exam dates, weak spots, how you like to learn, time of day you study…', rows: 2 })}
          {err && <div className="text-xs text-error mb-2">{err}</div>}
          <div className="flex items-center gap-2 mt-1"><span className="text-[11px] text-dim flex-1">* required. The more you fill in, the better the coaching.</span><button className="btn btn-ghost" onClick={onClose}>{profile?.name ? 'Cancel' : 'Later'}</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : profile?.name ? 'Save' : "Let's go"}</button></div>
        </div>
      </div>
    </div>
  )
}
