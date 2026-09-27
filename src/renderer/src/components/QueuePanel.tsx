import { useRef, useState, useEffect } from 'react'
import { X, GripVertical, ListMusic, Trash2, History, ChevronDown, Radio, Search, RefreshCw } from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import { formatDuration } from '../lib/format'
import { Track } from '../types'
import { useResizablePanel } from '../hooks/useResizablePanel'

const MAX_HISTORY_SHOWN = 10
const MAX_UPCOMING_SHOWN = 60

export default function QueuePanel(): JSX.Element {
  const {
    queue, queueIndex, currentTrack, isPlaying, shuffle, queueFilter, queueLoadingMore,
    radioMode, radioNext,
    setShowQueue, removeFromQueue, clearQueue, reorderQueue, jumpToTrack, _loadMore, reshuffleQueue,
  } = useStorePick('queue', 'queueIndex', 'currentTrack', 'isPlaying', 'shuffle', 'queueFilter', 'queueLoadingMore', 'radioMode', 'radioNext', 'setShowQueue', 'removeFromQueue', 'clearQueue', 'reorderQueue', 'jumpToTrack', '_loadMore', 'reshuffleQueue')

  const [panelWidth, dragHandle] = useResizablePanel(300, 240, 480)
  const isElectron = navigator.userAgent.includes('Electron')
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const [historyOpen, setHistoryOpen] = useState(false)
  // How many upcoming rows to render — grows when the user clicks "+N more".
  const [visibleCount, setVisibleCount] = useState(MAX_UPCOMING_SHOWN)
  const [search, setSearch] = useState('')

  useEffect(() => {
    const check = (): void => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

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
      className="bg-surface-raised flex shrink-0 overflow-hidden animate-slide-in-right"
      style={isMobile
        ? { position: 'fixed', inset: 0, zIndex: 50 }
        : { width: panelWidth, borderLeft: '1px solid var(--border)' }
      }
    >
      {/* Resize handle — desktop only */}
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
          style={{ paddingTop: isElectron && !isMobile ? 36 : 20, paddingRight: isElectron && !isMobile ? 188 : undefined }}
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
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface-overlay">
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
                <div
                  key={`up-${track.id}-${queueIndex + 1 + i}`}
                  draggable={!query}
                  onDragStart={(e) => handleDragStart(e, i)}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDrop={() => handleDrop(i)}
                  onDragEnd={handleDragEnd}
                  className={`transition-transform ${
                    dragOverIdx === i && dragIdx !== i ? 'translate-y-0.5 opacity-70' : ''
                  } ${dragIdx === i ? 'opacity-30' : ''}`}
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
                </div>
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
        <AlbumArtThumbnail track={track} size={36} fill className="w-full h-full" shimmer={false} eager />
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
          <button
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400 transition-all ml-1 p-0.5"
          >
            <X size={11} />
          </button>
        )}
      </div>
    </div>
  )
}
