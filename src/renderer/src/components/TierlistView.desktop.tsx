// Tier List - rank songs into S/A/B/C/D (or whatever tiers the user builds)
// by dragging them into rows, or by tap-to-select then tap-a-row on touch.
// Unlike Heardle/Wordle there's no daily puzzle or score: it's a personal
// ranking, persisted locally (see lib/tierlist) with no server round-trip.
import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ChevronLeft, ChevronUp, ChevronDown, Settings2, Music2, Plus, RotateCcw, Search, X, Disc3, Library,
} from 'lucide-react'
import { useStorePick } from '../store/useStore'
import type { HeardleSong } from '../lib/heardle'
import { smallCoverUrl } from '../lib/juicewrldApi'
import { TIER_COLOR_PRESETS } from '../lib/tierlist'
import type { Tier, DropPosition } from '../lib/tierlist'
import { GameSwitcher, GameBackdrop } from './gameShell'
import { useTierlistData, MAX_TIERS } from '../hooks/useTierlistData'
import { ListsPanelBody, FiltersPanelBody, TierlistViewer } from './TierlistPanels'

// ─── Pieces ───────────────────────────────────────────────────────────────────

function SongChip({ song, selected, dropSide, onClick, onDragStart, onDragEnd, onChipDragOver, onChipDrop }: {
  song: HeardleSong
  selected: boolean
  /** Where a drop on this chip would land, for the insertion marker. */
  dropSide?: DropPosition['side'] | null
  onClick: () => void
  onDragStart: (e: React.DragEvent) => void
  onDragEnd?: () => void
  /** Only set on chips inside a tier - dropping on one inserts next to it. */
  onChipDragOver?: (e: React.DragEvent) => void
  onChipDrop?: (e: React.DragEvent) => void
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onChipDragOver}
      onDrop={onChipDrop}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      title={song.name}
      className="relative shrink-0 w-14 sm:w-16 cursor-pointer"
    >
      {dropSide && (
        <span
          className={`absolute top-0 h-14 sm:h-16 w-1 rounded-full bg-accent pointer-events-none ${
            dropSide === 'before' ? '-left-[5px]' : '-right-[5px]'
          }`}
        />
      )}
      <div
        className={`relative w-14 h-14 sm:w-16 sm:h-16 rounded-lg overflow-hidden border-2 transition-all ${
          selected ? 'border-accent ring-2 ring-accent/50 scale-95' : 'border-[var(--border)] hover:border-accent/50'
        }`}
      >
        {song.imageUrl ? (
          <img src={smallCoverUrl(song.imageUrl)} alt="" draggable={false} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-[var(--surface-overlay)] flex items-center justify-center">
            <Music2 size={18} className="text-text-muted" />
          </div>
        )}
      </div>
      <div className="mt-1 text-[9px] leading-tight text-text-muted text-center line-clamp-2 break-words">
        {song.name}
      </div>
    </div>
  )
}

function TierRow({ tier, isFirst, isLast, selectedSongId, onDragOverRow, onDrop, onClickRow, onMoveUp, onMoveDown, onEdit, children }: {
  tier: Tier
  isFirst: boolean
  isLast: boolean
  selectedSongId: number | null
  onDragOverRow: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onClickRow: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onEdit: () => void
  children: ReactNode
}) {
  return (
    <div className="flex rounded-xl overflow-hidden border border-[var(--border)]">
      <button
        onClick={onEdit}
        title="Edit tier"
        className="w-16 sm:w-20 shrink-0 flex items-center justify-center text-center px-1.5 py-3 font-black text-sm leading-tight"
        style={{ background: tier.color, color: 'rgba(0,0,0,0.75)' }}
      >
        {tier.label}
      </button>
      <div
        onDragOver={onDragOverRow}
        onDrop={onDrop}
        onClick={onClickRow}
        className={`flex-1 min-h-[6.5rem] bg-[var(--surface-overlay)]/30 p-1.5 flex flex-wrap gap-1.5 content-start ${
          selectedSongId !== null ? 'cursor-copy' : ''
        }`}
      >
        {children}
      </div>
      <div className="w-8 shrink-0 flex flex-col border-l border-[var(--border)]">
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          title="Move tier up"
          className="flex-1 flex items-center justify-center text-text-muted hover:text-text-primary disabled:opacity-20 disabled:hover:text-text-muted transition-colors"
        >
          <ChevronUp size={14} />
        </button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          title="Move tier down"
          className="flex-1 flex items-center justify-center text-text-muted hover:text-text-primary disabled:opacity-20 disabled:hover:text-text-muted transition-colors border-t border-[var(--border)]"
        >
          <ChevronDown size={14} />
        </button>
      </div>
    </div>
  )
}

