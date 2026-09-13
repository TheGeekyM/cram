import React, { useState, useEffect, useCallback, useRef } from 'react'
import HomeScreen from './screens/HomeScreen.jsx'
import StudyWorkspace, { WS_TOOLS } from './screens/StudyWorkspace.jsx'
import Interview from './screens/Interview.jsx'
import CodeArena from './screens/CodeArena.jsx'
import Review from './screens/Review.jsx'
import Plan from './screens/Plan.jsx'
import NotesScreen from './screens/NotesScreen.jsx'
import SettingsModal from './components/SettingsModal.jsx'
import ConfirmHost from './components/Confirm.jsx'
import { ReminderHost } from './components/Reminders.jsx'
import Palette from './components/Palette.jsx'
import { NewDialog, ProfileDialog } from './components/Dialogs.jsx'
import { api } from './api.js'

// Shell: the sidebar lists pages (Dashboard, Plan, Studies) and the generic tools (Interview, Code, Review, Notes).
// Opening a study shows its workspace (page 'study'): chat plus that study's own tools. Generic Interview and
// Code sessions live in the hidden '_general' study.
// Keys: Ctrl+1…9 open the sidebar entries in order, Ctrl+K opens the quick switcher.
const Ico = ({ d, s = 15 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
export const I = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  plan: <><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></>,
  book: <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>,
  ask: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>,
  interview: <><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></>,
  code: <><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></>,
  review: <><rect x="2" y="6" width="14" height="14" rx="2"/><path d="M6 2h14a2 2 0 0 1 2 2v14"/></>,
  notes: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/></>,
  gear: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
  search: <><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></>,
  pdf: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></>,
  new: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
}
const PAGES = [['dashboard', 'Dashboard', I.grid], ['plan', 'Plan', I.plan], ['studies', 'Studies', I.book]]
const TOOLS = [['interview', 'Interview', I.interview], ['code', 'Code', I.code], ['review', 'Review', I.review], ['notes', 'Notes', I.notes]]
const ENTRIES = [...PAGES, ...TOOLS]
I.settings = I.gear
const LABELS = [...ENTRIES, ['settings', 'Settings', I.gear]] // header crumbs also name Settings, which sits at the sidebar's foot
const HOME = ['dashboard', 'studies'] // drawn by HomeScreen; every other entry has its own pane
const isPane = p => p === 'study' || p === 'settings' || (ENTRIES.some(e => e[0] === p) && !HOME.includes(p))
const WS_OF = { source: 'source', ask: 'chat', study: 'chat', chat: 'chat', interview: 'interview', code: 'code', notes: 'notes', review: 'review', coach: 'coach' } // tools a study link opens inside the workspace
const SLOTS = ['code', 'interview', 'review', 'study'] // header slots a PageBar can fill
const GLOBAL = { plan: Plan, interview: Interview, code: CodeArena, review: Review } // panes not bound to one study

// breadcrumb pieces for the app header: one separator, one style for the current page and for links back
const Crumb = {
  Sep: () => <span className="text-dim text-sm px-0.5 select-none" aria-hidden>›</span>,
  here: 'inline-flex items-center gap-1.5 px-1.5 py-1 rounded-md text-sm font-semibold text-white min-w-0',
  link: 'inline-flex items-center gap-1.5 px-1.5 py-1 rounded-md text-sm text-dim hover:text-white hover:bg-white/5 transition-colors',
}
function Sidebar({ page, go, profile, onProfile, due, onPalette, hidden }) {
  const Btn = ([id, label, ic], n) => (
    <button key={id} onClick={() => go(id)} title={`${label} (Ctrl+${n + 1})`} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${page === id ? 'bg-accent text-app font-semibold' : 'text-dim hover:text-white hover:bg-white/5'}`}>
      <Ico d={ic} />{label}
      {id === 'review' && due > 0 && <span className={`ml-auto text-[10px] font-bold min-w-[18px] text-center px-1.5 rounded-full ${page === id ? 'bg-app text-accent' : 'bg-accent text-app'}`}>{due}</span>}
    </button>
  )
  return (
    <aside className={`island w-60 flex-shrink-0 flex-col p-3 gap-1 overflow-y-auto ${hidden ? 'hidden' : 'flex'}`}>
      <div className="flex items-center gap-2 px-2 py-2"><div className="w-7 h-7 rounded-lg grid place-items-center text-sm font-bold text-app" style={{ background: 'rgb(var(--c-accent))' }}>C</div><span className="text-sm font-semibold text-white tracking-wide">CRAM</span></div>
      <button onClick={onPalette} className="flex items-center gap-2 px-3 py-1.5 mb-2 rounded-lg text-xs text-dim border border-border bg-app hover:text-white"><Ico s={13} d={I.search} />Jump to…<span className="ml-auto text-[10px] font-mono">Ctrl K</span></button>
      {PAGES.map((e, n) => Btn(e, n))}
      <div className="text-[10px] uppercase tracking-[0.18em] text-dim px-3 pt-4 pb-1">Tools</div>
      {TOOLS.map((e, n) => Btn(e, n + PAGES.length))}
      <div className="flex-1" />
      <button onClick={onProfile} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-dim hover:text-white hover:bg-white/5"><span className="w-[15px] h-[15px] rounded-full bg-accent text-app grid place-items-center text-[9px] font-bold">{profile?.name?.[0]?.toUpperCase() || '?'}</span>{profile?.name || 'Set up profile'}</button>
      <button onClick={() => go('settings')} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${page === 'settings' ? 'bg-accent text-app font-semibold' : 'text-dim hover:text-white hover:bg-white/5'}`}><Ico d={I.gear} />Settings</button>
    </aside>
  )
}

