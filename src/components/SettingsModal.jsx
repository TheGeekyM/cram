import React, { useState, useEffect } from 'react'
import { api } from '../api.js'

export default function SettingsModal({ settings, onClose, onChange }) {
  const [key, setKey] = useState(''); const [model, setModel] = useState('claude-opus-5'); const [code, setCode] = useState(''); const [pending, setPending] = useState(false); const [err, setErr] = useState('')
  useEffect(() => { if (settings) { setKey(settings.apiKey || ''); setModel(settings.model) } }, [settings])
  const signedIn = settings?.source === 'claude'
  const signIn = async () => { await api.post('/api/auth/start', {}); setPending(true) }
  const finish = async () => { const r = await api.post('/api/auth/code', { code }); if (r.error) return setErr(r.error); setCode(''); setPending(false); setErr(''); onChange() }
  const signOut = async () => { await api.post('/api/auth/logout', {}); onChange() }
  const save = async () => { await api.post('/api/settings', { apiKey: key, model }); onChange(); onClose() }
  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-6" onClick={onClose}>
      <div className="island w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center mb-4"><div className="text-sm font-semibold text-white flex-1">Settings</div><button onClick={onClose} className="w-7 h-7 rounded text-dim hover:text-white hover:bg-white/5">✕</button></div>
        <div className="panel p-3 mb-4">
          <div className="flex items-center mb-2"><span className="text-xs font-semibold text-white flex-1">Claude account</span><span className={`badge ${signedIn ? 'badge-green' : ''}`}>{signedIn ? 'signed in' : 'signed out'}</span></div>
          {signedIn ? <button className="btn btn-ghost" onClick={signOut}>Sign out</button> : <>
            <button className="btn btn-primary" onClick={signIn}>Sign in with Claude</button>
            {pending && <div className="flex gap-2 mt-2"><input className="input flex-1" placeholder="Paste the code from the browser page" value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && finish()} /><button className="btn btn-primary" onClick={finish}>Finish</button></div>}
            <p className="text-[11px] text-dim mt-2">Uses your Claude subscription, like Claude Code. A browser tab opens; copy the code it shows and paste it here.</p>
          </>}
          {err && <div className="text-xs text-error mt-2">{err}</div>}
        </div>
        <label className="text-[11px] uppercase tracking-wider text-dim">API key (pay-as-you-go fallback)</label>
        <input className="input mt-1 mb-3 font-mono text-xs" value={key} onChange={e => setKey(e.target.value)} placeholder="sk-ant-…" />
        <label className="text-[11px] uppercase tracking-wider text-dim">Model</label>
        <select className="input mt-1 mb-4" value={model} onChange={e => setModel(e.target.value)}>{(settings?.models || ['claude-opus-5']).map(m => <option key={m}>{m}</option>)}</select>
        <div className="flex items-center"><span className="text-[11px] text-dim">Cram by Mohamed Emad · thegeekym@gmail.com</span><div className="flex-1" /><button className="btn btn-primary" onClick={save}>Save</button></div>
      </div>
    </div>
  )
}
