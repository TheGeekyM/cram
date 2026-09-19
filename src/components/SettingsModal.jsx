import React, { useState, useEffect, useRef } from 'react'
import { api } from '../api.js'
import { getTheme, setTheme } from '../theme.js'
import { RemindersPanel } from './Reminders.jsx'

// Settings used to be one long scroll where the Save button sat below everything. It is now a
// rail of sections — the list on the left, one section at a time on the right, Save always in view.

const Pill = ({ on, children, onClick, disabled }) => <button disabled={disabled} onClick={onClick} className={`text-xs px-3 py-1 rounded-md capitalize ${on ? 'bg-panel-2 text-white' : 'text-dim hover:text-white'}`}>{children}</button>

function SectionTitle({ title, sub }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      {sub && <p className="text-xs text-dim mt-0.5 leading-relaxed">{sub}</p>}
    </div>
  )
}

// How Cram reaches Claude: the CLI it prefers, the account it signs into, and the paid fallback.
// The sign-in flow's state lives in the modal, not here: leaving this tab unmounts the section, and
// losing `pending` mid-OAuth would take away the code box while the browser tab is still waiting.
// A key for a provider whose CLI carries no login of its own. Saved on click, like the article
// switch: a key you typed but never saved is a provider that quietly does not work.
function ProviderKey({ p, onChange }) {
  const [v, setV] = useState('')
  const [saved, setSaved] = useState(!!p.hasKey)
  useEffect(() => { setV(''); setSaved(!!p.hasKey) }, [p.id, p.hasKey])
  const save = async () => { await api.post('/api/settings', { providerKey: { id: p.id, key: v } }); setSaved(!!v.trim()); setV(''); onChange() }
  return (
    <div className="panel p-3 mb-3">
      <div className="flex items-end gap-2">
        <div className="flex-1 min-w-0">
          <label className="text-[11px] uppercase tracking-wider text-dim">{p.key.label}</label>
          <input className="input mt-1 font-mono text-xs" type="password" value={v} onChange={e => setV(e.target.value)}
            placeholder={saved ? '•••••••• saved' : (p.key.optional ? 'optional — leave empty to use the CLI login' : 'required')} />
        </div>
        <button className="btn btn-ghost text-xs" onClick={save}>{v.trim() ? 'Save' : 'Clear'}</button>
      </div>
      {p.key.url && <a href={p.key.url} target="_blank" rel="noreferrer" className="text-[10px] text-accent hover:underline mt-1.5 inline-block">Get a key →</a>}
    </div>
  )
}

