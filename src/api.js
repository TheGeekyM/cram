// The same window.api surface aidle's NotesScreen expects, backed by Cram's Express server.
const j = (url, body, method = 'POST') => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }).then(r => r.json())
export const api = {
  get: url => fetch(url).then(r => r.json()),
  post: j,
  del: url => j(url, null, 'DELETE'),
  // POST that streams text; calls onText with the accumulated text
  async stream(url, body, onText) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const reader = r.body.getReader(), dec = new TextDecoder(); let text = ''
    for (;;) { const { value, done } = await reader.read(); if (done) break; text += dec.decode(value, { stream: true }); onText(text) }
    return text
  },
}
window.api = {
  notes: {
    list: (id, extraFolders) => j(`/api/studies/${id}/notes/list`, { extraFolders }),
    save: (id, note) => j(`/api/studies/${id}/notes/save`, { note }),
    delete: (id, noteId) => j(`/api/studies/${id}/notes/delete`, { id: noteId }),
    reorder: (id, ids) => j(`/api/studies/${id}/notes/reorder`, { ids }),
    export: opts => j('/api/notes/export', opts),
  },
  showInFolder: p => j('/api/show-in-folder', { path: p }),
  logError: (e, s) => console.error(e, s),
}
