import { useEffect, useRef } from 'react'

// Escape closes this layer - the desktop counterpart to useBackToClose, and
// deliberately the same shape.
//
// One shared keydown listener walks a last-registered-first stack, so a dialog
// opened on top of another gets the key and only the innermost layer closes.
// Registering per-component (rather than each modal binding its own window
// listener, which is what several of them used to do) is what makes that
// ordering possible at all: independent listeners all fire on the same press.
//
// `active` is for callers that stay mounted while closed, and for the ones
// that only want the key in some modes - ModalOverlay skips it for panels
// docked in the sandbox, since those don't block the app behind them and so
// have no dismissal for Escape to mean.
//
// An inner control that wants Escape for itself - cancelling an inline rename,
// say - stops the event: React's stopPropagation halts the native event too,
// so it never reaches the window and the surrounding dialog stays open.
type EscapeHandler = () => void

const handlers: EscapeHandler[] = []

function onWindowKeyDown(e: KeyboardEvent): void {
  // defaultPrevented covers anything that already consumed the press, and an
  // in-flight IME composition sends Escape to cancel the candidate, not us.
  if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return
  handlers[handlers.length - 1]?.()
}

export function useEscapeToClose(onClose: () => void, active = true): void {
  // The callback goes through a ref so the effect depends only on `active`.
  // Depending on `onClose` would re-run it whenever a caller passes a fresh
  // arrow (most do), popping and re-pushing that handler on every render and
  // quietly promoting an outer dialog to the top of the stack.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!active) return
    const handler = (): void => onCloseRef.current()
    handlers.push(handler)
    if (handlers.length === 1) window.addEventListener('keydown', onWindowKeyDown)
    return () => {
      const i = handlers.indexOf(handler)
      if (i >= 0) handlers.splice(i, 1)
      if (handlers.length === 0) window.removeEventListener('keydown', onWindowKeyDown)
    }
  }, [active])
}
