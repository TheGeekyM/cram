import React, { useState, useEffect, useRef } from 'react'

// Quick switcher (Ctrl+K): jump to any page, or open a study in Ask.
export default function Palette({ entries, studies, onGo, onStudy, onClose }) {
  const [q, setQ] = useState(''); const [i, setI] = useState(0); const ref = useRef()
  useEffect(() => { ref.current?.focus() }, [])
  useEffect(() => setI(0), [q])
  const k = q.trim().toLowerCase()
  const items = [
    ...entries.map(([id, label], n) => ({ key: `go:${id}`, label, hint: 'Go to', sub: `Ctrl+${n + 1}`, run: () => onGo(id) })),
    ...studies.map(s => ({ key: `st:${s.id}`, label: s.title, hint: 'Study', sub: s.subject, run: () => onStudy(s.id) })),
  ].filter(x => !k || `${x.label} ${x.sub || ''}`.toLowerCase().includes(k)).slice(0, 14)
  const key = e => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') { e.preventDefault(); setI(x => Math.min(items.length - 1, x + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setI(x => Math.max(0, x - 1)) }
    else if (e.key === 'Enter') items[i]?.run()
  }
  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-start justify-center pt-[12vh] p-6" onClick={onClose}>
      <div className="island w-full max-w-lg overflow-hidden animate-fade-up" onClick={e => e.stopPropagation()}>
        <input ref={ref} dir="auto" className="w-full bg-transparent px-4 py-3.5 text-sm text-gray-100 outline-none border-b border-border placeholder-dim" placeholder="Jump to a page or a study…" value={q} onChange={e => setQ(e.target.value)} onKeyDown={key} />
        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {items.map((x, j) => (
            <button key={x.key} onMouseEnter={() => setI(j)} onClick={x.run} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left ${j === i ? 'bg-accent/15 text-white' : 'text-gray-300'}`}>
              <span className="text-[10px] uppercase tracking-wider text-dim w-16 flex-shrink-0">{x.hint}</span>
              <span className="text-sm truncate" dir="auto">{x.label}</span>
              {x.sub && <span className="text-[11px] text-dim truncate ml-auto">{x.sub}</span>}
            </button>
          ))}
          {!items.length && <div className="text-xs text-dim text-center py-6">Nothing matches «{q}».</div>}
        </div>
        <div className="px-4 py-2 border-t border-border text-[10px] text-dim flex gap-4"><span>↑↓ move</span><span>Enter open</span><span>Esc close</span><span className="ml-auto">Ctrl+1…9 jump</span></div>
      </div>
    </div>
  )
}
