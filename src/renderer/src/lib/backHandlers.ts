// Opt-in stack for the Android hardware back button (see
// hooks/useAndroidBackButton). Most dismissable UI is store-backed and handled
// centrally there, but some surfaces keep their step state locally - Settings'
// mobile drill-down, for instance, where back should return to the category
// list rather than close the whole page. Those register a handler here.
//
// Handlers run last-registered-first (the innermost/most recently mounted UI
// gets first refusal) and return true when they consumed the press.

export type BackHandler = () => boolean

const handlers: BackHandler[] = []

/** Register a handler; returns the unregister function (use it in a cleanup). */
export function registerBackHandler(handler: BackHandler): () => void {
  handlers.push(handler)
  return () => {
    const i = handlers.indexOf(handler)
    if (i >= 0) handlers.splice(i, 1)
  }
}

/** True when some handler consumed the press. */
export function runBackHandlers(): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i]()) return true
  }
  return false
}
