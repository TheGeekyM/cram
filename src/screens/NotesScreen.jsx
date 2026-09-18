import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { useEditor, useEditorState, EditorContent, ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import { mergeAttributes, Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { TextStyle, Color, BackgroundColor, FontFamily } from '@tiptap/extension-text-style'
import { Placeholder } from '@tiptap/extensions'
import { createLowlight, common } from 'lowlight'
import 'highlight.js/styles/github-dark.css'
import { detectLang, LANGS } from '../notesLang.js'
import { buildExportHtml, exportFileName } from './notesExport.js'
import { htmlToMd } from './markdownLite.js'
import ResizableSidebar from '../components/ResizableSidebar.jsx'
import { useCollapsedGroups, ItemMenu, colorOf } from '../components/SidebarGroups.jsx'
import { childrenOf, isDescendant } from '../core/notesTree.mjs'

// Notion-lite notes: a note list + a WYSIWYG editor (headings, lists, to-dos, quote,
// code, divider), auto-saved per project. Content is stored as HTML.
// This ran on document.execCommand until its block handling proved unfixable — formats
// wouldn't toggle off, Enter carried them onto the next line. Tiptap (ProseMirror) owns
// the document model now; notes written under the old editor still load, since both
// speak HTML.

const lowlight = createLowlight(common)

// Alignment and direction per paragraph/heading, stored as plain style/dir attributes in the HTML.
// ponytail: own 20 lines instead of @tiptap/extension-text-align, which has no dir anyway.
// Lists carry them too: a list's dir is what moves its bullets/numbers to the other side.
const BLOCKS = ['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote']
const BlockLayout = Extension.create({
  name: 'blockLayout',
  addGlobalAttributes: () => [{ types: BLOCKS, attributes: {
    textAlign: { default: null, parseHTML: el => el.style.textAlign || null, renderHTML: a => a.textAlign ? { style: `text-align: ${a.textAlign}` } : {} },
    dir: { default: null, parseHTML: el => el.getAttribute('dir'), renderHTML: a => a.dir ? { dir: a.dir } : {} },
  } }],
  // A list or quote made out of aligned/RTL lines (toolbar, slash menu, "- ") starts bare, so its
  // bullets would sit on the left; give it its first line's layout. Explicit LTR/left on it is non-null and kept.
  // ponytail: walks the whole note per change, fine at note size
  addProseMirrorPlugins: () => [new Plugin({
    appendTransaction: (trs, _, state) => {
      if (!trs.some(t => t.docChanged)) return
      let tr = null
      state.doc.descendants((node, pos) => {
        if (!CONTAINERS.includes(node.type.name) || (node.attrs.dir && node.attrs.textAlign)) return
        let first = null
        node.descendants(n => { if (!first && n.isTextblock) first = n; return !first })
        // each key on its own: a right-aligned list with no dir still needs the RTL of its lines
        const dir = node.attrs.dir || first?.attrs.dir || null, textAlign = node.attrs.textAlign || first?.attrs.textAlign || null
        if (dir !== node.attrs.dir || textAlign !== node.attrs.textAlign) (tr ??= state.tr).setNodeMarkup(pos, undefined, { ...node.attrs, dir, textAlign })
      })
      return tr
    },
  })],
})
// Picking the value already set clears it: back to the start edge / dir=auto. Inside a list or quote
// the button reads the container, so a list whose paragraphs are already RTL still gets its own dir.
const CONTAINERS = ['bulletList', 'orderedList', 'taskList', 'blockquote']
const blockIs = (e, key, value) => {
  const types = CONTAINERS.some(t => e.isActive(t)) ? CONTAINERS : ['paragraph', 'heading']
  return types.some(t => e.isActive(t, { [key]: value }))
}
// Inside a list/quote it covers the whole outermost one and every line in it, so clearing RTL from
// one item can't leave the other items RTL (the copy-from-first-line plugin would put it back).
const setBlock = (e, key, value) => {
  const next = blockIs(e, key, value) ? null : value
  return e.chain().focus().command(({ tr }) => {
    const { $from, $to } = tr.selection
    let from = $from.pos, to = $to.pos
    for (let d = $from.depth; d > 0; d--) if (CONTAINERS.includes($from.node(d).type.name)) { from = $from.before(d); to = Math.max(to, $from.after(d)) }
    tr.doc.nodesBetween(from, to, (n, pos) => { if (BLOCKS.includes(n.type.name)) tr.setNodeMarkup(pos, undefined, { ...n.attrs, [key]: next }) })
    return true
  }).run()
}

const uid = () => `note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
const snippet = (html) => (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
// Same strip, uncut and lowercased — searching a note means searching all of it.
const snippetFull = (html) => (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
const relTime = (ts) => {
  if (!ts) return ''
  const m = Math.floor((Date.now() - ts) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// The old editor stored to-dos as <div class="nt-todo"><input type="checkbox" checked>…</div>.
// Tiptap's schema would drop the checkbox on load and autosave the stripped version, so
// rewrite them into task-list markup on the way in.
const migrateTodos = (html) => (html || '').replace(
  /<div class="nt-todo">\s*<input type="checkbox"([^>]*)>(.*?)<\/div>/gis,
  (_, attrs, text) => `<ul data-type="taskList"><li data-type="taskItem" data-checked="${/\bchecked\b/i.test(attrs)}">` +
    `<label><input type="checkbox"${/\bchecked\b/i.test(attrs) ? ' checked' : ''}></label><div><p>${text}</p></div></li></ul>`
)

// The language belongs to the block, so its picker lives on the block — a header strip with a
// select, the way a gist or Notion does it. It used to be a dropdown in the main toolbar,
// which put the control for one paragraph in a bar that governs the whole document.
// contentEditable={false} on the strip keeps the caret out of it.
// One colour per language for the block's dot — the familiar ones by name, everything else
// hashed into the same palette so it is at least stable per language.
const LANG_COLORS = {
  javascript: '#f7df1e', typescript: '#3178c6', json: '#8b8b8b', html: '#e34c26', css: '#2965f1',
  php: '#777bb4', python: '#3776ab', csharp: '#68217a', java: '#e76f00', go: '#00add8',
  rust: '#dea584', ruby: '#cc342d', sql: '#e38c00', bash: '#4eaa25', shell: '#4eaa25',
  yaml: '#cb171e', xml: '#f1662a', markdown: '#6d4ce8', text: '#8a8f98',
}
const FALLBACK_HUES = ['#6d4ce8', '#3b82f6', '#f59e0b', '#ec4899', '#06b6d4', '#10b981']
function langColor(name) {
  const k = String(name || 'text').toLowerCase()
  if (LANG_COLORS[k]) return LANG_COLORS[k]
  let h = 0
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0
  return FALLBACK_HUES[Math.abs(h) % FALLBACK_HUES.length]
}

// 16 entries, so a plain list — no search box, no virtualisation, no dependency.
function LangPicker({ value, shown, onPick }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away, true)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away, true)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const pick = (v) => { onPick(v); setOpen(false) }
  return (
    <span className="nt-code-lang-wrap" ref={ref}>
      <button type="button" className={`nt-code-lang${open ? ' is-open' : ''}`} title="Code language"
        onMouseDown={e => { e.preventDefault(); setOpen(o => !o) }}>
        <i className="nt-code-dot" style={{ background: langColor(shown) }} />
        <span className="nt-code-name">{shown}</span>
        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <span className="nt-code-menu">
          {['auto', ...LANGS].map(l => (
            <button key={l} type="button" className={`nt-code-opt${l === value ? ' is-on' : ''}`}
              onMouseDown={e => { e.preventDefault(); pick(l) }}>
              <i className="nt-code-dot" style={{ background: l === 'auto' ? 'transparent' : langColor(l), boxShadow: l === 'auto' ? 'inset 0 0 0 1.5px rgb(var(--c-dim))' : 'none' }} />
              <span>{l}</span>
              {l === value && (
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5l5 5L20 6.5" /></svg>
              )}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

// A page's icon. The emoji it was given, or the sheet of paper that says "this is a page" —
// tinted with the note's colour, which is what the colour dot used to be there for.
export function PageIcon({ note, className = 'w-4 h-4' }) {
  if (note.icon) return <span className={`${className} grid place-items-center leading-none flex-shrink-0`} style={{ fontSize: '0.95em' }}>{note.icon}</span>
  // colorOf answers 'transparent' for "no colour", which as a stroke paints nothing at all.
  const tint = colorOf(note.color)
  const ink = tint && tint !== 'transparent' ? tint : ''
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={ink || 'currentColor'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      className={`${className} flex-shrink-0 ${ink ? '' : 'text-dim'}`}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" />
    </svg>
  )
}

function CodeBlockView({ node, updateAttributes }) {
  const lang = node.attrs.language || 'auto'
  const shown = node.attrs.language || detectLang(node.textContent) || 'text'
  const lines = (node.textContent.match(/\n/g)?.length || 0) + 1
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(node.textContent || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }
  return (
    <NodeViewWrapper className="nt-code">
      <div className="nt-code-bar" contentEditable={false}>
        {/* The picker was a native <select>: the chip could be styled, the list it opened could
            not — it came up as an unstyled OS menu in the middle of a dark editor. This is the
            same control drawn by us, so the list matches the block it belongs to. */}
        <LangPicker value={lang} onPick={v => updateAttributes({ language: v === 'auto' ? null : v })} shown={shown} />
        <span className="nt-code-right">
          <span className="nt-code-lines">{lines} line{lines === 1 ? '' : 's'}</span>
          {/* Reading code you cannot take with you is half the job. */}
          <button type="button" className="nt-code-copy" onClick={copy} title="Copy this block">
            {copied ? (
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5l5 5L20 6.5" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H15" />
              </svg>
            )}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </span>
      </div>
      <pre><NodeViewContent as="code" /></pre>
    </NodeViewWrapper>
  )
}

// data-lang stays on the serialised <pre> so saved notes keep their language, and so a note
// written before the node view existed still loads with the right grammar.
const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() { return ReactNodeViewRenderer(CodeBlockView) },

  // Tiptap's own ``` rule needs a trailing SPACE (/^```([a-z]+)?[\s\n]$/) because it fires on
  // text input, and Enter is a keymap event, not text. Everyone types ``` and presses Enter,
  // and nothing happened. This catches that: a paragraph that is only fence + optional
  // language becomes the block, with the language already set.
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if (!empty || $from.parent.type.name !== 'paragraph') return false
        const m = /^(?:```|~~~)([A-Za-z0-9+#-]*)$/.exec($from.parent.textContent.trim())
        if (!m) return false
        const language = m[1] ? m[1].toLowerCase() : null
        const start = $from.start()
        // setTextSelection is not optional: without it the caret ends up in the empty paragraph
        // the trailing-node plugin appends after the block, and everything you type next lands
        // BELOW the code block instead of inside it.
        // focus(start) rather than setTextSelection: the block renders through a React node
        // view, and remounting it drops the DOM selection — without re-focusing INTO the block
        // the caret lands after it and everything you type next appears below the code.
        return editor.chain()
          .deleteRange({ from: start, to: $from.end() })
          .toggleCodeBlock(language ? { language } : {})
          .focus(start)
          .run()
      },
    }
  },

  renderHTML({ node, HTMLAttributes }) {
    const lang = node.attrs.language
    return ['pre', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, lang ? { 'data-lang': lang } : {}),
      ['code', lang ? { class: `language-${lang}` } : {}, 0]]
  },
})

// Row/column operations. A dozen more buttons in the main bar would swamp it, so these only
// appear while the caret is inside a table.
const TABLE_TOOLS = [
  { label: '+ row', title: 'Add a row below', run: e => e.chain().focus().addRowAfter().run() },
  { label: '+ col', title: 'Add a column to the right', run: e => e.chain().focus().addColumnAfter().run() },
  { label: '− row', title: 'Delete this row', run: e => e.chain().focus().deleteRow().run() },
  { label: '− col', title: 'Delete this column', run: e => e.chain().focus().deleteColumn().run() },
  { label: 'merge', title: 'Merge or split the selected cells', run: e => e.chain().focus().mergeOrSplit().run() },
  { label: 'header', title: 'Toggle the header row', run: e => e.chain().focus().toggleHeaderRow().run() },
  { label: 'delete table', title: 'Delete the whole table', run: e => e.chain().focus().deleteTable().run(), danger: true },
]

// The table controls belong to the table, not to the page. As a strip pinned under the main
// toolbar they sat at the top of the screen while the cell you were editing was halfway down
// it — pressing "+ row" meant looking away from the row. This rides just above the table the
// caret is in, and once the table's own top has scrolled past it sticks to the top of the
// editor so the controls stay in reach on a long table.
function TableTools({ editor, active }) {
  const [box, setBox] = useState(null)
  const BAR = 30

  // No dependency array: the parent re-renders on every transaction (see `marks`), so this
  // re-measures as the caret moves between tables or the table grows a row.
  useLayoutEffect(() => {
    if (!editor || !active) { if (box) setBox(null); return }
    let node
    try { node = editor.view.domAtPos(editor.state.selection.from).node } catch { return }
    const el = node?.nodeType === 1 ? node : node?.parentElement
    const table = el?.closest?.('table')
    if (!table) { if (box) setBox(null); return }
    const r = table.getBoundingClientRect()
    // Clamp against the SCROLL CONTAINER, not the editor element — the editor scrolls with the
    // text, so its own top goes negative and the bar would ride off the screen with it.
    const pane = (editor.view.dom.closest('.overflow-y-auto') || editor.view.dom).getBoundingClientRect()
    const next = {
      top: Math.min(Math.max(r.top - BAR - 6, pane.top + 4), Math.min(r.bottom - BAR, pane.bottom - BAR - 4)),
      left: r.left,
    }
    if (!box || Math.abs(box.top - next.top) > 0.5 || Math.abs(box.left - next.left) > 0.5) setBox(next)
  })

  // getBoundingClientRect is a snapshot; scrolling and resizing move the table under it.
  useEffect(() => {
    if (!editor || !active) return
    const nudge = () => setBox(b => (b ? { ...b } : b))   // forces the layout effect to re-measure
    window.addEventListener('scroll', nudge, true)
    window.addEventListener('resize', nudge)
    return () => {
      window.removeEventListener('scroll', nudge, true)
      window.removeEventListener('resize', nudge)
    }
  }, [editor, active])

  if (!box) return null
  return (
    <div className="fixed z-50 flex items-center gap-0.5 island px-1 py-1 shadow-xl"
      style={{ top: box.top, left: box.left, height: BAR }}>
      {TABLE_TOOLS.map((t, i) => (
        <button key={i} title={t.title} onMouseDown={e => { e.preventDefault(); t.run(editor) }}
          className={`h-6 px-2 rounded text-[11px] whitespace-nowrap transition-colors ${
            t.danger ? 'text-dim hover:text-error hover:bg-error/10' : 'text-dim hover:text-white hover:bg-white/10'
          }`}>{t.label}</button>
      ))}
    </div>
  )
}

// Toolbar icons. Stroke-based on a 24px grid, matching the icons used elsewhere in the app,
// so the bar reads as one set instead of a row of borrowed unicode glyphs. Letterforms are
// kept for the typographic controls (H1/B/I/S) — a letter says "bold" better than a shape.
const Ico = ({ children }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">{children}</svg>
)
const SearchIcon = (p) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.9-4.9" />
  </svg>
)
const BulletListIcon = () => (
  <Ico>
    <line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" />
    <circle cx="4.5" cy="6" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="4.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="4.5" cy="18" r="1.3" fill="currentColor" stroke="none" />
  </Ico>
)
const OrderedListIcon = () => (
  <Ico>
    <line x1="10" y1="6" x2="20" y2="6" /><line x1="10" y1="12" x2="20" y2="12" /><line x1="10" y1="18" x2="20" y2="18" />
    <path d="M4 5h1v4" strokeWidth="1.6" /><path d="M3.6 16.2c0-.9 1.9-1 1.9-2 0-.6-.5-1-1-1s-.9.3-1 .8" strokeWidth="1.6" />
    <line x1="3.6" y1="18" x2="5.6" y2="18" strokeWidth="1.6" />
  </Ico>
)
const TaskListIcon = () => (
  <Ico>
    <polyline points="8.5 11 11 13.5 16 8" />
    <path d="M20 12.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
  </Ico>
)
const QuoteIcon = () => (
  <Ico>
    <line x1="4" y1="5" x2="4" y2="19" strokeWidth="2.6" />
    <line x1="9" y1="8" x2="20" y2="8" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="16" x2="16" y2="16" />
  </Ico>
)
const CodeIcon = () => (
  <Ico><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></Ico>
)
const DividerIcon = () => (
  <Ico>
    <line x1="5" y1="7" x2="19" y2="7" opacity="0.35" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="5" y1="17" x2="19" y2="17" opacity="0.35" />
  </Ico>
)
const TableIcon = () => (
  <Ico>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <line x1="3" y1="10" x2="21" y2="10" /><line x1="9" y1="10" x2="9" y2="20" /><line x1="15" y1="10" x2="15" y2="20" />
  </Ico>
)
const AlignIcon = ({ rows }) => (
  <Ico>{rows.map(([x1, x2], i) => <line key={i} x1={x1} y1={6 + i * 6} x2={x2} y2={6 + i * 6} />)}</Ico>
)
const ClearIcon = () => (
  <Ico>
    <path d="m7 21-4.3-4.3a2 2 0 0 1 0-2.8l9.6-9.6a2 2 0 0 1 2.8 0l5.6 5.6a2 2 0 0 1 0 2.8L13 21" />
    <line x1="22" y1="21" x2="7" y2="21" /><line x1="5" y1="11" x2="14" y2="20" />
  </Ico>
)

// How wide the writing column runs. A long line is hard to read, so the default stays a
// comfortable measure and going full-bleed is a deliberate choice — same idea as Notion's
// full-width switch, with a couple of steps in between.
// Steps sized against the app's own window rather than the monitor: at the default 1400px
// width the writing pane is about 1050px, so anything beyond max-w-5xl clamps to the pane and
// would be indistinguishable from Full. These five stay visibly distinct.
const WIDTHS = [
  { key: 'narrow', label: 'Narrow', cls: 'max-w-xl' },
  { key: 'normal', label: 'Normal', cls: 'max-w-3xl' },
  { key: 'wide',   label: 'Wide',   cls: 'max-w-4xl' },
  { key: 'wider',  label: 'Wider',  cls: 'max-w-5xl' },
  { key: 'full',   label: 'Full',   cls: 'max-w-none' },
]

const TEXT_COLORS = [
  { name: 'Default', value: null },
  { name: 'Red',     value: '#e5484d' },
  { name: 'Orange',  value: '#f76b15' },
  { name: 'Amber',   value: '#d98a00' },
  { name: 'Green',   value: '#30a46c' },
  { name: 'Teal',    value: '#12a594' },
  { name: 'Blue',    value: '#3e7bfa' },
  { name: 'Purple',  value: '#8e5cd9' },
  { name: 'Pink',    value: '#d6409f' },
]
const HIGHLIGHTS = [
  { name: 'None',    value: null },
  { name: 'Red',     value: 'rgba(229, 72, 77, 0.28)' },
  { name: 'Orange',  value: 'rgba(247, 107, 21, 0.28)' },
  { name: 'Amber',   value: 'rgba(217, 138, 0, 0.30)' },
  { name: 'Green',   value: 'rgba(48, 164, 108, 0.28)' },
  { name: 'Teal',    value: 'rgba(18, 165, 148, 0.28)' },
  { name: 'Blue',    value: 'rgba(62, 123, 250, 0.28)' },
  { name: 'Purple',  value: 'rgba(142, 92, 217, 0.30)' },
  { name: 'Pink',    value: 'rgba(214, 64, 159, 0.28)' },
]

// Colour lives in its own popover rather than as eighteen more toolbar buttons.
function ColorMenu({ editor }) {
  const [open, setOpen] = useState(false)
  if (!editor) return null
  const current = editor.getAttributes('textStyle')?.color || null
  const apply = (fn) => { fn(); setOpen(false) }
  return (
    <div className="relative">
      <button
        title="Text colour and highlight"
        onMouseDown={e => { e.preventDefault(); setOpen(o => !o) }}
        className={`min-w-8 h-8 px-1.5 flex flex-col items-center justify-center gap-0.5 rounded-md text-xs transition-colors ${
          open ? 'text-gray-100 bg-white/[0.07]' : 'text-dim hover:text-gray-100 hover:bg-white/[0.07]'
        }`}
      >
        <span className="leading-none font-semibold">A</span>
        <span className="w-3.5 h-[3px] rounded-sm" style={{ background: current || 'rgb(var(--c-dim))' }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onMouseDown={e => { e.preventDefault(); setOpen(false) }} />
          <div className="absolute z-40 top-9 left-0 w-56 island p-2.5 shadow-xl">
            <div className="text-[10px] uppercase tracking-wider text-dim/70 mb-1.5">Text</div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {TEXT_COLORS.map(c => (
                <button key={c.name} title={c.name}
                  onMouseDown={e => { e.preventDefault(); apply(() => c.value
                    ? editor.chain().focus().setColor(c.value).run()
                    : editor.chain().focus().unsetColor().run()) }}
                  className="w-6 h-6 rounded-md border border-white/15 grid place-items-center text-[11px] font-semibold hover:scale-110 transition-transform"
                  style={{ color: c.value || 'rgb(var(--c-gray-100))', background: 'rgb(var(--c-app))' }}>A</button>
              ))}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-dim/70 mb-1.5">Highlight</div>
            <div className="flex flex-wrap gap-1.5">
              {HIGHLIGHTS.map(c => (
                <button key={c.name} title={c.name}
                  onMouseDown={e => { e.preventDefault(); apply(() => c.value
                    ? editor.chain().focus().setBackgroundColor(c.value).run()
                    : editor.chain().focus().unsetBackgroundColor().run()) }}
                  className="w-6 h-6 rounded-md border border-white/15 hover:scale-110 transition-transform"
                  style={{ background: c.value || 'rgb(var(--c-app))' }}>
                  {!c.value && <span className="text-[11px] text-dim">/</span>}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const FONTS = [
  { name: 'Default', value: null },
  { name: 'Serif',   value: 'Georgia, "Times New Roman", serif' },
  { name: 'Mono',    value: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
]

// Right-click on a selection. The app-wide menu in ContextMenu.jsx steps aside for anything
// that calls preventDefault, so this takes over inside the editor and hands back the usual
// copy/cut/paste everywhere else.
function SelectionMenu({ editor, at, onClose }) {
  if (!editor || !at) return null
  const run = (fn) => { fn(); onClose() }
  const Row = ({ label, children }) => (
    <div className="flex items-center gap-1.5 px-2 py-1">
      <span className="w-10 text-[10px] uppercase tracking-wider text-dim/70 flex-shrink-0">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  )
  const Btn = ({ title, onPick, active, className = '', children }) => (
    <button title={title} onMouseDown={e => { e.preventDefault(); onPick() }}
      className={`h-6 min-w-6 px-1.5 rounded text-[11px] flex items-center justify-center transition-colors ${
        active ? 'text-accent bg-accent/15' : 'text-gray-300 hover:text-white hover:bg-white/10'
      } ${className}`}>{children}</button>
  )
  // Keep the card on screen when the click lands near an edge.
  const style = {
    left: Math.min(at.x, window.innerWidth - 250),
    top: Math.min(at.y, window.innerHeight - 260),
  }
  return (
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={e => { e.preventDefault(); onClose() }} onContextMenu={e => { e.preventDefault(); onClose() }} />
      <div className="fixed z-[61] w-[236px] island py-1.5 shadow-2xl" style={style} onContextMenu={e => e.preventDefault()}>
        <Row label="Style">
          <Btn title="Bold" active={editor.isActive('bold')} className="font-bold" onPick={() => run(() => editor.chain().focus().toggleBold().run())}>B</Btn>
          <Btn title="Italic" active={editor.isActive('italic')} className="italic" onPick={() => run(() => editor.chain().focus().toggleItalic().run())}>I</Btn>
          <Btn title="Strikethrough" active={editor.isActive('strike')} className="line-through" onPick={() => run(() => editor.chain().focus().toggleStrike().run())}>S</Btn>
          <Btn title="Inline code" active={editor.isActive('code')} className="font-mono" onPick={() => run(() => editor.chain().focus().toggleCode().run())}>{'</>'}</Btn>
        </Row>
        <Row label="Text">
          {TEXT_COLORS.map(c => (
            <button key={c.name} title={c.name}
              onMouseDown={e => { e.preventDefault(); run(() => c.value ? editor.chain().focus().setColor(c.value).run() : editor.chain().focus().unsetColor().run()) }}
              className="w-5 h-5 rounded border border-white/15 grid place-items-center text-[10px] font-semibold hover:scale-110 transition-transform"
              style={{ color: c.value || 'rgb(var(--c-gray-100))', background: 'rgb(var(--c-app))' }}>A</button>
          ))}
        </Row>
        <Row label="Mark">
          {HIGHLIGHTS.map(c => (
            <button key={c.name} title={c.name}
              onMouseDown={e => { e.preventDefault(); run(() => c.value ? editor.chain().focus().setBackgroundColor(c.value).run() : editor.chain().focus().unsetBackgroundColor().run()) }}
              className="w-5 h-5 rounded border border-white/15 hover:scale-110 transition-transform"
              style={{ background: c.value || 'rgb(var(--c-app))' }} />
          ))}
        </Row>
        <div className="h-px bg-border my-1" />
        <Row label="Font">
          {FONTS.map(f => (
            <Btn key={f.name} title={f.name} active={f.value ? editor.isActive('textStyle', { fontFamily: f.value }) : false}
              onPick={() => run(() => f.value ? editor.chain().focus().setFontFamily(f.value).run() : editor.chain().focus().unsetFontFamily().run())}>
              {f.name}
            </Btn>
          ))}
        </Row>
        <Row label="Block">
          <Btn title="Plain text" active={editor.isActive('paragraph')} onPick={() => run(() => editor.chain().focus().setParagraph().run())}>Text</Btn>
          {[1, 2, 3].map(l => (
            <Btn key={l} title={`Heading ${l}`} active={editor.isActive('heading', { level: l })}
              onPick={() => run(() => editor.chain().focus().toggleHeading({ level: l }).run())}>H{l}</Btn>
          ))}
        </Row>
        <div className="h-px bg-border my-1" />
        <div className="flex items-center gap-1 px-2 py-0.5">
          <Btn title="Copy the selected text" onPick={() => run(() => {
            const { from, to } = editor.state.selection
            navigator.clipboard.writeText(editor.state.doc.textBetween(from, to, '\n'))
          })}>Copy</Btn>
          <Btn title="Remove all formatting from the selection"
            onPick={() => run(() => editor.chain().focus().unsetAllMarks().run())}>Clear formatting</Btn>
        </div>
      </div>
    </>
  )
}

// Toolbar. Each entry drives itself: `run` applies (and toggles off), `on` lights the button.
const TOOLS = [
  { label: 'H1', title: 'Heading 1', run: e => e.chain().focus().toggleHeading({ level: 1 }).run(), on: e => e.isActive('heading', { level: 1 }) },
  { label: 'H2', title: 'Heading 2', run: e => e.chain().focus().toggleHeading({ level: 2 }).run(), on: e => e.isActive('heading', { level: 2 }) },
  { label: 'H3', title: 'Heading 3', run: e => e.chain().focus().toggleHeading({ level: 3 }).run(), on: e => e.isActive('heading', { level: 3 }) },
  { sep: true },
  { label: 'B', cls: 'font-bold', title: 'Bold (Ctrl+B)', run: e => e.chain().focus().toggleBold().run(), on: e => e.isActive('bold') },
  { label: 'I', cls: 'italic', title: 'Italic (Ctrl+I)', run: e => e.chain().focus().toggleItalic().run(), on: e => e.isActive('italic') },
  { label: 'S', cls: 'line-through', title: 'Strikethrough', run: e => e.chain().focus().toggleStrike().run(), on: e => e.isActive('strike') },
  { sep: true },
  { icon: <BulletListIcon />, title: 'Bulleted list', run: e => e.chain().focus().toggleBulletList().run(), on: e => e.isActive('bulletList') },
  { icon: <OrderedListIcon />, title: 'Numbered list', run: e => e.chain().focus().toggleOrderedList().run(), on: e => e.isActive('orderedList') },
  { icon: <TaskListIcon />, title: 'To-do list', run: e => e.chain().focus().toggleTaskList().run(), on: e => e.isActive('taskList') },
  { sep: true },
  { icon: <QuoteIcon />, title: 'Quote', run: e => e.chain().focus().toggleBlockquote().run(), on: e => e.isActive('blockquote') },
  // Turning a selection into code detects its language from the selected text, so the
  // block comes out labelled and highlighted with the right grammar.
  { icon: <CodeIcon />, title: 'Code block', on: e => e.isActive('codeBlock'),
    run: e => {
      if (e.isActive('codeBlock')) return e.chain().focus().toggleCodeBlock().run()
      const { from, to } = e.state.selection
      return e.chain().focus().toggleCodeBlock({ language: detectLang(e.state.doc.textBetween(from, to, '\n')) }).run()
    } },
  { icon: <DividerIcon />, title: 'Divider', run: e => e.chain().focus().setHorizontalRule().run(), on: () => false },
  { icon: <TableIcon />, title: 'Table', on: e => e.isActive('table'),
    run: e => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { sep: true },
  { icon: <AlignIcon rows={[[4, 20], [4, 14], [4, 18]]} />, title: 'Align left', run: e => setBlock(e, 'textAlign', 'left'), on: e => blockIs(e, 'textAlign', 'left') },
  { icon: <AlignIcon rows={[[4, 20], [7, 17], [5, 19]]} />, title: 'Align center', run: e => setBlock(e, 'textAlign', 'center'), on: e => blockIs(e, 'textAlign', 'center') },
  { icon: <AlignIcon rows={[[4, 20], [10, 20], [6, 20]]} />, title: 'Align right', run: e => setBlock(e, 'textAlign', 'right'), on: e => blockIs(e, 'textAlign', 'right') },
  { label: 'LTR', cls: 'text-[10px] font-semibold', title: 'Left-to-right', run: e => setBlock(e, 'dir', 'ltr'), on: e => blockIs(e, 'dir', 'ltr') },
  { label: 'RTL', cls: 'text-[10px] font-semibold', title: 'Right-to-left', run: e => setBlock(e, 'dir', 'rtl'), on: e => blockIs(e, 'dir', 'rtl') },
  { sep: true },
  { icon: <ClearIcon />, title: 'Clear formatting', run: e => e.chain().focus().unsetAllMarks().clearNodes().run(), on: () => false },
]

// The slash menu: the same block commands the toolbar runs, reachable by name from the
// keyboard. Only blocks — bold and italic are not here, because you do not open a menu to
// mark up text you have not typed yet.
// ponytail: no @tiptap/suggestion. It is a dependency for a regex over the text before the
// caret, a list, and four keys — swap to it if this ever needs mentions or multiple triggers.
const SLASH = [
  ['Text', 'paragraph plain body', e => e.chain().focus().setParagraph().run()],
  ['Heading 1', 'h1 title big'],
  ['Heading 2', 'h2 subtitle'],
  ['Heading 3', 'h3 small'],
  ['Bulleted list', 'ul bullets unordered points'],
  ['Numbered list', 'ol ordered steps'],
  ['To-do list', 'todo task checkbox checklist'],
  ['Quote', 'blockquote citation'],
  ['Code block', 'code snippet pre'],
  ['Divider', 'hr rule separator line break'],
  ['Table', 'grid rows columns'],
].map(([name, keys, run]) => {
  const tool = TOOLS.find(t => t.title === name || t.title?.startsWith(`${name} (`))
  return { name, keys, run: run || tool.run, icon: tool?.icon, label: tool?.label }
})

// Anchored to the caret, so it is fixed-positioned and clamped to the window rather than
// laid out inside the scrolling column.
function SlashMenu({ at, items, active, onPick }) {
  return (
    <div className="fixed z-[70] w-60 island py-1 shadow-2xl max-h-72 overflow-y-auto"
      style={{ left: Math.min(at.x, window.innerWidth - 252), top: Math.min(at.y + 6, window.innerHeight - 300) }}
      onMouseDown={e => e.preventDefault()}>
      {items.map((it, i) => (
        // Arrowing past the seventh row would otherwise walk off the bottom of a menu that
        // scrolls, and the highlight would be somewhere you cannot see.
        <button key={it.name} onClick={() => onPick(it)}
          ref={el => { if (i === active) el?.scrollIntoView({ block: 'nearest' }) }}
          className={`w-full flex items-center gap-2.5 px-2 py-1.5 text-left transition-colors ${
            i === active ? 'bg-accent text-app' : 'text-gray-200 hover:bg-white/[0.07]'
          }`}>
          <span className={`w-7 h-7 grid place-items-center rounded-md text-[11px] font-semibold flex-shrink-0 ${
            i === active ? 'bg-app/20' : 'bg-white/[0.06] text-dim'
          }`}>{it.icon || it.label || 'T'}</span>
          <span className="text-[13px] truncate">{it.name}</span>
        </button>
      ))}
    </div>
  )
}

// Notes tagged with a study, plus every page filed under one of them (a study's workspace shows only these)
const inStudy = (notes, sid) => {
  const ids = new Set(notes.filter(n => n.studyId === sid).map(n => n.id))
  for (let grew = true; grew;) { grew = false; for (const n of notes) if (!ids.has(n.id) && ids.has(n.parent)) { ids.add(n.id); grew = true } }
  return notes.filter(n => ids.has(n.id))
}

// studyId + embedded: the Notes tool inside a study's workspace (filtered list, new notes tagged, no page chrome)
export default function NotesScreen({ project, studyId, embedded }) {
  const [notes, setNotes]     = useState([])
  const [query, setQuery]     = useState('')      // filters titles and note text
  const [rowMenu, setRowMenu] = useState(null)    // { at:{x,y}, note } — right-click on a row
  // Which pages are folded shut, by note id. Same hook the folder headings used — the key
  // changed, so nobody inherits a fold state that was about a folder name.
  const folded = useCollapsedGroups('notesTree:shut')
  const [iconEdit, setIconEdit] = useState(false)  // the emoji field on the open page
  const [slash, setSlash] = useState(null)   // { from, q, at:{x,y}, i } while the / menu is up
  const [searchOpen, setSearchOpen] = useState(false)
  const [activeId, setActiveId] = useState(null)
  const [title, setTitle]     = useState('')
  const [saved, setSaved]     = useState(true)
  const [confirmDel, setConfirmDel] = useState(null)   // note pending deletion
  const [dragId, setDragId] = useState(null)           // note being dragged (for styling)
  const dragRef = useRef(null)                         // …and the value the drop actually reads
  const [dropId, setDropId] = useState(null)           // note it would land before
  // Page view: the note laid out as a document to read, rather than a surface to write on.
  const [page, setPage] = useState(false)
  const [exporting, setExporting] = useState(null)   // 'pdf' | 'html' while the dialog is up

  // The exported file is the note as a document: its title, the date it was saved, and
  // the same markup the editor holds. Markdown skips the page shell — a .md file is the
  // note itself, with the title as its one h1.
  async function exportAs(format) {
    if (!editor || exporting) return
    setExporting(format)
    const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    const r = await window.api.notes.export({
      format,
      defaultName: exportFileName(title),
      body: format === 'md'
        ? `# ${title || 'Note'}\n\n${htmlToMd(editor.getHTML())}`
        : buildExportHtml({ title, body: editor.getHTML(), date }),
    })
    setExporting(null)
    if (r?.ok) window.api.showInFolder(r.path)      // land the user on the file they just made
    else if (r && !r.canceled && r.message) alert(`Export failed: ${r.message}`)
  }
  // A reading preference rather than a property of any one note, so it is kept app-wide.
  const [width, setWidth] = useState(() => localStorage.getItem('notesWidth') || 'normal')
  const [selMenu, setSelMenu] = useState(null)   // { x, y } while the selection menu is open
  const titleRef  = useRef(null)
  const saveTimer = useRef(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),          // replaced by the highlighting one
      CodeBlock.configure({ lowlight }),
      TaskList,
      TaskItem.configure({ nested: true }),
      // Draggable column widths, Tab to move between cells, Enter for a new paragraph in one.
      TableKit.configure({ table: { resizable: true } }),
      TextStyle, Color, BackgroundColor, FontFamily, BlockLayout,
      Placeholder.configure({ placeholder: 'Write something… press “/” for headings, lists, and to-dos.' }),
    ],
    editorProps: {
      // dir=auto so an Arabic note lays itself out RTL, per paragraph.
      attributes: { class: 'nt-editor min-h-[50vh] text-sm text-gray-200 leading-relaxed focus:outline-none', dir: 'auto' },
    },
    content: '',
    onUpdate: ({ editor: e }) => { scheduleSave(); syncSlash(e) },
    // Clicking or arrowing away from the “/” has to put the menu away too, and neither is
    // a document change, so onUpdate alone never sees it.
    onSelectionUpdate: ({ editor: e }) => syncSlash(e),
  })

  // Is the caret sitting just after a “/…” that started a word? That is the whole trigger.
  function syncSlash(e) {
    const { $from, empty } = e.state.selection
    if (!empty || $from.parent.type.name === 'codeBlock') return setSlash(null)
    const before = e.state.doc.textBetween($from.start(), $from.pos, '\n', '\0')
    const m = /(?:^|\s)\/([a-zA-Z0-9 ]{0,18})$/.exec(before)
    if (!m) return setSlash(null)
    const from = $from.pos - m[1].length - 1
    const c = e.view.coordsAtPos(from)
    // Keep the highlighted row while the same “/” is being typed into; reset it for a new one.
    setSlash(prev => ({ from, q: m[1], at: { x: c.left, y: c.bottom }, i: prev?.from === from ? prev.i : 0 }))
  }

  const slashItems = slash ? SLASH.filter(it => `${it.name} ${it.keys}`.toLowerCase().includes(slash.q.trim().toLowerCase())) : []
  // A path like /usr/bin matches nothing, and a menu that stays up over it is in the way.
  const slashOpen = slashItems.length > 0
  const slashAt = slashOpen ? Math.min(slash.i, slashItems.length - 1) : 0

  const runSlash = useCallback((item) => {
    if (!item || !editor) return
    // The “/query” is part of the document until it is taken back out; deleting it first
    // means the command below acts on a block that no longer holds the thing you typed.
    editor.chain().focus().deleteRange({ from: slash.from, to: slash.from + slash.q.length + 1 }).run()
    item.run(editor)
    setSlash(null)
  }, [editor, slash])

  // Captured on the document: ProseMirror's own keymap owns Enter and the arrows, and would
  // have inserted a paragraph before a handler inside the editor ever ran.
  useEffect(() => {
    if (!slashOpen) return
    const onKey = (ev) => {
      if (ev.key === 'Escape') { setSlash(null); ev.preventDefault(); ev.stopPropagation(); return }
      const step = ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowUp' ? -1 : 0
      if (step) {
        setSlash(s => ({ ...s, i: (slashAt + step + slashItems.length) % slashItems.length }))
        ev.preventDefault(); ev.stopPropagation(); return
      }
      if (ev.key === 'Enter' || ev.key === 'Tab') {
        runSlash(slashItems[slashAt])
        ev.preventDefault(); ev.stopPropagation()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [slashOpen, slashAt, slashItems, runSlash])

  // Toolbar state — recomputed per transaction, so the lit buttons follow the caret.
  const marks = useEditorState({
    editor,
    selector: ({ editor: e }) => (e ? {
      active: TOOLS.map(t => (t.sep ? false : t.on(e))),
      inTable: e.isActive('table'),
    } : { active: [], inTable: false }),
  }) || { active: [], inTable: false }

  useEffect(() => {
    if (!editor) return   // first pass runs before the editor mounts; open() needs it
    // Folders that held nothing only ever existed in localStorage, so the main process
    // cannot see them to migrate them — hand them over on the way in, then forget the key.
    let empties = []
    try { empties = JSON.parse(localStorage.getItem('notesFolders:empty') || '[]') } catch {}
    window.api.notes.list(project.id, empties).then(r => {
      if (!r.ok) return
      setNotes(r.notes)
      const first = studyId ? inStudy(r.notes, studyId)[0] : r.notes[0]
      if (first) open(first)
      localStorage.removeItem('notesFolders:empty')
    })
    return () => clearTimeout(saveTimer.current)
  }, [project.id, editor])
  // another screen added a note (Studies › Export practice): refresh the list only, never the open editor
  useEffect(() => {
    const f = () => window.api.notes.list(project.id, []).then(r => { if (r.ok) setNotes(r.notes) })
    window.addEventListener('cram:notes-changed', f); return () => window.removeEventListener('cram:notes-changed', f)
  }, [project.id])

  function open(note) {
    clearTimeout(saveTimer.current)
    setActiveId(note.id)
    setTitle(note.title || '')
    editor?.commands.setContent(migrateTodos(note.content), { emitUpdate: false })
    setSaved(true)
  }

  const persist = useCallback(async (over = {}) => {
    const id = over.id || activeId
    if (!id) return
    // Spread the stored note first: notes:save replaces the entry with exactly what it is
    // given, so anything not named here — the folder, the colour — would be saved away.
    const stored = notes.find(n => n.id === id) || {}
    const note = { ...stored, ...over, id, title: over.title ?? title, content: over.content ?? (editor?.getHTML() || '') }
    const r = await window.api.notes.save(project.id, note)
    if (r.ok) {
      setNotes(prev => {
        const i = prev.findIndex(n => n.id === r.note.id)
        if (i < 0) return [r.note, ...prev]
        const copy = [...prev]; copy[i] = r.note; return copy
      })
      setSaved(true)
    }
  }, [activeId, title, project.id, editor, notes])

  // Colour/folder for any note in the list. The open one goes through persist so the edit
  // in the editor is not overwritten by the copy that was last written to disk.
  const patchNote = useCallback(async (n, patch) => {
    if (n.id === activeId) return persist(patch)
    const r = await window.api.notes.save(project.id, { ...n, ...patch })
    if (r.ok) setNotes(prev => prev.map(x => (x.id === r.note.id ? r.note : x)))
  }, [activeId, persist, project.id])

  function scheduleSave() {
    setSaved(false)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => persist(), 600)
  }

  // Native HTML5 drag — a vertical list of a dozen items does not need a library, and the
  // stored array is already the order, so a reorder is just a rewrite of it. Optimistic:
  // the list moves under the cursor and the write follows.
  function moveNote(fromId, beforeId) {
    if (!fromId || fromId === beforeId) return
    const from = notes.findIndex(n => n.id === fromId)
    if (from === -1) return
    const next = [...notes]
    const [moved] = next.splice(from, 1)
    const to = beforeId ? next.findIndex(n => n.id === beforeId) : next.length
    next.splice(to === -1 ? next.length : to, 0, moved)
    // Computed outside the updater: a state updater has to stay pure, and persisting from
    // inside one would fire twice the moment anything double-invokes it.
    setNotes(next)
    window.api.notes?.reorder?.(project.id, next.map(n => n.id))
  }

  // Dropping a note on a row means "put it here", and here is somewhere in the tree: the
  // note joins the row's parent. Nesting a page under another is the right-click menu —
  // a drop cannot say "beside this" and "inside this" without guessing from a few pixels.
  function dropOnRow(fromId, target) {
    if (!fromId || fromId === target.id) return
    const from = notes.find(n => n.id === fromId)
    if (from) reparent(from, target.parent || '')
    moveNote(fromId, target.id)
  }

  // The one move that would make the tree contain itself — a page dropped inside its own
  // child renders as a list with no end, and takes the window with it.
  function reparent(from, parent) {
    if ((from.parent || '') === (parent || '')) return
    if (parent && isDescendant(notes, parent, from.id)) return
    patchNote(from, { parent: parent || '' })
  }

  function newNote(parent = '') {
    const note = { id: uid(), title: '', content: '', parent, ...(studyId ? { studyId } : {}) }
    setNotes(prev => [{ ...note, updatedAt: Date.now() }, ...prev])
    setActiveId(note.id); setTitle('')
    editor?.commands.setContent('', { emitUpdate: false })
    persist({ ...note })
    // A page you just filed under another is only visible if that one is open.
    if (parent && folded.shut.has(parent)) folded.toggle(parent)
    setTimeout(() => titleRef.current?.focus(), 0)
  }

  function askDelete(note, e) {
    e?.stopPropagation()
    setConfirmDel(note)
  }

  async function doDelete() {
    const id = confirmDel?.id
    setConfirmDel(null)
    if (!id) return
    // notes:delete moves the pages under this one up to where it was and returns the whole
    // list, so nothing under a deleted page is lost and nothing has to be re-parented here.
    const r = await window.api.notes.delete(project.id, id)
    setNotes(prev => {
      const next = r?.notes || prev.filter(n => n.id !== id)
      if (id === activeId) { next[0] ? open(next[0]) : (setActiveId(null), setTitle('')) }
      return next
    })
  }

  // Code typed into an empty block never went through the toolbar's detection, so label
  // those on the way out. Skipped in the undo history — it isn't an edit the user made.
  function labelCodeBlocks() {
    if (!editor) return
    const { state } = editor
    let tr = state.tr, changed = false
    state.doc.descendants((node, pos) => {
      if (node.type.name !== 'codeBlock' || node.attrs.language) return
      const lang = detectLang(node.textContent)
      if (!lang) return
      tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, language: lang })
      changed = true
    })
    if (changed) editor.view.dispatch(tr.setMeta('addToHistory', false))
  }

  // Titles are short and often vague; the sentence you remember is usually in the body.
  // Dragging to reorder is disabled while a filter is on — the visible order isn't the
  // stored one, so a drop would move a note relative to rows that aren't there.
  // Dragging near the top or bottom edge scrolls the list: HTML5 drag does no scrolling of
  // its own, so a note could only be dropped among the rows that happened to be on screen.
  // ponytail: fixed speed, no acceleration — add ramping if the list ever gets long enough
  // for one speed to feel wrong.
  const listRef = useRef(null)
  const edgeDir = useRef(0)
  useEffect(() => {
    if (!dragId) return
    const t = setInterval(() => { if (edgeDir.current && listRef.current) listRef.current.scrollTop += edgeDir.current * 8 }, 16)
    return () => { clearInterval(t); edgeDir.current = 0 }
  }, [dragId])
  const edgeScroll = (e) => {
    const r = listRef.current?.getBoundingClientRect()
    const zone = 24
    edgeDir.current = !r ? 0 : e.clientY < r.top + zone ? -1 : e.clientY > r.bottom - zone ? 1 : 0
  }

  const nq = query.trim().toLowerCase()
  const scoped = studyId ? inStudy(notes, studyId) : notes
  const visibleNotes = nq
    ? scoped.filter(n => (n.title || '').toLowerCase().includes(nq) || snippetFull(n.content).includes(nq))
    : scoped

  // A page cannot be moved under itself or under anything below it, so those are not offered.
  const parentChoices = (n) => notes.filter(x => x.id !== n.id && x.id !== (n.parent || '') && !isDescendant(notes, x.id, n.id))

  // One row of the tree, and its children under it. A search flattens the tree: a hit inside
  // a page that stayed folded is a search that lied.
  const rows = (list, depth) => list.map(n => {
    const kids = childrenOf(notes, n.id)
    const open_ = !folded.shut.has(n.id)
    return (
      <div key={n.id}>
        <div
          role="button" tabIndex={0}
          onClick={() => open(n)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(n) } }}
          onContextMenu={e => { e.preventDefault(); setRowMenu({ at: { x: e.clientX, y: e.clientY }, note: n }) }}
          draggable={!nq}
          onDragStart={e => {
            dragRef.current = n.id
            setDragId(n.id)
            e.dataTransfer.effectAllowed = 'move'
            // Also on the transfer itself, which is what a drop from outside React would carry.
            try { e.dataTransfer.setData('text/plain', n.id) } catch {}
          }}
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (n.id !== dropId) setDropId(n.id) }}
          onDragLeave={() => setDropId(d => (d === n.id ? null : d))}
          onDrop={e => {
            e.preventDefault(); e.stopPropagation()
            const from = dragRef.current || e.dataTransfer.getData('text/plain')
            dropOnRow(from, n)
            dragRef.current = null; setDragId(null); setDropId(null)
          }}
          onDragEnd={() => { dragRef.current = null; setDragId(null); setDropId(null) }}
          // The indent is the whole point of the tree, so it is padding on the row rather than
          // a margin — the highlight still runs the full width of the panel.
          style={{ paddingLeft: 4 + depth * 13 }}
          className={`group flex items-center gap-1.5 pr-1.5 py-[5px] rounded-md transition-colors cursor-grab active:cursor-grabbing select-none ${
            dragId === n.id ? 'opacity-40' : ''
          } ${dropId === n.id && dragId !== n.id ? 'border-t-2 border-t-accent' : ''} ${
            activeId === n.id ? 'bg-white/[0.09] text-white' : 'text-gray-300 hover:bg-white/[0.05]'
          }`}>
          {/* The twisty only exists where there is something to twist; everything else gets
              the same gap, so the icons stay in one column. */}
          {kids.length > 0 ? (
            <span onClick={e => { e.stopPropagation(); folded.toggle(n.id) }} title={open_ ? 'Collapse' : 'Expand'}
              className="w-[15px] h-[15px] grid place-items-center rounded text-dim hover:text-gray-100 hover:bg-white/10 flex-shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                className={`w-2.5 h-2.5 transition-transform ${open_ ? '' : '-rotate-90'}`}><path d="m6 9.5 6 5 6-5" /></svg>
            </span>
          ) : <span className="w-[15px] flex-shrink-0" />}
          <PageIcon note={n} className="w-[15px] h-[15px]" />
          <span className={`text-[13px] leading-5 truncate flex-1 ${activeId === n.id ? 'font-medium' : ''}`}>{n.title?.trim() || 'Untitled'}</span>
          <span className="text-[10px] text-dim/50 tabular-nums flex-shrink-0 group-hover:hidden">{relTime(n.updatedAt)}</span>
          <span onClick={e => { e.stopPropagation(); newNote(n.id) }} title="New page inside this one"
            className="hidden group-hover:grid place-items-center w-4 h-4 rounded text-dim hover:text-gray-100 hover:bg-white/10 flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-2.5 h-2.5"><path d="M12 5v14M5 12h14" /></svg>
          </span>
          <span onClick={(e) => askDelete(n, e)} className="hidden group-hover:block text-dim hover:text-error flex-shrink-0" title="Delete note">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
            </svg>
          </span>
        </div>
        {/* Only while searching: a note can match on its body with nothing in the title,
            and then the snippet is the only thing saying why the row is in the list. */}
        {nq && <div className="text-[11px] text-dim/70 truncate px-2 pb-1">{snippet(n.content) || 'Empty'}</div>}
        {!nq && kids.length > 0 && open_ && rows(childrenOf(visibleNotes, n.id), depth + 1)}
      </div>
    )
  })

  return (
    <div className="h-full bg-app flex flex-col overflow-hidden">{/* h-full, not h-screen: it lives in App's pane and would cover the tab row below */}
      <div className="flex-1 flex overflow-hidden bg-app p-2.5 gap-2.5">
        {/* Note list — drag its right edge to resize, double-click it to collapse */}
        <ResizableSidebar storageKey="notesList" defaultWidth={256} min={190} max={460} collapsedWidth={44}>
        {(railed) => railed ? (
          // Collapsed: colour and initial per note, so the rail still navigates.
          <div className="h-full island flex flex-col overflow-hidden items-center py-2 gap-1">
            <button onClick={() => newNote()} title="New note"
              className="w-7 h-7 flex items-center justify-center rounded-md bg-accent/15 text-accent hover:bg-accent hover:text-app transition-colors text-base leading-none flex-shrink-0">+</button>
            <div className="flex-1 overflow-y-auto flex flex-col items-center gap-1 w-full pt-1">
              {scoped.map(n => (
                <button key={n.id} onClick={() => open(n)} title={n.title?.trim() || 'Untitled'}
                  className={`w-7 h-7 rounded-md grid place-items-center text-[11px] font-semibold flex-shrink-0 border transition-colors ${
                    activeId === n.id ? 'bg-accent/15 border-accent/40 text-white' : 'border-transparent text-dim hover:bg-white/5'
                  }`}
                  style={colorOf(n.color) && colorOf(n.color) !== 'transparent' ? { borderColor: colorOf(n.color) } : undefined}>
                  {/* The page icon only where it says something: most notes have no emoji, and a
                      column of identical sheets of paper is a rail you cannot navigate by. */}
                  {n.icon || (n.title?.trim() || '?').charAt(0).toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        ) : (
        <div className="h-full island flex flex-col overflow-hidden">
          <div className="px-2.5 py-1.5 border-b border-border flex items-center gap-1.5 flex-shrink-0">
            {searchOpen ? (
              <>
                <SearchIcon className="w-3.5 h-3.5 text-dim flex-shrink-0" />
                <input
                  value={query}
                  autoFocus
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); setSearchOpen(false) } }}
                  placeholder="Search titles and text…"
                  className="bg-transparent border-0 outline-none text-[11px] text-gray-100 placeholder:text-dim/60 flex-1 min-w-0"
                />
                <button onClick={() => { setQuery(''); setSearchOpen(false) }} title="Close (Esc)"
                  className="w-5 h-5 grid place-items-center rounded text-dim hover:text-gray-100 flex-shrink-0">×</button>
              </>
            ) : (
              <>
                <span className="text-xs font-semibold text-gray-200 uppercase tracking-wider flex-1">Notes</span>
                {notes.length > 0 && (
                  <button onClick={() => setSearchOpen(true)} title="Search notes"
                    className="w-6 h-6 grid place-items-center rounded-md text-dim hover:text-gray-100 hover:bg-white/[0.07] transition-colors">
                    <SearchIcon className="w-3.5 h-3.5" />
                  </button>
                )}
                <button onClick={() => newNote()} title="New note"
                  className="w-6 h-6 flex items-center justify-center rounded-md bg-accent/15 text-accent hover:bg-accent hover:text-app transition-colors text-base leading-none">+</button>
              </>
            )}
          </div>
          <div ref={listRef} className="flex-1 overflow-y-auto p-1"
            // Rows preventDefault on their own dragover; this one also runs, by bubbling,
            // so the edge check sees every position the pointer passes through.
            onDragOver={e => { e.preventDefault(); edgeScroll(e) }}
            onDrop={e => {
              e.preventDefault()
              const from = dragRef.current || e.dataTransfer.getData('text/plain')
              // Dropped past the end of the list: out of every page, at the bottom.
              const note = notes.find(n => n.id === from)
              if (note) { reparent(note, ''); moveNote(from, null) }
              dragRef.current = null; setDragId(null); setDropId(null)
            }}>
            {scoped.length === 0 ? (
              <div className="text-center text-dim text-xs py-8 px-3">{studyId ? 'No notes in this study yet. Click + to create one.' : 'No notes yet. Click + to create one.'}</div>
            ) : visibleNotes.length === 0 ? (
              <div className="text-center text-dim text-xs py-8 px-3">Nothing matches “{query}”.</div>
            ) : rows(nq ? visibleNotes : childrenOf(visibleNotes, null), 0)}
          </div>
        </div>
        )}
        </ResizableSidebar>

        {/* Editor */}
        <div className="flex-1 island flex flex-col overflow-hidden min-w-0">
          {activeId && editor ? (
            <>
              {/* Toolbar */}
              <div className="flex items-center gap-0.5 px-2.5 py-2 border-b border-border flex-shrink-0 flex-wrap bg-app/40">
                {TOOLS.map((t, i) => t.sep
                  ? <span key={i} className="w-px h-4 bg-border/70 mx-1.5" />
                  : <button key={i} title={t.title} onMouseDown={e => { e.preventDefault(); t.run(editor) }}
                      className={`min-w-8 h-8 px-1.5 flex items-center justify-center rounded-md text-xs transition-colors ${
                        marks.active[i] ? 'text-accent bg-accent/15' : 'text-dim hover:text-gray-100 hover:bg-white/[0.07]'
                      } ${t.cls || ''}`}>{t.icon || t.label}</button>
                )}

                <span className="w-px h-4 bg-border/70 mx-1.5" />
                <ColorMenu editor={editor} />

                <div className="ml-auto flex items-center gap-2 pl-2">
                  {/* Read the note as a laid-out page, or go back to writing it */}
                  <button title={page ? 'Back to editing' : 'Read as a page'}
                    onClick={() => { if (!page) persist(); setPage(p => !p) }}
                    className={`h-7 px-2 flex items-center gap-1 rounded-md text-[11px] transition-colors ${
                      page ? 'text-accent bg-accent/15' : 'text-dim hover:text-gray-100 hover:bg-white/[0.07]'
                    }`}>
                    {page ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 4.5h7a2.5 2.5 0 0 1 2.5 2.5V20a2 2 0 0 0-2-2H4z" /><path d="M20 4.5h-4.5a2 2 0 0 0-2 2V20a2 2 0 0 1 2-2H20z" />
                      </svg>
                    )}
                    {page ? 'Edit' : 'Read'}
                  </button>

                  {/* Export — two formats, so a menu would be one click of ceremony too many */}
                  <span className="flex items-center rounded-md overflow-hidden border border-border">
                    <span className="pl-2 pr-1.5 text-[11px] text-dim/70 select-none flex items-center gap-1">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 3v12" /><path d="M8 11l4 4 4-4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                      </svg>
                    </span>
                    {['pdf', 'md'].map(f => (
                      <button key={f} onClick={() => exportAs(f)} disabled={!!exporting}
                        title={f === 'pdf' ? 'Save as a PDF document' : 'Save as a Markdown file'}
                        className="h-7 px-2 text-[11px] uppercase tracking-wider text-dim hover:text-gray-100 hover:bg-white/[0.07] disabled:opacity-40 transition-colors">
                        {exporting === f ? '…' : f}
                      </button>
                    ))}
                  </span>

                  <span className="w-px h-4 bg-border/70" />
                  <select
                    value={width}
                    title="Width of the writing column"
                    onChange={e => { setWidth(e.target.value); localStorage.setItem('notesWidth', e.target.value) }}
                    className="h-7 bg-transparent text-[11px] text-dim hover:text-gray-200 rounded px-1 focus:outline-none cursor-pointer"
                  >
                    {WIDTHS.map(w => <option key={w.key} value={w.key}>{w.label}</option>)}
                  </select>
                  <span className="w-px h-4 bg-border/70" />
                  <span className="flex items-center gap-1.5 text-[11px] text-dim/70 select-none" title={saved ? 'All changes saved' : 'Saving…'}>
                    <span className={`w-1.5 h-1.5 rounded-full ${saved ? 'bg-success/70' : 'bg-accent animate-pulse'}`} />
                    {saved ? 'Saved' : 'Saving'}
                  </span>
                </div>
              </div>

              <TableTools editor={editor} active={marks.inTable} />

              <SelectionMenu editor={editor} at={selMenu} onClose={() => setSelMenu(null)} />

              {slashOpen && !page && <SlashMenu at={slash.at} items={slashItems} active={slashAt} onPick={runSlash} />}

              {/* Title + body */}
              <div className="flex-1 overflow-y-auto">
                <div className={`${(WIDTHS.find(w => w.key === width) || WIDTHS[1]).cls} mx-auto px-8 pt-10 pb-24 transition-[max-width] duration-150`}>
                  {/* The page's icon, where the page is — click it to type an emoji, empty to
                      go back to the sheet of paper. ponytail: a text field, not a picker; the
                      OS emoji keyboard is a keystroke away and every one of them fits. */}
                  {(() => {
                    const active = notes.find(n => n.id === activeId) || {}
                    return iconEdit ? (
                      <input autoFocus defaultValue={active.icon || ''} maxLength={4}
                        placeholder="🙂" title="An emoji, or nothing"
                        onBlur={e => { patchNote(active, { icon: e.target.value.trim() }); setIconEdit(false) }}
                        onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setIconEdit(false) }}
                        className="w-12 h-12 mb-2 text-2xl text-center bg-white/5 rounded-lg border border-border focus:outline-none focus:border-accent" />
                    ) : (
                      <button onClick={() => setIconEdit(true)} title="Change the page icon"
                        className="w-12 h-12 mb-2 grid place-items-center rounded-lg hover:bg-white/5 transition-colors">
                        <PageIcon note={active} className={active.icon ? 'w-8 h-8 text-[30px]' : 'w-9 h-9'} />
                      </button>
                    )
                  })()}
                  <input ref={titleRef} value={title}
                    onChange={e => { setTitle(e.target.value); scheduleSave() }}
                    placeholder="Untitled" dir="auto"
                    className="w-full bg-transparent text-[2.1rem] leading-tight font-bold tracking-tight text-white placeholder:text-dim/30 focus:outline-none mb-5" />

                  {/* The pages filed under this one, listed where you opened it — which is the
                      only place a page with nothing but children has anything to show. */}
                  <div className="mb-7">
                    {childrenOf(notes, activeId).map(k => (
                      <button key={k.id} onClick={() => open(k)}
                        className="group flex items-center gap-2 w-full text-left px-1.5 py-1 -ml-1.5 rounded-md hover:bg-white/[0.05] transition-colors">
                        <PageIcon note={k} className="w-[18px] h-[18px]" />
                        <span className="text-[15px] text-gray-200 group-hover:text-white truncate underline decoration-dim/25 underline-offset-[5px] decoration-1">
                          {k.title?.trim() || 'Untitled'}
                        </span>
                      </button>
                    ))}
                    <button onClick={() => newNote(activeId)}
                      className="flex items-center gap-2 px-1.5 py-1 -ml-1.5 rounded-md text-[13px] text-dim/70 hover:text-gray-200 hover:bg-white/[0.05] transition-colors">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-[15px] h-[15px]">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      Add a sub-page
                    </button>
                  </div>
                  {page ? (
                    <div className="nt-page" dir="auto" dangerouslySetInnerHTML={{ __html: editor?.getHTML() || '' }} />
                  ) : (
                    <div
                      onContextMenu={(e) => {
                        // Only claim the right-click when there is something to format;
                        // otherwise the app-wide copy/paste menu should still appear.
                        if (!editor || editor.state.selection.empty) return
                        e.preventDefault()
                        setSelMenu({ x: e.clientX, y: e.clientY })
                      }}
                    >
                      <EditorContent editor={editor} onBlur={() => { labelCodeBlocks(); persist() }} />
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-dim">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5z"/><path d="M15 3v6h6"/><path d="M8 13h6"/><path d="M8 17h4"/>
              </svg>
              <p className="text-sm">Select a note, or create a new one.</p>
              <button onClick={() => newNote()} className="btn-primary text-sm">+ New note</button>
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      {rowMenu && (
        <ItemMenu
          at={rowMenu.at}
          item={rowMenu.note}
          moveTo={{
            current: rowMenu.note.parent || '',
            options: parentChoices(rowMenu.note).map(n => ({ id: n.id, label: n.title?.trim() || 'Untitled' })),
            onPick: (id) => reparent(rowMenu.note, id),
          }}
          onPatch={(patch) => patchNote(rowMenu.note, patch)}
          onDelete={() => askDelete(rowMenu.note)}
          onClose={() => setRowMenu(null)}
        />
      )}

      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setConfirmDel(null)}>
          <div className="w-[400px] max-w-[92vw] island rounded-2xl border border-border shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-5 flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-error/15 text-error flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                </svg>
              </div>
              <div className="min-w-0">
                <h3 className="text-white font-semibold">Delete note</h3>
                <p className="text-dim text-sm mt-1 leading-relaxed">
                  Delete <span className="text-gray-200 font-medium">“{confirmDel.title?.trim() || 'Untitled'}”</span>? This can’t be undone.
                  {childrenOf(notes, confirmDel.id).length > 0 && (
                    <> The {childrenOf(notes, confirmDel.id).length} page{childrenOf(notes, confirmDel.id).length === 1 ? '' : 's'} inside it move up a level — nothing inside is deleted.</>
                  )}
                </p>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-border flex justify-end gap-2 bg-panel/40">
              <button onClick={() => setConfirmDel(null)} className="btn-ghost text-sm">Cancel</button>
              <button onClick={doDelete} className="text-sm px-3.5 py-1.5 rounded-md bg-error text-white hover:bg-error/90 transition-colors font-medium">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
