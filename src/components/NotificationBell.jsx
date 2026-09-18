import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNotifications, markRead, markAllRead, dismiss, clearAll, openNotification } from '../notify.js'

const Ico = ({ d, s = 15 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
const BELL = <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></>
const ago = t => { const m = Math.floor((Date.now() - t) / 60000); if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`; const h = Math.floor(m / 60); return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago` }

// Everything that arrived on its own — today's articles, a generation that finished while you were elsewhere.
export default function NotificationBell() {
  const { items, unread } = useNotifications()
  const [open, setOpen] = useState(false); const [ring, setRing] = useState(false)
  const box = useRef(null); const panelRef = useRef(null); const last = useRef(items.length)
  const [pos, setPos] = useState(null)
  // Measured from the bell each time it opens, because the panel is rendered onto document.body:
  // the sidebar scrolls, and a scroll container clips absolutely positioned children.
  const toggle = () => {
    if (open) return setOpen(false)
    const r = box.current?.getBoundingClientRect(); if (!r) return
    setPos(r.top < window.innerHeight / 2
      ? { right: Math.max(8, window.innerWidth - r.right), top: r.bottom + 8 } // in the top bar: drop down, right-aligned
      : { left: Math.min(r.right + 8, window.innerWidth - 328), bottom: Math.max(8, window.innerHeight - r.bottom) }) // at the sidebar's foot: open up and out
    setOpen(true)
  }
  // the bell rings when something new lands, and only then
  useEffect(() => { if (items.length > last.current) { setRing(true); const t = setTimeout(() => setRing(false), 900); last.current = items.length; return () => clearTimeout(t) } last.current = items.length }, [items.length])
  useEffect(() => {
    if (!open) return
    // the panel is no longer a descendant of the bell, so a click inside it has to be recognised too
    const down = e => { if (!box.current?.contains(e.target) && !panelRef.current?.contains(e.target)) setOpen(false) }
    const key = e => e.key === 'Escape' && setOpen(false)
    const moved = () => setOpen(false) // the measured position would be stale
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key); window.addEventListener('resize', moved)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); window.removeEventListener('resize', moved) }
  }, [open])
  return (
    <div className="relative flex-shrink-0" ref={box}>
      <style>{`@keyframes bell-ring { 0%,100% { transform: rotate(0) } 15%,45% { transform: rotate(-12deg) } 30%,60% { transform: rotate(12deg) } }`}</style>
      <button onClick={toggle} title="Notifications" aria-haspopup="menu" aria-expanded={open}
        className={`relative w-7 h-7 rounded-md grid place-items-center transition-colors ${unread ? 'text-accent' : 'text-dim hover:text-white'} hover:bg-white/5`}>
        <span style={ring ? { animation: 'bell-ring .9s ease-in-out' } : undefined}><Ico d={BELL} /></span>
        {unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-[3px] rounded-full bg-accent text-app text-[9px] font-bold grid place-items-center">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && pos && createPortal(
        <div ref={panelRef} style={{ position: 'fixed', ...pos, width: 320 }}
          className="max-h-[70vh] island z-[80] flex flex-col overflow-hidden shadow-2xl" role="menu">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <span className="text-xs font-semibold text-white flex-1">Notifications</span>
            {unread > 0 && <button onClick={markAllRead} className="text-[10px] text-dim hover:text-white">Mark all read</button>}
            {items.length > 0 && <button onClick={clearAll} className="text-[10px] text-dim hover:text-error">Clear</button>}
          </div>
          <div className="flex-1 overflow-y-auto">
            {!items.length && <div className="text-xs text-dim text-center py-8 px-4">Nothing yet. New articles land here.</div>}
            {items.map(n => (
              <div key={n.id} className={`group flex items-start gap-2 px-3 py-2 border-b border-border/60 last:border-0 ${n.read ? '' : 'bg-accent/[0.06]'}`}>
                <button onClick={() => { markRead(n.id); openNotification(n); setOpen(false) }} className="flex-1 min-w-0 text-left">
                  <div className="text-xs text-gray-100 truncate" dir="auto" title={n.text}>{n.text}</div>
                  {n.sub && <div className="text-[11px] text-dim truncate" dir="auto">{n.sub}</div>}
                  <div className="text-[10px] text-dim mt-0.5">{ago(n.at)}</div>
                </button>
                {!n.read && <span className="mt-1 w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" aria-label="unread" />}
                <button onClick={() => dismiss(n.id)} title="Dismiss" className="opacity-0 group-hover:opacity-100 text-dim hover:text-error flex-shrink-0"><Ico s={12} d={<><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>} /></button>
              </div>))}
          </div>
        </div>, document.body)}
    </div>
  )
}
