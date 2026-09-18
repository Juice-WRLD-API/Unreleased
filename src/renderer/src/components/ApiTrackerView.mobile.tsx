import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react'
import {
  Search, Loader2, Music2, X, Check, ListPlus, ChevronDown, ChevronLeft,
  ChevronRight, MoreVertical, Plus, ListMusic, PackageOpen, Link2, Layers, LayoutGrid,
  LayoutList, Rows3, Mic2, CalendarDays, Users, AlertTriangle, Pencil, SlidersHorizontal,
  Filter, CheckCircle2, Circle, ArrowLeft, ArrowUp, ArrowDown, MapPin, BarChart3,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { useShallow } from 'zustand/react/shallow'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'
import SongInfoModal from './SongInfoModal'
import SongContextMenu from './SongContextMenu'
import { useExpandedGroups } from './CompactGroupRow'
import { Sheet, SheetItem, SheetDivider } from './mobile/Sheet'
import { useLongPress } from './mobile/useLongPress'
import {
  apiFetch, apiPeek, songToTrack, parseDuration, CATEGORY_LABELS, JWAPI_BASE,
  JWApiSong, JWApiPaginatedResponse, JWApiStats, JWApiEra, ZIP_OPERATIONS_ENABLED,
} from '../lib/juicewrldApi'
import { Track } from '../types'
import * as userApi from '../lib/userApi'
import { useCanEdit } from '../hooks/useChannelRoles'
import { versionsEnabled, linkSongVersion, getOwnVersionMeta, setGroupVersionTitle } from '../lib/versionsApi'
import { fetchAllCompactGroups, filterCompactGroups, invalidateCompactGroupsCache, subscribeCompactGroupsInvalidation } from '../lib/compactGroups'
import type { CompactGroup } from '../lib/compactGroups'
import { parseSearchQuery, matchesFieldFilters } from '../lib/trackerSearch'
import { useVirtualWindow } from '../hooks/useVirtualWindow'
import { runLog } from '../lib/runLog'
import { formatDuration } from '../lib/format'
import { registerBackHandler } from '../lib/backHandlers'
import { loadEraFullNames, eraLabel } from '../lib/eras'
import { useBackToClose } from '../hooks/useBackToClose'
import {
  Category, ViewMode, TrackerTab, TRACKER_TABS, isTrackerTab,
  EraColor, ERA_COLOR_PALETTE, DEFAULT_ERA_COLOR, GROUP_CATEGORY_PRIORITY, groupCategory,
  PAGE_SIZE, LS_TRACKER_SEARCH, MIN_PLAUSIBLE_RECORD_YEAR, getInitialSearch,
  SNIPPET_CONTEXT_CHARS, getLyricSnippet, MONTH_LABELS, buildMonthGrid,
  extractDateKeys, dateKey,
} from '../lib/apiTrackerShared'

// ─── Tracker ──────────────────────────────────────────────────────────────────
// Phone-first rewrite of the catalog browser. Every fetch path is unchanged -
// infinite scroll, the fetch-everything-then-sort mode, compact version groups,
// lyric search, the client-side parsing behind the calendar/producer tabs, the
// bulk ZIP/playlist/link operations, and the virtual windowing that keeps a
// 2500-song list mountable. What changed is that none of it is driven by a
// desktop chrome any more:
//
//   · the 176px category/era sidebar is a Filters sheet
//   · sortable column headers are a Sort sheet - which means mobile can sort at
//     all now; the headers were md:-only, so on a phone the feature didn't exist
//   · the four view modes moved into a sheet instead of a four-icon strip
//   · long-press starts a selection, and the bulk bar's eight buttons collapse
//     to four primary actions plus a sheet
//   · producers/engineers/studios drill down instead of sitting in a side column
//
// SongContextMenu is left alone deliberately: it already has a bottom-sheet
// mobile mode and is shared with Liked Songs, Playlists, the Player and WRLD, so
// it belongs to whichever pass rewrites those.

type OrderField = 'name' | 'credited_artists' | 'era__name' | 'category' | 'length'
type SheetKind = 'filters' | 'sort' | 'view' | 'bulk' | null

const CATEGORY_COLORS: Record<string, string> = {
  released:          'text-emerald-400 bg-emerald-400/10 border-emerald-400/25',
  unreleased:        'text-blue-400   bg-blue-400/10   border-blue-400/25',
  unsurfaced:        'text-amber-400  bg-amber-400/10  border-amber-400/25',
  recording_session: 'text-purple-400 bg-purple-400/10 border-purple-400/25',
}
const CATEGORY_DOTS: Record<string, string> = {
  released:          'bg-emerald-400',
  unreleased:        'bg-blue-400',
  unsurfaced:        'bg-amber-400',
  recording_session: 'bg-purple-400',
}

const LS_TRACKER_VIEW = 'api-tracker:viewMode'
const LS_TRACKER_COMPACT = 'api-tracker:compactView'
const LS_TRACKER_CALENDAR_MONTH = 'api-tracker:calendarMonth'

const SORT_OPTIONS: { field: OrderField; label: string }[] = [
  { field: 'name', label: 'Title' },
  { field: 'credited_artists', label: 'Artist' },
  { field: 'era__name', label: 'Era' },
  { field: 'category', label: 'Category' },
  { field: 'length', label: 'Length' },
]

const CATEGORY_OPTIONS: { key: Exclude<Category, ''>; label: string }[] = [
  { key: 'released',          label: 'Released' },
  { key: 'unreleased',        label: 'Unreleased' },
  { key: 'unsurfaced',        label: 'Unsurfaced' },
  { key: 'recording_session', label: 'Sessions' },
]

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** artist · era · category - the one subtitle line every song row carries. */
function songSubtitle(song: JWApiSong, fullEraNames: boolean): string {
  return [
    song.credited_artists || 'Juice WRLD',
    song.era?.name ? eraLabel(song.era.name, fullEraNames) : undefined,
    CATEGORY_LABELS[song.category] ?? song.category,
  ].filter(Boolean).join(' · ')
}

// ─── Row parts ────────────────────────────────────────────────────────────────

// Selection state is drawn ON the artwork rather than inserted before it. A
// leading checkbox pushes every row's contents sideways the instant select mode
// turns on - and since that happens mid-long-press, the layout moves out from
// under the finger before the press even ends.
function ArtSelectOverlay({ selected }: { selected: boolean }): JSX.Element {
  return (
    <div className={`absolute inset-0 flex items-center justify-center transition-colors ${selected ? 'bg-accent/75' : 'bg-black/45'}`}>
      {selected
        ? <Check size={22} className="text-white" strokeWidth={3} />
        : <Circle size={20} className="text-white/85" />}
    </div>
  )
}

/** Three animated bars marking the row you're currently hearing. */
function EqBars({ paused }: { paused: boolean }): JSX.Element {
  return (
    <span className="flex items-end gap-[2px] h-3.5 shrink-0">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`w-[3px] h-full rounded-full bg-accent ${paused ? '' : 'eq-bar'}`}
          style={{ animationDelay: `${i * 0.18}s`, transform: paused ? 'scaleY(0.4)' : undefined }}
        />
      ))}
    </span>
  )
}

interface RowProps {
  song: JWApiSong
  onPlay: (song: JWApiSong) => void
  onMenu: (song: JWApiSong, e: React.MouseEvent) => void
  selectMode: boolean
  selected: boolean
  onToggleSelect: (song: JWApiSong) => void
  playingId: string | null
  isPlaying: boolean
}

// ─── Song row (list mode) ─────────────────────────────────────────────────────
const SongRow = memo(function SongRow({
  song, onPlay, onMenu, selectMode, selected, onToggleSelect, playingId, isPlaying, versionLabel,
}: RowProps & { versionLabel?: string | null }): JSX.Element {
  // This song's personal override, if any. Selecting just this song's row keeps
  // the map's other churn from re-rendering the row, and songToTrack picks up
  // the custom cover from the same source on the render this triggers.
  const pref = useStore((s) => s.songPrefs[song.id])
  const fullEraNames = useStore((s) => s.fullEraNames)
  const track = songToTrack(song)
  const title = pref?.name || song.name
  const canPlay = !!song.path
  const isCurrent = playingId === `jw-${song.id}`

  const press = useLongPress({
    onTap: () => { if (selectMode) onToggleSelect(song); else if (canPlay) onPlay(song) },
    onLongPress: () => onToggleSelect(song),
  })

  return (
    <div
      className={`flex items-center gap-3 px-4 py-1.5 h-full rounded-2xl transition-colors ${
        selected ? 'bg-accent/15' : 'active:bg-surface-overlay'
      }`}
      {...press}
    >
      <div className={`relative shrink-0 w-12 h-12 rounded-xl overflow-hidden bg-surface-overlay ${canPlay ? '' : 'opacity-60'}`}>
        <AlbumArtThumbnail track={track} size={48} shimmer={false} eager />
        {selectMode && <ArtSelectOverlay selected={selected} />}
      </div>

      <div className="flex-1 min-w-0">
        <p className={`text-[15px] leading-snug truncate ${isCurrent ? 'text-accent font-semibold' : 'text-text-primary'}`}>
          {title}
          {versionLabel && <span className="text-text-muted font-normal"> ({versionLabel})</span>}
        </p>
        <p className="text-text-muted text-xs truncate mt-0.5">{songSubtitle(song, fullEraNames)}</p>
      </div>

      {isCurrent && <EqBars paused={!isPlaying} />}
      <span className="text-text-muted text-[11px] tabular-nums shrink-0">
        {formatDuration(parseDuration(song.length), '--:--')}
      </span>

      {!selectMode && (
        <button
          className="shrink-0 w-10 h-11 -mr-2 flex items-center justify-center text-text-muted active:text-accent"
          onClick={(e) => { e.stopPropagation(); onMenu(song, e) }}
          aria-label="More options"
        >
          <MoreVertical size={18} />
        </button>
      )}
    </div>
  )
})
// Memoized so toggling one selection only re-renders that row, not every
// rendered row. This depends on the callbacks passed in being stable
// (useCallback) - otherwise the default shallow prop compare never matches and
// the memo is a no-op.

// ─── Song row (detailed mode) ─────────────────────────────────────────────────
function DetailField({ label, value }: { label: string; value: string | null | undefined }): JSX.Element {
  const v = value?.trim() || ''
  return (
    <div className="min-w-0">
      <p className="text-[0.5625rem] uppercase tracking-wider text-text-muted/70 leading-tight truncate">{label}</p>
      <p className={`text-[11px] truncate ${v ? 'text-text-secondary' : 'text-text-muted/50'}`}>{v || '—'}</p>
    </div>
  )
}