function AiSection({ settings, onChange, provider, setProvider, apiKey, setApiKey, model, setModel, auth }) {
  const { code, setCode, pending, setPending, err, setErr } = auth
  const list = settings?.providers || []
  // "provider:model" — the model half may itself hold colons, so never split naively
  const i = String(model || '').indexOf(':')
  const cur = list.find(p => p.id === (i > 0 ? String(model).slice(0, i) : '')) || list.find(p => p.id === 'claude') || null
  const isClaude = !cur || cur.id === 'claude'
  // switching provider carries the choice to that provider's first model, so Cram is never left
  // pointing at a model the new CLI has never heard of
  const pick = p => { if (p.id !== cur?.id && p.models?.[0]) setModel(`${p.id}:${p.models[0].id}`) }
  const signedIn = settings?.source === 'claude'
  const signIn = async () => { await api.post('/api/auth/start', {}); setPending(true) }
  const finish = async () => { const r = await api.post('/api/auth/code', { code }); if (r.error) return setErr(r.error); setCode(''); setPending(false); setErr(''); onChange() }
  const signOut = async () => { await api.post('/api/auth/logout', {}); onChange() }
  return (
    <div>
      <SectionTitle title="AI" sub="Which AI does the work. Each one runs through its own CLI on this computer, so it needs that CLI installed and signed in." />
      <div className="grid grid-cols-2 gap-2 mb-3">
        {list.map(p => (
          <button key={p.id} onClick={() => pick(p)}
            className={`text-start px-3 py-2.5 rounded-lg border transition-colors ${p.id === cur?.id ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/40'}`}>
            <span className={`block text-sm ${p.id === cur?.id ? 'text-white font-medium' : 'text-gray-300'}`}>{p.label}</span>
            <span className={`block text-[10px] mt-0.5 ${p.installed ? 'text-dim' : 'text-warning'}`}>
              {p.installed ? `${p.cliName} ✓ installed` : `${p.cliName} not found`}{p.hasKey ? ' · key saved' : ''}
            </span>
          </button>
        ))}
      </div>
      {cur && !cur.installed && <p className={`text-[11px] mb-3 leading-relaxed ${cur.direct ? 'text-dim' : 'text-warning'}`}>{cur.note}</p>}
      {isClaude && <>
      <div className="panel p-3 mb-3">
        <div className="flex items-center"><span className="text-xs font-semibold text-white flex-1">Claude Code CLI</span><span className={`badge ${settings?.cli ? 'badge-green' : ''}`}>{settings?.cli ? 'installed · uses your login' : 'not found'}</span></div>
        <p className="text-[11px] text-dim mt-1">Preferred when present: runs on your Claude subscription through the <span className="font-mono">claude</span> CLI, which is not throttled like raw API calls.</p>
        {/* not "Provider" any more — the grid above picks that; this is how to reach Claude */}
        <label className="text-[11px] uppercase tracking-wider text-dim mt-2 block">Connection</label>
        <select className="input mt-1" value={provider} onChange={e => setProvider(e.target.value)}><option value="auto">Auto (CLI if installed, else account / key)</option><option value="api">API only (account or key)</option></select>
      </div>
      <div className="panel p-3 mb-3">
        <div className="flex items-center mb-2"><span className="text-xs font-semibold text-white flex-1">Claude account</span><span className={`badge ${signedIn ? 'badge-green' : ''}`}>{signedIn ? 'signed in' : 'signed out'}</span></div>
        {signedIn ? <button className="btn btn-ghost" onClick={signOut}>Sign out</button> : <>
          <button className="btn btn-primary" onClick={signIn}>Sign in with Claude</button>
          {pending && <div className="flex gap-2 mt-2"><input className="input flex-1" placeholder="Paste the code from the browser page" value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && finish()} /><button className="btn btn-primary" onClick={finish}>Finish</button></div>}
          <p className="text-[11px] text-dim mt-2">Uses your Claude subscription, like Claude Code. A browser tab opens; copy the code it shows and paste it here.</p>
        </>}
        {err && <div className="text-xs text-error mt-2">{err}</div>}
      </div>
      <label className="text-[11px] uppercase tracking-wider text-dim">API key (pay-as-you-go fallback)</label>
      <input className="input mt-1 mb-3 font-mono text-xs" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-ant-…" />
      </>}
      {cur?.key && <ProviderKey p={cur} onChange={onChange} />}
      <label className="text-[11px] uppercase tracking-wider text-dim">Model</label>
      <div className="flex flex-col gap-1.5 mt-1">
        {(cur?.models || []).map(m => {
          const id = `${cur.id}:${m.id}`, on = model === id
          return (
            <label key={id} className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${on ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/40'}`}>
              <input type="radio" name="cram-model" checked={on} onChange={() => setModel(id)} className="accent-accent" />
              <span className={`text-sm ${on ? 'text-white font-medium' : 'text-gray-300'}`}>{m.label}</span>
              <span className="ms-auto text-[10px] text-dim font-mono truncate">{m.id}</span>
            </label>
          )
        })}
      </div>
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

function VoiceSection({ settings, onChange, gkey, setGkey }) {
  return (
    <div>
      <SectionTitle title="Voice" sub="What the interviewer sounds like, and the key behind the human-like voice." />
      <ElevenPanel settings={settings} onChange={onChange} />
      <label className="text-[11px] uppercase tracking-wider text-dim">Gemini API key (human-like interviewer voice)</label>
      <input className="input mt-1 font-mono text-xs" value={gkey} onChange={e => setGkey(e.target.value)} placeholder="AIza…" />
      <p className="text-[11px] text-dim mt-1">Get one at <a className="text-accent hover:underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>. Without it, questions use the Edge voice.</p>
    </div>
  )
}

// Two kinds of nudge: the in-app reminders, and one desktop notification that works with Cram closed.
function RemindersSection() {
  const [rem, setRem] = useState(null); const [err, setErr] = useState('')
  useEffect(() => { api.get('/api/reminder').then(r => r.error ? setErr(r.error) : setRem(r)) }, [])
  const setR = async patch => { const prev = rem, next = { ...rem, ...patch }; setRem(next); if (!next.enabled && !('enabled' in patch)) return; const r = await api.post('/api/reminder', next); if (r.error) { setErr(r.error); setRem(prev) } else setErr('') }
  return (
    <div>
      <SectionTitle title="Reminders" sub="When Cram should tap you on the shoulder." />
      <RemindersPanel />
      <div className="panel p-3 mb-3 flex flex-col gap-2.5">
        <div className="flex items-center gap-2"><span className="text-xs font-semibold text-white flex-1">Daily reminder when Cram is closed</span>
          {rem?.supported !== false && <>
            <select className="input w-auto py-1 text-xs" disabled={!rem} value={rem?.hour ?? 19} onChange={e => setR({ hour: +e.target.value })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>after {String(h).padStart(2, '0')}:00</option>)}</select>
            <div className="flex gap-0.5 bg-app border border-border rounded-lg p-0.5"><Pill disabled={!rem} on={rem && !rem.enabled} onClick={() => setR({ enabled: false })}>off</Pill><Pill disabled={!rem} on={rem?.enabled} onClick={() => setR({ enabled: true })}>on</Pill></div>
          </>}</div>
        <p className="text-[11px] text-dim -mt-1">{rem?.supported === false ? 'Needs Linux: it runs from cron.' : 'A desktop notification at most once a day, and only when you have not studied for 20 hours. Works even when the app is closed.'}</p>
        {err && <div className="text-xs text-error">{err}</div>}
      </div>
    </div>
  )
}

function ArticlesSection({ settings, onChange }) {
  return (
    <div>
      <SectionTitle title="Daily articles" sub="Reading material written for you while Cram is open." />
      <div className="panel p-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-white">Write two articles a day</div>
            {/* saved on click, not on Save: one switch should not depend on remembering the button below */}
            <p className="text-[11px] text-dim mt-1">Two articles a day about what you study, each a 10-minute read with a discussion under it. Written while Cram is open; they appear in Blog and ring the bell.</p>
          </div>
          <button type="button" role="switch" aria-checked={!!settings?.blogDaily} aria-label="Write two articles a day"
            onClick={async () => { await api.post('/api/settings', { blogDaily: !settings?.blogDaily }); onChange() }}
            className={`w-8 h-[18px] rounded-full relative transition-colors flex-shrink-0 ${settings?.blogDaily ? 'bg-accent' : 'bg-panel-2'}`}>
            <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all ${settings?.blogDaily ? 'left-[16px]' : 'left-[2px]'}`} />
          </button>
        </div>
      </div>
    </div>
  )
}

function AppearanceSection() {
  const [theme, setT] = useState(getTheme())
  return (
    <div>
      <SectionTitle title="Appearance" sub="Applies immediately." />
      <div className="panel p-3 flex items-center gap-2">
        <span className="text-xs font-semibold text-white flex-1">Theme</span>
        <div className="flex gap-0.5 bg-app border border-border rounded-lg p-0.5">{['dark', 'light'].map(t => <Pill key={t} on={theme === t} onClick={() => { setTheme(t); setT(t) }}>{t}</Pill>)}</div>
      </div>
    </div>
  )
}

// Phone: Cram as a home-screen app (PWA). The phone is only a screen; this computer does the work, so it must be on with Cram open.
function PhoneSection({ p }) {
  const link = `https://${p.host || '<your-pc>.<tailnet>.ts.net'}/?key=${p.key}`
  const Code = ({ children }) => <div className="font-mono text-[11px] text-white bg-app border border-border rounded-md px-2 py-1 mt-1 break-all select-all">{children}</div>
  return (
    <div>
      <SectionTitle title="Phone" sub="Cram on your phone, driven by this computer." />
      <div className="panel p-3">
        <div className="flex items-center"><span className="text-xs font-semibold text-white flex-1">Home-screen app</span><span className={`badge ${p.host ? 'badge-green' : ''}`}>{p.host ? 'Tailscale on' : 'Tailscale not found'}</span></div>
        <p className="text-[11px] text-dim mt-1">Use Cram on Android or iPhone while this computer is on and Cram is open. Install Tailscale here and on the phone (same account), then run once on this computer:</p>
        <Code>sudo tailscale serve --bg {p.port}</Code>
        <p className="text-[11px] text-dim mt-2">Open this link on the phone, then Add to Home Screen (iPhone: Safari → Share). Keep the link private: it opens your Cram.</p>
        <Code>{link}</Code>
      </div>
    </div>
  )
}

export default function SettingsModal({ settings, onClose, onChange }) {
  const [tab, setTab] = useState('ai')
  const [key, setKey] = useState(''); const [model, setModel] = useState('claude-opus-5'); const [provider, setProvider] = useState('auto')
  const [gkey, setGkey] = useState('')
  const [code, setCode] = useState(''); const [pending, setPending] = useState(false); const [authErr, setAuthErr] = useState('')
  // lifted out of the phone panel: api.get turns a 404 from an older server into { error }, not null,
  // so the panel could not tell "no Tailscale" from "this server has no phone support" — now the tab just hides.
  const [phone, setPhone] = useState(null)
  useEffect(() => { api.get('/api/phone').then(r => setPhone(r?.error ? null : r)).catch(() => setPhone(null)) }, [])
  useEffect(() => { if (settings) { setKey(settings.apiKey || ''); setGkey(settings.geminiKey || ''); setModel(settings.model); setProvider(settings.provider || 'auto') } }, [settings])
  const save = async () => { await api.post('/api/settings', { apiKey: key, geminiKey: gkey, model, provider }); onChange(); onClose() }
  useEffect(() => { const k = e => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])

  const TABS = [
    ['ai', 'AI'],
    ['voice', 'Voice'],
    ['reminders', 'Reminders'],
    ['articles', 'Daily articles'],
    ['appearance', 'Appearance'],
    ...(phone ? [['phone', 'Phone']] : []),
  ]
  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-6" onClick={onClose}>
      <div className="island w-[900px] max-w-[94vw] h-[720px] max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-start px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex-1"><h1 className="text-lg font-semibold text-white">Settings</h1><p className="text-xs text-dim mt-0.5">How Cram reaches its AI, the interviewer's voice, reminders and your keys.</p></div>
          <button onClick={onClose} title="Close (Esc)" aria-label="Close settings" className="w-7 h-7 rounded text-dim hover:text-white hover:bg-white/5">✕</button>
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="w-44 flex-shrink-0 border-e border-border py-2 bg-app/40 overflow-y-auto">
            {TABS.map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`w-full text-start px-4 py-2 text-xs transition-colors ${tab === id ? 'text-white bg-accent/10 border-e-2 border-accent font-medium' : 'text-dim hover:text-white hover:bg-white/[0.04]'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-0 overflow-y-auto p-5">
            {tab === 'ai' && <AiSection settings={settings} onChange={onChange} provider={provider} setProvider={setProvider} apiKey={key} setApiKey={setKey} model={model} setModel={setModel} auth={{ code, setCode, pending, setPending, err: authErr, setErr: setAuthErr }} />}
            {tab === 'voice' && <VoiceSection settings={settings} onChange={onChange} gkey={gkey} setGkey={setGkey} />}
            {tab === 'reminders' && <RemindersSection />}
            {tab === 'articles' && <ArticlesSection settings={settings} onChange={onChange} />}
            {tab === 'appearance' && <AppearanceSection />}
            {tab === 'phone' && phone && <PhoneSection p={phone} />}
          </div>
        </div>
        <div className="flex items-center px-5 py-3 border-t border-border flex-shrink-0">
          <span className="text-[11px] text-dim">Cram by Mohamed Emad · thegeekym@gmail.com</span><div className="flex-1" />
          <button className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}
