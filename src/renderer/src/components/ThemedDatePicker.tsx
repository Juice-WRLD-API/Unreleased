import { PopLayer } from './PopLayer'
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAnchoredPopover } from './anchoredPopover'

/* A themed stand-in for <input type="date">. The native field draws OS
   chrome (its own segment editor, a white Windows calendar) that clashes
   with the app; this is a button showing the date plus a calendar popover
   styled like ThemedSelect's list.

   Values stay YYYY-MM-DD ('' = no date), so it drops in where a date input's
   e.target.value was used. The header label steps out to a month grid, then
   a year grid, so a 2017 release isn't eighty clicks of "previous month".
   Keyboard: arrows move a day/week, PageUp/PageDown a month (Shift: a year),
   Home/End the week's ends, Enter picks, Escape closes.

   Pass children to replace the trigger's contents (EditorPage's calendar
   icon button does this); the trigger keeps the caller's box classes. */

const WIDTH = 264
const HEIGHT = 330
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

type Ymd = { y: number; m: number; d: number }

const pad = (n: number): string => String(n).padStart(2, '0')
const toIso = ({ y, m, d }: Ymd): string => `${y}-${pad(m + 1)}-${pad(d)}`
function parseIso(v: string): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null
}
// Date handles month/day overflow, so ±n days or months normalizes for free.
const fromDate = (dt: Date): Ymd => ({ y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate() })
const addDays = (a: Ymd, n: number): Ymd => fromDate(new Date(a.y, a.m, a.d + n))
function addMonths(a: Ymd, n: number): Ymd {
  const last = new Date(a.y, a.m + n + 1, 0).getDate()
  return fromDate(new Date(a.y, a.m + n, Math.min(a.d, last)))
}
const today = (): Ymd => fromDate(new Date())

