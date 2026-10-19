import { RefObject, useLayoutEffect, useRef } from 'react'

// The close for menus and popovers: a quick fade as it settles back toward
// where it opened (the counterpart of .animate-menu-pop).
export const popOut = (ghost: HTMLElement): Animation =>
  ghost.animate([{ opacity: 0, transform: 'scale(0.97)' }], { duration: 130, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' })

// Lets something that closes by unmounting - a modal, a menu - still animate
// out. React drops its DOM the moment the owner stops rendering it, so on
// unmount this puts a copy back in its place (inert, see .exit-ghost in
// index.css, with scroll positions and canvas pixels carried over), plays
// `exit` on the copy, and removes the copy when that animation ends. Callers
// keep their plain `{open && <Thing />}` - nothing upstream has to hold the
// component mounted through its exit.
//
// `exit` returns the animation whose end retires the copy. Skipped under
// prefers-reduced-motion, and when the element wasn't on screen to begin with
// (a collapsed sandbox, a view hidden under the terminal).
export function useExitGhost(
  ref: RefObject<HTMLElement>,
  exit: ((ghost: HTMLElement) => Animation) | null,
): void {
  const exitRef = useRef(exit)
  exitRef.current = exit

  useLayoutEffect(() => () => {
    const el = ref.current
    const play = exitRef.current
    const parent = el?.parentNode
    if (!el || !play || !parent || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') return

    // Copied now, while the original is still laid out - a detached node
    // reads every scrollTop as 0.
    const next = el.nextSibling
    const ghost = el.cloneNode(true) as HTMLElement
    const from = [el, ...el.querySelectorAll('*')]
    const scrolls: [number, number, number][] = []
    const canvases: number[] = []
    from.forEach((n, i) => {
      if (n.scrollTop || n.scrollLeft) scrolls.push([i, n.scrollTop, n.scrollLeft])
      if (n instanceof HTMLCanvasElement) canvases.push(i)
    })

    // Cleanup also runs for StrictMode's dev-only simulated unmount, which
    // leaves the DOM in place - by the end of the commit only a real removal
    // has disconnected the original.
    queueMicrotask(() => {
      if (el.isConnected || !parent.isConnected) return
      ghost.classList.add('exit-ghost')
      ghost.setAttribute('inert', '')
      ghost.setAttribute('aria-hidden', 'true')
      // Its images re-request on cloning; don't let lib/imageFade hide them.
      ghost.setAttribute('data-no-fade', '')
      parent.insertBefore(ghost, next?.parentNode === parent ? next : null)
      const to = [ghost, ...ghost.querySelectorAll('*')]
      for (const [i, top, left] of scrolls) { to[i].scrollTop = top; to[i].scrollLeft = left }
      for (const i of canvases) {
        try { (to[i] as HTMLCanvasElement).getContext('2d')?.drawImage(from[i] as HTMLCanvasElement, 0, 0) } catch { /* empty or tainted */ }
      }
      const done = (): void => ghost.remove()
      play(ghost).finished.then(done, done)
      // A hidden window doesn't advance animations - don't leave the copy
      // sitting there until it's shown again.
      window.setTimeout(done, 1000)
    })
  }, [ref])
}
