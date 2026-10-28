import { ReactNode, useEffect, useState } from 'react'
import { ChevronLeft } from 'lucide-react'

// ─── iOS navigation bar ───────────────────────────────────────────────────────
// The large-title pattern every root mobile screen shares: a 34pt title that
// scrolls with the page, and a compact bar pinned over the top that fades its
// glass and a small centered title in once the large one has scrolled under
// it. Screens own their scroller (several are virtualized lists bound to it),
// so these are pieces they place rather than a wrapper that takes over:
//
//   const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
//   const collapsed = useScrolledPast(scrollEl, LARGE_TITLE_COLLAPSE)
//   <div className="relative flex-1 min-h-0 flex flex-col">
//     <CompactBar title="Library" shown={collapsed} />
//     <div ref={setScrollEl} className="flex-1 overflow-y-auto pb-dock">
//       <LargeTitle title="Library" trailing={…} />
//       …
//
// Screens drawing under the status bar this way are listed in App.tsx's
// MOBILE_BLEED_TOP, which stops `main` reserving that strip for them.

/** Scroll distance at which a root screen's large title has passed under the
 *  compact bar. */
export const LARGE_TITLE_COLLAPSE = 36

/** Whether `el` is scrolled more than `px` down. Re-renders only when that
 *  flips, not on every scroll frame. Takes the element rather than a ref so it
 *  re-subscribes when a callback ref attaches a new scroller. */
export function useScrolledPast(el: HTMLElement | null, px: number): boolean {
  const [past, setPast] = useState(false)
  useEffect(() => {
    if (!el) { setPast(false); return }
    let raf = 0
    const check = (): void => { raf = 0; setPast(el.scrollTop > px) }
    const onScroll = (): void => { if (!raf) raf = requestAnimationFrame(check) }
    check()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [el, px])
  return past
}

/** The 34pt title, first thing inside a scroller. `inset` says what's above
 *  it: 'status' for a root screen drawn under the status bar, 'bar' for one
 *  with a compact bar row (a back button) above its title, 'none' when it sits
 *  in a header outside the scroller (Tracker, Files). Trailing actions share
 *  the title's line, the way the account button sits beside Apple Music's. */
export function LargeTitle({ title, subtitle, trailing, inset = 'status' }: {
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  inset?: 'status' | 'bar' | 'none'
}): JSX.Element {
  const paddingTop = inset === 'status' ? 'calc(var(--top-inset, 0px) + 0.5rem)'
    : inset === 'bar' ? 'calc(var(--top-inset, 0px) + 2.75rem)'
    : '0.25rem'
  return (
    <div className="flex items-center gap-2 px-4 pb-2" style={{ paddingTop }}>
      <div className="flex-1 min-w-0">
        <h1 className="text-large-title text-text-primary truncate">{title}</h1>
        {subtitle && <p className="text-subhead text-text-secondary truncate">{subtitle}</p>}
      </div>
      {trailing && <div className="flex items-center gap-2 shrink-0">{trailing}</div>}
    </div>
  )
}

/** The bar pinned over a scroller's top edge. Its glass and title fade in
 *  with `shown`; `leading`/`trailing` (a back button, a menu) stay visible
 *  either way. Without them it lets taps through to the page under it while
 *  hidden, so a root screen's large-title buttons beneath stay usable. */
export function CompactBar({ title, shown, leading, trailing }: {
  title?: ReactNode
  shown: boolean
  leading?: ReactNode
  trailing?: ReactNode
}): JSX.Element {
  const interactive = shown || !!leading || !!trailing
  return (
    <div
      className="absolute inset-x-0 top-0 z-10"
      style={{ paddingTop: 'var(--top-inset, 0px)', pointerEvents: interactive ? undefined : 'none' }}
    >
      <div
        aria-hidden
        className="absolute inset-0 glass-bar border-b border-[var(--separator)] transition-opacity duration-200"
        style={{ opacity: shown ? 1 : 0 }}
      />
      <div className="relative h-11 flex items-center gap-1 px-2">
        <div className="flex-1 basis-0 min-w-0 flex items-center">{leading}</div>
        {title != null && (
          <h2
            className="text-headline text-text-primary truncate text-center max-w-[60%] transition-opacity duration-200"
            style={{ opacity: shown ? 1 : 0 }}
          >{title}</h2>
        )}
        <div className="flex-1 basis-0 min-w-0 flex items-center justify-end gap-2">{trailing}</div>
      </div>
    </div>
  )
}

/** A round glass toolbar button, iOS 26-style (back, ⋯, large-title actions).
 *  44px, so the whole circle is the touch target. */
export function BarButton({ label, onClick, active, children, className = '' }: {
  label: string
  onClick: () => void
  active?: boolean
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`glass-button relative w-11 h-11 shrink-0 rounded-full flex items-center justify-center transition-opacity active:opacity-60 ${
        active ? 'text-accent' : 'text-text-primary'
      } ${className}`}
    >{children}</button>
  )
}

export function BackButton({ onClick, label = 'Back' }: { onClick: () => void; label?: string }): JSX.Element {
  return (
    <BarButton label={label} onClick={onClick}>
      <ChevronLeft size={24} strokeWidth={2.25} className="-ml-0.5" />
    </BarButton>
  )
}
