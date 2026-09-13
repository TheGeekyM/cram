import React, { useState, useEffect, useRef } from 'react'
import { api } from '../api.js'
import { getTheme, setTheme } from '../theme.js'
import { RemindersPanel } from './Reminders.jsx'

// Appearance and the offline daily reminder (a cron entry that runs remind.js hourly).
function Extras() {
  const [theme, setT] = useState(getTheme()); const [rem, setRem] = useState(null); const [err, setErr] = useState('')
  useEffect(() => { api.get('/api/reminder').then(r => r.error ? setErr(r.error) : setRem(r)) }, [])
  const setR = async patch => { const prev = rem, next = { ...rem, ...patch }; setRem(next); if (!next.enabled && !('enabled' in patch)) return; const r = await api.post('/api/reminder', next); if (r.error) { setErr(r.error); setRem(prev) } else setErr('') }
  const Pill = ({ on, children, onClick, disabled }) => <button disabled={disabled} onClick={onClick} className={`text-xs px-3 py-1 rounded-md capitalize ${on ? 'bg-panel-2 text-white' : 'text-dim hover:text-white'}`}>{children}</button>
  return (
    <div className="panel p-3 mb-3 flex flex-col gap-2.5">
      <div className="flex items-center gap-2"><span className="text-xs font-semibold text-white flex-1">Appearance</span>
        <div className="flex gap-0.5 bg-app border border-border rounded-lg p-0.5">{['dark', 'light'].map(t => <Pill key={t} on={theme === t} onClick={() => { setTheme(t); setT(t) }}>{t}</Pill>)}</div></div>
      <div className="flex items-center gap-2"><span className="text-xs font-semibold text-white flex-1">Daily reminder when Cram is closed</span>
        {rem?.supported !== false && <>
          <select className="input w-auto py-1 text-xs" disabled={!rem} value={rem?.hour ?? 19} onChange={e => setR({ hour: +e.target.value })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>after {String(h).padStart(2, '0')}:00</option>)}</select>
          <div className="flex gap-0.5 bg-app border border-border rounded-lg p-0.5"><Pill disabled={!rem} on={rem && !rem.enabled} onClick={() => setR({ enabled: false })}>off</Pill><Pill disabled={!rem} on={rem?.enabled} onClick={() => setR({ enabled: true })}>on</Pill></div>
        </>}</div>
      <p className="text-[11px] text-dim -mt-1">{rem?.supported === false ? 'Needs Linux: it runs from cron.' : 'A desktop notification at most once a day, and only when you have not studied for 20 hours. Works even when the app is closed.'}</p>
      {err && <div className="text-xs text-error">{err}</div>}
    </div>
  )
}

