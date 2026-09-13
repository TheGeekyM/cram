import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api.js'

// Shared layout for Quiz / Interview / Code: no sessions → the animated hero centered; otherwise a
// grid of cards across every study, each opening its session full-width.
const Ico = ({ d, s = 14 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
export const Trash = <><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/></>

export const Centered = ({ children, wide }) => (
  <div className="h-full overflow-y-auto flex items-center justify-center p-2"><div className={`w-full ${wide ? 'max-w-[820px]' : 'max-w-[640px]'} my-auto`}>{children}</div></div>
)

// ---------- cross-study grid tools (Quiz / Interview / Code) ----------
// rows come from GET /api/<kind> with studyId + studyTitle; per-row responses lack those, so update() merges.
// `scope` is the one study whose sessions to show: a study's id inside its workspace, GENERAL on the generic pages.
export const GENERAL = '_general'
export function useSessions(kind, studies, scope = GENERAL) {
  const [list, setList] = useState(null)
  useEffect(() => { api.get(`/api/${kind}`).then(r => Array.isArray(r) ? setList(r.filter(x => x.studyId === scope)) : (alert(r.error || `Could not load ${kind}. Is the server up to date?`), setList([]))).catch(() => setList([])) }, [kind, scope])
  return {
    list,
    update: it => setList(l => l.map(x => x.id === it.id ? { ...x, ...it } : x)),
    add: (it, studyId) => setList(l => [{ ...it, studyId, studyTitle: studies.find(s => s.id === studyId)?.title }, ...l]),
    remove: id => setList(l => l.filter(x => x.id !== id)),
  }
}
export const StudySelect = ({ studies, value, onChange }) => (
  <select className="input w-72" value={value} onChange={e => onChange(e.target.value)}>
    <option value="" disabled>Choose a study…</option>{studies.map(st => <option key={st.id} value={st.id}>{st.title}</option>)}
  </select>
)
// A detail view's top bar, rendered inside the app header (App.jsx keeps one slot per tool) so there is one bar, not two
// The section crumb in the app header (e.g. "Interview") is the way back: App fires 'cram:back' with the tool name.
export function PageBar({ tool, onBack, children }) {
  const [el, setEl] = useState(null)
  useEffect(() => setEl(document.getElementById(`bar-${tool}`)), [tool])
  useEffect(() => {
    if (!onBack) return
    const f = e => e.detail === tool && onBack()
    window.addEventListener('cram:back', f); return () => window.removeEventListener('cram:back', f)
  }, [tool, onBack])
  return el && createPortal(<div className="flex-1 min-w-0 flex items-center gap-3 pl-1.5">{children}</div>, el) // pl-1.5 = a crumb's own padding, so both sides of › match
}

export const BackBtn = ({ onClick, title = 'Back' }) => <button onClick={onClick} className="w-7 h-7 rounded text-dim hover:text-white hover:bg-white/5 grid place-items-center flex-shrink-0" title={title}><Ico d={<path d="m15 18-6-6 6-6"/>} /></button>
export const Grid = ({ onNew, newLabel, children }) => (
  <div className="h-full overflow-y-auto p-2">
    <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
      <button onClick={onNew} className="island border-dashed border-accent/40 text-accent hover:bg-accent/10 flex flex-col items-center justify-center gap-2 p-6 min-h-[260px] transition-colors">
        <span className="w-14 h-14 rounded-2xl bg-accent/15 grid place-items-center"><Ico s={26} d={<><path d="M5 12h14"/><path d="M12 5v14"/></>} /></span>
        <span className="text-base font-semibold">{newLabel}</span>
      </button>
      {children}
    </div>
  </div>
)
// card chrome: title row, study line, body, action button, hover delete
export function Tile({ dot, title, sub, badge, study, children, action, onDelete, style }) {
  return (
    <div className="island p-5 flex flex-col gap-4 relative group" style={{ animation: 'tile-in .3s ease-out both', ...style }}>
      <style>{`@keyframes tile-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }`}</style>
      <div className="flex items-center gap-2 min-w-0 pr-7">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
        <span className="text-base font-semibold text-white truncate" title={title}>{title}</span>{sub && <span className="text-sm text-dim whitespace-nowrap">· {sub}</span>}
        <span className="ml-auto flex-shrink-0">{badge}</span>
      </div>
      {study && <div className="text-xs text-dim truncate -mt-2" title={study}>{study}</div>}
      {children}
      {action}
      <button onClick={onDelete} className="absolute top-2 right-2 w-6 h-6 rounded text-dim opacity-0 group-hover:opacity-100 hover:text-error hover:bg-white/5 grid place-items-center" title="Delete"><Ico d={Trash} /></button>
    </div>
  )
}
export const Stats = ({ items }) => (
  <div className="grid grid-cols-3 gap-2 text-center">
    {items.map(([v, l]) => <div key={l} className="rounded-lg bg-app border border-border py-3"><div className="text-xl font-mono font-semibold text-white tabular-nums">{v}</div><div className="text-[11px] text-dim mt-0.5">{l}</div></div>)}
  </div>
)
