import React, { useState, useCallback } from 'react'

// Folders and colours for a list sidebar. Notes and the Documenter both keep a flat list of
// things that grows past the point of scanning it, and both wanted the same two handles on
// it — so the grouping, the palette and the row menu live here once.
//
// A group is just a string on the item. No group registry, no ids, no rename plumbing:
// renaming a folder is re-tagging its items, and a folder with nothing in it stops existing.
// That is the whole feature, and it survives an item being deleted from under it.

// Tied to the theme tokens so the dots read in both light and dark. The blue matches
// badge-blue in index.css, which is the one hue the token set never got.
export const COLORS = [
  { key: '',        label: 'None',   css: 'transparent' },
  { key: 'coral',   label: 'Coral',  css: 'rgb(var(--c-accent))' },
  { key: 'purple',  label: 'Purple', css: 'rgb(var(--c-accent-2))' },
  { key: 'blue',    label: 'Blue',   css: 'rgb(96 165 250)' },
  { key: 'green',   label: 'Green',  css: 'rgb(var(--c-success))' },
  { key: 'amber',   label: 'Amber',  css: 'rgb(var(--c-warning))' },
  { key: 'red',     label: 'Red',    css: 'rgb(var(--c-error))' },
]
export const colorOf = (key) => COLORS.find(c => c.key === key)?.css || ''

// Items in the order the list already had them, bucketed by group. Ungrouped comes first —
// it is where new things land, and burying it under folders would hide the newest item.
export function groupList(items, extraNames = []) {
  const out = []
  const at = new Map()
  for (const it of items) {
    const name = (it.group || '').trim()
    if (!at.has(name)) { at.set(name, { name, items: [] }); out.push(at.get(name)) }
    at.get(name).items.push(it)
  }
  // Folders made but not filled yet still need a heading — otherwise the folder you just
  // created is invisible until something is dragged into it.
  for (const name of extraNames) {
    if (!at.has(name)) { at.set(name, { name, items: [] }); out.push(at.get(name)) }
  }
  return out.sort((a, b) => (a.name ? 1 : 0) - (b.name ? 1 : 0))
}

// A folder with nothing in it has nowhere to live on the items, so the names the user made
// but has not filled yet are kept beside them. They are a view preference, not project data:
// the moment a folder holds something, the items are the truth and this is only how it stays
// on screen while empty.
export function useFolderRegistry(storageKey) {
  const [extra, setExtra] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '[]') } catch { return [] }
  })
  const write = (list) => {
    const next = [...new Set(list)].filter(Boolean).sort()
    setExtra(next)
    localStorage.setItem(storageKey, JSON.stringify(next))
  }
  return {
    extra,
    add: (name) => write([...extra, String(name).trim()]),
    remove: (name) => write(extra.filter(n => n !== name)),
    // One call, because remove-then-add would compute the second from the pre-remove list
    // and put the old name straight back.
    rename: (from, to) => write([...extra.filter(n => n !== from), String(to).trim()]),
  }
}

// Which folders are folded shut, remembered per screen.
export function useCollapsedGroups(storageKey) {
  const [shut, setShut] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(storageKey) || '[]')) } catch { return new Set() }
  })
  const toggle = useCallback((name) => {
    setShut(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      localStorage.setItem(storageKey, JSON.stringify([...next]))
      return next
    })
  }, [storageKey])
  return { shut, toggle }
}

