import { useLayoutEffect, useRef, type RefObject } from 'react'

// Animate a content change, not the first mount: the surrounding view or
// dialog already owns its entrance. Opacity keeps nested fixed menus anchored
// to the viewport, and leaves mounted tabs' state and scroll positions alone.
export function useContentMotion(ref: RefObject<HTMLElement>, contentKey: string, ready = true): void {
  const previousKey = useRef(contentKey)
  const hasContent = useRef(ready)
  const pending = useRef(false)

  useLayoutEffect(() => {
    // Folder navigation can show a spinner before updating its path. Save
    // the transition for the loaded listing, without animating first load.
    if (!ready) { pending.current = hasContent.current; return }
    const changed = hasContent.current && (previousKey.current !== contentKey || pending.current)
    previousKey.current = contentKey
    hasContent.current = true
    pending.current = false
    const el = ref.current
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (!changed || !el?.getClientRects().length || reducedMotion.matches) return

    const animation = el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 460, easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    })
    const cancel = (): void => animation.cancel()
    reducedMotion.addEventListener('change', cancel)
    return () => {
      cancel()
      reducedMotion.removeEventListener('change', cancel)
    }
  }, [contentKey, ref, ready])
}
