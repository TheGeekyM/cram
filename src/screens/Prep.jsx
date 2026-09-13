import React, { useState, useEffect, useRef } from 'react'
import { api } from '../api.js'
import { ask } from '../components/Confirm.jsx'
import { PageBar } from '../components/SessionList.jsx'
import { dirOf } from '../voice.js'

// Getting ready for one real job: Job prep (CV vs job description, company research, a practice plan) and the
// Story bank (STAR stories that behavioral-style rounds ask about). Both open from the generic Interview page.
const Ico = ({ d, s = 14 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
const Spin = () => <span className="inline-block w-3.5 h-3.5 border-2 border-border border-t-accent rounded-full animate-spin align-middle" />
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
const ROUND_NAMES = { technical: 'Technical', behavioral: 'Behavioral', situational: 'Situational', management: 'Management', 'system-design': 'System design', architecture: 'Architecture' }
const PLAY = <path d="m6 3 14 9-14 9V3z"/>
const Pills = ({ value, onChange, options }) => (
  <div className="flex gap-0.5 bg-app border border-border rounded-lg p-0.5">{options.map(v => <button key={v} onClick={() => onChange(v)} className={`text-xs px-3 py-1.5 rounded-md capitalize transition-colors ${value === v ? 'bg-panel-2 text-white' : 'text-dim hover:text-white'}`}>{v}</button>)}</div>
)
const Section = ({ title, right, children }) => (
  <div className="island p-5 flex flex-col gap-3 flex-shrink-0"><div className="flex items-center gap-2"><span className="text-sm font-semibold text-white">{title}</span>{right && <span className="ms-auto">{right}</span>}</div>{children}</div>
)
const Bullets = ({ items }) => <ul className="flex flex-col gap-1.5">{items.map((x, i) => <li key={i} dir={dirOf(x)} className="text-sm text-gray-300 flex gap-2"><span className="text-dim">•</span><span>{x}</span></li>)}</ul>
const Label = ({ children }) => <span className="text-[11px] uppercase tracking-wider text-dim">{children}</span>

// ---------- job prep ----------
export function JobPrep({ bar, onBack, onStartRound, onCoding, busy: starting }) {
  const [list, setList] = useState(null); const [open, setOpen] = useState('new')
  useEffect(() => { api.get('/api/prep').then(r => { const L = Array.isArray(r) ? r : []; setList(L); if (L[0]) setOpen(L[0].id) }) }, [])
  const plan = list?.find(p => p.id === open)
  const del = async p => {
    if (!await ask({ title: 'Delete this prep?', body: 'The plan and the company research are removed.', ok: 'Delete' })) return
    await api.del(`/api/prep/${p.id}`); setList(L => L.filter(x => x.id !== p.id)); setOpen('new')
  }
  return (
    <div className="h-full flex flex-col min-h-0">
      <PageBar tool={bar} onBack={onBack}>
        <div className="min-w-0 flex-1 flex items-baseline gap-2"><span className="text-sm font-semibold text-white whitespace-nowrap">Job prep</span><span className="text-xs text-dim truncate">Match your CV to a job, research the company, and get a practice plan</span></div>
      </PageBar>
      <div className="flex-1 min-h-0 flex gap-2.5 p-2">
        <aside className="island w-64 flex-shrink-0 flex flex-col min-h-0">
          <div className="p-2"><button onClick={() => setOpen('new')} className={`w-full inline-flex items-center justify-center gap-1.5 ${open === 'new' ? 'btn btn-primary' : 'btn-tint'}`}><Ico d={<><path d="M12 5v14"/><path d="M5 12h14"/></>} />New prep</button></div>
          <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-1">
            {list?.map(p => (
              <button key={p.id} onClick={() => setOpen(p.id)} className={`text-start rounded-lg px-3 py-2 border transition-colors ${open === p.id ? 'bg-accent/15 border-accent/40' : 'border-transparent hover:bg-white/5'}`}>
                <div className="text-sm text-white truncate" dir="auto">{p.role || 'Untitled role'}{p.company ? ` · ${p.company}` : ''}</div>
                <div className="text-[11px] text-dim">{new Date(p.at).toLocaleDateString()} · fit {p.plan?.fit.score ?? '–'}%</div>
              </button>))}
            {list && !list.length && <div className="text-[11px] text-dim text-center px-3 py-6">Your saved preps show up here.</div>}
          </div>
        </aside>
        <div className="flex-1 min-w-0 overflow-y-auto">
          {plan ? <Plan key={plan.id} p={plan} starting={starting} onDelete={() => del(plan)} onStartRound={onStartRound} onCoding={onCoding}
            onCards={() => setList(L => L.map(x => x.id === plan.id ? { ...x, cardsAdded: Date.now() } : x))} />
            : <NewPrep onDone={p => { setList(L => [p, ...(L || [])]); setOpen(p.id) }} />}
        </div>
      </div>
    </div>
  )
}

function NewPrep({ onDone }) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem('cram:iv-setup') || '{}') } catch { return {} } })()
  const [f, setF] = useState(() => ({ role: saved.role || '', seniority: saved.seniority || 'mid', company: '', language: saved.language || 'English', jd: '', cv: localStorage.getItem('cram:cv') || '' }))
  const set = k => v => setF(x => ({ ...x, [k]: v }))
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [secs, setSecs] = useState(0); const ctrl = useRef(null)
  useEffect(() => { if (!busy) return; setSecs(0); const t = setInterval(() => setSecs(x => x + 1), 1000); return () => clearInterval(t) }, [busy])
  useEffect(() => () => ctrl.current?.abort(), [])
  const loadPdf = async () => {
    const r = await api.get('/api/pick-pdf'); if (r.error) return setErr(r.error); if (!r.file) return
    const t = await api.post('/api/prep/cv-text', { path: r.file }); if (t.error) return setErr(t.error)
    set('cv')(t.text); setErr('')
  }
  const go = async () => {
    setBusy(true); setErr(''); ctrl.current = new AbortController()
    try { localStorage.setItem('cram:cv', f.cv) } catch {} // the CV stays on this computer, so the next prep starts with it
    try {
      const r = await fetch('/api/prep', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f), signal: ctrl.current.signal }).then(x => x.json())
      if (r.error) setErr(r.error); else onDone(r)
    } catch (e) { if (e.name !== 'AbortError') setErr(e.message) }
    setBusy(false); ctrl.current = null
  }
  if (busy) return (
    <div className="island p-10 flex flex-col items-center gap-4 text-center">
      <Spin />
      <div className="text-sm font-semibold text-white">{f.company && secs < 100 ? `Researching how ${f.company} interviews…` : 'Comparing your CV to the job and building your plan…'}</div>
      <div className="text-xs text-dim">{f.company ? 'Web research takes two or three minutes' : 'Usually under a minute'} · {fmt(secs)}</div>
      <button className="btn-tint btn-red" onClick={() => ctrl.current?.abort()}>Stop</button>
    </div>
  )
  return (
    <Section title="New job prep">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5"><Label>Role</Label><input className="input" dir="auto" placeholder="e.g. Senior backend engineer" value={f.role} onChange={e => set('role')(e.target.value)} /></label>
        <label className="flex flex-col gap-1.5"><Label>Company (optional, enables web research)</Label><input className="input" dir="auto" placeholder="e.g. Amazon" value={f.company} onChange={e => set('company')(e.target.value)} /></label>
      </div>
      <div className="flex items-center gap-2 flex-wrap"><Pills value={f.seniority} onChange={set('seniority')} options={['junior', 'mid', 'senior', 'lead']} /><Pills value={f.language} onChange={set('language')} options={['English', 'Arabic']} /></div>
      <label className="flex flex-col gap-1.5"><Label>Job description</Label><textarea dir="auto" className="input min-h-[160px] resize-y" placeholder="Paste the job posting" value={f.jd} onChange={e => set('jd')(e.target.value.slice(0, 8000))} /></label>
      <label className="flex flex-col gap-1.5">
        <span className="flex items-center gap-2"><Label>Your CV</Label><button type="button" onClick={loadPdf} className="ms-auto btn-tint text-[11px]">Load from a PDF</button></span>
        <textarea dir="auto" className="input min-h-[160px] resize-y" placeholder="Paste your CV, or load it from a PDF" value={f.cv} onChange={e => set('cv')(e.target.value.slice(0, 15000))} />
      </label>
      {err && <div className="text-xs text-error">{err}</div>}
      <button disabled={!f.jd.trim() && !f.cv.trim()} onClick={go} className="btn btn-primary self-start inline-flex items-center gap-1.5"><Ico d={PLAY} />Build my prep</button>
    </Section>
  )
}

