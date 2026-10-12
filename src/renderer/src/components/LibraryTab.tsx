import { useState, useEffect, useRef, useMemo, memo, ReactNode } from 'react'
import {
  Music, Play, Shuffle, Search, MoreVertical, ArrowLeft, User, FolderOpen, Loader2,
  ListPlus, X, Check, ArrowUp, ArrowDown, ListMusic,
  RefreshCw, Settings2, Circle, ChevronRight, SlidersHorizontal,
} from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import { LibraryTrack } from '../types'
import { libraryTrackToTrack as toQueueTrack } from '../lib/fileTypes'
import { fisherYates } from '../store/queueSlice'
import * as userApi from '../lib/userApi'
import SongContextMenu, { SongContextMenuState } from './SongContextMenu'
import { Sheet, SheetItem, SheetDivider } from './mobile/Sheet'
import { useLongPress } from './mobile/useLongPress'
import { useVirtualWindow } from '../hooks/useVirtualWindow'
import { formatDuration, formatTotalDuration } from '../lib/format'
import { registerBackHandler } from '../lib/backHandlers'
import { readArt } from '../lib/localLibrary'

/* ══════════════════════════════════════════════════════════════════════════════
   Library - the on-device music collection, built for a phone rather than
   adapted to one. The desktop version put a collapsible section rail beside a
   toolbar of small buttons and a spreadsheet-style song table; none of that
   survives here.

   What it is instead: one browse screen with four category chips, a permanent
   Play/Shuffle pair, an A–Z rail you can drag to jump through a few thousand
   songs, and art-led album/artist screens you drill into and back out of.
   Everything below the data layer is new - the scan, the lazy per-track cover
   reads, the album/artist grouping and the windowing are unchanged.
   ══════════════════════════════════════════════════════════════════════════════ */

const SONG_ROW_H = 64
const ARTIST_ROW_H = 68
const GRID_GAP = 12
const GRID_PAD = 16
/** Title + subtitle block under a square album tile. */
const TILE_TEXT_H = 52
/** Below this many rows an A–Z rail is more clutter than help. */
const ALPHA_MIN_ROWS = 30

type Tab = 'songs' | 'albums' | 'artists' | 'recent'
type SortField = 'title' | 'artist' | 'album' | 'duration' | 'added'
type SheetKind = 'sort' | 'more' | 'bulk' | 'filter' | null

const TABS: { key: Tab; label: string }[] = [
  { key: 'songs', label: 'Songs' },
  { key: 'albums', label: 'Albums' },
  { key: 'artists', label: 'Artists' },
  { key: 'recent', label: 'Recent' },
]

const SORTS: { key: SortField; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'artist', label: 'Artist' },
  { key: 'album', label: 'Album' },
  { key: 'duration', label: 'Duration' },
  { key: 'added', label: 'Recently added' },
]

const LS_TAB = 'library:view'
const LS_SORT = 'library:sort'
const LS_SORT_DIR = 'library:sortDir'
const LS_FILTERS = 'library:filters'

// ─── filters ──────────────────────────────────────────────────────────────────
// Applied to the track pool itself rather than to the songs list, so albums and
// artists made up entirely of excluded files disappear too - a "flac only"
// filter that still listed mp3-only albums would be lying.

type LengthKey = 'any' | 'short' | 'mid' | 'long' | 'epic'

/** [min, max) in seconds. */
const LENGTHS: { key: LengthKey; label: string; range: [number, number] }[] = [
  { key: 'any',   label: 'Any',          range: [0, Infinity] },
  { key: 'short', label: 'Under 2 min',  range: [0, 120] },
  { key: 'mid',   label: '2–5 min',      range: [120, 300] },
  { key: 'long',  label: '5–10 min',     range: [300, 600] },
  { key: 'epic',  label: 'Over 10 min',  range: [600, Infinity] },
]

interface Filters {
  length: LengthKey
  /** Lowercase extensions, no dot. Empty = every type. */
  exts: string[]
  /** Empty = every genre. */
  genres: string[]
  artOnly: boolean
}

const NO_FILTERS: Filters = { length: 'any', exts: [], genres: [], artOnly: false }

function loadFilters(): Filters {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_FILTERS) || 'null')
    if (!saved || typeof saved !== 'object') return NO_FILTERS
    // Field-by-field rather than a spread: a hand-edited or older payload
    // shouldn't be able to put a non-array where a list is expected and crash
    // the whole tab on first render.
    return {
      length: LENGTHS.some((l) => l.key === saved.length) ? saved.length : 'any',
      exts: Array.isArray(saved.exts) ? saved.exts.filter((s: unknown) => typeof s === 'string') : [],
      genres: Array.isArray(saved.genres) ? saved.genres.filter((s: unknown) => typeof s === 'string') : [],
      artOnly: !!saved.artOnly,
    }
  } catch { return NO_FILTERS }
}

function countFilters(f: Filters): number {
  return (f.length !== 'any' ? 1 : 0) + (f.exts.length ? 1 : 0) + (f.genres.length ? 1 : 0) + (f.artOnly ? 1 : 0)
}

