// Shared furniture for the Games tab - the pieces Heardle and Wordle both draw
// so the two read as one tab rather than two apps that happen to sit together.
//
// The tab holds one view per game (see App's routing) instead of a wrapper that
// swaps children: each game owns a full-page layout with its own corner
// controls, and nesting those under a shared chrome bar meant two rows of
// chrome doing the same job.
import { useEffect } from 'react'
import { useStorePick } from '../store/useStore'
import { rememberTabView } from '../lib/navItems'
import type { ViewType } from '../types'

export type GameId = Extract<ViewType, 'heardle' | 'wordle' | 'tierlist'>

const GAMES: { id: GameId; label: string }[] = [
  { id: 'heardle', label: 'Heardle' },
  { id: 'wordle', label: 'Wordle' },
  { id: 'tierlist', label: 'Tier List' },
]

/** The games in the tab, as a pill row. Sits above each game's hero - the
 *  corner controls own the very top of the pane, so this is the first thing in
 *  the scroll flow rather than another floating layer to dodge them. */
export function GameSwitcher({ current }: { current: GameId }): JSX.Element {
  const { setActiveView } = useStorePick('setActiveView')
  // Whichever game is on screen is the one the Games tab reopens on.
  useEffect(() => { rememberTabView(current) }, [current])
  return (
    <div className="flex justify-center mb-5">
      <div className="inline-flex rounded-full border border-[var(--border)] bg-[var(--surface-raised)]/60 p-0.5">
        {GAMES.map((g) => (
          <button
            key={g.id}
            onClick={() => setActiveView(g.id)}
            className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-[0.18em] transition-colors ${
              current === g.id
                ? 'bg-accent text-white'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Starfield + a wash of the accent behind the card. Built from gradients
 *  rather than an image so it inherits whatever skin is active instead of
 *  fighting it. */
export function GameBackdrop(): JSX.Element {
  return (
    <>
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-[0.5]"
        style={{
          backgroundImage: [
            'radial-gradient(1px 1px at 18% 24%, var(--text-muted), transparent)',
            'radial-gradient(1px 1px at 73% 12%, var(--text-muted), transparent)',
            'radial-gradient(1px 1px at 41% 67%, var(--text-muted), transparent)',
            'radial-gradient(1px 1px at 89% 58%, var(--text-muted), transparent)',
            'radial-gradient(1px 1px at 8% 82%, var(--text-muted), transparent)',
            'radial-gradient(1px 1px at 57% 91%, var(--text-muted), transparent)',
          ].join(','),
          backgroundSize: '220px 220px',
        }}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-80 pointer-events-none"
        style={{ background: 'radial-gradient(60% 100% at 50% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent)' }}
      />
    </>
  )
}

// ─── Settings-panel primitives ────────────────────────────────────────────────

export function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode
}): JSX.Element {
  return (
    <div className="py-3 border-b border-[var(--border)] last:border-b-0">
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <div className="text-sm text-text-primary font-medium">{label}</div>
          {hint && <div className="text-xs text-text-muted mt-0.5">{hint}</div>}
        </div>
        <div className="ml-auto shrink-0">{children}</div>
      </div>
    </div>
  )
}

export function Segmented<T extends string>({ options, value, onChange }: {
  options: { id: T; label: string }[]
  value: T
  onChange: (v: T) => void
}): JSX.Element {
  return (
    <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-2.5 py-1 text-xs font-semibold transition-colors ${
            value === o.id ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export const numberInput = 'w-16 h-8 px-2 rounded-lg bg-[var(--surface-overlay)] border border-[var(--border)] text-sm text-text-primary text-right focus:outline-none focus:border-accent/50'
