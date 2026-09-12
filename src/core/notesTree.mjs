// Where a note sits is one field: `parent`, the id of the note it lives under. A note with
// no parent is top level, and a note with children is a page you can open like any other —
// there is no separate folder object to keep in sync with the notes inside it.
//
// Before this, notes were filed by a `group` string: a folder that was never a note, could
// not be opened, held no text and only existed while something was tagged with it.
// migrateGroups turns each of those names into a real note, once, the first time a project
// is loaded after the change.

const uid = () => `note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`

// Pure: takes the stored array, returns { notes, changed }. Idempotent — nothing carries a
// `group` once it has run, so a second pass finds nothing to do. `extra` is the folder names
// the sidebar was keeping on the side because they held nothing yet; they become empty pages.
export function migrateGroups(notes, extra = []) {
  const names = [...new Set([...notes.map(n => (n.group || '').trim()), ...extra.map(s => String(s).trim())])].filter(Boolean)
  if (!names.length) return { notes, changed: false }

  const now = Date.now()
  // id per folder name, and the page itself, kept apart so the placement pass below can ask
  // for either one.
  const idOf = new Map(names.map((name, i) => [name, `${uid()}${i}`]))
  const pageOf = new Map(names.map(name => [name, { id: idOf.get(name), title: name, content: '', createdAt: now, updatedAt: now }]))

  const out = []
  const placed = new Set()
  for (const n of notes) {
    const name = (n.group || '').trim()
    const { group, ...rest } = n
    if (!name) { out.push(rest); continue }
    // The folder's page goes in right above the first note that was inside it, so the list
    // keeps the shape it had on screen instead of collecting every folder at one end.
    if (!placed.has(name)) { out.push(pageOf.get(name)); placed.add(name) }
    out.push({ ...rest, parent: idOf.get(name) })
  }
  // Folders that were still empty have no note to sit above.
  for (const name of names) if (!placed.has(name)) out.push(pageOf.get(name))
  return { notes: out, changed: true }
}

// Deleting a page does not delete what is under it: the children move up to where their
// parent was. Nothing is ever lost to a click on the wrong row.
export function removeNote(notes, id) {
  const gone = notes.find(n => n.id === id)
  if (!gone) return notes
  const up = gone.parent || undefined
  return notes.filter(n => n.id !== id).map(n => (n.parent === id ? { ...n, parent: up } : n))
}

// Walking up from `id`: is `maybeAncestor` above it? Guards the one move that would make the
// tree eat itself — dropping a page inside its own child, which renders as an endless list.
export function isDescendant(notes, id, maybeAncestor) {
  const by = new Map(notes.map(n => [n.id, n]))
  let cur = by.get(id)
  const seen = new Set()
  while (cur?.parent && !seen.has(cur.parent)) {
    if (cur.parent === maybeAncestor) return true
    seen.add(cur.parent)
    cur = by.get(cur.parent)
  }
  return false
}

// The stored array is flat and IS the order. Children keep their parent's relative order,
// so the tree reads top-down the way the list does.
export function childrenOf(notes, parentId) {
  return notes.filter(n => (n.parent || null) === (parentId || null))
}