const Caret = ({ open }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    className={`w-3 h-3 flex-shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}>
    <path d="m6 9.5 6 5 6-5" />
  </svg>
)

const FolderIcon = ({ open }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    className="w-3.5 h-3.5 flex-shrink-0">
    {open
      ? <path d="M3 8V6.5A1.5 1.5 0 0 1 4.5 5h4l2 2h7A1.5 1.5 0 0 1 19 8.5V9M3 8h17.1a1 1 0 0 1 .98 1.2l-1.5 7.5a1.5 1.5 0 0 1-1.47 1.2H4.5A1.5 1.5 0 0 1 3 16.4Z" />
      : <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2h7A1.5 1.5 0 0 1 19 8.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 16.5Z" />}
  </svg>
)

// A folder heading, and a drop target: dropping a row on it files that row here. Ungrouped
// items get no heading at all — a label over the only bucket that is not a choice is noise.
export function GroupHeader({ name, count, open, onToggle, onDropIn, over, onOver, onLeave, onContextMenu }) {
  if (!name) return null
  return (
    <button
      onClick={onToggle}
      onContextMenu={onContextMenu}
      onDragOver={onDropIn ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onOver?.() } : undefined}
      onDragLeave={onLeave}
      onDrop={onDropIn ? (e) => { e.preventDefault(); e.stopPropagation(); onDropIn(e); onLeave?.() } : undefined}
      // A filled band, not a dim label: the rows below sit on the panel, the folder sits on the
      // tile above it. Sticky, so a long folder still says which folder you are scrolled inside
      // — which needs an opaque background, hence bg-panel-2 rather than a white overlay.
      className={`sticky top-0 z-10 w-full flex items-center gap-2 px-2 py-1.5 my-1 rounded-lg border transition-colors ${
        over
          ? 'bg-accent/20 border-accent/50 text-white'
          : 'bg-panel-2 border-border/70 text-gray-200 hover:text-white hover:border-border'
      }`}>
      <Caret open={open} />
      <FolderIcon open={open} />
      <span className="text-xs font-semibold truncate flex-1 text-left">{name}</span>
      <span className={`text-[10px] tabular-nums min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full flex-shrink-0 ${
        over ? 'bg-white/25 text-white' : 'bg-white/[0.08] text-dim'
      }`}>{count}</span>
    </button>
  )
}

// Right-click a folder heading: rename it, or take it away. Both are operations on the
// items — renaming re-tags them, deleting untags them — so nothing is ever lost with the
// folder, and neither needs a confirmation.
export function FolderMenu({ at, name, onRename, onDelete, onClose }) {
  const [renaming, setRenaming] = useState(null)
  const style = {
    left: Math.min(at.x, window.innerWidth - 228),
    top: Math.min(at.y, window.innerHeight - 130),
  }
  return (
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div className="fixed z-[61] w-56 island py-1.5 shadow-2xl" style={style}
        onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
        <div className="px-2.5 pb-1 text-[10px] uppercase tracking-wider text-dim/70 truncate">{name}</div>
        {renaming === null ? (
          <button onClick={() => setRenaming(name)}
            className="w-full text-left px-2.5 py-1.5 text-xs text-gray-200 hover:bg-accent hover:text-app transition-colors">
            Rename…
          </button>
        ) : (
          <div className="px-2 py-1.5">
            <input
              autoFocus
              value={renaming}
              onChange={e => setRenaming(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && renaming.trim() && renaming.trim() !== name) { onRename(renaming.trim()); onClose() }
                if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null) }
              }}
              className="input text-[11px] py-1 w-full"
            />
          </div>
        )}
        <button onClick={() => { onClose(); onDelete() }}
          className="w-full text-left px-2.5 py-1.5 text-xs text-error hover:bg-error hover:text-app transition-colors">
          Delete folder
        </button>
        <div className="px-2.5 pt-1 text-[10px] text-dim/50 leading-snug">Nothing inside is deleted — it moves out of the folder.</div>
      </div>
    </>
  )
}

// The menu behind a right-click on the list's empty space: make a folder, nothing else.
export function BackgroundMenu({ at, onCreate, onClose }) {
  const [name, setName] = useState('')
  const style = {
    left: Math.min(at.x, window.innerWidth - 228),
    top: Math.min(at.y, window.innerHeight - 110),
  }
  return (
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div className="fixed z-[61] w-56 island p-2 shadow-2xl" style={style}
        onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
        <div className="text-[10px] uppercase tracking-wider text-dim/70 px-0.5 pb-1.5">New folder</div>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && name.trim()) { onCreate(name.trim()); onClose() }
            if (e.key === 'Escape') { e.stopPropagation(); onClose() }
          }}
          placeholder="Name, then Enter"
          className="input text-[11px] py-1 w-full"
        />
      </div>
    </>
  )
}

// The dot that carries an item's colour. Renders nothing when it has none, so an uncoloured
// list keeps the alignment it always had.
export const ColorDot = ({ color, className = '' }) => {
  const css = colorOf(color)
  if (!css) return null
  return <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${className}`} style={{ background: css }} />
}

