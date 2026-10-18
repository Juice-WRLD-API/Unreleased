import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

export interface ThemedSelectOption {
  value: string
  label: string
  disabled?: boolean
}

/* A themed stand-in for <select>. The native popup is OS chrome (white list,
   system font, blue highlight) and looks nothing like the app.

   The trigger takes the caller's own box classes, so each site keeps its
   field look; the list is portaled to <body> with fixed positioning so cards
   with overflow-hidden can't clip it, flips upward when there's no room
   below, and closes on outside click, outside scroll, resize or Escape.
   Keyboard matches a native select: arrows/Home/End move, Enter/Space picks,
   a letter jumps to the next label starting with it. */
export default function ThemedSelect({
  value, onChange, options, placeholder, className = '', disabled = false, title, menuClassName = '',
}: {
  value: string
  onChange: (v: string) => void
  options: ThemedSelectOption[]
  /** Shown in the trigger when `value` matches no option. */
  placeholder?: string
  /** Box styling for the trigger (border, background, padding, text size, width). */
  className?: string
  disabled?: boolean
  title?: string
  menuClassName?: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const [pos, setPos] = useState<CSSProperties | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const selected = options.find(o => o.value === value)

  const place = (): void => {
    const r = triggerRef.current?.getBoundingClientRect()
    if (!r) return
    const below = window.innerHeight - r.bottom
    const up = below < 240 && r.top > below
    const maxH = Math.max(120, Math.min(288, (up ? r.top : below) - 12))
    const width = Math.max(r.width, 160)
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
    setPos({
      position: 'fixed', left, minWidth: width, maxWidth: Math.max(width, 320), maxHeight: maxH,
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    })
  }

  const openMenu = (): void => {
    if (disabled) return
    place()
    const i = options.findIndex(o => o.value === value)
    setHi(i >= 0 ? i : options.findIndex(o => !o.disabled))
    setOpen(true)
  }
  const pick = (o: ThemedSelectOption | undefined): void => {
    if (!o || o.disabled) return
    if (o.value !== value) onChange(o.value)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const inside = (t: EventTarget | null): boolean =>
      t instanceof Node && (!!listRef.current?.contains(t) || !!triggerRef.current?.contains(t))
    const onDown = (e: MouseEvent): void => { if (!inside(e.target)) setOpen(false) }
    const onScroll = (e: Event): void => { if (!inside(e.target)) setOpen(false) }
    const onResize = (): void => setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('blur', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('blur', onResize)
    }
  }, [open])

  // Keep the highlighted row in view (on open this brings the current value up).
  useLayoutEffect(() => {
    if (!open) return
    const row = listRef.current?.children[hi] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest' })
  }, [open, hi])

  const step = (from: number, dir: 1 | -1): number => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (!options[i].disabled) return i
    return from
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openMenu() }
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHi(i => step(i, 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(i => step(i, -1)) }
    else if (e.key === 'Home') { e.preventDefault(); setHi(step(-1, 1)) }
    else if (e.key === 'End') { e.preventDefault(); setHi(step(options.length, -1)) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(options[hi]) }
    else if (e.key === 'Tab') setOpen(false)
    else if (e.key.length === 1) {
      const k = e.key.toLowerCase()
      for (let n = 1; n <= options.length; n++) {
        const j = (hi + n) % options.length
        if (!options[j].disabled && options[j].label.toLowerCase().startsWith(k)) { setHi(j); break }
      }
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={title}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-2 text-left cursor-pointer disabled:cursor-default ${className}`}
        style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
      >
        <span className={`flex-1 min-w-0 truncate ${selected ? '' : 'text-text-muted'}`}>
          {selected?.label ?? placeholder ?? ''}
        </span>
        <ChevronDown size={13} className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && pos && createPortal(
        <div
          ref={listRef}
          role="listbox"
          className={`z-[9999] overflow-y-auto overflow-x-hidden rounded-xl border border-[var(--border)] bg-surface shadow-2xl p-1 animate-menu-pop ${menuClassName}`}
          style={{ ...pos, WebkitAppRegion: 'no-drag' } as CSSProperties}
        >
          {options.map((o, i) => {
            const active = o.value === value
            return (
              <div
                key={o.value || `__empty${i}`}
                role="option"
                aria-selected={active}
                aria-disabled={o.disabled}
                onMouseEnter={() => !o.disabled && setHi(i)}
                // mousedown + preventDefault keeps focus on the trigger
                onMouseDown={e => { e.preventDefault(); pick(o) }}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors ${
                  o.disabled ? 'opacity-40 cursor-default'
                    : active ? 'text-accent font-semibold cursor-pointer'
                    : i === hi ? 'text-text-primary cursor-pointer'
                    : 'text-text-secondary cursor-pointer'
                } ${i === hi && !o.disabled ? 'bg-surface-overlay' : ''}`}
              >
                <span className="flex-1 min-w-0 truncate">{o.label}</span>
                {active && <Check size={13} className="shrink-0" />}
              </div>
            )
          })}
        </div>,
        document.body,
      )}
    </>
  )
}
