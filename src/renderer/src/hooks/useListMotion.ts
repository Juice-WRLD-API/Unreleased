import { RefObject, useLayoutEffect, useRef } from 'react'

const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'
// More rows than this coming or going at once is a different list (a new
// queue), not an edit of this one - it just swaps in.
const MAX_CHANGED = 4

interface Row { el: HTMLElement; y: number; left: number; width: number; height: number }

export interface ListMotionOptions {
  /** Keyframes for a row that just arrived. */
  enter?: Keyframe[]
  /** Keyframes (to only - they start from the row as it was) for a row that left. */
  exit?: Keyframe[]
  /** The edge of the container that stays put on screen as rows come and go:
   *  'top' for an ordinary list, 'bottom' for a stack that grows upward (toasts). */
  anchor?: 'top' | 'bottom'
}

// For a bottom-anchored toast stack: a toast rises into place; one that's
// dismissed or times out sinks away, and the ones above settle into the gap.
export const TOAST_MOTION: ListMotionOptions = {
  anchor: 'bottom',
  enter: [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0)' }],
  exit: [{ opacity: 0, transform: 'translateY(8px)' }],
}

// Animates edits to a list, so rows move rather than jump: a row that leaves
// fades out where it was (on a copy - React has already removed it) while the
// rows after it slide into the gap; a row that arrives fades in while the
// others slide aside; a reorder slides every row to its new place. Only
// transforms and opacity, from layout positions (offsetTop - unaffected by
// scrolling or by slides still running) read once per commit.
//
// Rows are the container's direct children carrying `data-flip-key` (stable
// across the edit - not an index). The container must be positioned
// (relative/fixed), since leaving rows are pinned inside it while they fade.
export function useListMotion(ref: RefObject<HTMLElement>, { enter, exit, anchor = 'top' }: ListMotionOptions = {}): void {
  const last = useRef<Map<string, Row> | null>(null)

  // Every commit: compare against where the rows were after the last one.
  useLayoutEffect(() => {
    const box = ref.current
    const prev = last.current
    // Not rendered (or hidden - a kept-mounted panel that's closed): nothing
    // to measure, and whatever shows next is a fresh start, not an edit.
    if (!box || !box.getClientRects().length) { last.current = null; return }
    const next = new Map<string, Row>()
    // Measured from the anchored edge, so a stack growing upward from a fixed
    // bottom reads as its older rows moving up.
    const base = anchor === 'bottom' ? box.clientHeight : 0
    for (const el of box.querySelectorAll<HTMLElement>(':scope > [data-flip-key]')) {
      next.set(el.dataset.flipKey!, { el, y: el.offsetTop - base, left: el.offsetLeft, width: el.offsetWidth, height: el.offsetHeight })
    }
    last.current = next
    if (!prev || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const gone = [...prev.entries()].filter(([k]) => !next.has(k)).map(([, p]) => p)
    const added = [...next.entries()].filter(([k]) => !prev.has(k)).map(([, n]) => n)
    const kept = next.size - added.length
    if (gone.length > MAX_CHANGED || added.length > MAX_CHANGED || (kept === 0 && gone.length > 0 && added.length > 0)) return

    for (const [k, n] of next) {
      const p = prev.get(k)
      if (!p || p.y === n.y) continue
      // Added onto any slide still running, so quick edits chain smoothly.
      n.el.animate(
        [{ transform: `translateY(${p.y - n.y}px)` }, { transform: 'translateY(0)' }],
        { duration: 460, easing: EASE, composite: 'add' },
      )
    }
    for (const n of added) {
      n.el.animate(enter ?? [{ opacity: 0 }, { opacity: 1 }], { duration: 450, easing: EASE })
    }
    for (const p of gone) {
      // The row's own (now detached) element still holds what it showed.
      const ghost = p.el.cloneNode(true) as HTMLElement
      ghost.removeAttribute('data-flip-key')
      ghost.classList.add('exit-ghost')
      ghost.setAttribute('inert', '')
      ghost.setAttribute('aria-hidden', 'true')
      // Its images re-request on cloning; don't let lib/imageFade hide them.
      ghost.setAttribute('data-no-fade', '')
      Object.assign(ghost.style, {
        position: 'absolute', margin: '0', top: `${p.y + base}px`, left: `${p.left}px`, width: `${p.width}px`, height: `${p.height}px`,
      })
      box.appendChild(ghost)
      const done = (): void => ghost.remove()
      ghost.animate(exit ?? [{ opacity: 0, transform: 'translateX(-12px)' }], { duration: 300, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', fill: 'forwards' })
        .finished.then(done, done)
      // A hidden window doesn't advance animations.
      window.setTimeout(done, 1000)
    }
  })
}
