import React, { useState, useRef, useEffect } from 'react'
import NavBar from '../components/NavBar.jsx'
import Markdown from '../components/Markdown.jsx'
import { api } from '../api.js'

const Ico = ({ d }) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
const TABS = [
  ['ask', 'Ask', <Ico d={<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>} />],
  ['quiz', 'Quiz', <Ico d={<><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>} />],
  ['interview', 'Interview', <Ico d={<><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></>} />],
  ['code', 'Code', <Ico d={<><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></>} />],
  ['notes', 'Notes', <Ico d={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/></>} />],
]
const Spin = () => <span className="inline-block w-3.5 h-3.5 border-2 border-border border-t-accent rounded-full animate-spin align-middle" />
const Sel = ({ label, value, onChange, options }) => (
  <label className="text-xs text-dim flex items-center gap-1.5">{label}<select className="input w-auto py-1" value={value} onChange={e => onChange(e.target.value)}>{options.map(o => <option key={o[0] ?? o} value={o[0] ?? o}>{o[1] ?? o}</option>)}</select></label>
)

// ---------- chat surface shared by Ask and Interview ----------
function Chat({ msgs, onSend, busy, placeholder, empty, right }) {
  const [text, setText] = useState(''); const end = useRef()
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs])
  const send = () => { const t = text.trim(); if (!t || busy) return; setText(''); onSend(t) }
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-1 pb-2"><span className="text-xs text-dim">{empty}</span><div className="flex-1" />{right}</div>
      <div className="flex-1 overflow-y-auto flex flex-col gap-2.5 pr-1">
        {msgs.map((m, i) => (
          <div key={i} dir="auto" className={`max-w-[85%] px-3.5 py-2.5 rounded-xl text-sm border ${m.role === 'user' ? 'self-end bg-accent/10 border-accent/25 whitespace-pre-wrap' : 'self-start bg-panel border-border kb-rich'}`}>
            {m.role === 'user' ? m.content : (m.content ? <Markdown text={m.content} /> : <Spin />)}
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="flex gap-2 pt-2.5 items-end">
        <textarea dir="auto" className="input flex-1 min-h-[42px] max-h-48 resize-y" rows={1} placeholder={placeholder} value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
        <button className="btn btn-primary h-[42px]" disabled={busy} onClick={send}>Send</button>
      </div>
    </div>
  )
}

// ---------- Ask ----------
function Ask({ study, setStudy }) {
  const [busy, setBusy] = useState(false); const [live, setLive] = useState(null)
  const msgs = live ? [...study.chat, ...live] : study.chat
  const send = async q => {
    setBusy(true); setLive([{ role: 'user', content: q }, { role: 'assistant', content: '' }])
    const text = await api.stream(`/api/studies/${study.id}/chat`, { message: q }, t => setLive([{ role: 'user', content: q }, { role: 'assistant', content: t }]))
    setStudy(s => ({ ...s, chat: [...s.chat, { role: 'user', content: q }, { role: 'assistant', content: text }] })); setLive(null); setBusy(false)
  }
  const clear = async () => { if (!confirm('Clear this chat?')) return; await api.del(`/api/studies/${study.id}/chat`); setStudy(s => ({ ...s, chat: [] })) }
  return <Chat msgs={msgs} onSend={send} busy={busy} placeholder="Ask anything about the material… (Enter to send)" empty="Answers come from the material first, then general knowledge."
    right={<button className="btn-tint btn-red" onClick={clear}>Clear</button>} />
}

// ---------- Interview ----------
function Interview({ study, setStudy }) {
  const [busy, setBusy] = useState(false); const [live, setLive] = useState(null)
  const shown = study.interview.slice(1); const msgs = live ? [...shown, ...live] : shown
  const go = async (message, reset) => {
    setBusy(true); const pre = message ? [{ role: 'user', content: message }] : []; setLive([...pre, { role: 'assistant', content: '' }])
    const text = await api.stream(`/api/studies/${study.id}/interview`, { message, reset }, t => setLive([...pre, { role: 'assistant', content: t }]))
    setStudy(s => ({ ...s, interview: reset || !s.interview.length ? [{ role: 'user', content: 'Begin the interview.' }, { role: 'assistant', content: text }] : [...s.interview, ...pre, { role: 'assistant', content: text }] }))
    setLive(null); setBusy(false)
  }
  useEffect(() => { if (!study.interview.length) go(null, true) }, []) // eslint-disable-line
  return <Chat msgs={msgs} onSend={t => go(t, false)} busy={busy} placeholder="Your answer… (Enter to send)" empty="Oral exam: one question at a time, feedback after each answer, report after eight."
    right={<button className="btn-tint btn-purple" onClick={() => go(null, true)} disabled={busy}>Restart</button>} />
}

// ---------- Quiz ----------
function Quiz({ study, setStudy }) {
  const [n, setN] = useState('8'); const [d, setD] = useState('mixed'); const [topic, setTopic] = useState(''); const [busy, setBusy] = useState(false)
  const [quiz, setQuiz] = useState(null); const [picked, setPicked] = useState([]); const [graded, setGraded] = useState(false)
  const gen = async () => {
    setBusy(true); setQuiz(null); const q = await api.post(`/api/studies/${study.id}/quiz`, { n: +n, difficulty: d, topic }); setBusy(false)
    if (q.error) return alert(q.error); setQuiz(q); setPicked(Array(q.questions.length).fill(-1)); setGraded(false)
  }
  const score = quiz ? quiz.questions.filter((q, i) => picked[i] === q.answer).length : 0
  const grade = async () => {
    if (picked.includes(-1) && !confirm('Some questions are unanswered. Grade anyway?')) return
    setGraded(true); const rec = { id: quiz.id, title: quiz.title, difficulty: quiz.difficulty, at: Date.now(), score, total: quiz.questions.length }
    await api.post(`/api/studies/${study.id}/quiz/result`, rec); setStudy(s => ({ ...s, quizzes: [...s.quizzes, rec] }))
  }
  return (
    <div className="flex flex-col gap-2.5 h-full min-h-0 overflow-y-auto">
      <div className="island p-3 flex items-center gap-3 flex-wrap">
        <Sel label="Questions" value={n} onChange={setN} options={['5', '8', '12', '20']} />
        <Sel label="Difficulty" value={d} onChange={setD} options={['easy', 'mixed', 'hard']} />
        <input className="input flex-1 min-w-[160px]" placeholder="Focus topic (optional)" value={topic} onChange={e => setTopic(e.target.value)} />
        <button className="btn btn-primary" disabled={busy} onClick={gen}>{busy ? <><Spin /> Writing…</> : 'Generate quiz'}</button>
      </div>
      {quiz && (
        <div className="island p-4">
          <h3 className="text-sm font-semibold text-white mb-3">{quiz.title}</h3>
          {quiz.questions.map((q, i) => (
            <div key={i} className="mb-4" dir="auto">
              <div className="text-sm font-medium text-gray-100 mb-1.5">{i + 1}. {q.q}</div>
              <div className="flex flex-col gap-1">
                {q.choices.map((c, j) => {
                  const cls = graded ? (j === q.answer ? 'border-success bg-success/10' : j === picked[i] ? 'border-error bg-error/10' : 'border-border') : picked[i] === j ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/50'
                  return <button key={j} disabled={graded} onClick={() => setPicked(p => p.map((x, k) => k === i ? j : x))} className={`text-left text-sm px-3 py-2 rounded-lg border bg-app flex gap-2.5 ${cls}`}><span className="text-dim font-mono text-xs pt-0.5">{'ABCD'[j]}</span><span>{c}</span></button>
                })}
              </div>
              {graded && <div className="mt-2 text-xs text-gray-300 border-l-2 border-accent pl-2.5 kb-rich"><Markdown text={q.explanation} /></div>}
            </div>
          ))}
          <div className="flex items-center gap-3"><button className="btn btn-primary" disabled={graded} onClick={grade}>Check answers</button>{graded && <span className="text-lg font-semibold text-white">{score} / {quiz.questions.length}</span>}</div>
        </div>
      )}
      <History title="Past quizzes" rows={study.quizzes.map(q => [q.title, q.difficulty, `${q.score}/${q.total}`, q.at])} />
    </div>
  )
}

// ---------- Code ----------
function Code({ study, setStudy }) {
  const [lang, setLang] = useState('javascript'); const [d, setD] = useState('medium'); const [topic, setTopic] = useState(''); const [busy, setBusy] = useState(false)
  const [ch, setCh] = useState(null); const [code, setCode] = useState(''); const [res, setRes] = useState(null); const [running, setRunning] = useState(false); const [review, setReview] = useState(''); const [reviewing, setReviewing] = useState(false)
  const gen = async () => {
    setBusy(true); setCh(null); setRes(null); setReview(''); const c = await api.post(`/api/studies/${study.id}/challenge`, { language: lang, difficulty: d, topic }); setBusy(false)
    if (c.error) return alert(c.error); setCh(c); setCode(c.starter)
  }
  const run = async () => { setRunning(true); const r = await api.post('/api/run', { language: ch.language, code, tests: ch.tests }); setRunning(false); if (r.error) return alert(r.error); setRes(r) }
  const ask = async () => {
    setReviewing(true); setReview('')
    await api.stream(`/api/studies/${study.id}/challenge/review`, { challenge: ch, code, results: res }, setReview)
    setReviewing(false); setStudy(await api.get(`/api/studies/${study.id}`))
  }
  const tab = e => { if (e.key === 'Tab') { e.preventDefault(); const t = e.target, s = t.selectionStart; setCode(code.slice(0, s) + '    ' + code.slice(t.selectionEnd)); requestAnimationFrame(() => t.selectionStart = t.selectionEnd = s + 4) } }
  return (
    <div className="flex flex-col gap-2.5 h-full min-h-0 overflow-y-auto">
      <div className="island p-3 flex items-center gap-3 flex-wrap">
        <Sel label="Language" value={lang} onChange={setLang} options={[['javascript', 'JavaScript'], ['python', 'Python']]} />
        <Sel label="Difficulty" value={d} onChange={setD} options={['easy', 'medium', 'hard']} />
        <input className="input flex-1 min-w-[160px]" placeholder="Focus topic (optional)" value={topic} onChange={e => setTopic(e.target.value)} />
        <button className="btn btn-primary" disabled={busy} onClick={gen}>{busy ? <><Spin /> Designing…</> : 'New challenge'}</button>
      </div>
      {ch && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5">
          <div className="island p-4 kb-rich text-sm">
            <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">{ch.title}<span className="badge badge-purple">{ch.language} · {ch.difficulty}</span></h3>
            <Markdown text={ch.statement} />
            {ch.examples.map((e, i) => <div key={i} className="mt-3"><b className="text-xs uppercase tracking-wider text-dim">Example {i + 1}</b><pre className="mt-1">Input:{'\n'}{e.input}{'\n'}Output:{'\n'}{e.output}</pre>{e.explanation && <p className="text-xs text-dim">{e.explanation}</p>}</div>)}
          </div>
          <div className="island p-4 flex flex-col gap-2.5">
            <textarea className="input font-mono text-[13px] min-h-[320px] whitespace-pre" spellCheck={false} value={code} onChange={e => setCode(e.target.value)} onKeyDown={tab} style={{ tabSize: 4 }} />
            <div className="flex items-center gap-2 flex-wrap">
              <button className="btn btn-primary" disabled={running} onClick={run}>{running ? <Spin /> : 'Run tests'}</button>
              <button className="btn-tint btn-purple" disabled={reviewing} onClick={ask}>Get review</button>
              {res && <span className={`badge ${res.passed === res.results.length ? 'badge-green' : 'badge-red'}`}>{res.passed} / {res.results.length} passed</span>}
            </div>
            {res && <div className="flex flex-col gap-1.5">{res.results.map((r, i) => (
              <pre key={i} className={`text-[11px] rounded-lg border p-2 whitespace-pre-wrap ${r.pass ? 'border-success/50' : 'border-error/50'}`}><b>Test {i + 1}: {r.pass ? 'PASS' : 'FAIL'}</b>{'\n'}Input: {r.input}{'\n'}Expected: {r.output}{r.pass ? '' : `\nGot: ${r.out}${r.err ? `\n${r.err}` : ''}`}</pre>))}</div>}
            {(review || reviewing) && <div className="kb-rich text-sm border-t border-border pt-3">{review ? <Markdown text={review} /> : <Spin />}</div>}
          </div>
        </div>
      )}
      <History title="Past challenges" rows={study.challenges.map(c => [c.title, c.language, `${c.passed ?? '–'}/${c.total}`, c.at])} />
    </div>
  )
}