// Right-click menu for one row: a colour, somewhere to file it, and the delete that used to
// be a hover-only icon. Filing it is one of two shapes: `groups`, the folder names already
// in use (the Documenter, where a folder is a string tag), or `moveTo`, a list of pages to
// nest under (Notes, where a folder is just a page with things under it).
export function ItemMenu({ at, item, groups, moveTo, onPatch, onDelete, onClose }) {
  const [newGroup, setNewGroup] = useState(null)   // null = not typing
  const stop = (e) => e.stopPropagation()
  const style = {
    left: Math.min(at.x, window.innerWidth - 228),
    top: Math.min(at.y, window.innerHeight - 300),
  }
  const pick = (patch) => { onPatch(patch); onClose() }

  return (
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div className="fixed z-[61] w-56 island py-1.5 shadow-2xl" style={style}
        onMouseDown={stop} onContextMenu={(e) => e.preventDefault()}>

        <div className="px-2.5 pb-1 text-[10px] uppercase tracking-wider text-dim/70">Colour</div>
        <div className="flex items-center gap-1.5 px-2.5 pb-2">
          {COLORS.map(c => (
            <button key={c.key} title={c.label} onClick={() => pick({ color: c.key })}
              className={`w-5 h-5 rounded-full border transition-transform hover:scale-110 ${
                item.color === c.key || (!item.color && !c.key) ? 'border-gray-100' : 'border-border'
              }`}
              style={{ background: c.css || 'transparent' }}>
              {!c.key && <span className="block w-full h-full grid place-items-center text-[10px] text-dim">×</span>}
            </button>
          ))}
        </div>

        <div className="h-px bg-border my-1" />
        {moveTo ? (<>
          <div className="px-2.5 pb-1 text-[10px] uppercase tracking-wider text-dim/70">Move</div>
          <div className="max-h-44 overflow-y-auto">
            {moveTo.current && (
              <button onClick={() => { moveTo.onPick(''); onClose() }}
                className="w-full text-left px-2.5 py-1.5 text-xs text-dim hover:bg-accent hover:text-app transition-colors">
                Out to the top level
              </button>
            )}
            {moveTo.options.map(o => (
              <button key={o.id} onClick={() => { moveTo.onPick(o.id); onClose() }}
                className="w-full text-left px-2.5 py-1.5 text-xs text-gray-200 hover:bg-accent hover:text-app transition-colors truncate">
                Inside “{o.label}”
              </button>
            ))}
            {!moveTo.current && !moveTo.options.length && (
              <div className="px-2.5 py-1.5 text-xs text-dim/60">Nowhere else to put it yet.</div>
            )}
          </div>
        </>) : (<>
        <div className="px-2.5 pb-1 text-[10px] uppercase tracking-wider text-dim/70">Folder</div>
        <div className="max-h-44 overflow-y-auto">
          {item.group && (
            <button onClick={() => pick({ group: '' })}
              className="w-full text-left px-2.5 py-1.5 text-xs text-dim hover:bg-accent hover:text-app transition-colors">
              Take out of “{item.group}”
            </button>
          )}
          {groups.filter(g => g && g !== item.group).map(g => (
            <button key={g} onClick={() => pick({ group: g })}
              className="w-full text-left px-2.5 py-1.5 text-xs text-gray-200 hover:bg-accent hover:text-app transition-colors truncate">
              Move to “{g}”
            </button>
          ))}
          {newGroup === null ? (
            <button onClick={() => setNewGroup('')}
              className="w-full text-left px-2.5 py-1.5 text-xs text-accent hover:bg-accent hover:text-app transition-colors">
              New folder…
            </button>
          ) : (
            <div className="px-2 py-1.5">
              <input
                autoFocus
                value={newGroup}
                onChange={e => setNewGroup(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newGroup.trim()) pick({ group: newGroup.trim() })
                  if (e.key === 'Escape') { e.stopPropagation(); setNewGroup(null) }
                }}
                placeholder="Folder name, Enter to file"
                className="input text-[11px] py-1 w-full"
              />
            </div>
          )}
        </div>
        </>)}

        {onDelete && (<>
          <div className="h-px bg-border my-1" />
          <button onClick={() => { onClose(); onDelete() }}
            className="w-full text-left px-2.5 py-1.5 text-xs text-error hover:bg-error hover:text-app transition-colors">
            Delete
          </button>
        </>)}
      </div>
    </>
  )
}
