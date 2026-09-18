import { useSyncExternalStore } from 'react'

// The bell's list. Kept in localStorage: an unread notification has to survive a reload, or the bell
// is only useful while you happen to be watching it. Newest 50, which is more than anyone scrolls.
// ponytail: renderer-only state, not the server — losing it on a reinstall costs nothing.
// Shape: { id, text, sub, kind, link, at, read }. `link` is handed to the opener App registers.
const KEY = 'cram:notifications:v1', MAX = 50

const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.slice(0, MAX) : [] } catch { return [] } }

let items = load()
let snap = { items, unread: items.filter(n => !n.read).length } // frozen object: useSyncExternalStore compares by identity
const listeners = new Set()

// One place that writes, so the disk copy, the unread count and the subscribers can never disagree.
function commit(next) {
  items = next.slice(0, MAX)
  snap = { items, unread: items.filter(n => !n.read).length }
  try { localStorage.setItem(KEY, JSON.stringify(items)) } catch {}
  listeners.forEach(l => l())
}

// Where a notification leads: App registers the one opener at startup, so the bell and the desktop
// banner land in the same place.
let opener = () => {}
export const setOpener = fn => { opener = fn || (() => {}) }
export const openNotification = n => { if (n?.link) opener(n.link) }

let nextId = items.reduce((m, n) => Math.max(m, n.id || 0), 0) + 1

export function notify(text, { sub = '', kind = 'blog', link = null } = {}) {
  commit([{ id: nextId++, text, sub, kind, link, at: Date.now(), read: false }, ...items])
  try {
    const show = () => { const n = new Notification(text, { body: sub || 'Cram', tag: `cram-${kind}-${Date.now()}` }); n.onclick = () => { try { window.focus() } catch {} ; opener(link) } }
    if (Notification.permission === 'granted') show()
    else if (Notification.permission !== 'denied') Notification.requestPermission().then(p => p === 'granted' && show())
  } catch {}
}

// Reading one is an act — clicking it. Opening the panel is a glance, and must not silently clear the list.
export const markRead = id => { if (items.some(n => n.id === id && !n.read)) commit(items.map(n => n.id === id ? { ...n, read: true } : n)) }
export const markAllRead = () => { if (snap.unread) commit(items.map(n => ({ ...n, read: true }))) }
export const dismiss = id => commit(items.filter(n => n.id !== id))
export const clearAll = () => commit([])

// The newest article the user has already been told about. Manual generation announces its own article
// as it lands, so the watcher that catches the daily job's articles must not announce it a second time.
const SEEN = 'cram:blog-seen'
export const blogSeen = () => { try { return +localStorage.getItem(SEEN) || 0 } catch { return 0 } }
export const setBlogSeen = at => { try { if (at > blogSeen()) localStorage.setItem(SEEN, String(at)) } catch {} }

const subscribe = l => { listeners.add(l); return () => listeners.delete(l) }
export const useNotifications = () => useSyncExternalStore(subscribe, () => snap)
