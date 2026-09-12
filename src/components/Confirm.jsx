import React, { useState, useEffect } from 'react'

// confirm() replacement in the app's own skin. Call `ask({...})` from anywhere; resolves true/false.
let handler = null
export const ask = opts => new Promise(resolve => handler?.({ ...opts, resolve }))

export default function ConfirmHost() {
  const [q, setQ] = useState(null)
  useEffect(() => { handler = setQ; return () => { handler = null } }, [])
  useEffect(() => { if (!q) return; const k = e => { if (e.key === 'Escape') done(false); if (e.key === 'Enter') done(true) }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) })
  if (!q) return null
  const done = v => { q.resolve(v); setQ(null) }
  const danger = q.danger !== false
  return (
    <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-[2px] flex items-center justify-center p-6 animate-fade-up" onClick={() => done(false)}>
      <div className="island w-full max-w-sm p-5 relative overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className={`absolute -top-16 -right-16 w-40 h-40 rounded-full blur-3xl ${danger ? 'bg-error/25' : 'bg-accent/25'}`} />
        <div className="relative flex gap-3.5">
          <div className={`w-10 h-10 rounded-xl grid place-items-center flex-shrink-0 ${danger ? 'bg-error/15 text-error' : 'bg-accent/15 text-accent'}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{danger ? <><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></> : <><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></>}</svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-white">{q.title}</div>
            {q.body && <div className="text-xs text-dim mt-1 leading-relaxed">{q.body}</div>}
          </div>
        </div>
        <div className="relative flex justify-end gap-2 mt-5">
          <button autoFocus className="btn btn-ghost" onClick={() => done(false)}>{q.cancel || 'Cancel'}</button>
          <button className={danger ? 'btn bg-error text-white hover:brightness-110' : 'btn btn-primary'} onClick={() => done(true)}>{q.ok || 'Confirm'}</button>
        </div>
      </div>
    </div>
  )
}