function History({ title, rows }) {
  return (
    <div className="island">
      <div className="panel-header">{title}</div>
      <div className="p-2 flex flex-col gap-1">
        {rows.length ? [...rows].reverse().map((r, i) => <div key={i} className="flex items-center gap-3 px-2.5 py-1.5 rounded-md bg-app text-xs"><span className="flex-1 text-gray-100 truncate">{r[0]}</span><span className="text-dim">{r[1]}</span><b className="text-white">{r[2]}</b><span className="text-dim">{new Date(r[3]).toLocaleDateString()}</span></div>)
          : <div className="text-xs text-dim px-2.5 py-2">none yet</div>}
      </div>
    </div>
  )
}

export default function StudyScreen({ study, setStudy, settings, onHome, onNotes }) {
  const [tab, setTab] = useState('ask')
  const body = { ask: <Ask study={study} setStudy={setStudy} />, quiz: <Quiz study={study} setStudy={setStudy} />, interview: <Interview study={study} setStudy={setStudy} />, code: <Code study={study} setStudy={setStudy} /> }
  return (
    <div className="h-full flex flex-col">
      <NavBar title={TABS.find(t => t[0] === tab)?.[1]} project={{ name: study.title }} onHome={onHome}
        right={<span className={`badge ${settings?.hasKey ? 'badge-green' : 'badge-red'}`}>{settings?.hasKey ? `${settings.source === 'claude' ? 'Claude' : 'key'} · ${settings.model.replace('claude-', '')}` : 'not signed in'}</span>} />
      <div className="flex items-center gap-1 px-2.5 pt-2.5">
        <div className="flex gap-0.5 bg-panel border border-border rounded-lg p-0.5">
          {TABS.map(([id, label, icon]) => (
            <button key={id} onClick={() => id === 'notes' ? onNotes() : setTab(id)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors ${tab === id ? 'bg-app text-white' : 'text-dim hover:text-white'}`}>{icon}{label}</button>
          ))}
        </div>
        <span className="badge ml-2">{study.hasPdf ? 'PDF' : 'Subject'}</span>
        {study.subject && <span className="text-xs text-dim truncate">{study.subject}</span>}
      </div>
      <div className="flex-1 min-h-0 p-2.5">{body[tab]}</div>
    </div>
  )
}