/** Toggle one value in a multi-select list. */
function toggleIn(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

/** A bare "Scanning…" with no counts reads as hung on a big library - the
 *  native walk can take minutes, and it already reports found/parsed via
 *  `scanProgress` (see localLibrary.onScanProgress). This is that number,
 *  formatted for the two spots in this tab that show scan state. */
function scanStatusText(progress: { found: number; parsed: number } | null): string {
  if (!progress || progress.found === 0) return 'Scanning…'
  return progress.parsed > 0
    ? `Found ${progress.found.toLocaleString()} · read tags for ${progress.parsed.toLocaleString()}`
    : `Found ${progress.found.toLocaleString()} file${progress.found === 1 ? '' : 's'}…`
}

const byTrackNo = (a: LibraryTrack, b: LibraryTrack): number => (a.trackNumber ?? 999) - (b.trackNumber ?? 999)
const shuffled = fisherYates

interface Album {
  key: string
  name: string
  artist: string
  year: number | null
  addedAt: number
  tracks: LibraryTrack[]
  coverTrack: LibraryTrack
}

interface Artist {
  name: string
  tracks: LibraryTrack[]
  albums: number
  coverTrack: LibraryTrack
}

/** First character a row sorts under, for the A–Z rail. */
function indexLetter(s: string): string {
  const c = (s || '').trim().charAt(0).toUpperCase()
  return c >= 'A' && c <= 'Z' ? c : '#'
}

// ─── lazy album-art loading ───────────────────────────────────────────────────
// Covers live in the store's `libraryArt` map keyed by track id: `undefined`
// until read off disk, then `null` (artless) or a data URI. This subscribes a
// thumbnail to just its own entry and kicks off the read once. The read is
// itself cached (memory + disk, artless files remembered), so a file is never
// re-parsed.
//
// The same track can be visible in several places at once (song list, album
// tile, playlist mosaic) - without this set, each thumbnail fired its own parse
// before the first result landed in the store.
const inflightArt = new Set<string>()

function useTrackArt(track: LibraryTrack): string | null | undefined {
  const { applyLibraryArt } = useStorePick('applyLibraryArt')
  const art = useStore((s) => s.libraryArt[track.id])
  useEffect(() => {
    // undefined = never asked; null = asked, and this file has no embedded art.
    // Only the first state should trigger a read, or a track without a cover
    // would re-decode on every scroll past it.
    if (art !== undefined || inflightArt.has(track.id)) return
    if (!track.hasAlbumArt) { applyLibraryArt(track.id, null); return }
    inflightArt.add(track.id)
    readArt(track.filePath)
      .then((a) => applyLibraryArt(track.id, a))
      .catch(() => {})
      .finally(() => inflightArt.delete(track.id))
  }, [track.id, art])
  return art
}

/** Small square thumbnail. Exported - PlaylistsView reuses it. */
export function AlbumArtThumb({ track, size = 48 }: { track: LibraryTrack; size?: number }): JSX.Element {
  const art = useTrackArt(track)
  // rem, not px, so the thumbnail scales with the app text-size setting (which
  // drives the root font-size) rather than staying pinned while its rem-sized
  // wrapper and neighbouring text grow around it.
  const rem = `${size / 16}rem`
  if (art) return <img src={art} alt="" className="object-cover" style={{ width: rem, height: rem }} />
  return (
    <div className="flex items-center justify-center bg-surface-overlay text-text-muted" style={{ width: rem, height: rem }}>
      <Music size={`${(size * 0.4) / 16}rem`} />
    </div>
  )
}

/** Art that fills its parent box, with a shimmer while the read is in flight. */
function FillArt({ track, round, fallback }: { track: LibraryTrack; round?: boolean; fallback?: JSX.Element }): JSX.Element {
  const art = useTrackArt(track)
  const shape = round ? 'rounded-full' : ''
  if (art === undefined) return <div className={`w-full h-full art-shimmer ${shape}`} />
  if (art) return <img src={art} alt="" className={`w-full h-full object-cover ${shape}`} />
  return (
    <div className={`w-full h-full flex items-center justify-center bg-surface-overlay text-text-muted ${shape}`}>
      {fallback ?? <Music size={28} />}
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

/** Selection drawn ON the artwork - a leading checkbox would shove every row
 *  sideways the instant select mode turns on, which happens mid-long-press. */
function SelectOverlay({ selected, round }: { selected: boolean; round?: boolean }): JSX.Element {
  return (
    <div className={`absolute inset-0 flex items-center justify-center transition-colors ${round ? 'rounded-full' : ''} ${selected ? 'bg-accent/75' : 'bg-black/45'}`}>
      {selected ? <Check size={22} className="text-white" strokeWidth={3} /> : <Circle size={20} className="text-white/85" />}
    </div>
  )
}

// ─── song row ─────────────────────────────────────────────────────────────────

interface SongRowProps {
  track: LibraryTrack
  /** Track number shown instead of artwork - album screens only. */
  ordinal?: number
  onPlay: (track: LibraryTrack) => void
  onMenu: (track: LibraryTrack, e: React.MouseEvent) => void
  onLongPress: (track: LibraryTrack) => void
  selectMode: boolean
  selected: boolean
  currentId: string | null
  isPlaying: boolean
}

const SongRow = memo(function SongRow({
  track, ordinal, onPlay, onMenu, onLongPress, selectMode, selected, currentId, isPlaying,
}: SongRowProps): JSX.Element {
  const isCurrent = currentId === track.id
  const press = useLongPress({
    onTap: () => { if (selectMode) onLongPress(track); else onPlay(track) },
    onLongPress: () => onLongPress(track),
  })

  return (
    <div
      className={`flex items-center gap-3 px-4 py-1.5 h-full rounded-2xl transition-colors ${
        selected ? 'bg-accent/15' : 'active:bg-surface-overlay'
      }`}
      {...press}
    >
      {ordinal !== undefined && !selectMode ? (
        <span className={`w-7 shrink-0 text-center text-[13px] tabular-nums ${isCurrent ? 'text-accent' : 'text-text-muted'}`}>
          {ordinal}
        </span>
      ) : (
        <div className="relative shrink-0 w-12 h-12 rounded-xl overflow-hidden bg-surface-overlay">
          <AlbumArtThumb track={track} size={48} />
          {selectMode && <SelectOverlay selected={selected} />}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className={`text-[15px] leading-snug truncate ${isCurrent ? 'text-accent font-semibold' : 'text-text-primary'}`}>
          {track.title}
        </p>
        <p className="text-text-muted text-xs truncate mt-0.5">
          {[track.artist || 'Unknown Artist', track.album].filter(Boolean).join(' · ')}
        </p>
      </div>

      {isCurrent && <EqBars paused={!isPlaying} />}
      <span className="text-text-muted text-[11px] tabular-nums shrink-0">{formatDuration(track.duration, '--:--')}</span>

      {!selectMode && (
        <button
          className="shrink-0 w-10 h-11 -mr-2 flex items-center justify-center text-text-muted active:text-accent"
          onClick={(e) => { e.stopPropagation(); onMenu(track, e) }}
          aria-label="More options"
        >
          <MoreVertical size={18} />
        </button>
      )}
    </div>
  )
})

// ─── album tile / artist row ──────────────────────────────────────────────────

const AlbumTile = memo(function AlbumTile({ album, onOpen }: { album: Album; onOpen: () => void }): JSX.Element {
  return (
    <button onClick={onOpen} className="flex flex-col text-left active:opacity-70 transition-opacity">
      <div className="w-full aspect-square rounded-2xl overflow-hidden bg-surface-overlay shrink-0">
        <FillArt track={album.coverTrack} fallback={<Music size={34} />} />
      </div>
      <div className="pt-2 min-w-0" style={{ height: TILE_TEXT_H }}>
        <p className="text-text-primary text-[13px] font-medium truncate leading-tight">{album.name}</p>
        <p className="text-text-muted text-[11px] truncate mt-0.5">{album.artist}</p>
        <p className="text-text-muted text-[11px] truncate">
          {album.tracks.length} song{album.tracks.length === 1 ? '' : 's'}{album.year ? ` · ${album.year}` : ''}
        </p>
      </div>
    </button>
  )
})

const ArtistRow = memo(function ArtistRow({ artist, onOpen }: { artist: Artist; onOpen: () => void }): JSX.Element {
  return (
    <button onClick={onOpen} className="w-full h-full flex items-center gap-3 px-4 py-1.5 rounded-2xl active:bg-surface-overlay transition-colors text-left">
      <div className="relative shrink-0 w-14 h-14 rounded-full overflow-hidden bg-surface-overlay">
        <FillArt track={artist.coverTrack} round fallback={<User size={24} />} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-text-primary text-[15px] leading-snug truncate">{artist.name}</p>
        <p className="text-text-muted text-xs truncate mt-0.5">
          {artist.tracks.length} song{artist.tracks.length === 1 ? '' : 's'} · {artist.albums} album{artist.albums === 1 ? '' : 's'}
        </p>
      </div>
      <ChevronRight size={18} className="text-text-muted shrink-0" />
    </button>
  )
})

// ─── A–Z fast scroll ──────────────────────────────────────────────────────────
// The reason a phone library needs this: 2500 songs is ~40 screens of flick
// scrolling. Dragging the rail jumps straight to a letter, with a bubble showing
// where you are. Only rendered when the list is actually sorted alphabetically —
// jumping to "M" in a duration-sorted list would be nonsense.

function AlphaRail({ letters, onPick }: { letters: string[]; onPick: (letter: string) => void }): JSX.Element {
  const [active, setActive] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const pickAt = (clientY: number): void => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const i = Math.floor(((clientY - r.top) / r.height) * letters.length)
    const letter = letters[Math.min(letters.length - 1, Math.max(0, i))]
    if (letter && letter !== active) {
      navigator.vibrate?.(4)
      setActive(letter)
      onPick(letter)
    }
  }

  return (
    <>
      <div
        ref={ref}
        // touch-none: without it the rail's own drag scrolls the list underneath
        // at the same time, and the two fight each other.
        className="absolute right-0 top-2 bottom-2 w-7 z-10 flex flex-col items-center justify-center touch-none select-none"
        onTouchStart={(e) => pickAt(e.touches[0].clientY)}
        onTouchMove={(e) => pickAt(e.touches[0].clientY)}
        onTouchEnd={() => setActive(null)}
        onTouchCancel={() => setActive(null)}
      >
        {letters.map((l) => (
          <span
            key={l}
            className={`text-[9px] font-semibold leading-none py-[1px] transition-colors ${
              active === l ? 'text-accent' : 'text-text-muted'
            }`}
          >
            {l}
          </span>
        ))}
      </div>
      {active && (
        <div className="absolute right-10 top-1/2 -translate-y-1/2 z-20 w-16 h-16 rounded-2xl bg-surface-highest border border-[var(--border)] shadow-2xl flex items-center justify-center pointer-events-none">
          <span className="text-text-primary text-2xl font-bold">{active}</span>
        </div>
      )}
    </>
  )
}

// ─── windowing ────────────────────────────────────────────────────────────────

function VirtualRows({ scrollRef, contentRef, count, rowH, render }: {
  scrollRef: React.RefObject<HTMLDivElement>
  contentRef: React.RefObject<HTMLDivElement>
  count: number
  rowH: number
  render: (index: number) => JSX.Element
}): JSX.Element {
  const { start, end, totalHeight } = useVirtualWindow(scrollRef, contentRef, count, rowH)
  return (
    <div ref={contentRef} style={{ height: totalHeight, position: 'relative' }}>
      {Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i).map((i) => (
        <div key={i} style={{ position: 'absolute', top: i * rowH, left: 0, right: 0, height: rowH }}>
          {render(i)}
        </div>
      ))}
    </div>
  )
}

function AlbumGrid({ scrollRef, contentRef, albums, onOpen }: {
  scrollRef: React.RefObject<HTMLDivElement>
  contentRef: React.RefObject<HTMLDivElement>
  albums: Album[]
  onOpen: (album: Album) => void
}): JSX.Element {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const measure = (): void => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [contentRef])

  const appTextScale = useStore((s) => s.appTextScale)
  const cols = width >= 560 ? 3 : 2
  const cellW = width > 0 ? Math.floor((width - GRID_GAP * (cols - 1)) / cols) : 0
  const rowH = cellW + Math.round(TILE_TEXT_H * appTextScale) + 8 + GRID_GAP
  const rowCount = Math.ceil(albums.length / cols)
  const { start, end, totalHeight } = useVirtualWindow(scrollRef, contentRef, rowCount, rowH)

  return (
    <div ref={contentRef} style={{ height: totalHeight, position: 'relative' }}>
      {width > 0 && Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i).map((r) =>
        albums.slice(r * cols, r * cols + cols).map((album, c) => (
          <div
            key={album.key}
            style={{ position: 'absolute', top: r * rowH, left: c * (cellW + GRID_GAP), width: cellW }}
          >
            <AlbumTile album={album} onOpen={() => onOpen(album)} />
          </div>
        ))
      )}
    </div>
  )
}

// ─── shared bits ──────────────────────────────────────────────────────────────

function PlayShuffleRow({ onPlay, onShuffle, disabled }: { onPlay: () => void; onShuffle: () => void; disabled?: boolean }): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onPlay}
        disabled={disabled}
        className="flex-1 h-12 flex items-center justify-center gap-2 rounded-full bg-accent text-white text-[15px] font-semibold disabled:opacity-40 active:opacity-80"
      >
        <Play size={18} fill="currentColor" /> Play
      </button>
      <button
        onClick={onShuffle}
        disabled={disabled}
        className="flex-1 h-12 flex items-center justify-center gap-2 rounded-full bg-surface-overlay text-text-primary text-[15px] font-semibold disabled:opacity-40 active:bg-surface-highest"
      >
        <Shuffle size={17} /> Shuffle
      </button>
    </div>
  )
}

