import { Check } from 'lucide-react'

/* A themed stand-in for <input type="checkbox">. accent-color only tints the
   native box; its shape, border and focus ring stay OS-drawn and read as a
   white square on the dark surfaces.

   The real checkbox is still there (visually hidden, as a peer), so wrapping
   <label>s keep toggling it, Space and Tab work, and forms see it. Use
   variant="switch" for settings-style rows where the control sits at the
   row's right edge. */
export default function ThemedCheckbox({
  checked, onChange, disabled = false, variant = 'box', size = 14, className = '', title,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  variant?: 'box' | 'switch'
  /** Box edge in px (box variant only). */
  size?: number
  className?: string
  title?: string
}): JSX.Element {
  return (
    <span className={`relative inline-flex shrink-0 ${disabled ? 'opacity-50' : ''} ${className}`} title={title}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        className="peer absolute inset-0 m-0 opacity-0 cursor-pointer disabled:cursor-default"
      />
      {variant === 'switch' ? (
        <span
          aria-hidden="true"
          className="relative w-8 h-[18px] rounded-full bg-[var(--surface-highest)] pointer-events-none peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50"
        >
          <span className={`absolute inset-0 rounded-full bg-accent control-motion ${checked ? 'opacity-100' : 'opacity-0'}`} />
          <span className={`absolute inset-y-0 left-0.5 my-auto w-3.5 h-3.5 rounded-full bg-white control-motion ${checked ? 'translate-x-3.5' : 'translate-x-0'}`} />
        </span>
      ) : (
        <span
          aria-hidden="true"
          style={{ width: size, height: size }}
          className={`flex items-center justify-center rounded-[4px] border transition-colors pointer-events-none peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50 ${
            checked ? 'bg-accent border-accent text-white' : 'bg-surface-overlay border-[var(--text-muted)]'
          }`}
        >
          <Check size={Math.round(size * 0.75)} strokeWidth={3.25} className={`control-motion ${checked ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}`} />
        </span>
      )}
    </span>
  )
}
