import { PopLayer } from './PopLayer'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react'
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
   a letter jumps to the next label starting with it.

   `searchable` turns the trigger into a text box: typing filters the list by
   label, arrows move, Enter picks. Use it for long lists such as users. */
export default function ThemedSelect({
  value, onChange, options, placeholder, className = '', disabled = false, title, menuClassName = '',
  searchable = false,
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
  /** Type to filter the options instead of only picking from the list. */
  searchable?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState<CSSProperties | null>(null)
  const triggerRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const selected = options.find(o => o.value === value)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!searchable || !q) return options
    return options.filter(o => o.label.toLowerCase().includes(q))
  }, [options, query, searchable])

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
    if (disabled || open) return
    place()
    setQuery('')
    const i = options.findIndex(o => o.value === value)
    setHi(i >= 0 ? i : options.findIndex(o => !o.disabled))
    setOpen(true)
  }
  const close = (): void => { setOpen(false); setQuery('') }
  const pick = (o: ThemedSelectOption | undefined): void => {
    if (!o || o.disabled) return
    if (o.value !== value) onChange(o.value)
    close()
  }

  useEffect(() => {
    if (!open) return
    const inside = (t: EventTarget | null): boolean =>
      t instanceof Node && (!!listRef.current?.contains(t) || !!triggerRef.current?.contains(t))
    const onDown = (e: MouseEvent): void => { if (!inside(e.target)) close() }
    const onScroll = (e: Event): void => { if (!inside(e.target)) close() }
    const onResize = (): void => close()
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
    for (let i = from + dir; i >= 0 && i < shown.length; i += dir) if (!shown[i].disabled) return i
    return from
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!open) {
      const keys = searchable ? ['ArrowDown', 'ArrowUp'] : ['ArrowDown', 'ArrowUp', 'Enter', ' ']
      if (keys.includes(e.key)) { e.preventDefault(); openMenu() }
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHi(i => step(i, 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(i => step(i, -1)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(shown[hi]) }
    else if (e.key === 'Tab') close()
    else if (searchable) return // everything else edits the text
    else if (e.key === 'Home') { e.preventDefault(); setHi(step(-1, 1)) }
    else if (e.key === 'End') { e.preventDefault(); setHi(step(shown.length, -1)) }
    else if (e.key === ' ') { e.preventDefault(); pick(shown[hi]) }
    else if (e.key.length === 1) {
      const k = e.key.toLowerCase()
      for (let n = 1; n <= shown.length; n++) {
        const j = (hi + n) % shown.length
        if (!shown[j].disabled && shown[j].label.toLowerCase().startsWith(k)) { setHi(j); break }
      }
    }
  }

  const onType = (text: string): void => {
    if (!open) { place(); setOpen(true) }
    setQuery(text)
    const q = text.trim().toLowerCase()
    const first = options.filter(o => !q || o.label.toLowerCase().includes(q)).findIndex(o => !o.disabled)
    setHi(Math.max(0, first))
  }

  const chevron = (
    <ChevronDown size={13} className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
  )

  return (
    <>
      {searchable ? (
        <div
          ref={triggerRef as RefObject<HTMLDivElement>}
          title={title}
          onMouseDown={(e) => {
            if (disabled) return
            if (e.target !== inputRef.current) e.preventDefault()
            inputRef.current?.focus()
            if (open && e.target !== inputRef.current) close()
            else openMenu()
          }}
          className={`flex items-center gap-2 cursor-text ${disabled ? 'opacity-60 cursor-default' : ''} ${className}`}
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
        >
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            disabled={disabled}
            value={open ? query : (selected?.label ?? '')}
            placeholder={(open && selected?.label) || placeholder || ''}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
            className="flex-1 min-w-0 bg-transparent outline-none border-none p-0 text-inherit placeholder:text-text-muted"
          />
          {chevron}
        </div>
      ) : (
        <button
          ref={triggerRef as RefObject<HTMLButtonElement>}
          type="button"
          title={title}
          disabled={disabled}
          onClick={() => (open ? close() : openMenu())}
          onKeyDown={onKeyDown}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={`flex items-center gap-2 text-left cursor-pointer disabled:cursor-default ${className}`}
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
        >
          <span className={`flex-1 min-w-0 truncate ${selected ? '' : 'text-text-muted'}`}>
            {selected?.label ?? placeholder ?? ''}
          </span>
          {chevron}
        </button>
      )}

      {open && pos && createPortal(
        <PopLayer
          ref={listRef}
          role="listbox"
          className={`z-[9999] overflow-y-auto overflow-x-hidden rounded-xl border border-[var(--border)] bg-surface shadow-2xl p-1 animate-menu-pop ${menuClassName}`}
          style={{ ...pos, WebkitAppRegion: 'no-drag' } as CSSProperties}
        >
          {shown.length === 0 && (
            <div className="px-2.5 py-1.5 text-[13px] text-text-muted">No matches</div>
          )}
          {shown.map((o, i) => {
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
        </PopLayer>,
        document.body,
      )}
    </>
  )
}
