import React, { useState, useRef, useEffect } from 'react'
import Markdown from '../components/Markdown.jsx'
import { api } from '../api.js'
import { ask } from '../components/Confirm.jsx'
import { useMic, speak, stopSpeech, isRtl } from '../voice.js'

const Ico = ({ d }) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
function CopyBtn({ text }) {
  const [done, setDone] = useState(false)
  const copy = e => { e.stopPropagation(); navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200) }
  return (
    <button onClick={copy} title="Copy" className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity text-[11px] px-2 py-0.5 rounded-md bg-panel-2 border border-border text-dim hover:text-white flex items-center gap-1">
      {done ? <><Ico d={<path d="M20 6 9 17l-5-5"/>} />Copied</> : <><Ico d={<><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></>} />Copy</>}
    </button>
  )
}
const Spin = () => <span className="inline-block w-3.5 h-3.5 border-2 border-border border-t-accent rounded-full animate-spin align-middle" />

const MIC = <><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></>
const SPEAK = <><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></>

// ---------- chat surface ----------
// an answer ends with a <next> list of helper questions: shown as chips, never as text (a half-streamed tag is hidden too)
const nextOf = (t = '') => { const m = /<next>([\s\S]*?)(?:<\/next>|$)/.exec(t); return { body: t.replace(/\s*<next>[\s\S]*$/, '').replace(/<(n(e(x(t)?)?)?)?$/, '').trim(), next: m ? m[1].split('\n').map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean).slice(0, 4) : [] } }

const SPARK = <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>
const SEND = <><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></>
function Chips({ items, onPick, className = '' }) {
  return <div className={`flex flex-wrap justify-center gap-2 ${className}`}>{items.map((h, i) => (
    <button key={h} dir="auto" onClick={() => onPick(h)} style={{ animationDelay: `${120 + i * 70}ms` }} className="chat-chip" title="Ask this">{h}</button>
  ))}</div>
}
const Dots = () => <span className="chat-dots inline-flex gap-1.5 py-1.5" aria-label="Thinking"><span /><span /><span /></span>

function Chat({ msgs, onSend, onStop, busy, placeholder, empty, right, onCite, helpers, title }) {
  const [text, setText] = useState(''); const [micErr, setMicErr] = useState(''); const end = useRef()
  const mic = useMic({ lang: 'auto', onText: t => { setText(x => (x ? `${x} ${t}` : t)); setMicErr('') }, onError: setMicErr }) // dictation: fills the box, you send
  const count = useRef(0) // glide to a new message; follow a streaming answer without animating every token
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: count.current !== msgs.length ? 'smooth' : 'auto' }); count.current = msgs.length }, [msgs])
  const send = () => { const t = text.trim(); if (!t || busy) return; mic.stop(); setText(''); onSend(t) }
  const pick = h => { mic.stop(); onSend(h) }
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-1 pb-2"><span className="text-xs text-dim">{empty}</span><div className="flex-1" />{right}</div>
      <div className="flex-1 overflow-y-auto pr-1">
        {!msgs.length ? (
          <div className="min-h-full flex flex-col items-center justify-center gap-6 px-4 py-10 text-center">
            <div className="chat-orb"><svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor">{SPARK}</svg></div>
            <div className="chat-in max-w-xl">
              <h2 className="text-2xl font-semibold text-white line-clamp-2">{title ? <>Let's learn <span className="chat-grad">{title}</span></> : 'What do you want to learn?'}</h2>
              <p className="text-sm text-dim mt-1.5">Ask anything, or start with one of these.</p>
            </div>
            {helpers?.length ? <Chips items={helpers} onPick={pick} className="max-w-2xl" /> : <div className="flex flex-wrap justify-center gap-2">{[0, 1, 2].map(i => <span key={i} className="chat-skel" style={{ animationDelay: `${i * 160}ms` }} />)}</div>}
          </div>
        ) : (
          <div className="max-w-3xl mx-auto flex flex-col gap-5 py-3 px-1">
            {msgs.map((m, i) => m.role === 'user'
              ? <div key={i} dir="auto" className="chat-in chat-user self-end max-w-[80%]">{m.content}</div>
              : <div key={i} className="chat-in flex gap-3 items-start">
                  <div className={`chat-avatar ${busy && i === msgs.length - 1 ? 'chat-avatar-live' : ''}`}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">{SPARK}</svg></div>
                  <div dir="auto" className="group relative flex-1 min-w-0 chat-ai kb-rich text-sm pr-12">{m.content ? <><Markdown text={m.content} onCite={onCite} /><CopyBtn text={m.content} /></> : <Dots />}</div>
                </div>)}
            {!busy && helpers?.length > 0 && <Chips key={msgs.length} items={helpers} onPick={pick} className="pt-1" />}
            <div ref={end} />
          </div>
        )}
      </div>
      <div className="max-w-3xl w-full mx-auto pt-3">
        {micErr && <div className="text-[11px] text-error pb-1.5 px-2">{micErr}</div>}
        <div className="chat-composer flex items-end gap-1.5 p-1.5">
          <button onClick={() => (mic.on ? mic.stop() : (stopSpeech(), mic.start()))} title={mic.on ? 'Stop dictating' : 'Dictate by voice'} aria-label={mic.on ? 'Stop dictating' : 'Dictate by voice'}
            className={`relative w-[38px] h-[38px] rounded-full grid place-items-center flex-shrink-0 transition-colors ${mic.on ? 'bg-accent text-app' : 'text-dim hover:text-white hover:bg-white/[0.06]'}`}>
            {mic.state === 'speaking' && <span className="absolute inset-0 rounded-full border-2 border-accent animate-pulse" />}
            {mic.state === 'loading' || mic.state === 'transcribing' ? <Spin /> : <Ico d={MIC} />}
          </button>
          <textarea dir="auto" rows={1} className="chat-field flex-1 min-h-[38px] max-h-48 bg-transparent resize-none outline-none text-sm text-gray-100 placeholder-dim py-2.5 px-1" placeholder={mic.on ? 'Listening… speak, then press Enter to send' : placeholder} value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
          {busy && onStop
            ? <button className="chat-send chat-stop" onClick={onStop} title="Stop generating" aria-label="Stop generating"><Ico d={<rect x="6" y="6" width="12" height="12" rx="2"/>} /></button>
            : <button className="chat-send" disabled={busy || !text.trim()} onClick={send} title="Send" aria-label="Send"><Ico d={SEND} /></button>}
        </div>
      </div>
    </div>
  )
}