function Plan({ p, starting, onDelete, onStartRound, onCoding, onCards }) {
  const P = p.plan; const [adding, setAdding] = useState(false); const [msg, setMsg] = useState('')
  const addCards = async () => { setAdding(true); const r = await api.post(`/api/prep/${p.id}/cards`, {}); setAdding(false); if (r.error) return setMsg(r.error); setMsg(r.already ? 'These flashcards are already in Review.' : `${r.added} flashcards added to Review.`); onCards() }
  const round = r => onStartRound({ round: r.round, role: p.role || 'the role in the job description', seniority: p.seniority, language: p.language, jd: `${p.jd || ''}\n\nFocus this round on: ${r.focus}`.trim() })
  const score = P.fit.score, ring = 2 * Math.PI * 30, tone = score >= 70 ? 'text-success' : score >= 45 ? 'text-warning' : 'text-error'
  return (
    <div className="flex flex-col gap-2.5 pb-4">
      <div className="island p-5 flex items-center gap-5 flex-wrap">
        <svg width="76" height="76" viewBox="0 0 76 76" className={`flex-shrink-0 ${tone}`} role="img" aria-label={`Fit ${score}%`}>
          <circle cx="38" cy="38" r="30" fill="none" stroke="rgb(var(--c-border))" strokeWidth="7" />
          <circle cx="38" cy="38" r="30" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeDasharray={ring} strokeDashoffset={ring * (1 - score / 100)} transform="rotate(-90 38 38)" />
          <text x="38" y="43" textAnchor="middle" className="fill-white font-mono" fontSize="17" fontWeight="600">{score}%</text>
        </svg>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-dim">Fit for {p.role || 'the role'}{p.company ? ` at ${p.company}` : ''} · {p.seniority}</div>
          <p dir={dirOf(P.fit.summary)} className="text-sm text-gray-200 mt-1 leading-relaxed">{P.fit.summary}</p>
        </div>
        <button onClick={onDelete} className="btn-ghost text-xs self-start">Delete</button>
      </div>
      <div className="grid gap-2.5 md:grid-cols-2">
        <Section title="What already fits"><Bullets items={P.strengths} /></Section>
        <Section title="Gaps to close">
          {P.gaps.length ? <div className="flex flex-col gap-2.5">{P.gaps.map((g, i) => (
            <div key={i} dir={dirOf(g.skill + g.why)} className="text-sm"><div className="font-medium text-white">{g.skill}</div><div className="text-gray-400 text-xs mt-0.5">{g.why}</div>{g.how && <div className="text-gray-300 text-xs mt-1"><span className="text-accent">How: </span>{g.how}</div>}</div>))}</div>
            : <div className="text-xs text-dim">No clear gaps.</div>}
        </Section>
      </div>
      {p.research && (
        <Section title={`How ${p.company} interviews`}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5"><Label>Process</Label><Bullets items={p.research.process} /></div>
            <div className="flex flex-col gap-1.5"><Label>What they value</Label><Bullets items={p.research.values} /></div>
          </div>
          {p.research.questions.length > 0 && <div className="flex flex-col gap-1.5"><Label>Questions candidates report</Label><Bullets items={p.research.questions} /></div>}
          {p.research.sources?.length > 0 && <div className="flex flex-col gap-1"><Label>Sources (checked)</Label>{p.research.sources.map(s => <a key={s.url} href={s.url} target="_blank" rel="noreferrer noopener" className="text-xs text-accent hover:underline truncate">{s.title || s.url}</a>)}</div>}
        </Section>
      )}
      <Section title="Practice plan">
        <div className="flex flex-col gap-2">{P.rounds.map((r, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg bg-app border border-border px-3 py-2.5">
            <div className="min-w-0 flex-1"><div className="text-sm font-medium text-white">{ROUND_NAMES[r.round]} round</div><div dir={dirOf(r.focus)} className="text-xs text-dim">{r.focus}</div></div>
            <button disabled={starting} onClick={() => round(r)} className="btn btn-primary text-xs inline-flex items-center gap-1.5 flex-shrink-0">{starting ? <Spin /> : <Ico s={12} d={PLAY} />}Start</button>
          </div>))}</div>
        {P.codingTopics.length > 0 && <div className="flex items-center gap-2 flex-wrap"><Label>Coding</Label>{P.codingTopics.map(t => <button key={t} onClick={() => onCoding(t)} className="text-xs px-3 py-1.5 rounded-full border border-border bg-app text-gray-200 hover:border-accent/60 inline-flex items-center gap-1.5"><Ico s={11} d={PLAY} />{t}</button>)}</div>}
        {P.flashcards.length > 0 && <div className="flex items-center gap-2 flex-wrap"><Label>Flashcards</Label><span className="text-xs text-dim">{P.flashcards.length} cards on the gaps</span>
          <button disabled={adding || !!p.cardsAdded} onClick={addCards} className="btn-tint text-xs">{adding ? <Spin /> : p.cardsAdded ? 'Added to Review' : 'Add to Review'}</button>{msg && <span className="text-xs text-dim">{msg}</span>}</div>}
      </Section>
      {P.likelyQuestions.length > 0 && <Section title="Questions to expect"><Bullets items={P.likelyQuestions} /></Section>}
    </div>
  )
}

