// Hands a session zip to the Session Maker view from elsewhere in the app (the
// song menu, the terminal). Its own module so callers don't pull the editor's
// audio code into the main bundle. The request is held until the view picks
// it up, since it's usually made just before navigating there.

let pending: string | null = null
const listeners = new Set<() => void>()

export function requestOpenSession(zipPath: string): void {
  pending = zipPath
  for (const l of listeners) l()
}

export function takePendingSession(): string | null {
  const z = pending
  pending = null
  return z
}

export function onOpenSessionRequest(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