function TierEditPopover({ tier, canDelete, onChange, onDelete, onClose }: {
  tier: Tier
  canDelete: boolean
  onChange: (t: Tier) => void
  onDelete: () => void
  onClose: () => void
}) {
  const colorLabelId = useId()
  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xs rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-text-primary font-bold text-sm">Edit tier</h3>
          <button onClick={onClose} title="Close" className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors">
            <X size={16} />
          </button>
        </div>
        <label className="block"><span className="text-xs text-text-muted mb-1 block">Label</span>
        <input
          value={tier.label}
          maxLength={20}
          onChange={(e) => onChange({ ...tier, label: e.target.value })}
          className="w-full mb-3 px-2.5 py-1.5 rounded-lg bg-[var(--surface-overlay)] border border-[var(--border)] text-sm text-text-primary focus:outline-none focus:border-accent/50"
        />
        </label>
        <span className="text-xs text-text-muted mb-1 block" id={colorLabelId}>Color</span>
        <div role="group" aria-labelledby={colorLabelId} className="flex flex-wrap gap-2 mb-4">
          {TIER_COLOR_PRESETS.map((c) => (
            <button
              key={c}
              onClick={() => onChange({ ...tier, color: c })}
              title={c}
              className={`w-7 h-7 rounded-full border-2 transition-colors ${tier.color === c ? 'border-text-primary' : 'border-transparent'}`}
              style={{ background: c }}
            />
          ))}
        </div>
        {canDelete && (
          <button
            onClick={onDelete}
            className="w-full py-2 rounded-lg border border-red-500/30 text-red-400 text-sm font-semibold hover:bg-red-500/10 transition-colors"
          >
            Delete tier
          </button>
        )}
      </div>
    </div>
  )
}