/** One selectable pill. The same shape as the browse tabs above the list, so a
 *  chosen filter reads as "on" the same way an active tab does. */
function Chip({ label, active, onClick }: { label: ReactNode; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`h-9 px-3.5 rounded-full text-[13px] font-medium transition-colors ${
        active ? 'bg-accent text-white' : 'bg-surface-overlay text-text-secondary active:bg-surface-highest'
      }`}
    >{label}</button>
  )
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="px-5 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

/** Shown where a list would be if the filters excluded everything in it. */
function NoMatches({ what, onClear }: { what: string; onClear: () => void }): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 py-16 px-8 text-center">
      <p className="text-text-muted text-sm">No {what} match your filters</p>
      <button onClick={onClear} className="h-10 px-5 rounded-full bg-surface-overlay text-text-primary text-[13px] font-semibold active:bg-surface-highest">
        Clear filters
      </button>
    </div>
  )
}

function EmptyState({ onOpenSettings }: { onOpenSettings: () => void }): JSX.Element {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="w-20 h-20 rounded-full bg-surface-overlay flex items-center justify-center">
        <Music size={34} className="text-text-muted" />
      </div>
      <div>
        <h2 className="text-text-primary text-xl font-semibold mb-1">No music yet</h2>
        <p className="text-text-muted text-sm max-w-xs">
          Pick a folder of music - or single files - and everything in it shows up here.
        </p>
      </div>
      <div className="flex flex-col gap-2 w-full max-w-xs">
        <button
          onClick={onOpenSettings}
          className="h-12 flex items-center justify-center gap-2 rounded-full bg-accent text-white text-[15px] font-semibold active:opacity-80"
        >
          <FolderOpen size={17} /> Choose a folder
        </button>
      </div>
    </div>
  )
}

