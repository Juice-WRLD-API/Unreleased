// Tier List - rank songs into S/A/B/C/D (or whatever tiers the user builds)
// by dragging them into rows, or by tap-to-select then tap-a-row on touch.
// Unlike Heardle/Wordle there's no daily puzzle or score: it's a personal
// ranking, persisted locally (see lib/tierlist) with no server round-trip.
import { useId } from 'react'
import {
  ChevronLeft, ChevronUp, ChevronDown, Settings2, Music2, Plus, RotateCcw, Search, X, Check,
} from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { POOL_LABELS } from '../lib/heardle'
import type { HeardleSong, PoolId } from '../lib/heardle'
import { smallCoverUrl } from '../lib/juicewrldApi'
import { TIER_COLOR_PRESETS } from '../lib/tierlist'
import type { Tier } from '../lib/tierlist'
import { GameSwitcher, GameBackdrop } from './gameShell'
import { useTierlistData } from '../hooks/useTierlistData'

// ─── Pieces ───────────────────────────────────────────────────────────────────

function SongChip({ song, selected, onClick, onDragStart }: {
  song: HeardleSong
  selected: boolean
  onClick: () => void
  onDragStart: (e: React.DragEvent) => void
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      title={song.name}
      className="shrink-0 w-14 sm:w-16 cursor-pointer"
    >
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

function TierRow({ tier, songs, isFirst, isLast, selectedSongId, onDrop, onClickRow, onSelectSong, onMoveUp, onMoveDown, onEdit }: {
  tier: Tier
  songs: HeardleSong[]
  isFirst: boolean
  isLast: boolean
  selectedSongId: number | null
  onDrop: (e: React.DragEvent) => void
  onClickRow: () => void
  onSelectSong: (id: number) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onEdit: () => void
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
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onClick={onClickRow}
        className={`flex-1 min-h-[6.5rem] bg-[var(--surface-overlay)]/30 p-1.5 flex flex-wrap gap-1.5 content-start ${
          selectedSongId !== null ? 'cursor-copy' : ''
        }`}
      >
        {songs.map((s) => (
          <SongChip
            key={s.id}
            song={s}
            selected={selectedSongId === s.id}
            onClick={() => onSelectSong(s.id)}
            onDragStart={(e) => e.dataTransfer.setData('text/plain', String(s.id))}
          />
        ))}
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

export default function TierlistView(): JSX.Element {
  const { setActiveView } = useStorePick('setActiveView')

  const {
    tiers, categories, poolLoading, poolError, search, setSearch,
    selectedSongId, setSelectedSongId, editingTier, setEditingTier, showFilters, setShowFilters,
    visiblePool, songsInTier, assignSong, clickRow, moveTier, addTier, updateTier, deleteTier,
    toggleCategory, handleReset,
  } = useTierlistData()

  const handleDrop = (tierId: string | null) => (e: React.DragEvent): void => {
    e.preventDefault()
    const id = Number(e.dataTransfer.getData('text/plain'))
    if (Number.isFinite(id)) assignSong(id, tierId)
  }

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
          onClick={() => setShowFilters(true)}
          title="Song pool"
          className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]/60 text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors"
        >
          <Settings2 size={20} />
        </button>
        <button
          onClick={handleReset}
          title="Clear tier list"
          className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]/60 text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors"
        >
          <RotateCcw size={20} />
        </button>
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto px-4 sm:px-6 py-10">
        <div className="mx-auto w-full max-w-3xl">
          <GameSwitcher current="tierlist" />

          <div className="text-center mb-6">
            <h1 className="text-text-primary text-4xl sm:text-5xl font-black tracking-tight">Tier List</h1>
            <p className="text-text-muted text-sm mt-2">
              {selectedSongId !== null
                ? 'Tap a row to place it - tap the song again to cancel.'
                : 'Drag a song into a row, or tap it and then tap a row.'}
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
                songs={songsInTier(tier.id)}
                isFirst={i === 0}
                isLast={i === tiers.length - 1}
                selectedSongId={selectedSongId}
                onDrop={handleDrop(tier.id)}
                onClickRow={clickRow(tier.id)}
                onSelectSong={(id) => setSelectedSongId((cur) => (cur === id ? null : id))}
                onMoveUp={() => moveTier(i, -1)}
                onMoveDown={() => moveTier(i, 1)}
                onEdit={() => setEditingTier(tier)}
              />
            ))}
          </div>

          <button
            onClick={addTier}
            className="w-full mb-8 py-2.5 rounded-xl border border-dashed border-[var(--border)] text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-1.5"
          >
            <Plus size={14} /> Add tier
          </button>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]/40 p-3">
            <div className="flex items-center gap-2 mb-3">
              <Music2 size={14} className="text-text-muted shrink-0" />
              <span className="text-xs font-bold uppercase tracking-widest text-text-muted">Unranked</span>
              <span className="text-xs text-text-muted">({visiblePool.length})</span>
              <div className="ml-auto relative w-40 sm:w-56">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search songs"
                  className="w-full pl-7 pr-2 py-1.5 rounded-lg bg-[var(--surface-overlay)] border border-[var(--border)] text-xs text-text-primary focus:outline-none focus:border-accent/50"
                />
              </div>
            </div>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop(null)}
              onClick={clickRow(null)}
              className={`min-h-[7.5rem] flex flex-wrap gap-1.5 content-start ${selectedSongId !== null ? 'cursor-copy' : ''}`}
            >
              {poolLoading ? (
                <span className="text-xs text-text-muted py-4">Loading songs…</span>
              ) : visiblePool.length === 0 ? (
                <span className="text-xs text-text-muted py-4">
                  {search ? 'No songs match that search.' : 'Every song has been ranked.'}
                </span>
              ) : (
                visiblePool.map((s) => (
                  <SongChip
                    key={s.id}
                    song={s}
                    selected={selectedSongId === s.id}
                    onClick={() => setSelectedSongId((cur) => (cur === s.id ? null : s.id))}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', String(s.id))}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {showFilters && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={() => setShowFilters(false)}>
          <div
            className="w-full max-w-xs rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-text-primary font-bold text-sm">Song pool</h3>
              <button onClick={() => setShowFilters(false)} className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {(['released', 'unreleased'] as PoolId[]).map((cat) => (
                <button
                  key={cat}
                  onClick={() => toggleCategory(cat)}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition-colors ${
                    categories.includes(cat)
                      ? 'border-accent/40 bg-accent/10 text-text-primary'
                      : 'border-[var(--border)] text-text-muted'
                  }`}
                >
                  {POOL_LABELS[cat]}
                  {categories.includes(cat) && <Check size={14} className="text-accent" />}
                </button>
              ))}
            </div>
          </div>
        </div>
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
