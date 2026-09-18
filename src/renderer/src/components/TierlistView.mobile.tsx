// Tier List - rank songs into S/A/B/C/D (or whatever tiers the user builds)
// by dragging a song into a row (touch drag via Pointer Events, since HTML5
// drag-and-drop doesn't fire on touch), or by tapping a song then tapping the
// row it belongs in. Unlike Heardle/Wordle there's no daily puzzle or score:
// it's a personal ranking, persisted locally (see lib/tierlist) with no
// server round-trip.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronLeft, ChevronUp, ChevronDown, Settings2, Music2, Plus, RotateCcw, Search, X, Check,
} from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { POOL_LABELS } from '../lib/heardle'
import type { HeardleSong, PoolId } from '../lib/heardle'
import { smallCoverUrl } from '../lib/juicewrldApi'
import { TIER_COLOR_PRESETS } from '../lib/tierlist'
import type { Tier } from '../lib/tierlist'
import { Sheet } from './mobile/Sheet'
import { GameSwitcher, GameBackdrop } from './gameShell'
import { useTierlistData } from '../hooks/useTierlistData'

// Drop-zone id used for the "Unranked" pool, since tier ids are already
// unique strings and null can't be stuffed into a DOM dataset attribute.
const POOL_DROP_ZONE = '__pool__'

// Pointer must move this many px before a press counts as a drag rather than
// a tap - keeps tap-to-select working for a finger that doesn't quite hold still.
const DRAG_THRESHOLD = 8

// ─── Pieces ───────────────────────────────────────────────────────────────────

