import React, { useState, useEffect, useCallback, useRef } from 'react'
import HomeScreen from './screens/HomeScreen.jsx'
import StudyScreen from './screens/StudyScreen.jsx'
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

// Tool-first shell: the sidebar lists pages (Dashboard, Plan, Studies) and tools (Ask, Interview, Code,
// Review, Notes). Ask works on the current study; the others span every study.
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
const TOOLS = [['ask', 'Ask', I.ask], ['interview', 'Interview', I.interview], ['code', 'Code', I.code], ['review', 'Review', I.review], ['notes', 'Notes', I.notes]]
const ENTRIES = [...PAGES, ...TOOLS]
const HOME = ['dashboard', 'studies'] // drawn by HomeScreen; every other entry has its own pane
const isPane = p => ENTRIES.some(e => e[0] === p) && !HOME.includes(p)
const GLOBAL = { plan: Plan, interview: Interview, code: CodeArena, review: Review } // panes not bound to one study

function Sidebar({ page, go, profile, onProfile, due, onPalette }) {
  const Btn = ([id, label, ic], n) => (
    <button key={id} onClick={() => go(id)} title={`${label} (Ctrl+${n + 1})`} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${page === id ? 'bg-accent text-app font-semibold' : 'text-dim hover:text-white hover:bg-white/5'}`}>
      <Ico d={ic} />{label}
      {id === 'review' && due > 0 && <span className={`ml-auto text-[10px] font-bold min-w-[18px] text-center px-1.5 rounded-full ${page === id ? 'bg-app text-accent' : 'bg-accent text-app'}`}>{due}</span>}
    </button>
  )
  return (
    <aside className="island w-52 flex-shrink-0 flex flex-col p-3 gap-1 overflow-y-auto">
      <div className="flex items-center gap-2 px-2 py-2"><div className="w-7 h-7 rounded-lg grid place-items-center text-sm font-bold text-app" style={{ background: 'rgb(var(--c-accent))' }}>C</div><span className="text-sm font-semibold text-white tracking-wide">CRAM</span></div>
      <button onClick={onPalette} className="flex items-center gap-2 px-3 py-1.5 mb-2 rounded-lg text-xs text-dim border border-border bg-app hover:text-white"><Ico s={13} d={I.search} />Jump to…<span className="ml-auto text-[10px] font-mono">Ctrl K</span></button>
      {PAGES.map((e, n) => Btn(e, n))}
      <div className="text-[10px] uppercase tracking-[0.18em] text-dim px-3 pt-4 pb-1">Tools</div>
      {TOOLS.map((e, n) => Btn(e, n + PAGES.length))}
      <div className="flex-1" />
      <button onClick={onProfile} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-dim hover:text-white hover:bg-white/5"><span className="w-[15px] h-[15px] rounded-full bg-accent text-app grid place-items-center text-[9px] font-bold">{profile?.name?.[0]?.toUpperCase() || '?'}</span>{profile?.name || 'Set up profile'}</button>
      <button onClick={() => window.dispatchEvent(new Event('cram:settings'))} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-dim hover:text-white hover:bg-white/5"><Ico d={I.gear} />Settings</button>
    </aside>
  )
}

// Pick the study Ask works on: a card grid when none is chosen, a dropdown once one is.
function StudyPicker({ studies, current, onPick, onNew }) {
  return (
    <div className="h-full overflow-y-auto hero-glow">
      <div className="px-6 pt-[8vh] pb-10">
        <div className="w-12 h-12 rounded-2xl bg-accent/15 text-accent grid place-items-center mb-3"><Ico s={22} d={I.ask} /></div>
        <h1 className="text-2xl font-semibold text-white">Ask: pick a study</h1>
        <p className="text-sm text-dim mt-1 mb-5">Ask answers from one study's material. Choose one here, or switch later from the dropdown at the top.</p>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {studies.map(s => <button key={s.id} onClick={() => onPick(s.id)} className={`island p-4 text-left hover:border-accent/50 transition-colors ${s.id === current ? 'border-accent' : ''}`}>
            <div className="flex items-center gap-2 text-dim mb-2"><Ico d={s.hasPdf ? I.pdf : I.book} /><span className="text-[11px] ml-auto">{new Date(s.updatedAt).toLocaleDateString()}</span></div>
            <div className="text-sm font-semibold text-white truncate">{s.title}</div><div className="text-[11px] text-dim truncate">{s.subject || (s.hasPdf ? 'PDF' : '')}</div>
          </button>)}
          <button onClick={onNew} className="island p-4 text-left border-dashed hover:border-accent/50 transition-colors flex flex-col justify-center items-center gap-1 text-dim hover:text-white min-h-[96px]"><Ico s={20} d={I.new} /><span className="text-xs">New study</span></button>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [studies, setStudies] = useState([]); const [open, setOpen] = useState({})
  const [page, setPage] = useState('dashboard'); const [current, setCurrent] = useState(() => localStorage.getItem('cram:study') || null)
  const [visited, setVisited] = useState({}) // pane → true once shown, so panes stay mounted (and keep streams/timers) while you move around
  const [settings, setSettings] = useState(null); const [showSettings, setShowSettings] = useState(false)
  const [profile, setProfile] = useState(null); const [editProfile, setEditProfile] = useState(false); const [stale, setStale] = useState('')
  const [newStudy, setNewStudy] = useState(null) // { mode, prefill, then: pane|null }
  const [due, setDue] = useState(0); const [palette, setPalette] = useState(false)

  const reload = useCallback(async () => setStudies(await api.get('/api/studies')), [])
  const refreshDue = useCallback(() => api.get('/api/review').then(r => setDue(r.due || 0)).catch(() => {}), [])
  const loadSettings = useCallback(async () => { const s = await api.get('/api/settings'); setSettings(s); if (!s.hasKey) setShowSettings(true); return s }, [])
  useEffect(() => { reload(); loadSettings(); api.get('/api/profile').then(p => { if (p.error) { setStale(p.error); p = {} } setProfile(p); if (!p.name && !localStorage.getItem('cram:onboarded')) { setEditProfile(true); localStorage.setItem('cram:onboarded', '1') } }) }, [reload, loadSettings])
  useEffect(() => { const f = () => setShowSettings(true); window.addEventListener('cram:settings', f); return () => window.removeEventListener('cram:settings', f) }, [])
  useEffect(() => { if (current) localStorage.setItem('cram:study', current); else localStorage.removeItem('cram:study') }, [current])
  useEffect(() => { refreshDue() }, [refreshDue, page])
  // drop a current study that no longer exists (deleted, or stale localStorage)
  useEffect(() => { if (studies.length && current && !studies.some(s => s.id === current)) setCurrent(null) }, [studies, current])
  const setStudy = (sid, upd) => setOpen(o => ({ ...o, [sid]: typeof upd === 'function' ? upd(o[sid]) : upd }))
  const load = async sid => { if (open[sid]) return true; const s = await api.get(`/api/studies/${sid}`).catch(() => ({ error: 'unreachable' })); if (s.error) return false; setStudy(sid, s); return true }
  const go = p => { setPage(p); if (isPane(p)) setVisited(v => ({ ...v, [p]: true })); else reload() }
  // open any entry, optionally making `sid` the current study (Ask uses it; the others span every study)
  const openTool = async (sid, tool) => { if (sid && await load(sid)) setCurrent(sid); else if (tool === 'ask' && sid) setCurrent(null); go(ENTRIES.some(e => e[0] === tool) ? tool : 'dashboard') }
  const pick = async sid => { if (await load(sid)) setCurrent(sid) }
  // Ctrl+1…9 and Ctrl+K by physical key, so they also work on an Arabic layout
  const goRef = useRef(go); goRef.current = go
  useEffect(() => {
    const k = e => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      const n = /^Digit([1-9])$/.exec(e.code)?.[1]
      if (n && ENTRIES[n - 1]) { e.preventDefault(); goRef.current(ENTRIES[n - 1][0]) }
      else if (e.code === 'KeyK') { e.preventDefault(); setPalette(p => !p) }
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [])
  // deep link: #s/<studyId>/<entry> opens that page on load (used by screenshots/tests too)
  useEffect(() => { const m = location.hash.match(/^#s\/(\w+)\/(\w+)$/); if (m) openTool(m[1], m[2]) }, []) // eslint-disable-line
  useEffect(() => { if (current && page === 'ask') load(current) }, [current, page]) // eslint-disable-line

  const study = current ? open[current] : null
  const pane = isPane(page)
  const created = async sid => { const then = newStudy?.then; setNewStudy(null); await reload(); openTool(sid, then || 'ask') }
  return (
    <div className="h-screen flex bg-app p-2.5 gap-2.5">
      <Sidebar page={page} go={go} profile={profile} onProfile={() => setEditProfile(true)} due={due} onPalette={() => setPalette(true)} />
      <div className="flex-1 min-w-0 flex flex-col island overflow-hidden">
        {stale && <div className="px-4 py-2 text-xs bg-error/15 text-error border-b border-error/30 flex items-center gap-2"><b>Outdated server.</b><span className="flex-1 truncate">{stale}</span><button onClick={() => setStale('')} className="opacity-70 hover:opacity-100">✕</button></div>}
        {( // always mounted so the per-tool bar slots survive page switches; hidden where no header belongs
          <div className={`app-bar min-h-11 py-1 flex items-center gap-2 px-3 border-b border-border bg-panel flex-shrink-0 ${pane && page !== 'plan' ? '' : 'hidden'}`}>
            <span className="app-title flex items-center gap-2"><span className="text-dim"><Ico d={I[page] || I.grid} /></span><span className="text-sm font-semibold text-white">{ENTRIES.find(t => t[0] === page)?.[1]}</span></span>
            {['code', 'interview', 'review'].map(t => <div key={t} id={`bar-${t}`} className={`bar-slot flex-1 min-w-0 ${page === t ? 'flex' : 'hidden'}`} />)}
            {page === 'ask' && <><span className="text-dim mx-1">›</span>
              <select className="input w-auto py-1 max-w-[280px]" value={current || ''} onChange={e => e.target.value === '+' ? setNewStudy({ mode: 'subject', then: page }) : pick(e.target.value)}>
                <option value="" disabled>Choose a study…</option>{studies.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}<option value="+">+ New study…</option>
              </select>
              {study && <span className="text-xs text-dim truncate hidden md:inline">{study.subject}</span>}</>}
          </div>
        )}
        <div className="flex-1 min-h-0 relative">
          <div className={`absolute inset-0 ${pane ? 'hidden' : ''}`}>
            <HomeScreen section={HOME.includes(page) ? page : 'dashboard'} studies={studies} settings={settings} profile={profile} onEditProfile={() => setEditProfile(true)}
              onOpen={sid => openTool(sid, 'ask')} onOpenTool={openTool} onNew={(mode, prefill) => setNewStudy({ mode: mode || 'subject', prefill })} onDeleted={sid => { if (sid === current) setCurrent(null); setOpen(o => { const c = { ...o }; delete c[sid]; return c }); reload() }} />
          </div>
          {page === 'ask' && !current && <div className="absolute inset-0"><StudyPicker studies={studies} current={current} onPick={pick} onNew={() => setNewStudy({ mode: 'subject', then: page })} /></div>}
          {page === 'ask' && current && !study && <div className="absolute inset-0 grid place-items-center text-xs text-dim">Loading…</div>}
          {Object.entries(GLOBAL).map(([t, Tool]) => (visited[t] || t === page) && <div key={t} className={`absolute inset-0 ${page === t ? '' : 'hidden'}`}><Tool studies={studies} onChanged={refreshDue} onOpenTool={openTool} /></div>)}
          {(visited.notes || page === 'notes') && <div className={`absolute inset-0 ${page === 'notes' ? '' : 'hidden'}`}><NotesScreen project={{ id: 'notes', name: 'Notes' }} onHome={() => go('dashboard')} onBack={() => go('ask')} /></div>}
          {study && (visited.ask || page === 'ask') && <div key={`${study.id}:ask`} className={`absolute inset-0 ${page === 'ask' ? '' : 'hidden'}`}><StudyScreen study={study} setStudy={u => setStudy(study.id, u)} /></div>}
        </div>
      </div>
      <ConfirmHost />
      <ReminderHost />
      {palette && <Palette entries={ENTRIES} studies={studies} onClose={() => setPalette(false)} onGo={id => { setPalette(false); go(id) }} onStudy={sid => { setPalette(false); openTool(sid, 'ask') }} />}
      {showSettings && <SettingsModal settings={settings} onClose={() => setShowSettings(false)} onChange={loadSettings} />}
      {newStudy && <NewDialog mode={newStudy.mode} prefill={newStudy.prefill} onClose={() => setNewStudy(null)} onCreated={created} />}
      {editProfile && <ProfileDialog profile={profile || {}} onSave={p => { setProfile(p); setEditProfile(false) }} onClose={() => setEditProfile(false)} />}
    </div>
  )
}
