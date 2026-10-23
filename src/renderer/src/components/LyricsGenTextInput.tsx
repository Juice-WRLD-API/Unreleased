import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { findAdlibs } from '../lib/lyricsGenApi'

// The "Lyrics to time" box in the Generate lyrics dialog. With adlib removal
// on, a copy of the text is drawn over the textarea (whose own text is then
// transparent) so each adlib can be shown and clicked: grey ones are left
// out, clicking one keeps it, clicking it again leaves it out. Everything
// else in the layer lets the pointer through, so the text still edits as usual.

const BOX = 'px-4 py-3 text-sm leading-relaxed'
const LEFT_OUT = 'rounded-sm box-decoration-clone text-text-muted bg-[color-mix(in_srgb,var(--text-muted)_22%,transparent)] hover:bg-[color-mix(in_srgb,var(--text-muted)_34%,transparent)]'
const KEPT = 'rounded-sm box-decoration-clone underline decoration-dotted decoration-text-muted underline-offset-4 hover:bg-[color-mix(in_srgb,var(--text-muted)_14%,transparent)]'

/** Moves offsets in `before` to where they sit in `after`, for a single edit
 *  (typing, a paste, a cut). Offsets inside the changed stretch are dropped. */
export function shiftOffsets(offsets: ReadonlySet<number>, before: string, after: string): ReadonlySet<number> {
  if (!offsets.size || before === after) return offsets
  const max = Math.min(before.length, after.length)
  let head = 0
  while (head < max && before[head] === after[head]) head++
  let tail = 0
  while (tail < max - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++
  const delta = after.length - before.length
  const out = new Set<number>()
  for (const o of offsets) {
    if (o < head) out.add(o)
    else if (o >= before.length - tail) out.add(o + delta)
  }
  return out
}

export default function LyricsGenTextInput({ value, onChange, disabled, placeholder, adlibs }: {
  value: string
  onChange: (next: string) => void
  disabled: boolean
  placeholder: string
  /** Set when adlibs are being removed: the starts of the ones to keep anyway. */
  adlibs: { kept: ReadonlySet<number>; onToggle: (start: number) => void } | null
}): JSX.Element {
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const spans = useMemo(() => (adlibs ? findAdlibs(value) : []), [adlibs, value])
  const drawn = !!adlibs && spans.length > 0

  // The layer matches the textarea's inside: its size less any scrollbar, and
  // its scroll position.
  useLayoutEffect(() => {
    const area = areaRef.current
    const layer = layerRef.current
    if (!drawn || !area || !layer) return
    const fit = (): void => {
      layer.style.width = `${area.clientWidth}px`
      layer.style.height = `${area.clientHeight}px`
      layer.scrollTop = area.scrollTop
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(area)
    return () => ro.disconnect()
  }, [drawn, value])

  // A wheel over an adlib would otherwise scroll the dialog, not the box.
  useEffect(() => {
    const layer = layerRef.current
    if (!drawn || !layer) return
    const onWheel = (e: WheelEvent): void => {
      const area = areaRef.current
      if (!area) return
      const next = Math.max(0, Math.min(area.scrollHeight - area.clientHeight, area.scrollTop + e.deltaY))
      if (next === area.scrollTop) return
      e.preventDefault()
      area.scrollTop = next
    }
    layer.addEventListener('wheel', onWheel, { passive: false })
    return () => layer.removeEventListener('wheel', onWheel)
  }, [drawn])

  const parts: JSX.Element[] = []
  if (drawn) {
    let at = 0
    for (const s of spans) {
      if (s.start > at) parts.push(<span key={`t${at}`}>{value.slice(at, s.start)}</span>)
      const kept = adlibs.kept.has(s.start)
      parts.push(
        <span
          key={s.start}
          title={kept ? 'Sent. Click to leave it out' : 'Left out. Click to send it'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => adlibs.onToggle(s.start)}
          className={`transition-colors ${disabled ? '' : 'pointer-events-auto cursor-pointer'} ${kept ? KEPT : LEFT_OUT}`}
        >
          {value.slice(s.start, s.end)}
        </span>,
      )
      at = s.end
    }
    parts.push(<span key={`t${at}`}>{value.slice(at)}{'​'}</span>)
  }

  return (
    <div className="relative">
      <textarea
        ref={areaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => { if (layerRef.current) layerRef.current.scrollTop = e.currentTarget.scrollTop }}
        disabled={disabled}
        spellCheck={false}
        placeholder={placeholder}
        className={`block w-full h-44 resize-y rounded-xl border border-[var(--border)] bg-surface-overlay/40 ${BOX} placeholder:text-text-muted/70 focus:outline-none focus:border-accent/60 transition-[border-color] ${
          drawn ? 'text-transparent caret-text-primary' : 'text-text-primary'
        }`}
      />
      {drawn && (
        <div
          ref={layerRef}
          aria-hidden="true"
          className={`absolute top-px left-px overflow-hidden pointer-events-none whitespace-pre-wrap break-words text-text-primary ${BOX}`}
        >
          {parts}
        </div>
      )}
    </div>
  )
}
