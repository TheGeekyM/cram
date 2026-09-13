import React, { useState, useEffect, useMemo, useRef } from 'react'
import Markdown from '../components/Markdown.jsx'
import { api } from '../api.js'
import Wait from '../components/Wait.jsx'
import { ask } from '../components/Confirm.jsx'
import { Centered, useSessions, GENERAL, PageBar, Grid, Tile, Stats } from '../components/SessionList.jsx'
import { speak, stopSpeech, speechProgress, useMic, dirOf } from '../voice.js'

const Ico = ({ d, s = 14 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
const MIC = <><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></>
const Spin = () => <span className="inline-block w-3.5 h-3.5 border-2 border-border border-t-accent rounded-full animate-spin align-middle" />
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
const LANGS = ['English', 'Arabic']
const DIFFS = ['easy', 'medium', 'hard']
const stats = iv => { const n = iv.turns.length, ok = iv.turns.filter(t => t.correct).length; return { n, ok, avg: n ? Math.round(iv.turns.reduce((a, t) => a + (t.score || 0), 0) / n) : 0 } }
const Pills = ({ value, onChange, options }) => (
  <div className="flex gap-0.5 bg-app border border-border rounded-lg p-0.5">{options.map(v => <button key={v} onClick={() => onChange(v)} className={`text-xs px-3 py-1.5 rounded-md capitalize transition-colors ${value === v ? 'bg-panel-2 text-white' : 'text-dim hover:text-white'}`}>{v}</button>)}</div>
)

// real-interview rounds (General practice); ids match server ROUNDS. Coding rounds run in Code.
const ROUNDS = [
  ['technical', 'Technical', 'Concepts, internals, debugging', <><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></>],
  ['behavioral', 'Behavioral', '"Tell me about a time…"', <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>],
  ['situational', 'Situational', '"What would you do if…"', <><path d="M12 9v4"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="9"/></>],
  ['management', 'Management', 'People, delivery, conflict', <><circle cx="9" cy="7" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M15 20a4.5 4.5 0 0 1 6-4"/></>],
  ['system-design', 'System design', 'Staged: requirements to scale', <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><path d="M10 6.5h4a2 2 0 0 1 2 2V14"/></>],
  ['architecture', 'Architecture', 'Styles, trade-offs, NFRs', <><path d="M3 21h18"/><path d="M5 21V10l7-5 7 5v11"/><path d="M9 21v-6h6v6"/></>],
  ['coding', 'Coding', 'Opens a challenge in Code', <><path d="M4 17 10 11 4 5"/><path d="M12 19h8"/></>],
]
const roundName = id => ROUNDS.find(r => r[0] === id)?.[1] || id
const SENIORITY = ['junior', 'mid', 'senior', 'lead']
const real = iv => iv.mode === 'real'

// ---------- generic hero: a real interview round for a target role ----------
function RealHero({ busy, onStart, onCoding }) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem('cram:iv-setup') || '{}') } catch { return {} } })()
  const [role, setRole] = useState(saved.role || ''); const [sen, setSen] = useState(saved.seniority || 'mid'); const [round, setRound] = useState(saved.round || 'technical')
  const [lang, setLang] = useState(saved.language || 'English'); const [jd, setJd] = useState(''); const [showJd, setShowJd] = useState(false)
  const go = () => {
    if (round === 'coding') return onCoding?.()
    const o = { role: role.trim(), seniority: sen, round, language: lang }
    try { localStorage.setItem('cram:iv-setup', JSON.stringify(o)) } catch {}
    onStart({ ...o, jd })
  }
  return (
    <div className="island relative overflow-hidden p-6 flex flex-col gap-5">
      <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[560px] h-[340px] rounded-full bg-accent/10 blur-3xl pointer-events-none" style={{ animation: 'iv-breathe 5s ease-in-out infinite' }} aria-hidden />
      <div className="relative flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-accent/15 text-accent grid place-items-center flex-shrink-0" style={{ animation: 'iv-bob 3s ease-in-out infinite' }}><Ico s={22} d={MIC} /></div>
        <div><h2 className="text-xl font-semibold text-white">Mock interview</h2><p className="text-sm text-dim mt-0.5">A real round with a calibrated interviewer: open answers, follow-ups when you are vague, and rubric scores after every answer.</p></div>
      </div>
      <div className="relative grid gap-3 sm:grid-cols-[1fr_auto] items-end">
        <label className="flex flex-col gap-1.5"><span className="text-[11px] uppercase tracking-wider text-dim">Role</span><input className="input" placeholder="e.g. Backend engineer, Product manager" value={role} onChange={e => setRole(e.target.value)} onKeyDown={e => e.key === 'Enter' && role.trim() && go()} autoFocus /></label>
        <div className="flex flex-col gap-1.5"><span className="text-[11px] uppercase tracking-wider text-dim">Level</span><Pills value={sen} onChange={setSen} options={SENIORITY} /></div>
      </div>
      <div className="relative flex flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-dim">Round</span>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
          {ROUNDS.map(([id, label, sub, ic]) => (
            <button key={id} onClick={() => setRound(id)} className={`text-left rounded-xl border p-3 flex flex-col gap-1.5 transition-all ${round === id ? 'border-accent bg-accent/10 shadow-[0_0_0_3px_rgb(var(--c-accent)/.15)]' : 'border-border bg-app/60 hover:border-gray-500'}`}>
              <span className={round === id ? 'text-accent' : 'text-dim'}><Ico s={16} d={ic} /></span>
              <span className="text-sm font-medium text-white">{label}</span><span className="text-[11px] text-dim leading-snug">{sub}</span>
            </button>))}
        </div>
      </div>
      <div className="relative flex items-center gap-2 flex-wrap">
        <Pills value={lang} onChange={setLang} options={LANGS} />
        <button onClick={() => setShowJd(v => !v)} className={`btn-tint ${showJd || jd ? 'btn-purple' : ''}`}><Ico d={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></>} />{jd ? 'Job description added' : 'Add job description'}</button>
      </div>
      {showJd && <textarea dir="auto" className="relative input min-h-[120px] resize-y" placeholder="Paste the job posting (optional). Questions get tailored to it." value={jd} onChange={e => setJd(e.target.value.slice(0, 6000))} />}
      <button disabled={busy || (round !== 'coding' && !role.trim())} onClick={go} className="relative btn btn-primary text-base px-6 py-2.5 inline-flex items-center justify-center gap-2 self-center" style={busy ? undefined : { animation: 'iv-pulse 2.4s ease-out infinite' }}>
        {busy ? <Wait label="The interviewer is getting ready…" /> : round === 'coding' ? <><Ico d={<><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></>} />Open Code</> : <><Ico d={<path d="m6 3 14 9-14 9V3z"/>} />Start {roundName(round).toLowerCase()} round</>}
      </button>
    </div>
  )
}

