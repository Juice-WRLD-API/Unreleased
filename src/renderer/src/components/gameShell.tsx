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
import { useIsMobile } from '../hooks/useIsMobile'
import { Segmented as IosSegmented } from './mobile/Segmented'

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
  const isMobile = useIsMobile()
  // Whichever game is on screen is the one the Games tab reopens on.
  useEffect(() => { rememberTabView(current) }, [current])
  // Phones get the iOS segmented control the rest of the mobile UI uses.
  if (isMobile) {
    return (
      <div className="mb-6">
        <IosSegmented
          value={current}
          options={GAMES.map((g) => ({ value: g.id, label: g.label }))}
          onChange={(id) => setActiveView(id)}
        />
      </div>
    )
  }
  // No offset for the floating nav pill: it always auto-hides on desktop
  // (see App.tsx), so it never covers this row.
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
    <div className="py-3 border-b border-[var(--separator)] md:border-[var(--border)] last:border-b-0">
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <div className="text-body md:text-sm md:tracking-normal text-text-primary md:font-medium">{label}</div>
          {hint && <div className="text-footnote md:text-xs md:tracking-normal text-text-muted mt-0.5">{hint}</div>}
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
    // Phones: an iOS segmented capsule (raised thumb, no accent fill);
    // desktop keeps its bordered accent toggle.
    <div className="flex p-0.5 md:p-0 rounded-full md:rounded-lg bg-[var(--fill)] md:bg-transparent md:border md:border-[var(--border)] overflow-hidden">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-3.5 md:px-2.5 py-1.5 md:py-1 rounded-full md:rounded-none text-footnote md:text-xs md:tracking-normal font-semibold transition-colors ${
            value === o.id
              ? 'bg-[var(--control-thumb)] text-text-primary shadow-[0_3px_8px_rgb(0_0_0/0.12)] md:shadow-none md:bg-accent md:text-white'
              : 'text-text-secondary md:text-text-muted hover:text-text-primary'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export const numberInput = 'w-16 h-9 md:h-8 px-2.5 md:px-2 rounded-[10px] md:rounded-lg bg-[var(--fill)] md:bg-[var(--surface-overlay)] border border-transparent md:border-[var(--border)] text-body md:text-sm md:tracking-normal text-text-primary text-right focus:outline-none focus:border-accent/50'