// ─── main ─────────────────────────────────────────────────────────────────────

export default function LibraryTab(): JSX.Element {
  const {
    libraryTracks, libraryScanning, libraryScanProgress, scanLibrary, libraryFolders, loadLibrary, openSettings,
    playTrack, playCollection, playNext, addToQueue, account, likedTrackIds,
    toggleLike, currentTrack, isPlaying, setIsPlaying,
  } = useStorePick(
    'libraryTracks', 'libraryScanning', 'libraryScanProgress', 'scanLibrary', 'libraryFolders', 'loadLibrary', 'openSettings',
    'playTrack', 'playCollection', 'playNext', 'addToQueue', 'account', 'likedTrackIds',
    'toggleLike', 'currentTrack', 'isPlaying', 'setIsPlaying')

  const [tab, setTabState] = useState<Tab>(() => {
    const saved = localStorage.getItem(LS_TAB)
    return saved === 'songs' || saved === 'albums' || saved === 'artists' || saved === 'recent' ? saved : 'albums'
  })
  const setTab = (t: Tab): void => { setTabState(t); localStorage.setItem(LS_TAB, t) }

  const [drill, setDrill] = useState<{ kind: 'album'; album: Album } | { kind: 'artist'; name: string } | null>(null)
  const [search, setSearch] = useState('')
  const [sortField, setSortFieldState] = useState<SortField>(() => (localStorage.getItem(LS_SORT) as SortField) || 'title')
  const [sortDir, setSortDirState] = useState<'asc' | 'desc'>(() => (localStorage.getItem(LS_SORT_DIR) as 'asc' | 'desc') || 'asc')
  const setSortField = (f: SortField): void => { setSortFieldState(f); localStorage.setItem(LS_SORT, f) }
  const setSortDir = (d: 'asc' | 'desc'): void => { setSortDirState(d); localStorage.setItem(LS_SORT_DIR, d) }

  const [filters, setFiltersState] = useState<Filters>(loadFilters)
  const setFilters = (f: Filters): void => { setFiltersState(f); localStorage.setItem(LS_FILTERS, JSON.stringify(f)) }
  const filterCount = countFilters(filters)

  const [sheet, setSheet] = useState<SheetKind>(null)
  const [ctx, setCtx] = useState<{ track: LibraryTrack; queue: LibraryTrack[]; x: number; y: number } | null>(null)

  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Map<string, LibraryTrack>>(new Map())
  const selectedTracks = useMemo(() => [...selected.values()], [selected])

  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const appTextScale = useStore((s) => s.appTextScale)
  const songRowH = Math.round(SONG_ROW_H * appTextScale)
  const artistRowH = Math.round(ARTIST_ROW_H * appTextScale)

  useEffect(() => { loadLibrary() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSelect = (track: LibraryTrack): void => {
    setSelectMode(true)
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(track.id)) next.delete(track.id)
      else next.set(track.id, track)
      return next
    })
  }

  const exitSelectMode = (): void => { setSelectMode(false); setSelected(new Map()) }

  // Deselecting the last track drops out of select mode on its own.
  useEffect(() => {
    if (selectMode && selected.size === 0) setSelectMode(false)
  }, [selectMode, selected])

  // ── filtering ──
  // Facets come off the unfiltered library on purpose: picking "flac" must not
  // make every other extension vanish from the sheet you picked it in.
  const { extFacets, genreFacets } = useMemo(() => {
    const exts = new Map<string, number>()
    const genres = new Map<string, number>()
    for (const t of libraryTracks) {
      const e = (t.ext || '').toLowerCase().replace(/^\./, '')
      if (e) exts.set(e, (exts.get(e) ?? 0) + 1)
      const g = (t.genre || '').trim()
      if (g) genres.set(g, (genres.get(g) ?? 0) + 1)
    }
    const rank = (m: Map<string, number>): { value: string; count: number }[] =>
      [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, count]) => ({ value, count }))
    return { extFacets: rank(exts), genreFacets: rank(genres) }
  }, [libraryTracks])

  const pool = useMemo(() => {
    if (filterCount === 0) return libraryTracks
    const [lo, hi] = (LENGTHS.find((l) => l.key === filters.length) ?? LENGTHS[0]).range
    const exts = new Set(filters.exts)
    const genres = new Set(filters.genres)
    return libraryTracks.filter((t) =>
      t.duration >= lo && t.duration < hi
      && (exts.size === 0 || exts.has((t.ext || '').toLowerCase().replace(/^\./, '')))
      && (genres.size === 0 || genres.has((t.genre || '').trim()))
      && (!filters.artOnly || t.hasAlbumArt))
  }, [libraryTracks, filters, filterCount])

  // ── derived collections ──
  const albums = useMemo<Album[]>(() => {
    const map = new Map<string, Album>()
    for (const t of pool) {
      const key = `${t.album || 'Unknown Album'}__${t.albumArtist || t.artist || 'Unknown Artist'}`
      let a = map.get(key)
      if (!a) {
        a = {
          key, name: t.album || 'Unknown Album', artist: t.albumArtist || t.artist || 'Unknown Artist',
          year: t.year, addedAt: 0, tracks: [], coverTrack: t,
        }
        map.set(key, a)
      }
      a.tracks.push(t)
      a.addedAt = Math.max(a.addedAt, t.addedAt || 0)
      if (t.trackNumber === 1 || (!a.coverTrack.hasAlbumArt && t.hasAlbumArt)) a.coverTrack = t
    }
    return [...map.values()]
  }, [pool])

  const artists = useMemo<Artist[]>(() => {
    const map = new Map<string, Artist>()
    const albumSets = new Map<string, Set<string>>()
    for (const t of pool) {
      const name = t.albumArtist || t.artist || 'Unknown Artist'
      let a = map.get(name)
      if (!a) { a = { name, tracks: [], albums: 0, coverTrack: t }; map.set(name, a); albumSets.set(name, new Set()) }
      a.tracks.push(t)
      albumSets.get(name)!.add(t.album || 'Unknown Album')
      if (!a.coverTrack.hasAlbumArt && t.hasAlbumArt) a.coverTrack = t
    }
    for (const [name, a] of map) a.albums = albumSets.get(name)!.size
    return [...map.values()].sort((x, y) => x.name.localeCompare(y.name))
  }, [pool])

  const q = search.trim().toLowerCase()

  const songs = useMemo(() => {
    const list = q
      ? pool.filter(t =>
          t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album.toLowerCase().includes(q))
      : pool
    const dir = sortDir === 'asc' ? 1 : -1
    const cmp = (a: LibraryTrack, b: LibraryTrack): number => {
      switch (sortField) {
        case 'artist': return (a.artist || '').localeCompare(b.artist || '') || a.title.localeCompare(b.title)
        case 'album': return (a.album || '').localeCompare(b.album || '') || byTrackNo(a, b)
        case 'duration': return a.duration - b.duration
        case 'added': return (a.addedAt || 0) - (b.addedAt || 0)
        default: return a.title.localeCompare(b.title)
      }
    }
    return [...list].sort((a, b) => cmp(a, b) * dir)
  }, [pool, q, sortField, sortDir])

  const albumsFiltered = useMemo(() => {
    const base = tab === 'recent'
      ? [...albums].sort((a, b) => b.addedAt - a.addedAt)
      : [...albums].sort((a, b) => a.name.localeCompare(b.name))
    if (!q) return base
    return base.filter(a => a.name.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q))
  }, [albums, tab, q])

  const artistsFiltered = useMemo(
    () => q ? artists.filter(a => a.name.toLowerCase().includes(q)) : artists,
    [artists, q]
  )

  // ── A–Z rail ──
  // Only meaningful on an alphabetically-sorted list; `letterIndex` maps each
  // letter to the first row that sorts under it.
  const alphaSource = tab === 'artists'
    ? artistsFiltered.map(a => a.name)
    : tab === 'songs' && (sortField === 'title' || sortField === 'artist')
      ? songs.map(t => sortField === 'artist' ? (t.artist || '') : t.title)
      : null

  const { letters, letterIndex } = useMemo(() => {
    if (!alphaSource || alphaSource.length < ALPHA_MIN_ROWS) return { letters: [] as string[], letterIndex: new Map<string, number>() }
    const idx = new Map<string, number>()
    alphaSource.forEach((s, i) => {
      const l = indexLetter(s)
      if (!idx.has(l)) idx.set(l, i)
    })
    const ordered = [...idx.keys()].sort((a, b) => (a === '#' ? -1 : b === '#' ? 1 : a.localeCompare(b)))
    return { letters: ordered, letterIndex: idx }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alphaSource?.length, tab, sortField, sortDir, q])

  const jumpToLetter = (letter: string): void => {
    const i = letterIndex.get(letter)
    const scroller = scrollRef.current
    const content = contentRef.current
    if (i === undefined || !scroller || !content) return
    const rowH = tab === 'artists' ? artistRowH : songRowH
    scroller.scrollTo({ top: content.offsetTop + i * rowH })
  }

  // ── playback ──
  const playAll = (list: LibraryTrack[], rnd = false): void => {
    const queue = (rnd ? shuffled(list) : list).map(toQueueTrack)
    if (queue.length) playCollection(queue)
  }

  const playFrom = (track: LibraryTrack, list: LibraryTrack[]): void => {
    if (currentTrack?.id === track.id) { setIsPlaying(!isPlaying); return }
    playTrack(toQueueTrack(track), list.map(toQueueTrack))
  }

  const openMenu = (track: LibraryTrack, queue: LibraryTrack[], e: React.MouseEvent): void => {
    if (selectMode) { toggleSelect(track); return }
    setCtx({ track, queue, x: e.clientX, y: e.clientY })
  }

  // ── drill targets ──
  const drillArtist = drill?.kind === 'artist' ? artists.find(a => a.name === drill.name) : undefined
  const drillArtistAlbums = useMemo(
    () => drillArtist ? albums.filter(a => a.artist === drillArtist.name).sort((x, y) => (y.year ?? 0) - (x.year ?? 0)) : [],
    [drillArtist, albums]
  )
  const drillAlbumTracks = useMemo(
    () => drill?.kind === 'album' ? [...drill.album.tracks].sort(byTrackNo) : [],
    [drill]
  )
  const drillArtistTracks = useMemo(
    () => drillArtist ? [...drillArtist.tracks].sort((a, b) => a.title.localeCompare(b.title)) : [],
    [drillArtist]
  )

  // Whatever list is on screen - what "Select all" and the play buttons act on.
  const visibleTracks = drill?.kind === 'album' ? drillAlbumTracks
    : drill?.kind === 'artist' ? drillArtistTracks
    : songs

  // Hardware back, innermost first. Registered once through a ref: handlers run
  // last-registered-first, so re-registering on every state change would let
  // this steal presses from a sheet that opened earlier.
  const backRef = useRef<() => boolean>(() => false)
  backRef.current = (): boolean => {
    if (selectMode) { exitSelectMode(); return true }
    if (drill) { setDrill(null); return true }
    if (search) { setSearch(''); return true }
    return false
  }
  useEffect(() => registerBackHandler(() => backRef.current()), [])

  // Deliberately the unfiltered count: a filter that happens to match nothing
  // is not the same as an empty library, and showing the "add a folder"
  // onboarding over a full library would be nonsense.
  const showEmpty = libraryTracks.length === 0 && !libraryScanning
  const totalDuration = useMemo(() => pool.reduce((s, t) => s + t.duration, 0), [pool])

  const rowCommon = {
    onPlay: (t: LibraryTrack) => playFrom(t, visibleTracks),
    onLongPress: toggleSelect,
    selectMode,
    currentId: currentTrack?.id ?? null,
    isPlaying,
  }

  // ── album / artist screens ──
  const drillHeader = (): JSX.Element | null => {
    if (drill?.kind === 'album') {
      const a = drill.album
      const total = drillAlbumTracks.reduce((s, t) => s + t.duration, 0)
      return (
        <div className="px-4 pb-4">
          <div className="flex flex-col items-center text-center pt-1 pb-4">
            <div className="w-44 h-44 rounded-2xl overflow-hidden bg-surface-overlay shadow-2xl">
              <FillArt track={a.coverTrack} fallback={<Music size={48} />} />
            </div>
            <h1 className="text-text-primary text-[20px] font-bold leading-tight mt-4 line-clamp-2">{a.name}</h1>
            <p className="text-text-secondary text-sm mt-1 truncate max-w-full">{a.artist}</p>
            <p className="text-text-muted text-xs mt-0.5">
              {a.year ? `${a.year} · ` : ''}{drillAlbumTracks.length} song{drillAlbumTracks.length === 1 ? '' : 's'} · {formatTotalDuration(total)}
            </p>
          </div>
          <PlayShuffleRow onPlay={() => playAll(drillAlbumTracks)} onShuffle={() => playAll(drillAlbumTracks, true)} />
        </div>
      )
    }
    if (drill?.kind === 'artist' && drillArtist) {
      const total = drillArtistTracks.reduce((s, t) => s + t.duration, 0)
      return (
        <div className="px-4 pb-4">
          <div className="flex flex-col items-center text-center pt-1 pb-4">
            <div className="w-36 h-36 rounded-full overflow-hidden bg-surface-overlay shadow-2xl">
              <FillArt track={drillArtist.coverTrack} round fallback={<User size={44} />} />
            </div>
            <h1 className="text-text-primary text-[20px] font-bold leading-tight mt-4 line-clamp-2">{drillArtist.name}</h1>
            <p className="text-text-muted text-xs mt-1">
              {drillArtistAlbums.length} album{drillArtistAlbums.length === 1 ? '' : 's'} · {drillArtistTracks.length} song{drillArtistTracks.length === 1 ? '' : 's'} · {formatTotalDuration(total)}
            </p>
          </div>
          <PlayShuffleRow onPlay={() => playAll(drillArtistTracks)} onShuffle={() => playAll(drillArtistTracks, true)} />
          {drillArtistAlbums.length > 0 && (
            <div className="mt-5 -mx-4">
              <p className="px-4 text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2">Albums</p>
              {/* Horizontal strip: an artist's albums are a short list, and a
                  carousel keeps the songs below reachable without scrolling
                  past a grid first. */}
              <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 pb-1">
                {drillArtistAlbums.map((al) => (
                  <button
                    key={al.key}
                    onClick={() => setDrill({ kind: 'album', album: al })}
                    className="w-28 shrink-0 text-left active:opacity-70"
                  >
                    <div className="w-28 h-28 rounded-xl overflow-hidden bg-surface-overlay">
                      <FillArt track={al.coverTrack} fallback={<Music size={26} />} />
                    </div>
                    <p className="text-text-primary text-[12px] font-medium truncate mt-1.5">{al.name}</p>
                    <p className="text-text-muted text-[11px] truncate">{al.year ?? `${al.tracks.length} songs`}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Songs</p>
        </div>
      )
    }
    return null
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* The header paints no background of its own - the app shell's runs
          continuously behind it - and it deliberately does not collapse in
          select mode: swapping it out mid-long-press moves the list under the
          finger. Selection controls live in the bottom bar. */}
      {drill ? (
        <div className="shrink-0 flex items-center gap-1 px-2 pb-1">
          <button
            onClick={() => setDrill(null)}
            className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-primary active:bg-surface-overlay"
            aria-label="Back"
          ><ArrowLeft size={20} /></button>
          <span className="flex-1 min-w-0 text-text-primary text-[15px] font-semibold truncate">
            {drill.kind === 'album' ? drill.album.name : drill.name}
          </span>
        </div>
      ) : (
        <div className="shrink-0">
          <div className="flex items-center gap-1 px-2">
            <div className="flex-1 min-w-0 pl-2.5">
              <h1 className="text-text-primary text-[20px] font-bold leading-tight truncate">Library</h1>
              <p className="text-text-muted text-xs truncate">
                {libraryScanning ? scanStatusText(libraryScanProgress)
                  : libraryTracks.length === 0 ? 'Nothing added yet'
                  : filterCount > 0 ? `${pool.length.toLocaleString()} of ${libraryTracks.length.toLocaleString()} songs · ${formatTotalDuration(totalDuration)}`
                  : `${pool.length.toLocaleString()} songs · ${albums.length} albums · ${formatTotalDuration(totalDuration)}`}
              </p>
            </div>
            {!showEmpty && (
              <button
                onClick={() => setSheet('filter')}
                className={`relative w-11 h-11 shrink-0 flex items-center justify-center rounded-full active:bg-surface-overlay ${
                  filterCount > 0 ? 'text-accent' : 'text-text-muted'
                }`}
                aria-label={filterCount > 0 ? `Filters (${filterCount} active)` : 'Filters'}
              >
                <SlidersHorizontal size={19} />
                {filterCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 min-w-[15px] h-[15px] px-1 rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center">
                    {filterCount}
                  </span>
                )}
              </button>
            )}
            {tab === 'songs' && (
              <button
                onClick={() => setSheet('sort')}
                className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-muted active:bg-surface-overlay"
                aria-label="Sort"
              >{sortDir === 'asc' ? <ArrowUp size={19} /> : <ArrowDown size={19} />}</button>
            )}
            <button
              onClick={() => setSheet('more')}
              className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-muted active:bg-surface-overlay"
              aria-label="Library options"
            ><MoreVertical size={19} /></button>
          </div>

          {!showEmpty && (
            <>
              <div className="flex items-center gap-2 px-4 pt-2.5 overflow-x-auto no-scrollbar">
                {TABS.map(({ key, label }) => {
                  const active = tab === key
                  return (
                    <button
                      key={key}
                      onClick={() => { setTab(key); setDrill(null) }}
                      className={`shrink-0 h-9 px-4 rounded-full text-[13px] font-medium transition-colors ${
                        active ? 'bg-accent text-white' : 'bg-surface-overlay text-text-secondary active:bg-surface-highest'
                      }`}
                    >{label}</button>
                  )
                })}
                {/* One-tap escape from a filter set that's hiding things —
                    without it a persisted filter reads as a broken library on
                    the next launch. */}
                {filterCount > 0 && (
                  <button
                    onClick={() => setFilters(NO_FILTERS)}
                    className="shrink-0 h-9 pl-3.5 pr-2.5 rounded-full bg-accent/15 text-accent text-[13px] font-medium flex items-center gap-1"
                  >
                    {filterCount} filter{filterCount === 1 ? '' : 's'} <X size={14} />
                  </button>
                )}
              </div>

              <div className="px-4 pt-2.5">
                <div className="relative flex items-center">
                  <Search size={16} className="absolute left-3.5 text-text-muted pointer-events-none" />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Songs, albums, artists"
                    enterKeyHint="search"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="w-full h-11 bg-surface-overlay rounded-full pl-10 pr-10 text-[15px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50 [&::-webkit-search-cancel-button]:hidden"
                  />
                  {search && (
                    <button
                      onClick={() => setSearch('')}
                      className="absolute right-1 w-9 h-9 flex items-center justify-center rounded-full text-text-muted active:text-text-primary"
                      aria-label="Clear search"
                    ><X size={16} /></button>
                  )}
                </div>
              </div>

              <div className="px-4 pt-2.5 pb-1">
                <PlayShuffleRow
                  onPlay={() => playAll(songs)}
                  onShuffle={() => playAll(songs, true)}
                  disabled={songs.length === 0}
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      {showEmpty ? (
        <EmptyState onOpenSettings={() => openSettings('library')} />
      ) : libraryScanning && libraryTracks.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Loader2 size={30} className="animate-spin text-accent" />
          <p className="text-text-muted text-sm">{scanStatusText(libraryScanProgress)}</p>
        </div>
      ) : (
        <div ref={scrollRef} className="relative flex-1 overflow-y-auto overscroll-contain pt-2 pb-6">
          {drill ? (
            <>
              {drillHeader()}
              {/* Windowed like every other list here: the desktop version capped
                  an artist's songs at 60 to stay mountable, which quietly hid
                  the rest. Windowing shows all of them and mounts none of the
                  off-screen ones - and each row's cover is a lazy disk read, so
                  "mounted" is not cheap. */}
              <VirtualRows
                scrollRef={scrollRef}
                contentRef={contentRef}
                count={visibleTracks.length}
                rowH={songRowH}
                render={(i) => (
                  <SongRow
                    track={visibleTracks[i]}
                    ordinal={drill.kind === 'album' ? (visibleTracks[i].trackNumber ?? i + 1) : undefined}
                    selected={selected.has(visibleTracks[i].id)}
                    onMenu={(track, e) => openMenu(track, visibleTracks, e)}
                    {...rowCommon}
                  />
                )}
              />
            </>
          ) : tab === 'artists' ? (
            artistsFiltered.length === 0 ? (
              filterCount > 0 && !q
                ? <NoMatches what="artists" onClear={() => setFilters(NO_FILTERS)} />
                : <p className="text-text-muted text-sm text-center py-16">No artists found</p>
            ) : (
              <>
                <VirtualRows
                  scrollRef={scrollRef}
                  contentRef={contentRef}
                  count={artistsFiltered.length}
                  rowH={artistRowH}
                  render={(i) => (
                    <ArtistRow artist={artistsFiltered[i]} onOpen={() => setDrill({ kind: 'artist', name: artistsFiltered[i].name })} />
                  )}
                />
                {letters.length > 1 && <AlphaRail letters={letters} onPick={jumpToLetter} />}
              </>
            )
          ) : tab === 'songs' ? (
            songs.length === 0 ? (
              filterCount > 0 && !q
                ? <NoMatches what="songs" onClear={() => setFilters(NO_FILTERS)} />
                : <p className="text-text-muted text-sm text-center py-16">No songs found</p>
            ) : (
              <>
                <VirtualRows
                  scrollRef={scrollRef}
                  contentRef={contentRef}
                  count={songs.length}
                  rowH={songRowH}
                  render={(i) => (
                    <SongRow
                      track={songs[i]}
                      selected={selected.has(songs[i].id)}
                      onMenu={(track, e) => openMenu(track, songs, e)}
                      {...rowCommon}
                    />
                  )}
                />
                {letters.length > 1 && <AlphaRail letters={letters} onPick={jumpToLetter} />}
              </>
            )
          ) : (
            albumsFiltered.length === 0 ? (
              filterCount > 0 && !q
                ? <NoMatches what="albums" onClear={() => setFilters(NO_FILTERS)} />
                : <p className="text-text-muted text-sm text-center py-16">No albums found</p>
            ) : (
              <div className="px-4">
                <AlbumGrid
                  scrollRef={scrollRef}
                  contentRef={contentRef}
                  albums={albumsFiltered}
                  onOpen={(album) => setDrill({ kind: 'album', album })}
                />
              </div>
            )
          )}
        </div>
      )}

      {/* ── Selection bar ──────────────────────────────────────────────────── */}
      {selectMode && (
        <div className="shrink-0 border-t border-[var(--border)]">
          <div className="flex items-center gap-1 pl-1 pr-2 pt-1">
            <button
              onClick={exitSelectMode}
              className="w-10 h-10 flex items-center justify-center rounded-full text-text-primary active:bg-surface-overlay"
              aria-label="Cancel selection"
            ><X size={19} /></button>
            <span className="flex-1 min-w-0 text-text-primary font-semibold text-[15px] truncate">{selected.size} selected</span>
            <button
              onClick={() => setSelected(new Map(visibleTracks.map(t => [t.id, t])))}
              className="px-3 h-10 rounded-full text-accent text-[13px] font-semibold active:bg-accent/10"
            >Select all</button>
          </div>
          <div className="flex items-stretch px-2 py-1.5">
            {([
              { key: 'queue', icon: ListPlus, label: 'Queue', onClick: () => { selectedTracks.forEach(t => addToQueue(toQueueTrack(t))); exitSelectMode() } },
              { key: 'next', icon: Play, label: 'Play next', onClick: () => { [...selectedTracks].reverse().forEach(t => playNext(toQueueTrack(t))); exitSelectMode() } },
              { key: 'more', icon: MoreVertical, label: 'More', onClick: () => setSheet('bulk') },
            ] as const).map((action) => (
              <button
                key={action.key}
                onClick={action.onClick}
                disabled={selected.size === 0}
                className="flex-1 flex flex-col items-center justify-center gap-1 py-2 rounded-2xl text-text-primary disabled:opacity-35 active:bg-surface-overlay"
              >
                <action.icon size={20} />
                <span className="text-[11px] font-medium">{action.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Sheets ─────────────────────────────────────────────────────────── */}
      {sheet === 'sort' && (
        <Sheet onClose={() => setSheet(null)} title="Sort songs by">
          {SORTS.map((s) => (
            <SheetItem
              key={s.key}
              label={s.label}
              active={sortField === s.key}
              trailing={sortField === s.key ? <Check size={17} className="text-accent shrink-0" /> : undefined}
              onClick={() => setSortField(s.key)}
            />
          ))}
          <SheetDivider />
          <SheetItem
            icon={ArrowUp} label="Ascending" active={sortDir === 'asc'}
            trailing={sortDir === 'asc' ? <Check size={17} className="text-accent shrink-0" /> : undefined}
            onClick={() => setSortDir('asc')}
          />
          <SheetItem
            icon={ArrowDown} label="Descending" active={sortDir === 'desc'}
            trailing={sortDir === 'desc' ? <Check size={17} className="text-accent shrink-0" /> : undefined}
            onClick={() => setSortDir('desc')}
          />
        </Sheet>
      )}

      {/* Filters apply as you tap them - the list behind the sheet is already
          updating, so there's nothing to "apply". The footer button just
          dismisses, with the resulting count on it. */}
      {sheet === 'filter' && (
        <Sheet onClose={() => setSheet(null)} title="Filters">
          <FilterGroup label="Length">
            {LENGTHS.map((l) => (
              <Chip
                key={l.key}
                label={l.label}
                active={filters.length === l.key}
                onClick={() => setFilters({ ...filters, length: l.key })}
              />
            ))}
          </FilterGroup>

          {extFacets.length > 1 && (
            <FilterGroup label="File type">
              {extFacets.map((f) => (
                <Chip
                  key={f.value}
                  label={<>{f.value.toUpperCase()} <span className="opacity-60">{f.count}</span></>}
                  active={filters.exts.includes(f.value)}
                  onClick={() => setFilters({ ...filters, exts: toggleIn(filters.exts, f.value) })}
                />
              ))}
            </FilterGroup>
          )}

          {genreFacets.length > 1 && (
            <FilterGroup label="Genre">
              {genreFacets.map((f) => (
                <Chip
                  key={f.value}
                  label={<>{f.value} <span className="opacity-60">{f.count}</span></>}
                  active={filters.genres.includes(f.value)}
                  onClick={() => setFilters({ ...filters, genres: toggleIn(filters.genres, f.value) })}
                />
              ))}
            </FilterGroup>
          )}

          <FilterGroup label="Other">
            <Chip
              label="Has artwork"
              active={filters.artOnly}
              onClick={() => setFilters({ ...filters, artOnly: !filters.artOnly })}
            />
          </FilterGroup>

          <div className="flex items-center gap-2 px-5 pt-3 pb-1">
            <button
              onClick={() => setFilters(NO_FILTERS)}
              disabled={filterCount === 0}
              className="h-12 px-5 rounded-full bg-surface-overlay text-text-primary text-[15px] font-semibold disabled:opacity-40 active:bg-surface-highest"
            >Reset</button>
            <button
              onClick={() => setSheet(null)}
              className="flex-1 h-12 rounded-full bg-accent text-white text-[15px] font-semibold active:opacity-80"
            >
              Show {pool.length.toLocaleString()} song{pool.length === 1 ? '' : 's'}
            </button>
          </div>
        </Sheet>
      )}

      {sheet === 'more' && (
        <Sheet onClose={() => setSheet(null)} title="Library">
          <SheetItem
            icon={libraryScanning ? Loader2 : RefreshCw}
            label={libraryScanning ? 'Scanning…' : 'Scan for new music'}
            sub={libraryScanning ? scanStatusText(libraryScanProgress)
              : libraryFolders.length === 0 ? 'Add a folder first' : `${libraryFolders.length} folder${libraryFolders.length === 1 ? '' : 's'}`}
            disabled={libraryScanning || libraryFolders.length === 0}
            onClick={() => { scanLibrary(); setSheet(null) }}
          />
          <SheetDivider />
          <SheetItem
            icon={Settings2}
            label="Library settings"
            sub="Folders, auto-refresh"
            onClick={() => { openSettings('library'); setSheet(null) }}
          />
        </Sheet>
      )}

      {sheet === 'bulk' && (
        <Sheet onClose={() => setSheet(null)} title={`${selected.size} song${selected.size === 1 ? '' : 's'} selected`}>
          <SheetItem icon={ListPlus} label="Add to queue" onClick={() => { selectedTracks.forEach(t => addToQueue(toQueueTrack(t))); exitSelectMode(); setSheet(null) }} />
          <SheetItem icon={Play} label="Play next" onClick={() => { [...selectedTracks].reverse().forEach(t => playNext(toQueueTrack(t))); exitSelectMode(); setSheet(null) }} />
          <SheetItem icon={ListMusic} label="Play these songs" onClick={() => { playAll(selectedTracks); exitSelectMode(); setSheet(null) }} />
          <SheetItem icon={Shuffle} label="Shuffle these songs" onClick={() => { playAll(selectedTracks, true); exitSelectMode(); setSheet(null) }} />
          <SheetDivider />
          <SheetItem icon={X} label="Clear selection" onClick={() => { exitSelectMode(); setSheet(null) }} />
        </Sheet>
      )}

      {ctx && (
        <SongContextMenu
          state={{ track: toQueueTrack(ctx.track), songId: userApi.trackIdToSongId(ctx.track.id), x: ctx.x, y: ctx.y } as SongContextMenuState}
          onClose={() => setCtx(null)}
          canEdit={!!account?.is_editor}
          onInfo={() => {}}
          onPlay={() => playTrack(toQueueTrack(ctx.track), ctx.queue.map(toQueueTrack))}
          onPlayNext={() => playNext(toQueueTrack(ctx.track))}
          onAddToQueue={() => addToQueue(toQueueTrack(ctx.track))}
          onSelect={() => toggleSelect(ctx.track)}
          liked={likedTrackIds.includes(ctx.track.id)}
          onToggleLike={() => toggleLike(ctx.track.id)}
        />
      )}
    </div>
  )
}
