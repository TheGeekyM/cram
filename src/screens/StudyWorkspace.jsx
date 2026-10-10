import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api.js'
import { isRtl } from '../voice.js'
import StudyScreen from './StudyScreen.jsx'
import Interview, { StudyCoach } from './Interview.jsx'
import CodeArena from './CodeArena.jsx'
import Review from './Review.jsx'
import NotesScreen from './NotesScreen.jsx'

// One study, NotebookLM style: the chat in the middle, the study's own tools in a panel on the right.
// Every tool here is scoped to this study; the sidebar's Interview / Code pages are the generic ones.
const Ico = ({ d, s = 15 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
export const WS_TOOLS = [
  ['chat', 'Chat', <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>, 'Ask about the material'],
  ['source', 'Chapters', <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h2"/><path d="M8 17h6"/></>, 'What you will study, chapter by chapter'],
  ['interview', 'Interview', <><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></>, 'Oral exam on this study'],
  ['code', 'Code', <><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></>, 'Challenges from the material'],
  ['notes', 'Notes', <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/></>, 'Notes filed under this study'],
  ['review', 'Flashcards', <><rect x="2" y="6" width="14" height="14" rx="2"/><path d="M6 2h14a2 2 0 0 1 2 2v14"/></>, 'Cards and missed questions'],
  ['coach', 'Coaching', <path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z"/>, 'Weak spots and resources'],
]

// ---------- the study's PDF: chapter list on the left (with Ask / Quiz / Cards per chapter), the PDF on the right ----------
// ponytail: the PDF is Chromium's built-in viewer, whose text selection the page cannot read, so actions work per chapter
function Source({ study, jump, onAsk, onOpenInterview }) {
  const [o, setO] = useState(null); const [job, setJob] = useState(null); const [page, setPage] = useState(1); const [frame, setFrame] = useState(0); const [open, setOpen] = useState({})
  const [act, setAct] = useState(''); const [note, setNote] = useState('')
  // Planning a chapter list is a 15-130s model call, so watch it arrive rather than showing one frozen
  // sentence: the server streams a count and the tail of what it is writing. A cached plan comes back as
  // plain JSON on the same route, which the content type tells us.
  const load = async refresh => {
    setO(null); setJob({ log: [], live: null })
    const at = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const note = text => setJob(j => j && { ...j, log: [...j.log, { at: at(), text }] })
    try {
      const res = await fetch(`/api/studies/${study.id}/outline?stream=1${refresh ? '&refresh=1' : ''}`)
      if (!/ndjson/.test(res.headers.get('content-type') || '')) { const r = await res.json(); setJob(null); return setO(r) }
      const reader = res.body.getReader(), dec = new TextDecoder(); let buf = ''
      for (;;) {
        const { value, done } = await reader.read(); buf += dec.decode(value || new Uint8Array(), { stream: !done })
        const lines = buf.split('\n'); buf = done ? '' : lines.pop()
        for (const l of lines.filter(x => x.trim())) {
          const m = JSON.parse(l)
          if (m.stage === 'planning') note(study.hasPdf ? 'Reading the contents…' : 'Reading your subject and level…')
          else if (m.progress) setJob(j => j && { ...j, live: m.progress })
          else if (m.result) { note(`${(m.result.items || []).filter(i => !i.depth).length} chapters planned`); setO(m.result); setJob(null) }
          else if (m.error) { setO({ error: m.error }); setJob(null) }
        }
        if (done) break
      }
    } catch (e) { setO({ error: e.message }); setJob(null) }
  }
  // braces matter: load is async, and an effect that returns a Promise makes React call it as the
  // cleanup function on unmount ("l is not a function" once minified)
  useEffect(() => { load(false) }, [study.id]) // eslint-disable-line
  const go = p => { setPage(p); setFrame(j => j + 1) } // remount the frame: a hash-only change does not move the PDF viewer
  useEffect(() => { if (jump?.p) go(jump.p) }, [jump?.n]) // a (p. N) citation clicked in the chat
  const pdf = study.hasPdf // a subject study has the same chapter list, planned by Claude, with no pages and no viewer beside it
  const items = o?.items || []
  const chapters = []; for (const it of items) { if (it.depth === 0 || !chapters.length) chapters.push({ ...it, kids: [] }); else chapters[chapters.length - 1].kids.push(it) }
  chapters.forEach((c, i) => { c.to = chapters[i + 1] ? Math.max(c.page, chapters[i + 1].page - 1) : null })
  const current = [...chapters].reverse().find(c => c.page <= page)
  const label = c => pdf ? `"${c.title}" (PDF pages ${c.page}${c.to ? `-${c.to}` : ' onwards'})` : `"${c.title}"`
  const quiz = async (c, i) => {
    setAct(`${i}:quiz`); setNote('')
    const language = (study.interviews || []).slice(-1)[0]?.language || (isRtl(c.title) ? 'Arabic' : 'English')
    const r = await api.post(`/api/studies/${study.id}/interviews`, { difficulty: 'medium', language, focus: { title: `the chapter "${c.title}"`, ...(pdf ? { from: c.page, to: c.to } : {}) } })
    setAct(''); if (r.error) return setNote(r.error); onOpenInterview(r.id)
  }
  const cards = async (c, i) => {
    setAct(`${i}:cards`); setNote('')
    const r = await api.post(`/api/studies/${study.id}/flashcards`, { n: 10, topic: `the chapter ${label(c)}` })
    setAct(''); setNote(r.error || `${r.added?.length || 0} flashcards from «${c.title}» added to Flashcards.`)
  }
  return (
    <div className="h-full flex gap-2.5 p-2.5 min-h-0">
      {/* a PDF's chapter list is a sidebar, so it stays a panel; a planned list is the page itself,
          and wrapping cards in another box just boxes a box */}
      <aside className={`flex flex-col min-h-0 ${pdf ? 'island w-80 flex-shrink-0' : 'flex-1 max-w-4xl mx-auto w-full'}`}>
        <div className={`flex items-center gap-2 ${pdf ? 'panel-header' : 'px-1 pb-2 text-[10px] uppercase tracking-[0.18em] text-dim'}`}>Chapters{items.length > 0 && <span className="normal-case tracking-normal font-normal text-dim">· {chapters.length}</span>}
          {o && !o.error && o.from !== 'roadmap' && <button onClick={() => load(true)} className="ml-auto normal-case tracking-normal font-normal text-[11px] text-dim hover:text-white" title="Read the chapters again">Refresh</button>}</div>
        <div className={`flex-1 overflow-y-auto flex flex-col ${pdf ? 'p-1.5 gap-0.5' : 'gap-2.5 pb-2'}`} dir="auto">
          {!o && <div className="text-xs text-dim py-6 px-3 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-gray-200"><span className="w-3 h-3 rounded-full border-2 border-accent border-t-transparent animate-spin flex-shrink-0" />{pdf ? 'Reading the chapters…' : 'Planning your chapters…'}</div>
            {job?.live?.titles > 0 && <div className="text-[11px] text-gray-300">{job.live.chapters || 0} chapter{job.live.chapters === 1 ? '' : 's'} · {job.live.titles} title{job.live.titles === 1 ? '' : 's'} so far</div>}
            {/* what the model is writing right now, so a long wait visibly moves */}
            {job?.live?.tail && <div className="text-[10px] font-mono bg-app/60 border border-border rounded-md px-2 py-1.5 break-words line-clamp-3" dir="auto">…{job.live.tail}</div>}
            {!!job?.log?.length && <div className="flex flex-col gap-0.5 font-mono text-[10px]">{job.log.map((l, i) => <div key={i} dir="auto"><span className="text-dim/60">{l.at}</span> {l.text}</div>)}</div>}
            <div className="text-[11px]">{pdf ? 'A PDF without bookmarks is read by Claude once, which can take a minute.' : 'Claude plans this once for your subject and level. It can take a minute.'}</div>
          </div>}
          {o?.error && <div className="text-xs text-error text-center py-8 px-4">{o.error}<div><button onClick={() => load(true)} className="btn-tint mt-2">Try again</button></div></div>}
          {o && !o.error && !items.length && <div className="text-xs text-dim text-center py-8 px-4">{pdf ? 'No chapters found in this PDF.' : 'No chapters came back. Try Refresh.'}</div>}
          {/* A planned chapter list is read, not navigated: each chapter is a card with its sections
              shown and its actions always visible. A PDF keeps the compact sidebar rows beside the viewer. */}
          {!pdf && chapters.map((c, i) => (
            <article key={i} className="rounded-xl border border-border bg-app/50 p-3.5 flex flex-col gap-2.5 hover:border-accent/40 transition-colors">
              <div className="flex items-start gap-3">
                <span className="w-7 h-7 rounded-lg bg-accent/15 text-accent grid place-items-center text-xs font-bold flex-shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0 pt-1"><h3 className="text-sm font-semibold text-white leading-snug" dir="auto">{c.title}</h3>
                  {c.desc && <p className="text-xs text-gray-300 leading-relaxed mt-1" dir="auto">{c.desc}</p>}</div>
              </div>
              {!!c.kids.length && (
                <ul className="flex flex-col gap-1 ps-10">
                  {c.kids.map((k, j) => (
                    <li key={j} className="text-xs text-gray-300 flex gap-2 leading-relaxed" dir="auto">
                      <span className="text-dim/60 flex-shrink-0">•</span><span className="min-w-0">{k.title}</span>
                    </li>))}
                </ul>)}
              <div className="flex items-center gap-1.5 ps-10 flex-wrap">
                {[['ask', 'Ask', 'Explain this chapter in the chat', () => onAsk(`Explain the chapter ${label(c)}: the key ideas in simple words, with examples.`)],
                  ['quiz', 'Interview me', 'Start an interview on this chapter only', () => quiz(c, i)],
                  ['cards', 'Cards', 'Make 10 flashcards from this chapter', () => cards(c, i)]].map(([k, l, t, f]) => (
                  <button key={k} onClick={f} disabled={!!act} title={t}
                    className="text-[11px] px-2.5 py-1 rounded-md bg-panel-2 text-dim hover:text-white hover:bg-white/10 disabled:opacity-40 transition-colors">
                    {act === `${i}:${k}` ? '…' : l}
                  </button>))}
              </div>
            </article>))}
          {pdf && chapters.map((c, i) => (
            <div key={i}>
              <div className={`group flex items-center rounded-lg ${current === c ? 'bg-accent/15 text-white' : 'text-gray-300 hover:bg-white/5'}`}>
                <button onClick={() => setOpen(x => ({ ...x, [i]: !x[i] }))} disabled={!c.kids.length} className={`w-6 h-7 grid place-items-center text-dim flex-shrink-0 ${c.kids.length ? 'hover:text-white' : 'opacity-0'}`} aria-label={open[i] ? 'Hide sections' : 'Show sections'}>
                  <Ico s={12} d={<path d={open[i] ? 'm6 9 6 6 6-6' : 'm9 18 6-6-6-6'} />} />
                </button>
                <button onClick={() => pdf && go(c.page)} className="flex-1 min-w-0 flex items-baseline gap-2 py-1.5 pr-2 text-left text-sm"><span className="truncate" title={c.title}>{c.title}</span>{pdf && <span className="ml-auto text-[11px] text-dim font-mono flex-shrink-0">{c.page}</span>}</button>
                <span className={`${act.startsWith(`${i}:`) ? 'flex' : 'hidden group-hover:flex'} items-center gap-0.5 pe-1.5 flex-shrink-0`}>
                  {[['ask', 'Ask', 'Explain this chapter in the chat', () => onAsk(`Explain the chapter ${label(c)}: the key ideas in simple words, with examples.`)],
                    ['quiz', 'Interview me', 'Start an interview on this chapter only', () => quiz(c, i)],
                    ['cards', 'Cards', 'Make 10 flashcards from this chapter', () => cards(c, i)]].map(([k, l, t, f]) => (
                    <button key={k} onClick={f} disabled={!!act} title={t} className="text-[10px] px-1.5 py-0.5 rounded bg-app border border-border text-dim hover:text-white hover:border-accent/50">{act === `${i}:${k}` ? '…' : l}</button>))}
                </span>
              </div>
              {open[i] && c.kids.map((k, j) => (
                <button key={j} onClick={() => pdf && go(k.page)} style={{ paddingLeft: 16 + k.depth * 14 }} className="w-full flex items-baseline gap-2 py-1 pr-2 rounded-md text-left text-xs text-dim hover:text-white hover:bg-white/5">
                  <span className="truncate" title={k.title}>{k.title}</span>{pdf && <span className="ml-auto text-[10px] font-mono flex-shrink-0">{k.page}</span>}
                </button>))}
            </div>))}
        </div>
        {note && <div className="px-3 py-2 border-t border-border text-[11px] text-gray-300">{note}</div>}
        {o?.from === 'ai' && <div className="px-3 py-2 border-t border-border text-[10px] text-dim">This PDF has no bookmarks, so Claude read the contents. Page numbers can be a page or two off.</div>}
        {o?.from === 'subject' && <div className="px-1 pt-2 text-[10px] text-dim">A plan of what to study, for your level — the chapters are empty. Ask, Interview me and Cards work on any of them; Refresh plans again.</div>}
      </aside>
      {pdf && <div className="island flex-1 min-w-0 overflow-hidden"><iframe key={frame} src={`/api/studies/${study.id}/source.pdf#page=${page}`} title={`${study.title} PDF`} className="w-full h-full border-0" /></div>}
    </div>
  )
}

export default function StudyWorkspace({ study, setStudy, tool, setTool, onChanged, profile, openInterview, onInterviewOpened }) {
  const one = [{ id: study.id, title: study.title }]
  const [srcJump, setSrcJump] = useState(null); const [prefill, setPrefill] = useState(null); const [openIv, setOpenIv] = useState(null)
  const pick = id => { setOpenIv(null); setTool(id) }
  useEffect(() => { if (openInterview?.id) { setOpenIv(openInterview.id); setTool('interview'); onInterviewOpened?.() } }, [openInterview?.n]) // eslint-disable-line // an interview started from another page, e.g. a roadmap stage
  const [side, setSide] = useState(null); useEffect(() => setSide(document.getElementById('ws-side')), []) // App's slot beside the page island
  return (
    <div className="h-full flex min-h-0">
      <div className="flex-1 min-w-0 min-h-0">
        {tool === 'chat' && <StudyScreen study={study} setStudy={setStudy} prefill={prefill} onPrefillUsed={() => setPrefill(null)}
          onCite={study.hasPdf ? p => { setSrcJump({ p, n: Date.now() }); setTool('source') } : undefined} />}
        {tool === 'source' && <Source study={study} jump={srcJump} onAsk={text => { setPrefill({ text, n: Date.now() }); setTool('chat') }} onOpenInterview={id => { setOpenIv(id); setTool('interview') }} />}
        {tool === 'interview' && <Interview key={openIv || 'list'} studies={one} scope={study.id} bar="study" openId={openIv} />}
        {tool === 'code' && <CodeArena studies={one} scope={study.id} bar="study" />}
        {tool === 'notes' && <NotesScreen project={{ id: 'notes', name: 'Notes' }} studyId={study.id} embedded />}
        {tool === 'review' && <Review studies={one} scope={study.id} bar="study" onChanged={onChanged} />}
        {tool === 'coach' && <div className="h-full px-2.5 pb-2.5"><StudyCoach studyId={study.id} bar="study" onBack={() => setTool('chat')} /></div>}
      </div>
      {side && createPortal(<aside className="island w-72 flex-shrink-0 flex flex-col p-2 gap-0.5 overflow-y-auto">
        <div className="px-2.5 pt-2 pb-3">
          <div className="text-sm font-semibold text-white truncate" dir="auto" title={study.title}>{study.title}</div>
          <div className="text-[11px] text-dim truncate" dir="auto">{study.subject || (study.hasPdf ? 'From a PDF' : 'Study')}{study.hasPdf && study.subject ? ' · PDF' : ''}</div>
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-dim px-2.5 pb-1">Study tools</div>
        {/* the role decides what a study offers too: no Code challenges for someone who writes none */}
        {WS_TOOLS.filter(([id]) => (profile?.tools ? profile.tools.includes(id) : true) || ['chat', 'source', 'coach'].includes(id)).map(([id, label, ic, sub]) => (
          <button key={id} onClick={() => pick(id)} className={`flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${tool === id ? 'bg-accent/15 text-white' : 'text-dim hover:text-white hover:bg-white/5'}`}>
            <span className={`mt-0.5 ${tool === id ? 'text-accent' : ''}`}><Ico d={ic} /></span>
            <span className="min-w-0"><span className="block text-sm">{label}</span><span className="block text-[11px] text-dim truncate">{sub}</span></span>
          </button>
        ))}
      </aside>, side)}
    </div>
  )
}