// ---------- study hero: animated start panel (whole page when the study has no interviews yet) ----------
function Hero({ busy, onStart }) {
  const [d, setD] = useState('medium'); const [lang, setLang] = useState('English')
  const bars = useMemo(() => Array.from({ length: 28 }, (_, i) => ({ dur: 1.1 + ((i * 7) % 5) * 0.22, delay: -((i * 0.37) % 2), h: 18 + ((i * 13) % 5) * 12 })), [])
  return (
    <div className="flex flex-col gap-2.5">
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
          <button disabled={busy} onClick={() => onStart({ difficulty: d, language: lang })} className="btn btn-primary text-base px-6 py-2.5 inline-flex items-center justify-center gap-2" style={busy ? undefined : { animation: 'iv-pulse 2.4s ease-out infinite' }}>
            {busy ? <Wait label="Preparing the first question…" /> : <><Ico d={<path d="m6 3 14 9-14 9V3z"/>} />Start interview</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- grid card: stats + Continue (open) / Show (ended) ----------
function Card({ iv, onOpen, onDelete }) {
  const { n, ok, avg } = stats(iv); const open = iv.status === 'open'
  return (
    <Tile dot={open ? 'bg-accent animate-pulse' : 'bg-dim'} title={real(iv) ? roundName(iv.round) : iv.difficulty[0].toUpperCase() + iv.difficulty.slice(1)} sub={real(iv) ? iv.seniority : iv.language} study={real(iv) ? `${iv.role}${iv.jd ? ' · job description' : ''}` : ''} onDelete={onDelete}
      badge={<span className="flex items-center gap-1.5">
        {iv.report && <span className="badge-purple py-0 inline-flex items-center gap-1" title={`Coaching ready · ${iv.report.resources.length} verified links`}><Ico s={10} d={<path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z"/>} />{iv.report.resources.length}</span>}
        <span className={`badge py-0 ${open ? 'badge-green' : ''}`}>{open ? 'In progress' : 'Ended'}</span>
      </span>}
      action={<button onClick={onOpen} className={`${open ? 'btn btn-primary' : 'btn-tint btn-blue'} inline-flex items-center justify-center gap-2 py-2.5 text-sm w-full`}>
        {open ? <><Ico d={<path d="m6 3 14 9-14 9V3z"/>} />Continue</> : <><Ico d={<><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></>} />Show</>}
      </button>}>
      <Stats items={[[n, 'answered'], [ok, real(iv) ? 'strong' : 'correct'], [`${avg}/10`, 'avg']]} />
      <div className="h-1.5 rounded-full bg-panel-2 overflow-hidden"><div className={`h-full rounded-full ${avg >= 7 ? 'bg-success' : avg >= 4 ? 'bg-warning' : 'bg-error'}`} style={{ width: `${n ? avg * 10 : 0}%` }} /></div>
      <div className="flex items-center text-xs text-dim"><span>{new Date(iv.at).toLocaleDateString()}</span>{!open && n > 0 && <span className="ml-2">{iv.report ? `· coaching${iv.report.turns !== n ? ' (outdated)' : ''}` : '· no coaching yet'}</span>}<span className="font-mono ml-auto">{fmt(iv.elapsed || 0)}</span></div>
    </Tile>
  )
}

// ---------- one past turn, as shown in the transcript ----------
function Turn({ t, i }) {
  return (
    <div id={`iv-t-${i}`} className="rounded-lg bg-app border border-border p-3 flex flex-col gap-2 scroll-mt-4" dir="auto">
      <div className="flex items-center gap-2 text-xs"><span className={`w-2 h-2 rounded-full ${t.correct ? 'bg-success' : 'bg-error'}`} /><span className="text-dim">Q{i + 1} · {t.rubric || t.topic ? <>{t.followUp && 'follow-up · '}{t.topic || 'open answer'}</> : t.type === 'choice' ? 'multiple choice' : 'open answer'} · {fmt(t.secs || 0)}</span><b className={`ml-auto ${t.correct ? 'text-success' : 'text-error'}`}>{t.score}/10</b></div>
      <div dir={dirOf(t.q)} className="text-sm font-medium text-gray-100">{t.q}</div>
      {t.type === 'choice' && t.choices ? (
        <div className="flex flex-col gap-1">{t.choices.map((c, j) => <div key={j} className={`text-xs px-2.5 py-1.5 rounded-md border flex gap-2 ${j === t.answerIndex ? 'border-success bg-success/10' : j === t.picked ? 'border-error bg-error/10' : 'border-border'}`}><span className="text-dim font-mono">{'ABCD'[j]}</span><span>{c}</span>{j === t.picked && <span className="ml-auto text-[10px] text-dim">your pick</span>}</div>)}</div>
      ) : <div className="text-sm px-3 py-2 rounded-lg bg-accent/10 border border-accent/25 whitespace-pre-wrap">{t.answer || <i className="text-dim">no answer</i>}</div>}
      {t.rubric && <Rubric r={t.rubric} />}
      {t.feedback && <div className="text-xs text-gray-300 border-l-2 border-accent pl-2.5 kb-rich"><Markdown text={t.feedback} /></div>}
    </div>
  )
}
const Rubric = ({ r }) => <div className="flex flex-wrap gap-1.5">{Object.entries(r).map(([k, v]) => <span key={k} className="text-[11px] px-2 py-0.5 rounded-full bg-app border border-border text-dim">{k} <b className={`font-mono ${tone(v)}`}>{v}</b></span>)}</div>

// ---------- details view of an ended interview: statistics, coaching, verified resources, transcript ----------
const tone = v => v >= 7 ? 'text-success' : v >= 4 ? 'text-warning' : 'text-error'
const toneBg = v => v >= 7 ? 'bg-success' : v >= 4 ? 'bg-warning' : 'bg-error'
const jump = i => document.getElementById(`iv-t-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
function statsOf(iv) {
  const T = iv.turns, n = T.length, ok = T.filter(t => t.correct).length, avg = n ? T.reduce((a, t) => a + (t.score || 0), 0) / n : 0
  const split = type => { const L = T.filter(t => t.type === type); return { n: L.length, ok: L.filter(t => t.correct).length } }
  let run = 0, best = 0; for (const t of T) { run = t.correct ? run + 1 : 0; best = Math.max(best, run) }
  const half = Math.floor(n / 2), mean = L => L.length ? L.reduce((a, t) => a + (t.score || 0), 0) / L.length : 0
  const trend = n >= 4 ? mean(T.slice(half)) - mean(T.slice(0, half)) : 0 // second half vs first half, in points
  const timed = T.filter(t => t.secs > 0)
  const crit = {}; for (const t of T) for (const [k, v] of Object.entries(t.rubric || {})) (crit[k] ||= []).push(v)
  return { rubric: Object.entries(crit).map(([k, L]) => [k, L.reduce((a, x) => a + x, 0) / L.length]), followUps: T.filter(t => t.followUp).length, n, ok, avg, pct: n ? Math.round(ok / n * 100) : 0, best, trend, choice: split('choice'), text: split('text'),
    perQ: timed.length ? Math.round(timed.reduce((a, t) => a + t.secs, 0) / timed.length) : 0,
    weakest: T.map((t, i) => ({ t, i })).filter(x => !x.t.correct || x.t.score < 6).sort((a, b) => a.t.score - b.t.score).slice(0, 4) }
}
const Stat = ({ label, value, sub, cls = 'text-white' }) => (
  <div className="rounded-xl bg-app border border-border px-3.5 py-3 min-w-0">
    <div className="text-[10px] uppercase tracking-wider text-dim">{label}</div>
    <div className={`text-2xl font-semibold font-mono tabular-nums mt-0.5 ${cls}`}>{value}</div>
    {sub && <div className="text-[11px] text-dim mt-0.5 truncate">{sub}</div>}
  </div>
)
function Statistics({ iv }) {
  const st = statsOf(iv)
  const ring = 2 * Math.PI * 34
  return (
    <div className="island p-5 flex flex-col gap-5 flex-shrink-0" style={{ animation: 'iv-in .3s ease-out both' }}>
      <div className="flex items-center gap-5 flex-wrap">
        <svg width="84" height="84" viewBox="0 0 84 84" className="flex-shrink-0" role="img" aria-label={`Average score ${st.avg.toFixed(1)} out of 10`}>
          <circle cx="42" cy="42" r="34" fill="none" stroke="rgb(var(--c-border))" strokeWidth="7" />
          <circle cx="42" cy="42" r="34" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeDasharray={ring} strokeDashoffset={ring * (1 - st.avg / 10)} transform="rotate(-90 42 42)" className={tone(st.avg)} style={{ transition: 'stroke-dashoffset .6s' }} />
          <text x="42" y="40" textAnchor="middle" className="fill-white font-mono" fontSize="20" fontWeight="600">{st.avg.toFixed(1)}</text>
          <text x="42" y="56" textAnchor="middle" className="fill-current text-dim" fontSize="10">of 10</text>
        </svg>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-dim">Interview result</div>
          <div className="text-lg font-semibold text-white">{st.ok} of {st.n} {real(iv) ? 'strong answers' : 'correct'} <span className={`font-mono ${tone(st.pct / 10)}`}>· {st.pct}%</span></div>
          <div className="text-xs text-dim mt-0.5">{st.avg >= 7 ? 'Strong session. Use the resources below to go deeper.' : st.avg >= 4 ? 'Decent base with clear gaps. Start with the weakest questions.' : 'This one was hard. Work through the tips and resources, then try again.'}</div>
        </div>
      </div>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
        <Stat label="Total time" value={fmt(iv.elapsed || 0)} sub={st.perQ ? `${fmt(st.perQ)} per answer` : null} />
        <Stat label="Best streak" value={st.best} sub="correct in a row" />
        {real(iv) ? <Stat label="Follow-ups" value={st.followUps} sub={st.followUps ? 'the interviewer dug deeper' : 'answers were complete'} /> : <>
          <Stat label="Multiple choice" value={st.choice.n ? `${st.choice.ok}/${st.choice.n}` : '–'} sub={st.choice.n ? `${Math.round(st.choice.ok / st.choice.n * 100)}% correct` : 'none asked'} />
          <Stat label="Open answers" value={st.text.n ? `${st.text.ok}/${st.text.n}` : '–'} sub={st.text.n ? `${Math.round(st.text.ok / st.text.n * 100)}% correct` : 'none asked'} />
        </>}
        <Stat label="Trend" value={st.n >= 4 ? `${st.trend >= 0 ? '+' : ''}${st.trend.toFixed(1)}` : '–'} sub={st.n >= 4 ? (st.trend > 0.5 ? 'improving as you went' : st.trend < -0.5 ? 'dropped off later' : 'steady') : 'needs 4+ answers'} cls={st.n >= 4 ? (st.trend > 0.5 ? 'text-success' : st.trend < -0.5 ? 'text-error' : 'text-white') : 'text-white'} />
      </div>
      {st.rubric.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-dim mb-2">Rubric · average per criterion</div>
          <div className="flex flex-col gap-2">{st.rubric.sort((a, b) => a[1] - b[1]).map(([k, v]) => (
            <div key={k} className="flex items-center gap-3 text-sm"><span className="w-40 flex-shrink-0 text-gray-200 truncate">{k}</span>
              <div className="flex-1 h-2 rounded-full bg-panel-2 overflow-hidden"><div className={`h-full rounded-full ${toneBg(v)}`} style={{ width: `${v * 10}%` }} /></div>
              <span className={`w-10 text-right font-mono ${tone(v)}`}>{v.toFixed(1)}</span></div>))}
          </div>
        </div>
      )}
      <div>
        <div className="flex items-center text-[10px] uppercase tracking-wider text-dim mb-2"><span>Score per question</span><span className="ml-auto normal-case tracking-normal">click a bar to jump to it</span></div>
        <div className="flex items-end gap-1 h-24 border-b border-border">
          {iv.turns.map((t, i) => (
            <button key={i} onClick={() => jump(i)} title={`Q${i + 1}: ${t.score}/10`} className="group flex-1 max-w-[36px] h-full flex flex-col justify-end items-center gap-1">
              <span className="text-[10px] font-mono text-dim opacity-0 group-hover:opacity-100">{t.score}</span>
              <span className={`w-full rounded-t ${toneBg(t.score)} group-hover:brightness-125 transition-all`} style={{ height: `${Math.max(4, t.score * 10)}%` }} />
            </button>
          ))}
        </div>
        <div className="flex gap-1 mt-1">{iv.turns.map((_, i) => <span key={i} className="flex-1 max-w-[36px] text-center text-[10px] text-dim font-mono">{i + 1}</span>)}</div>
      </div>
      {st.weakest.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-dim mb-2">Review these first</div>
          <div className="flex flex-col gap-1.5">{st.weakest.map(({ t, i }) => (
            <button key={i} onClick={() => jump(i)} dir="auto" className="text-left flex items-center gap-3 px-3 py-2 rounded-lg bg-app border border-border hover:border-accent/50 transition-colors">
              <span className={`font-mono text-sm font-semibold w-10 flex-shrink-0 ${tone(t.score)}`}>{t.score}/10</span>
              <span className="text-sm text-gray-200 truncate">{t.q}</span><span className="ml-auto text-[11px] text-dim flex-shrink-0">Q{i + 1}</span>
            </button>))}
          </div>
        </div>
      )}
    </div>
  )
}

const KINDS = {
  video: ['Videos', <path d="m6 3 14 9-14 9V3z"/>], playlist: ['Playlists', <><path d="M3 6h13"/><path d="M3 12h13"/><path d="M3 18h9"/><path d="m16 15 5 3-5 3z"/></>],
  repo: ['GitHub repositories', <><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="9" r="2.5"/><path d="M6 8.5v7"/><path d="M18 11.5c0 3-4 3-9.5 5"/></>],
  quiz: ['Quizzes and practice', <><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>],
  article: ['Articles', <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></>],
}
function Resource({ r }) {
  return ( // target=_blank: main.js sends new windows to the system browser, so the app itself never navigates away
    <a href={r.url} target="_blank" rel="noreferrer noopener" dir="auto" className="group rounded-xl bg-app border border-border hover:border-accent/60 p-3 flex gap-3 min-w-0 transition-colors">
      <span className="w-9 h-9 rounded-lg bg-accent/15 text-accent grid place-items-center flex-shrink-0"><Ico s={16} d={(KINDS[r.kind] || KINDS.article)[1]} /></span>
      <span className="min-w-0 flex-1 flex flex-col gap-0.5">
        <span className="text-sm font-medium text-white group-hover:text-accent line-clamp-2">{r.title}</span>
        <span className="text-[11px] text-dim truncate">{r.source}{r.stars != null ? ` · ★ ${r.stars.toLocaleString()}` : ''}</span>
        {r.why && <span className="text-xs text-gray-400 mt-0.5 line-clamp-2">{r.why}</span>}
      </span>
      <span className="text-dim group-hover:text-accent flex-shrink-0 self-start"><Ico s={13} d={<><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></>} /></span>
    </a>
  )
}
function Coaching({ rep, url, onReport, stale = '', intro = 'Tips on how to improve, plus YouTube videos, playlists, GitHub repos and quizzes picked for your weak spots. Every link is checked before it is shown.' }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const ctrl = useRef(null); const [secs, setSecs] = useState(0)
  useEffect(() => { if (!busy) return; setSecs(0); const t = setInterval(() => setSecs(x => x + 1), 1000); return () => clearInterval(t) }, [busy])
  useEffect(() => () => ctrl.current?.abort(), [])
  const run = async () => {
    setBusy(true); setErr(''); ctrl.current = new AbortController()
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: ctrl.current.signal }).then(x => x.json().catch(() => ({ error: `${x.status}: the app's server is not running the latest version. Restart Cram.` })))
      if (r.error) setErr(r.error); else onReport(r)
    } catch (e) { if (e.name !== 'AbortError') setErr(e.message) }
    setBusy(false); ctrl.current = null
  }
  const groups = rep ? Object.keys(KINDS).map(k => [k, rep.resources.filter(r => r.kind === k)]).filter(([, L]) => L.length) : []
  if (busy) return (
    <div className="island p-8 flex flex-col items-center gap-4 flex-shrink-0 relative overflow-hidden text-center" style={{ animation: 'iv-in .3s ease-out both' }}>
      <div className="absolute inset-0 pointer-events-none" aria-hidden>{[0, 1, 2].map(i => <div key={i} className="absolute left-1/2 top-12 w-14 h-14 -ml-7 -mt-7 rounded-full border border-accent/40" style={{ animation: `iv-ring 2.4s ease-out ${i * .8}s infinite` }} />)}</div>
      <div className="relative w-12 h-12 mt-1 rounded-2xl bg-accent/15 text-accent grid place-items-center" style={{ animation: 'iv-bob 2s ease-in-out infinite' }}><Ico s={22} d={<><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></>} /></div>
      <div className="relative"><div className="text-sm font-semibold text-white">{secs < 20 ? 'Reading your answers…' : secs < 120 ? 'Searching the web for resources…' : 'Opening every link to confirm it works…'}</div><div className="text-xs text-dim mt-1">Usually two to three minutes · {fmt(secs)}</div></div>
      <button className="relative btn-tint btn-red" onClick={() => ctrl.current?.abort()}><Ico d={<rect x="6" y="6" width="12" height="12" rx="2"/>} />Stop</button>
    </div>
  )
  if (!rep) return (
    <div className="island p-6 flex items-center gap-4 flex-wrap flex-shrink-0">
      <span className="w-11 h-11 rounded-2xl bg-accent/15 text-accent grid place-items-center flex-shrink-0"><Ico s={20} d={<path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z"/>} /></span>
      <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-white">Coaching and learning resources</div><div className="text-xs text-dim mt-0.5">{intro}</div>{err && <div className="text-xs text-error mt-1.5">{err}</div>}</div>
      <button className="btn btn-primary inline-flex items-center gap-1.5" onClick={run}><Ico d={<path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z"/>} />{err ? 'Try again' : 'Get coaching'}</button>
    </div>
  )
  return (
    <>
      <div className="island p-5 flex flex-col gap-4 flex-shrink-0" style={{ animation: 'iv-in .3s ease-out both' }} dir="auto">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-dim">Coach's read</span>
          {rep.level && <span className={`badge py-0 capitalize ${rep.level === 'strong' ? 'badge-green' : rep.level === 'solid' ? 'badge-blue' : rep.level === 'developing' ? 'badge-yellow' : 'badge-red'}`}>{rep.level}</span>}
          {stale && <span className="text-[11px] text-warning">{stale}</span>}
          <button className="ml-auto btn-ghost text-xs inline-flex items-center gap-1" onClick={run} title="Search again and rebuild this report"><Ico s={12} d={<><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></>} />Refresh</button>
        </div>
        {err && <div className="text-xs text-error -mt-2">{err}</div>}
        <p className="text-sm text-gray-200 leading-relaxed">{rep.summary}</p>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {[['What you did well', rep.strengths, 'text-success', <path d="M20 6 9 17l-5-5"/>], ['What to work on', rep.weaknesses, 'text-warning', <><path d="M12 9v4"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="9"/></>]].map(([h, L, c, ic]) => (
            <div key={h} className="rounded-xl bg-app border border-border p-3.5">
              <div className={`text-xs font-semibold mb-2 flex items-center gap-1.5 ${c}`}><Ico s={13} d={ic} />{h}</div>
              {L.length ? <ul className="flex flex-col gap-1.5">{L.map((x, i) => <li key={i} className="text-sm text-gray-300 flex gap-2"><span className="text-dim">•</span><span>{x}</span></li>)}</ul> : <div className="text-xs text-dim">Nothing specific.</div>}
            </div>))}
        </div>
        {rep.tips.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-dim mb-2">How to get better</div>
            <ol className="flex flex-col gap-2">{rep.tips.map((x, i) => <li key={i} className="flex gap-3 text-sm text-gray-200"><span className="w-6 h-6 rounded-full bg-accent/15 text-accent text-xs font-semibold grid place-items-center flex-shrink-0">{i + 1}</span><span className="pt-0.5">{x}</span></li>)}</ol>
          </div>
        )}
      </div>
      <div className="island p-5 flex flex-col gap-4 flex-shrink-0" style={{ animation: 'iv-in .35s ease-out both' }}>
        <div className="flex items-baseline gap-2 flex-wrap"><span className="text-sm font-semibold text-white">Learn more</span><span className="text-xs text-dim">{rep.resources.length} verified link{rep.resources.length === 1 ? '' : 's'}</span></div>
        {groups.length ? groups.map(([k, L]) => (
          <div key={k}>
            <div className="text-[10px] uppercase tracking-wider text-dim mb-2">{KINDS[k][0]} · {L.length}</div>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>{L.map(r => <Resource key={r.url} r={r} />)}</div>
          </div>
        )) : <div className="text-sm text-dim">No links could be verified this time. Try Refresh.</div>}
        <div className="text-[11px] text-dim border-t border-border pt-3">Every link was opened on {new Date(rep.at).toLocaleDateString()} and confirmed to exist. YouTube and GitHub titles come from those sites.{rep.dropped ? ` ${rep.dropped} suggested link${rep.dropped === 1 ? ' was' : 's were'} dropped because they could not be confirmed.` : ''}</div>
      </div>
    </>
  )
}
function Details({ iv, base, setIv }) {
  return (
    <>
      <Statistics iv={iv} />
      <Coaching rep={iv.report} url={`${base}/report`} onReport={setIv} stale={iv.report && iv.report.turns !== iv.turns.length ? `Made after ${iv.report.turns} answers. You have ${iv.turns.length} now.` : ''} />
      <div className="island flex-shrink-0">
        <div className="panel-header">Transcript · {iv.turns.length} question{iv.turns.length === 1 ? '' : 's'}</div>
        <div className="p-2.5 flex flex-col gap-2">{iv.turns.map((t, i) => <Turn key={i} t={t} i={i} />)}</div>
      </div>
    </>
  )
}

// ---------- study-wide coaching: every interview and coding challenge in one study ----------
export function StudyCoach({ studyId, onBack, bar = 'interview' }) {
  const [s, setS] = useState(null); const [err, setErr] = useState('')
  useEffect(() => { api.get(`/api/studies/${studyId}`).then(r => r.error ? setErr(r.error) : setS(r)) }, [studyId])
  if (err) return <Centered><div className="island p-6 text-sm text-error">{err}</div></Centered>
  if (!s) return <div className="h-full grid place-items-center text-xs text-dim">Loading…</div>
  const ivs = (s.interviews || []).filter(i => i.turns?.length), T = ivs.flatMap(i => i.turns), chs = (s.challenges || []).filter(c => c.statement)
  const avg = T.length ? T.reduce((a, t) => a + (t.score || 0), 0) / T.length : 0, ok = T.filter(t => t.correct).length, solved = chs.filter(c => c.status === 'solved').length
  const rep = s.report, stale = rep && (rep.answered !== T.length || rep.challenges !== chs.length) ? `Made after ${rep.answered} answers and ${rep.challenges} challenges. You have ${T.length} and ${chs.length} now.` : ''
  return (
    <div className="h-full flex flex-col gap-2.5 min-h-0">
      <PageBar tool={bar} onBack={onBack}>
        <div className="min-w-0 flex-1 flex items-baseline gap-2"><span className="text-sm font-semibold text-white whitespace-nowrap">Study coaching</span><span className="text-xs text-dim truncate min-w-0">{ivs.length} interview{ivs.length === 1 ? '' : 's'} · {T.length} answers · {chs.length} coding challenge{chs.length === 1 ? '' : 's'}</span></div>
      </PageBar>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2.5 pt-2.5">
        <div className="island p-5 flex flex-col gap-4 flex-shrink-0" style={{ animation: 'iv-in .3s ease-out both' }}>
          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
            <Stat label="Average score" value={T.length ? avg.toFixed(1) : '–'} sub="out of 10, all interviews" cls={T.length ? tone(avg) : 'text-white'} />
            <Stat label="Correct" value={T.length ? `${ok}/${T.length}` : '–'} sub={T.length ? `${Math.round(ok / T.length * 100)}% of answers` : 'no interviews yet'} />
            <Stat label="Interviews" value={ivs.length} sub={`${ivs.filter(i => i.status === 'ended').length} ended`} />
            <Stat label="Coding challenges" value={chs.length ? `${solved}/${chs.length}` : '–'} sub={chs.length ? 'solved' : 'none yet'} />
          </div>
          {ivs.length > 1 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-dim mb-2">Average score per interview, oldest first</div>
              <div className="flex items-end gap-1.5 h-20 border-b border-border">{ivs.map(i => { const a = i.turns.reduce((x, t) => x + (t.score || 0), 0) / i.turns.length; return <span key={i.id} title={`${new Date(i.at).toLocaleDateString()} · ${i.difficulty} · ${a.toFixed(1)}/10`} className={`flex-1 max-w-[40px] rounded-t ${toneBg(a)}`} style={{ height: `${Math.max(4, a * 10)}%` }} /> })}</div>
            </div>
          )}
        </div>
        <Coaching rep={rep} url={`/api/studies/${s.id}/report`} onReport={r => setS(x => ({ ...x, report: r.report }))} stale={stale}
          intro="Looks across every interview and coding challenge in this study for weak topics that keep coming back, then finds videos, playlists, GitHub repos and quizzes for them. Every link is checked before it is shown." />
      </div>
    </div>
  )
}

// ---------- session: a live, spoken interview laid out as a chat; ended sessions show the details view ----------
const SPEAK = <><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></>
const Dots = () => <span className="inline-flex gap-1 py-1">{[0, 1, 2].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-accent" style={{ animation: `iv-dot 1.2s ease-in-out ${i * .2}s infinite` }} />)}</span>
const Avatar = ({ me }) => <span className={`w-8 h-8 rounded-full grid place-items-center flex-shrink-0 text-xs font-semibold ${me ? 'bg-accent/20 text-accent' : 'bg-panel-2 text-gray-200 border border-border'}`}>{me ? 'You' : <Ico s={15} d={MIC} />}</span>
// one interviewer message; `text` may be partly revealed while it is spoken
function AskBubble({ text, full, choices, picked, answerIndex, onPick, busy, speaking, onSpeak, tag }) {
  const dir = dirOf(full)
  return (
    <div className="flex gap-2.5 items-start max-w-[85%]" style={{ animation: 'iv-in .25s ease-out both' }}>
      <Avatar />
      <div className="min-w-0 flex flex-col gap-1.5">
        {tag}
        <div dir={dir} className="rounded-2xl rounded-tl-md bg-panel border border-border px-4 py-3 text-[15px] leading-relaxed text-white whitespace-pre-wrap">
          {text || <Dots />}{text && text.length < full.length && <span className="inline-block w-0.5 h-4 bg-accent align-middle ml-0.5 animate-pulse" />}
        </div>
        {choices && text.length >= full.length && <div dir={dir} className="flex flex-col gap-1.5">{choices.map((c, j) => (
          <button key={j} disabled={busy || !onPick} onClick={() => onPick?.(j)} className={`text-start text-sm px-3 py-2 rounded-lg border bg-app flex gap-2.5 transition-colors ${j === answerIndex ? 'border-success bg-success/10' : j === picked ? (answerIndex == null ? 'border-accent bg-accent/10' : 'border-error bg-error/10') : onPick ? 'border-border hover:border-accent/50' : 'border-border opacity-60'}`}>
            <span className="text-dim font-mono text-xs pt-0.5">{'ABCD'[j]}</span><span>{c}</span></button>))}</div>}
        {text && text.length >= full.length && <button onClick={onSpeak} className="self-start text-[11px] text-dim hover:text-white inline-flex items-center gap-1" title="Hear it again">
          {speaking === 'loading' ? <><Spin />Loading voice…</> : speaking === 'playing' ? <><span className="text-accent"><Ico s={12} d={SPEAK} /></span>Speaking… · stop</> : <><Ico s={12} d={SPEAK} />Play</>}</button>}
      </div>
    </div>
  )
}
function AnswerBubble({ t }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex gap-2.5 items-start max-w-[85%] self-end flex-row-reverse" style={{ animation: 'iv-in .25s ease-out both' }}>
      <Avatar me />
      <div className="min-w-0 flex flex-col gap-1.5 items-end">
        <div dir={dirOf(t.answer)} className="rounded-2xl rounded-tr-md bg-accent/12 border border-accent/30 px-4 py-3 text-[15px] leading-relaxed text-gray-100 whitespace-pre-wrap">{t.answer || <i className="text-dim">no answer</i>}</div>
        {t.feedback != null && <button onClick={() => setOpen(v => !v)} className="text-[11px] text-dim hover:text-white inline-flex items-center gap-1.5">
          <b className={`font-mono ${tone(t.score)}`}>{t.score}/10</b>{open ? 'Hide feedback' : 'Feedback'}<Ico s={11} d={<path d={open ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6'} />} /></button>}
        {open && <div dir={dirOf(t.feedback)} className="rounded-xl bg-app border border-border p-3 flex flex-col gap-2 text-sm text-gray-300 kb-rich w-full">{t.rubric && <Rubric r={t.rubric} />}<Markdown text={t.feedback} /></div>}
      </div>
    </div>
  )
}
const MIC_LABEL = { loading: 'Starting the mic…', listening: 'Listening…', speaking: 'Hearing you…', transcribing: 'Writing it down…' }

function Session({ study, iv, setIv, onBack, bar }) {
  const [draft, setDraft] = useState(''); const [busy, setBusy] = useState(false); const [preparing, setPreparing] = useState(false)
  const [elapsed, setElapsed] = useState(iv.elapsed || 0); const [qStart, setQStart] = useState(iv.elapsed || 0); const [err, setErr] = useState('')
  const [voice, setVoice] = useState(() => localStorage.getItem('cram:voice-interview') !== '0') // interviewer speaks + mic opens after each question
  const [shown, setShown] = useState(null) // { q, n }: how much of the pending question is on screen
  const [speaking, setSpeaking] = useState(null) // { key, phase: 'loading' | 'playing' }
  const [sendIn, setSendIn] = useState(0); const manual = useRef(false) // voice answers send themselves after a quiet moment, unless you start typing
  const nextReq = useRef(null); const end = useRef(); const box = useRef()
  const base = `/api/studies/${study.id}/interviews/${iv.id}`; const open = iv.status === 'open'; const { n, ok, avg } = stats(iv); const q = iv.pending
  useEffect(() => { if (!open) return; const t = setInterval(() => { if (!document.hidden) setElapsed(e => e + 1) }, 1000); return () => clearInterval(t) }, [open])
  useEffect(() => { if (elapsed && elapsed % 10 === 0) api.post(base, { elapsed }) }, [elapsed]) // eslint-disable-line
  const ref = useRef(); ref.current = { elapsed, open, iv, draft, busy }
  useEffect(() => () => { const { elapsed, open, iv } = ref.current; if (open) { api.post(base, { elapsed }); setIv({ ...iv, elapsed }) } }, []) // eslint-disable-line -- keep the timer when switching away

  const mic = useMic({
    lang: iv.language,
    onText: t => { setDraft(d => (d ? `${d} ${t}` : t)); setErr('') },
    onSpeechStart: () => { setSendIn(0); if (speaking) stopSpeech() },
    onError: setErr,
  })
  // say a message aloud and follow it with the text; resolves when it has been said
  const say = async (key, text, onReveal) => {
    setSpeaking({ key, phase: 'loading' })
    let raf = 0
    const follow = () => { onReveal?.(Math.min(text.length, Math.ceil(speechProgress(text.length * 0.07) * text.length * 1.08) + 1)); raf = requestAnimationFrame(follow) }
    const r = await speak(text, iv.language, () => { setSpeaking({ key, phase: 'playing' }); if (onReveal) follow() })
    cancelAnimationFrame(raf); setSpeaking(s => s?.key === key ? null : s)
    return r
  }
  const typeOut = (text, onReveal) => new Promise(res => { let i = 0; const t = setInterval(() => { i += 2; onReveal(Math.min(text.length, i)); if (i >= text.length) { clearInterval(t); res() } }, 22) })

  // a new question: speak it while the text streams in, then open the mic
  useEffect(() => {
    if (!open || !q || preparing) return
    let live = true; manual.current = false; setDraft(''); setSendIn(0)
    const reveal = k => live && setShown({ q: q.q, n: k })
    const spoken = [q.q, ...(q.choices || []).map((c, j) => `${'ABCD'[j]}. ${c}`)].join('. ')
    ;(async () => {
      reveal(0)
      const r = voice ? await say('q', spoken, k => reveal(Math.min(q.q.length, k))) : null
      if (!live) return
      if (r !== 'played') await typeOut(q.q, reveal) // voice off, stopped or unavailable: stream the text on its own
      if (!live) return
      reveal(q.q.length); setQStart(ref.current.elapsed)
      if (voice && !q.choices) mic.start()
    })()
    return () => { live = false }
  }, [q?.q, preparing, open]) // eslint-disable-line
  useEffect(() => () => stopSpeech(), [])
  const full = !!q && shown?.q === q.q && shown.n >= q.q.length

  const submit = async (answer = draft.trim(), picked = null) => {
    if (busy || !q) return
    if (!answer && !await ask({ title: 'Submit without an answer?', body: 'It will be graded as a blank answer.', ok: 'Submit anyway', danger: false })) return
    mic.stop(); stopSpeech(); setSendIn(0); setBusy(true); setErr('')
    const r = await api.post(`${base}/answer`, { answer, picked, secs: elapsed - qStart, elapsed })
    setBusy(false)
    if (r.error) { setErr(r.error); return }
    setDraft(''); setIv({ ...r, elapsed })
    nextReq.current = api.post(`${base}/next`, {}); next()
  }
  const next = async () => {
    setPreparing(true)
    const r = await (nextReq.current || api.post(`${base}/next`, {})); nextReq.current = null; setPreparing(false)
    if (r.error) return setErr(r.error)
    setIv({ ...r, elapsed: ref.current.elapsed })
  }
  // a resumed session with no pending question (graded, then closed) needs one
  useEffect(() => { if (open && !iv.pending && !preparing) next() }, [open]) // eslint-disable-line
  // voice answers: once there is a real answer (a few words), 5 quiet seconds send it; talking again cancels, so thinking pauses are safe
  useEffect(() => {
    if (!voice || manual.current || draft.trim().split(/\s+/).length < 3 || busy || mic.state !== 'listening') return setSendIn(0)
    let left = 5; setSendIn(left)
    const t = setInterval(() => { left--; setSendIn(left); if (left <= 0) { clearInterval(t); submit(ref.current.draft.trim()) } }, 1000)
    return () => clearInterval(t)
  }, [draft, mic.state, voice, busy]) // eslint-disable-line
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [n, shown?.n, preparing, busy, draft])

  const setStatus = status => { api.post(base, { status, elapsed }); setIv({ ...iv, status, elapsed }) }
  const finish = async () => { if (await ask({ title: 'End this interview?', body: 'You can resume it any time from the list. Your answers and score are kept.', ok: 'End interview' })) { mic.stop(); stopSpeech(); setStatus('ended') } }
  const toggleVoice = () => { const v = !voice; setVoice(v); localStorage.setItem('cram:voice-interview', v ? '1' : '0'); if (!v) { stopSpeech(); mic.stop() } else fetch('/api/transcribe').catch(() => {}) }
  useEffect(() => { if (voice && open) fetch('/api/transcribe').catch(() => {}) }, []) // eslint-disable-line -- warm the recognizer up
  const replay = (key, text) => speaking?.key === key ? stopSpeech() : (mic.stop(), say(key, text))
  const tagOf = t => (t.followUp || t.topic) && <div className="text-[11px] text-dim">{t.followUp && <span className="badge-purple py-0 me-1.5">follow-up</span>}{t.topic}</div>

  return (
    <div className="h-full flex flex-col min-h-0">
      <PageBar tool={bar} onBack={onBack}>
        <div className="min-w-0 flex-1 flex items-baseline gap-2">{real(iv)
          ? <span className="text-sm font-semibold text-white whitespace-nowrap">{roundName(iv.round)} round <span className="text-dim font-normal">· {iv.seniority} {iv.role}</span></span>
          : <span className="text-sm font-semibold text-white capitalize whitespace-nowrap">{iv.difficulty} interview <span className="text-dim font-normal normal-case">· {iv.language}</span></span>}
          <span className="text-xs text-dim truncate min-w-0">{n} answered · {ok} {real(iv) ? 'strong' : 'correct'} · avg {avg}/10</span></div>
        <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-app border border-border leading-tight">
          <div className="font-mono text-base text-white tabular-nums flex items-center gap-1.5">{fmt(elapsed)}{open && <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />}</div>
          <div className={`text-[10px] uppercase tracking-wider ${open ? 'text-accent' : 'text-dim'}`}>{open ? 'running' : 'ended'}</div>
        </div>
        {open && <button onClick={toggleVoice} className={`btn-tint ${voice ? 'btn-purple' : ''}`} title="The interviewer speaks each question and the mic opens for your answer">
          {speaking?.phase === 'loading' ? <Spin /> : <Ico d={SPEAK} />}{voice ? 'Voice on' : 'Voice off'}</button>}
        {open ? <button onClick={finish} className="btn-tint btn-red" disabled={busy}><Ico d={<rect x="6" y="6" width="12" height="12" rx="2"/>} />End</button>
          : <button onClick={() => setStatus('open')} className="btn-tint btn-green"><Ico d={<path d="m6 3 14 9-14 9V3z"/>} />Resume</button>}
      </PageBar>
      {!open ? (
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2.5 pt-2.5">
          {n ? <Details iv={iv} base={base} setIv={setIv} /> : <div className="island p-5 text-sm text-dim text-center">No questions answered yet. Resume to get the first one.</div>}
        </div>
      ) : <>
        <div ref={box} className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-5">
            {iv.turns.map((t, i) => <React.Fragment key={i}>
              <AskBubble text={t.q} full={t.q} choices={t.type === 'choice' ? t.choices : null} picked={t.picked} answerIndex={t.answerIndex} tag={tagOf(t)} speaking={speaking?.key === `t${i}` && speaking.phase} onSpeak={() => replay(`t${i}`, t.q)} />
              <AnswerBubble t={t} />
            </React.Fragment>)}
            {busy && <div className="self-end text-[11px] text-dim inline-flex items-center gap-1.5"><Spin />The interviewer is taking notes…</div>}
            {preparing && !busy && <AskBubble text="" full="." />}
            {q && !preparing && <AskBubble text={shown?.q === q.q ? q.q.slice(0, shown.n) : ''} full={q.q} choices={q.type === 'choice' ? q.choices : null} onPick={j => submit(`${'ABCD'[j]}. ${q.choices[j]}`, j)} busy={busy}
              tag={tagOf(q)} speaking={speaking?.key === 'q' && speaking.phase} onSpeak={() => replay('q', q.q)} />}
            <div ref={end} />
          </div>
        </div>
        <div className="border-t border-border bg-panel px-4 py-3 flex-shrink-0">
          <div className="max-w-3xl mx-auto flex flex-col gap-2">
            {(err || mic.on || sendIn > 0) && <div className="flex items-center gap-2 text-[11px] min-h-[16px]">
              {mic.on && <span className={`inline-flex items-center gap-1.5 ${mic.state === 'speaking' ? 'text-accent' : 'text-dim'}`}>{mic.state === 'loading' || mic.state === 'transcribing' ? <Spin /> : <span className={`w-2 h-2 rounded-full ${mic.state === 'speaking' ? 'bg-accent animate-pulse' : 'bg-success'}`} />}{MIC_LABEL[mic.state]}</span>}
              {sendIn > 0 && <span className="text-dim">· sending in {sendIn}s, keep talking to add more</span>}
              {err && <span className="text-error truncate">{err}</span>}
            </div>}
            <div className="flex items-end gap-2.5">
              <button onClick={() => (mic.on ? mic.stop() : (stopSpeech(), mic.start()))} disabled={busy || !q || !full} title={mic.on ? 'Stop the mic' : 'Answer by voice'} aria-label={mic.on ? 'Stop the mic' : 'Answer by voice'}
                className={`relative w-11 h-11 rounded-full grid place-items-center flex-shrink-0 transition-colors ${mic.on ? 'bg-accent text-app' : 'bg-app border border-border text-dim hover:text-white'}`}>
                {mic.state === 'speaking' && <span className="absolute inset-0 rounded-full border-2 border-accent" style={{ animation: 'iv-ring 1.2s ease-out infinite' }} />}
                {mic.state === 'loading' ? <Spin /> : <Ico s={18} d={MIC} />}
              </button>
              <textarea dir="auto" rows={5} className="input flex-1 resize-y min-h-[140px] max-h-[45vh] text-[15px] leading-relaxed" placeholder={!q || !full ? 'Wait for the question…' : voice ? 'Speak your answer, or type it… (Ctrl+Enter to send)' : 'Type your answer… (Ctrl+Enter to send)'}
                value={draft} disabled={busy || !q} onChange={e => { manual.current = true; setSendIn(0); setDraft(e.target.value) }} onKeyDown={e => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && submit()} />
              <button className="btn btn-primary h-11 inline-flex items-center gap-1.5" disabled={busy || !q || !full} onClick={() => submit()}>{busy ? <Spin /> : <>Send<Ico d={<path d="m9 18 6-6-6-6"/>} /></>}</button>
            </div>
          </div>
        </div>
      </>}
    </div>
  )
}

// scope: GENERAL = the generic page (real interview rounds); a study id = inside that study's workspace (exam on its material)
export default function Interview({ studies, scope = GENERAL, bar = 'interview', onOpenTool }) {
  const { list, update: setIv, add, remove } = useSessions('interviews', studies, scope)
  const [sel, setSel] = useState(null) // null = cards, 'new' = hero, id = session
  const [busy, setBusy] = useState(false)
  const active = list?.find(i => i.id === sel)
  const start = async opts => {
    setBusy(true); const iv = await api.post(`/api/studies/${scope}/interviews`, opts); setBusy(false)
    if (iv.error) return alert(iv.error); add(iv, scope); setSel(iv.id)
  }
  const del = async iv => {
    if (!await ask({ title: `Delete this ${real(iv) ? roundName(iv.round).toLowerCase() : iv.difficulty} interview?`, body: 'Its questions, answers and score are removed.', ok: 'Delete' })) return
    await api.del(`/api/studies/${iv.studyId}/interviews/${iv.id}`); remove(iv.id); if (sel === iv.id) setSel(null)
  }
  const css = (
      <style>{`
        @keyframes iv-breathe { 0%,100% { transform: translate(-50%, 0) scale(1); opacity: .6 } 50% { transform: translate(-50%, 8px) scale(1.12); opacity: 1 } }
        @keyframes iv-ring { 0% { transform: scale(1); opacity: .7 } 100% { transform: scale(3.2); opacity: 0 } }
        @keyframes iv-eq { from { transform: scaleY(.25) } to { transform: scaleY(1) } }
        @keyframes iv-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
        @keyframes iv-pulse { 0% { box-shadow: 0 0 0 0 rgb(var(--c-accent) / .55) } 70% { box-shadow: 0 0 0 14px rgb(var(--c-accent) / 0) } 100% { box-shadow: 0 0 0 0 rgb(var(--c-accent) / 0) } }
        @keyframes iv-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
        @keyframes iv-dot { 0%,100% { opacity: .25; transform: translateY(0) } 50% { opacity: 1; transform: translateY(-4px) } }
      `}</style>
  )
  if (!list) return <div className="h-full grid place-items-center text-xs text-dim">Loading…</div>
  if (active) return <>{css}<Session key={active.id} study={{ id: scope }} iv={active} setIv={setIv} onBack={() => setSel(null)} bar={bar} /></>
  if (!list.length || sel === 'new') return <>{css}<Centered wide={scope === GENERAL}>
    {list.length > 0 && <button onClick={() => setSel(null)} className="btn-ghost text-xs inline-flex items-center gap-1 mb-2"><Ico d={<path d="m15 18-6-6 6-6"/>} />Back to interviews</button>}
    {scope === GENERAL ? <RealHero busy={busy} onStart={start} onCoding={() => onOpenTool?.(null, 'code')} /> : <Hero busy={busy} onStart={start} />}
  </Centered></>
  return <>{css}<Grid onNew={() => setSel('new')} newLabel={scope === GENERAL ? 'New mock interview' : 'New interview'}>{list.map(iv => <Card key={iv.id} iv={iv} onOpen={() => setSel(iv.id)} onDelete={() => del(iv)} />)}</Grid></>
}
