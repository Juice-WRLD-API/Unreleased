import { ReactNode, useRef, useState } from 'react'
import { X, GripVertical, ListMusic, Trash2, History, ChevronDown, Radio, Search, RefreshCw } from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import { formatDuration } from '../lib/format'
import { Track } from '../types'
import { useResizablePanel } from '../hooks/useResizablePanel'
import { useIsMobile } from '../hooks/useIsMobile'

const MAX_HISTORY_SHOWN = 10
const MAX_UPCOMING_SHOWN = 60

export default function QueuePanel(): JSX.Element {
  const {
    queue, queueIndex, currentTrack, isPlaying, shuffle, queueFilter, queueLoadingMore,
    radioMode, radioNext,
    setShowQueue, removeFromQueue, clearQueue, reorderQueue, jumpToTrack, _loadMore, reshuffleQueue,
  } = useStorePick('queue', 'queueIndex', 'currentTrack', 'isPlaying', 'shuffle', 'queueFilter', 'queueLoadingMore', 'radioMode', 'radioNext', 'setShowQueue', 'removeFromQueue', 'clearQueue', 'reorderQueue', 'jumpToTrack', '_loadMore', 'reshuffleQueue')

  const [panelWidth, dragHandle] = useResizablePanel(300, 240, 480)
  const isMobile = useIsMobile()
  const [historyOpen, setHistoryOpen] = useState(false)
  // How many upcoming rows to render - grows when the user clicks "+N more".
  const [visibleCount, setVisibleCount] = useState(MAX_UPCOMING_SHOWN)
  const [search, setSearch] = useState('')

  // Derived sections
  const history = queue.slice(0, queueIndex)           // played tracks, oldest first
  const upcoming = queue.slice(queueIndex + 1)          // unplayed tracks

  const query = search.trim().toLowerCase()
  const matchesQuery = (track: Track): boolean =>
    !query || track.title.toLowerCase().includes(query) || track.artist.toLowerCase().includes(query)
  // Pair each track with its original absolute index so onPlay/onRemove keep
  // working correctly after filtering shrinks the array.
  const upcomingIndexed = upcoming.map((track, i) => ({ track, i }))
  const filteredUpcoming = query ? upcomingIndexed.filter(({ track }) => matchesQuery(track)) : upcomingIndexed

  // Drag state (upcoming indices only)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  const handleDragStart = (e: React.DragEvent, idx: number): void => {
    setDragIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
  }
  const handleDragOver = (e: React.DragEvent, idx: number): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIdx(idx)
  }
  const handleDrop = (idx: number): void => {
    if (dragIdx !== null && dragIdx !== idx) reorderQueue(dragIdx, idx)
    setDragIdx(null); setDragOverIdx(null)
  }
  const handleDragEnd = (): void => { setDragIdx(null); setDragOverIdx(null) }

  const upcomingLabel = shuffle ? 'Shuffle' : 'Up Next'
  const hasMore = queueFilter?.hasMore

  // Reveal another batch of already-loaded upcoming rows, and (when the queue
  // is lazily loaded from the server) pull the next page in too so there's
  // more to reveal on the following click.
  const showMoreUpcoming = (): void => {
    setVisibleCount(c => c + MAX_UPCOMING_SHOWN)
    if (hasMore) _loadMore()
  }

  return (
    <div
      // bg-surface on mobile, not bg-surface-raised: this is `position: fixed;
      // inset: 0` there, so Safari's Liquid Glass toolbar tinting samples this
      // element's background directly - bg-surface-raised made the status bar
      // read visibly darker than the rest of the app while this panel is open.
      className={`${isMobile ? 'bg-surface' : 'bg-surface-raised'} flex shrink-0 overflow-hidden animate-slide-in-right`}
      style={isMobile
        // Full-screen on a phone, so it sits outside the app shell's
        // safe-area padding and owns the gesture-bar inset itself.
        ? { position: 'fixed', inset: 0, zIndex: 50, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }
        : { width: panelWidth, borderLeft: '1px solid var(--border)' }
      }
    >
      {/* Resize handle - desktop only */}
      {!isMobile && (
        <div className="w-1 shrink-0 relative group/handle" {...dragHandle}>
          <div className="absolute inset-y-0 -left-1 -right-1 group-hover/handle:bg-accent/30 transition-colors rounded-full" />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 pb-3 shrink-0 border-b border-[var(--border)]"
          style={{
            // Clears the status bar when running edge-to-edge on mobile -
            // this panel is fixed, so the shell's inset doesn't reach it.
            paddingTop: isMobile ? 'max(20px, var(--top-inset))' : 20,
          }}
        >
          <div className="flex items-center gap-2">
            <ListMusic size={15} className="text-text-muted" />
            <h2 className="text-text-primary font-semibold text-sm uppercase tracking-widest">Queue</h2>
          </div>
          <div className="flex items-center gap-3">
            {upcoming.length > 0 && (
              <button
                onClick={clearQueue}
                className="text-text-muted hover:text-red-400 transition-colors text-xs flex items-center gap-1"
                title="Clear upcoming"
              >
                <Trash2 size={12} /> Clear
              </button>
            )}
            <button onClick={() => setShowQueue(false)} className="text-text-muted hover:text-text-primary transition-colors">
              <X size={17} />
            </button>
          </div>
        </div>

        {/* Search */}
        {queue.length > 0 && (
          <div className="px-4 pt-3 shrink-0">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface-overlay focus-within:ring-1 focus-within:ring-accent/50 transition-shadow">
              <Search size={13} className="text-text-muted shrink-0" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search queue"
                className="flex-1 min-w-0 bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="text-text-muted hover:text-text-primary transition-colors shrink-0"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>

          {/* ── History ── (collapsible, above now playing) */}
          {history.length > 0 && (
            <div className="px-4 pt-4 pb-2">
              <button
                onClick={() => setHistoryOpen((o) => !o)}
                className="flex items-center gap-1.5 px-1 mb-2 text-text-muted hover:text-text-secondary transition-colors w-full text-left"
              >
                <History size={11} />
                <span className="text-xs uppercase tracking-widest flex-1">
                  History · {history.length}
                </span>
                <ChevronDown
                  size={12}
                  className={`transition-transform ${historyOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {historyOpen && (() => {
                // Displayed newest-first, so reversed index i maps back to
                // absolute queue position history.length - 1 - i.
                const reversedIndexed = [...history].reverse().map((track, i) => ({ track, i }))
                const filtered = query ? reversedIndexed.filter(({ track }) => matchesQuery(track)) : reversedIndexed
                const shown = query ? filtered : filtered.slice(0, MAX_HISTORY_SHOWN)
                return (
                  <div className="opacity-50 space-y-0.5">
                    {shown.map(({ track, i }) => (
                      <QueueRow
                        key={`hist-${track.id}-${i}`}
                        track={track}
                        isActive={false}
                        isPlaying={false}
                        onPlay={() => jumpToTrack(track, history.length - 1 - i)}
                      />
                    ))}
                    {!query && filtered.length > MAX_HISTORY_SHOWN && (
                      <p className="text-text-muted text-[10px] text-center py-1 opacity-60">
                        +{filtered.length - MAX_HISTORY_SHOWN} older
                      </p>
                    )}
                    {query && shown.length === 0 && (
                      <p className="text-text-muted text-[10px] text-center py-1 opacity-60">
                        No matches
                      </p>
                    )}
                  </div>
                )
              })()}
            </div>
          )}

          {/* ── Now Playing ── */}
          {currentTrack ? (
            !query && (
              <div className="px-4 py-3">
                <p className="text-text-muted text-[10px] uppercase tracking-widest px-1 mb-2 font-semibold">
                  Now Playing
                </p>
                <QueueRow track={currentTrack} isActive isPlaying={isPlaying} />
              </div>
            )
          ) : (
            <div className="flex flex-col items-center justify-center h-44 gap-2 text-center px-8">
              <ListMusic className="text-text-muted w-8 h-8 opacity-20" />
              <p className="text-text-muted text-sm">Queue is empty</p>
              <p className="text-text-muted text-xs">Play a song to get started</p>
            </div>
          )}

          {/* Divider */}
          {!query && currentTrack && <div className="mx-4 border-t border-[var(--border)] opacity-40" />}

          {/* ── Radio: show pre-fetched next track or loading indicator ── */}
          {!query && radioMode && (
            <div className="px-4 pt-3 pb-4">
              <p className="text-text-muted text-[10px] uppercase tracking-widest px-1 mb-2 font-semibold flex items-center gap-1.5">
                <Radio size={10} className="text-accent" />
                <span className="text-accent">Random</span>
                <span className="opacity-60">· Up Next</span>
                <button
                  onClick={reshuffleQueue}
                  title="Reshuffle"
                  className="ml-auto p-1 -m-1 rounded text-text-muted hover:text-text-primary transition-colors"
                >
                  <RefreshCw size={11} />
                </button>
              </p>
              {radioNext ? (
                <QueueRow track={radioNext} isActive={false} isPlaying={false} />
              ) : (
                <div className="flex items-center gap-2 px-1 py-2 text-text-muted text-xs opacity-50">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                  Finding next song…
                </div>
              )}
            </div>
          )}

          {/* ── Upcoming (non-radio) ── */}
          {!radioMode && filteredUpcoming.length > 0 ? (
            <div className="px-4 pt-3 pb-6">
              <p className="text-text-muted text-[10px] uppercase tracking-widest px-1 mb-2 font-semibold flex items-center gap-1.5">
                {query ? 'Results' : upcomingLabel}
                <span className="opacity-60">
                  · {filteredUpcoming.length}{!query && hasMore ? '+' : ''}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  {queueLoadingMore && (
                    <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                  )}
                  {!query && shuffle && (
                    <button
                      onClick={reshuffleQueue}
                      title="Reshuffle"
                      className="p-1 -m-1 rounded text-text-muted hover:text-text-primary transition-colors"
                    >
                      <RefreshCw size={11} />
                    </button>
                  )}
                </span>
              </p>

              {(query ? filteredUpcoming : filteredUpcoming.slice(0, visibleCount)).map(({ track, i }) => (
                <SwipeableUpcomingRow
                  key={`up-${track.id}-${queueIndex + 1 + i}`}
                  query={!!query}
                  isDragOver={dragOverIdx === i && dragIdx !== i}
                  isDragging={dragIdx === i}
                  onDragStart={(e) => handleDragStart(e, i)}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDrop={() => handleDrop(i)}
                  onDragEnd={handleDragEnd}
                  onRemove={() => removeFromQueue(queueIndex + 1 + i)}
                >
                  <QueueRow
                    track={track}
                    isActive={false}
                    isPlaying={false}
                    showDrag={!query}
                    // jumpToTrack, not playTrack: rebuilding the queue from a
                    // slice here dropped history AND reset queueFilter, which
                    // permanently killed lazy loading for the session.
                    onPlay={() => jumpToTrack(track, queueIndex + 1 + i)}
                    onRemove={() => removeFromQueue(queueIndex + 1 + i)}
                  />
                </SwipeableUpcomingRow>
              ))}

              {!query && filteredUpcoming.length > visibleCount && (
                <button
                  onClick={showMoreUpcoming}
                  className="w-full text-text-muted hover:text-text-primary text-xs text-center py-2 rounded-lg hover:bg-surface-overlay transition-colors"
                >
                  +{filteredUpcoming.length - visibleCount}{hasMore ? '+' : ''} more
                </button>
              )}
            </div>
          ) : !radioMode && query ? (
            <p className="text-text-muted text-xs text-center py-4 opacity-50">
              No matches
            </p>
          ) : !radioMode && currentTrack ? (
            <p className="text-text-muted text-xs text-center py-4 opacity-50">
              Nothing up next
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// ─── Swipe-to-remove wrapper (mobile) + drag-to-reorder wrapper (desktop) ────
// Same row, two removal gestures: HTML5 drag events (desktop mouse) never
// fire from touch, so a phone gets nothing from the reorder wiring above - a
// leftward swipe uncovers a red delete backdrop instead, mirroring the
// swipe-to-delete pattern most mail/message apps already teach.
function SwipeableUpcomingRow({
  children, query, isDragOver, isDragging, onDragStart, onDragOver, onDrop, onDragEnd, onRemove,
}: {
  children: ReactNode
  query: boolean
  isDragOver: boolean
  isDragging: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: () => void
  onDragEnd: () => void
  onRemove: () => void
}): JSX.Element {
  // How far left fully reveals the backdrop, and how far past that triggers
  // removal on release - rubber-banded past REVEAL so the row doesn't just
  // vanish off-screen as you keep dragging.
  const REVEAL = 72
  const THRESHOLD = 56
  const startRef = useRef<{ x: number; y: number } | null>(null)
  // Undecided until the touch moves enough to tell a horizontal swipe from a
  // vertical scroll - committing too early would swallow a scroll attempt
  // that happens to start with a slightly diagonal touch.
  const axisRef = useRef<'x' | 'y' | null>(null)
  const [dragX, setDragX] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const [removing, setRemoving] = useState(false)

  const onTouchStart = (e: React.TouchEvent): void => {
    if (e.touches.length !== 1) return
    if ((e.target as HTMLElement).closest('button')) return
    startRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    axisRef.current = null
  }
  const onTouchMove = (e: React.TouchEvent): void => {
    if (!startRef.current) return
    const dx = e.touches[0].clientX - startRef.current.x
    const dy = e.touches[0].clientY - startRef.current.y
    if (!axisRef.current) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
      axisRef.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (axisRef.current === 'x') setSwiping(true)
    }
    if (axisRef.current !== 'x') return
    // preventDefault here (not just on the horizontal axis check above) is
    // what stops the synthetic click iOS/Android fire after touchend - without
    // it, releasing mid-swipe on the row also triggered its tap-to-play.
    e.preventDefault()
    const raw = Math.min(dx, 0)
    setDragX(raw < -REVEAL ? -REVEAL + (raw + REVEAL) / 4 : raw)
  }
  const onTouchEnd = (): void => {
    if (axisRef.current === 'x' && dragX < -THRESHOLD) {
      setRemoving(true)
      setDragX(-window.innerWidth)
      window.setTimeout(onRemove, 180)
    } else {
      setDragX(0)
    }
    setSwiping(false)
    startRef.current = null
    axisRef.current = null
  }

  return (
    <div
      draggable={!query}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      className={`relative overflow-hidden transition-transform ${isDragOver ? 'translate-y-0.5 opacity-70' : ''} ${isDragging ? 'opacity-30' : ''}`}
    >
      <div
        className="absolute inset-0 rounded-lg bg-red-500 flex items-center justify-end pr-5 pointer-events-none"
        style={{ opacity: dragX < 0 ? Math.min(1, -dragX / THRESHOLD) : 0 }}
      >
        <Trash2 size={15} className="text-white" />
      </div>
      <div
        style={{
          transform: dragX ? `translateX(${dragX}px)` : undefined,
          transition: swiping ? 'none' : 'transform 0.2s ease-out, opacity 0.2s ease-out',
          opacity: removing ? 0 : 1,
        }}
      >
        {children}
      </div>
    </div>
  )
}

// ─── Row component ────────────────────────────────────────────────────────────

function QueueRow({
  track, isActive, isPlaying, showDrag, onPlay, onRemove,
}: {
  track: Track
  isActive: boolean
  isPlaying: boolean
  showDrag?: boolean
  onPlay?: () => void
  onRemove?: () => void
}): JSX.Element {
  return (
    <div
      className={`flex items-center gap-2 px-1 py-1.5 rounded-lg group transition-colors ${
        isActive ? 'bg-surface-overlay' : 'hover:bg-surface-overlay'
      } ${onPlay && !isActive ? 'cursor-pointer' : ''}`}
      onDoubleClick={onPlay}
      // Double-click has no touch equivalent worth relying on - same
      // tap-to-play treatment as the Tracker/Playlists rows.
      onClick={() => { if (window.matchMedia('(max-width: 767px)').matches && onPlay && !isActive) onPlay() }}
    >
      {/* Drag handle or spacer */}
      {showDrag ? (
        <div className="text-text-muted opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing shrink-0 transition-opacity">
          <GripVertical size={13} />
        </div>
      ) : (
        <div className="w-3.5 shrink-0" />
      )}

      {/* Art */}
      <div className="w-9 h-9 rounded shrink-0 overflow-hidden bg-surface-overlay">
        <AlbumArtThumbnail track={track} size={36} fill className="w-full h-full" shimmer={false} rootMargin="200px" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium truncate leading-tight ${isActive ? 'text-accent' : 'text-text-primary'}`} title={track.title}>
          {track.title}
        </p>
        <p className="text-[10px] text-text-muted truncate mt-0.5">{track.artist}</p>
      </div>

      {/* Duration + remove */}
      <div className="flex items-center gap-1 shrink-0">
        {!isPlaying && (
          <span className="text-text-muted text-[10px] tabular-nums opacity-50">
            {track.duration ? formatDuration(track.duration) : ''}
          </span>
        )}
        {isPlaying && (
          <span className="flex gap-0.5 items-end h-3">
            {[0.4, 0.7, 1, 0.6].map((h, i) => (
              <span
                key={i}
                className="w-0.5 bg-accent rounded-full animate-pulse"
                style={{ height: `${h * 100}%`, animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </span>
        )}
        {onRemove && (
          // Was opacity-0 group-hover:opacity-100 with no touch equivalent -
          // invisible and undiscoverable on mobile.
          <button
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            aria-label="Remove from queue"
            className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-text-muted hover:text-red-400 transition-all ml-1 w-8 h-8 md:w-auto md:h-auto flex items-center justify-center md:p-0.5"
          >
            <X size={14} className="md:w-[11px] md:h-[11px]" />
          </button>
        )}
      </div>
    </div>
  )
}