export default function App() {
  const [studies, setStudies] = useState([]); const [open, setOpen] = useState({})
  const [page, setPage] = useState('dashboard'); const [current, setCurrent] = useState(() => localStorage.getItem('cram:study') || null)
  // open tabs, like a browser: { page } or { page: 'study', sid, tool }. A pane stays mounted (keeps streams/timers) while its tab is open.
  // ponytail: one tab per page and per study (header slots and #ws-side are single ids), and only the active study tab is mounted;
  // per-tab slot ids if two tabs of the same page are ever needed
  const [tabs, setTabs] = useState([{ page: 'dashboard' }])
  const [settings, setSettings] = useState(null)
  const [profile, setProfile] = useState(null); const [editProfile, setEditProfile] = useState(false); const [stale, setStale] = useState('')
  const [newStudy, setNewStudy] = useState(null) // { mode, prefill, then: pane|null }
  const [due, setDue] = useState(0); const [palette, setPalette] = useState(false); const [wsTool, setWsTool] = useState('chat')

  const reload = useCallback(async () => setStudies(await api.get('/api/studies')), [])
  const refreshDue = useCallback(() => api.get('/api/review').then(r => setDue(r.due || 0)).catch(() => {}), [])
  const loadSettings = useCallback(async () => { const s = await api.get('/api/settings'); setSettings(s); if (!s.hasKey) goRef.current('settings'); return s }, [])
  useEffect(() => { reload(); loadSettings(); api.get('/api/profile').then(p => { if (p.error) { setStale(p.error); p = {} } setProfile(p); if (!p.name && !localStorage.getItem('cram:onboarded')) { setEditProfile(true); localStorage.setItem('cram:onboarded', '1') } }) }, [reload, loadSettings])
  useEffect(() => { const f = () => goRef.current('settings'); window.addEventListener('cram:settings', f); return () => window.removeEventListener('cram:settings', f) }, [])
  useEffect(() => { if (current) localStorage.setItem('cram:study', current); else localStorage.removeItem('cram:study') }, [current])
  useEffect(() => { refreshDue() }, [refreshDue, page])
  // drop a current study that no longer exists (deleted, or stale localStorage)
  useEffect(() => { if (studies.length && current && !studies.some(s => s.id === current)) setCurrent(null) }, [studies, current])
  const setStudy = (sid, upd) => setOpen(o => ({ ...o, [sid]: typeof upd === 'function' ? upd(o[sid]) : upd }))
  const load = async sid => { if (open[sid]) return true; const s = await api.get(`/api/studies/${sid}`).catch(() => ({ error: 'unreachable' })); if (s.error) return false; setStudy(sid, s); return true }
  // every way of opening a page lands here: it focuses that page's tab, or opens one
  const go = p => { setPage(p); if (p !== 'study') setTabs(ts => ts.some(t => t.page === p) ? ts : [...ts, { page: p }]); if (!isPane(p)) reload() }
  // open any entry; with a real study id, the study's workspace on that tool (General practice sessions stay on the generic pages)
  const openTool = async (sid, tool) => {
    if (sid && sid !== '_general' && WS_OF[tool] && await load(sid)) {
      setTabs(ts => ts.some(t => t.sid === sid) ? ts : [...ts, { page: 'study', sid, tool: WS_OF[tool] }])
      setCurrent(sid); setWsTool(WS_OF[tool]); return go('study')
    }
    go(ENTRIES.some(e => e[0] === tool) ? tool : WS_OF[tool] ? 'studies' : 'dashboard') // a study tool with no study: pick one from Studies
  }
  const isOn = t => t.sid ? page === 'study' && current === t.sid : page === t.page
  const activate = t => { if (!t.sid) return go(t.page); setCurrent(t.sid); setWsTool(t.tool || 'chat'); go('study') }
  const close = i => { const t = tabs[i], rest = tabs.filter((_, j) => j !== i); if (!rest.length) return; setTabs(rest); if (isOn(t)) activate(rest[Math.min(i, rest.length - 1)]) }
  useEffect(() => { if (page === 'study') setTabs(ts => ts.map(t => t.sid === current ? { ...t, tool: wsTool } : t)) }, [wsTool, current, page]) // a study tab reopens on the tool you left it on
  // Ctrl+1…9, Ctrl+K and Ctrl+W (close tab) by physical key, so they also work on an Arabic layout
  const goRef = useRef(go); goRef.current = go
  const closeRef = useRef(); closeRef.current = () => { const i = tabs.findIndex(isOn); if (i >= 0) close(i) }
  useEffect(() => {
    const k = e => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      const n = /^Digit([1-9])$/.exec(e.code)?.[1]
      if (n && ENTRIES[n - 1]) { e.preventDefault(); goRef.current(ENTRIES[n - 1][0]) }
      else if (e.code === 'KeyK') { e.preventDefault(); setPalette(p => !p) }
      else if (e.code === 'KeyW') { e.preventDefault(); closeRef.current() }
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [])
  // deep link: #s/<studyId>/<entry> opens that page on load (used by screenshots/tests too)
  useEffect(() => { const m = location.hash.match(/^#s\/(\w+)\/(\w+)$/); if (m) openTool(m[1], m[2]) }, []) // eslint-disable-line
  useEffect(() => { if (current && page === 'study') load(current) }, [current, page]) // eslint-disable-line

  const study = current ? open[current] : null
  const wsLabel = WS_TOOLS.find(t => t[0] === wsTool)?.[1]
  const pane = isPane(page)
  // A detail view is open in a study's workspace or Notes (they have their own sidebars), or when Code / Interview / Review filled their header slot (PageBar).
  // Then the sidebar steps aside on every page but the dashboard; the menu button in the header brings it back.
  const [slotFilled, setSlotFilled] = useState({}); const [peek, setPeek] = useState(false)
  useEffect(() => {
    const els = SLOTS.map(t => [t, document.getElementById(`bar-${t}`)]).filter(([, el]) => el)
    const sync = () => setSlotFilled(Object.fromEntries(els.map(([t, el]) => [t, el.childElementCount > 0])))
    const mo = new MutationObserver(sync); els.forEach(([, el]) => mo.observe(el, { childList: true })); sync()
    return () => mo.disconnect()
  }, [page]) // re-find the slots per page: on the very first render they may not be in the DOM yet
  const detail = page === 'study' || page === 'notes' || (page !== 'dashboard' && !!slotFilled[page])
  useEffect(() => setPeek(false), [page, detail])
  const hideSide = detail && !peek
  const created = async sid => { const then = newStudy?.then; setNewStudy(null); await reload(); openTool(sid, then || 'study') }
  return (
    <div className="h-screen flex bg-app p-2.5 gap-2.5">
      <Sidebar page={page} go={go} profile={profile} onProfile={() => setEditProfile(true)} due={due} onPalette={() => setPalette(true)} hidden={hideSide} />
      <div className="flex-1 min-w-0 flex flex-col island overflow-hidden">
        <div className="order-last flex items-center gap-1 px-2 pt-1.5 pb-2 border-t border-border bg-app/40 overflow-x-auto flex-shrink-0" role="tablist">{/* order-last: the tabs sit at the bottom of the island */}
          {tabs.map((t, i) => {
            const on = isOn(t), e = LABELS.find(x => x[0] === t.page)
            const [label, ic] = t.sid ? [open[t.sid]?.title || studies.find(s => s.id === t.sid)?.title || 'Study', I.book] : [e?.[1], e?.[2]]
            return (
              <div key={t.sid || t.page} role="tab" aria-selected={on} onMouseDown={ev => { if (ev.button === 1) { ev.preventDefault(); close(i) } }}
                className={`flex items-center gap-1 ps-3 pe-1 h-8 rounded-lg text-xs max-w-[220px] flex-shrink-0 border transition-colors ${on ? 'bg-panel border-border text-white' : 'border-transparent text-dim hover:text-white hover:bg-white/5'}`}>
                <button onClick={() => activate(t)} className="flex items-center gap-1.5 min-w-0 h-full" dir="auto"><span className={on ? 'text-accent' : ''}><Ico s={13} d={ic} /></span><span className="truncate">{label}</span></button>
                {tabs.length > 1 ? <button onClick={() => close(i)} title="Close tab (Ctrl+W)" aria-label={`Close ${label}`} className="w-5 h-5 rounded grid place-items-center text-dim hover:text-white hover:bg-white/10 flex-shrink-0"><Ico s={11} d={<><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>} /></button> : <span className="w-1" />}
              </div>
            )
          })}
        </div>
        {stale && <div className="px-4 py-2 text-xs bg-error/15 text-error border-b border-error/30 flex items-center gap-2"><b>Outdated server.</b><span className="flex-1 truncate">{stale}</span><button onClick={() => setStale('')} className="opacity-70 hover:opacity-100">✕</button></div>}
        {( // always mounted so the per-tool bar slots survive page switches; hidden where no header belongs
          <div className={`app-bar min-h-11 py-1 flex items-center gap-1 px-3 border-b border-border bg-panel flex-shrink-0 ${pane && page !== 'plan' && page !== 'notes' ? '' : 'hidden'}`}>{/* Notes brings its own NavBar */}
            {detail && <button onClick={() => setPeek(v => !v)} title={peek ? 'Hide menu' : 'Show menu'} aria-label={peek ? 'Hide menu' : 'Show menu'} className="w-7 h-7 rounded-md text-dim hover:text-white hover:bg-white/5 grid place-items-center flex-shrink-0"><Ico d={<><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></>} /></button>}
            <button onClick={() => go('dashboard')} title="Home" aria-label="Home" className="w-7 h-7 rounded-md text-dim hover:text-white hover:bg-white/5 grid place-items-center flex-shrink-0"><span className="block -translate-y-px" aria-hidden><Ico d={<><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></>} /></span></button>{/* lifted 1px: a house reads low next to text */}
            <Crumb.Sep />
            {page === 'study' ? <>
              <button onClick={() => go('studies')} className={Crumb.link}><span className="text-dim"><Ico d={I.book} /></span>Studies</button>
              <Crumb.Sep />
              {wsTool === 'chat'
                ? <span className={`${Crumb.here} max-w-[320px]`} dir="auto"><span className="truncate">{study?.title || 'Loading…'}</span></span>
                : <button onClick={() => setWsTool('chat')} title="Back to the chat" className={`${Crumb.link} max-w-[260px] min-w-0`} dir="auto"><span className="truncate">{study?.title}</span></button>}
              {wsTool !== 'chat' && <><Crumb.Sep />{slotFilled.study
                ? <button onClick={() => window.dispatchEvent(new CustomEvent('cram:back', { detail: 'study' }))} title={`Back to ${wsLabel}`} className={Crumb.link}>{wsLabel}</button>
                : <span className={Crumb.here}>{wsLabel}</span>}</>}
              {slotFilled.study && <Crumb.Sep />}
            </> : <>
              <span className="app-title flex items-center">
                {slotFilled[page]
                  ? <button onClick={() => window.dispatchEvent(new CustomEvent('cram:back', { detail: page }))} title={`Back to ${LABELS.find(t => t[0] === page)?.[1]}`} className={Crumb.link}><span className="text-dim"><Ico d={I[page] || I.grid} /></span>{LABELS.find(t => t[0] === page)?.[1]}</button>
                  : <span className={Crumb.here}><span className="text-dim"><Ico d={I[page] || I.grid} /></span>{LABELS.find(t => t[0] === page)?.[1]}</span>}
              </span>
              {slotFilled[page] && <Crumb.Sep />}
            </>}
            {SLOTS.map(t => <div key={t} id={`bar-${t}`} className={`bar-slot flex-1 min-w-0 ${page === t ? 'flex' : 'hidden'}`} />)}
          </div>
        )}
        <div className="flex-1 min-h-0 relative">
          <div className={`absolute inset-0 ${pane ? 'hidden' : ''}`}>
            <HomeScreen section={HOME.includes(page) ? page : 'dashboard'} studies={studies} settings={settings} profile={profile} onEditProfile={() => setEditProfile(true)}
              onOpen={(sid, tool) => openTool(sid, tool || 'study')} onOpenTool={openTool} onNew={(mode, prefill) => setNewStudy({ mode: mode || 'subject', prefill })} onDeleted={sid => { if (sid === current) setCurrent(null); setTabs(ts => ts.filter(t => t.sid !== sid)); setOpen(o => { const c = { ...o }; delete c[sid]; return c }); reload() }} />
          </div>
          {page === 'study' && !study && <div className="absolute inset-0 grid place-items-center text-xs text-dim">{current ? 'Loading…' : 'Pick a study from Studies.'}</div>}
          {Object.entries(GLOBAL).map(([t, Tool]) => (tabs.some(x => x.page === t) || t === page) && <div key={t} className={`absolute inset-0 ${page === t ? '' : 'hidden'}`}><Tool studies={studies} onChanged={refreshDue} onOpenTool={openTool} /></div>)}
          {(tabs.some(x => x.page === 'notes') || page === 'notes') &&<div className={`absolute inset-0 ${page === 'notes' ? '' : 'hidden'}`}><NotesScreen project={{ id: 'notes', name: 'Notes' }} onHome={() => go('dashboard')} /></div>}
          {page === 'settings' && <div className="absolute inset-0"><SettingsModal settings={settings} onChange={loadSettings} /></div>}
          {study && page === 'study' && <div key={study.id} className="absolute inset-0"><StudyWorkspace study={study} setStudy={u => setStudy(study.id, u)} tool={wsTool} setTool={setWsTool} onChanged={refreshDue} /></div>}
        </div>
      </div>
      <div id="ws-side" className={page === 'study' && study ? 'contents' : 'hidden'} />{/* the study tools card lands here: its own island beside the page, like the main sidebar */}
      <ConfirmHost />
      <ReminderHost />
      {palette && <Palette entries={ENTRIES} studies={studies} onClose={() => setPalette(false)} onGo={id => { setPalette(false); go(id) }} onStudy={sid => { setPalette(false); openTool(sid, 'study') }} />}
      {newStudy && <NewDialog mode={newStudy.mode} prefill={newStudy.prefill} onClose={() => setNewStudy(null)} onCreated={created} />}
      {editProfile && <ProfileDialog profile={profile || {}} onSave={p => { setProfile(p); setEditProfile(false) }} onClose={() => setEditProfile(false)} />}
    </div>
  )
}