// ElevenLabs: the interviewer's voice. Key, model, and one voice per language picked from your account or its voice library.
const EL_MODELS = [['eleven_multilingual_v2', 'Multilingual v2 · natural, steady'], ['eleven_v3', 'v3 · most expressive, slower'], ['eleven_flash_v2_5', 'Flash v2.5 · fastest']]
function ElevenPanel({ settings, onChange }) {
  const [key, setKey] = useState(''); const [key2, setKey2] = useState(''); const [model, setModel] = useState('eleven_multilingual_v2'); const [lang, setLang] = useState('ar')
  const [list, setList] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [playing, setPlaying] = useState(null); const audio = useRef(null)
  useEffect(() => { if (settings) { setKey(settings.elevenKey || ''); setKey2(settings.elevenKey2 || ''); setModel(settings.elevenModel || 'eleven_multilingual_v2') } }, [settings])
  useEffect(() => () => audio.current?.pause(), [])
  const load = async (l = lang) => { setBusy(true); setErr(''); setList(null); const r = await api.get(`/api/eleven/voices?lang=${l}`); setBusy(false); if (r.error) setErr(r.error); else setList(r) }
  const connect = async () => { await api.post('/api/settings', { elevenKey: key, elevenKey2: key2, elevenModel: model }); onChange(); load() }
  const pickModel = async m => { setModel(m); await api.post('/api/settings', { elevenModel: m }); onChange() }
  const use = async v => { setBusy(true); setErr(''); const r = await api.post('/api/eleven/voice', { lang, id: v.id, owner: v.owner, name: v.name }); setBusy(false); if (r.error) return setErr(r.error); setList(x => ({ ...x, selected: r.selected })); onChange() }
  const preview = v => { audio.current?.pause(); if (playing === v.id) return setPlaying(null); const a = audio.current = new Audio(v.preview); a.onended = () => setPlaying(null); a.play().catch(() => setPlaying(null)); setPlaying(v.id) }
  // hear the voice actually speak the interview language (the library previews are mostly English)
  const tryIt = async v => {
    audio.current?.pause(); if (playing === `t:${v.id}`) return setPlaying(null)
    setPlaying(`load:${v.id}`); setErr('')
    const r = await fetch('/api/eleven/try', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: v.id, lang }) })
    if (!r.headers.get('content-type')?.startsWith('audio/')) { setPlaying(null); return setErr((await r.json().catch(() => ({}))).error || 'Could not play this voice.') }
    const a = audio.current = new Audio(URL.createObjectURL(await r.blob())); a.onended = () => setPlaying(null); a.play().catch(() => setPlaying(null)); setPlaying(`t:${v.id}`)
  }
  const [usage, setUsage] = useState(null)
  useEffect(() => { if (settings?.elevenKey) api.get('/api/eleven/usage').then(r => Array.isArray(r) && setUsage(r)) }, [settings?.elevenKey, settings?.elevenKey2])
  const chosen = settings?.elevenVoices || {}
  return (
    <div className="panel p-3 mb-3 flex flex-col gap-2">
      <div className="flex items-center gap-2"><span className="text-xs font-semibold text-white flex-1">ElevenLabs voice</span>
        {settings?.elevenKey && <span className={`badge ${chosen.ar || chosen.en ? 'badge-green' : ''}`}>{chosen.ar || chosen.en ? [chosen.ar && `ar: ${chosen.ar.name}`, chosen.en && `en: ${chosen.en.name}`].filter(Boolean).join(' · ') : 'no voice chosen'}</span>}</div>
      <div className="flex gap-2"><input className="input flex-1 font-mono text-xs" value={key} onChange={e => setKey(e.target.value)} placeholder="ElevenLabs API key (sk_…)" />
        <button className="btn btn-primary text-xs" disabled={!key || busy} onClick={connect}>{settings?.elevenKey ? 'Find voices' : 'Connect'}</button></div>
      <input className="input font-mono text-xs" value={key2} onChange={e => setKey2(e.target.value)} placeholder="Backup key (optional, used when the first runs out)" />
      {usage?.map(u => <div key={u.name} className="text-[11px]">{u.error ? <span className="text-error">{u.name === 'main' ? 'Main' : 'Backup'} key: {u.error}</span> : <>
        <div className="flex text-dim gap-2"><span>{u.name === 'main' ? 'Main key' : 'Backup key'} · {u.tier}</span><span className="ms-auto font-mono">{u.used.toLocaleString()} / {u.limit.toLocaleString()} characters · resets {new Date(u.resetAt).toLocaleDateString()}</span></div>
        <div className="h-1.5 rounded-full bg-panel-2 overflow-hidden mt-1"><div className={`h-full ${u.used / u.limit > .9 ? 'bg-error' : u.used / u.limit > .7 ? 'bg-warning' : 'bg-success'}`} style={{ width: `${Math.min(100, u.used / u.limit * 100)}%` }} /></div></>}</div>)}
      <p className="text-[11px] text-dim -mt-1">Key from <a className="text-accent hover:underline" href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer">elevenlabs.io › API keys</a>. Questions in a language with no voice chosen keep the free voice.</p>
      {settings?.elevenKey && <select className="input text-xs" value={model} onChange={e => pickModel(e.target.value)}>{EL_MODELS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select>}
      {(list || busy) && <div className="flex gap-0.5 bg-app border border-border rounded-lg p-0.5 self-start">{[['ar', 'Arabic (Egyptian)'], ['en', 'English']].map(([l, t]) => <button key={l} onClick={() => { setLang(l); load(l) }} className={`text-xs px-3 py-1 rounded-md ${lang === l ? 'bg-panel-2 text-white' : 'text-dim hover:text-white'}`}>{t}</button>)}</div>}
      {busy && <div className="text-xs text-dim py-2">Loading voices…</div>}
      {list?.tier === 'free' && <p className="text-[11px] text-warning">Free plan: only ElevenLabs' built-in voices work here. They speak Arabic, but the Egyptian library voices need a paid plan.</p>}
      {list && <div className="max-h-64 overflow-y-auto flex flex-col gap-1 -mx-1 px-1">
        {!list.voices.length && <div className="text-xs text-dim py-2">No voices found for this language.</div>}
        {list.voices.map(v => (
          <div key={v.id} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${list.selected === v.id ? 'border-accent bg-accent/10' : 'border-border'}`}>
            <button onClick={() => preview(v)} disabled={!v.preview} className="w-7 h-7 rounded-full bg-panel-2 text-white grid place-items-center flex-shrink-0 text-[10px]" title="Listen">{playing === v.id ? '■' : '▶'}</button>
            <div className="min-w-0 flex-1"><div className="text-xs text-white truncate" dir="auto">{v.name}{v.mine && <span className="text-dim"> · yours</span>}</div>
              <div className="text-[10px] text-dim truncate" dir="auto">{[v.accent, v.gender, v.age, v.about].filter(Boolean).join(' · ')}</div></div>
            {!v.locked && <button onClick={() => tryIt(v)} disabled={playing?.startsWith('load:')} className="btn-tint text-[11px] whitespace-nowrap" title={`Hear it say an interview line in ${lang === 'ar' ? 'Egyptian Arabic' : 'English'}`}>{playing === `load:${v.id}` ? '…' : playing === `t:${v.id}` ? '■ Stop' : lang === 'ar' ? '▶ عربي' : '▶ Try'}</button>}
            {list.selected === v.id ? <span className="badge badge-green">in use</span> : v.locked ? <span className="badge" title="ElevenLabs lets free plans speak only with their built-in voices through the API">paid plan</span> : <button disabled={busy} onClick={() => use(v)} className="btn-tint text-[11px]">Use</button>}
          </div>))}
      </div>}
      {err && <div className="text-xs text-error">{err}</div>}
    </div>
  )
}

export default function SettingsModal({ settings, onClose, onChange }) {
  const [key, setKey] = useState(''); const [model, setModel] = useState('claude-opus-5'); const [provider, setProvider] = useState('auto'); const [code, setCode] = useState(''); const [pending, setPending] = useState(false); const [err, setErr] = useState('')
  const [gkey, setGkey] = useState('')
  useEffect(() => { if (settings) { setKey(settings.apiKey || ''); setGkey(settings.geminiKey || ''); setModel(settings.model); setProvider(settings.provider || 'auto') } }, [settings])
  const signedIn = settings?.source === 'claude'
  const signIn = async () => { await api.post('/api/auth/start', {}); setPending(true) }
  const finish = async () => { const r = await api.post('/api/auth/code', { code }); if (r.error) return setErr(r.error); setCode(''); setPending(false); setErr(''); onChange() }
  const signOut = async () => { await api.post('/api/auth/logout', {}); onChange() }
  const [saved, setSaved] = useState(false)
  const save = async () => { await api.post('/api/settings', { apiKey: key, geminiKey: gkey, model, provider }); onChange(); setSaved(true); setTimeout(() => setSaved(false), 1800) }
  return ( // a page of its own (the Settings entry in the sidebar), not a modal
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-6">
        <div className="mb-5"><h1 className="text-xl font-semibold text-white">Settings</h1><p className="text-sm text-dim mt-0.5">How Cram reaches Claude, the interviewer's voice, reminders and your keys.</p></div>
        <div className="panel p-3 mb-3">
          <div className="flex items-center"><span className="text-xs font-semibold text-white flex-1">Claude Code CLI</span><span className={`badge ${settings?.cli ? 'badge-green' : ''}`}>{settings?.cli ? 'installed · uses your login' : 'not found'}</span></div>
          <p className="text-[11px] text-dim mt-1">Preferred when present: runs on your Claude subscription through the <span className="font-mono">claude</span> CLI, which is not throttled like raw API calls.</p>
          <label className="text-[11px] uppercase tracking-wider text-dim mt-2 block">Provider</label>
          <select className="input mt-1" value={provider} onChange={e => setProvider(e.target.value)}><option value="auto">Auto (CLI if installed, else account / key)</option><option value="api">API only (account or key)</option></select>
        </div>
        <div className="panel p-3 mb-4">
          <div className="flex items-center mb-2"><span className="text-xs font-semibold text-white flex-1">Claude account</span><span className={`badge ${signedIn ? 'badge-green' : ''}`}>{signedIn ? 'signed in' : 'signed out'}</span></div>
          {signedIn ? <button className="btn btn-ghost" onClick={signOut}>Sign out</button> : <>
            <button className="btn btn-primary" onClick={signIn}>Sign in with Claude</button>
            {pending && <div className="flex gap-2 mt-2"><input className="input flex-1" placeholder="Paste the code from the browser page" value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && finish()} /><button className="btn btn-primary" onClick={finish}>Finish</button></div>}
            <p className="text-[11px] text-dim mt-2">Uses your Claude subscription, like Claude Code. A browser tab opens; copy the code it shows and paste it here.</p>
          </>}
          {err && <div className="text-xs text-error mt-2">{err}</div>}
        </div>
        <ElevenPanel settings={settings} onChange={onChange} />
        <RemindersPanel />
        <Extras />
        <label className="text-[11px] uppercase tracking-wider text-dim">API key (pay-as-you-go fallback)</label>
        <input className="input mt-1 mb-3 font-mono text-xs" value={key} onChange={e => setKey(e.target.value)} placeholder="sk-ant-…" />
        <label className="text-[11px] uppercase tracking-wider text-dim">Gemini API key (human-like interviewer voice)</label>
        <input className="input mt-1 font-mono text-xs" value={gkey} onChange={e => setGkey(e.target.value)} placeholder="AIza…" />
        <p className="text-[11px] text-dim mt-1 mb-3">Get one at <a className="text-accent hover:underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>. Without it, questions use the Edge voice.</p>
        <label className="text-[11px] uppercase tracking-wider text-dim">Model</label>
        <select className="input mt-1 mb-4" value={model} onChange={e => setModel(e.target.value)}>{(settings?.models || ['claude-opus-5']).map(m => <option key={m}>{m}</option>)}</select>
        <div className="flex items-center"><span className="text-[11px] text-dim">Cram by Mohamed Emad · thegeekym@gmail.com</span><div className="flex-1" />{saved && <span className="text-xs text-success mr-3">Saved</span>}<button className="btn btn-primary" onClick={save}>Save</button></div>
      </div>
    </div>
  )
}
