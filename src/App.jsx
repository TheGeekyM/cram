import React, { useState, useEffect, useCallback } from 'react'
import HomeScreen from './screens/HomeScreen.jsx'
import StudyScreen from './screens/StudyScreen.jsx'
import NotesScreen from './screens/NotesScreen.jsx'
import SettingsModal from './components/SettingsModal.jsx'
import { api } from './api.js'

export default function App() {
  const [studies, setStudies] = useState([])
  const [study, setStudy] = useState(null)      // full study object when open
  const [screen, setScreen] = useState('home')  // home | study | notes
  const [settings, setSettings] = useState(null)
  const [showSettings, setShowSettings] = useState(false)

  const reload = useCallback(async () => setStudies(await api.get('/api/studies')), [])
  const loadSettings = useCallback(async () => { const s = await api.get('/api/settings'); setSettings(s); if (!s.hasKey) setShowSettings(true); return s }, [])
  useEffect(() => { reload(); loadSettings() }, [reload, loadSettings])
  useEffect(() => { const f = () => setShowSettings(true); window.addEventListener('cram:settings', f); return () => window.removeEventListener('cram:settings', f) }, [])

  const open = async id => { setStudy(await api.get(`/api/studies/${id}`)); setScreen('study') }
  const home = () => { setScreen('home'); setStudy(null); reload() }
  const project = study && { id: study.id, name: study.title }

  return (
    <div className="h-screen flex flex-col bg-app">
      {screen === 'home' && <HomeScreen studies={studies} onOpen={open} onCreated={open} onDeleted={reload} />}
      {screen === 'study' && study && <StudyScreen study={study} setStudy={setStudy} settings={settings} onHome={home} onNotes={() => setScreen('notes')} />}
      {screen === 'notes' && study && <NotesScreen project={project} onHome={home} onBack={() => setScreen('study')} />}
      {showSettings && <SettingsModal settings={settings} onClose={() => setShowSettings(false)} onChange={loadSettings} />}
    </div>
  )
}
