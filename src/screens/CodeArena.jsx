import React, { useState, useEffect, useRef, useMemo } from 'react'
import Markdown from '../components/Markdown.jsx'
import hljs from 'highlight.js/lib/common'
import 'highlight.js/styles/github-dark.css'
import { api } from '../api.js'
import Wait from '../components/Wait.jsx'
import { ask } from '../components/Confirm.jsx'
import { Centered, useSessions, GENERAL, PageBar, Grid, Tile, Stats } from '../components/SessionList.jsx'

const Ico = ({ d, s = 14 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
const Spin = () => <span className="inline-block w-3.5 h-3.5 border-2 border-border border-t-accent rounded-full animate-spin align-middle" />
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
// id must match server LANGS. [id, label, short badge, badge color, file ext]
export const LANGS = [
  ['javascript', 'JavaScript', 'JS', '#f7df1e', 'js'], ['typescript', 'TypeScript', 'TS', '#3178c6', 'ts'], ['python', 'Python', 'Py', '#3776ab', 'py'],
  ['java', 'Java', 'Jv', '#e76f00', 'java'], ['cpp', 'C++', 'C++', '#00599c', 'cpp'], ['rust', 'Rust', 'Rs', '#dea584', 'rs'], ['csharp', 'C#', 'C#', '#512bd4', 'cs'], ['php', 'PHP', 'php', '#777bb4', 'php'],
]
const langOf = id => LANGS.find(l => l[0] === id) || LANGS[0]
const GLYPHS = ['{ }', '=>', 'O(n)', '[ ]', 'fn', '&&', '::', '//', 'λ', '0x', '</>', 'if', '∑', '++', '?:', 'ret']

// ---------- hero: floating glyph field + start card (whole page when the study has no challenges yet) ----------
function Hero({ onStart, busy, general, topic0 = '' }) {
  const [lang, setLang] = useState('javascript'); const [d, setD] = useState('medium'); const [topic, setTopic] = useState(topic0)
  const start = () => onStart({ language: lang, difficulty: d, topic })
  const glyphs = useMemo(() => GLYPHS.map((g, i) => ({ g, x: (i * 37) % 100, y: (i * 53) % 100, dur: 6 + (i % 5) * 1.5, delay: -(i * 0.7), size: 11 + (i % 4) * 3 })), [])
  return (
    <div className="flex flex-col gap-2.5">
      <div className="island relative overflow-hidden flex-shrink-0" style={{ minHeight: 340 }}>
        <div className="absolute inset-0 pointer-events-none select-none" aria-hidden>
          {glyphs.map((p, i) => <span key={i} className="absolute font-mono text-accent/25" style={{ left: `${p.x}%`, top: `${p.y}%`, fontSize: p.size, animation: `arena-float ${p.dur}s ease-in-out ${p.delay}s infinite` }}>{p.g}</span>)}
          <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[520px] h-[320px] rounded-full bg-accent/10 blur-3xl" style={{ animation: 'arena-breathe 5s ease-in-out infinite' }} />
        </div>
        <div className="relative z-10 flex flex-col items-center text-center px-6 py-10 gap-4">
          <div className="w-14 h-14 rounded-2xl bg-accent/15 text-accent grid place-items-center" style={{ animation: 'arena-bob 3s ease-in-out infinite' }}><Ico s={26} d={<><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></>} /></div>
          <div>
            <h2 className="text-xl font-semibold text-white">Ready for a challenge?</h2>
            <p className="text-sm text-dim mt-1 max-w-md">{general ? 'One interview-style coding problem on the topic you pick, or a classic one if you leave it empty.' : 'One HackerRank-style problem built from your study material.'} Timer runs, tests are hidden until you run them, and a coach sits beside you.</p>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5 w-full max-w-2xl">
            {LANGS.map(([v, l, badge, color]) => (
              <button key={v} onClick={() => setLang(v)} className={`relative flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-xl border transition-all ${lang === v ? 'border-accent bg-accent/10 shadow-[0_0_0_3px_rgb(var(--c-accent)/.15)]' : 'border-border bg-app/60 hover:border-gray-500 hover:-translate-y-0.5'}`}>
                <span className="w-9 h-9 rounded-lg grid place-items-center font-mono font-bold text-[12px] text-black" style={{ background: color }}>{badge}</span>
                <span className={`text-[11px] ${lang === v ? 'text-white' : 'text-dim'}`}>{l}</span>
                {lang === v && <span className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-accent text-app grid place-items-center"><Ico s={9} d={<path d="M20 6 9 17l-5-5"/>} /></span>}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <div className="flex gap-0.5 bg-app border border-border rounded-lg p-0.5">{['easy', 'medium', 'hard'].map(v => <button key={v} onClick={() => setD(v)} className={`text-xs px-3 py-1.5 rounded-md capitalize ${d === v ? 'bg-panel-2 text-white' : 'text-dim hover:text-white'}`}>{v}</button>)}</div>
            <input className="input w-64" placeholder={general ? 'Topic, e.g. sliding window, graphs' : 'Focus topic (optional)'} value={topic} onChange={e => setTopic(e.target.value)} onKeyDown={e => e.key === 'Enter' && start()} />
          </div>
          <button disabled={busy} onClick={start} className="btn btn-primary flex flex-col items-center justify-center gap-1 w-32 h-20 text-base rounded-2xl" style={busy ? undefined : { animation: 'arena-pulse 2.4s ease-out infinite' }}>
            {busy ? <span className="text-xs flex flex-col items-center gap-0.5"><Wait label="Building…" /></span> : <><Ico s={26} d={<path d="m6 3 14 9-14 9V3z"/>} /><span>Start</span></>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- grid card: tests passed + Continue / Show ----------
const dotOf = c => c.status === 'solved' ? 'bg-success' : c.status === 'given-up' ? 'bg-error' : 'bg-warning'
function Card({ c, onOpen, onDelete }) {
  const open = c.status === 'open'
  return (
    <Tile dot={dotOf(c)} title={c.title} sub={langOf(c.language)[1]} study={c.topic || ''} onDelete={onDelete}
      badge={<span className={`badge py-0 ${c.status === 'solved' ? 'badge-green' : c.status === 'given-up' ? 'badge-red' : 'badge-yellow'}`}>{c.status === 'solved' ? 'Solved' : c.status === 'given-up' ? 'Given up' : 'Open'}</span>}
      action={<button disabled={!c.statement} onClick={onOpen} className={`${open ? 'btn btn-primary' : 'btn-tint btn-blue'} inline-flex items-center justify-center gap-2 py-2.5 text-sm w-full`}>
        {open ? <><Ico d={<path d="m6 3 14 9-14 9V3z"/>} />Continue</> : <><Ico d={<><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></>} />Show</>}
      </button>}>
      <Stats items={[[`${c.passed ?? '–'}/${c.total}`, 'tests'], [c.difficulty, 'level'], [fmt(c.elapsed || 0), 'time']]} />
      <div className="h-1.5 rounded-full bg-panel-2 overflow-hidden"><div className={`h-full rounded-full ${dotOf(c)}`} style={{ width: `${c.total ? (c.passed || 0) / c.total * 100 : 0}%` }} /></div>
      <div className="flex items-center text-xs text-dim"><span>{new Date(c.at).toLocaleDateString()}</span><span className="ml-auto">target {c.limitMin || 30} min</span></div>
    </Tile>
  )
}

// ---------- timer ring ----------
function Timer({ elapsed, limitMin, status }) {
  const limit = limitMin * 60, over = elapsed > limit, pct = Math.min(1, elapsed / limit)
  const r = 15, C = 2 * Math.PI * r
  const color = status === 'solved' ? 'rgb(var(--c-success))' : over ? 'rgb(var(--c-error))' : pct > .75 ? 'rgb(var(--c-warning))' : 'rgb(var(--c-accent))'
  return (
    <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-app border border-border">
      <svg width="38" height="38" viewBox="0 0 38 38" className="-rotate-90"><circle cx="19" cy="19" r={r} fill="none" stroke="rgb(var(--c-border))" strokeWidth="3" /><circle cx="19" cy="19" r={r} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} style={{ transition: 'stroke-dashoffset .5s, stroke .5s' }} /></svg>
      <div className="leading-tight">
        <div className="font-mono text-base text-white tabular-nums flex items-center gap-1.5">{fmt(elapsed)}{status === 'open' && <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />}</div>
        <div className="text-[10px] uppercase tracking-wider" style={{ color }}>{status === 'solved' ? 'Solved' : status === 'given-up' ? 'Given up' : over ? `${fmt(elapsed - limit)} over` : `target ${limitMin} min`}</div>
      </div>
    </div>
  )
}

// ---------- coach chat ----------
function Coach({ study, ch, code, results, onChat }) {
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [live, setLive] = useState(null); const end = useRef(); const ctrl = useRef(null)
  const msgs = live ? [...ch.chat, ...live] : ch.chat
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs])
  useEffect(() => () => ctrl.current?.abort(), []) // leaving the arena stops a running answer
  const send = async (q = text.trim()) => {
    if (!q || busy) return; setText(''); setBusy(true); setLive([{ role: 'user', content: q }, { role: 'assistant', content: '' }]); ctrl.current = new AbortController()
    const t = await api.stream(`/api/studies/${study.id}/challenge/${ch.id}/chat`, { message: q, code, results }, x => setLive([{ role: 'user', content: q }, { role: 'assistant', content: x }]), ctrl.current.signal)
    onChat([...ch.chat, { role: 'user', content: q }, { role: 'assistant', content: t || '*(stopped)*' }]); setLive(null); setBusy(false); ctrl.current = null
  }
  const quick = ['Give me a hint', 'Why does my test fail?', 'Is my approach efficient?', 'Explain the problem differently']
  return (
    <div className="island flex flex-col min-h-0 h-full">
      <div className="panel-header flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-success" />Coach<span className="ml-auto normal-case tracking-normal font-normal text-[10px] text-dim">sees your code</span></div>
      <div className="flex-1 overflow-y-auto p-2.5 flex flex-col gap-2">
        {!msgs.length && <div className="text-xs text-dim m-auto text-center px-4">Stuck? Ask for a hint. I won't hand over the solution unless you ask for it.</div>}
        {msgs.map((m, i) => <div key={i} dir="auto" className={`text-[13px] px-3 py-2 rounded-lg border max-w-[95%] ${m.role === 'user' ? 'self-end bg-accent/10 border-accent/25 whitespace-pre-wrap' : 'self-start bg-app border-border kb-rich'}`}>{m.role === 'user' ? m.content : m.content ? <Markdown text={m.content} /> : <Spin />}</div>)}
        <div ref={end} />
      </div>
      <div className="p-2 border-t border-border flex flex-col gap-1.5">
        <div className="flex gap-1 flex-wrap">{quick.map(q => <button key={q} disabled={busy} onClick={() => send(q)} className="text-[11px] px-2 py-1 rounded-md border border-border text-dim hover:text-white hover:border-accent/50">{q}</button>)}</div>
        <div className="flex gap-1.5"><input dir="auto" className="input flex-1" placeholder="Ask the coach…" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} />{busy ? <button className="btn-tint btn-red px-3" onClick={() => ctrl.current?.abort()} title="Stop generating" aria-label="Stop generating"><Ico d={<rect x="6" y="6" width="12" height="12" rx="2"/>} /></button> : <button className="btn btn-primary px-3" onClick={() => send()}><Ico d={<><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>} /></button>}</div>
      </div>
    </div>
  )
}

// ---------- arena ----------
function Arena({ study, ch, setCh, onBack, onNext, bar }) {
  const [code, setCode] = useState(ch.code || ch.starter); const [res, setRes] = useState(null); const [running, setRunning] = useState(false)
  const [review, setReview] = useState(''); const [reviewing, setReviewing] = useState(false); const [elapsed, setElapsed] = useState(ch.elapsed || 0); const [showCoach, setShowCoach] = useState(true)
  const base = `/api/studies/${study.id}/challenge/${ch.id}`
  const patch = body => { api.post(base, body); setCh({ ...ch, ...body }) }
  // timer: ticks while open and the window is visible
  useEffect(() => { if (ch.status !== 'open') return; const t = setInterval(() => { if (!document.hidden) setElapsed(e => e + 1) }, 1000); return () => clearInterval(t) }, [ch.status])
  useEffect(() => { if (elapsed && elapsed % 10 === 0) api.post(base, { elapsed }) }, [elapsed]) // eslint-disable-line
  useEffect(() => { const t = setTimeout(() => code !== ch.code && api.post(base, { code }), 800); return () => clearTimeout(t) }, [code]) // eslint-disable-line
  const ref = useRef(); ref.current = { elapsed, code, ch }
  useEffect(() => () => { const { elapsed, code, ch } = ref.current; if (ch.status === 'open') { api.post(base, { elapsed, code }); setCh({ ...ch, elapsed, code }) } }, []) // eslint-disable-line -- keep timer + code when switching away
  const [panel, setPanel] = useState(null); const reviewCtl = useRef() // 'tests' | 'review' | null
  const closePanel = () => { reviewCtl.current?.abort(); setPanel(null) }
  const run = async () => {
    closePanel(); setPanel('tests'); setRunning(true); const r = await api.post('/api/run', { language: ch.language, code, tests: ch.tests }); setRunning(false); if (r.error) return alert(r.error)
    setRes(r); const solved = r.passed === r.results.length
    patch({ code, elapsed, passed: r.passed, ...(solved && ch.status === 'open' ? { status: 'solved' } : {}) })
  }
  const getReview = async () => { closePanel(); setPanel('review'); const c = reviewCtl.current = new AbortController(); setReviewing(true); setReview(''); await api.stream(`${base}/review`, { code, results: res }, setReview, c.signal); setReviewing(false) }
  const [nexting, setNexting] = useState(false)
  const next = async () => { setNexting(true); const n = await api.post(`${base}/next`, { code, results: res }); setNexting(false); if (n.error) return alert(n.error); onNext(n) }
  const cleared = ch.status === 'solved' || (res && res.passed === res.results.length)
  const giveUp = async () => { if (await ask({ title: 'Give up on this one?', body: 'The timer stops and the challenge stays in your list as given up. You can still ask the coach or get a review.', ok: 'Give up' })) patch({ status: 'given-up', elapsed, code }) }
  const hl = useRef(), qRef = useRef()
  // colour fenced code in the question with the challenge's language (Markdown renders plain <pre><code>)
  useEffect(() => { qRef.current?.querySelectorAll('pre code:not(.hljs)').forEach(el => { el.innerHTML = hljs.highlight(el.textContent, { language: hljs.getLanguage(ch.language) ? ch.language : 'plaintext', ignoreIllegals: true }).value; el.classList.add('hljs') }) }, [ch.statement, ch.language])
  // ponytail: re-highlights the whole file per keystroke; fine for challenge-sized code, a real editor (CodeMirror) if files get large
  const painted = useMemo(() => hljs.highlight(code + '\n', { language: hljs.getLanguage(ch.language) ? ch.language : 'plaintext', ignoreIllegals: true }).value, [code, ch.language])
  const tab = e => { if (e.key === 'Tab') { e.preventDefault(); const t = e.target, s = t.selectionStart; setCode(code.slice(0, s) + '    ' + code.slice(t.selectionEnd)); requestAnimationFrame(() => t.selectionStart = t.selectionEnd = s + 4) } }
  return (
    <div className="h-full flex flex-col gap-2.5 min-h-0">
      <PageBar tool={bar} onBack={onBack}>
        <div className="min-w-0 flex-1 flex items-baseline gap-2"><span className="text-sm font-semibold text-white whitespace-nowrap">{ch.title}</span><span className="text-xs text-dim truncate min-w-0"><span className="capitalize">{ch.difficulty}</span> · {langOf(ch.language)[1]} · {ch.tests.length} tests</span></div>
        {res && <span className={`badge ${res.passed === res.results.length ? 'badge-green' : 'badge-red'}`}>{res.passed} / {res.results.length}</span>}
        <Timer elapsed={elapsed} limitMin={ch.limitMin || 30} status={ch.status} />
        {ch.status === 'open' && <button onClick={giveUp} className="btn-tint btn-red">Give up</button>}
        {(ch.status !== 'open' || res) && <button onClick={next} disabled={nexting} className="btn-tint btn-green" title={cleared ? 'A harder challenge on the same concept' : 'A smaller challenge that isolates what is failing'}>{nexting ? <Wait label="Building…" /> : <>{cleared ? 'Next: harder' : 'Next: focused practice'}<Ico d={<path d="m9 18 6-6-6-6"/>} /></>}</button>}
        <button onClick={() => setShowCoach(v => !v)} className={`btn-tint ${showCoach ? 'btn-purple' : ''}`} title="Toggle coach"><Ico d={<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>} />Coach</button>
      </PageBar>
      <div className="flex-1 min-h-0 grid gap-2.5 pt-2.5" style={{ gridTemplateColumns: showCoach ? 'minmax(260px,1fr) minmax(360px,1.4fr) minmax(260px,.9fr)' : 'minmax(260px,1fr) minmax(360px,1.6fr)' }}>
        <div ref={qRef} className="island overflow-y-auto p-4 kb-rich q-rich text-sm">
          <Markdown text={ch.statement} />
          {ch.examples.map((e, i) => <div key={i} className="q-example mt-3"><div className="q-example-title">Example {i + 1}</div><div className="q-io q-in"><span>Input</span><pre>{e.input}</pre></div><div className="q-io q-out"><span>Output</span><pre>{e.output}</pre></div>{e.explanation && <p className="q-explain">{e.explanation}</p>}</div>)}
        </div>
        <div className="island flex flex-col min-h-0 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border text-[11px] text-dim"><span className="font-mono">solution.{langOf(ch.language)[4]}</span><span className="ml-auto">{code.split('\n').length} lines</span></div>
          <div className="relative flex-1 min-h-[220px] bg-app overflow-hidden">
            <pre ref={hl} aria-hidden className="code-paint absolute inset-0 m-0 p-3 font-mono text-[13px] leading-relaxed whitespace-pre overflow-hidden pointer-events-none" style={{ tabSize: 4 }}><code className="hljs" dangerouslySetInnerHTML={{ __html: painted }} /></pre>
            <textarea dir="ltr" className="code-input absolute inset-0 w-full h-full bg-transparent text-transparent caret-gray-100 font-mono text-[13px] leading-relaxed p-3 outline-none resize-none whitespace-pre selection:bg-accent/30" spellCheck={false} value={code} onChange={e => setCode(e.target.value)} onKeyDown={tab} onScroll={e => { hl.current.scrollTop = e.target.scrollTop; hl.current.scrollLeft = e.target.scrollLeft }} style={{ tabSize: 4 }} />
          </div>
          <div className="border-t border-border p-2 flex flex-col gap-2 max-h-[45%] overflow-y-auto">
            <div className="flex items-center gap-2 flex-wrap">
              <button className="btn btn-primary inline-flex items-center gap-2 pl-4 pr-1.5 py-1.5 rounded-lg whitespace-nowrap" disabled={running} onClick={run}>{running ? 'Running…' : 'Run tests'}<span className="w-6 h-6 rounded-md bg-black/15 grid place-items-center">{running ? <Spin /> : <Ico s={12} d={<path d="m7 4 12 8-12 8V4z" fill="currentColor"/>} />}</span></button>
              <button className="btn-tint btn-purple" disabled={reviewing} onClick={getReview}>Get review</button>
              <button className="btn-tint" onClick={() => setCode(ch.starter)} title="Reset to starter code">Reset</button>
            </div>
            {panel === 'tests' && running && !res && <div className="text-[11px] text-dim px-0.5">Running tests…</div>}
            {panel === 'tests' && res && <div className="flex flex-col gap-1"><div className="flex items-center gap-2 text-[11px] text-dim px-0.5"><span>Tests · <b className={res.passed === res.results.length ? 'text-success' : 'text-error'}>{res.passed} / {res.results.length}</b> passed</span><button onClick={closePanel} className="ml-auto w-6 h-6 rounded-md grid place-items-center hover:text-white hover:bg-white/5" title="Close"><Ico s={12} d={<path d="M18 6 6 18M6 6l12 12"/>} /></button></div>{res.results.map((r, i) => (
              <details key={i} className={`text-[11px] rounded-md border bg-app ${r.pass ? 'border-success/40' : 'border-error/50'}`} open={!r.pass}>
                <summary className="px-2 py-1 cursor-pointer flex items-center gap-2"><span className={`w-1.5 h-1.5 rounded-full ${r.pass ? 'bg-success' : 'bg-error'}`} />Test {i + 1} · {r.pass ? 'pass' : 'fail'}</summary>
                <pre className="px-2 pb-2 m-0 whitespace-pre-wrap">Input: {r.input}{'\n'}Expected: {r.output}{r.pass ? '' : `\nGot: ${r.out}${r.err ? `\n${r.err}` : ''}`}</pre>
              </details>))}</div>}
            {panel === 'review' && (review || reviewing) && <div className="flex flex-col gap-1"><div className="flex items-center gap-2 text-[11px] text-dim px-0.5"><span>Review{reviewing ? ' · writing…' : ''}</span><button onClick={closePanel} className="ml-auto w-6 h-6 rounded-md grid place-items-center hover:text-white hover:bg-white/5" title="Close"><Ico s={12} d={<path d="M18 6 6 18M6 6l12 12"/>} /></button></div><div className="kb-rich text-[13px]">{review ? <Markdown text={review} /> : <Spin />}</div></div>}
          </div>
        </div>
        {showCoach && <Coach study={study} ch={ch} code={code} results={res} onChat={chat => setCh({ ...ch, chat })} />}
      </div>
    </div>
  )
}

// scope: GENERAL = the generic Code page; a study id = inside that study's workspace
export default function CodeArena({ studies, scope = GENERAL, bar = 'code' }) {
  const { list, update: setCh, add, remove } = useSessions('challenges', studies, scope)
  const [sel, setSel] = useState(null) // null = cards, 'new' = hero, id = arena
  const [busy, setBusy] = useState(false); const [topic, setTopic] = useState('')
  useEffect(() => {
    if (scope !== GENERAL) return
    const take = t => { try { localStorage.removeItem('cram:code-topic') } catch {} setTopic(t); setSel('new') }
    const t = localStorage.getItem('cram:code-topic'); if (t) take(t)
    const f = e => take(e.detail); window.addEventListener('cram:code-topic', f); return () => window.removeEventListener('cram:code-topic', f)
  }, [scope])
  const active = list?.find(c => c.id === sel && c.statement)
  const start = async opts => {
    setBusy(true); const c = await api.post(`/api/studies/${scope}/challenge`, opts); setBusy(false)
    if (c.error) return alert(c.error); add(c, scope); setSel(c.id)
  }
  const del = async c => {
    if (!await ask({ title: `Delete «${c.title}»?`, body: 'The challenge, your code, the coach chat and the timer are removed.', ok: 'Delete' })) return
    await api.del(`/api/studies/${c.studyId}/challenge/${c.id}`); remove(c.id); if (sel === c.id) setSel(null)
  }
  const css = (
      <style>{`
        @keyframes arena-float { 0%,100% { transform: translateY(0) rotate(-2deg); opacity: .35 } 50% { transform: translateY(-18px) rotate(2deg); opacity: .9 } }
        @keyframes arena-breathe { 0%,100% { transform: translate(-50%, 0) scale(1); opacity: .6 } 50% { transform: translate(-50%, 8px) scale(1.12); opacity: 1 } }
        @keyframes arena-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
        @keyframes arena-pulse { 0% { box-shadow: 0 0 0 0 rgb(var(--c-accent) / .55) } 70% { box-shadow: 0 0 0 14px rgb(var(--c-accent) / 0) } 100% { box-shadow: 0 0 0 0 rgb(var(--c-accent) / 0) } }
      `}</style>
  )
  if (!list) return <div className="h-full grid place-items-center text-xs text-dim">Loading…</div>
  if (active) return <>{css}<Arena key={active.id} study={{ id: scope }} ch={active} setCh={setCh} onBack={() => setSel(null)} onNext={c => { add(c, scope); setSel(c.id) }} bar={bar} /></>
  if (!list.length || sel === 'new') return <>{css}<Centered>
    {list.length > 0 && <button onClick={() => setSel(null)} className="btn-ghost text-xs inline-flex items-center gap-1 mb-2"><Ico d={<path d="m15 18-6-6 6-6"/>} />Back to challenges</button>}
    <Hero key={topic} busy={busy} onStart={start} general={scope === GENERAL} topic0={topic} />
  </Centered></>
  return <>{css}<Grid onNew={() => setSel('new')} newLabel="New challenge">{list.map(c => <Card key={c.id} c={c} onOpen={() => setSel(c.id)} onDelete={() => del(c)} />)}</Grid></>
}