// Detailed rows trade density for the metadata that otherwise only lives in
// SongInfoModal. The field set is fixed (empty cells render "—") so every row
// is the same height, which is what the virtual window's fixed stride needs.
const DetailedSongRow = memo(function DetailedSongRow({
  song, onPlay, onMenu, selectMode, selected, onToggleSelect, playingId, isPlaying,
}: RowProps): JSX.Element {
  const pref = useStore((s) => s.songPrefs[song.id])
  const fullEraNames = useStore((s) => s.fullEraNames)
  const track = songToTrack(song)
  const title = pref?.name || song.name
  const canPlay = !!song.path
  const isCurrent = playingId === `jw-${song.id}`

  const press = useLongPress({
    onTap: () => { if (selectMode) onToggleSelect(song); else if (canPlay) onPlay(song) },
    onLongPress: () => onToggleSelect(song),
  })

  return (
    <div
      className={`flex flex-col gap-2 mx-3 px-3 py-2.5 h-full overflow-hidden rounded-2xl border transition-colors ${
        selected ? 'bg-accent/15 border-accent' : 'border-[var(--border)] active:bg-surface-overlay'
      }`}
      {...press}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="relative shrink-0 w-12 h-12 rounded-xl overflow-hidden bg-surface-overlay">
          <AlbumArtThumbnail track={track} size={48} shimmer={false} eager />
          {selectMode && <ArtSelectOverlay selected={selected} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-[15px] leading-snug truncate ${isCurrent ? 'text-accent font-semibold' : 'text-text-primary'}`}>{title}</p>
          <p className="text-text-muted text-xs truncate mt-0.5">{songSubtitle(song, fullEraNames)}</p>
        </div>
        {isCurrent && <EqBars paused={!isPlaying} />}
        <span className="text-text-muted text-[11px] tabular-nums shrink-0">{formatDuration(parseDuration(song.length), '--:--')}</span>
        {!selectMode && (
          <button
            className="shrink-0 w-9 h-10 -mr-1.5 flex items-center justify-center text-text-muted active:text-accent"
            onClick={(e) => { e.stopPropagation(); onMenu(song, e) }}
            aria-label="More options"
          >
            <MoreVertical size={18} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <DetailField label="Producers" value={song.producers} />
        <DetailField label="Engineers" value={song.engineers} />
        <DetailField label="Record Dates" value={song.record_dates} />
        <DetailField label="Leak Type" value={song.leak_type} />
        <DetailField label="Bitrate" value={song.bitrate} />
        <DetailField label="Original Name" value={song.original_key} />
      </div>
    </div>
  )
})

// ─── Song card (grid mode) ────────────────────────────────────────────────────
// Two-up cover-led cards. The desktop card carried seven collapsible metadata
// sections inline; at half a phone's width those were unreadable, so the full
// field set lives in Detailed view and Song info instead - nothing is lost from
// the app, just from this one widget.
const SongCard = memo(function SongCard({
  song, coverH, onPlay, onMenu, selectMode, selected, onToggleSelect, playingId, isPlaying,
}: RowProps & { coverH: number }): JSX.Element {
  const pref = useStore((s) => s.songPrefs[song.id])
  const fullEraNames = useStore((s) => s.fullEraNames)
  const track = songToTrack(song)
  const title = pref?.name || song.name
  const canPlay = !!song.path
  const isCurrent = playingId === `jw-${song.id}`

  const press = useLongPress({
    onTap: () => { if (selectMode) onToggleSelect(song); else if (canPlay) onPlay(song) },
    onLongPress: () => onToggleSelect(song),
  })

  return (
    <div
      className={`flex flex-col h-full overflow-hidden rounded-2xl transition-colors ${
        selected ? 'bg-accent/15 ring-2 ring-accent' : 'bg-surface-raised active:bg-surface-overlay'
      }`}
      {...press}
    >
      <div className="relative w-full bg-surface-overlay shrink-0" style={{ height: coverH }}>
        <AlbumArtThumbnail track={track} fill className="w-full h-full object-cover" shimmer={false} eager />
        {selectMode && (
          <div className="absolute top-1.5 left-1.5">
            {selected
              ? <CheckCircle2 size={22} className="text-accent drop-shadow" />
              : <Circle size={22} className="text-white/80 drop-shadow" />}
          </div>
        )}
        <span className={`absolute top-1.5 right-1.5 text-[0.625rem] font-medium px-2 py-0.5 rounded-full border backdrop-blur-sm ${CATEGORY_COLORS[song.category] ?? 'text-text-muted bg-surface border-[var(--border)]'}`}>
          {CATEGORY_LABELS[song.category] ?? song.category}
        </span>
        {isCurrent && (
          <span className="absolute bottom-1.5 left-1.5 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center">
            <EqBars paused={!isPlaying} />
          </span>
        )}
      </div>

      <div className="flex items-start gap-0.5 pl-2.5 pr-0.5 py-2 min-w-0">
        <div className="flex-1 min-w-0">
          <p className={`text-[13px] font-medium leading-tight truncate ${isCurrent ? 'text-accent' : 'text-text-primary'}`}>{title}</p>
          <p className="text-text-muted text-[11px] truncate mt-0.5">{song.credited_artists || 'Juice WRLD'}</p>
          <p className="text-text-muted text-[11px] truncate mt-0.5 tabular-nums">
            {formatDuration(parseDuration(song.length), '--:--')}{song.era?.name ? ` · ${eraLabel(song.era.name, fullEraNames)}` : ''}
          </p>
        </div>
        {!selectMode && (
          <button
            className="shrink-0 w-9 h-9 flex items-center justify-center text-text-muted active:text-accent"
            onClick={(e) => { e.stopPropagation(); onMenu(song, e) }}
            aria-label="More options"
          >
            <MoreVertical size={16} />
          </button>
        )}
      </div>
    </div>
  )
})

// ─── Compact group header row ─────────────────────────────────────────────────
// Local to the Tracker rather than the shared CompactGroupRow, which Playlists
// still renders with the desktop column widths.
const GroupRow = memo(function GroupRow({
  group, expanded, onToggle, onLongPress,
}: {
  group: CompactGroup<JWApiSong>
  expanded: boolean
  onToggle: () => void
  onLongPress: () => void
}): JSX.Element {
  const cat = groupCategory(group.members)
  const press = useLongPress({ onTap: onToggle, onLongPress })
  return (
    <div className="flex items-center gap-3 px-4 py-1.5 h-full rounded-2xl active:bg-surface-overlay transition-colors" {...press}>
      <div className="relative shrink-0 w-12 h-12 rounded-xl overflow-hidden bg-surface-overlay">
        <AlbumArtThumbnail track={songToTrack(group.members[0].item)} size={48} shimmer={false} eager />
        <span className="absolute inset-x-0 bottom-0 h-4 bg-black/55 flex items-center justify-center">
          <Layers size={10} className="text-white" />
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-text-primary text-[15px] leading-snug truncate">{group.title}</p>
        <p className="text-text-muted text-xs truncate mt-0.5 flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${CATEGORY_DOTS[cat] ?? 'bg-text-muted'}`} />
          {CATEGORY_LABELS[cat] ?? cat} · {group.members.length} version{group.members.length === 1 ? '' : 's'}
        </p>
      </div>
      <ChevronDown size={18} className={`text-text-muted shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
    </div>
  )
}, (prev, next) =>
  // Compare by value: callers pass inline closures every render, and those
  // capture only stable setters plus this group's own id.
  prev.group === next.group && prev.expanded === next.expanded
)

// ─── Lyric result row ─────────────────────────────────────────────────────────
const LyricResultRow = memo(function LyricResultRow({
  song, query, onPlay, onMenu, selectMode, selected, onToggleSelect,
}: {
  song: JWApiSong
  query: string
  onPlay: (song: JWApiSong) => void
  onMenu: (song: JWApiSong, e: React.MouseEvent) => void
  selectMode: boolean
  selected: boolean
  onToggleSelect: (song: JWApiSong) => void
}): JSX.Element {
  const pref = useStore((s) => s.songPrefs[song.id])
  const fullEraNames = useStore((s) => s.fullEraNames)
  const track = songToTrack(song)
  const title = pref?.name || song.name
  const canPlay = !!song.path
  const snippet = useMemo(() => getLyricSnippet(song.lyrics, query), [song.lyrics, query])

  const press = useLongPress({
    onTap: () => { if (selectMode) onToggleSelect(song); else if (canPlay) onPlay(song) },
    onLongPress: () => onToggleSelect(song),
  })

  return (
    <div
      className={`flex items-start gap-3 px-4 py-2.5 rounded-2xl transition-colors ${
        selected ? 'bg-accent/15' : 'active:bg-surface-overlay'
      }`}
      {...press}
    >
      <div className="relative shrink-0 w-12 h-12 rounded-xl overflow-hidden bg-surface-overlay">
        <AlbumArtThumbnail track={track} size={48} shimmer={false} eager />
        {selectMode && <ArtSelectOverlay selected={selected} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-text-primary text-[15px] leading-snug truncate">{title}</p>
        <p className="text-text-muted text-xs truncate mt-0.5">{songSubtitle(song, fullEraNames)}</p>
        {snippet ? (
          <p className="mt-1.5 text-xs text-text-secondary italic leading-relaxed line-clamp-2">
            {snippet.before}
            <mark className="bg-accent/20 text-accent not-italic rounded px-0.5">{snippet.match}</mark>
            {snippet.after}
          </p>
        ) : (
          <p className="mt-1.5 text-xs text-text-muted italic">Lyric preview unavailable</p>
        )}
      </div>
      {!selectMode && (
        <button
          className="shrink-0 w-10 h-10 -mr-2 flex items-center justify-center text-text-muted active:text-accent"
          onClick={(e) => { e.stopPropagation(); onMenu(song, e) }}
          aria-label="More options"
        >
          <MoreVertical size={18} />
        </button>
      )}
    </div>
  )
})

// ─── Virtualized lists ────────────────────────────────────────────────────────
// Rows are absolutely positioned at a fixed pixel stride so the window can place
// them without measuring the DOM - but their contents are rem-sized, so
// Settings → App text size grows the text inside a box that would otherwise stay
// put, and the spilled text ends up clipped and unreachable. Scaling the stride
// by the same factor keeps box and contents in step.
function useScaledRowH(base: number): number {
  const appTextScale = useStore((s) => s.appTextScale)
  return Math.round(base * appTextScale)
}

const LIST_ROW_H = 64
const DETAIL_ROW_H = 168
const ROW_GAP = 2

interface VirtualProps {
  scrollRef: React.RefObject<HTMLDivElement>
  songs: JWApiSong[]
  onPlay: (song: JWApiSong) => void
  onMenu: (song: JWApiSong, e: React.MouseEvent) => void
  selectMode: boolean
  selected: Map<number, JWApiSong>
  onToggleSelect: (song: JWApiSong) => void
  playingId: string | null
  isPlaying: boolean
}

function VirtualSongList({ scrollRef, songs, selected, ...rest }: VirtualProps): JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null)
  const rowH = useScaledRowH(LIST_ROW_H)
  const stride = rowH + ROW_GAP
  const { start, end, totalHeight } = useVirtualWindow(scrollRef, contentRef, songs.length, stride)
  return (
    <div ref={contentRef} style={{ height: totalHeight, position: 'relative' }}>
      {songs.slice(start, end).map((song, i) => (
        <div key={song.id} style={{ position: 'absolute', top: (start + i) * stride, left: 0, right: 0, height: rowH }}>
          <SongRow song={song} selected={selected.has(song.id)} {...rest} />
        </div>
      ))}
    </div>
  )
}

function VirtualSongDetailList({ scrollRef, songs, selected, ...rest }: VirtualProps): JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null)
  const rowH = useScaledRowH(DETAIL_ROW_H)
  const stride = rowH + 8
  const { start, end, totalHeight } = useVirtualWindow(scrollRef, contentRef, songs.length, stride)
  return (
    <div ref={contentRef} style={{ height: totalHeight, position: 'relative' }}>
      {songs.slice(start, end).map((song, i) => (
        <div key={song.id} style={{ position: 'absolute', top: (start + i) * stride, left: 0, right: 0, height: rowH }}>
          <DetailedSongRow song={song} selected={selected.has(song.id)} {...rest} />
        </div>
      ))}
    </div>
  )
}

const GRID_GAP = 12
const GRID_PAD = 16
/** Cover is square; the body underneath is a fixed three-line block. */
const GRID_BODY_H = 62

function VirtualSongGrid({ scrollRef, songs, selected, ...rest }: VirtualProps): JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const measure = (): void => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const bodyH = useScaledRowH(GRID_BODY_H)
  // Two up on a phone, three once there's room (a folded/landscape device).
  const cols = width >= 560 ? 3 : 2
  const cellW = width > 0 ? Math.floor((width - GRID_GAP * (cols - 1)) / cols) : 0
  const coverH = cellW
  const cardH = coverH + bodyH
  const stride = cardH + GRID_GAP
  const rowCount = Math.ceil(songs.length / cols)
  const { start, end, totalHeight } = useVirtualWindow(scrollRef, contentRef, rowCount, stride)

  return (
    <div ref={contentRef} style={{ height: totalHeight, position: 'relative' }}>
      {width > 0 && Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i).map((r) =>
        songs.slice(r * cols, r * cols + cols).map((song, c) => (
          <div
            key={song.id}
            style={{ position: 'absolute', top: r * stride, left: c * (cellW + GRID_GAP), width: cellW, height: cardH }}
          >
            <SongCard song={song} coverH={coverH} selected={selected.has(song.id)} {...rest} />
          </div>
        ))
      )}
    </div>
  )
}

// Compact view flattens groups and their expanded members into one fixed-stride
// row list, so a 1200-group catalog only ever mounts the visible slice.
type CompactListRow =
  | { key: string; kind: 'group'; group: CompactGroup<JWApiSong> }
  | { key: string; kind: 'member'; item: JWApiSong; version: string | null; isLast: boolean }

function CompactGroupList({
  scrollRef, groups, expanded, onToggleGroup, onGroupLongPress, selected, ...rest
}: Omit<VirtualProps, 'songs'> & {
  groups: CompactGroup<JWApiSong>[]
  expanded: Set<number>
  onToggleGroup: (group: CompactGroup<JWApiSong>) => void
  onGroupLongPress: (group: CompactGroup<JWApiSong>) => void
}): JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null)
  const rowH = useScaledRowH(LIST_ROW_H)
  const stride = rowH + ROW_GAP

  const rows = useMemo(() => {
    const out: CompactListRow[] = []
    for (const group of groups) {
      out.push({ key: `g${group.groupId}`, kind: 'group', group })
      if (expanded.has(group.groupId)) {
        group.members.forEach((m, i) => out.push({
          key: `g${group.groupId}-s${m.item.id}`, kind: 'member',
          item: m.item, version: m.meta.version, isLast: i === group.members.length - 1,
        }))
      }
    }
    return out
  }, [groups, expanded])

  const { start, end, totalHeight } = useVirtualWindow(scrollRef, contentRef, rows.length, stride)

  return (
    <div ref={contentRef} style={{ height: totalHeight, position: 'relative' }}>
      {rows.slice(start, end).map((row, i) => {
        const top = (start + i) * stride
        if (row.kind === 'group') {
          return (
            <div key={row.key} style={{ position: 'absolute', top, left: 0, right: 0, height: rowH }}>
              <GroupRow
                group={row.group}
                expanded={expanded.has(row.group.groupId)}
                onToggle={() => onToggleGroup(row.group)}
                onLongPress={() => onGroupLongPress(row.group)}
              />
            </div>
          )
        }
        return (
          <div
            key={row.key}
            className="ml-5 pl-3 border-l border-[var(--border)]"
            // Non-last member wrappers span the full stride so the indent rail
            // stays continuous across the row gap.
            style={{ position: 'absolute', top, left: 0, right: 0, height: row.isLast ? rowH : stride }}
          >
            <SongRow song={row.item} versionLabel={row.version} selected={selected.has(row.item.id)} {...rest} />
          </div>
        )
      })}
    </div>
  )
}

// ─── Version title prompt ─────────────────────────────────────────────────────
function VersionTitlePromptModal({ saving, onSave, onSkip }: {
  saving: boolean
  onSave: (title: string) => void
  onSkip: () => void
}): JSX.Element {
  const [value, setValue] = useState('')
  useBackToClose(onSkip)
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60" onClick={(e) => { if (e.target === e.currentTarget) onSkip() }}>
      <div
        className="bg-surface rounded-t-[22px] border-t border-[var(--border)] shadow-2xl w-full px-5 pt-5"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }}
      >
        <h3 className="text-text-primary text-base font-semibold mb-1">Name this version group</h3>
        <p className="text-text-muted text-xs mb-4">
          These songs are now linked as versions of each other, but the group has no title yet (e.g. "TV Mix", "Alternate").
        </p>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && value.trim() && !saving) onSave(value.trim()) }}
          placeholder="Version title"
          className="w-full h-12 bg-surface-overlay rounded-xl px-4 text-[15px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent mb-4"
        />
        <div className="flex gap-2">
          <button onClick={onSkip} disabled={saving} className="flex-1 h-12 rounded-full bg-surface-overlay text-text-primary text-[15px] font-semibold disabled:opacity-50">
            Skip
          </button>
          <button
            onClick={() => value.trim() && onSave(value.trim())}
            disabled={!value.trim() || saving}
            className="flex-1 h-12 flex items-center justify-center gap-2 rounded-full bg-accent text-white text-[15px] font-semibold disabled:opacity-50"
          >
            {saving && <Loader2 size={15} className="animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────
export default function ApiTrackerView(): JSX.Element {
  const {
    playTrack, startRadio, addToQueue, account, shuffle,
    apiTrackerCategory, setApiTrackerCategory,
    apiTrackerEra, setApiTrackerEra,
    apiTrackerTab, setApiTrackerTab,
    setActiveView, setApiFilesPath, setPendingEditorSongId,
    playlists, refreshPlaylists, setShowUserAuth, likedTrackIds, toggleLike,
    openBulkEditor, currentTrack, isPlaying, fullEraNames,
  } = useStore(useShallow(s => ({
    playTrack: s.playTrack, startRadio: s.startRadio, addToQueue: s.addToQueue,
    account: s.account, shuffle: s.shuffle,
    apiTrackerCategory: s.apiTrackerCategory, setApiTrackerCategory: s.setApiTrackerCategory,
    apiTrackerEra: s.apiTrackerEra, setApiTrackerEra: s.setApiTrackerEra,
    apiTrackerTab: s.apiTrackerTab, setApiTrackerTab: s.setApiTrackerTab,
    setActiveView: s.setActiveView, setApiFilesPath: s.setApiFilesPath,
    setPendingEditorSongId: s.setPendingEditorSongId,
    playlists: s.playlists, refreshPlaylists: s.refreshPlaylists, setShowUserAuth: s.setShowUserAuth,
    likedTrackIds: s.likedTrackIds, toggleLike: s.toggleLike,
    openBulkEditor: s.openBulkEditor,
    currentTrack: s.currentTrack, isPlaying: s.isPlaying,
    fullEraNames: s.fullEraNames,
  })))

  const canEdit = useCanEdit()
  const playingId = currentTrack?.id ?? null

  // Full era names aren't in the offline cache seed for every session - fetch
  // once so eraLabel() has something to show once the user opts in.
  useEffect(() => { loadEraFullNames().catch(() => {}) }, [])

  const [trackerTab, setTrackerTab] = useState<TrackerTab>(
    () => (isTrackerTab(apiTrackerTab) ? apiTrackerTab : 'songs'),
  )
  // Deep link is one-shot - consumed into the initial state above, so it must
  // not linger and re-apply on a later render (e.g. after switching tabs by
  // hand and coming back to this view).
  useEffect(() => { if (apiTrackerTab) setApiTrackerTab('') }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [sheet, setSheet] = useState<SheetKind>(null)
  const [bulkSheetPage, setBulkSheetPage] = useState<'main' | 'playlists'>('main')

  const [selectedSong, setSelectedSong] = useState<JWApiSong | null>(null)
  const [contextMenu, setContextMenu] = useState<{ song: JWApiSong; x: number; y: number } | null>(null)

  // Multi-select
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Map<number, JWApiSong>>(new Map())
  const [bulkZipStatus, setBulkZipStatus] = useState<'idle' | 'zipping' | 'done' | 'partial' | 'none' | 'error'>('idle')
  const [bulkZipSkipped, setBulkZipSkipped] = useState(0)
  const [bulkLinkStatus, setBulkLinkStatus] = useState<'idle' | 'linking' | 'done' | 'error'>('idle')
  // Shown after a link completes if the resulting group still has no
  // version_title - untitled groups are functionally useless in compact view.
  const [titlePromptGroupId, setTitlePromptGroupId] = useState<number | null>(null)
  const [savingTitlePrompt, setSavingTitlePrompt] = useState(false)

  // useCallback so the row memos aren't defeated - a fresh identity here would
  // re-render every row on each selection toggle (functional setState keeps it
  // dependency-free and stable).
  const toggleSelect = useCallback((song: JWApiSong): void => {
    setSelectMode(true)
    setSelected(prev => {
      const next = new Map(prev)
      if (next.has(song.id)) next.delete(song.id)
      else next.set(song.id, song)
      return next
    })
  }, [])

  const exitSelectMode = useCallback((): void => {
    setSelectMode(false)
    setSelected(new Map())
    setBulkZipStatus('idle')
    setBulkZipSkipped(0)
  }, [])

  // Deselecting the last song turns select mode back off on its own.
  useEffect(() => {
    if (selectMode && selected.size === 0) setSelectMode(false)
  }, [selectMode, selected])

  // Compact view - shows only songs grouped into a titled version group,
  // collapsed to one row per group. Fetched independently of the paginated
  // `songs` list (see fetchAllCompactGroups).
  const [compactView, setCompactViewState] = useState(() => localStorage.getItem(LS_TRACKER_COMPACT) === 'true')
  const setCompactView = (v: boolean): void => {
    setCompactViewState(v)
    localStorage.setItem(LS_TRACKER_COMPACT, String(v))
  }
  const [compactGroups, setCompactGroups] = useState<CompactGroup<JWApiSong>[]>([])
  const [loadingCompact, setLoadingCompact] = useState(false)
  const { expanded: expandedGroups, toggle: toggleGroupExpanded, clear: clearExpandedGroups } = useExpandedGroups()

  // Breadcrumb the toggle: if a freeze ever lands here again, previous-run.log
  // will name the exact group.
  const handleToggleGroup = useCallback((group: CompactGroup<JWApiSong>): void => {
    runLog('compact', `toggle group=${group.groupId} "${group.title}" members=${group.members.length}`)
    toggleGroupExpanded(group.groupId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Compact view renders far less content than the underlying song list, so the
  // sentinel stays permanently visible and would otherwise auto-page through the
  // entire library in the background - pause that while active.
  const compactViewRef = useRef(false)
  useEffect(() => { compactViewRef.current = compactView }, [compactView])

  const [compactReloadToken, setCompactReloadToken] = useState(0)

  useEffect(() => {
    if (!compactView || !versionsEnabled) { setCompactGroups([]); return }
    let cancelled = false
    setLoadingCompact(true)
    fetchAllCompactGroups().then(groups => {
      if (cancelled) return
      runLog('compact', `loaded ${groups.length} groups (${groups.reduce((n, g) => n + g.members.length, 0)} members)`)
      setCompactGroups(groups)
      setLoadingCompact(false)
    }).catch(e => {
      if (cancelled) return
      runLog('compact', 'ERROR loading groups', e as Error)
      setCompactGroups([])
      setLoadingCompact(false)
    })
    return () => { cancelled = true }
  }, [compactView, compactReloadToken])

  useEffect(() => subscribeCompactGroupsInvalidation(() => {
    if (compactViewRef.current) setCompactReloadToken(t => t + 1)
  }), [])

  // Stale-while-revalidate: seed from the offline cache synchronously so the
  // list renders instantly on open, then the effects below refetch and replace
  // it. The seeded first page must use the exact same params as the initial
  // scroll-mode fetch or the cache key won't match.
  const seedRef = useRef<JWApiPaginatedResponse | undefined>(undefined)
  const seededRef = useRef(false)
  if (!seededRef.current) {
    seededRef.current = true
    const initialSearch = parseSearchQuery(getInitialSearch()).freeText
    seedRef.current = apiPeek<JWApiPaginatedResponse>('/songs/', {
      searchall: initialSearch || undefined, category: undefined, era: undefined,
      page: 1, page_size: PAGE_SIZE,
    })
  }
  const cachedFirstPage = seedRef.current
  const [stats, setStats] = useState<JWApiStats | null>(() => apiPeek<JWApiStats>('/stats/') ?? null)
  const [eras, setEras] = useState<JWApiEra[]>(() => {
    const c = apiPeek<JWApiEra[] | { results: JWApiEra[] }>('/eras/')
    return c ? (Array.isArray(c) ? c : c.results ?? []) : []
  })
  const [songs, setSongs] = useState<JWApiSong[]>(() => cachedFirstPage?.results ?? [])
  const [count, setCount] = useState(() => cachedFirstPage?.count ?? 0)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(() => cachedFirstPage ? cachedFirstPage.next !== null : false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const sentinelRef = useRef<HTMLDivElement>(null)
  const listScrollRef = useRef<HTMLDivElement>(null)
  // Refs for scroll logic - avoids stale closures in the observer callback.
  const hasMoreRef = useRef(false)
  const loadingRef = useRef(true)
  const sentinelVisibleRef = useRef(false)

  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    const stored = localStorage.getItem(LS_TRACKER_VIEW)
    return stored === 'detail' || stored === 'grid' ? stored : 'list'
  })
  const setViewMode = (v: ViewMode): void => { setViewModeState(v); localStorage.setItem(LS_TRACKER_VIEW, v) }

  const [orderField, setOrderField] = useState<OrderField | null>(null)
  const [orderDir, setOrderDir] = useState<'asc' | 'desc'>('asc')
  // Whether any column is driving sort mode - the fetched song set depends only
  // on this and the search/category/era filters, not on *which* field it'll be
  // sorted by (that's applied client-side).
  const sortModeActive = orderField !== null

  const resetSongs = useCallback((): void => {
    setSongs([])
    setPage(1)
    // Clear pagination state NOW, not when the new page-1 fetch lands: emptying
    // the list scrolls the sentinel into view and its observer fires in the gap
    // before the fetch effect runs, which would bump the page and request one
    // the narrower result set doesn't have (the API 404s "Invalid page").
    setHasMore(false)
    hasMoreRef.current = false
    loadingRef.current = true
  }, [])

  const [search, setSearch] = useState(getInitialSearch)
  const [debouncedSearch, setDebouncedSearch] = useState(getInitialSearch)
  // Sets rather than single values so more than one category/era can be active
  // at once (OR'd within each dimension, AND'd across them). The API accepts one
  // `category`/`era` per request, so anything beyond a single selection in
  // either falls back to fetching everything and filtering client-side.
  const [categoryFilter, setCategoryFilter] = useState<Set<Category>>(new Set())
  const [eraFilter, setEraFilter] = useState<Set<string>>(new Set())
  const multiFilterActive = categoryFilter.size > 1 || eraFilter.size > 1
  const categoryParam: Category = categoryFilter.size === 1 ? [...categoryFilter][0] : ''
  const eraParam = eraFilter.size === 1 ? [...eraFilter][0] : ''
  const filterCount = categoryFilter.size + eraFilter.size

  const toggleCategoryFilter = useCallback((cat: Category) => {
    setCategoryFilter(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }, [])
  const toggleEraFilter = useCallback((eraName: string) => {
    setEraFilter(prev => {
      const next = new Set(prev)
      if (next.has(eraName)) next.delete(eraName)
      else next.add(eraName)
      return next
    })
  }, [])
  const matchesFilters = useCallback((song: JWApiSong): boolean => {
    if (categoryFilter.size > 0 && !categoryFilter.has(song.category as Category)) return false
    if (eraFilter.size > 0 && !(song.era && eraFilter.has(song.era.name))) return false
    return true
  }, [categoryFilter, eraFilter])

  // `field:"value"` search syntax (e.g. `artists:"Juice WRLD"`) has no
  // server-side equivalent - the API's `searchall` is a single plain-text
  // param - so a query using it forces fetch-all mode (below) and gets
  // filtered here instead of trusting the server to have applied it.
  const parsedSearch = useMemo(() => parseSearchQuery(debouncedSearch), [debouncedSearch])
  const advancedSearchActive = parsedSearch.filters.length > 0
  const matchesSearch = useCallback((song: JWApiSong): boolean =>
    matchesFieldFilters(song, parsedSearch.filters), [parsedSearch])

  useEffect(() => {
    if (apiTrackerCategory) { setCategoryFilter(new Set([apiTrackerCategory as Category])); setApiTrackerCategory('') }
    if (apiTrackerEra) { setEraFilter(new Set([apiTrackerEra])); setApiTrackerEra('') }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Lyric search (separate tab) ───────────────────────────────────────────
  const [lyricsQuery, setLyricsQuery] = useState('')
  const [debouncedLyricsQuery, setDebouncedLyricsQuery] = useState('')
  const [lyricsResults, setLyricsResults] = useState<JWApiSong[]>([])
  const [lyricsPage, setLyricsPage] = useState(1)
  const [lyricsCount, setLyricsCount] = useState(0)
  const [lyricsHasMore, setLyricsHasMore] = useState(false)
  const [lyricsLoading, setLyricsLoading] = useState(false)
  const [lyricsError, setLyricsError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedLyricsQuery(lyricsQuery), 400)
    return () => clearTimeout(t)
  }, [lyricsQuery])

  useEffect(() => {
    if (!debouncedLyricsQuery.trim()) {
      setLyricsResults([]); setLyricsCount(0); setLyricsHasMore(false); setLyricsError(null)
      return
    }
    let cancelled = false
    setLyricsLoading(true); setLyricsError(null)
    apiFetch<JWApiPaginatedResponse>('/songs/', { lyrics: debouncedLyricsQuery, page: 1, page_size: PAGE_SIZE })
      .then((data) => {
        if (cancelled) return
        setLyricsResults(data.results)
        setLyricsCount(data.count)
        setLyricsHasMore(data.next !== null)
        setLyricsPage(1)
      })
      .catch((err) => { if (!cancelled) setLyricsError(err.message) })
      .finally(() => { if (!cancelled) setLyricsLoading(false) })
    return () => { cancelled = true }
  }, [debouncedLyricsQuery])

  const loadMoreLyrics = (): void => {
    if (lyricsLoading || !lyricsHasMore) return
    const nextPage = lyricsPage + 1
    setLyricsLoading(true)
    apiFetch<JWApiPaginatedResponse>('/songs/', { lyrics: debouncedLyricsQuery, page: nextPage, page_size: PAGE_SIZE })
      .then((data) => {
        setLyricsResults((prev) => [...prev, ...data.results])
        setLyricsHasMore(data.next !== null)
        setLyricsPage(nextPage)
      })
      .catch((err) => setLyricsError(err.message))
      .finally(() => setLyricsLoading(false))
  }

  // ── Calendar / credits (separate tabs) ────────────────────────────────────
  // Fetches the whole catalog once (lazily, on first visit) since there's no
  // server-side way to filter or group by record_dates - it's parsed out of
  // free text client-side.
  const [calendarSongs, setCalendarSongs] = useState<JWApiSong[]>([])
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [calendarError, setCalendarError] = useState<string | null>(null)
  const calendarFetchedRef = useRef(false)

  useEffect(() => {
    if ((trackerTab !== 'calendar' && trackerTab !== 'producers') || calendarFetchedRef.current) return
    calendarFetchedRef.current = true
    setCalendarLoading(true)
    apiFetch<JWApiSong[]>('/songs/', { all: 'true' })
      .then(setCalendarSongs)
      .catch((err) => setCalendarError(err.message))
      .finally(() => setCalendarLoading(false))
  }, [trackerTab])

  const calendarByDate = useMemo(() => {
    const map = new Map<string, JWApiSong[]>()
    for (const song of calendarSongs) {
      for (const key of extractDateKeys(song.record_dates)) {
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push(song)
      }
    }
    return map
  }, [calendarSongs])

  // `recording_locations` is also free text (e.g. "Record One Studios, Los
  // Angeles") - grouped by the exact trimmed string, since there's no reliable
  // delimiter between studio name and city.
  const calendarByStudio = useMemo(() => {
    const map = new Map<string, JWApiSong[]>()
    for (const song of calendarSongs) {
      const loc = song.recording_locations?.trim()
      if (!loc) continue
      if (!map.has(loc)) map.set(loc, [])
      map.get(loc)!.push(song)
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [calendarSongs])

  // `producers`/`engineers` are free text, often several names separated by
  // commas - split so each person gets an entry instead of grouping by the
  // combined string. Kept as two groupings so a name in both credits still
  // appears under each.
  const groupByNameField = (list: JWApiSong[], field: (s: JWApiSong) => string | null | undefined): [string, JWApiSong[]][] => {
    const map = new Map<string, JWApiSong[]>()
    for (const song of list) {
      const raw = field(song)
      if (!raw) continue
      for (const part of raw.split(',')) {
        const name = part.trim()
        if (!name) continue
        if (!map.has(name)) map.set(name, [])
        map.get(name)!.push(song)
      }
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
  }

  const producersByName = useMemo(() => groupByNameField(calendarSongs, (s) => s.producers), [calendarSongs])
  const engineersByName = useMemo(() => groupByNameField(calendarSongs, (s) => s.engineers), [calendarSongs])

  const eraColorMap = useMemo(() => {
    const map = new Map<string, EraColor>()
    eras.forEach((era, i) => map.set(era.name, ERA_COLOR_PALETTE[i % ERA_COLOR_PALETTE.length]))
    return map
  }, [eras])

  const [calendarMonth, setCalendarMonth] = useState<{ year: number; month: number }>(() => {
    const saved = localStorage.getItem(LS_TRACKER_CALENDAR_MONTH)
    if (saved) {
      const [y, m] = saved.split('-').map(Number)
      if (Number.isFinite(y) && Number.isFinite(m)) return { year: y, month: m }
    }
    return { year: 2018, month: 4 }
  })

  useEffect(() => {
    localStorage.setItem(LS_TRACKER_CALENDAR_MONTH, `${calendarMonth.year}-${calendarMonth.month}`)
  }, [calendarMonth])

  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null)
  // Studios/producers/engineers drill down into their own screen rather than
  // living in a side column there's no room for.
  const [detail, setDetail] = useState<{ kind: 'studio' | 'producer' | 'engineer'; name: string } | null>(null)

  const detailSongs = useMemo(() => {
    if (!detail) return []
    const source = detail.kind === 'studio' ? calendarByStudio
      : detail.kind === 'producer' ? producersByName
      : engineersByName
    return source.find(([name]) => name === detail.name)?.[1] ?? []
  }, [detail, calendarByStudio, producersByName, engineersByName])

  const shiftCalendarMonth = (delta: number): void => {
    setCalendarMonth((prev) => {
      let month = prev.month + delta
      let year = prev.year
      if (month < 0) { month = 11; year -= 1 }
      if (month > 11) { month = 0; year += 1 }
      return { year, month }
    })
  }

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstDebounce = useRef(true)

  useEffect(() => { localStorage.setItem(LS_TRACKER_SEARCH, search) }, [search])

  // Reflect each settled search in the URL (?q=...) so back steps through
  // previous searches instead of leaving the page.
  const isFirstUrlSync = useRef(true)
  useEffect(() => {
    if (window.location.protocol === 'file:') return
    if (isFirstUrlSync.current) { isFirstUrlSync.current = false; return }
    const url = new URL(window.location.href)
    if (debouncedSearch) url.searchParams.set('q', debouncedSearch)
    else url.searchParams.delete('q')
    window.history.pushState({}, '', url)
  }, [debouncedSearch])

  useEffect(() => {
    if (window.location.protocol === 'file:') return
    const onPopState = (): void => {
      const q = new URLSearchParams(window.location.search).get('q') || ''
      isFirstUrlSync.current = true // this sync came from the URL - don't push it again
      setSearch(q)
      setDebouncedSearch(q)
      resetSongs()
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [resetSongs])

  useEffect(() => {
    apiFetch<JWApiStats>('/stats/').then(setStats).catch(console.error)
    apiFetch<JWApiEra[] | { results: JWApiEra[] }>('/eras/')
      .then((data) => setEras(Array.isArray(data) ? data : (data as { results: JWApiEra[] }).results ?? []))
      .catch(console.error)
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search)
      // Skip resetSongs on mount - only reset when the user actually types.
      if (isFirstDebounce.current) { isFirstDebounce.current = false; return }
      // Settled back to the query already showing: no dep changes, so nothing
      // would refetch - a reset here would just blank the list.
      if (search === debouncedSearch) return
      resetSongs()
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search, debouncedSearch, resetSongs])

  // ── FETCH-ALL MODE ────────────────────────────────────────────────────────
  // The API has no ordering param and accepts one category/era per request, so
  // both "sort" and "2+ categories/eras selected" fall back to fetching every
  // matching page up front. category/era are still sent server-side when
  // exactly one value is selected, to shrink the payload.
  // Sorting doesn't drag the flat list's catalog down while compact view is
  // showing: compact view fetches its own groups and sorts them client-side, so
  // a sort chosen there would otherwise kick off a full-catalog download for a
  // list that isn't on screen. Switching back to a flat view flips this on and
  // the fetch runs then.
  const fetchAllMode = (sortModeActive && !compactView) || multiFilterActive || advancedSearchActive
  useEffect(() => {
    if (!fetchAllMode) return
    let cancelled = false
    loadingRef.current = true
    setLoading(true); setError(null); setSongs([]); setHasMore(false); setCount(0)
    const t0 = performance.now()
    runLog('tracker-sort', `start search=${JSON.stringify(debouncedSearch)} category=${categoryParam || '-'} era=${eraParam || '-'} multi=${multiFilterActive} advanced=${advancedSearchActive}`)
    const matchesAll = (s: JWApiSong): boolean => matchesFilters(s) && matchesSearch(s)
    // `all=true` returns the whole (filtered) catalogue as a plain array in
    // one request - server-side page_size is capped below what we'd need to
    // paginate reliably, so this avoids under-counting totalPages against it.
    ;(async () => {
      try {
        const all = await apiFetch<JWApiSong[]>('/songs/', {
          // field:value tokens are stripped out - parsedSearch.freeText is what's
          // left, which the server still searches; matchesSearch narrows further
          // by the field filters below.
          searchall: parsedSearch.freeText || undefined,
          category: categoryParam || undefined,
          era: eraParam || undefined,
          all: 'true',
        })
        if (cancelled) return
        const filtered = all.filter(matchesAll)
        setSongs(filtered)
        setCount(filtered.length)
        runLog('tracker-sort', `done ${all.length} songs in ${Math.round(performance.now() - t0)}ms`)
      } catch (e) {
        if (!cancelled) { setError((e as Error).message); runLog('tracker-sort', 'ERROR', e as Error) }
      } finally {
        if (!cancelled) { loadingRef.current = false; setLoading(false) }
      }
    })()
    return () => { cancelled = true }
  }, [fetchAllMode, debouncedSearch, parsedSearch, categoryParam, eraParam, matchesFilters, matchesSearch, advancedSearchActive, multiFilterActive])

  // ── SCROLL MODE: infinite scroll, accumulates pages ───────────────────────
  useEffect(() => {
    if (fetchAllMode) return
    let cancelled = false
    loadingRef.current = true
    setLoading(true); setError(null)
    apiFetch<JWApiPaginatedResponse>('/songs/', {
      searchall: parsedSearch.freeText || undefined,
      category: categoryParam || undefined,
      era: eraParam || undefined,
      page,
      page_size: PAGE_SIZE,
    })
      .then((data) => {
        if (!cancelled) {
          setSongs((prev) => page === 1 ? data.results : [...prev, ...data.results])
          setCount(data.count)
          const more = data.next !== null
          setHasMore(more)
          hasMoreRef.current = more
        }
      })
      .catch((err) => { if (!cancelled) setError(err.message) })
      .finally(() => {
        if (!cancelled) {
          loadingRef.current = false
          setLoading(false)
          if (sentinelVisibleRef.current && hasMoreRef.current && !compactViewRef.current) {
            setPage((p) => p + 1)
          }
        }
      })
    return () => { cancelled = true }
  }, [debouncedSearch, parsedSearch, categoryParam, eraParam, page, fetchAllMode])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => {
      sentinelVisibleRef.current = entry.isIntersecting
      if (entry.isIntersecting && hasMoreRef.current && !loadingRef.current && !compactViewRef.current) {
        setPage((p) => p + 1)
      }
    }, { threshold: 0.1 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Client-side sort over accumulated songs (sort mode only)
  const sortedSongs = useMemo(() => {
    if (!orderField) return songs
    return [...songs].sort((a, b) => {
      let av: string | number, bv: string | number
      switch (orderField) {
        case 'name':
          av = a.name.toLowerCase()
          bv = b.name.toLowerCase()
          break
        case 'credited_artists':
          av = (a.credited_artists || '').toLowerCase()
          bv = (b.credited_artists || '').toLowerCase()
          break
        case 'era__name':
          av = (a.era?.name || '').toLowerCase()
          bv = (b.era?.name || '').toLowerCase()
          break
        case 'category':
          av = a.category; bv = b.category
          break
        case 'length':
          av = parseDuration(a.length); bv = parseDuration(b.length)
          break
        default: return 0
      }
      const cmp = typeof av === 'number' ? av - (bv as number) : (av as string).localeCompare(bv as string)
      return orderDir === 'desc' ? -cmp : cmp
    })
  }, [songs, orderField, orderDir])

  // fetchAllCompactGroups is independent of the search box (it fetches every
  // group app-wide), so the query has to be applied client-side or typing while
  // compact view is active would do nothing. Mirrors as much of the normal
  // list's server-side `searchall` field coverage as it reasonably can.
  const filteredCompactGroups = useMemo(() => {
    let filtered = filterCompactGroups(compactGroups, parsedSearch.freeText, s => [
      s.track_titles?.join(' '), s.name, s.credited_artists, s.producers, s.engineers,
      s.era?.name, s.notes, s.additional_information, s.session_titles, s.original_key,
    ].filter(Boolean).join(' '))
    // Field-qualified tokens (artists:"...", etc.) aren't handled by
    // filterCompactGroups' plain free-text match - apply them here as an
    // extra member-level pass. A group survives if at least one version does.
    if (parsedSearch.filters.length > 0) {
      filtered = filtered
        .map(g => ({ ...g, members: g.members.filter(m => matchesFieldFilters(m.item, parsedSearch.filters)) }))
        .filter(g => g.members.length > 0)
    }
    // Category/era filters aren't sent server-side for compact view, so apply
    // them here. A group matches if any of its versions does.
    if (categoryFilter.size > 0 || eraFilter.size > 0) {
      filtered = filtered.filter(g => g.members.some(m => matchesFilters(m.item)))
    }
    if (!orderField) return filtered
    // Copy before sorting - filterCompactGroups may return the input array.
    const sorted = [...filtered]
    const dir = orderDir === 'asc' ? 1 : -1
    // Only Title and Length map onto a group; everything else falls back to
    // title order rather than pretending to sort by a member-level field.
    if (orderField === 'length') {
      sorted.sort((a, b) => (a.members.length - b.members.length) * dir || a.title.localeCompare(b.title))
    } else {
      sorted.sort((a, b) => a.title.localeCompare(b.title) * dir)
    }
    return sorted
  }, [compactGroups, parsedSearch, orderField, orderDir, categoryFilter, eraFilter, matchesFilters])

  const handlePlay = useCallback((song: JWApiSong) => {
    const track = songToTrack(song)
    // If shuffle is already on, start radio mode from this track instead of
    // loading the visible page into the queue.
    if (shuffle) {
      const rf = (!fetchAllMode && hasMore)
        ? { category: categoryParam, era: eraParam, search: debouncedSearch, total: count }
        : null
      startRadio(track, rf)
      return
    }
    const playable = sortedSongs.filter((s) => !!s.path)
    const context = playable.map(songToTrack)
    const needsLazy = !fetchAllMode && hasMore
    playTrack(track, context.length > 0 ? context : [track], needsLazy ? {
      category: categoryParam, era: eraParam, search: debouncedSearch,
      page: page + 1, hasMore: true, total: count,
    } : null, 'tracker')
  }, [playTrack, startRadio, shuffle, sortedSongs, categoryParam, eraParam, debouncedSearch, count, hasMore, fetchAllMode, page])

  const handleInfo = useCallback((song: JWApiSong) => { setSelectedSong(song) }, [])
  const handleQueue = useCallback((track: Track) => { addToQueue(track) }, [addToQueue])

  const handleMenu = useCallback((song: JWApiSong, e: React.MouseEvent): void => {
    if (selectMode) {
      setSelected(prev => prev.has(song.id) ? prev : new Map(prev).set(song.id, song))
      setBulkSheetPage('main')
      setSheet('bulk')
      return
    }
    setContextMenu({ song, x: e.clientX, y: e.clientY })
  }, [selectMode])

  // Long-pressing a compact group acts on all its versions at once - selects
  // every member and opens the bulk sheet.
  const handleGroupLongPress = useCallback((group: CompactGroup<JWApiSong>): void => {
    setSelected(new Map(group.members.map(m => [m.item.id, m.item])))
    setSelectMode(true)
  }, [])

  const selectedSongs = useMemo(() => [...selected.values()], [selected])
  // Sessions/unsurfaced songs can't go in playlists or the queue. If even one
  // selected song is ineligible, both actions are disabled entirely rather than
  // silently dropping it - a partial add on a selection made as one unit is
  // surprising.
  const bulkEligibleSongs = useMemo(
    () => selectedSongs.filter(s => !['recording_session', 'unsurfaced'].includes(s.category)),
    [selectedSongs]
  )
  const canBulkAddToPlaylist = selectedSongs.length > 0 && bulkEligibleSongs.length === selectedSongs.length
  const canBulkAddToQueue = selectedSongs.length > 0
    && bulkEligibleSongs.length === selectedSongs.length
    && bulkEligibleSongs.every(s => s.path)

  // Which playlists already contain *every* eligible selected song - shown as a
  // checkmark so re-adding isn't a silent no-op.
  const [bulkContained, setBulkContained] = useState<Set<number>>(new Set())
  const playlistsPageOpen = sheet === 'bulk' && bulkSheetPage === 'playlists'
  useEffect(() => {
    if (!account || !canBulkAddToPlaylist || playlists.length === 0 || !playlistsPageOpen) {
      setBulkContained(new Set())
      return
    }
    const ids = selectedSongs.map(s => s.id)
    Promise.all(
      playlists.map(p =>
        userApi.getPlaylist(p.id)
          .then(d => {
            const memberIds = new Set((d.items ?? []).map(it => it.song.id))
            return { id: p.id, allIn: ids.every(id => memberIds.has(id)) }
          })
          .catch(() => ({ id: p.id, allIn: false }))
      )
    ).then(results => setBulkContained(new Set(results.filter(r => r.allIn).map(r => r.id))))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlists, account, selectedSongs, playlistsPageOpen])

  const closeSheet = (): void => { setSheet(null); setBulkSheetPage('main') }

  const bulkAddToQueue = (): void => {
    selectedSongs.forEach(s => addToQueue(songToTrack(s)))
    exitSelectMode()
  }

  const bulkAddToPlaylist = async (playlistId: number): Promise<void> => {
    await Promise.all(selectedSongs.map(s => userApi.addToPlaylist(playlistId, s.id).catch(() => {})))
    await refreshPlaylists()
    exitSelectMode()
  }

  const bulkDownloadZip = async (): Promise<void> => {
    const paths = selectedSongs.map(s => s.path).filter(Boolean) as string[]
    const skipped = selectedSongs.length - paths.length
    if (paths.length === 0) {
      setBulkZipSkipped(skipped)
      setBulkZipStatus('none')
      setTimeout(() => setBulkZipStatus('idle'), 4000)
      return
    }
    setBulkZipStatus('zipping')
    try {
      const res = await fetch(`${JWAPI_BASE}/files/zip-selection/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      })
      if (!res.ok) throw new Error()
      const contentType = res.headers.get('content-type') || ''
      if (contentType.includes('zip') || contentType.includes('octet-stream')) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = 'songs.zip'; a.click()
        URL.revokeObjectURL(url)
      } else {
        const data = await res.json()
        if (data.download_url) { const a = document.createElement('a'); a.href = data.download_url; a.download = 'songs.zip'; a.click() }
      }
      setBulkZipSkipped(skipped)
      setBulkZipStatus(skipped > 0 ? 'partial' : 'done')
    } catch {
      setBulkZipStatus('error')
    }
    setTimeout(() => setBulkZipStatus('idle'), skipped > 0 ? 5000 : 3000)
  }

  // Links every selected song together as versions of one another - pairing each
  // against the first merges all of their groups. If none had a version_title,
  // the merged group ends up untitled, so prompt for one rather than leaving a
  // group that compact view can't surface.
  const bulkLinkVersions = async (): Promise<void> => {
    const ids = selectedSongs.map(s => s.id)
    if (ids.length < 2) return
    setBulkLinkStatus('linking')
    try {
      const [first, ...rest] = ids
      for (const id of rest) await linkSongVersion(first, id)
      invalidateCompactGroupsCache()
      const meta = await getOwnVersionMeta(first)
      if (meta && !meta.versionTitle) setTitlePromptGroupId(meta.groupId)
      setBulkLinkStatus('done')
    } catch {
      setBulkLinkStatus('error')
    }
    setTimeout(() => setBulkLinkStatus('idle'), 3000)
  }

  const handleShowInFiles = useCallback((song: JWApiSong): void => {
    if (!song.path) return
    const parts = song.path.split('/')
    setApiFilesPath(parts.slice(0, -1).join('/'))
    setActiveView('api-files')
  }, [setApiFilesPath, setActiveView])

  // Hardware back, innermost first. Registered once through a ref: handlers run
  // last-registered-first, so re-registering on state changes would keep moving
  // this to the top of the stack and let it steal presses from a sheet.
  const backRef = useRef<() => boolean>(() => false)
  backRef.current = (): boolean => {
    if (selectMode) { exitSelectMode(); return true }
    if (detail) { setDetail(null); return true }
    if (selectedDateKey) { setSelectedDateKey(null); return true }
    if (trackerTab !== 'songs') { setTrackerTab('songs'); return true }
    if (search) { setSearch(''); return true }
    return false
  }
  useEffect(() => registerBackHandler(() => backRef.current()), [])

  // ── Render helpers ────────────────────────────────────────────────────────

  const rowProps = {
    onPlay: handlePlay,
    onMenu: handleMenu,
    selectMode,
    selected,
    onToggleSelect: toggleSelect,
    playingId,
    isPlaying,
  }

  const songList = (list: JWApiSong[]): JSX.Element => (
    <div>
      {list.map((song) => (
        // selected last: rowProps carries the whole selection Map for the
        // virtual lists, and the row wants just this song's boolean.
        <SongRow key={song.id} song={song} {...rowProps} selected={selected.has(song.id)} />
      ))}
    </div>
  )

  const emptyState = (icon: JSX.Element, text: string): JSX.Element => (
    <div className="flex flex-col items-center justify-center h-64 gap-3 px-8 text-center">
      <div className="w-14 h-14 rounded-full bg-surface-overlay flex items-center justify-center">{icon}</div>
      <p className="text-text-secondary text-sm">{text}</p>
    </div>
  )

  const spinner = (text: string): JSX.Element => (
    <div className="flex items-center justify-center h-40 gap-2 text-text-muted">
      <Loader2 size={18} className="animate-spin" /><span className="text-sm">{text}</span>
    </div>
  )

  const TABS: { key: TrackerTab; label: string; icon: typeof Music2 }[] = [
    { key: 'songs', label: 'Songs', icon: Music2 },
    { key: 'lyrics', label: 'Lyrics', icon: Mic2 },
    { key: 'calendar', label: 'Overview', icon: CalendarDays },
    { key: 'producers', label: 'Credits', icon: Users },
  ]

  const subtitle = trackerTab === 'songs'
    ? loading && sortedSongs.length === 0
      ? 'Loading…'
      : compactView
        ? `${filteredCompactGroups.length.toLocaleString()} version group${filteredCompactGroups.length === 1 ? '' : 's'}`
        : `${(count || sortedSongs.length).toLocaleString()} songs`
    : trackerTab === 'lyrics'
      ? debouncedLyricsQuery.trim() ? `${lyricsCount.toLocaleString()} matches` : 'Search the catalog by lyric'
      : trackerTab === 'calendar' ? `${calendarByDate.size.toLocaleString()} recording dates`
      : `${producersByName.length} producers · ${engineersByName.length} engineers`

  const viewLabel = compactView ? 'Version groups' : viewMode === 'list' ? 'List' : viewMode === 'detail' ? 'Detailed' : 'Grid'

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Neither header paints a background: the app shell's (optionally
          accent-gradient) background runs continuously from behind the status
          bar down through the list, and an opaque bar in between reads as a
          separate title bar bolted on above the app. */}
      {/* The header deliberately does NOT collapse in select mode. Swapping it
          for a one-line selection bar removed the tabs, search and filter chips
          all at once, and the list jumped ~100px up the screen the instant a
          long press registered - under the finger that was still pressing. The
          selection controls live in the bottom bar instead, which only shortens
          the scroller (top-anchored content doesn't move). */}
      {detail ? (
        <div className="shrink-0 flex items-center gap-1 px-2 pb-1">
          <button
            onClick={() => setDetail(null)}
            className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-primary active:bg-surface-overlay"
            aria-label="Back"
          ><ArrowLeft size={20} /></button>
          <div className="flex-1 min-w-0 px-0.5">
            <h1 className="text-text-primary text-[19px] font-bold leading-tight truncate">{detail.name}</h1>
            <p className="text-text-muted text-xs truncate">
              {detail.kind === 'studio' ? 'Recorded here' : detail.kind === 'producer' ? 'Produced' : 'Engineered'}
              {' · '}{detailSongs.length} song{detailSongs.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
      ) : (
        <div className="shrink-0">
          <div className="flex items-center gap-1 px-2">
            <div className="flex-1 min-w-0 pl-2.5">
              <h1 className="text-text-primary text-[20px] font-bold leading-tight truncate">Tracker</h1>
              <p className="text-text-muted text-xs truncate">{subtitle}</p>
            </div>
            {trackerTab === 'songs' && (
              <>
                <button
                  onClick={() => setSheet('view')}
                  className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-muted active:bg-surface-overlay"
                  aria-label={`View: ${viewLabel}`}
                >
                  {compactView ? <Layers size={19} /> : viewMode === 'list' ? <LayoutList size={19} /> : viewMode === 'detail' ? <Rows3 size={19} /> : <LayoutGrid size={19} />}
                </button>
                <button
                  onClick={() => setSheet('sort')}
                  className={`w-11 h-11 shrink-0 flex items-center justify-center rounded-full active:bg-surface-overlay ${orderField ? 'text-accent' : 'text-text-muted'}`}
                  aria-label="Sort"
                ><SlidersHorizontal size={19} /></button>
                <button
                  onClick={() => setSheet('filters')}
                  className={`relative w-11 h-11 shrink-0 flex items-center justify-center rounded-full active:bg-surface-overlay ${filterCount > 0 ? 'text-accent' : 'text-text-muted'}`}
                  aria-label="Filters"
                >
                  <Filter size={19} />
                  {filterCount > 0 && (
                    <span className="absolute top-1.5 right-1.5 min-w-[15px] h-[15px] px-1 rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center">
                      {filterCount}
                    </span>
                  )}
                </button>
              </>
            )}
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-2 px-4 pt-2.5 overflow-x-auto no-scrollbar">
            {TABS.map(({ key, label, icon: Icon }) => {
              const active = trackerTab === key
              return (
                <button
                  key={key}
                  onClick={() => { setTrackerTab(key); setDetail(null) }}
                  className={`shrink-0 flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[13px] font-medium transition-colors ${
                    active ? 'bg-accent text-white' : 'bg-surface-overlay text-text-secondary active:bg-surface-highest'
                  }`}
                >
                  <Icon size={14} />{label}
                </button>
              )
            })}
            <button
              onClick={() => setActiveView('statistics')}
              className="shrink-0 flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[13px] font-medium transition-colors bg-surface-overlay text-text-secondary active:bg-surface-highest"
            >
              <BarChart3 size={14} />Statistics
            </button>
          </div>

          {/* Search */}
          {(trackerTab === 'songs' || trackerTab === 'lyrics') && (
            <div className="px-4 pt-2.5 pb-2">
              <div className="relative flex items-center">
                {trackerTab === 'songs'
                  ? <Search size={16} className="absolute left-3.5 text-text-muted pointer-events-none" />
                  : <Mic2 size={16} className="absolute left-3.5 text-text-muted pointer-events-none" />}
                <input
                  type="search"
                  value={trackerTab === 'songs' ? search : lyricsQuery}
                  onChange={(e) => trackerTab === 'songs' ? setSearch(e.target.value) : setLyricsQuery(e.target.value)}
                  placeholder={trackerTab === 'songs' ? 'Songs, artists, producers, or artist:"name"' : 'Search lyrics'}
                  enterKeyHint="search"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className="w-full h-11 bg-surface-overlay rounded-full pl-10 pr-10 text-[15px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50 [&::-webkit-search-cancel-button]:hidden"
                />
                {(trackerTab === 'songs' ? search : lyricsQuery) && (
                  <button
                    onClick={() => trackerTab === 'songs' ? setSearch('') : setLyricsQuery('')}
                    className="absolute right-1 w-9 h-9 flex items-center justify-center rounded-full text-text-muted active:text-text-primary"
                    aria-label="Clear search"
                  ><X size={16} /></button>
                )}
              </div>
            </div>
          )}

          {/* Active filter chips - individually removable, so a multi-select can
              be trimmed one at a time instead of all-or-nothing. */}
          {trackerTab === 'songs' && filterCount > 0 && (
            <div className="flex items-center gap-2 px-4 pt-2.5 overflow-x-auto no-scrollbar">
              {[...categoryFilter].map((cat) => (
                <button
                  key={cat}
                  onClick={() => { toggleCategoryFilter(cat); resetSongs() }}
                  className="shrink-0 flex items-center gap-1.5 h-8 pl-3 pr-2.5 rounded-full bg-accent/15 text-accent text-[13px] font-medium"
                >
                  {CATEGORY_LABELS[cat] ?? cat}<X size={13} />
                </button>
              ))}
              {[...eraFilter].map((eraName) => (
                <button
                  key={eraName}
                  onClick={() => { toggleEraFilter(eraName); resetSongs() }}
                  className="shrink-0 flex items-center gap-1.5 h-8 pl-3 pr-2.5 rounded-full bg-accent/15 text-accent text-[13px] font-medium"
                >
                  {eraName}<X size={13} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      {detail ? (
        <div className="flex-1 overflow-y-auto overscroll-contain pt-2 pb-6">{songList(detailSongs)}</div>
      ) : trackerTab === 'lyrics' ? (
        <div className="flex-1 overflow-y-auto overscroll-contain pt-2 pb-6">
          {!debouncedLyricsQuery.trim() ? emptyState(<Mic2 size={24} className="text-text-muted" />, 'Search for a lyric to find matching songs')
            : lyricsLoading && lyricsResults.length === 0 ? spinner('Searching…')
            : lyricsError ? emptyState(<X size={24} className="text-text-muted" />, `Failed to search: ${lyricsError}`)
            : lyricsResults.length === 0 ? emptyState(<Mic2 size={24} className="text-text-muted" />, `No songs with lyrics matching “${debouncedLyricsQuery}”`)
            : (
              <>
                {lyricsResults.map((song) => (
                  <LyricResultRow
                    key={song.id}
                    song={song}
                    query={debouncedLyricsQuery}
                    onPlay={handlePlay}
                    onMenu={handleMenu}
                    selectMode={selectMode}
                    selected={selected.has(song.id)}
                    onToggleSelect={toggleSelect}
                  />
                ))}
                {lyricsHasMore ? (
                  <div className="flex justify-center py-4">
                    <button
                      onClick={loadMoreLyrics}
                      disabled={lyricsLoading}
                      className="h-11 px-6 flex items-center gap-2 rounded-full bg-surface-overlay text-text-primary text-sm font-semibold disabled:opacity-50 active:bg-surface-highest"
                    >
                      {lyricsLoading && <Loader2 size={14} className="animate-spin" />} Load more
                    </button>
                  </div>
                ) : (
                  <p className="text-center text-text-muted text-xs py-4">{lyricsCount.toLocaleString()} songs found</p>
                )}
              </>
            )}
        </div>
      ) : trackerTab === 'calendar' ? (
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-6">
          {calendarLoading ? spinner('Loading recording dates…')
            : calendarError ? emptyState(<X size={24} className="text-text-muted" />, `Failed to load: ${calendarError}`)
            : calendarByDate.size === 0 ? emptyState(<CalendarDays size={24} className="text-text-muted" />, 'No recording dates found')
            : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => shiftCalendarMonth(-1)}
                    className="w-11 h-11 flex items-center justify-center rounded-full text-text-muted active:bg-surface-overlay"
                    aria-label="Previous month"
                  ><ChevronLeft size={20} /></button>
                  <p className="text-text-primary text-[15px] font-semibold">{MONTH_LABELS[calendarMonth.month]} {calendarMonth.year}</p>
                  <button
                    onClick={() => shiftCalendarMonth(1)}
                    className="w-11 h-11 flex items-center justify-center rounded-full text-text-muted active:bg-surface-overlay"
                    aria-label="Next month"
                  ><ChevronRight size={20} /></button>
                </div>

                <div className="grid grid-cols-7 gap-1 mb-1">
                  {WEEKDAY_LABELS.map((label, i) => (
                    <div key={i} className="text-center text-text-muted text-[11px] font-medium py-1">{label}</div>
                  ))}
                </div>

                <div className="flex flex-col gap-1">
                  {buildMonthGrid(calendarMonth.year, calendarMonth.month).map((week, wi) => (
                    <div key={wi} className="grid grid-cols-7 gap-1">
                      {week.map((date, di) => {
                        if (!date) return <div key={di} />
                        const key = dateKey(date.getFullYear(), date.getMonth(), date.getDate())
                        const daySongs = calendarByDate.get(key)
                        const isSelected = selectedDateKey === key
                        const dayEraNames = daySongs
                          ? [...new Set(daySongs.map((s) => s.era?.name).filter((n): n is string => !!n))]
                          : []
                        const soleEraColor = dayEraNames.length === 1 ? eraColorMap.get(dayEraNames[0]) ?? DEFAULT_ERA_COLOR : null
                        return (
                          <button
                            key={di}
                            onClick={() => { if (daySongs) setSelectedDateKey(isSelected ? null : key) }}
                            disabled={!daySongs}
                            className={`aspect-square rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors border ${
                              isSelected
                                ? 'bg-accent border-accent text-white font-semibold'
                                : !daySongs
                                  ? 'border-transparent text-text-muted opacity-40'
                                  : soleEraColor
                                    ? `${soleEraColor.bg} ${soleEraColor.border} ${soleEraColor.text} font-medium`
                                    : 'bg-accent/10 border-transparent text-accent font-medium'
                            }`}
                          >
                            <span className="text-[13px] leading-none">{date.getDate()}</span>
                            {daySongs && (
                              <span className={`text-[9px] leading-none tabular-nums ${isSelected ? 'text-white/80' : 'opacity-70'}`}>
                                {daySongs.length}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>

                {selectedDateKey && (
                  <div className="mt-4 -mx-4">
                    <p className="px-4 text-text-muted text-[11px] font-semibold uppercase tracking-wider mb-1">
                      {new Date(selectedDateKey + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                      {' · '}{(calendarByDate.get(selectedDateKey) ?? []).length} songs
                    </p>
                    {songList(calendarByDate.get(selectedDateKey) ?? [])}
                  </div>
                )}

                {eras.length > 0 && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-4 pt-3 border-t border-[var(--border)]">
                    {eras.map((era) => (
                      <div key={era.id} className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${(eraColorMap.get(era.name) ?? DEFAULT_ERA_COLOR).dot}`} />
                        <span className="text-text-muted text-[11px]">{eraLabel(era.name, fullEraNames)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {calendarByStudio.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-[var(--border)]">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">Studios</p>
                    {calendarByStudio.map(([studio, list]) => (
                      <button
                        key={studio}
                        onClick={() => setDetail({ kind: 'studio', name: studio })}
                        className="w-full flex items-center gap-3 py-3 text-left active:bg-surface-overlay rounded-xl px-1 -mx-1"
                      >
                        <MapPin size={17} className="text-text-muted shrink-0" />
                        <span className="flex-1 min-w-0 truncate text-text-primary text-[15px]">{studio}</span>
                        <span className="text-text-muted text-xs tabular-nums">{list.length}</span>
                        <ChevronRight size={16} className="text-text-muted shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
        </div>
      ) : trackerTab === 'producers' ? (
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-2 pb-6">
          {calendarLoading ? spinner('Loading credits…')
            : calendarError ? emptyState(<X size={24} className="text-text-muted" />, `Failed to load: ${calendarError}`)
            : producersByName.length === 0 && engineersByName.length === 0
              ? emptyState(<Users size={24} className="text-text-muted" />, 'No producer or engineer credits found')
            : (
              <>
                {([['producer', 'Producers', producersByName], ['engineer', 'Engineers', engineersByName]] as const).map(([kind, label, list]) => (
                  list.length > 0 && (
                    <div key={kind} className="mb-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">{label}</p>
                      {list.map(([name, songsFor]) => (
                        <button
                          key={name}
                          onClick={() => setDetail({ kind, name })}
                          className="w-full flex items-center gap-3 py-3 text-left active:bg-surface-overlay rounded-xl px-1 -mx-1"
                        >
                          <span className="w-9 h-9 rounded-full bg-surface-overlay flex items-center justify-center shrink-0 text-text-muted text-[13px] font-semibold">
                            {name.slice(0, 1).toUpperCase()}
                          </span>
                          <span className="flex-1 min-w-0 truncate text-text-primary text-[15px]">{name}</span>
                          <span className="text-text-muted text-xs tabular-nums">{songsFor.length}</span>
                          <ChevronRight size={16} className="text-text-muted shrink-0" />
                        </button>
                      ))}
                    </div>
                  )
                ))}
              </>
            )}
        </div>
      ) : (
        /* ── Songs ─────────────────────────────────────────────────────────── */
        <div ref={listScrollRef} className="relative flex-1 overflow-y-auto overscroll-contain pt-2 pb-6">
          {compactView ? (
            loadingCompact ? spinner('Loading version groups…')
              : filteredCompactGroups.length === 0
                ? emptyState(<Layers size={24} className="text-text-muted" />,
                    compactGroups.length === 0 ? 'No version groups yet' : `No version groups match “${debouncedSearch}”`)
                : (
                  <CompactGroupList
                    scrollRef={listScrollRef}
                    groups={filteredCompactGroups}
                    expanded={expandedGroups}
                    onToggleGroup={handleToggleGroup}
                    onGroupLongPress={handleGroupLongPress}
                    {...rowProps}
                  />
                )
          ) : loading && sortedSongs.length === 0 ? (
            <div className="px-4">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-2">
                  <div className="w-12 h-12 rounded-xl art-shimmer shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 rounded-full art-shimmer" style={{ width: `${50 + ((i * 13) % 40)}%` }} />
                    <div className="h-2.5 w-24 rounded-full art-shimmer opacity-60" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 px-8 text-center">
              <div className="w-14 h-14 rounded-full bg-surface-overlay flex items-center justify-center">
                <X size={24} className="text-text-muted" />
              </div>
              <p className="text-text-secondary text-sm">{error}</p>
              <button onClick={resetSongs} className="h-10 px-5 rounded-full bg-accent text-white text-sm font-semibold active:opacity-80">Try again</button>
            </div>
          ) : sortedSongs.length === 0 ? (
            emptyState(<Music2 size={24} className="text-text-muted" />, 'No songs found')
          ) : viewMode === 'list' ? (
            <VirtualSongList scrollRef={listScrollRef} songs={sortedSongs} {...rowProps} />
          ) : viewMode === 'grid' ? (
            <div className="px-4">
              <VirtualSongGrid scrollRef={listScrollRef} songs={sortedSongs} {...rowProps} />
            </div>
          ) : (
            <VirtualSongDetailList scrollRef={listScrollRef} songs={sortedSongs} {...rowProps} />
          )}

          {/* Sentinel always in the DOM so the observer is set up from mount */}
          <div ref={sentinelRef} className="h-4" />
          {loading && sortedSongs.length > 0 && (
            <div className="flex items-center justify-center gap-2 py-4 text-text-muted">
              <Loader2 size={16} className="animate-spin" />
              {fetchAllMode && <span className="text-xs">{sortedSongs.length.toLocaleString()} / {count.toLocaleString()} loaded</span>}
            </div>
          )}
          {!loading && !hasMore && sortedSongs.length > 0 && !compactView && (
            <p className="text-center text-text-muted text-xs py-4">{count.toLocaleString()} songs total</p>
          )}
        </div>
      )}

      {/* ── Selection action bar ───────────────────────────────────────────── */}
      {selectMode && (
        <div className="shrink-0 border-t border-[var(--border)]">
          <div className="flex items-center gap-1 pl-1 pr-2 pt-1">
            <button
              onClick={exitSelectMode}
              className="w-10 h-10 flex items-center justify-center rounded-full text-text-primary active:bg-surface-overlay"
              aria-label="Cancel selection"
            ><X size={19} /></button>
            <span className="flex-1 min-w-0 text-text-primary font-semibold text-[15px] truncate">
              {selected.size} selected
            </span>
            <button
              onClick={() => setSelected(new Map(sortedSongs.map(s => [s.id, s])))}
              className="px-3 h-10 rounded-full text-accent text-[13px] font-semibold active:bg-accent/10"
            >Select all</button>
          </div>
          {ZIP_OPERATIONS_ENABLED && (bulkZipStatus === 'partial' || bulkZipStatus === 'none') && (
            <div className="px-4 py-2 flex items-start gap-2 bg-amber-500/10 text-amber-500 text-xs font-medium">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              {bulkZipStatus === 'none'
                ? "None of the selected songs have a file available yet."
                : `${bulkZipSkipped} of ${selected.size} song${selected.size === 1 ? '' : 's'} had no file and ${bulkZipSkipped === 1 ? 'was' : 'were'} left out of the ZIP.`}
            </div>
          )}
          <div className="flex items-stretch px-2 py-1.5">
            {([
              { key: 'queue', icon: ListPlus, label: 'Queue', disabled: !canBulkAddToQueue, onClick: bulkAddToQueue },
              { key: 'playlist', icon: Plus, label: 'Playlist', disabled: !canBulkAddToPlaylist, onClick: () => { setBulkSheetPage('playlists'); setSheet('bulk') } },
              ...(ZIP_OPERATIONS_ENABLED ? [{
                key: 'zip',
                icon: bulkZipStatus === 'zipping' ? Loader2 : bulkZipStatus === 'done' ? Check : PackageOpen,
                label: bulkZipStatus === 'zipping' ? 'Zipping' : bulkZipStatus === 'done' ? 'Done' : 'ZIP',
                disabled: bulkZipStatus === 'zipping',
                onClick: bulkDownloadZip,
                spin: bulkZipStatus === 'zipping',
              }] as const : []),
              { key: 'more', icon: MoreVertical, label: 'More', disabled: false, onClick: () => { setBulkSheetPage('main'); setSheet('bulk') } },
            ] as const).map((action) => (
              <button
                key={action.key}
                onClick={action.onClick}
                disabled={action.disabled}
                className="flex-1 flex flex-col items-center justify-center gap-1 py-2 rounded-2xl text-text-primary disabled:opacity-35 active:bg-surface-overlay"
              >
                <action.icon size={20} className={'spin' in action && action.spin ? 'animate-spin' : ''} />
                <span className="text-[11px] font-medium">{action.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Sheets ─────────────────────────────────────────────────────────── */}
      {sheet === 'view' && (
        <Sheet onClose={closeSheet} title="View">
          {([
            { key: 'list', label: 'List', sub: 'Compact rows', icon: LayoutList },
            { key: 'detail', label: 'Detailed', sub: 'Rows with metadata', icon: Rows3 },
            { key: 'grid', label: 'Grid', sub: 'Cover-led cards', icon: LayoutGrid },
          ] as const).map((opt) => (
            <SheetItem
              key={opt.key}
              icon={opt.icon}
              label={opt.label}
              sub={opt.sub}
              active={!compactView && viewMode === opt.key}
              trailing={!compactView && viewMode === opt.key ? <Check size={17} className="text-accent shrink-0" /> : undefined}
              onClick={() => { setViewMode(opt.key); setCompactView(false); closeSheet() }}
            />
          ))}
          {versionsEnabled && (
            <>
              <SheetDivider />
              <SheetItem
                icon={Layers}
                label="Version groups"
                sub="Collapse songs into their versions"
                active={compactView}
                trailing={compactView ? <Check size={17} className="text-accent shrink-0" /> : undefined}
                onClick={() => { setCompactView(true); clearExpandedGroups(); closeSheet() }}
              />
            </>
          )}
        </Sheet>
      )}

      {sheet === 'sort' && (
        <Sheet onClose={closeSheet} title="Sort by">
          {/* Sorting pulls the whole catalog down before it can order it (the
              API has no ordering param), so it's worth saying so rather than
              leaving a long spinner unexplained. */}
          <SheetItem
            label="Default order"
            sub="Loads as you scroll"
            active={!orderField}
            trailing={!orderField ? <Check size={17} className="text-accent shrink-0" /> : undefined}
            onClick={() => { setOrderField(null); setOrderDir('asc'); resetSongs(); closeSheet() }}
          />
          <SheetDivider />
          {SORT_OPTIONS.map((opt) => (
            <SheetItem
              key={opt.field}
              label={opt.label}
              sub={!orderField ? 'Loads the full catalog first' : undefined}
              active={orderField === opt.field}
              trailing={orderField === opt.field ? <Check size={17} className="text-accent shrink-0" /> : undefined}
              onClick={() => setOrderField(opt.field)}
            />
          ))}
          {orderField && (
            <>
              <SheetDivider />
              <SheetItem
                icon={ArrowUp} label="Ascending" active={orderDir === 'asc'}
                trailing={orderDir === 'asc' ? <Check size={17} className="text-accent shrink-0" /> : undefined}
                onClick={() => setOrderDir('asc')}
              />
              <SheetItem
                icon={ArrowDown} label="Descending" active={orderDir === 'desc'}
                trailing={orderDir === 'desc' ? <Check size={17} className="text-accent shrink-0" /> : undefined}
                onClick={() => setOrderDir('desc')}
              />
            </>
          )}
        </Sheet>
      )}

      {sheet === 'filters' && (
        <Sheet
          onClose={closeSheet}
          title="Filters"
          header={filterCount > 0 ? (
            <button
              onClick={() => { setCategoryFilter(new Set()); setEraFilter(new Set()); resetSongs() }}
              className="mx-5 mt-2 h-9 px-4 rounded-full bg-surface-overlay text-text-primary text-[13px] font-semibold active:bg-surface-highest"
            >Clear all</button>
          ) : undefined}
        >
          <p className="px-5 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Category</p>
          {CATEGORY_OPTIONS.map((opt) => {
            const checked = categoryFilter.has(opt.key)
            const n = stats?.category_stats[opt.key as keyof typeof stats.category_stats]
            return (
              <SheetItem
                key={opt.key}
                icon={checked ? CheckCircle2 : Circle}
                label={opt.label}
                active={checked}
                trailing={n !== undefined ? <span className="text-text-muted text-xs tabular-nums shrink-0">{n.toLocaleString()}</span> : undefined}
                onClick={() => { toggleCategoryFilter(opt.key); resetSongs() }}
              />
            )
          })}
          {eras.length > 0 && (
            <>
              <SheetDivider />
              <p className="px-5 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Era</p>
              {eras.map((era) => {
                const checked = eraFilter.has(era.name)
                return (
                  <SheetItem
                    key={era.id}
                    icon={checked ? CheckCircle2 : Circle}
                    label={eraLabel(era.name, fullEraNames)}
                    active={checked}
                    onClick={() => { toggleEraFilter(era.name); resetSongs() }}
                  />
                )
              })}
            </>
          )}
        </Sheet>
      )}

      {sheet === 'bulk' && (
        <Sheet
          onClose={closeSheet}
          title={bulkSheetPage === 'main' ? `${selected.size} song${selected.size === 1 ? '' : 's'} selected` : undefined}
          header={bulkSheetPage === 'playlists' ? (
            <button
              onClick={() => setBulkSheetPage('main')}
              className="w-full flex items-center gap-2 px-4 pt-3 pb-3 text-text-primary active:bg-surface-overlay"
            >
              <ArrowLeft size={18} className="text-text-muted" />
              <span className="text-[15px] font-semibold">Add to playlist</span>
            </button>
          ) : undefined}
        >
          {bulkSheetPage === 'playlists' ? (
            !account ? (
              <div className="px-5 py-4">
                <p className="text-text-muted text-sm mb-3">Log in to save songs to your playlists.</p>
                <button
                  onClick={() => { closeSheet(); setShowUserAuth(true) }}
                  className="w-full h-11 rounded-full bg-accent text-white text-sm font-semibold active:opacity-80"
                >Log in</button>
              </div>
            ) : playlists.length === 0 ? (
              <p className="px-5 py-6 text-center text-text-muted text-sm">No playlists yet.</p>
            ) : (
              playlists.map((p) => {
                const allIn = bulkContained.has(p.id)
                return (
                  <SheetItem
                    key={p.id}
                    icon={ListMusic}
                    label={p.name}
                    sub={allIn ? 'Already contains the whole selection' : undefined}
                    trailing={allIn ? <Check size={17} className="text-accent shrink-0" /> : undefined}
                    onClick={() => { bulkAddToPlaylist(p.id); closeSheet() }}
                  />
                )
              })
            )
          ) : (
            <>
              <SheetItem
                icon={ListPlus}
                label="Add to queue"
                sub={!canBulkAddToQueue ? "Sessions and unsurfaced songs can't be queued" : undefined}
                disabled={!canBulkAddToQueue}
                onClick={() => { bulkAddToQueue(); closeSheet() }}
              />
              <SheetItem
                icon={Plus}
                label="Add to playlist"
                sub={!canBulkAddToPlaylist ? "Sessions and unsurfaced songs can't go in playlists" : undefined}
                disabled={!canBulkAddToPlaylist}
                trailing={<ChevronRight size={16} className="text-text-muted shrink-0" />}
                onClick={() => setBulkSheetPage('playlists')}
              />
              {ZIP_OPERATIONS_ENABLED && (
                <SheetItem
                  icon={bulkZipStatus === 'zipping' ? Loader2 : PackageOpen}
                  label={bulkZipStatus === 'zipping' ? 'Zipping…' : 'Download ZIP'}
                  disabled={bulkZipStatus === 'zipping'}
                  onClick={() => { bulkDownloadZip(); closeSheet() }}
                />
              )}
              {canEdit && (
                <>
                  <SheetDivider />
                  <SheetItem
                    icon={Pencil}
                    label="Edit fields"
                    sub="Across every selected song"
                    onClick={() => { openBulkEditor(selectedSongs); closeSheet() }}
                  />
                  {versionsEnabled && (
                    <SheetItem
                      icon={bulkLinkStatus === 'linking' ? Loader2 : Link2}
                      label={
                        bulkLinkStatus === 'linking' ? 'Linking…'
                          : bulkLinkStatus === 'done' ? 'Linked'
                          : bulkLinkStatus === 'error' ? 'Link failed'
                          : 'Link as versions'
                      }
                      sub={selected.size < 2 ? 'Select 2 or more songs' : undefined}
                      disabled={selected.size < 2 || bulkLinkStatus === 'linking'}
                      onClick={() => { bulkLinkVersions(); closeSheet() }}
                    />
                  )}
                </>
              )}
              <SheetDivider />
              <SheetItem icon={X} label="Clear selection" onClick={() => { exitSelectMode(); closeSheet() }} />
            </>
          )}
        </Sheet>
      )}

      {selectedSong && (
        <SongInfoModal
          song={selectedSong}
          onClose={() => setSelectedSong(null)}
          onEdit={canEdit ? (songId) => {
            setSelectedSong(null)
            setPendingEditorSongId(songId)
            setActiveView('editor')
          } : undefined}
        />
      )}

      {contextMenu && (
        <SongContextMenu
          state={{ track: songToTrack(contextMenu.song), songId: contextMenu.song.id, x: contextMenu.x, y: contextMenu.y }}
          song={contextMenu.song}
          onClose={() => setContextMenu(null)}
          onInfo={() => handleInfo(contextMenu.song)}
          onAddToQueue={() => handleQueue(songToTrack(contextMenu.song))}
          onShowInFiles={() => handleShowInFiles(contextMenu.song)}
          canEdit={canEdit}
          onSelect={() => toggleSelect(contextMenu.song)}
          liked={likedTrackIds.includes(`jw-${contextMenu.song.id}`)}
          onToggleLike={() => toggleLike(`jw-${contextMenu.song.id}`)}
        />
      )}

      {titlePromptGroupId !== null && (
        <VersionTitlePromptModal
          saving={savingTitlePrompt}
          onSkip={() => setTitlePromptGroupId(null)}
          onSave={async (title) => {
            setSavingTitlePrompt(true)
            try {
              await setGroupVersionTitle(titlePromptGroupId, title)
              invalidateCompactGroupsCache()
            } finally {
              setSavingTitlePrompt(false)
              setTitlePromptGroupId(null)
            }
          }}
        />
      )}
    </div>
  )
}
