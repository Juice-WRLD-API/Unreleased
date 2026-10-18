import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPopover } from './anchoredPopover'

/* A themed stand-in for <input type="color">. The native one opens the
   Windows color dialog, which is OS chrome through and through; this is a
   swatch button plus a popover with a saturation/brightness square, a hue
   strip and a hex field, styled like ThemedSelect's list.

   onChange fires live while dragging with a lowercase #rrggbb, like the
   native input's change events, so callers that debounced those keep doing
   so. Hue/saturation are held locally so dragging through grey or black
   doesn't snap the hue back to red. Keyboard: arrows nudge the square or the
   strip (Shift: ×10), Escape closes. */

const WIDTH = 236
const HEIGHT = 250

type Hsv = { h: number; s: number; v: number }

function parseHex(v: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim())
  if (!m) return null
  const x = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1]
  return `#${x.toLowerCase()}`
}
function hexToHsv(hex: string): Hsv {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b)
  let h = 0
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max }
}
function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number): number => {
    const k = (n + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return '#' + [f(5), f(3), f(1)].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')
}
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))

function Panel({ value, onChange, onClose }: { value: string; onChange: (hex: string) => void; onClose: () => void }): JSX.Element {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value))
  const [text, setText] = useState(value)
  const lastSent = useRef(value)
  const svRef = useRef<HTMLDivElement>(null)

  // Follow outside changes (a preset clicked behind the popover) without
  // fighting our own echoes.
  useEffect(() => {
    if (value === lastSent.current) return
    lastSent.current = value
    setHsv(hexToHsv(value))
    setText(value)
  }, [value])

  useEffect(() => { svRef.current?.focus() }, [])

  const commit = (next: Hsv): void => {
    setHsv(next)
    const hex = hsvToHex(next)
    setText(hex)
    if (hex !== lastSent.current) { lastSent.current = hex; onChange(hex) }
  }

  const drag = (el: HTMLElement, e: PointerEvent, apply: (x: number, y: number) => void): void => {
    e.preventDefault()
    el.setPointerCapture(e.pointerId)
    const at = (ev: { clientX: number; clientY: number }): void => {
      const r = el.getBoundingClientRect()
      apply(clamp01((ev.clientX - r.left) / r.width), clamp01((ev.clientY - r.top) / r.height))
    }
    at(e)
    const move = (ev: globalThis.PointerEvent): void => at(ev)
    const up = (): void => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up) }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  // Latest hsv for the pointer callbacks above, which outlive a render.
  const hsvRef = useRef(hsv)
  hsvRef.current = hsv

  const nudge = (e: KeyboardEvent, axes: Record<string, () => Hsv>): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return }
    const f = axes[e.key]
    if (f) { e.preventDefault(); commit(f()) }
  }
  const k = (e: KeyboardEvent): number => (e.shiftKey ? 10 : 1)

  const hex = hsvToHex(hsv)
  const thumb = 'absolute w-3.5 h-3.5 -ml-[7px] -mt-[7px] rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)] pointer-events-none'
  const focusRing = 'outline-none focus-visible:ring-2 focus-visible:ring-accent/60'

  return (
    <div>
      <div
        ref={svRef}
        tabIndex={0}
        role="slider"
        aria-label="Saturation and brightness"
        aria-valuetext={hex}
        onPointerDown={e => drag(e.currentTarget, e, (x, y) => commit({ ...hsvRef.current, s: x, v: 1 - y }))}
        onKeyDown={e => nudge(e, {
          ArrowLeft: () => ({ ...hsv, s: clamp01(hsv.s - k(e) / 100) }),
          ArrowRight: () => ({ ...hsv, s: clamp01(hsv.s + k(e) / 100) }),
          ArrowUp: () => ({ ...hsv, v: clamp01(hsv.v + k(e) / 100) }),
          ArrowDown: () => ({ ...hsv, v: clamp01(hsv.v - k(e) / 100) }),
        })}
        className={`relative h-[140px] rounded-lg cursor-crosshair touch-none ${focusRing}`}
        style={{
          backgroundColor: `hsl(${hsv.h}, 100%, 50%)`,
          backgroundImage: 'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)',
        }}
      >
        <span className={thumb} style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
      </div>

      <div
        tabIndex={0}
        role="slider"
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onPointerDown={e => drag(e.currentTarget, e, x => commit({ ...hsvRef.current, h: x * 360 }))}
        onKeyDown={e => nudge(e, {
          ArrowLeft: () => ({ ...hsv, h: Math.max(0, hsv.h - k(e)) }),
          ArrowDown: () => ({ ...hsv, h: Math.max(0, hsv.h - k(e)) }),
          ArrowRight: () => ({ ...hsv, h: Math.min(360, hsv.h + k(e)) }),
          ArrowUp: () => ({ ...hsv, h: Math.min(360, hsv.h + k(e)) }),
        })}
        className={`relative h-3 mt-3 rounded-full cursor-pointer touch-none ${focusRing}`}
        style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
      >
        <span className={`${thumb} top-1/2`} style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h}, 100%, 50%)` }} />
      </div>

      <div className="flex items-center gap-2 mt-3">
        <span className="w-7 h-7 rounded-lg shrink-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]" style={{ background: hex }} />
        <input
          value={text}
          onChange={e => {
            setText(e.target.value)
            const p = parseHex(e.target.value)
            if (p) { setHsv(hexToHsv(p)); if (p !== lastSent.current) { lastSent.current = p; onChange(p) } }
          }}
          onBlur={() => setText(hex)}
          onKeyDown={e => {
            if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onClose() }
          }}
          spellCheck={false}
          maxLength={7}
          aria-label="Hex color"
          className="flex-1 min-w-0 h-7 rounded-lg bg-surface-overlay border border-[var(--border)] px-2 text-xs font-mono text-text-primary outline-none focus:border-accent/50"
        />
      </div>
    </div>
  )
}

export default function ThemedColorPicker({
  value, onChange, className = '', style, title, disabled = false, children,
}: {
  /** A hex color; anything unparseable shows as grey. */
  value: string
  onChange: (hex: string) => void
  /** Size/shape of the swatch trigger (e.g. "w-6 h-6 rounded-full"). */
  className?: string
  /** Extra trigger styles; the background is the current color unless overridden. */
  style?: CSSProperties
  title?: string
  disabled?: boolean
  children?: ReactNode
}): JSX.Element {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const pop = useAnchoredPopover(triggerRef, popRef, WIDTH, HEIGHT)
  const hex = parseHex(value) ?? '#808080'

  const close = (): void => { pop.hide(); triggerRef.current?.focus() }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={title}
        disabled={disabled}
        onClick={() => (pop.open ? pop.hide() : pop.show())}
        aria-haspopup="dialog"
        aria-expanded={pop.open}
        className={`shrink-0 cursor-pointer disabled:cursor-default shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] ${className}`}
        style={{ background: hex, WebkitAppRegion: 'no-drag', ...style } as CSSProperties}
      >
        {children}
      </button>

      {pop.open && pop.pos && createPortal(
        <div
          ref={popRef}
          role="dialog"
          aria-label="Choose a color"
          className="z-[9999] rounded-xl border border-[var(--border)] bg-surface shadow-2xl p-3 animate-menu-pop"
          style={{ ...pop.pos, WebkitAppRegion: 'no-drag' } as CSSProperties}
        >
          <Panel value={hex} onChange={onChange} onClose={close} />
        </div>,
        document.body,
      )}
    </>
  )
}
