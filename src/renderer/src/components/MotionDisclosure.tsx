import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { usePresence } from '../hooks/usePresence'

const EXIT_MS = 240

// Keep the section's space until it has faded shut, then collapse in one
// layout change. No per-frame height changes, and no entrance when a restored
// open section mounts inside a view or dialog that is already animating.
export function MotionDisclosure({ open, children, className }: {
  open: boolean
  children: ReactNode
  className?: string
}): JSX.Element | null {
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const { mounted } = usePresence(open, reducedMotion ? 0 : EXIT_MS)
  const ref = useRef<HTMLDivElement>(null)
  const previousOpen = useRef(open)
  const animation = useRef<Animation | null>(null)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = (): void => setReducedMotion(media.matches)
    media.addEventListener('change', update)
    update()
    return () => media.removeEventListener('change', update)
  }, [])

  useLayoutEffect(() => {
    const changed = previousOpen.current !== open
    previousOpen.current = open
    const el = ref.current
    if (el) el.inert = !open
    if (!el || reducedMotion) {
      animation.current?.cancel()
      return
    }
    if (!changed) return

    // Reversing mid-animation starts where the section is, not from zero.
    const running = animation.current?.playState === 'running'
    const style = getComputedStyle(el)
    const from = running
      ? { opacity: style.opacity, transform: style.transform }
      : { opacity: open ? 0 : 1, transform: open ? 'translateY(-6px)' : 'none' }
    animation.current?.cancel()
    animation.current = el.animate([
      from,
      { opacity: open ? 1 : 0, transform: open ? 'none' : 'translateY(-4px)' },
    ], {
      duration: open ? 480 : EXIT_MS,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      fill: open ? 'none' : 'forwards',
    })
  }, [open, mounted, reducedMotion])

  useLayoutEffect(() => () => animation.current?.cancel(), [])

  return mounted && (!reducedMotion || open)
    ? <div ref={ref} className={className} aria-hidden={!open || undefined}>{children}</div>
    : null
}
