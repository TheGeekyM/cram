import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { notify, setBlogSeen } from '../notify.js'
import { PageBar } from '../components/SessionList.jsx'
import { ask } from '../components/Confirm.jsx'
import hljs from 'highlight.js/lib/common'
import 'highlight.js/styles/github-dark.css'

// Blog: long articles written about what you are studying, each with a discussion under it.
// The list searches itself (every article ships a stripped `search` blob), and generating one
// streams its stages into a panel on the right, so closing the article you are reading never
// interrupts it. ponytail: search is client-side over the loaded list; add a route if it gets big.
const Ico = ({ d, s = 15 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
const I = {
  search: <><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></>,
  spark: <path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z"/>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  chat: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>,
  trash: <><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/></>,
}
const day = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
// Same steps and labels as the notes editor, so the two readers behave alike. Wide by default:
// an article is a page to read, not a note column.
const WIDTHS = [
  { key: 'narrow', label: 'Narrow', cls: 'max-w-xl' },
  { key: 'normal', label: 'Normal', cls: 'max-w-3xl' },
  { key: 'wide',   label: 'Wide',   cls: 'max-w-4xl' },
  { key: 'wider',  label: 'Wider',  cls: 'max-w-5xl' },
  { key: 'full',   label: 'Full',   cls: 'max-w-none' },
]

// The discussion. Three things keep 20+ comments readable: the indent stops after two levels (a
// chain of replies used to march off the right edge), a rail ties a reply to what it answers, and
// each person gets the same colour everywhere, so you can follow one voice down the thread.
// ponytail: plain function, not a nested component — one defined in render remounts on every render.
const MAX_INDENT = 2
const hueOf = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h }
const initial = s => String(s || '?').trim()[0]?.toUpperCase() || '?'

function Comments({ list }) {
  const [flash, setFlash] = useState(null) // the comment a mention just jumped to
  const kids = new Map() // parent index (or 'root') → child indexes, in the order they were written
  list.forEach((c, i) => { const k = c.replyTo == null ? 'root' : c.replyTo; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(i) })
  const jump = i => {
    const el = document.getElementById(`blog-c-${i}`); if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlash(i); setTimeout(() => setFlash(f => (f === i ? null : f)), 1400) // let go of it, unless another jump won the race
  }
  const row = (i, depth) => {
    const c = list[i], mine = kids.get(i) || [], h = hueOf(c.author)
    const parent = c.replyTo != null ? list[c.replyTo] : null
    return (
      <div key={i} className={depth ? 'ps-3 sm:ps-4 border-s border-border/60' : ''}>
        <div id={`blog-c-${i}`} className={`flex gap-2.5 py-3 px-2 -mx-2 rounded-lg transition-colors duration-700 ${flash === i ? 'bg-accent/10' : ''}`}>
          <span className="w-7 h-7 rounded-full grid place-items-center text-[11px] font-bold flex-shrink-0 select-none"
            style={{ background: `hsl(${h} 55% 45% / 0.18)`, color: `hsl(${h} 60% 62%)` }} aria-hidden>{initial(c.author)}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-x-2 gap-y-0.5 flex-wrap leading-tight">
              <span className="text-[13px] font-semibold text-white" dir="auto">{c.author}</span>
              {c.role && <span className="text-[11px] text-dim" dir="auto">{c.role}</span>}
            </div>
            <p className="text-sm text-gray-300 mt-1.5 whitespace-pre-wrap leading-[1.65]" dir="auto">
              {/* a reply opens by naming who it answers; clicking goes there and flashes it */}
              {parent && <button onClick={() => jump(c.replyTo)} title={`Go to ${parent.author}'s comment`}
                className="font-medium hover:underline me-1.5" style={{ color: 'hsl(214 95% 68%)' }} dir="auto">@{parent.author}</button>}
              {c.text}
            </p>
          </div>
        </div>
        {mine.map(k => row(k, Math.min(depth + 1, MAX_INDENT)))}
      </div>
    )
  }
  return <div className="flex flex-col divide-y divide-border/60">{(kids.get('root') || []).map(i => row(i, 0))}</div>
}

// The right-hand panel: what is being written right now. Stays put while you read something else.
function Progress({ job, onClose }) {
  if (!job) return null
  const { study, stage, done, total, error, titles } = job
  return (
    <aside className="island w-72 flex-shrink-0 flex flex-col p-3 gap-2 self-start">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-white flex-1">{error ? 'Generation stopped' : done >= total ? 'Done' : 'Writing…'}</span>
        <button onClick={onClose} title="Close" className="text-dim hover:text-white"><Ico s={13} d={<><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>} /></button>
      </div>
      <div className="text-[11px] text-dim" dir="auto">{study}</div>
      <div className="h-1.5 rounded-full bg-panel-2 overflow-hidden"><div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${Math.round((done / total) * 100)}%` }} /></div>
      {!error && done < total && <div className="text-[11px] text-gray-300 flex items-center gap-1.5"><span className="w-3 h-3 rounded-full border-2 border-accent border-t-transparent animate-spin" />{stage === 'comments' ? 'Adding the discussion…' : 'Writing the article…'}</div>}
      {titles.map((t, i) => <div key={i} className="text-[11px] text-success truncate" dir="auto" title={t}>✓ {t}</div>)}
      {error && <div className="text-[11px] text-error">{error}</div>}
      {done >= total && !error && <div className="text-[11px] text-dim">Saved to the list.</div>}
    </aside>
  )
}

function GenerateDialog({ studies, onClose, onStart }) {
  const [sel, setSel] = useState(() => new Set(studies[0] ? [studies[0].id] : [])) // one article per ticked study
  const toggle = id => setSel(s => { const c = new Set(s); c.has(id) ? c.delete(id) : c.add(id); return c })
  const [lang, setLang] = useState(() => localStorage.getItem('blogLang') || '') // '' = follow the subject
  const pickLang = k => { setLang(k); try { localStorage.setItem('blogLang', k) } catch {} }
  if (!studies.length) return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={onClose}>
      <div className="island w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <div className="text-sm font-semibold text-white mb-2">No studies yet</div>
        <p className="text-xs text-dim mb-4">Articles are written about what you study. Make a study first, then come back.</p>
        <div className="flex justify-end"><button className="btn btn-primary" onClick={onClose}>OK</button></div>
      </div>
    </div>)
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={onClose}>
      <div className="island w-full max-w-md p-5 flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <div className="text-sm font-semibold text-white mb-1">Write an article</div>
        <p className="text-xs text-dim mb-3">One 10-minute read, with a discussion under it, for every study you tick. They are written one after another.</p>
        <div className="flex items-center gap-3 text-xs mb-1 flex-shrink-0">
          <span className="text-dim me-auto">{sel.size} of {studies.length} selected</span>
          <button className="text-dim hover:text-white" onClick={() => setSel(new Set(studies.map(s => s.id)))}>All</button>
          <button className="text-dim hover:text-white" onClick={() => setSel(new Set())}>None</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-0.5 mb-4">
          {studies.map(s => (
            <label key={s.id} className="flex items-start gap-3 px-2.5 py-2 rounded-lg cursor-pointer hover:bg-white/5">
              <input type="checkbox" className="mt-1 flex-shrink-0" style={{ accentColor: 'rgb(var(--c-accent))' }} checked={sel.has(s.id)} onChange={() => toggle(s.id)} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-gray-100 truncate" dir="auto">{s.title}</span>
                {s.subject && <span className="block text-[11px] text-dim truncate" dir="auto">{s.subject}</span>}
              </span>
            </label>))}
        </div>
        <label className="text-[11px] uppercase tracking-wider text-dim flex-shrink-0">Language</label>
        <div className="flex gap-0.5 bg-app border border-border rounded-lg p-0.5 mt-1 mb-4 flex-shrink-0">
          {[['', 'Auto'], ['english', 'English'], ['arabic', 'العربية']].map(([k, l]) => (
            <button key={k} onClick={() => pickLang(k)} title={k ? '' : "Whatever language the study's subject is in"}
              className={`flex-1 text-[11px] px-1 py-1.5 rounded-md ${lang === k ? 'bg-panel-2 text-white' : 'text-dim hover:text-white'}`} dir="auto">{l}</button>))}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[11px] text-dim flex-1">{sel.size > 2 ? `${sel.size} articles is a long run — you can stop it any time.` : ''}</span>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!sel.size} onClick={() => onStart([...sel], lang)}>Generate {sel.size || ''} article{sel.size === 1 ? '' : 's'}</button>
        </div>
      </div>
    </div>)
}

export default function Blog({ studies = [], openId }) {
  const [list, setList] = useState(null)
  const [sel, setSel] = useState(openId || null)   // an article id, or null for the list
  const [article, setArticle] = useState(null)
  const [q, setQ] = useState(''); const [typed, setTyped] = useState(''); const [sugOpen, setSugOpen] = useState(false)
  const [gen, setGen] = useState(false)            // the pick-a-study dialog
  const [job, setJob] = useState(null)             // the right-hand progress panel
  const [width, setWidth] = useState(() => localStorage.getItem('blogWidth') || 'wide')
  const pickWidth = v => { setWidth(v); try { localStorage.setItem('blogWidth', v) } catch {} }
  const ac = useRef(null); const bodyRef = useRef(null)
  const [toc, setToc] = useState([]); const [active, setActive] = useState('')
  // The article arrives as HTML, so both of these run over the rendered body: colour the code the way an
  // editor would (`data-hl` stops a re-render highlighting twice), and read the headings for the section list.
  useEffect(() => {
    const root = bodyRef.current
    if (!root) return setToc([])
    root.querySelectorAll('pre code').forEach(el => { if (!el.dataset.hl) { try { hljs.highlightElement(el) } catch {} el.dataset.hl = '1' } })
    const heads = [...root.querySelectorAll('h1, h2, h3')]
    heads.forEach((el, i) => { if (!el.id) el.id = `sec-${i}` })
    const items = heads.map(el => ({ id: el.id, text: el.textContent.trim(), sub: el.tagName === 'H3' })).filter(t => t.text)
    if (article?.comments?.length) items.push({ id: 'blog-discussion', text: `Discussion · ${article.comments.length}`, sub: false })
    setToc(items)
  }, [article])
  // which section you are reading, so the list can say where you are
  useEffect(() => {
    if (!toc.length) return
    const els = toc.map(t => document.getElementById(t.id)).filter(Boolean)
    const io = new IntersectionObserver(es => {
      const seen = es.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (seen[0]) setActive(seen[0].target.id)
    }, { rootMargin: '-8% 0px -70% 0px' })
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [toc])
  const goSec = id => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const load = () => api.get('/api/blog').then(r => setList(r.articles || [])).catch(() => setList([]))
  useEffect(() => { load() }, [])
  useEffect(() => { if (openId) setSel(openId) }, [openId])
  useEffect(() => { if (!sel) return setArticle(null); setArticle(null); api.get(`/api/blog/${sel}`).then(setArticle).catch(() => setArticle({ error: 'Could not open that article.' })) }, [sel])
  useEffect(() => () => ac.current?.abort(), [])

  const all = list || []
  // suggestions come from the typed text; the list itself filters on the submitted query
  const sug = useMemo(() => { const t = typed.trim().toLowerCase(); return t.length < 2 ? [] : all.filter(a => a.search?.includes(t)).slice(0, 6) }, [typed, all])
  const shown = useMemo(() => { const t = q.trim().toLowerCase(); return t ? all.filter(a => a.search?.includes(t)) : all }, [q, all])

  // One request per article, in sequence: Stop just stops asking for the next one, so a cancelled
  // run can never leave another article being written in the background.
  const one = async (studyId, language) => {
    const res = await fetch('/api/blog/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studyId, language }), signal: ac.current.signal })
    if (!/json/.test(res.headers.get('content-type') || '')) throw new Error(`${res.status}: the app's server is not running the latest version. Restart Cram.`)
    const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '', ok = false
    for (;;) {
      const { value, done } = await reader.read(); buf += dec.decode(value || new Uint8Array(), { stream: !done })
      const lines = buf.split('\n'); buf = done ? '' : lines.pop()
      for (const l of lines.filter(x => x.trim())) {
        const m = JSON.parse(l)
        if (m.stage) setJob(j => j && { ...j, stage: m.stage })
        else if (m.saved) { // on disk now: show it, tell the bell, refresh the list
          ok = true
          setJob(j => j && { ...j, done: j.done + 1, titles: [...j.titles, m.saved.title], stage: 'body' })
          notify(`New article: ${m.saved.title}`, { sub: m.saved.studyTitle, link: { page: 'blog', id: m.saved.id } })
          setBlogSeen(m.saved.at) // announced here, so App's watcher does not announce it again
          load()
        } else if (m.error) setJob(j => j && { ...j, error: m.error })
      }
      if (done) break
    }
    return ok
  }
  const start = async (ids, lang) => {
    setGen(false)
    const name = id => studies.find(s => s.id === id)?.title || 'Study'
    setJob({ study: name(ids[0]), stage: 'body', done: 0, total: ids.length, titles: [], error: '' })
    ac.current = new AbortController()
    for (const id of ids) { // one study at a time, so Stop only ever loses the one being written
      if (ac.current.signal.aborted) break
      setJob(j => j && { ...j, study: name(id), stage: 'body' })
      try { if (!await one(id, lang)) break } // an error line already showed; do not burn another call
      catch (e) { if (e.name !== 'AbortError') setJob(j => j && { ...j, error: e.message }); break }
    }
  }
  const del = async a => {
    if (!await ask({ title: `Delete «${a.title}»?`, body: 'The article and its whole discussion are removed. This can\'t be undone.', ok: 'Delete article' })) return
    await api.del(`/api/blog/${a.id}`); if (sel === a.id) setSel(null); load()
  }

  if (sel) return (
    <div className="h-full overflow-y-auto">
      <div className="flex items-start justify-center gap-6 px-6 py-5">
        <div className={`${(WIDTHS.find(w => w.key === width) || WIDTHS[2]).cls} min-w-0 flex-1 transition-[max-width] duration-150`}>
        {/* the way back is the Blog crumb in the app header, which fires this */}
        <PageBar tool="blog" onBack={() => setSel(null)}>
          <div className="min-w-0 flex-1 flex items-baseline gap-2">
            <span className="text-sm font-semibold text-white truncate" dir="auto">{article?.title || 'Article'}</span>
          </div>
          <select value={width} onChange={e => pickWidth(e.target.value)} title="How wide the article runs"
            className="bg-app border border-border rounded-md text-[11px] text-dim hover:text-white px-1.5 py-1 focus:outline-none flex-shrink-0">
            {WIDTHS.map(w => <option key={w.key} value={w.key}>{w.label}</option>)}
          </select>
        </PageBar>
        {!article && <div className="text-xs text-dim py-10 text-center">Opening…</div>}
        {article?.error && <div className="text-xs text-error py-10 text-center">{article.error}</div>}
        {article && !article.error && <>
          <h1 className="text-2xl font-bold text-white leading-tight" dir="auto">{article.title}</h1>
          <div className="flex items-center gap-3 text-[11px] text-dim mt-2 mb-5 flex-wrap">
            <span dir="auto">{article.studyTitle}</span><span>·</span><span>{day(article.at)}</span>
            <span className="inline-flex items-center gap-1"><Ico s={11} d={I.clock} />{article.minutes} min read</span>
            <span className="inline-flex items-center gap-1"><Ico s={11} d={I.chat} />{article.comments?.length || 0} comments</span>
          </div>
          <div ref={bodyRef} className="nt-page" dir="auto" dangerouslySetInnerHTML={{ __html: article.body || '' }} />
          {!!article.comments?.length && <div id="blog-discussion" className="mt-8 pt-4 border-t border-border scroll-mt-4">
            <div className="text-xs font-semibold text-white mb-1">Discussion · {article.comments.length}</div>
            <p className="text-[11px] text-dim mb-2">Written as a thread between experienced people, so the arguments and follow-ups are part of the material.</p>
            <Comments list={article.comments} />
          </div>}
        </>}
        </div>
        {/* what the article covers, and where you are in it. Hidden on narrow windows, where it would
            eat the reading column — the headings are still right there in the text. */}
        {toc.length > 1 && (
          <aside className="hidden xl:flex w-56 flex-shrink-0 sticky top-0 flex-col gap-0.5 max-h-[calc(100vh-7rem)] overflow-y-auto">
            <div className="text-[10px] uppercase tracking-[0.18em] text-dim px-2 pb-1">In this article</div>
            {toc.map(t => (
              <button key={t.id} onClick={() => goSec(t.id)} dir="auto" title={t.text}
                className={`text-start leading-snug rounded-md px-2 py-1.5 transition-colors border-s-2 ${
                  active === t.id ? 'border-accent bg-accent/10 text-white' : 'border-transparent text-dim hover:text-white hover:bg-white/5'
                } ${t.sub ? 'ps-5 text-[11px]' : 'text-xs'}`}>
                <span className="line-clamp-2">{t.text}</span>
              </button>))}
          </aside>)}
      </div>
    </div>
  )

  return (
    <div className="h-full flex gap-2.5 p-2.5 min-h-0">
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="flex items-center gap-2 mb-2.5 flex-shrink-0">
          <div className="relative flex-1 min-w-0">
            <span className="absolute start-2.5 top-1/2 -translate-y-1/2 text-dim"><Ico s={14} d={I.search} /></span>
            <input className="input ps-8" placeholder="Search every article and its discussion…" value={typed} dir="auto"
              onChange={e => { setTyped(e.target.value); setSugOpen(true) }}
              onKeyDown={e => { if (e.key === 'Enter') { setQ(typed); setSugOpen(false) } if (e.key === 'Escape') { setTyped(''); setQ(''); setSugOpen(false) } }}
              onFocus={() => setSugOpen(true)} onBlur={() => setTimeout(() => setSugOpen(false), 120)} />
            {sugOpen && sug.length > 0 && (
              <div className="absolute top-full mt-1 inset-x-0 island z-40 overflow-hidden">
                {sug.map(a => (
                  <button key={a.id} onMouseDown={() => { setSel(a.id); setSugOpen(false) }} className="w-full text-left px-3 py-2 hover:bg-white/5 border-b border-border/60 last:border-0">
                    <div className="text-xs text-gray-100 truncate" dir="auto">{a.title}</div>
                    <div className="text-[10px] text-dim truncate" dir="auto">{a.studyTitle} · {a.minutes} min</div>
                  </button>))}
              </div>)}
          </div>
          {q && <button onClick={() => { setQ(''); setTyped('') }} className="btn-ghost text-xs whitespace-nowrap">Clear “{q.slice(0, 18)}”</button>}
          <button onClick={() => setGen(true)} className="btn btn-primary text-xs inline-flex items-center gap-1.5 whitespace-nowrap"><Ico s={13} d={I.spark} />Generate</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {!list && <div className="text-xs text-dim text-center py-10">Loading…</div>}
          {list && !shown.length && <div className="text-xs text-dim text-center py-10">{q ? `Nothing matches “${q}”.` : 'No articles yet. Generate one, or let the daily job write them for you.'}</div>}
          {/* a card per article, coloured by its study — the same hue the study's people get in the discussion */}
          <div className="grid gap-2.5 pb-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))' }}>
            {shown.map(a => {
              const h = hueOf(a.studyTitle || a.title)
              return (
                <article key={a.id} onClick={() => setSel(a.id)} title={a.title}
                  className="island group relative overflow-hidden cursor-pointer flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40">
                  <span className="h-1.5 w-full flex-shrink-0" style={{ background: `linear-gradient(90deg, hsl(${h} 70% 52%), hsl(${(h + 45) % 360} 70% 58%))` }} />
                  <span className="absolute -top-16 -end-16 w-40 h-40 rounded-full blur-3xl opacity-60 pointer-events-none" style={{ background: `hsl(${h} 70% 50% / 0.16)` }} />
                  <div className="relative p-4 flex flex-col gap-2 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full truncate max-w-[65%]" dir="auto"
                        style={{ background: `hsl(${h} 60% 45% / 0.18)`, color: `hsl(${h} 62% 62%)` }}>{a.studyTitle}</span>
                      <span className="text-[10px] text-dim ms-auto whitespace-nowrap">{day(a.at)}</span>
                    </div>
                    <h3 className="text-sm font-semibold text-white leading-snug line-clamp-2" dir="auto">{a.title}</h3>
                    <p className="text-xs text-dim leading-relaxed line-clamp-3 flex-1" dir="auto">{a.excerpt}</p>
                    <div className="flex items-center gap-3 text-[11px] text-dim pt-2 mt-auto border-t border-border/60">
                      <span className="inline-flex items-center gap-1"><Ico s={11} d={I.clock} />{a.minutes} min</span>
                      <span className="inline-flex items-center gap-1"><Ico s={11} d={I.chat} />{a.comments}</span>
                      <button onClick={e => { e.stopPropagation(); del(a) }} title="Delete" aria-label={`Delete ${a.title}`}
                        className="ms-auto opacity-0 group-hover:opacity-100 focus:opacity-100 text-dim hover:text-error transition-opacity"><Ico s={14} d={I.trash} /></button>
                    </div>
                  </div>
                </article>)
            })}
          </div>
        </div>
      </div>
      <Progress job={job} onClose={() => { ac.current?.abort(); setJob(null) }} />
      {gen && <GenerateDialog studies={studies} onClose={() => setGen(false)} onStart={start} />}
    </div>
  )
}
