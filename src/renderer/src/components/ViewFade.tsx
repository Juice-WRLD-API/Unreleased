import { useLayoutEffect, useRef } from 'react'

// Fades and lifts a view in as it becomes the one on screen: on mount for most
// views, and on coming back out from under the terminal for the views held
// there (App.tsx). A one-shot Web Animation with no fill, so nothing is left on
// the view afterwards - a lingering transform would make every position:fixed
// overlay inside it position against the view instead of the window. The
// wrapper is display: contents, so the view lays out exactly as it would
// without it.
export default function ViewFade({ active, children }: { active: boolean; children: React.ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!active) return
    const el = ref.current?.firstElementChild
    if (!(el instanceof HTMLElement) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    el.animate(
      [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
      { duration: 280, easing: 'cubic-bezier(0.33, 0, 0.15, 1)' },
    )
  }, [active])
  return <div ref={ref} className={active ? 'contents' : 'hidden'}>{children}</div>
}
