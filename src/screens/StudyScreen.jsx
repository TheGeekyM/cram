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
function Chat({ msgs, onSend, onStop, busy, placeholder, empty, right, onCite }) {
  const [text, setText] = useState(''); const [micErr, setMicErr] = useState(''); const end = useRef()
  const mic = useMic({ lang: 'auto', onText: t => { setText(x => (x ? `${x} ${t}` : t)); setMicErr('') }, onError: setMicErr }) // dictation: fills the box, you send
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs])
  const send = () => { const t = text.trim(); if (!t || busy) return; mic.stop(); setText(''); onSend(t) }
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-1 pb-2"><span className="text-xs text-dim">{empty}</span><div className="flex-1" />{right}</div>
      <div className="flex-1 overflow-y-auto flex flex-col gap-2.5 pr-1">
        {msgs.map((m, i) => (
          <div key={i} dir="auto" className={`group relative max-w-[85%] px-3.5 py-2.5 rounded-xl text-sm border ${m.role === 'user' ? 'self-end bg-accent/10 border-accent/25 whitespace-pre-wrap' : 'self-start bg-panel border-border kb-rich pr-16'}`}>
            {m.role === 'user' ? m.content : (m.content ? <><Markdown text={m.content} onCite={onCite} /><CopyBtn text={m.content} /></> : <Spin />)}
          </div>
        ))}
        <div ref={end} />
      </div>
      {micErr && <div className="text-[11px] text-error pt-1.5">{micErr}</div>}
      <div className="flex gap-2 pt-2.5 items-end">
        <button onClick={() => (mic.on ? mic.stop() : (stopSpeech(), mic.start()))} title={mic.on ? 'Stop dictating' : 'Dictate by voice'} aria-label={mic.on ? 'Stop dictating' : 'Dictate by voice'}
          className={`relative w-[42px] h-[42px] rounded-lg grid place-items-center flex-shrink-0 transition-colors ${mic.on ? 'bg-accent text-app' : 'bg-app border border-border text-dim hover:text-white'}`}>
          {mic.state === 'speaking' && <span className="absolute inset-0 rounded-lg border-2 border-accent animate-pulse" />}
          {mic.state === 'loading' || mic.state === 'transcribing' ? <Spin /> : <Ico d={MIC} />}
        </button>
        <textarea dir="auto" className="input flex-1 min-h-[42px] max-h-48 resize-y" rows={1} placeholder={mic.on ? 'Listening… speak, then press Enter to send' : placeholder} value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
        {busy && onStop
          ? <button className="btn-tint btn-red h-[42px] px-4 inline-flex items-center gap-1.5" onClick={onStop} title="Stop generating"><Ico d={<rect x="6" y="6" width="12" height="12" rx="2"/>} />Stop</button>
          : <button className="btn btn-primary h-[42px]" disabled={busy} onClick={send}>Send</button>}
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
    const text = await api.stream(`/api/studies/${study.id}/chat`, { message: q }, t => setLive([{ role: 'user', content: q }, { role: 'assistant', content: t }]), ctrl.current.signal)
    setStudy(s => ({ ...s, chat: [...s.chat, { role: 'user', content: q }, { role: 'assistant', content: text || '*(stopped)*' }] })); setLive(null); setBusy(false); ctrl.current = null
    if (voiceRef.current && text && !ctrl.current) speak(plain(text).slice(0, 1500), isRtl(text) ? 'Arabic' : 'English') // ponytail: long answers are read up to ~1500 characters
  }
  useEffect(() => { if (prefill?.text) { onPrefillUsed?.(); send(prefill.text) } }, [prefill?.n]) // eslint-disable-line -- "Ask" on a chapter
  useEffect(() => () => stopSpeech(), [])
  const toggleVoice = () => { const v = !voice; setVoice(v); localStorage.setItem('cram:chat-voice', v ? '1' : '0'); if (!v) stopSpeech() }
  const clear = async () => { if (!await ask({ title: 'Clear this chat?', body: 'Every question and answer in this study\'s chat is removed. The material and your notes stay.', ok: 'Clear chat' })) return; await api.del(`/api/studies/${study.id}/chat`); setStudy(s => ({ ...s, chat: [] })) }
  return <Chat msgs={msgs} onSend={send} onStop={() => ctrl.current?.abort()} busy={busy} placeholder="Ask anything about the material… (Enter to send)" empty="Answers come from the material first, then general knowledge." onCite={onCite}
    right={<><button className={`btn-tint ${voice ? 'btn-purple' : ''}`} onClick={toggleVoice} title="Read each answer aloud"><Ico d={SPEAK} />{voice ? 'Reading answers' : 'Read answers'}</button><button className="btn-tint btn-red" onClick={clear}>Clear</button></>} />
}

export default function StudyScreen({ study, setStudy, onCite, prefill, onPrefillUsed }) {
  return <div className="h-full min-h-0 p-2.5"><Ask study={study} setStudy={setStudy} onCite={onCite} prefill={prefill} onPrefillUsed={onPrefillUsed} /></div>
}
