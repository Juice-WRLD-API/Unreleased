import { ElementType } from 'react'

// ─── Segmented control ────────────────────────────────────────────────────────
// A closed set of 2–4 choices (text size, lyric alignment, a stats period),
// iOS-style: equal segments in one gray capsule, with the chosen one lifted on
// a raised thumb rather than filled with the accent. The thumb is a single
// element that slides between segments (transform only - every segment is the
// same width, so it never has to resize).

export function Segmented<T extends string | number>({ value, options, onChange }: {
  value: T
  options: { value: T; label: string; icon?: ElementType }[]
  onChange: (value: T) => void
}): JSX.Element {
  const index = options.findIndex((o) => o.value === value)
  return (
    <div className="relative flex items-stretch h-9 p-0.5 rounded-full bg-[var(--fill)]">
      <span
        aria-hidden
        className="absolute top-0.5 bottom-0.5 left-0.5 rounded-full bg-[var(--control-thumb)] shadow-[0_3px_8px_rgb(0_0_0/0.12),0_3px_1px_rgb(0_0_0/0.04)] control-motion"
        style={{
          width: `calc((100% - 0.25rem) / ${options.length})`,
          transform: `translateX(${Math.max(0, index) * 100}%)`,
          opacity: index < 0 ? 0 : 1,
        }}
      />
      {options.map(({ value: v, label, icon: Icon }) => {
        const active = value === v
        return (
          <button
            key={String(v)}
            onClick={() => onChange(v)}
            aria-pressed={active}
            className={`relative z-[1] flex-1 min-w-0 flex items-center justify-center gap-1.5 rounded-full text-footnote text-text-primary transition-opacity ${
              active ? 'font-semibold' : 'font-medium active:opacity-60'
            }`}
          >
            {Icon && <Icon size={14} className="shrink-0" />}
            <span className="truncate">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
