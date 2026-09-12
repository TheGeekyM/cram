import React, { useState, useEffect } from 'react'
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

export default function SettingsModal({ settings, onClose, onChange }) {
  const [key, setKey] = useState(''); const [model, setModel] = useState('claude-opus-5'); const [provider, setProvider] = useState('auto'); const [code, setCode] = useState(''); const [pending, setPending] = useState(false); const [err, setErr] = useState('')
  useEffect(() => { if (settings) { setKey(settings.apiKey || ''); setModel(settings.model); setProvider(settings.provider || 'auto') } }, [settings])
  const signedIn = settings?.source === 'claude'
  const signIn = async () => { await api.post('/api/auth/start', {}); setPending(true) }
  const finish = async () => { const r = await api.post('/api/auth/code', { code }); if (r.error) return setErr(r.error); setCode(''); setPending(false); setErr(''); onChange() }
  const signOut = async () => { await api.post('/api/auth/logout', {}); onChange() }
  const save = async () => { await api.post('/api/settings', { apiKey: key, model, provider }); onChange(); onClose() }
  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-6" onClick={onClose}>
      <div className="island w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center mb-4"><div className="text-sm font-semibold text-white flex-1">Settings</div><button onClick={onClose} className="w-7 h-7 rounded text-dim hover:text-white hover:bg-white/5">✕</button></div>
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
        <RemindersPanel />
        <Extras />
        <label className="text-[11px] uppercase tracking-wider text-dim">API key (pay-as-you-go fallback)</label>
        <input className="input mt-1 mb-3 font-mono text-xs" value={key} onChange={e => setKey(e.target.value)} placeholder="sk-ant-…" />
        <label className="text-[11px] uppercase tracking-wider text-dim">Model</label>
        <select className="input mt-1 mb-4" value={model} onChange={e => setModel(e.target.value)}>{(settings?.models || ['claude-opus-5']).map(m => <option key={m}>{m}</option>)}</select>
        <div className="flex items-center"><span className="text-[11px] text-dim">Cram by Mohamed Emad · thegeekym@gmail.com</span><div className="flex-1" /><button className="btn btn-primary" onClick={save}>Save</button></div>
      </div>
    </div>
  )
}