function SongChip({ song, selected, dragging, onClick, onPointerDown }: {
  song: HeardleSong
  selected: boolean
  dragging?: boolean
  onClick: () => void
  onPointerDown: (e: React.PointerEvent) => void
}): JSX.Element {
  return (
    <div
      onClick={onClick}
      onPointerDown={onPointerDown}
      title={song.name}
      className={`shrink-0 w-16 cursor-pointer touch-none ${dragging ? 'opacity-30' : ''}`}
    >
      <div
        className={`relative w-16 h-16 rounded-lg overflow-hidden border-2 transition-all ${
          selected ? 'border-accent ring-2 ring-accent/50 scale-95' : 'border-[var(--border)]'
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

function TierRow({ tier, songs, isFirst, isLast, selectedSongId, draggedSongId, isDropTarget, onClickRow, onSelectSong, onSongPointerDown, onMoveUp, onMoveDown, onEdit }: {
  tier: Tier
  songs: HeardleSong[]
  isFirst: boolean
  isLast: boolean
  selectedSongId: number | null
  draggedSongId: number | null
  isDropTarget: boolean
  onClickRow: () => void
  onSelectSong: (id: number) => void
  onSongPointerDown: (song: HeardleSong) => (e: React.PointerEvent) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onEdit: () => void
}): JSX.Element {
  return (
    <div className="flex rounded-xl overflow-hidden border border-[var(--border)]">
      <button
        onClick={onEdit}
        title="Edit tier"
        className="w-16 shrink-0 flex items-center justify-center text-center px-1.5 py-3 font-black text-sm leading-tight active:opacity-80 transition-opacity"
        style={{ background: tier.color, color: 'rgba(0,0,0,0.75)' }}
      >
        {tier.label}
      </button>
      <div
        onClick={onClickRow}
        data-drop-zone={tier.id}
        className={`flex-1 min-h-[6.5rem] bg-[var(--surface-overlay)]/30 p-1.5 flex flex-wrap gap-1.5 content-start transition-colors ${
          selectedSongId !== null ? 'cursor-copy' : ''
        } ${isDropTarget ? 'bg-accent/20 outline outline-2 outline-accent/60 -outline-offset-2' : ''}`}
      >
        {songs.map((s) => (
          <SongChip
            key={s.id}
            song={s}
            selected={selectedSongId === s.id}
            dragging={draggedSongId === s.id}
            onClick={() => onSelectSong(s.id)}
            onPointerDown={onSongPointerDown(s)}
          />
        ))}
      </div>
      <div className="w-9 shrink-0 flex flex-col border-l border-[var(--border)]">
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          title="Move tier up"
          className="flex-1 flex items-center justify-center text-text-muted active:text-text-primary disabled:opacity-20 transition-colors"
        >
          <ChevronUp size={14} />
        </button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          title="Move tier down"
          className="flex-1 flex items-center justify-center text-text-muted active:text-text-primary disabled:opacity-20 transition-colors border-t border-[var(--border)]"
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
}): JSX.Element {
  return (
    <Sheet onClose={onClose} title="Edit tier">
      <div className="px-5 pb-2">
        <label className="text-xs text-text-muted mb-1 block">Label</label>
        <input
          value={tier.label}
          maxLength={20}
          onChange={(e) => onChange({ ...tier, label: e.target.value })}
          className="w-full mb-4 px-3 py-2.5 rounded-xl bg-[var(--surface-overlay)] border border-[var(--border)] text-sm text-text-primary focus:outline-none focus:border-accent/50"
        />
        <label className="text-xs text-text-muted mb-1 block">Color</label>
        <div className="flex flex-wrap gap-2.5 mb-5">
          {TIER_COLOR_PRESETS.map((c) => (
            <button
              key={c}
              onClick={() => onChange({ ...tier, color: c })}
              title={c}
              className={`w-9 h-9 rounded-full border-2 transition-colors ${tier.color === c ? 'border-text-primary' : 'border-transparent'}`}
              style={{ background: c }}
            />
          ))}
        </div>
        {canDelete && (
          <button
            onClick={onDelete}
            className="w-full h-11 rounded-xl border border-red-500/30 text-red-400 text-sm font-semibold active:bg-red-500/10 transition-colors"
          >
            Delete tier
          </button>
        )}
      </div>
    </Sheet>
  )
}

// ─── View ───────────────────────────────────────────────────────────────────

export default function TierlistView(): JSX.Element {
  const { setActiveView, setHeroBleedTop, previousView } = useStorePick(
    'setActiveView', 'setHeroBleedTop', 'previousView')

  // Lets GameBackdrop's wash paint full-bleed under the status bar instead of
  // stopping at the shell's usual inset - matches WRLD's ownsTopInset trick.
  // The corner buttons and the switcher's top clearance compensate below.
  // Always true: mobile's nav bar is bottom-only now (see BottomNav), so the
  // shell always reserves this inset itself.
  const ownsTopInset = true
  useEffect(() => {
    setHeroBleedTop(true)
    return () => setHeroBleedTop(false)
  }, [setHeroBleedTop])

  const {
    tiers, categories, poolLoading, poolError, search, setSearch,
    selectedSongId, setSelectedSongId, editingTier, setEditingTier, showFilters, setShowFilters,
    visiblePool, songsInTier, assignSong, clickRow, moveTier, addTier, updateTier, deleteTier,
    toggleCategory, handleReset,
  } = useTierlistData()

  // Touch drag: a floating copy of the chip follows the pointer while
  // `drag` is set; `dropTarget` mirrors whichever `[data-drop-zone]` is
  // currently under it, for the highlight. Actual pointermove/up listeners
  // live on window (added on pointerdown) so the drag tracks past the
  // chip's own bounds; `pointerState` is a ref rather than state since it's
  // read/written on every move and shouldn't trigger re-renders itself.
  const [drag, setDrag] = useState<{ song: HeardleSong; x: number; y: number } | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const pointerState = useRef<{ song: HeardleSong; startX: number; startY: number; dragging: boolean } | null>(null)
  const suppressClickRef = useRef(false)

  // Chip selection is routed through here (rather than straight to
  // setSelectedSongId) so a drag's trailing click - fired by the browser
  // right after pointerup - doesn't also toggle selection.
  const handleChipClick = (songId: number): void => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return }
    setSelectedSongId((cur) => (cur === songId ? null : songId))
  }

  const zoneUnderPoint = useCallback((x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)
    const zoneEl = el instanceof Element ? el.closest<HTMLElement>('[data-drop-zone]') : null
    return zoneEl?.dataset.dropZone ?? null
  }, [])

  const handleSongPointerMove = useCallback((e: PointerEvent): void => {
    const ps = pointerState.current
    if (!ps) return
    const dx = e.clientX - ps.startX
    const dy = e.clientY - ps.startY
    if (!ps.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) ps.dragging = true
    if (ps.dragging) {
      e.preventDefault()
      setDrag({ song: ps.song, x: e.clientX, y: e.clientY })
      setDropTarget(zoneUnderPoint(e.clientX, e.clientY))
    }
  }, [zoneUnderPoint])

  // These stay stable across renders (via the useCallback chain down to
  // assignSong/zoneUnderPoint, which have no deps) so that the add/remove
  // pairs in handleSongPointerDown and the unmount cleanup below always
  // refer to the same function identity - addEventListener/removeEventListener
  // only match on identity, so a handler that changed shape between the
  // pointerdown and the eventual pointerup would leak a listener.
  const handleSongPointerUp = useCallback((e: PointerEvent): void => {
    window.removeEventListener('pointermove', handleSongPointerMove)
    window.removeEventListener('pointerup', handleSongPointerUp)
    window.removeEventListener('pointercancel', handleSongPointerUp)
    const ps = pointerState.current
    pointerState.current = null
    if (ps?.dragging) {
      suppressClickRef.current = true
      const zone = zoneUnderPoint(e.clientX, e.clientY)
      if (zone) assignSong(ps.song.id, zone === POOL_DROP_ZONE ? null : zone)
    }
    setDrag(null)
    setDropTarget(null)
  }, [assignSong, zoneUnderPoint, handleSongPointerMove])

  const handleSongPointerDown = useCallback((song: HeardleSong) => (e: React.PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    pointerState.current = { song, startX: e.clientX, startY: e.clientY, dragging: false }
    window.addEventListener('pointermove', handleSongPointerMove, { passive: false })
    window.addEventListener('pointerup', handleSongPointerUp)
    window.addEventListener('pointercancel', handleSongPointerUp)
  }, [handleSongPointerMove, handleSongPointerUp])

  useEffect(() => () => {
    window.removeEventListener('pointermove', handleSongPointerMove)
    window.removeEventListener('pointerup', handleSongPointerUp)
    window.removeEventListener('pointercancel', handleSongPointerUp)
  }, [handleSongPointerMove, handleSongPointerUp])

  return (
    <div className="relative flex-1 flex flex-col h-full overflow-hidden bg-[var(--surface)]">
      <GameBackdrop />

      {/* Corner controls - the hero owns the middle, so navigation and the
          panels sit out of its way. z-20: the scroll container fills the whole
          view and comes later in the DOM, so at equal z it took every click in
          these corners and left the buttons visible but dead. */}
      <div
        className="absolute left-2 z-20"
        style={{ top: ownsTopInset ? 'calc(var(--top-inset) + 0.5rem)' : '0.5rem' }}
      >
        <button
          // See HeardleView.mobile.tsx's back button - same reasoning: Home,
          // not WRLD, is where mobile actually enters this game from now.
          onClick={() => setActiveView(previousView ?? 'home')}
          aria-label="Back"
          className="w-11 h-11 flex items-center justify-center rounded-full text-text-primary active:bg-surface-overlay transition-colors"
        >
          <ChevronLeft size={20} />
        </button>
      </div>
      <div
        className="absolute right-2 z-20 flex items-center gap-1"
        style={{ top: ownsTopInset ? 'calc(var(--top-inset) + 0.5rem)' : '0.5rem' }}
      >
        <button
          onClick={() => setShowFilters(true)}
          aria-label="Song pool"
          className="w-11 h-11 flex items-center justify-center rounded-full text-text-muted active:bg-surface-overlay transition-colors"
        >
          <Settings2 size={18} />
        </button>
        <button
          onClick={handleReset}
          aria-label="Clear tier list"
          className="w-11 h-11 flex items-center justify-center rounded-full text-text-muted active:bg-surface-overlay transition-colors"
        >
          <RotateCcw size={18} />
        </button>
      </div>

      {/* z-10: the backdrop layers above are absolutely positioned, so content
          has to be positioned too or they paint over it. */}
      <div className="relative z-10 flex-1 overflow-y-auto px-4 pt-2 pb-10">
        <div className="mx-auto w-full max-w-xl">
          {/* Clears the corner buttons (0.5rem + h-11 → bottom edge at 3.25rem)
              plus the safe-area inset they now sit below, since this view
              bleeds its own backdrop under the status bar. */}
          <div style={{ marginTop: ownsTopInset ? 'calc(var(--top-inset) + 3.5rem)' : '3.5rem' }}>
            <GameSwitcher current="tierlist" />
          </div>

          <div className="text-center mb-5">
            <h1 className="text-text-primary text-3xl font-black tracking-tight">Tier List</h1>
            <p className="text-text-muted text-xs mt-2">
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
                draggedSongId={drag?.song.id ?? null}
                isDropTarget={dropTarget === tier.id}
                onClickRow={clickRow(tier.id)}
                onSelectSong={handleChipClick}
                onSongPointerDown={handleSongPointerDown}
                onMoveUp={() => moveTier(i, -1)}
                onMoveDown={() => moveTier(i, 1)}
                onEdit={() => setEditingTier(tier)}
              />
            ))}
          </div>

          <button
            onClick={addTier}
            className="w-full mb-8 h-11 rounded-xl border border-dashed border-[var(--border)] text-text-muted active:text-text-primary active:border-accent/40 transition-colors text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-1.5"
          >
            <Plus size={14} /> Add tier
          </button>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]/40 p-3">
            <div className="flex items-center gap-2 mb-3">
              <Music2 size={14} className="text-text-muted shrink-0" />
              <span className="text-xs font-bold uppercase tracking-widest text-text-muted">Unranked</span>
              <span className="text-xs text-text-muted">({visiblePool.length})</span>
            </div>
            <div className="relative mb-3">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search songs"
                className="w-full pl-8 pr-3 py-2 rounded-lg bg-[var(--surface-overlay)] border border-[var(--border)] text-xs text-text-primary focus:outline-none focus:border-accent/50"
              />
            </div>
            <div
              onClick={clickRow(null)}
              data-drop-zone={POOL_DROP_ZONE}
              className={`min-h-[7.5rem] flex flex-wrap gap-1.5 content-start rounded-lg transition-colors ${
                selectedSongId !== null ? 'cursor-copy' : ''
              } ${dropTarget === POOL_DROP_ZONE ? 'bg-accent/20 outline outline-2 outline-accent/60 -outline-offset-2' : ''}`}
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
                    dragging={drag?.song.id === s.id}
                    onClick={() => handleChipClick(s.id)}
                    onPointerDown={handleSongPointerDown(s)}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {drag && (
        <div
          className="fixed z-[300] pointer-events-none w-16"
          style={{ left: drag.x - 32, top: drag.y - 32 }}
        >
          <div className="relative w-16 h-16 rounded-lg overflow-hidden border-2 border-accent shadow-xl scale-110">
            {drag.song.imageUrl ? (
              <img src={smallCoverUrl(drag.song.imageUrl)} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-[var(--surface-overlay)] flex items-center justify-center">
                <Music2 size={18} className="text-text-muted" />
              </div>
            )}
          </div>
        </div>
      )}

      {showFilters && (
        <Sheet onClose={() => setShowFilters(false)} title="Song pool">
          <div className="px-5 pb-2 flex flex-col gap-2">
            {(['released', 'unreleased'] as PoolId[]).map((cat) => (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className={`flex items-center justify-between px-4 h-12 rounded-xl border text-sm transition-colors ${
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
        </Sheet>
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
