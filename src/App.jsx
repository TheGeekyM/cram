import React, { useState, useEffect, useCallback } from 'react'
import HomeScreen from './screens/HomeScreen.jsx'
import StudyScreen from './screens/StudyScreen.jsx'
import Interview from './screens/Interview.jsx'
import Quiz from './screens/Quiz.jsx'
import CodeArena from './screens/CodeArena.jsx'
import NotesScreen from './screens/NotesScreen.jsx'
import SettingsModal from './components/SettingsModal.jsx'
import ConfirmHost from './components/Confirm.jsx'
import { NewDialog, ProfileDialog } from './components/Dialogs.jsx'
import { api } from './api.js'

// Tool-first shell: the sidebar lists pages (Dashboard, Studies) and tools (Ask, Quiz,
// Interview, Code, Notes). Ask works on the current study; the others list sessions across every study.
const Ico = ({ d, s = 15 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
export const I = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  book: <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>,
  ask: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>,
  quiz: <><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>,
  interview: <><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></>,
  code: <><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></>,
  notes: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/></>,
  gear: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
  pdf: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></>,
  new: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
}
const PAGES = [['dashboard', 'Dashboard', I.grid], ['studies', 'Studies', I.book]]
const TOOLS = [['ask', 'Ask', I.ask], ['quiz', 'Quiz', I.quiz], ['interview', 'Interview', I.interview], ['code', 'Code', I.code], ['notes', 'Notes', I.notes]]
const isTool = p => TOOLS.some(t => t[0] === p)
const GLOBAL = { quiz: Quiz, interview: Interview, code: CodeArena } // tools not bound to one study

function Sidebar({ page, go, profile, onProfile }) {
  const Btn = ([id, label, ic]) => <button key={id} onClick={() => go(id)} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${page === id ? 'bg-accent text-app font-semibold' : 'text-dim hover:text-white hover:bg-white/5'}`}><Ico d={ic} />{label}</button>
  return (
    <aside className="island w-52 flex-shrink-0 flex flex-col p-3 gap-1 overflow-y-auto">
      <div className="flex items-center gap-2 px-2 py-2 mb-2"><div className="w-7 h-7 rounded-lg grid place-items-center text-sm font-bold text-app" style={{ background: 'rgb(var(--c-accent))' }}>C</div><span className="text-sm font-semibold text-white tracking-wide">CRAM</span></div>
      {PAGES.map(Btn)}
      <div className="text-[10px] uppercase tracking-[0.18em] text-dim px-3 pt-4 pb-1">Tools</div>
      {TOOLS.map(Btn)}
      <div className="flex-1" />
      <button onClick={onProfile} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-dim hover:text-white hover:bg-white/5"><span className="w-[15px] h-[15px] rounded-full bg-accent text-app grid place-items-center text-[9px] font-bold">{profile?.name?.[0]?.toUpperCase() || '?'}</span>{profile?.name || 'Set up profile'}</button>
      <button onClick={() => window.dispatchEvent(new Event('cram:settings'))} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-dim hover:text-white hover:bg-white/5"><Ico d={I.gear} />Settings</button>
    </aside>
  )
}

// Pick the study a tool works on: a card grid when none is chosen, a dropdown once one is.
function StudyPicker({ studies, current, onPick, onNew, tool }) {
  const label = TOOLS.find(t => t[0] === tool)?.[1]
  return (
    <div className="h-full overflow-y-auto hero-glow">
      <div className="px-6 pt-[8vh] pb-10">
        <div className="w-12 h-12 rounded-2xl bg-accent/15 text-accent grid place-items-center mb-3"><Ico s={22} d={I[tool]} /></div>
        <h1 className="text-2xl font-semibold text-white">{label}: pick a study</h1>
        <p className="text-sm text-dim mt-1 mb-5">Every tool works on one study at a time. Choose one here, or switch later from the dropdown at the top.</p>
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
  const [visited, setVisited] = useState({}) // tool → true once shown, so tool panes stay mounted (and keep streams/timers) while you move around
  const [settings, setSettings] = useState(null); const [showSettings, setShowSettings] = useState(false)
  const [profile, setProfile] = useState(null); const [editProfile, setEditProfile] = useState(false); const [stale, setStale] = useState('')
  const [newStudy, setNewStudy] = useState(null) // { mode, prefill, then: 'tool'|null }

  const reload = useCallback(async () => setStudies(await api.get('/api/studies')), [])
  const loadSettings = useCallback(async () => { const s = await api.get('/api/settings'); setSettings(s); if (!s.hasKey) setShowSettings(true); return s }, [])
  useEffect(() => { reload(); loadSettings(); api.get('/api/profile').then(p => { if (p.error) { setStale(p.error); p = {} } setProfile(p); if (!p.name && !localStorage.getItem('cram:onboarded')) { setEditProfile(true); localStorage.setItem('cram:onboarded', '1') } }) }, [reload, loadSettings])
  useEffect(() => { const f = () => setShowSettings(true); window.addEventListener('cram:settings', f); return () => window.removeEventListener('cram:settings', f) }, [])
  useEffect(() => { if (current) localStorage.setItem('cram:study', current); else localStorage.removeItem('cram:study') }, [current])
  // drop a current study that no longer exists (deleted, or stale localStorage)
  useEffect(() => { if (studies.length && current && !studies.some(s => s.id === current)) setCurrent(null) }, [studies, current])
  const setStudy = (sid, upd) => setOpen(o => ({ ...o, [sid]: typeof upd === 'function' ? upd(o[sid]) : upd }))
  const load = async sid => { if (open[sid]) return true; const s = await api.get(`/api/studies/${sid}`).catch(() => ({ error: 'unreachable' })); if (s.error) return false; setStudy(sid, s); return true }
  const go = p => { setPage(p); if (isTool(p)) setVisited(v => ({ ...v, [p]: true })); if (!isTool(p)) reload() }
  const openTool = async (sid, tool) => { const ok = await load(sid); setCurrent(ok ? sid : null); setVisited({}); go(tool) } // unknown study → the tool's picker
  const pick = async sid => { if (await load(sid)) { setCurrent(sid); setVisited({ [page]: true }) } }
  // deep link: #s/<studyId>/<tool> opens that tool on load (used by screenshots/tests too)
  useEffect(() => { const m = location.hash.match(/^#s\/(\w+)\/(\w+)$/); if (m && isTool(m[2])) openTool(m[1], m[2]) }, []) // eslint-disable-line
  useEffect(() => { if (current && isTool(page)) load(current) }, [current, page]) // eslint-disable-line

  const study = current ? open[current] : null
  const tool = isTool(page)
  const created = async sid => { const then = newStudy?.then; setNewStudy(null); await reload(); if (then && isTool(then)) openTool(sid, then); else { setCurrent(sid); await load(sid); go('ask') } }
  return (
    <div className="h-screen flex bg-app p-2.5 gap-2.5">
      <Sidebar page={page} go={go} profile={profile} onProfile={() => setEditProfile(true)} />
      <div className="flex-1 min-w-0 flex flex-col island overflow-hidden">
        {stale && <div className="px-4 py-2 text-xs bg-error/15 text-error border-b border-error/30 flex items-center gap-2"><b>Outdated server.</b><span className="flex-1 truncate">{stale}</span><button onClick={() => setStale('')} className="opacity-70 hover:opacity-100">✕</button></div>}
        {tool && (
          <div className="h-11 flex items-center gap-2 px-3 border-b border-border bg-panel flex-shrink-0">
            <span className="text-dim"><Ico d={I[page]} /></span><span className="text-sm font-semibold text-white">{TOOLS.find(t => t[0] === page)[1]}</span>
            {page === 'ask' && <><span className="text-dim mx-1">›</span>
            <select className="input w-auto py-1 max-w-[280px]" value={current || ''} onChange={e => e.target.value === '+' ? setNewStudy({ mode: 'subject', then: page }) : pick(e.target.value)}>
              <option value="" disabled>Choose a study…</option>{studies.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}<option value="+">+ New study…</option>
            </select>
            {study && <span className="text-xs text-dim truncate hidden md:inline">{study.subject}</span>}</>}
            <div className="flex-1" />
            {settings && <span className={`badge ${settings.hasKey ? 'badge-green' : 'badge-red'}`}>{settings.hasKey ? `${settings.source === 'cli' ? 'CLI' : settings.source === 'claude' ? 'Claude' : 'key'} · ${settings.model.replace('claude-', '')}` : 'not signed in'}</span>}
          </div>
        )}
        <div className="flex-1 min-h-0 relative">
          <div className={`absolute inset-0 ${tool ? 'hidden' : ''}`}>
            <HomeScreen section={tool ? 'dashboard' : page} studies={studies} settings={settings} profile={profile} onEditProfile={() => setEditProfile(true)}
              onOpen={sid => openTool(sid, 'ask')} onOpenTool={openTool} onNew={(mode, prefill) => setNewStudy({ mode: mode || 'subject', prefill })} onDeleted={sid => { if (sid === current) setCurrent(null); setOpen(o => { const c = { ...o }; delete c[sid]; return c }); reload() }} />
          </div>
          {page === 'ask' && !current && <div className="absolute inset-0"><StudyPicker studies={studies} current={current} tool={page} onPick={pick} onNew={() => setNewStudy({ mode: 'subject', then: page })} /></div>}
          {page === 'ask' && current && !study && <div className="absolute inset-0 grid place-items-center text-xs text-dim">Loading…</div>}
          {Object.entries(GLOBAL).map(([t, Tool]) => (visited[t] || t === page) && <div key={t} className={`absolute inset-0 ${page === t ? '' : 'hidden'}`}><Tool studies={studies} /></div>)}
          {(visited.notes || page === 'notes') && <div className={`absolute inset-0 ${page === 'notes' ? '' : 'hidden'}`}><NotesScreen project={{ id: 'notes', name: 'Notes' }} onHome={() => go('dashboard')} onBack={() => go('ask')} /></div>}
          {study && (visited.ask || page === 'ask') && <div key={`${study.id}:ask`} className={`absolute inset-0 ${page === 'ask' ? '' : 'hidden'}`}><StudyScreen study={study} setStudy={u => setStudy(study.id, u)} /></div>}
        </div>
      </div>
      <ConfirmHost />
      {showSettings && <SettingsModal settings={settings} onClose={() => setShowSettings(false)} onChange={loadSettings} />}
      {newStudy && <NewDialog mode={newStudy.mode} prefill={newStudy.prefill} onClose={() => setNewStudy(null)} onCreated={created} />}
      {editProfile && <ProfileDialog profile={profile || {}} onSave={p => { setProfile(p); setEditProfile(false) }} onClose={() => setEditProfile(false)} />}
    </div>
  )
}