// markdown to something a voice can read
const plain = t => t.replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*_>|~]/g, '').replace(/\n{2,}/g, '\n').trim()

// ---------- Ask ----------
function Ask({ study, setStudy, onCite, prefill, onPrefillUsed }) {
  const [busy, setBusy] = useState(false); const [live, setLive] = useState(null); const ctrl = useRef(null)
  const [voice, setVoice] = useState(() => localStorage.getItem('cram:chat-voice') === '1'); const voiceRef = useRef(voice); voiceRef.current = voice
  const msgs = live ? [...study.chat, ...live] : study.chat
  const send = async q => {
    stopSpeech(); setBusy(true); setLive([{ role: 'user', content: q }, { role: 'assistant', content: '' }]); ctrl.current = new AbortController()
    const raw = await api.stream(`/api/studies/${study.id}/chat`, { message: q }, t => setLive([{ role: 'user', content: q }, { role: 'assistant', content: nextOf(t).body }]), ctrl.current.signal)
    const { body: text, next } = nextOf(raw)
    setStudy(s => ({ ...s, chat: [...s.chat, { role: 'user', content: q }, { role: 'assistant', content: text || '*(stopped)*', ...(next.length ? { next } : {}) }] })); setLive(null); setBusy(false); ctrl.current = null
    if (voiceRef.current && text && !ctrl.current) speak(plain(text).slice(0, 1500), isRtl(text) ? 'Arabic' : 'English') // ponytail: long answers are read up to ~1500 characters
  }
  useEffect(() => { if (prefill?.text) { onPrefillUsed?.(); send(prefill.text) } }, [prefill?.n]) // eslint-disable-line -- "Ask" on a chapter
  useEffect(() => () => stopSpeech(), [])
  const [starters, setStarters] = useState([]); const fresh = !study.chat.length
  useEffect(() => { if (fresh && !starters.length) api.get(`/api/studies/${study.id}/starters`).then(r => Array.isArray(r) && setStarters(r)) }, [study.id, fresh]) // eslint-disable-line
  const helpers = fresh ? starters : study.chat.at(-1)?.next || []
  const toggleVoice = () => { const v = !voice; setVoice(v); localStorage.setItem('cram:chat-voice', v ? '1' : '0'); if (!v) stopSpeech() }
  const clear = async () => { if (!await ask({ title: 'Clear this chat?', body: 'Every question and answer in this study\'s chat is removed. The material and your notes stay.', ok: 'Clear chat' })) return; await api.del(`/api/studies/${study.id}/chat`); setStudy(s => ({ ...s, chat: [] })) }
  return <Chat msgs={msgs} onSend={send} onStop={() => ctrl.current?.abort()} busy={busy} helpers={helpers} title={study.title} placeholder="Ask anything about the material… (Enter to send)" empty="Answers come from the material first, then general knowledge." onCite={onCite}
    right={<><button className={`btn-tint ${voice ? 'btn-purple' : ''}`} onClick={toggleVoice} title="Read each answer aloud"><Ico d={SPEAK} />{voice ? 'Reading answers' : 'Read answers'}</button><button className="btn-tint btn-red" onClick={clear}>Clear</button></>} />
}

export default function StudyScreen({ study, setStudy, onCite, prefill, onPrefillUsed }) {
  return <div className="h-full min-h-0 p-2.5"><Ask study={study} setStudy={setStudy} onCite={onCite} prefill={prefill} onPrefillUsed={onPrefillUsed} /></div>
}
