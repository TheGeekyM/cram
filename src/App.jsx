import React, { useState, useEffect, useCallback, useRef } from 'react'
import HomeScreen from './screens/HomeScreen.jsx'
import StudyScreen from './screens/StudyScreen.jsx'
import NotesScreen from './screens/NotesScreen.jsx'
import SettingsModal from './components/SettingsModal.jsx'
import ConfirmHost from './components/Confirm.jsx'
import { api } from './api.js'

const TOOL = { ask: 'Ask', quiz: 'Quiz', interview: 'Interview', code: 'Code', notes: 'Notes' }
const HOME = 'home'

// Browser-style shell like aidle: every opened page is a tab that stays mounted (and keeps its
// state) until closed. A tab = one study × one tool. Home is pinned.
export default function App() {
  const [studies, setStudies] = useState([])          // list for Home
  const [open, setOpen] = useState({})                // studyId → full study (shared by that study's tabs)
  const [tabs, setTabs] = useState([])                // [{ key, sid, tool }]
  const [active, setActive] = useState(HOME)
  const [settings, setSettings] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const tabsRef = useRef(tabs); tabsRef.current = tabs
  const activeRef = useRef(active); activeRef.current = active

  const reload = useCallback(async () => setStudies(await api.get('/api/studies')), [])
  const loadSettings = useCallback(async () => { const s = await api.get('/api/settings'); setSettings(s); if (!s.hasKey) setShowSettings(true); return s }, [])
  useEffect(() => { reload(); loadSettings() }, [reload, loadSettings])
  useEffect(() => { const f = () => setShowSettings(true); window.addEventListener('cram:settings', f); return () => window.removeEventListener('cram:settings', f) }, [])

  const setStudy = (sid, upd) => setOpen(o => ({ ...o, [sid]: typeof upd === 'function' ? upd(o[sid]) : upd }))
  const openTool = async (sid, tool) => {
    if (!open[sid]) setStudy(sid, await api.get(`/api/studies/${sid}`))
    const key = `${sid}:${tool}`
    setTabs(t => t.some(x => x.key === key) ? t : [...t, { key, sid, tool }])
    setActive(key)
  }
  const closeTab = key => {
    const t = tabsRef.current, i = t.findIndex(x => x.key === key); if (i < 0) return
    const next = t.filter(x => x.key !== key); setTabs(next)
    if (activeRef.current === key) setActive(next[i] ? next[i].key : next[i - 1] ? next[i - 1].key : HOME)
    if (!next.some(x => x.sid === t[i].sid)) { setOpen(o => { const c = { ...o }; delete c[t[i].sid]; return c }); reload() }
  }
  const home = () => { setActive(HOME); reload() }
  const closeStudy = sid => tabsRef.current.filter(x => x.sid === sid).forEach(x => closeTab(x.key))
  // Ctrl/Cmd+W closes the active tab, like aidle
  useEffect(() => { const k = e => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'w') { e.preventDefault(); if (activeRef.current !== HOME) closeTab(activeRef.current) } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, []) // eslint-disable-line

  const label = t => `${open[t.sid]?.title || '…'} › ${TOOL[t.tool]}`
  const render = t => {
    const study = open[t.sid]; if (!study) return null
    if (t.tool === 'notes') return <NotesScreen project={{ id: study.id, name: study.title }} onHome={home} onBack={() => openTool(t.sid, 'ask')} />
    return <StudyScreen study={study} setStudy={u => setStudy(t.sid, u)} settings={settings} tool={t.tool} onHome={home} onOpenTool={tool => openTool(t.sid, tool)} />
  }
  return (
    <div className="h-screen flex flex-col bg-app">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-white/10 shrink-0 overflow-x-auto">
        <button onClick={home} className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs whitespace-nowrap ${active === HOME ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80 hover:bg-white/5'}`} title="Home">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>Home
        </button>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActive(t.key)} onAuxClick={e => { if (e.button === 1) closeTab(t.key) }}
            className={`group flex items-center gap-1.5 px-3 py-1 rounded-md text-xs whitespace-nowrap ${t.key === active ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80 hover:bg-white/5'}`}>
            {label(t)}
            <span onClick={e => { e.stopPropagation(); closeTab(t.key) }} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 leading-none" title="Close tab (Ctrl+W)">×</span>
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 relative">
        <div className={`tab-pane absolute inset-0 ${active === HOME ? '' : 'hidden'}`}>
          <HomeScreen studies={studies} onOpen={sid => openTool(sid, 'ask')} onCreated={sid => openTool(sid, 'ask')} onDeleted={sid => { if (sid) closeStudy(sid); reload() }} />
        </div>
        {tabs.map(t => <div key={t.key} className={`tab-pane absolute inset-0 ${t.key === active ? '' : 'hidden'}`}>{render(t)}</div>)}
      </div>
      <ConfirmHost />
      {showSettings && <SettingsModal settings={settings} onClose={() => setShowSettings(false)} onChange={loadSettings} />}
    </div>
  )
}
