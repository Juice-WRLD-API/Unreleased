// The notification area's log: every in-app banner (chat messages, device
// alerts, news posts, announcements) and every app toast, kept so a notice
// that came and went can still be read. Fed from the two places those are
// raised - lib/chatNotifications (banners) and lib/appToast (toasts) - and
// read by NotificationCenter and the terminal's `notifications` command.
//
// Device-local, in localStorage, like the other notification state. Plain
// module state rather than the store, for the same reason as appToast: lib
// code and the stores themselves record into it. Other windows and tabs write
// the same key, so every write re-reads it first and a `storage` event
// reloads it here.
import type { RoomRef } from '../store/chatStore'

export type NotificationKind = 'chat' | 'news' | 'broadcast' | 'app'
export type NotificationLevel = 'info' | 'success' | 'warning' | 'error'

/** Where clicking the entry goes. Plain data (not a callback) so it still
 *  works after a reload; lib/openNotification follows it. */
export type NotificationTarget =
  | { view: 'chat'; room?: RoomRef }
  | { view: 'news'; postId: number }

export interface NotificationEntry {
  /** Stable per event (`chat-<message id>`, `news-<post id>`…), so the same
   *  event raised twice - two tabs, a socket push and its catch-up - is one entry. */
  id: string
  kind: NotificationKind
  title: string
  body: string
  icon?: string | null
  level?: NotificationLevel
  at: number
  read: boolean
  /** The same toast raised again straight away (a bulk action failing row by
   *  row) bumps this instead of adding a copy. */
  count?: number
  target?: NotificationTarget
}

export interface NotificationInput {
  /** Dedupe key; generated when omitted. */
  id?: string
  kind: NotificationKind
  title: string
  body?: string
  icon?: string | null
  level?: NotificationLevel
  target?: NotificationTarget
  /** Toasts answer something the user just did, so they don't count as
   *  unread; banners are things that happened to them. */
  read?: boolean
}

const KEY = 'unreleased:notificationHistory'
const MAX_ENTRIES = 150
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
// How close together the same toast has to come to fold into one entry.
const REPEAT_MS = 15_000

type Listener = (entries: NotificationEntry[]) => void

const listeners = new Set<Listener>()
let entries: NotificationEntry[] = load() ?? []
let seq = 0

// Null when storage can't be read (blocked, private mode): the log then
// lives in memory for the session instead of starting over on every write.
function load(): NotificationEntry[] | null {
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    if (!Array.isArray(arr)) return []
    const cutoff = Date.now() - MAX_AGE_MS
    return arr.filter((e): e is NotificationEntry =>
      !!e && typeof e === 'object' && typeof (e as NotificationEntry).id === 'string'
      && typeof (e as NotificationEntry).title === 'string' && typeof (e as NotificationEntry).at === 'number'
      && (e as NotificationEntry).at > cutoff)
  } catch {
    return null
  }
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries))
  } catch {}
}

function emit(): void {
  listeners.forEach((l) => l(entries))
}

// Every change starts from what's stored, so a tab or pop-out that wrote in
// the meantime isn't overwritten.
function update(fn: (cur: NotificationEntry[]) => NotificationEntry[]): void {
  entries = fn(load() ?? entries).slice(0, MAX_ENTRIES)
  save()
  emit()
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return
    entries = load() ?? entries
    emit()
  })
}

export function recordNotification(input: NotificationInput): void {
  const body = (input.body ?? '').trim()
  const now = Date.now()
  update((cur) => {
    const top = cur[0]
    if (!input.id && top && top.kind === input.kind && top.title === input.title && top.body === body && now - top.at < REPEAT_MS) {
      return [{ ...top, at: now, count: (top.count ?? 1) + 1, read: top.read && (input.read ?? false) }, ...cur.slice(1)]
    }
    const id = input.id ?? `${input.kind}-${now.toString(36)}-${(seq++).toString(36)}`
    const entry: NotificationEntry = {
      id, kind: input.kind, title: input.title, body, at: now, read: input.read ?? false,
      ...(input.icon ? { icon: input.icon } : {}),
      ...(input.level ? { level: input.level } : {}),
      ...(input.target ? { target: input.target } : {}),
    }
    return [entry, ...cur.filter((e) => e.id !== id)]
  })
}

export function getNotifications(): NotificationEntry[] {
  return entries
}

export function unreadNotificationCount(list: NotificationEntry[] = entries): number {
  return list.reduce((n, e) => (e.read ? n : n + 1), 0)
}

export function markNotificationsRead(ids?: string[]): void {
  if (!entries.some((e) => !e.read && (!ids || ids.includes(e.id)))) return
  update((cur) => cur.map((e) => (e.read || (ids && !ids.includes(e.id)) ? e : { ...e, read: true })))
}

export function removeNotification(id: string): void {
  update((cur) => cur.filter((e) => e.id !== id))
}

/** Clears the log, or only the entries of the given kinds. */
export function clearNotifications(kinds?: NotificationKind[]): void {
  update((cur) => (kinds ? cur.filter((e) => !kinds.includes(e.kind)) : []))
}

export function subscribeNotificationHistory(listener: Listener): () => void {
  listeners.add(listener)
  listener(entries)
  return () => { listeners.delete(listener) }
}
