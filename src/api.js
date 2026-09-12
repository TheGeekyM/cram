// The same window.api surface aidle's NotesScreen expects, backed by Cram's Express server.
// Non-JSON replies (a 404 from an outdated server, a crash page) become { error } instead of a thrown parse error
const parse = async r => { try { return await r.json() } catch { return { error: `${r.status} from ${new URL(r.url).pathname} — the app's server is not running the latest version. Restart Cram.` } } }
const j = (url, body, method = 'POST') => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }).then(parse)
export const api = {
  get: url => fetch(url).then(parse),
  post: j,
  del: url => j(url, null, 'DELETE'),
  // POST that streams text; calls onText with the accumulated text. Aborting `signal` stops it and returns what arrived so far.
  async stream(url, body, onText, signal) {
    let text = ''
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
      const reader = r.body.getReader(), dec = new TextDecoder()
      for (;;) { const { value, done } = await reader.read(); if (done) break; text += dec.decode(value, { stream: true }); onText(text) }
    } catch (e) { if (e.name !== 'AbortError') throw e }
    return text
  },
}
window.api = {
  notes: {
    list: (id, extraFolders) => j('/api/notes/list', { extraFolders }),
    save: (id, note) => j('/api/notes/save', { note }),
    delete: (id, noteId) => j('/api/notes/delete', { id: noteId }),
    reorder: (id, ids) => j('/api/notes/reorder', { ids }),
    export: opts => j('/api/notes/export', opts),
  },
  showInFolder: p => j('/api/show-in-folder', { path: p }),
  logError: (e, s) => console.error(e, s),
}
