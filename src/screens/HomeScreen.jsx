import React, { useState, useMemo, useRef, useEffect } from 'react'
import NavBar from '../components/NavBar.jsx'
import { api } from '../api.js'
import { ask } from '../components/Confirm.jsx'

// Same shape as aidle's SetupScreen: hero header, two action tiles, a list of rows with a
// hover kebab. Rows here are studies instead of workspaces.
function ActionTile({ icon, title, sub, onClick }) {
  return (
    <button onClick={onClick} className="island p-4 text-left flex items-start gap-3 hover:border-accent/40 transition-colors group">
      <div className="w-9 h-9 rounded-lg bg-accent/15 text-accent grid place-items-center flex-shrink-0 group-hover:bg-accent group-hover:text-app transition-colors">{icon}</div>
      <div className="min-w-0"><div className="text-sm font-semibold text-white">{title}</div><div className="text-xs text-dim mt-0.5">{sub}</div></div>
    </button>
  )
}
const Ico = ({ d }) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
const PDF = <Ico d={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></>} />
const BOOK = <Ico d={<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>} />

function Row({ s, onOpen, onDelete }) {
  const [menu, setMenu] = useState(false)
  return (
    <div onClick={() => onOpen(s.id)} className="group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/5 cursor-pointer relative">
      <span className="text-dim">{s.hasPdf ? PDF : BOOK}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-white truncate">{s.title}</div>
        <div className="text-[11px] text-dim truncate">{s.subject || (s.hasPdf ? 'PDF' : '')}{s.subject && s.hasPdf ? ' · PDF' : ''}</div>
      </div>
      <span className="text-[11px] text-dim">{s.quizzes ? `${s.quizzes} quiz${s.quizzes === 1 ? '' : 'zes'} · ` : ''}{new Date(s.updatedAt).toLocaleDateString()}</span>
      <button onClick={e => { e.stopPropagation(); setMenu(m => !m) }} className="w-7 h-7 rounded text-dim opacity-0 group-hover:opacity-100 hover:bg-white/10 grid place-items-center">⋯</button>
      {menu && (
        <div onMouseLeave={() => setMenu(false)} className="absolute right-2 top-10 z-20 panel py-1 text-xs min-w-[150px]">
          <button onClick={e => { e.stopPropagation(); onOpen(s.id) }} className="block w-full text-left px-3 py-1.5 hover:bg-white/5">Open</button>
          <button onClick={e => { e.stopPropagation(); setMenu(false); onDelete(s) }} className="block w-full text-left px-3 py-1.5 hover:bg-white/5 text-error">Delete study</button>
        </div>
      )}
    </div>
  )
}

function NewDialog({ mode, onClose, onCreated }) {
  const [title, setTitle] = useState(''); const [subject, setSubject] = useState(''); const [pdf, setPdf] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const pick = async () => { const { file } = await api.get('/api/pick-pdf'); if (file) { setPdf(file); if (!title) setTitle(file.split('/').pop().replace(/\.pdf$/i, '')) } }
  const create = async () => {
    if (!title.trim()) return setErr('Give it a title.'); if (mode === 'pdf' && !pdf) return setErr('Choose a PDF.')
    setBusy(true); const s = await api.post('/api/studies', { title, subject, pdfPath: mode === 'pdf' ? pdf : '' }); setBusy(false)
    if (s.error) return setErr(s.error); onCreated(s.id)
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={onClose}>
      <div className="island w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <div className="text-sm font-semibold text-white mb-3">{mode === 'pdf' ? 'New study from a PDF' : 'New study from a subject'}</div>
        <label className="text-[11px] uppercase tracking-wider text-dim">Title</label>
        <input autoFocus className="input mt-1 mb-3" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Operating Systems, Chapter 4" onKeyDown={e => e.key === 'Enter' && create()} />
        {mode === 'pdf' ? <>
          <label className="text-[11px] uppercase tracking-wider text-dim">PDF file</label>
          <div className="flex gap-2 mt-1 mb-3"><input readOnly className="input flex-1 font-mono text-xs" value={pdf} placeholder="No file chosen" /><button className="btn btn-ghost" onClick={pick}>Browse…</button></div>
        </> : <>
          <label className="text-[11px] uppercase tracking-wider text-dim">Subject / scope</label>
          <input className="input mt-1 mb-3" value={subject} onChange={e => setSubject(e.target.value)} placeholder="What to study, e.g. process scheduling algorithms" onKeyDown={e => e.key === 'Enter' && create()} />
        </>}
        {err && <div className="text-xs text-error mb-2">{err}</div>}
        <div className="flex justify-end gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create'}</button></div>
      </div>
    </div>
  )
}

export default function HomeScreen({ studies, onOpen, onCreated, onDeleted }) {
  const [q, setQ] = useState(''); const [searching, setSearching] = useState(false); const [mode, setMode] = useState(null)
  const ref = useRef(); useEffect(() => { if (searching) ref.current?.focus() }, [searching])
  const list = useMemo(() => { const k = q.trim().toLowerCase(); return k ? studies.filter(s => (s.title + ' ' + (s.subject || '')).toLowerCase().includes(k)) : studies }, [studies, q])
  const askDelete = async s => { if (!await ask({ title: `Delete «${s.title}»?`, body: 'Chat, quizzes, challenges, notes and the PDF copy are removed. This can\'t be undone.', ok: 'Delete study' })) return; await api.del(`/api/studies/${s.id}`); onDeleted() }
  return (
    <div className="h-full flex flex-col">
      <NavBar />
      <div className="flex-1 overflow-y-auto hero-glow">
        <div className="mx-auto max-w-2xl px-6 pt-[10vh] pb-12">
          <div className="flex items-center gap-2 mb-5">
            <h1 className="text-2xl font-semibold text-white flex-1">Studies</h1>
            {searching
              ? <input ref={ref} className="input w-56" placeholder="Filter by title or subject…" value={q} onChange={e => setQ(e.target.value)} onBlur={() => !q && setSearching(false)} onKeyDown={e => { if (e.key === 'Escape') { setQ(''); setSearching(false) } }} />
              : <button onClick={() => setSearching(true)} className="w-8 h-8 rounded-md text-dim hover:text-white hover:bg-white/5 grid place-items-center" title="Search"><Ico d={<><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></>} /></button>}
          </div>
          <div className="grid grid-cols-2 gap-2.5 mb-5">
            <ActionTile icon={BOOK} title="New subject…" sub="Name a topic and start studying" onClick={() => setMode('subject')} />
            <ActionTile icon={PDF} title="From a PDF…" sub="Attach lecture notes, a book, a paper" onClick={() => setMode('pdf')} />
          </div>
          <div className="island p-1.5">
            {list.length ? list.map(s => <Row key={s.id} s={s} onOpen={onOpen} onDelete={askDelete} />)
              : <div className="text-center text-xs text-dim py-10">{q ? `Nothing matches «${q}».` : 'No studies yet — start from a subject or a PDF.'}</div>}
          </div>
        </div>
      </div>
      {mode && <NewDialog mode={mode} onClose={() => setMode(null)} onCreated={id => { setMode(null); onCreated(id) }} />}
    </div>
  )
}
