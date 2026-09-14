import { ChevronRight } from 'lucide-react'

// Shared bento-tile primitive. Originally private to HomeView.desktop.tsx
// (the desktop Home bento rework); extracted so the Editor/Manager profile,
// Admin review panel, and Contributor profile pages can reuse the exact same
// visual language for the "Visual Redesign v2 - Bento Dashboard Pivot"
// instead of hand-rolling near-identical wrappers again.
export function Tile({ title, icon, action, span = '', children }: {
  title?: string
  icon?: JSX.Element
  action?: { label: string; onClick: () => void }
  span?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className={`${span} min-w-0 min-h-0 flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-overlay)]/50 p-4`}>
      {title && (
        <div className="flex items-center gap-2 mb-3 shrink-0">
          <span className="text-text-muted">{icon}</span>
          <h2 className="text-text-primary text-sm font-bold uppercase tracking-wider flex-1 min-w-0 truncate">{title}</h2>
          {action && (
            <button
              onClick={action.onClick}
              className="flex items-center gap-0.5 px-2 py-0.5 -mr-2 rounded-lg text-text-muted text-xs font-semibold hover:text-text-primary hover:bg-[var(--surface-raised)] transition-colors shrink-0"
            >
              {action.label}<ChevronRight size={13} />
            </button>
          )}
        </div>
      )}
      {/* flex flex-col (not just a plain block) so a consumer's own
          `shrink-0` header + `flex-1 overflow-y-auto` list - the common
          pattern for a tile with a search bar or filter row above a
          scrollable list - actually gets real height to work with: without
          `display:flex` here, that inner `flex-1` was a no-op, the list grew
          to its full content height, and the header+list combined then
          overflowed THIS wrapper - so the scrollbar that showed up started
          at the header, not next to the list. min-h-0 lets this shrink below
          its content's natural size when the grid track is short of room
          (flex-shrink is blocked by min-height:auto otherwise); the
          overflow-y-auto here is now just a fallback for tiles with no
          scrollable region of their own - a no-op once an inner list is
          properly sized and scrolling itself. */}
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        {children}
      </div>
    </section>
  )
}

export default Tile
