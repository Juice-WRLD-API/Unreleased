// Presentational pieces and pure helpers shared byte-for-byte between
// WordleView.desktop.tsx and .mobile.tsx. Keep this file free of anything
// that reads mobile/desktop-specific state - the two views wire it up
// differently (Keyboard's sizing/hover-vs-active classes and the
// SettingsPanel/StatsPanel modal-vs-Sheet wrappers genuinely diverge).
import type { Stats } from './heardle'
import type { LetterState, WordleSettings } from './wordle'

/** Tile colours. Kept in one place because the board, the letter tracker and
 *  the shared grid all have to agree on what green means. */
export function tileTone(state: LetterState | 'empty'): string {
  switch (state) {
    case 'correct': return 'border-accent bg-accent text-white'
    case 'present': return 'border-amber-500/60 bg-amber-500/25 text-text-primary'
    case 'absent': return 'border-[var(--border)] bg-[var(--surface-overlay)]/70 text-text-muted'
    default: return 'border-[var(--border)] bg-[var(--surface-overlay)]/25 text-text-primary'
  }
}

/** One guess as a row of letters - or an empty row waiting for one. Rows are a
 *  grid rather than a flex run so every row of a round lines up column for
 *  column, whatever the title's length. */
export function Row({ length, letters, states, active }: {
  length: number
  letters?: string
  states?: LetterState[]
  active?: boolean
}): JSX.Element {
  const size = length <= 8 ? 'text-base' : length <= 12 ? 'text-sm' : 'text-[11px]'
  return (
    <div
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}
    >
      {Array.from({ length }, (_, i) => {
        // One tone class per tile - an `active` border stacked on top of the
        // tone's own border-* would leave which colour wins up to the order
        // Tailwind happened to emit them in.
        const state = states?.[i]
        const tone = state
          ? tileTone(state)
          : active
            ? 'border-accent/40 bg-[var(--surface-overlay)]/40 text-text-primary'
            : tileTone('empty')
        return (
          <span
            key={i}
            className={`aspect-square rounded-md border flex items-center justify-center font-bold uppercase transition-colors ${size} ${tone}`}
          >
            {letters?.[i] ?? ''}
          </span>
        )
      })}
    </div>
  )
}

/** Field-editing logic for the Settings panel - identical in both views, only
 *  the surrounding modal-vs-Sheet chrome differs. */
export function useWordleSettingsForm(settings: WordleSettings, onChange: (s: WordleSettings) => void): {
  set: <K extends keyof WordleSettings>(key: K, value: WordleSettings[K]) => void
  toggleEra: (era: string) => void
  toggleCategory: (cat: WordleSettings['categories'][number]) => void
} {
  const set = <K extends keyof WordleSettings>(key: K, value: WordleSettings[K]): void =>
    onChange({ ...settings, [key]: value })

  const toggleEra = (era: string): void =>
    set('eras', settings.eras.includes(era) ? settings.eras.filter((e) => e !== era) : [...settings.eras, era])

  const toggleCategory = (cat: WordleSettings['categories'][number]): void => {
    const next = settings.categories.includes(cat)
      ? settings.categories.filter((c) => c !== cat)
      : [...settings.categories, cat]
    // Never leave nothing to draw from.
    if (next.length > 0) set('categories', next)
  }

  return { set, toggleEra, toggleCategory }
}

/** Played/win-rate summary for the Statistics panel - reads straight from
 *  storage on open rather than mirroring the round's state, since only Daily
 *  is ever recorded and there's a single set to show. */
export function statsSummary(stats: Stats): { max: number; winRate: number } {
  return {
    max: Math.max(1, ...stats.distribution),
    winRate: stats.played ? Math.round((stats.won / stats.played) * 100) : 0,
  }
}
