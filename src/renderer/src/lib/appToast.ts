// App-wide error toast, for optimistic actions that have to roll back. Quick
// actions (add to playlist, like, reorder, ...) update the UI straight away
// and send the request in the background; when it fails the caller restores
// the old state and calls showAppToast so the revert doesn't look like a
// glitch. Rendered by AppToastHost, mounted once in App.tsx. Plain module
// state rather than the store, so lib code and the store itself can call it.
// An 'info' toast can carry one action button (e.g. "queue ended - start radio").
// Every toast is also logged to the notification area (lib/notificationHistory),
// already read, since it answers something the user just did.
import { recordNotification } from './notificationHistory'

export interface AppToastAction { label: string; onClick: () => void }
export interface AppToast { id: number; text: string; tone: 'error' | 'info'; action?: AppToastAction }

type Listener = (toasts: AppToast[]) => void

let toasts: AppToast[] = []
let nextId = 1
const listeners = new Set<Listener>()

function emit(): void {
  listeners.forEach(l => l(toasts))
}

export function dismissAppToast(id: number): void {
  toasts = toasts.filter(t => t.id !== id)
  emit()
}

export function showAppToast(text: string, opts?: { tone?: 'error' | 'info'; action?: AppToastAction }): void {
  const id = nextId++
  // Same text already showing (e.g. a bulk add where every request failed):
  // keep the one toast instead of stacking copies.
  toasts = [...toasts.filter(t => t.text !== text).slice(-2), { id, text, tone: opts?.tone ?? 'error', action: opts?.action }]
  emit()
  recordNotification({ kind: 'app', title: text, level: opts?.tone === 'info' ? 'info' : 'error', read: true })
  // A toast with a button stays up a bit longer so there's time to reach it.
  setTimeout(() => dismissAppToast(id), opts?.action ? 6500 : 4200)
}

export function subscribeAppToasts(listener: Listener): () => void {
  listeners.add(listener)
  listener(toasts)
  return () => { listeners.delete(listener) }
}
