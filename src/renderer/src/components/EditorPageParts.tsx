import { useState, useEffect, useRef, useId } from 'react'
import { CalendarDays } from 'lucide-react'
import { suggestFieldValues, type SuggestField } from '../lib/fieldSuggestions'
import { formatPickedDate } from '../lib/editorPageShared'

// Pieces of EditorPage that are identical in its desktop and mobile shells.
// Components/hooks live here rather than in lib/editorPageShared, which is
// plain constants and helpers.

/* ── Field-value autocomplete ─────────────────────────────────────────────── */
/* Shared by FieldRow and BasicRow - a value-matching dropdown fed from
 *  fieldSuggestions.ts (album/credits/location/leak type already used
 *  elsewhere in the catalog), same idea as the Versions card's title
 *  autocomplete but backed by song data instead of the /versions/ table. */
export function useValueSuggestions(field: SuggestField | undefined, value: string): {
  matches: string[]; open: boolean; setOpen: (v: boolean) => void
} {
  const [matches, setMatches] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!field) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      suggestFieldValues(field, value, value).then(setMatches)
    }, 200)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [field, value])

  return { matches, open, setOpen }
}

/* ── Date picker button ───────────────────────────────────────────────────── */
/* A calendar icon that opens the browser's native date picker and appends the
 *  picked date to the field - fields hold free text (a date can be a range, a
 *  "TBD", or several dates on separate lines) so this augments rather than
 *  replaces typing. The date input itself stays invisible; only the button is
 *  seen, matching the folder-icon browse button elsewhere in these fields. */
export function DatePickerButton({ onPick, className }: { onPick: (date: string) => void; className: string }): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        type="button"
        onClick={e => {
          e.preventDefault()
          const el = ref.current
          if (!el) return
          try { el.showPicker() } catch { el.focus() }
        }}
        title="Pick a date"
        className={className}
      >
        <CalendarDays size={14} />
      </button>
      <input
        ref={ref}
        type="date"
        onChange={e => { const v = e.target.value; if (v) onPick(formatPickedDate(v)); e.target.value = '' }}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
    </>
  )
}

/* ── AppField - hoisted to module scope so React never remounts inputs ──────── */
export function AppField({ label, value, onChange, rows, placeholder, hint }: {
  label: string; value: string; onChange: (v: string) => void
  rows?: number; placeholder?: string; hint?: string
}): JSX.Element {
  // htmlFor rather than wrapping: the label shares a flex row with the hint,
  // so it cannot also be the element that wraps the field.
  const id = useId()
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label htmlFor={id} className="text-[11px] font-bold uppercase tracking-wider text-text-muted opacity-65">{label}</label>
        {hint && <span className="text-[10px] text-text-muted opacity-55">{hint}</span>}
      </div>
      {(rows ?? 1) > 1
        ? <textarea id={id} rows={rows} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
            className="w-full bg-surface-overlay border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent/40 resize-none placeholder:text-text-muted placeholder:opacity-30 transition-colors" />
        : <input id={id} type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
            className="w-full bg-surface-overlay border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent/40 placeholder:text-text-muted placeholder:opacity-30 transition-colors" />
      }
    </div>
  )
}
