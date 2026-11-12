import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export interface GlassSegOption<T extends string> {
  value: T
  label?: ReactNode
  icon?: ReactNode
  title?: string
  onPointerEnter?: () => void
  onFocus?: () => void
}

/** Glass segmented control: a veil track whose raised thumb slides to the
 *  chosen option (styles: .glass-seg in index.css). Options with no label
 *  render as icon-only squares. */
export function GlassSegmented<T extends string>({ options, value, onChange, className = '', ariaLabel }: {
  options: GlassSegOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
  ariaLabel?: string
}): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null)
  // The first placement jumps; only later moves slide.
  const [ready, setReady] = useState(false)

  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return
    const place = (): void => {
      const btn = track.querySelector<HTMLElement>('[data-seg-on="true"]')
      setThumb((prev) => {
        if (!btn) return null
        const next = { x: btn.offsetLeft, w: btn.offsetWidth }
        return prev && prev.x === next.x && prev.w === next.w ? prev : next
      })
    }
    place()
    // Labels change width with the app's text scale and fonts loading.
    const ro = new ResizeObserver(place)
    ro.observe(track)
    for (const child of Array.from(track.children)) ro.observe(child)
    return () => ro.disconnect()
  }, [value, options.length])

  useLayoutEffect(() => {
    if (!thumb || ready) return
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [thumb, ready])

  return (
    <div ref={trackRef} role="radiogroup" aria-label={ariaLabel} className={`glass-seg glass-specular max-w-full overflow-x-auto no-scrollbar ${className}`}>
      {thumb && (
        <span
          aria-hidden
          className={`glass-seg-thumb ${ready ? 'is-ready' : ''}`}
          style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }}
        />
      )}
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-seg-on={on}
            title={o.title}
            onClick={() => onChange(o.value)}
            onPointerEnter={o.onPointerEnter}
            onFocus={o.onFocus}
            className={`shrink-0 flex items-center justify-center gap-1.5 h-[34px] md:h-[30px] rounded-full text-xs font-medium whitespace-nowrap transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              o.label ? 'px-3.5' : 'w-[34px] md:w-[30px]'
            } ${on ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
          >
            {o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Option label with a count after it, muted (status filters). */
export function SegCount({ label, count }: { label: ReactNode; count?: number }): JSX.Element {
  return (
    <>
      <span className="capitalize">{label}</span>
      {!!count && <span className="text-[10px] tabular-nums opacity-60">{count}</span>}
    </>
  )
}
