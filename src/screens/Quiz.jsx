import React, { useState, useEffect, useMemo, useRef } from 'react'
import Markdown from '../components/Markdown.jsx'
import { api } from '../api.js'
import Wait from '../components/Wait.jsx'
import { ask } from '../components/Confirm.jsx'
import { Centered, useSessions, StudySelect, BackBtn, Grid, Tile, Stats } from '../components/SessionList.jsx'

const Ico = ({ d, s = 14 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
const CHECK = <><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>
const Spin = () => <span className="inline-block w-3.5 h-3.5 border-2 border-border border-t-accent rounded-full animate-spin align-middle" />
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
const Pills = ({ value, onChange, options }) => (
  <div className="flex gap-0.5 bg-app border border-border rounded-lg p-0.5">{options.map(v => <button key={v} onClick={() => onChange(v)} className={`text-xs px-3 py-1.5 rounded-md capitalize transition-colors ${value === v ? 'bg-panel-2 text-white' : 'text-dim hover:text-white'}`}>{v}</button>)}</div>
)
const TILES = ['A', 'B', 'C', 'D', '✓', '?', 'A', 'C', '✓', 'B', '?', 'D', 'A', '✓', 'B', 'C']

// ---------- hero: animated start panel (whole page when the study has no quizzes yet) ----------
function Hero({ busy, onStart, studies }) {
  const [n, setN] = useState('8'); const [d, setD] = useState('mixed'); const [topic, setTopic] = useState(''); const [sid, setSid] = useState(studies[0]?.id || '')
  const tiles = useMemo(() => TILES.map((t, i) => ({ t, x: (i * 41 + 7) % 100, y: (i * 59 + 11) % 100, dur: 7 + (i % 5) * 1.3, delay: -(i * 0.9), size: 12 + (i % 3) * 4 })), [])
  const start = () => sid && onStart({ n: +n, difficulty: d, topic, studyId: sid })
  return (
    <div className="flex flex-col gap-2.5">
      <div className="island relative overflow-hidden flex-shrink-0" style={{ minHeight: 340 }}>
        <div className="absolute inset-0 pointer-events-none select-none" aria-hidden>
          <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[560px] h-[340px] rounded-full bg-accent/10 blur-3xl" style={{ animation: 'qz-breathe 5s ease-in-out infinite' }} />
          {tiles.map((p, i) => <span key={i} className={`absolute grid place-items-center rounded-md border font-mono font-semibold ${p.t === '✓' ? 'border-success/40 text-success/60' : 'border-accent/30 text-accent/50'}`} style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.size + 12, height: p.size + 12, fontSize: p.size, animation: `qz-float ${p.dur}s ease-in-out ${p.delay}s infinite` }}>{p.t}</span>)}
        </div>
        <div className="relative z-10 flex flex-col items-center text-center px-6 py-10 gap-4">
          <div className="w-14 h-14 rounded-2xl bg-accent/15 text-accent grid place-items-center" style={{ animation: 'qz-bob 3s ease-in-out infinite' }}><Ico s={26} d={CHECK} /></div>
          <div>
            <h2 className="text-xl font-semibold text-white">Test yourself.</h2>
            <p className="text-sm text-dim mt-1 max-w-md">A multiple-choice quiz written from your material. Your picks and the clock are saved as you go, so you can leave and come back, and every graded quiz stays here with its explanations.</p>
          </div>
          <StudySelect studies={studies} value={sid} onChange={setSid} />
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <Pills value={n} onChange={setN} options={['5', '8', '12', '20']} />
            <Pills value={d} onChange={setD} options={['easy', 'mixed', 'hard']} />
            <input className="input w-52" placeholder="Focus topic (optional)" value={topic} onChange={e => setTopic(e.target.value)} onKeyDown={e => e.key === 'Enter' && start()} />
          </div>
          <button disabled={busy || !sid} onClick={start} className="btn btn-primary text-base px-6 py-2.5 inline-flex items-center justify-center gap-2" style={busy ? undefined : { animation: 'qz-pulse 2.4s ease-out infinite' }}>
            {busy ? <Wait label="Writing your quiz…" /> : <><Ico d={<path d="m6 3 14 9-14 9V3z"/>} />Start quiz</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- grid card: progress or score + Continue / Show ----------
const barCls = pct => pct >= 70 ? 'bg-success' : pct >= 40 ? 'bg-warning' : 'bg-error' // literal class names so Tailwind keeps them
function Card({ q, onOpen, onDelete }) {
  const graded = q.status === 'graded' || (!q.questions && q.score != null), done = q.picked ? q.picked.filter(p => p >= 0).length : 0, pct = graded && q.total ? Math.round(q.score / q.total * 100) : 0
  return (
    <Tile dot={graded ? barCls(pct) : 'bg-accent animate-pulse'} title={q.title} sub={q.difficulty} study={q.studyTitle} onDelete={onDelete}
      badge={<span className={`badge py-0 ${graded ? '' : 'badge-green'}`}>{graded ? 'Graded' : 'In progress'}</span>}
      action={<button disabled={!q.questions} onClick={onOpen} className={`${graded ? 'btn-tint btn-blue' : 'btn btn-primary'} inline-flex items-center justify-center gap-2 py-2.5 text-sm w-full`}>
        {graded ? <><Ico d={<><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></>} />Show</> : <><Ico d={<path d="m6 3 14 9-14 9V3z"/>} />Continue</>}
      </button>}>
      <Stats items={graded ? [[`${q.score}/${q.total}`, 'score'], [`${pct}%`, 'result'], [fmt(q.elapsed || 0), 'time']] : [[`${done}/${q.total}`, 'answered'], [q.total - done, 'left'], [fmt(q.elapsed || 0), 'time']]} />
      <div className="h-1.5 rounded-full bg-panel-2 overflow-hidden"><div className={`h-full rounded-full ${graded ? barCls(pct) : 'bg-accent'}`} style={{ width: `${graded ? pct : q.total ? done / q.total * 100 : 0}%` }} /></div>
      <div className="flex items-center text-xs text-dim"><span>{new Date(q.at).toLocaleDateString()}</span>{q.topic && <span className="ml-auto truncate max-w-[60%]" title={q.topic}>{q.topic}</span>}</div>
    </Tile>
  )
}

// ---------- session: timer, questions, grade; reopened graded quizzes show answers + explanations ----------
function Session({ study, qz, setQz, onBack }) {
  const [picked, setPicked] = useState(qz.picked || Array(qz.questions.length).fill(-1)); const [elapsed, setElapsed] = useState(qz.elapsed || 0)
  const base = `/api/studies/${study.id}/quiz/${qz.id}`; const graded = qz.status === 'graded'; const box = useRef()
  const done = picked.filter(p => p >= 0).length; const score = qz.questions.filter((q, i) => picked[i] === q.answer).length
  useEffect(() => { if (graded) return; const t = setInterval(() => { if (!document.hidden) setElapsed(e => e + 1) }, 1000); return () => clearInterval(t) }, [graded])
  useEffect(() => { if (elapsed && elapsed % 10 === 0) api.post(base, { elapsed }) }, [elapsed]) // eslint-disable-line
  const ref = useRef(); ref.current = { elapsed, picked, graded, qz }
  useEffect(() => () => { const { elapsed, picked, graded, qz } = ref.current; if (!graded) { api.post(base, { elapsed, picked }); setQz({ ...qz, elapsed, picked }) } }, []) // eslint-disable-line -- keep the card's time fresh when switching away
  const pick = (i, j) => { const p = picked.map((x, k) => k === i ? j : x); setPicked(p); api.post(base, { picked: p, elapsed }) }
  const grade = async () => {
    if (done < qz.questions.length && !await ask({ title: `${qz.questions.length - done} unanswered. Grade anyway?`, body: 'Unanswered questions count as wrong.', ok: 'Grade', danger: false })) return
    const u = { ...qz, picked, elapsed, status: 'graded', score }; api.post(base, { picked, elapsed, status: 'graded', score }); setQz(u); box.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const pct = Math.round(score / qz.questions.length * 100)
  return (
    <div className="h-full flex flex-col gap-2.5 min-h-0">
      <div className="island px-3 py-2 flex items-center gap-3 flex-shrink-0">
        <BackBtn onClick={onBack} title="Back to quizzes" />
        <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-white truncate">{qz.title}</div><div className="text-[11px] text-dim"><span className="capitalize">{qz.difficulty}</span> · {qz.questions.length} questions{qz.topic ? ` · ${qz.topic}` : ''}</div></div>
        {graded ? <span className={`badge ${pct >= 70 ? 'badge-green' : pct >= 40 ? 'badge-yellow' : 'badge-red'}`}>{score} / {qz.questions.length}</span> : <span className="badge">{done} / {qz.questions.length} answered</span>}
        <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-app border border-border leading-tight">
          <div className="font-mono text-base text-white tabular-nums flex items-center gap-1.5">{fmt(elapsed)}{!graded && <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />}</div>
          <div className={`text-[10px] uppercase tracking-wider ${graded ? 'text-dim' : 'text-accent'}`}>{graded ? 'graded' : 'running'}</div>
        </div>
        {!graded && <button className="btn-tint btn-green" onClick={grade}><Ico d={<path d="M20 6 9 17l-5-5"/>} />Check answers</button>}
      </div>
      <div ref={box} className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2.5">
        {graded && (
          <div className="island p-5 flex items-center gap-5 flex-shrink-0" style={{ animation: 'qz-in .3s ease-out both' }}>
            <div className={`text-4xl font-bold font-mono tabular-nums ${pct >= 70 ? 'text-success' : pct >= 40 ? 'text-warning' : 'text-error'}`}>{pct}%</div>
            <div className="flex-1"><div className="text-sm font-semibold text-white">{score} of {qz.questions.length} correct in {fmt(elapsed)}</div><div className="text-xs text-dim mt-0.5">{pct >= 70 ? 'Solid. Skim the ones you missed below.' : pct >= 40 ? 'Getting there. Read every explanation below.' : 'Rough one. Go back to the material, then try a new quiz.'}</div>
              <div className="h-1.5 rounded-full bg-panel-2 overflow-hidden mt-2"><div className={`h-full rounded-full ${pct >= 70 ? 'bg-success' : pct >= 40 ? 'bg-warning' : 'bg-error'}`} style={{ width: `${pct}%` }} /></div></div>
          </div>
        )}
        <div className="island p-4 flex-shrink-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-4">{qz.questions.map((q, i) => <a key={i} href={`#qz-${i}`} onClick={e => { e.preventDefault(); document.getElementById(`qz-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }} className={`w-6 h-6 rounded-md text-[11px] font-mono grid place-items-center border ${graded ? (picked[i] === q.answer ? 'border-success bg-success/15 text-success' : 'border-error bg-error/15 text-error') : picked[i] >= 0 ? 'border-accent bg-accent/15 text-accent' : 'border-border text-dim'}`}>{i + 1}</a>)}</div>
          {qz.questions.map((q, i) => (
            <div key={i} id={`qz-${i}`} className="mb-5 scroll-mt-4" dir="auto">
              <div className="text-sm font-medium text-gray-100 mb-1.5">{i + 1}. {q.q}</div>
              <div className="flex flex-col gap-1">
                {q.choices.map((c, j) => {
                  const cls = graded ? (j === q.answer ? 'border-success bg-success/10' : j === picked[i] ? 'border-error bg-error/10' : 'border-border opacity-60') : picked[i] === j ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/50'
                  return <button key={j} disabled={graded} onClick={() => pick(i, j)} className={`text-left text-sm px-3 py-2 rounded-lg border bg-app flex gap-2.5 transition-colors ${cls}`}><span className="text-dim font-mono text-xs pt-0.5">{'ABCD'[j]}</span><span>{c}</span>{graded && j === picked[i] && j !== q.answer && <span className="ml-auto text-[10px] text-dim self-center">your pick</span>}</button>
                })}
              </div>
              {graded && <div className="mt-2 text-xs text-gray-300 border-l-2 border-accent pl-2.5 kb-rich"><Markdown text={q.explanation} /></div>}
            </div>
          ))}
          {!graded && <button className="btn btn-primary inline-flex items-center gap-1.5" onClick={grade}><Ico d={<path d="M20 6 9 17l-5-5"/>} />Check answers</button>}
        </div>
      </div>
    </div>
  )
}

export default function Quiz({ studies }) {
  const { list, update: setQz, add, remove } = useSessions('quizzes', studies)
  const [sel, setSel] = useState(null) // null = cards, 'new' = hero, id = session
  const [busy, setBusy] = useState(false)
  const active = list?.find(q => q.id === sel && q.questions)
  const start = async ({ studyId, ...opts }) => {
    setBusy(true); const q = await api.post(`/api/studies/${studyId}/quiz`, opts); setBusy(false)
    if (q.error) return alert(q.error); add(q, studyId); setSel(q.id)
  }
  const del = async q => {
    if (!await ask({ title: `Delete «${q.title}»?`, body: 'The questions, your answers and the score are removed.', ok: 'Delete' })) return
    await api.del(`/api/studies/${q.studyId}/quiz/${q.id}`); remove(q.id); if (sel === q.id) setSel(null)
  }
  const css = (
      <style>{`
        @keyframes qz-breathe { 0%,100% { transform: translate(-50%, 0) scale(1); opacity: .6 } 50% { transform: translate(-50%, 8px) scale(1.12); opacity: 1 } }
        @keyframes qz-float { 0%,100% { transform: translateY(0) rotate(-4deg); opacity: .35 } 50% { transform: translateY(-16px) rotate(4deg); opacity: .9 } }
        @keyframes qz-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
        @keyframes qz-pulse { 0% { box-shadow: 0 0 0 0 rgb(var(--c-accent) / .55) } 70% { box-shadow: 0 0 0 14px rgb(var(--c-accent) / 0) } 100% { box-shadow: 0 0 0 0 rgb(var(--c-accent) / 0) } }
        @keyframes qz-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
      `}</style>
  )
  if (!list) return <div className="h-full grid place-items-center text-xs text-dim">Loading…</div>
  if (active) return <>{css}<Session key={active.id} study={{ id: active.studyId }} qz={active} setQz={setQz} onBack={() => setSel(null)} /></>
  if (!list.length || sel === 'new') return <>{css}<Centered>
    {list.length > 0 && <button onClick={() => setSel(null)} className="btn-ghost text-xs inline-flex items-center gap-1 mb-2"><Ico d={<path d="m15 18-6-6 6-6"/>} />Back to quizzes</button>}
    <Hero busy={busy} onStart={start} studies={studies} />
  </Centered></>
  return <>{css}<Grid onNew={() => setSel('new')} newLabel="New quiz">{list.map(q => <Card key={q.id} q={q} onOpen={() => setSel(q.id)} onDelete={() => del(q)} />)}</Grid></>
}