// ─── View ───────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children, wide }: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className={`w-full ${wide ? 'max-w-md' : 'max-w-sm'} max-h-[85vh] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-4`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-text-primary font-bold text-sm">{title}</h3>
          <button onClick={onClose} title="Close" className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export default function TierlistView(): JSX.Element {
  const { setActiveView } = useStorePick('setActiveView')

  const data = useTierlistData()
  const {
    list, tiers, album, filters, poolLoading, poolError, search, setSearch,
    selectedSongId, setSelectedSongId, editingTier, setEditingTier, showFilters, setShowFilters,
    showLists, setShowLists, visiblePool, songsInTier, placeSong, clickRow, moveTier, addTier,
    updateTier, deleteTier, handleReset, filteredCount, rankedInFilter,
  } = data

  // Insertion marker while dragging over a ranked chip.
  const [dropHint, setDropHint] = useState<DropPosition | null>(null)

  const draggedId = (e: React.DragEvent): number | null => {
    const id = Number(e.dataTransfer.getData('text/plain'))
    return e.dataTransfer.getData('text/plain') && Number.isFinite(id) ? id : null
  }

  const handleDrop = (tierId: string | null) => (e: React.DragEvent): void => {
    e.preventDefault()
    setDropHint(null)
    const id = draggedId(e)
    if (id !== null) placeSong(id, tierId)
  }

  const handleRowDragOver = (e: React.DragEvent): void => {
    e.preventDefault()
    if (dropHint) setDropHint(null)
  }

  const sideOf = (e: React.DragEvent): DropPosition['side'] => {
    const rect = e.currentTarget.getBoundingClientRect()
    return e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
  }

  const chipDragOver = (targetId: number) => (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const side = sideOf(e)
    if (dropHint?.targetId !== targetId || dropHint.side !== side) setDropHint({ targetId, side })
  }

  const chipDrop = (tierId: string, targetId: number) => (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setDropHint(null)
    const id = draggedId(e)
    if (id !== null) placeSong(id, tierId, { targetId, side: sideOf(e) })
  }

  const dragStart = (id: number) => (e: React.DragEvent): void => {
    e.dataTransfer.setData('text/plain', String(id))
    e.dataTransfer.effectAllowed = 'move'
  }

  const toggleSelect = (id: number): void => setSelectedSongId((cur) => (cur === id ? null : id))

  const poolLabel = album
    ? album.title
    : filters.eras.length ? filters.eras.join(', ') : null

  return (
    <div className="relative flex-1 flex flex-col h-full overflow-hidden bg-[var(--surface)]">
      <GameBackdrop />

      <div className="absolute top-4 left-4 z-20">
        <button
          onClick={() => setActiveView('wrld')}
          title="Back"
          className="p-2.5 rounded-xl text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
        >
          <ChevronLeft size={22} />
        </button>
      </div>
      <div className="absolute top-4 right-4 z-20 flex items-center gap-1.5">
        <button
          onClick={() => setShowLists(true)}
          title="Your tier lists"
          className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]/60 text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors"
        >
          <Library size={20} />
        </button>
        <button
          onClick={() => setShowFilters(true)}
          title="Song pool"
          className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]/60 text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors"
        >
          <Settings2 size={20} />
        </button>
        <button
          onClick={handleReset}
          title="Clear this tier list's rankings"
          className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]/60 text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors"
        >
          <RotateCcw size={20} />
        </button>
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto px-4 sm:px-6 py-10">
        <div className="mx-auto w-full max-w-3xl">
          <GameSwitcher current="tierlist" />

          {data.viewing ? (
            <TierlistViewer data={data} touch={false} />
          ) : (
          <>
          <div className="text-center mb-6">
            <h1 className="text-text-primary text-4xl sm:text-5xl font-black tracking-tight">Tier List</h1>
            <button
              onClick={() => setShowLists(true)}
              title="Switch tier list"
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-raised)]/60 hover:border-accent/40 transition-colors"
            >
              <span className="text-sm font-semibold text-text-primary max-w-[18rem] truncate">{list.name}</span>
              {!poolLoading && (
                <span className="text-xs text-text-muted">{rankedInFilter}/{filteredCount}</span>
              )}
              <ChevronDown size={14} className="text-text-muted" />
            </button>
            <p className="text-text-muted text-sm mt-2">
              {selectedSongId !== null
                ? 'Click a row to place it - click the song again to cancel.'
                : 'Drag a song into a row, or onto another song to put it next to it.'}
            </p>
          </div>

          {poolError && (
            <div className="mb-4 px-4 py-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-sm text-center">
              {poolError}
            </div>
          )}

          <div className="space-y-1.5 mb-2">
            {tiers.map((tier, i) => (
              <TierRow
                key={tier.id}
                tier={tier}
                isFirst={i === 0}
                isLast={i === tiers.length - 1}
                selectedSongId={selectedSongId}
                onDragOverRow={handleRowDragOver}
                onDrop={handleDrop(tier.id)}
                onClickRow={clickRow(tier.id)}
                onMoveUp={() => moveTier(i, -1)}
                onMoveDown={() => moveTier(i, 1)}
                onEdit={() => setEditingTier(tier)}
              >
                {songsInTier(tier.id).map((s) => (
                  <SongChip
                    key={s.id}
                    song={s}
                    selected={selectedSongId === s.id}
                    dropSide={dropHint?.targetId === s.id ? dropHint.side : null}
                    onClick={() => {
                      // With another song picked up, clicking a ranked song
                      // drops the picked one in right before it.
                      if (selectedSongId !== null && selectedSongId !== s.id) {
                        placeSong(selectedSongId, tier.id, { targetId: s.id, side: 'before' })
                      } else toggleSelect(s.id)
                    }}
                    onDragStart={dragStart(s.id)}
                    onDragEnd={() => setDropHint(null)}
                    onChipDragOver={chipDragOver(s.id)}
                    onChipDrop={chipDrop(tier.id, s.id)}
                  />
                ))}
              </TierRow>
            ))}
          </div>

          <button
            onClick={addTier}
            disabled={tiers.length >= MAX_TIERS}
            title={tiers.length >= MAX_TIERS ? `A tier list can have at most ${MAX_TIERS} tiers` : undefined}
            className="w-full mb-8 py-2.5 rounded-xl disabled:opacity-40 border border-dashed border-[var(--border)] text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-1.5"
          >
            <Plus size={14} /> Add tier
          </button>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]/40 p-3">
            <div className="flex items-center gap-2 mb-3">
              <Music2 size={14} className="text-text-muted shrink-0" />
              <span className="text-xs font-bold uppercase tracking-widest text-text-muted">Unranked</span>
              <span className="text-xs text-text-muted">({visiblePool.length})</span>
              {poolLabel && (
                <button
                  onClick={() => setShowFilters(true)}
                  title="Change song pool"
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-accent/30 bg-accent/10 text-[11px] text-text-primary max-w-[12rem] truncate"
                >
                  {album && <Disc3 size={11} className="shrink-0" />}
                  <span className="truncate">{poolLabel}</span>
                </button>
              )}
              <div className="ml-auto relative w-40 sm:w-56">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search songs or eras"
                  className="w-full pl-7 pr-7 py-1.5 rounded-lg bg-[var(--surface-overlay)] border border-[var(--border)] text-xs text-text-primary focus:outline-none focus:border-accent/50"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    title="Clear search"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text-primary"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
            <div
              onDragOver={handleRowDragOver}
              onDrop={handleDrop(null)}
              onClick={clickRow(null)}
              className={`min-h-[7.5rem] flex flex-wrap gap-1.5 content-start ${selectedSongId !== null ? 'cursor-copy' : ''}`}
            >
              {poolLoading ? (
                <span className="text-xs text-text-muted py-4">Loading songs…</span>
              ) : visiblePool.length === 0 ? (
                <span className="text-xs text-text-muted py-4">
                  {search
                    ? 'No songs match that search.'
                    : filters.albumId !== null && !album
                      ? 'Loading album…'
                      : filteredCount === 0 ? 'No songs match this pool - check the filters.' : 'Every song has been ranked.'}
                </span>
              ) : (
                visiblePool.map((s) => (
                  <SongChip
                    key={s.id}
                    song={s}
                    selected={selectedSongId === s.id}
                    onClick={() => toggleSelect(s.id)}
                    onDragStart={dragStart(s.id)}
                    onDragEnd={() => setDropHint(null)}
                  />
                ))
              )}
            </div>
          </div>
          </>
          )}
        </div>
      </div>

      {showLists && (
        <Modal title="Your tier lists" onClose={() => setShowLists(false)} wide>
          <ListsPanelBody data={data} touch={false} onDone={() => setShowLists(false)} />
        </Modal>
      )}

      {showFilters && (
        <Modal title="Song pool" onClose={() => setShowFilters(false)}>
          <FiltersPanelBody data={data} touch={false} />
        </Modal>
      )}

      {editingTier && (
        <TierEditPopover
          tier={editingTier}
          canDelete={tiers.length > 1}
          onChange={updateTier}
          onDelete={() => deleteTier(editingTier.id)}
          onClose={() => setEditingTier(null)}
        />
      )}
    </div>
  )
}
