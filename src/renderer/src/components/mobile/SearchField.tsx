import { ElementType, InputHTMLAttributes, ReactNode, Ref } from 'react'
import { Search, X } from 'lucide-react'

// ─── Search field ─────────────────────────────────────────────────────────────
// The one iOS-style search field every mobile screen uses (Library, Tracker,
// Files, Settings) - they had drifted into four sizes, radii and borders.
// 17px text on purpose: iOS Safari zooms the page into any focused input
// smaller than 16px.

interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'className'> {
  value: string
  onChange: (value: string) => void
  /** Leading glyph; a magnifier unless the field searches something else
   *  (lyrics get a microphone). */
  icon?: ElementType
  inputRef?: Ref<HTMLInputElement>
  /** Extra controls inside the right end, after the clear button (e.g.
   *  Tracker's search-syntax help) - each sized as a 36px square, like
   *  SearchFieldButton. */
  trailing?: ReactNode
  className?: string
}

/** A trailing control inside a SearchField. */
export function SearchFieldButton({ label, onClick, active, children }: {
  label: string
  onClick: () => void
  active?: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors ${active ? 'text-accent' : 'text-text-muted active:text-text-primary'}`}
    >{children}</button>
  )
}

export function SearchField({
  value, onChange, icon: Icon = Search, inputRef, trailing, className = '', ...input
}: SearchFieldProps): JSX.Element {
  return (
    <div className={`relative flex items-center h-9 rounded-full bg-[var(--fill)] ${className}`}>
      <Icon size={17} className="absolute left-3 text-text-muted pointer-events-none" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        enterKeyHint="search"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        {...input}
        className="flex-1 min-w-0 h-full bg-transparent rounded-full pl-9 pr-2 text-body text-text-primary placeholder:text-text-muted focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="shrink-0 w-8 h-9 flex items-center justify-center"
        >
          <span className="w-[18px] h-[18px] rounded-full bg-[var(--text-muted)] flex items-center justify-center">
            <X size={12} strokeWidth={3} className="text-[var(--surface)]" />
          </span>
        </button>
      )}
      {trailing && <span className="shrink-0 flex items-center pr-0.5">{trailing}</span>}
      {!value && !trailing && <span className="w-2 shrink-0" />}
    </div>
  )
}
