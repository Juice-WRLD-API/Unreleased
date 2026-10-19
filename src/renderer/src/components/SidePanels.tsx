import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import ErrorBoundary from './ErrorBoundary'
import NowPlaying from './NowPlaying'
import QueuePanel from './QueuePanel'
import { usePresence } from '../hooks/usePresence'

const ENTER_MS = 520
const EXIT_MS = 340
const GLIDE_MS = 460
const ENTER_EASE = 'cubic-bezier(0.33, 0, 0.15, 1)'
const EXIT_EASE = 'cubic-bezier(0.4, 0, 0.6, 1)'
const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// One side panel's place at the right of the main row. Only transform and
// opacity ever move, so nothing reflows per frame:
//  - opening, the panel takes its space in the layout at once (the view
//    narrows in one reflow) and slides and fades in over that space;
//  - closing, the space is handed straight back - the view widens under the
//    panel - while the panel, lifted out of the layout onto the spot it had,
//    slides and fades away on top, uncovering the view already laid out.
// The slot itself always renders (empty while closed) so a panel's first open
// animates too. On a phone the panels are fixed full-screen sheets and the
// same motion plays on them in place.
function SidePanelSlot({ open, keepMounted = false, slotRef, children }: {
  open: boolean
  /** Hide instead of unmounting once closed (after the first open). */
  keepMounted?: boolean
  slotRef: RefObject<HTMLDivElement>
  children: ReactNode
}): JSX.Element {
  const { mounted, exiting } = usePresence(open, reducedMotion() ? 0 : EXIT_MS)
  const [everOpened, setEverOpened] = useState(open)
  if (open && !everOpened) setEverOpened(true)
  const prevOpen = useRef(open)

  useLayoutEffect(() => {
    if (prevOpen.current === open) return
    prevOpen.current = open
    const slot = slotRef.current
    const panel = slot?.firstElementChild
    if (!slot || !(panel instanceof HTMLElement)) return
    panel.getAnimations().forEach(a => a.cancel())
    if (open) {
      Object.assign(slot.style, { position: '', top: '', bottom: '', left: '', width: '', zIndex: '' })
      if (reducedMotion()) return
      panel.animate(
        [
          { opacity: 0, transform: 'translateX(48px)' },
          { opacity: 1, offset: 0.55 },
          { opacity: 1, transform: 'translateX(0)' },
        ],
        { duration: ENTER_MS, easing: ENTER_EASE },
      )
    } else {
      if (reducedMotion()) return
      // Above the view's own sticky headers while it leaves.
      Object.assign(slot.style, {
        position: 'absolute', top: '0', bottom: '0', zIndex: '30',
        left: `${slot.offsetLeft}px`, width: `${slot.offsetWidth}px`,
      })
      panel.animate(
        [{ opacity: 0, transform: 'translateX(32px)' }],
        { duration: EXIT_MS, easing: EXIT_EASE, fill: 'forwards' },
      )
    }
  }, [open, slotRef])

  const render = keepMounted ? everOpened : mounted
  // flex so the panel stretches to the full height; a plain block wrapper let
  // it collapse to its content height.
  return (
    <div ref={slotRef} className="flex shrink-0" style={open || exiting ? undefined : { display: 'none' }}>
      {render && <ErrorBoundary>{children}</ErrorBoundary>}
    </div>
  )
}

// The Now Playing and Queue panels beside the main view. Queue sits to the
// right of Now Playing, so opening or closing it moves Now Playing sideways by
// the queue's width - glided rather than jumped, the same transform trick.
export default function SidePanels({ nowPlaying, queue }: { nowPlaying: boolean; queue: boolean }): JSX.Element {
  const npRef = useRef<HTMLDivElement>(null)
  const queueRef = useRef<HTMLDivElement>(null)
  const prevQueue = useRef(queue)

  // Runs after the slots' own effects, so a closing queue has already been
  // lifted out of the layout (at its full width) when this measures it.
  useLayoutEffect(() => {
    if (prevQueue.current === queue) return
    prevQueue.current = queue
    const panel = npRef.current?.firstElementChild
    const w = queueRef.current?.offsetWidth ?? 0
    if (!nowPlaying || !w || !(panel instanceof HTMLElement) || reducedMotion()) return
    // Added onto whatever the panel is already doing (its own entrance, an
    // earlier glide) rather than replacing it.
    panel.animate(
      [{ transform: `translateX(${queue ? w : -w}px)` }, { transform: 'translateX(0)' }],
      { duration: GLIDE_MS, easing: ENTER_EASE, composite: 'add' },
    )
  }, [queue, nowPlaying])

  return (
    <>
      <SidePanelSlot open={nowPlaying} slotRef={npRef}><NowPlaying /></SidePanelSlot>
      {/* Kept mounted after its first open: unmounting destroyed every cover
          <img>, so reopening the queue made them all reload/re-decode from
          scratch instead of just reappearing. */}
      <SidePanelSlot open={queue} keepMounted slotRef={queueRef}><QueuePanel /></SidePanelSlot>
    </>
  )
}
