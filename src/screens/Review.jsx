import React, { useState, useEffect, useCallback, useRef } from 'react'
import Markdown from '../components/Markdown.jsx'
import { dirOf } from '../voice.js'
import { api } from '../api.js'
import Wait from '../components/Wait.jsx'
import { ask } from '../components/Confirm.jsx'
import { Centered, StudySelect, Trash, PageBar } from '../components/SessionList.jsx'

// Review: spaced repetition over everything missed in interviews (and past quizzes), plus generated flashcards.
const Ico = ({ d, s = 14 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
const LAYERS = <><path d="m12 2 10 5-10 5L2 7l10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></>
const DAY = 864e5
const GRADES = [['again', 'Again', 'btn-red'], ['hard', 'Hard', 'btn-amber'], ['good', 'Good', 'btn-green'], ['easy', 'Easy', 'btn-blue']]
const SRC = { quiz: ['Missed in quiz', 'badge-yellow'], interview: ['Missed in interview', 'badge-purple'], card: ['Flashcard', 'badge-blue'] }
// same rule as the server's schedule(); only used to label the grade buttons
const nextStep = (step, g, steps) => Math.min(steps.length - 1, g === 'again' ? 0 : g === 'hard' ? Math.max(0, step) : g === 'easy' ? step + 2 : step + 1)
const rel = t => { const d = t - Date.now(); if (d <= 0) return 'due now'; const h = Math.round(d / 36e5); return h < 24 ? `in ${Math.max(1, h)}h` : `in ${Math.round(d / DAY)} day${Math.round(d / DAY) === 1 ? '' : 's'}` }
const Pills = ({ value, onChange, options }) => (
  <div className="flex gap-0.5 bg-app border border-border rounded-lg p-0.5">{options.map(v => <button key={v} onClick={() => onChange(v)} className={`text-xs px-3 py-1.5 rounded-md transition-colors ${value === v ? 'bg-panel-2 text-white' : 'text-dim hover:text-white'}`}>{v}</button>)}</div>
)

// ---------- generate flashcards form (hero and deck panel) ----------
function Generate({ studies, onAdded, center }) {
  const [sid, setSid] = useState(studies[0]?.id || ''); const [n, setN] = useState('10'); const [topic, setTopic] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  useEffect(() => { if (!sid && studies[0]) setSid(studies[0].id) }, [studies]) // eslint-disable-line
  const go = async () => {
    if (!sid || busy) return; setBusy(true); setErr('')
    const r = await api.post(`/api/studies/${sid}/flashcards`, { n: +n, topic }); setBusy(false)
    if (r.error) return setErr(r.error); setTopic(''); onAdded(r.added?.length || 0)
  }
  return (
    <div className={`flex flex-col gap-3 ${center ? 'items-center' : ''}`}>
      <div className={`flex items-center gap-2 flex-wrap ${center ? 'justify-center' : ''}`}>
        <StudySelect studies={studies} value={sid} onChange={setSid} />
        <Pills value={n} onChange={setN} options={['5', '10', '20']} />
        <input className="input w-56" placeholder="Focus topic (optional)" value={topic} onChange={e => setTopic(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} />
      </div>
      <button disabled={busy || !sid} onClick={go} className="btn btn-primary inline-flex items-center justify-center gap-2 self-center">{busy ? <Wait label="Writing flashcards…" /> : <><Ico d={LAYERS} />Generate flashcards</>}</button>
      {!studies.length && <div className="text-xs text-dim">Create a study first, then generate cards from it.</div>}
      {err && <div className="text-xs text-error">{err}</div>}
    </div>
  )
}

// ---------- empty state: flipping card stack ----------
function Hero({ studies, onAdded }) {
  return (
    <div className="island relative overflow-hidden p-8 flex flex-col items-center text-center gap-5">
      <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[560px] h-[340px] rounded-full bg-accent/10 blur-3xl pointer-events-none" style={{ animation: 'rv-breathe 5s ease-in-out infinite' }} />
      <div className="relative w-40 h-28 mt-2" style={{ perspective: 800 }} aria-hidden>
        {[2, 1, 0].map(i => <div key={i} className="absolute inset-0 rounded-xl border border-accent/40 bg-panel-2 shadow-lg" style={{ transform: `translate(${i * 10}px, ${-i * 8}px) rotate(${i * 4}deg)`, opacity: 1 - i * 0.25 }} />)}
        <div className="absolute inset-0 rounded-xl border border-accent bg-panel grid place-items-center text-accent font-semibold" style={{ animation: 'rv-flip 4s ease-in-out infinite', transformStyle: 'preserve-3d' }}>?</div>
      </div>
      <div className="relative">
        <h2 className="text-xl font-semibold text-white">Nothing to review yet.</h2>
        <p className="text-sm text-dim mt-1 max-w-md">Every question you miss in an interview lands here automatically, then comes back after 1, 3 and 7 days until it sticks. You can also generate flashcards from any study.</p>
      </div>
      <div className="relative w-full"><Generate studies={studies} onAdded={onAdded} center /></div>
    </div>
  )
}

// ---------- review session ----------
function Session({ cards: initial, steps, onExit, onChanged, bar }) {
  const [queue, setQueue] = useState(initial); const [i, setI] = useState(0); const [shown, setShown] = useState(false); const [pick, setPick] = useState(-1)
  const [counts, setCounts] = useState({ again: 0, hard: 0, good: 0, easy: 0 }); const [busy, setBusy] = useState(false); const requeued = useRef(new Set())
  const c = queue[i], done = i >= queue.length
  const inFlight = useRef(false) // state would let two keypresses in one tick both pass and grade the card twice
  const grade = async g => {
    if (!c || !shown || inFlight.current) return; inFlight.current = true; setBusy(true)
    const r = await api.post(`/api/review/${c.id}`, { grade: g }); inFlight.current = false; setBusy(false)
    if (r.error) return alert(r.error)
    setCounts(x => ({ ...x, [g]: x[g] + 1 })); onChanged?.()
    if (g === 'again' && !requeued.current.has(c.id)) { requeued.current.add(c.id); setQueue(q => [...q, { ...c, step: r.step }]) }
    setI(x => x + 1); setShown(false); setPick(-1)
  }
  useEffect(() => {
    const k = e => {
      if (e.target.closest?.('input,textarea,select')) return
      if (e.key === ' ' && c && !shown && !c.choices) { e.preventDefault(); setShown(true) }
      const n = +e.key; if (n >= 1 && n <= 4 && shown) { e.preventDefault(); grade(GRADES[n - 1][0]) }
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  })
  if (done) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    return <Centered><div className="island p-8 flex flex-col items-center text-center gap-4" style={{ animation: 'rv-in .3s ease-out both' }}>
      <div className="w-14 h-14 rounded-2xl bg-success/15 text-success grid place-items-center"><Ico s={26} d={<path d="M20 6 9 17l-5-5"/>} /></div>
      <div><h2 className="text-xl font-semibold text-white">Session done</h2><p className="text-sm text-dim mt-1">{total} review{total === 1 ? '' : 's'}. Cards you knew come back later; the ones you missed come back tomorrow.</p></div>
      <div className="grid grid-cols-4 gap-2 w-full">{GRADES.map(([g, l]) => <div key={g} className="rounded-lg bg-app border border-border py-3"><div className="text-xl font-mono font-semibold text-white">{counts[g]}</div><div className="text-[11px] text-dim">{l}</div></div>)}</div>
      <button onClick={onExit} className="btn btn-primary">Done</button>
    </div></Centered>
  }
  const step = c.step ?? -1
  return (
    <div className="h-full flex flex-col gap-2.5 min-h-0">
      <PageBar tool={bar} onBack={onExit}>
        <span className="text-sm font-semibold text-white whitespace-nowrap">Reviewing</span>
        <div className="flex-1 min-w-0"><div className="h-1.5 rounded-full bg-panel-2 overflow-hidden"><div className="h-full bg-accent rounded-full transition-all" style={{ width: `${i / queue.length * 100}%` }} /></div></div>
        <span className="text-xs font-mono text-dim tabular-nums">{i + 1} / {queue.length}</span>
      </PageBar>
      <div className="flex-1 min-h-0 overflow-y-auto pt-2.5">
        <div key={`${c.id}:${i}`} className="island p-6 max-w-3xl mx-auto flex flex-col gap-4" style={{ animation: 'rv-in .3s ease-out both' }}>
          <div className="flex items-center gap-2 text-xs"><span className={`badge py-0 ${SRC[c.source]?.[1] || ''}`}>{SRC[c.source]?.[0] || c.source}</span><span className="text-dim truncate">{c.studyTitle}</span>{c.lapses > 0 && <span className="ml-auto text-error">missed {c.lapses}×</span>}</div>
          <div dir={dirOf(c.q)} className="text-lg font-medium text-white leading-relaxed">{c.q}</div>
          {c.choices?.length ? (
            <div className="flex flex-col gap-1.5">{c.choices.map((ch, j) => {
              const cls = !shown ? 'border-border hover:border-accent/50' : j === c.answerIndex ? 'border-success bg-success/10' : j === pick ? 'border-error bg-error/10' : 'border-border opacity-60'
              return <button key={j} dir={dirOf(ch)} disabled={shown} onClick={() => { setPick(j); setShown(true) }} className={`text-start text-sm px-3 py-2.5 rounded-lg border bg-app flex gap-2.5 transition-colors ${cls}`}><span className="text-dim font-mono text-xs pt-0.5">{'ABCD'[j]}</span><span>{ch}</span></button>
            })}</div>
          ) : !shown && <button onClick={() => setShown(true)} className="btn btn-primary self-start inline-flex items-center gap-2">Show answer<span className="text-[10px] font-mono opacity-70 border border-current/30 rounded px-1">Space</span></button>}
          {shown && c.a && <div dir={dirOf(c.a)} className="text-sm text-gray-200 border-l-2 border-accent pl-3 kb-rich" style={{ animation: 'rv-in .25s ease-out both' }}><Markdown text={c.a} /></div>}
          {shown && <div className="flex flex-col gap-2 pt-1">
            <div className="text-[11px] text-dim">How well did you know it?</div>
            <div className="grid grid-cols-4 gap-2">{GRADES.map(([g, l, cls], k) => <button key={g} disabled={busy} onClick={() => grade(g)} className={`${cls} justify-center py-2.5 flex-col !gap-0.5`}><span className="text-sm font-semibold">{l}</span><span className="text-[10px] opacity-80 font-mono">{steps[nextStep(step, g, steps)]}d · {k + 1}</span></button>)}</div>
          </div>}
        </div>
      </div>
    </div>
  )
}

// ---------- deck ----------
// scope: a study id when shown inside that study's workspace (cards of that study only, no study filter)
export default function Review({ studies = [], onChanged, scope = '', bar = 'review' }) {
  const [data, setData] = useState(null); const [filter, setFilter] = useState(scope); const [gen, setGen] = useState(false); const [session, setSession] = useState(null); const [flash, setFlash] = useState('')
  const load = useCallback(async () => { const r = await api.get('/api/review'); setData(r.error ? { cards: [], due: 0, steps: [1, 3, 7, 14, 30, 60, 120], error: r.error } : r) }, [])
  useEffect(() => { load() }, [load])
  const added = n => { setFlash(`${n} flashcard${n === 1 ? '' : 's'} added`); setTimeout(() => setFlash(''), 3000); setGen(false); load(); onChanged?.() }
  const del = async c => { if (!await ask({ title: 'Delete this card?', body: 'It leaves the review queue for good. A missed question will not be added back.', ok: 'Delete card' })) return; await api.del(`/api/review/${c.id}`); load(); onChanged?.() }
  const css = <style>{`
    @keyframes rv-breathe { 0%,100% { transform: translate(-50%, 0) scale(1); opacity: .6 } 50% { transform: translate(-50%, 8px) scale(1.12); opacity: 1 } }
    @keyframes rv-flip { 0%,35% { transform: rotateY(0) } 50%,85% { transform: rotateY(180deg) } 100% { transform: rotateY(360deg) } }
    @keyframes rv-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
  `}</style>
  if (!data) return <div className="h-full grid place-items-center text-xs text-dim">Loading…</div>
  const now = Date.now(), steps = data.steps
  if (session) return <>{css}<Session bar={bar} cards={session} steps={steps} onChanged={onChanged} onExit={() => { setSession(null); load() }} /></>
  if (!data.cards.length) return <>{css}<Centered>{data.error && <div className="text-xs text-error mb-2">{data.error}</div>}<Hero studies={studies} onAdded={added} /></Centered></>
  const cards = data.cards.filter(c => !filter || c.studyId === filter), due = cards.filter(c => c.dueAt <= now)
  const nextDue = cards.filter(c => c.dueAt > now).reduce((m, c) => Math.min(m, c.dueAt), Infinity)
  const n = { new: cards.filter(c => (c.step ?? -1) < 0).length, learning: cards.filter(c => c.step >= 0 && c.step <= 2).length, mastered: cards.filter(c => c.step >= 3).length }
  return (
    <div className="h-full overflow-y-auto p-2">
      {css}
      <div className="flex flex-col gap-2.5">
        <div className="island p-5 flex flex-col gap-4 relative overflow-hidden">
          <div className="absolute -top-20 -right-20 w-60 h-60 rounded-full bg-accent/10 blur-3xl pointer-events-none" />
          <div className="relative flex items-center gap-3 flex-wrap">
            <div className="w-10 h-10 rounded-xl bg-accent/15 text-accent grid place-items-center"><Ico s={20} d={LAYERS} /></div>
            <div className="flex-1 min-w-0"><div className="text-base font-semibold text-white">Review</div><div className="text-xs text-dim">Missed questions and flashcards, spaced out until they stick.</div></div>
            {!scope && <select className="input w-56" value={filter} onChange={e => setFilter(e.target.value)}><option value="">All studies</option>{studies.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select>}
          </div>
          <div className="relative grid grid-cols-5 gap-2 text-center">
            {[[due.length, 'due now', 'text-accent'], [n.new, 'new', 'text-white'], [n.learning, 'learning', 'text-warning'], [n.mastered, 'mastered', 'text-success'], [cards.length, 'total', 'text-white']].map(([v, l, cl]) => <div key={l} className="rounded-lg bg-app border border-border py-3"><div className={`text-2xl font-mono font-semibold tabular-nums ${cl}`}>{v}</div><div className="text-[11px] text-dim mt-0.5">{l}</div></div>)}
          </div>
          <div className="relative flex items-center gap-2 flex-wrap">
            <button disabled={!due.length} onClick={() => setSession(due)} className="btn btn-primary text-base px-6 py-2.5 inline-flex items-center gap-2"><Ico d={<path d="m6 3 14 9-14 9V3z"/>} />{due.length ? `Start review · ${due.length} due` : `All caught up${nextDue < Infinity ? `, next due ${rel(nextDue)}` : ''}`}</button>
            <button onClick={() => setGen(g => !g)} className={`btn-tint ${gen ? 'btn-purple' : ''}`}><Ico d={LAYERS} />Generate flashcards</button>
            {flash && <span className="text-xs text-success">{flash}</span>}
          </div>
          {gen && <div className="relative rounded-lg bg-app border border-border p-4" style={{ animation: 'rv-in .25s ease-out both' }}><Generate studies={studies} onAdded={added} /></div>}
        </div>
        <div className="island">
          <div className="panel-header">Cards · {cards.length}</div>
          <div className="divide-y divide-border">
            {cards.map(c => (
              <div key={c.id} className="group flex items-center gap-3 px-4 py-2.5">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.dueAt <= now ? 'bg-accent animate-pulse' : (c.step ?? -1) >= 3 ? 'bg-success' : 'bg-warning'}`} />
                <div className="min-w-0 flex-1"><div dir={dirOf(c.q)} className="text-sm text-gray-100 truncate">{c.q}</div><div className="text-[11px] text-dim truncate">{c.studyTitle}</div></div>
                <span className={`badge py-0 hidden md:inline-flex ${SRC[c.source]?.[1] || ''}`}>{SRC[c.source]?.[0] || c.source}</span>
                {c.lapses > 0 && <span className="text-[11px] text-error whitespace-nowrap">{c.lapses} lapse{c.lapses === 1 ? '' : 's'}</span>}
                <span className={`text-[11px] whitespace-nowrap w-20 text-right ${c.dueAt <= now ? 'text-accent' : 'text-dim'}`}>{rel(c.dueAt)}</span>
                <button onClick={() => del(c)} className="w-6 h-6 rounded text-dim opacity-0 group-hover:opacity-100 hover:text-error hover:bg-white/5 grid place-items-center" title="Delete card"><Ico d={Trash} /></button>
              </div>
            ))}
            {!cards.length && <div className="text-xs text-dim px-4 py-6 text-center">No cards for this study yet.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