// ---------- STAR story bank ----------
export function StoryBank({ bar, onBack }) {
  const [list, setList] = useState(null); const [edit, setEdit] = useState(null)
  useEffect(() => { api.get('/api/stories').then(r => setList(Array.isArray(r) ? r : [])) }, [])
  const save = async st => { const r = await api.post('/api/stories', st); if (r.error) return r.error; setList(L => [r, ...(L || []).filter(x => x.id !== r.id)]); setEdit(null) }
  const del = async st => { if (!await ask({ title: `Delete «${st.title}»?`, body: 'The story is removed from your bank.', ok: 'Delete' })) return; await api.del(`/api/stories/${st.id}`); setList(L => L.filter(x => x.id !== st.id)) }
  return (
    <div className="h-full flex flex-col min-h-0">
      <PageBar tool={bar} onBack={onBack}>
        <div className="min-w-0 flex-1 flex items-baseline gap-2"><span className="text-sm font-semibold text-white whitespace-nowrap">Story bank</span><span className="text-xs text-dim truncate">Behavioral, situational and management rounds ask you about these</span></div>
      </PageBar>
      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        <div className="max-w-3xl mx-auto flex flex-col gap-2.5">
          {edit ? <StoryForm st={edit} onSave={save} onCancel={() => setEdit(null)} />
            : <button onClick={() => setEdit({})} className="island border-dashed border-accent/40 text-accent hover:bg-accent/10 p-4 text-sm font-semibold inline-flex items-center justify-center gap-2"><Ico d={<><path d="M12 5v14"/><path d="M5 12h14"/></>} />New story</button>}
          {list && !list.length && !edit && <div className="text-sm text-dim text-center py-6">No stories yet. Write down 4 to 6 real moments (a conflict, a failure, a win you led, a hard deadline) and the interviewer will dig into them.</div>}
          {list?.map(st => (
            <div key={st.id} className="island p-4 flex flex-col gap-2" dir="auto">
              <div className="flex items-center gap-2"><span className="text-sm font-semibold text-white flex-1 truncate">{st.title}</span>
                <button onClick={() => setEdit(st)} className="btn-ghost text-xs">Edit</button><button onClick={() => del(st)} className="btn-ghost text-xs text-error">Delete</button></div>
              {st.skills.length > 0 && <div className="flex gap-1.5 flex-wrap">{st.skills.map(k => <span key={k} className="text-[11px] px-2 py-0.5 rounded-full bg-app border border-border text-dim">{k}</span>)}</div>}
              <div className="grid gap-2 sm:grid-cols-2 text-xs text-gray-400">{[['Situation', st.situation], ['Task', st.task], ['Action', st.action], ['Result', st.result]].map(([k, v]) => v && <div key={k}><span className="text-accent">{k}: </span><span className="line-clamp-3">{v}</span></div>)}</div>
            </div>))}
        </div>
      </div>
    </div>
  )
}
function StoryForm({ st, onSave, onCancel }) {
  const [f, setF] = useState({ ...st, skills: (st.skills || []).join(', ') }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const field = (k, label, hint, rows = 3) => (
    <label className="flex flex-col gap-1.5"><Label>{label}</Label><textarea dir="auto" rows={rows} className="input resize-y" placeholder={hint} value={f[k] || ''} onChange={e => setF(x => ({ ...x, [k]: e.target.value }))} /></label>
  )
  const save = async () => { setBusy(true); const e = await onSave(f); setBusy(false); if (e) setErr(e) }
  return (
    <Section title={st.id ? 'Edit story' : 'New story'}>
      <label className="flex flex-col gap-1.5"><Label>Title</Label><input dir="auto" className="input" placeholder="e.g. Cut API latency by 60% before a launch" value={f.title || ''} onChange={e => setF(x => ({ ...x, title: e.target.value }))} autoFocus /></label>
      {field('situation', 'Situation', 'Where were you, what was going on?')}
      {field('task', 'Task', 'What were you responsible for?', 2)}
      {field('action', 'Action', 'What did YOU do, step by step?', 4)}
      {field('result', 'Result', 'What changed? Numbers if you have them. What did you learn?')}
      <label className="flex flex-col gap-1.5"><Label>Skills it shows (comma separated)</Label><input dir="auto" className="input" placeholder="ownership, conflict, leadership" value={f.skills} onChange={e => setF(x => ({ ...x, skills: e.target.value }))} /></label>
      {err && <div className="text-xs text-error">{err}</div>}
      <div className="flex gap-2"><button disabled={busy} onClick={save} className="btn btn-primary">{busy ? <Spin /> : 'Save story'}</button><button onClick={onCancel} className="btn-ghost">Cancel</button></div>
    </Section>
  )
}