export function formatDateLabel(v: string): string {
  const p = parseIso(v)
  return p ? new Date(p.y, p.m, p.d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
}

function Calendar({ value, onPick, onClose, clearable }: {
  value: string
  onPick: (v: string) => void
  onClose: () => void
  clearable: boolean
}): JSX.Element {
  const sel = parseIso(value)
  const [cur, setCur] = useState<Ymd>(sel ?? today())
  const [mode, setMode] = useState<'days' | 'months' | 'years'>('days')
  const gridRef = useRef<HTMLDivElement>(null)
  const now = today()
  const curIso = toIso(cur)

  useEffect(() => { gridRef.current?.focus() }, [mode])

  const first = new Date(cur.y, cur.m, 1).getDay()
  const days: Ymd[] = Array.from({ length: 42 }, (_, i) => fromDate(new Date(cur.y, cur.m, 1 - first + i)))
  const yearBase = cur.y - (cur.y % 12)

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return }
    // Everything else is the grid's; a focused Clear/Today keeps its own Enter.
    if (e.target !== gridRef.current) return
    const move: Record<string, () => Ymd> = mode === 'days' ? {
      ArrowLeft: () => addDays(cur, -1), ArrowRight: () => addDays(cur, 1),
      ArrowUp: () => addDays(cur, -7), ArrowDown: () => addDays(cur, 7),
      PageUp: () => addMonths(cur, e.shiftKey ? -12 : -1), PageDown: () => addMonths(cur, e.shiftKey ? 12 : 1),
      Home: () => addDays(cur, -new Date(cur.y, cur.m, cur.d).getDay()),
      End: () => addDays(cur, 6 - new Date(cur.y, cur.m, cur.d).getDay()),
    } : mode === 'months' ? {
      ArrowLeft: () => addMonths(cur, -1), ArrowRight: () => addMonths(cur, 1),
      ArrowUp: () => addMonths(cur, -3), ArrowDown: () => addMonths(cur, 3),
      PageUp: () => addMonths(cur, -12), PageDown: () => addMonths(cur, 12),
    } : {
      ArrowLeft: () => addMonths(cur, -12), ArrowRight: () => addMonths(cur, 12),
      ArrowUp: () => addMonths(cur, -36), ArrowDown: () => addMonths(cur, 36),
      PageUp: () => addMonths(cur, -144), PageDown: () => addMonths(cur, 144),
    }
    if (move[e.key]) { e.preventDefault(); setCur(move[e.key]()); return }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (mode === 'days') onPick(curIso)
      else setMode(mode === 'years' ? 'months' : 'days')
    }
  }

  // mousedown + preventDefault keeps focus on the grid, so the keys keep working
  const keepFocus = (e: { preventDefault: () => void }): void => e.preventDefault()
  const step = (dir: 1 | -1): void =>
    setCur(addMonths(cur, dir * (mode === 'days' ? 1 : mode === 'months' ? 12 : 144)))

  const navBtn = 'w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors'
  const cell = (active: boolean, focused: boolean, muted = false): string =>
    `flex items-center justify-center rounded-lg text-[12px] tabular-nums transition-colors cursor-pointer ${
      active ? 'bg-accent text-white font-semibold'
        : focused ? 'bg-surface-overlay text-text-primary'
        : muted ? 'text-text-muted opacity-50 hover:bg-surface-overlay hover:opacity-100'
        : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
    }`

  return (
    <div onKeyDown={onKeyDown}>
      <div className="flex items-center gap-1 mb-1.5">
        <button type="button" onMouseDown={keepFocus} onClick={() => step(-1)} className={navBtn} title="Previous"><ChevronLeft size={15} /></button>
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={() => setMode(mode === 'days' ? 'months' : 'years')}
          disabled={mode === 'years'}
          className="flex-1 h-7 rounded-lg text-[13px] font-semibold text-text-primary hover:bg-surface-overlay disabled:hover:bg-transparent disabled:cursor-default transition-colors"
        >
          {mode === 'days' ? `${new Date(cur.y, cur.m, 1).toLocaleDateString('en-US', { month: 'long' })} ${cur.y}`
            : mode === 'months' ? cur.y
            : `${yearBase} – ${yearBase + 11}`}
        </button>
        <button type="button" onMouseDown={keepFocus} onClick={() => step(1)} className={navBtn} title="Next"><ChevronRight size={15} /></button>
      </div>

      <div ref={gridRef} tabIndex={0} className="outline-none" aria-label="Calendar">
        {mode === 'days' && (
          <>
            <div className="grid grid-cols-7 mb-0.5">
              {WEEKDAYS.map(w => (
                <span key={w} className="h-6 flex items-center justify-center text-[10px] font-bold uppercase tracking-wider text-text-muted">{w}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {days.map(day => {
                const iso = toIso(day)
                const isToday = iso === toIso(now)
                return (
                  <button
                    key={iso}
                    type="button"
                    tabIndex={-1}
                    onMouseDown={keepFocus}
                    onClick={() => onPick(iso)}
                    className={`relative h-8 ${cell(iso === value, iso === curIso, day.m !== cur.m)}`}
                  >
                    {day.d}
                    {isToday && iso !== value && <span className="absolute bottom-1 w-1 h-1 rounded-full bg-accent" />}
                  </button>
                )
              })}
            </div>
          </>
        )}
        {mode === 'months' && (
          <div className="grid grid-cols-3 gap-1">
            {MONTHS.map((name, m) => (
              <button
                key={name}
                type="button"
                tabIndex={-1}
                onMouseDown={keepFocus}
                onClick={() => { setCur(addMonths(cur, m - cur.m)); setMode('days') }}
                className={`h-12 ${cell(!!sel && sel.y === cur.y && sel.m === m, m === cur.m)}`}
              >
                {name}
              </button>
            ))}
          </div>
        )}
        {mode === 'years' && (
          <div className="grid grid-cols-3 gap-1">
            {Array.from({ length: 12 }, (_, i) => yearBase + i).map(y => (
              <button
                key={y}
                type="button"
                tabIndex={-1}
                onMouseDown={keepFocus}
                onClick={() => { setCur(addMonths(cur, (y - cur.y) * 12)); setMode('months') }}
                className={`h-12 ${cell(sel?.y === y, y === cur.y)}`}
              >
                {y}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--border)]">
        {clearable ? (
          <button type="button" onClick={() => onPick('')}
            className="px-2 py-1 rounded-lg text-[11px] font-medium text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors">
            Clear
          </button>
        ) : <span />}
        <button type="button" onClick={() => onPick(toIso(now))}
          className="px-2 py-1 rounded-lg text-[11px] font-semibold text-accent hover:bg-accent/10 transition-colors">
          Today
        </button>
      </div>
    </div>
  )
}

export default function ThemedDatePicker({
  value, onChange, className = '', placeholder = 'Pick a date', title, disabled = false, clearable = true, children,
}: {
  /** YYYY-MM-DD, or '' for no date. */
  value: string
  onChange: (v: string) => void
  /** Box styling for the trigger (border, background, padding, text size, width). */
  className?: string
  placeholder?: string
  title?: string
  disabled?: boolean
  /** Show a Clear button in the popover (picks ''). */
  clearable?: boolean
  /** Replaces the trigger's default contents (the date + a calendar icon). */
  children?: ReactNode
}): JSX.Element {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const pop = useAnchoredPopover(triggerRef, popRef, WIDTH, HEIGHT)
  const label = formatDateLabel(value)

  const close = (): void => { pop.hide(); triggerRef.current?.focus() }
  const pick = (v: string): void => { if (v !== value) onChange(v); close() }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={title}
        disabled={disabled}
        onClick={() => (pop.open ? pop.hide() : pop.show())}
        onKeyDown={e => { if (!pop.open && e.key === 'ArrowDown') { e.preventDefault(); pop.show() } }}
        aria-haspopup="dialog"
        aria-expanded={pop.open}
        className={children ? className : `flex items-center gap-2 text-left cursor-pointer disabled:cursor-default ${className}`}
        style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
      >
        {children ?? (
          <>
            <span className={`flex-1 min-w-0 truncate ${label ? '' : 'text-text-muted'}`}>{label || placeholder}</span>
            <CalendarDays size={13} className="shrink-0 text-text-muted" />
          </>
        )}
      </button>

      {pop.open && pop.pos && createPortal(
        <PopLayer
          ref={popRef}
          role="dialog"
          aria-label="Choose a date"
          className="z-[9999] rounded-xl border border-[var(--border)] bg-surface shadow-2xl p-2.5 animate-menu-pop"
          style={{ ...pop.pos, WebkitAppRegion: 'no-drag' } as CSSProperties}
        >
          <Calendar value={value} onPick={pick} onClose={close} clearable={clearable} />
        </PopLayer>,
        document.body,
      )}
    </>
  )
}
