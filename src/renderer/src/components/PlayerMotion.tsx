import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

// Small motion pieces for the player controls. Each one animates on a change
// of its key, never on mount, and compares against the previous key itself -
// so StrictMode's dev-only effect re-run (same key) doesn't fire it either.

const ENTER_EASE = 'cubic-bezier(0.33, 0, 0.15, 1)'
const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Play <-> pause (or any icon pair): the new icon scales up into place with a
 *  slight overshoot instead of a hard cut. */
export function SwapIcon({ swapKey, children }: { swapKey: string | boolean; children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const prev = useRef(swapKey)
  useLayoutEffect(() => {
    if (prev.current === swapKey) return
    prev.current = swapKey
    if (reducedMotion()) return
    ref.current?.animate(
      [{ opacity: 0, transform: 'scale(0.55)' }, { opacity: 1, transform: 'scale(1)' }],
      { duration: 260, easing: 'cubic-bezier(0.3, 1.25, 0.5, 1)' },
    )
  }, [swapKey])
  return <span ref={ref} className="inline-flex">{children}</span>
}

/** Title/artist block that slides in when the track changes: from the right
 *  for the next song in the queue, from the left for the previous one, and a
 *  small rise when it's neither (a song started from a list). `order` is the
 *  queue position the direction is read from. */
export function TrackSwap({ swapKey, order, className, children }: {
  swapKey: string
  order?: number
  className?: string
  children: ReactNode
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const prev = useRef({ swapKey, order })
  useLayoutEffect(() => {
    const p = prev.current
    prev.current = { swapKey, order }
    if (p.swapKey === swapKey || reducedMotion()) return
    const step = order != null && p.order != null ? order - p.order : 0
    ref.current?.animate(
      [
        { opacity: 0, transform: step === 1 || step === -1 ? `translateX(${step * 16}px)` : 'translateY(6px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 380, easing: ENTER_EASE },
    )
  }, [swapKey, order])
  return <div ref={ref} className={className}>{children}</div>
}

/** Cover art that crossfades between songs: the old cover fades out at once
 *  (so it never lingers next to the new title) and the new one fades in as
 *  soon as it has loaded. At most two layers; the outgoing one is dropped when
 *  its fade ends. Fills its parent. */
export function CoverFade({ src, alt = '', onError }: { src: string; alt?: string; onError?: () => void }): JSX.Element {
  const [layers, setLayers] = useState([{ src, ready: false }])
  const top = layers[layers.length - 1]
  if (top.src !== src) setLayers(top.ready ? [top, { src, ready: false }] : [{ src, ready: false }])
  return (
    <div className="relative w-full h-full">
      {layers.map((l, i) => {
        const isTop = i === layers.length - 1
        return (
          <img
            key={l.src}
            src={l.src}
            alt={isTop ? alt : ''}
            className="cover-fade absolute inset-0 w-full h-full object-cover"
            // Fades itself (below) - kept out of lib/imageFade's load fade.
            data-no-fade
            style={{ opacity: isTop && l.ready ? 1 : 0 }}
            onLoad={() => setLayers(ls => ls.map(x => (x.src === l.src ? { ...x, ready: true } : x)))}
            onTransitionEnd={() => setLayers(ls => (ls[ls.length - 1].src === l.src ? ls : ls.filter(x => x.src !== l.src)))}
            onError={isTop ? onError : undefined}
          />
        )
      })}
    </div>
  )
}

/** The like heart: a pop with a ring bursting out of it when the song becomes
 *  liked (from here, a hotkey or a menu - anything that flips it for the same
 *  song), a small dip when it's unliked. Switching songs never animates it. */
export function LikePop({ liked, trackKey, children }: { liked: boolean; trackKey: string; children: ReactNode }): JSX.Element {
  const iconRef = useRef<HTMLSpanElement>(null)
  const ringRef = useRef<HTMLSpanElement>(null)
  const prev = useRef({ liked, trackKey })
  useLayoutEffect(() => {
    const p = prev.current
    prev.current = { liked, trackKey }
    if (p.trackKey !== trackKey || p.liked === liked || reducedMotion()) return
    if (liked) {
      iconRef.current?.animate(
        [
          { transform: 'scale(1)', easing: 'cubic-bezier(0.2, 0, 0.4, 1)' },
          { transform: 'scale(1.4)', offset: 0.3, easing: 'cubic-bezier(0.4, 0, 0.6, 1)' },
          { transform: 'scale(0.9)', offset: 0.65, easing: 'cubic-bezier(0.4, 0, 0.6, 1)' },
          { transform: 'scale(1)' },
        ],
        { duration: 480 },
      )
      ringRef.current?.animate(
        [{ opacity: 0.7, transform: 'scale(0.5)' }, { opacity: 0, transform: 'scale(1.9)' }],
        { duration: 520, easing: ENTER_EASE },
      )
    } else {
      iconRef.current?.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(0.75)', offset: 0.4 }, { transform: 'scale(1)' }],
        { duration: 260, easing: 'cubic-bezier(0.4, 0, 0.6, 1)' },
      )
    }
  }, [liked, trackKey])
  return (
    <span className="relative inline-flex">
      <span ref={ringRef} aria-hidden className="absolute inset-0 rounded-full border border-current opacity-0 pointer-events-none" />
      <span ref={iconRef} className="inline-flex">{children}</span>
    </span>
  )
}
