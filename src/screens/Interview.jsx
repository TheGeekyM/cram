import React, { useState, useEffect, useMemo, useRef } from 'react'
import Markdown from '../components/Markdown.jsx'
import { api } from '../api.js'

const Ico = ({ d, s = 14 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
const MIC = <><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></>
const Spin = () => <span className="inline-block w-3.5 h-3.5 border-2 border-border border-t-accent rounded-full animate-spin align-middle" />
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
const LANGS = ['English', 'Arabic', 'French', 'Spanish', 'German']
const DIFFS = ['easy', 'medium', 'hard']
const stats = iv => { const n = iv.turns.length, ok = iv.turns.filter(t => t.correct).length; return { n, ok, avg: n ? Math.round(iv.turns.reduce((a, t) => a + (t.score || 0), 0) / n) : 0 } }
const Pills = ({ value, onChange, options }) => (
  <div className="flex gap-0.5 bg-app border border-border rounded-lg p-0.5">{options.map(v => <button key={v} onClick={() => onChange(v)} className={`text-xs px-3 py-1.5 rounded-md capitalize transition-colors ${value === v ? 'bg-panel-2 text-white' : 'text-dim hover:text-white'}`}>{v}</button>)}</div>
)

// ---------- lobby: animated empty state + start options + history cards ----------
function Lobby({ study, busy, onStart, onOpen, onDelete }) {
  const [d, setD] = useState('medium'); const [lang, setLang] = useState('English')
  const bars = useMemo(() => Array.from({ length: 28 }, (_, i) => ({ dur: 1.1 + ((i * 7) % 5) * 0.22, delay: -((i * 0.37) % 2), h: 18 + ((i * 13) % 5) * 12 })), [])
  const past = [...(study.interviews || [])].reverse()
  return (
    <div className="h-full flex flex-col gap-2.5 overflow-y-auto">
      <div className="island relative overflow-hidden flex-shrink-0" style={{ minHeight: 340 }}>
        <div className="absolute inset-0 pointer-events-none select-none" aria-hidden>
          <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[560px] h-[340px] rounded-full bg-accent/10 blur-3xl" style={{ animation: 'iv-breathe 5s ease-in-out infinite' }} />
          {[0, 1, 2].map(i => <div key={i} className="absolute left-1/2 top-[88px] w-14 h-14 -ml-7 -mt-7 rounded-full border border-accent/40" style={{ animation: `iv-ring 3s ease-out ${i}s infinite` }} />)}
          <div className="absolute inset-x-0 bottom-0 h-16 flex items-end justify-center gap-1 px-6 opacity-60">
            {bars.map((b, i) => <span key={i} className="w-1 rounded-full bg-accent/60" style={{ height: b.h, animation: `iv-eq ${b.dur}s ease-in-out ${b.delay}s infinite alternate`, transformOrigin: 'bottom' }} />)}
          </div>
        </div>
        <div className="relative z-10 flex flex-col items-center text-center px-6 pt-10 pb-20 gap-4">
          <div className="w-14 h-14 rounded-2xl bg-accent/15 text-accent grid place-items-center" style={{ animation: 'iv-bob 3s ease-in-out infinite' }}><Ico s={26} d={MIC} /></div>
          <div>
            <h2 className="text-xl font-semibold text-white">Let's talk it through.</h2>
            <p className="text-sm text-dim mt-1 max-w-md">An endless interview on your material: one question at a time, feedback after every answer, and each next question built on how you did. Stop whenever you like, pick it up again later.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <Pills value={d} onChange={setD} options={DIFFS} />
            <Pills value={lang} onChange={setLang} options={LANGS} />
          </div>
          <button disabled={busy} onClick={() => onStart({ difficulty: d, language: lang })} className="btn btn-primary text-base px-6 py-2.5" style={busy ? undefined : { animation: 'iv-pulse 2.4s ease-out infinite' }}>
            {busy ? <><Spin /> Preparing the first question…</> : <><Ico d={<path d="m6 3 14 9-14 9V3z"/>} /> Start interview</>}
          </button>
        </div>
      </div>
      <div className="island">
        <div className="panel-header">Your interviews</div>
        {past.length ? (
          <div className="p-2.5 grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
            {past.map(iv => { const { n, ok, avg } = stats(iv); const open = iv.status === 'open'; return (
              <div key={iv.id} onClick={() => onOpen(iv)} className="group relative rounded-lg bg-app border border-border hover:border-accent/50 transition-colors cursor-pointer p-3 flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${open ? 'bg-accent animate-pulse' : 'bg-dim'}`} />
                  <span className="text-sm font-semibold text-white capitalize">{iv.difficulty}</span><span className="text-xs text-dim">· {iv.language}</span>
                  <span className={`ml-auto badge ${open ? 'badge-green' : ''}`}>{open ? 'In progress' : 'Ended'}</span>
                </div>
                <div className="grid grid-cols-3 gap-1 text-center">
                  {[[n, 'questions'], [`${ok}/${n}`, 'correct'], [fmt(iv.elapsed || 0), 'time']].map(([v, l]) => <div key={l}><div className="text-sm font-semibold text-white font-mono tabular-nums">{v}</div><div className="text-[10px] uppercase tracking-wider text-dim">{l}</div></div>)}
                </div>
                <div className="h-1.5 rounded-full bg-panel-2 overflow-hidden" title={`average score ${avg}/10`}><div className={`h-full rounded-full transition-all ${avg >= 7 ? 'bg-success' : avg >= 4 ? 'bg-warning' : 'bg-error'}`} style={{ width: `${n ? avg * 10 : 0}%` }} /></div>
                <div className="flex items-center gap-2 text-[11px] text-dim">
                  <span>{new Date(iv.at).toLocaleDateString()}</span>
                  <span className="ml-auto text-accent opacity-0 group-hover:opacity-100 transition-opacity">{open ? 'Continue →' : 'Details →'}</span>
                  <button onClick={e => { e.stopPropagation(); onDelete(iv) }} className="w-6 h-6 rounded text-dim opacity-0 group-hover:opacity-100 hover:text-error hover:bg-white/5 grid place-items-center" title="Delete"><Ico d={<><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/></>} /></button>
                </div>
              </div>) })}
          </div>
        ) : <div className="text-xs text-dim px-4 py-3">Nothing yet. Pick a difficulty and a language, then start.</div>}
      </div>
      <style>{`
        @keyframes iv-breathe { 0%,100% { transform: translate(-50%, 0) scale(1); opacity: .6 } 50% { transform: translate(-50%, 8px) scale(1.12); opacity: 1 } }
        @keyframes iv-ring { 0% { transform: scale(1); opacity: .7 } 100% { transform: scale(3.2); opacity: 0 } }
        @keyframes iv-eq { from { transform: scaleY(.25) } to { transform: scaleY(1) } }
        @keyframes iv-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
        @keyframes iv-pulse { 0% { box-shadow: 0 0 0 0 rgb(var(--c-accent) / .55) } 70% { box-shadow: 0 0 0 14px rgb(var(--c-accent) / 0) } 100% { box-shadow: 0 0 0 0 rgb(var(--c-accent) / 0) } }
        @keyframes iv-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
      `}</style>
    </div>
  )
}

// ---------- one past turn, as shown in the transcript ----------
function Turn({ t, i }) {
  return (
    <div className="rounded-lg bg-app border border-border p-3 flex flex-col gap-2" dir="auto">
      <div className="flex items-center gap-2 text-xs"><span className={`w-2 h-2 rounded-full ${t.correct ? 'bg-success' : 'bg-error'}`} /><span className="text-dim">Q{i + 1} · {t.type === 'choice' ? 'multiple choice' : 'open answer'} · {fmt(t.secs || 0)}</span><b className={`ml-auto ${t.correct ? 'text-success' : 'text-error'}`}>{t.score}/10</b></div>
      <div className="text-sm font-medium text-gray-100">{t.q}</div>
      {t.type === 'choice' && t.choices ? (
        <div className="flex flex-col gap-1">{t.choices.map((c, j) => { const mine = t.answer === c, right = j === t.answer_idx || j === t.answer; return <div key={j} className={`text-xs px-2.5 py-1.5 rounded-md border flex gap-2 ${j === t.answerIndex ? 'border-success bg-success/10' : mine && !t.correct ? 'border-error bg-error/10' : 'border-border'}`}><span className="text-dim font-mono">{'ABCD'[j]}</span><span>{c}</span>{mine && <span className="ml-auto text-[10px] text-dim">your pick</span>}</div> })}</div>
      ) : <div className="text-sm px-3 py-2 rounded-lg bg-accent/10 border border-accent/25 whitespace-pre-wrap">{t.answer || <i className="text-dim">no answer</i>}</div>}
      {t.feedback && <div className="text-xs text-gray-300 border-l-2 border-accent pl-2.5 kb-rich"><Markdown text={t.feedback} /></div>}
    </div>
  )
}

// ---------- session: wizard (timer, current question, feedback, next/end) + transcript; also the details/resume view ----------
function Session({ study, iv, setIv, onExit }) {
  const [picked, setPicked] = useState(-1); const [text, setText] = useState(''); const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(iv.elapsed || 0); const [qStart, setQStart] = useState(iv.elapsed || 0); const [fb, setFb] = useState(null) // fb = the turn just graded, shown until Next
  const base = `/api/studies/${study.id}/interviews/${iv.id}`; const open = iv.status === 'open'; const { n, ok, avg } = stats(iv); const box = useRef()
  useEffect(() => { if (!open) return; const t = setInterval(() => { if (!document.hidden) setElapsed(e => e + 1) }, 1000); return () => clearInterval(t) }, [open])
  useEffect(() => { if (elapsed && elapsed % 10 === 0) api.post(base, { elapsed }) }, [elapsed]) // eslint-disable-line
  const submit = async () => {
    const answer = iv.pending.type === 'choice' ? (picked < 0 ? '' : `${'ABCD'[picked]}. ${iv.pending.choices[picked]}`) : text.trim()
    if (!answer && !confirm('Submit without an answer?')) return
    setBusy(true); const r = await api.post(`${base}/answer`, { answer, secs: elapsed - qStart, elapsed }); setBusy(false)
    if (r.error) return alert(r.error)
    setIv({ ...r, elapsed }); setFb({ ...r.turns[r.turns.length - 1], pickedIndex: picked }); setPicked(-1); setText('')
  }
  const next = () => { setFb(null); setQStart(elapsed); box.current?.scrollTo({ top: 0, behavior: 'smooth' }) }
  const setStatus = status => { api.post(base, { status, elapsed }); setIv({ ...iv, status, elapsed }) }
  const end = () => { if (confirm('End this interview? You can resume it any time from the list.')) { setStatus('ended'); setFb(null) } }
  const shown = fb ? iv.turns.slice(0, -1) : iv.turns
  const q = iv.pending
  return (
    <div className="h-full flex flex-col gap-2.5 min-h-0">
      <div className="island px-3 py-2 flex items-center gap-3 flex-shrink-0">
        <button onClick={onExit} className="w-7 h-7 rounded text-dim hover:text-white hover:bg-white/5 grid place-items-center" title="Back"><Ico d={<path d="m15 18-6-6 6-6"/>} /></button>
        <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-white capitalize">{iv.difficulty} interview <span className="text-dim font-normal normal-case">· {iv.language}</span></div><div className="text-[11px] text-dim">{n} answered · {ok} correct · avg {avg}/10</div></div>
        <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-app border border-border leading-tight">
          <div className="font-mono text-base text-white tabular-nums flex items-center gap-1.5">{fmt(elapsed)}{open && <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />}</div>
          <div className={`text-[10px] uppercase tracking-wider ${open ? 'text-accent' : 'text-dim'}`}>{open ? 'running' : 'ended'}</div>
        </div>
        {open ? <button onClick={end} className="btn-tint btn-red" disabled={busy}><Ico d={<rect x="6" y="6" width="12" height="12" rx="2"/>} />End</button>
          : <button onClick={() => setStatus('open')} className="btn-tint btn-green"><Ico d={<path d="m6 3 14 9-14 9V3z"/>} />Resume</button>}
      </div>
      <div ref={box} className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2.5">
        {open && q && (
          <div key={fb ? 'fb' : n} className="island p-5 flex flex-col gap-4 flex-shrink-0" style={{ animation: 'iv-in .3s ease-out both' }} dir="auto">
            <div className="flex items-center gap-1.5 flex-wrap">
              {iv.turns.map((t, i) => <span key={i} className={`w-2 h-2 rounded-full ${t.correct ? 'bg-success' : 'bg-error'}`} title={`Q${i + 1}: ${t.score}/10`} />)}
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
              <span className="ml-auto text-[11px] text-dim font-mono">Q{n + 1} · {fmt(elapsed - qStart)}</span>
            </div>
            {fb ? (
              <>
                <div className={`flex items-center gap-2 text-sm font-semibold ${fb.correct ? 'text-success' : 'text-error'}`}><Ico s={18} d={fb.correct ? <path d="M20 6 9 17l-5-5"/> : <><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>} />{fb.correct ? 'Correct' : 'Not quite'}<span className="ml-auto font-mono">{fb.score}/10</span></div>
                <div className="text-sm text-gray-100">{fb.q}</div>
                {fb.type === 'choice' && fb.choices && <div className="flex flex-col gap-1">{fb.choices.map((c, j) => <div key={j} className={`text-sm px-3 py-2 rounded-lg border flex gap-2.5 ${j === fb.answerIndex ? 'border-success bg-success/10' : j === fb.pickedIndex ? 'border-error bg-error/10' : 'border-border opacity-60'}`}><span className="text-dim font-mono text-xs pt-0.5">{'ABCD'[j]}</span><span>{c}</span></div>)}</div>}
                {fb.type === 'text' && <div className="text-sm px-3 py-2 rounded-lg bg-accent/10 border border-accent/25 whitespace-pre-wrap">{fb.answer || <i className="text-dim">no answer</i>}</div>}
                <div className="text-sm text-gray-300 border-l-2 border-accent pl-3 kb-rich"><Markdown text={fb.feedback} /></div>
                <div className="flex items-center gap-2"><button className="btn btn-primary" onClick={next} autoFocus>Next question <Ico d={<path d="m9 18 6-6-6-6"/>} /></button><button className="btn-ghost text-xs" onClick={end}>End here</button></div>
              </>
            ) : (
              <>
                <div className="text-base font-medium text-white leading-relaxed">{q.q}</div>
                {q.type === 'choice' && q.choices ? (
                  <div className="flex flex-col gap-1.5">{q.choices.map((c, j) => <button key={j} disabled={busy} onClick={() => setPicked(j)} className={`text-left text-sm px-3 py-2.5 rounded-lg border bg-app flex gap-2.5 transition-colors ${picked === j ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/50'}`}><span className="text-dim font-mono text-xs pt-0.5">{'ABCD'[j]}</span><span>{c}</span></button>)}</div>
                ) : <textarea dir="auto" className="input min-h-[110px] resize-y" placeholder="Type your answer… (Ctrl+Enter to submit)" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && submit()} autoFocus disabled={busy} />}
                <div className="flex items-center gap-2"><button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? <><Spin /> Checking…</> : <>Submit <Ico d={<path d="m9 18 6-6-6-6"/>} /></>}</button><span className="text-[11px] text-dim">{q.type === 'choice' ? 'Pick one' : 'A few sentences is plenty'}</span></div>
              </>
            )}
          </div>
        )}
        {!open && !n && <div className="island p-5 text-sm text-dim text-center">No questions answered yet. Resume to get the first one.</div>}
        {shown.length > 0 && (
          <div className="island flex-shrink-0">
            <div className="panel-header">Transcript · {shown.length} question{shown.length === 1 ? '' : 's'}</div>
            <div className="p-2.5 flex flex-col gap-2">{[...shown].map((t, i) => ({ t, i })).reverse().map(({ t, i }) => <Turn key={i} t={t} i={i} />)}</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Interview({ study, setStudy }) {
  const [active, setActive] = useState(null); const [busy, setBusy] = useState(false)
  const setIv = iv => { setActive(iv); setStudy(s => ({ ...s, interviews: (s.interviews || []).map(x => x.id === iv.id ? iv : x) })) }
  const start = async opts => {
    setBusy(true); const iv = await api.post(`/api/studies/${study.id}/interviews`, opts); setBusy(false)
    if (iv.error) return alert(iv.error); setStudy(s => ({ ...s, interviews: [...(s.interviews || []), iv] })); setActive(iv)
  }
  const del = async iv => { if (!confirm(`Delete this ${iv.difficulty} interview?`)) return; await api.del(`/api/studies/${study.id}/interviews/${iv.id}`); setStudy(s => ({ ...s, interviews: s.interviews.filter(x => x.id !== iv.id) })) }
  if (active) return <Session study={study} iv={active} setIv={setIv} onExit={async () => { setActive(null); setStudy(await api.get(`/api/studies/${study.id}`)) }} />
  return <Lobby study={study} busy={busy} onStart={start} onOpen={setActive} onDelete={del} />
}
