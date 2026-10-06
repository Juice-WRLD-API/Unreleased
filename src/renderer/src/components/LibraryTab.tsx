import { useState, useEffect, useRef, useMemo, createContext, useContext } from 'react'
import {
  Music, Play, Pause, Shuffle, Search, MoreHorizontal,
  ChevronLeft, ChevronRight, LayoutGrid, List, Sparkles, User,
  FolderOpen, Clock, Loader2, GripVertical, ChevronDown, ChevronUp, Link2,
  CheckSquare2, Square, Pencil, ListPlus, Plus, HardDrive,
} from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import { LibraryTrack } from '../types'
import { libraryTrackToTrack as toQueueTrack } from '../lib/fileTypes'
import { loadAllSongs, normalizeSongTitle } from '../lib/juicewrldApi'
import { fisherYates } from '../store/queueSlice'
import * as userApi from '../lib/userApi'
import SongContextMenu, { SongContextMenuState } from './SongContextMenu'
import { useVirtualWindow } from '../hooks/useVirtualWindow'
import { formatDuration, formatTotalDuration } from '../lib/format'

/* ══════════════════════════════════════════════════════════════════════════════
   Library — local-file browser styled like the rest of the app (solid surfaces,
   standard tokens). An in-view rail on the left (Library sections) drives a
   contextual main pane. Album grids and the song list are windowed so a
   multi-thousand-track library stays light.
   ══════════════════════════════════════════════════════════════════════════════ */

// Windowing geometry — kept in sync with the row/card markup below.
const SONG_ROW_H = 56       // one SongRow incl. padding
const GRID_PAD = 20         // grid outer padding, px
const GRID_GAP = 20         // gap between cards, px
const CARD_MIN = 150        // min card column width, px
const CARD_TEXT_H = 60      // fixed text block beneath square art, px

// ─── helpers ────────────────────────────────────────────────────────────────

const byTrackNo = (a: LibraryTrack, b: LibraryTrack) => (a.trackNumber ?? 999) - (b.trackNumber ?? 999)
const shuffled = fisherYates

// ─── multi-select ─────────────────────────────────────────────────────────────
// Song rows appear three levels down in some views (song list, album detail,
// artist detail), so selection travels by context rather than through every
// intermediate component's props. Rows report the list they belong to on each
// interaction, which is what makes shift-click ranges and "Select all" work in
// whichever view is on screen.

interface LibrarySelection {
  selectMode: boolean
  selected: Map<string, LibraryTrack>
  /** `extend` = shift-click: takes everything between the anchor and here. */
  toggle: (track: LibraryTrack, list: LibraryTrack[], extend: boolean) => void
  /** Lets the action bar's "Select all" act on whatever view is showing. */
  registerVisible: (tracks: LibraryTrack[]) => void
}

const SelectionCtx = createContext<LibrarySelection | null>(null)

/** Publishes the list a view is rendering, so "Select all" hits exactly what
 *  the user can see rather than the whole library. */
function useVisibleTracks(tracks: LibraryTrack[]): void {
  const sel = useContext(SelectionCtx)
  useEffect(() => { sel?.registerVisible(tracks) }, [tracks, sel])
}

// ─── album / artist models ───────────────────────────────────────────────────

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

// ─── lazy album-art loading hook ──────────────────────────────────────────────
// Covers live in the store's `libraryArt` map keyed by track id: `undefined`
// until read off disk, then `null` (artless) or a data URI. This subscribes a
// thumbnail to just its own entry and kicks off the read once. The main-process
// read is itself cached (in memory + on disk, artless files remembered as ''),
// so this never re-parses a file it has already seen.
//
// NB: we intentionally do NOT gate on `track.hasAlbumArt` — the scan runs with
// `skipCovers: true`, which makes music-metadata drop the picture tag entirely,
// so that flag is always false and gating on it hid every cover. The on-demand
// read + cache is the real optimization for artless files.

// The same track can be visible in several places at once (song list, album
// grid, playlist mosaic) — without this, each thumbnail fired its own
// readAlbumArt parse before the first result landed in the store.
const inflightArt = new Set<string>()

function useTrackArt(track: LibraryTrack): string | null | undefined {
  const el = (window as any).electron
  const { applyLibraryArt } = useStorePick('applyLibraryArt')
  const art = useStore((s) => s.libraryArt[track.id])
  useEffect(() => {
    if (!el || art !== undefined || inflightArt.has(track.id)) return
    inflightArt.add(track.id)
    el.readAlbumArt(track.filePath)
      .then((a: string | null) => applyLibraryArt(track.id, a ?? null))
      .catch(() => applyLibraryArt(track.id, null)) // end the shimmer rather than spin forever
      .finally(() => inflightArt.delete(track.id))
  }, [track.id, art])
  return art
}

/** Small square thumbnail. Exported — PlaylistsView reuses it. */
export function AlbumArtThumb({ track, size = 48 }: { track: LibraryTrack; size?: number }): JSX.Element {
  const art = useTrackArt(track)
  // rem, not px, so the thumbnail scales with the app text-size setting (which
  // drives the root font-size) rather than staying pinned while its rem-sized
  // wrapper and neighbouring text grow around it. Identical at normal scale.
  const rem = `${size / 16}rem`
  if (art) return <img src={art} alt="" className="object-cover" style={{ width: rem, height: rem }} />
  return (
    <div className="flex items-center justify-center bg-surface-overlay text-text-muted" style={{ width: rem, height: rem }}>
      <Music size={`${(size * 0.4) / 16}rem`} />
    </div>
  )
}

// ─── song row ─────────────────────────────────────────────────────────────────

function SongRow({ track, index, queue, onContext, showAlbum = true, draggable, onDragStart, onDragOver, onDrop }: {
  track: LibraryTrack
  index: number
  queue: LibraryTrack[]
  onContext: (track: LibraryTrack, queue: LibraryTrack[], x: number, y: number) => void
  showAlbum?: boolean
  draggable?: boolean
  onDragStart?: () => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: () => void
}): JSX.Element {
  const { playTrack, currentTrack, isPlaying, setIsPlaying } = useStorePick('playTrack', 'currentTrack', 'isPlaying', 'setIsPlaying')
  const [hover, setHover] = useState(false)
  const sel = useContext(SelectionCtx)

  const isCurrent = currentTrack?.id === track.id
  const selectMode = !!sel?.selectMode
  const isSelected = !!sel?.selected.has(track.id)

  const play = () => {
    if (isCurrent) { setIsPlaying(!isPlaying); return }
    playTrack(toQueueTrack(track), queue.map(toQueueTrack))
  }

  // Ctrl/Cmd-click starts a selection from anywhere; once in select mode a
  // plain click toggles and shift-click takes the range — the same convention
  // the Tracker's multi-select uses.
  const handleClick = (e: React.MouseEvent): void => {
    if (selectMode) { sel?.toggle(track, queue, e.shiftKey); return }
    if (e.ctrlKey || e.metaKey) sel?.toggle(track, queue, false)
  }

  return (
    <div className="px-1.5">
      <div
        className={`group flex items-center gap-3 pl-3 pr-2 py-2 rounded-lg transition-colors cursor-pointer ${
          isSelected ? 'bg-accent/10' : isCurrent ? 'bg-surface-raised' : 'hover:bg-surface-raised'
        } ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={handleClick}
        onDoubleClick={() => { if (!selectMode) play() }}
        onContextMenu={e => { e.preventDefault(); onContext(track, queue, e.clientX, e.clientY) }}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {draggable && <GripVertical size={14} className="text-text-muted opacity-0 group-hover:opacity-100 shrink-0 -ml-1" />}
        <div className="w-5 shrink-0 flex items-center justify-center">
          {selectMode
            ? (isSelected
                ? <CheckSquare2 size={14} className="text-accent" />
                : <Square size={14} className="text-text-muted" />)
            : hover || isCurrent
            ? <button onClick={e => { e.stopPropagation(); play() }}>
                {isCurrent && isPlaying
                  ? <Pause size={13} fill="currentColor" className="text-accent" />
                  : <Play size={13} fill="currentColor" className={isCurrent ? 'text-accent' : 'text-text-primary'} />}
              </button>
            : <span className="text-text-muted text-xs tabular-nums">{index + 1}</span>}
        </div>
        <div className="w-10 h-10 rounded overflow-hidden shrink-0 bg-surface-overlay">
          <AlbumArtThumb track={track} size={40} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm truncate ${isCurrent ? 'text-accent font-medium' : 'text-text-primary'}`} title={track.title}>{track.title}</p>
          <p className="text-text-muted text-xs truncate">{track.artist || 'Unknown Artist'}</p>
        </div>
        {showAlbum && <span className="text-text-muted text-xs truncate w-[180px] shrink-0 hidden lg:block">{track.album}</span>}
        <span className="text-text-muted text-xs shrink-0 tabular-nums w-10 text-right">{formatDuration(track.duration, '--:--')}</span>
        <button
          onClick={e => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onContext(track, queue, r.right, r.bottom) }}
          className="w-7 h-7 shrink-0 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-all"
        >
          <MoreHorizontal size={15} />
        </button>
      </div>
    </div>
  )
}

// ─── album card ───────────────────────────────────────────────────────────────

function AlbumCard({ album, onOpen, onPlay }: { album: Album; onOpen: () => void; onPlay: () => void }): JSX.Element {
  const [hover, setHover] = useState(false)
  const art = useTrackArt(album.coverTrack)
  return (
    <div className="group cursor-pointer select-none" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onClick={onOpen}>
      <div className="relative aspect-square mb-3">
        <div className="relative rounded-lg overflow-hidden aspect-square bg-surface-overlay border border-[var(--border)] shadow-sm">
          {art === undefined
            ? <div className="w-full h-full art-shimmer" />
            : art
            ? <img src={art} alt={album.name} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-text-muted"><Music size={40} /></div>}
          <div className={`absolute inset-0 flex items-end p-3 transition-opacity duration-200 ${hover ? 'opacity-100' : 'opacity-0'}`}
            style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.45), transparent 55%)' }}>
            <button onClick={e => { e.stopPropagation(); onPlay() }}
              className="ml-auto w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center shadow-lg hover:bg-accent-hover transition-colors">
              <Play size={16} fill="currentColor" className="ml-0.5" />
            </button>
          </div>
        </div>
      </div>
      <div style={{ height: CARD_TEXT_H }} className="overflow-hidden px-0.5">
        <p className="text-text-primary text-sm font-medium truncate leading-5">{album.name}</p>
        <p className="text-text-secondary text-xs truncate leading-4">{album.artist}{album.year ? ` · ${album.year}` : ''}</p>
        <p className="text-text-muted text-[11px] leading-4">{album.tracks.length} {album.tracks.length === 1 ? 'song' : 'songs'}</p>
      </div>
    </div>
  )
}

// ─── artist card (circular) ───────────────────────────────────────────────────

function ArtistCard({ artist, onOpen }: { artist: Artist; onOpen: () => void }): JSX.Element {
  const art = useTrackArt(artist.coverTrack)
  return (
    <button onClick={onOpen} className="group flex flex-col items-center gap-3 select-none">
      <div className="relative w-full aspect-square">
        <div className="relative w-full h-full rounded-full overflow-hidden bg-surface-overlay border border-[var(--border)] shadow-sm">
          {art === undefined
            ? <div className="w-full h-full art-shimmer" />
            : art
            ? <img src={art} alt={artist.name} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-text-muted"><User size={40} /></div>}
        </div>
      </div>
      <div className="text-center px-1 w-full">
        <p className="text-text-primary text-sm font-medium truncate">{artist.name}</p>
        <p className="text-text-muted text-[11px]">{artist.tracks.length} {artist.tracks.length === 1 ? 'song' : 'songs'}</p>
      </div>
    </button>
  )
}

// ─── virtualized card grid (albums & artists) ─────────────────────────────────

function CardGrid({ count, render, circular = false }: {
  count: number
  render: (i: number) => JSX.Element
  circular?: boolean
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(1)
  const [colW, setColW] = useState(CARD_MIN)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const compute = () => {
      const w = el.clientWidth - GRID_PAD * 2
      const c = Math.max(1, Math.floor((w + GRID_GAP) / (CARD_MIN + GRID_GAP)))
      setCols(c)
      setColW((w - (c - 1) * GRID_GAP) / c)
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const textH = circular ? 52 : CARD_TEXT_H
  const rowStride = colW + textH + 12 /* mb-3 */ + GRID_GAP
  const rows = Math.ceil(count / cols)
  const { start, end, totalHeight } = useVirtualWindow(scrollRef, contentRef, rows, rowStride)

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto view-enter" style={{ padding: GRID_PAD }}>
      {count === 0 ? (
        <p className="text-text-muted text-sm text-center py-16">Nothing here yet</p>
      ) : (
        <div ref={contentRef} style={{ height: totalHeight, position: 'relative' }}>
          {Array.from({ length: end - start }, (_, r) => {
            const row = start + r
            return (
              <div key={row} style={{
                position: 'absolute', top: row * rowStride, left: 0, right: 0,
                display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gap: GRID_GAP,
              }}>
                {Array.from({ length: Math.min(cols, count - row * cols) }, (_, c) => render(row * cols + c))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── virtualized song list ────────────────────────────────────────────────────

function SongList({ tracks, header, onContext }: {
  tracks: LibraryTrack[]
  header?: JSX.Element
  onContext: (track: LibraryTrack, queue: LibraryTrack[], x: number, y: number) => void
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // Windowed row height must be concrete px, so scale it with the app text-size
  // setting — the row's rem-based cover/text grow with it, and a fixed 56 would
  // otherwise clip them (and shrink the cover) at larger scales.
  const appTextScale = useStore(s => s.appTextScale)
  const rowH = Math.round(SONG_ROW_H * appTextScale)
  const { start, end, totalHeight } = useVirtualWindow(scrollRef, contentRef, tracks.length, rowH)
  useVisibleTracks(tracks)
  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto py-3 px-2.5 view-enter">
      {header}
      {tracks.length === 0 ? (
        <p className="text-text-muted text-sm text-center py-16">No songs found</p>
      ) : (
        <div ref={contentRef} style={{ height: totalHeight, position: 'relative' }}>
          {tracks.slice(start, end).map((t, i) => {
            const index = start + i
            return (
              <div key={t.id} style={{ position: 'absolute', top: index * rowH, left: 0, right: 0, height: rowH }}>
                <SongRow track={t} index={index} queue={tracks} onContext={onContext} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── detail header (shared by album & artist) ──────────────────────────────────

function DetailHeader({ art, eyebrow, title, subtitle, meta, round, onBack, onPlay, onShuffle, fallbackIcon }: {
  art?: string | null
  eyebrow: string
  title: string
  subtitle: string
  meta: string
  round?: boolean
  onBack?: () => void
  onPlay: () => void
  onShuffle?: () => void
  fallbackIcon: JSX.Element
}): JSX.Element {
  return (
    <>
      <div className={`flex items-end gap-5 p-6 pb-4 ${onBack ? 'pt-14' : ''}`}>
        {onBack && (
          <button onClick={onBack} className="absolute top-3 left-3 w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors">
            <ChevronLeft size={18} />
          </button>
        )}
        <div className={`w-40 h-40 overflow-hidden shrink-0 bg-surface-overlay border border-[var(--border)] shadow-lg flex items-center justify-center ${round ? 'rounded-full' : 'rounded-xl'}`}>
          {art === undefined ? <div className="w-full h-full art-shimmer" />
            : art ? <img src={art} alt={title} className="w-full h-full object-cover" />
            : fallbackIcon}
        </div>
        <div className="pb-1 min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">{eyebrow}</p>
          <h1 className="text-text-primary text-3xl font-bold mb-1 truncate">{title}</h1>
          <p className="text-text-secondary text-sm truncate">{subtitle}</p>
          <p className="text-text-muted text-xs mt-1">{meta}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 px-6 pb-4">
        <button onClick={onPlay} className="flex items-center gap-2 px-5 py-2 bg-accent text-white rounded-lg text-sm font-semibold hover:bg-accent-hover transition-colors">
          <Play size={16} fill="currentColor" className="ml-0.5" /> Play
        </button>
        {onShuffle && (
          <button onClick={onShuffle} className="flex items-center gap-2 px-5 py-2 bg-surface-overlay border border-[var(--border)] text-text-primary rounded-lg text-sm font-semibold hover:bg-surface-highest transition-colors">
            <Shuffle size={16} /> Shuffle
          </button>
        )}
      </div>
    </>
  )
}

// ─── detail: album ────────────────────────────────────────────────────────────

function AlbumDetail({ album, onBack, onContext }: {
  album: Album; onBack: () => void; onContext: (track: LibraryTrack, queue: LibraryTrack[], x: number, y: number) => void
}): JSX.Element {
  const { playCollection } = useStorePick('playCollection')
  const art = useTrackArt(album.coverTrack)
  const tracks = useMemo(() => [...album.tracks].sort(byTrackNo), [album])
  useVisibleTracks(tracks)
  const total = tracks.reduce((s, t) => s + t.duration, 0)
  const play = (list: LibraryTrack[]) => { const q = list.map(toQueueTrack); if (q.length) playCollection(q) }
  return (
    <div className="flex-1 overflow-y-auto relative view-enter">
      <DetailHeader
        art={art} eyebrow="Album" title={album.name}
        subtitle={`${album.artist}${album.year ? ` · ${album.year}` : ''}`}
        meta={`${tracks.length} songs · ${formatTotalDuration(total)}`}
        onBack={onBack} onPlay={() => play(tracks)} onShuffle={() => play(shuffled(tracks))}
        fallbackIcon={<Music size={48} className="text-text-muted" />}
      />
      <div className="px-3 pb-8">
        {tracks.map((t, i) => <SongRow key={t.id} track={t} index={i} queue={tracks} onContext={onContext} showAlbum={false} />)}
      </div>
    </div>
  )
}

// ─── detail: artist ───────────────────────────────────────────────────────────

function ArtistDetail({ artist, albums, onBack, onOpenAlbum, onContext }: {
  artist: Artist
  albums: Album[]
  onBack: () => void
  onOpenAlbum: (a: Album) => void
  onContext: (track: LibraryTrack, queue: LibraryTrack[], x: number, y: number) => void
}): JSX.Element {
  const { playCollection } = useStorePick('playCollection')
  const art = useTrackArt(artist.coverTrack)
  const allTracks = useMemo(() => [...artist.tracks].sort((a, b) => a.title.localeCompare(b.title)), [artist])
  useVisibleTracks(allTracks)
  const total = artist.tracks.reduce((s, t) => s + t.duration, 0)
  const play = (list: LibraryTrack[]) => { const q = list.map(toQueueTrack); if (q.length) playCollection(q) }
  return (
    <div className="flex-1 overflow-y-auto relative view-enter">
      <DetailHeader
        art={art} round eyebrow="Artist" title={artist.name}
        subtitle={`${albums.length} ${albums.length === 1 ? 'album' : 'albums'}`}
        meta={`${artist.tracks.length} songs · ${formatTotalDuration(total)}`}
        onBack={onBack} onPlay={() => play(allTracks)} onShuffle={() => play(shuffled(allTracks))}
        fallbackIcon={<User size={48} className="text-text-muted" />}
      />
      {albums.length > 0 && (
        <div className="px-6 pb-2">
          <h2 className="text-text-primary text-lg font-bold mb-3">Albums</h2>
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
            {albums.map(a => <AlbumCard key={a.key} album={a} onOpen={() => onOpenAlbum(a)} onPlay={() => play([...a.tracks].sort(byTrackNo))} />)}
          </div>
        </div>
      )}
      <div className="px-6 pt-4 pb-2">
        <h2 className="text-text-primary text-lg font-bold">Songs</h2>
      </div>
      <div className="px-3 pb-8">
        {allTracks.slice(0, 60).map((t, i) => <SongRow key={t.id} track={t} index={i} queue={allTracks} onContext={onContext} />)}
      </div>
    </div>
  )
}

// ─── empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onOpenSettings, onImportUrl }: { onOpenSettings: () => void; onImportUrl: () => void }): JSX.Element {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="w-20 h-20 rounded-full bg-surface-overlay flex items-center justify-center">
        <Music size={36} className="text-text-muted" />
      </div>
      <div>
        <h2 className="text-text-primary text-xl font-semibold mb-1">Your library is empty</h2>
        <p className="text-text-muted text-sm max-w-xs">Add folders in Settings → Library Folders and scan, or import audio straight from a YouTube link.</p>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onOpenSettings} className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-lg text-sm font-semibold hover:bg-accent-hover transition-colors">
          <FolderOpen size={15} /> Add Folders
        </button>
        <button onClick={onImportUrl} className="flex items-center gap-2 px-5 py-2.5 bg-surface-overlay border border-[var(--border)] text-text-primary rounded-lg text-sm font-semibold hover:bg-surface-raised transition-colors">
          <Link2 size={15} /> Import from URL
        </button>
      </div>
    </div>
  )
}

// ─── browse rail ──────────────────────────────────────────────────────────────

type LibKey = 'recent' | 'artists' | 'albums' | 'songs'
type Nav = { kind: 'lib'; key: LibKey }

const LIB_SECTIONS: { key: LibKey; label: string; icon: JSX.Element }[] = [
  { key: 'recent', label: 'Recently Added', icon: <Sparkles size={16} /> },
  { key: 'artists', label: 'Artists', icon: <User size={16} /> },
  { key: 'albums', label: 'Albums', icon: <LayoutGrid size={16} /> },
  { key: 'songs', label: 'Songs', icon: <List size={16} /> },
]

const LS_RAIL_COLLAPSED = 'library:railCollapsed'

function BrowseRail({ nav, onNav, songCount }: { nav: Nav; onNav: (n: Nav) => void; songCount: number }): JSX.Element {
  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem(LS_RAIL_COLLAPSED) === 'true')
  const toggle = (): void => setCollapsed(c => { const next = !c; localStorage.setItem(LS_RAIL_COLLAPSED, String(next)); return next })

  const row = (active: boolean) =>
    `w-full flex items-center gap-3 px-3 py-2 rounded text-sm font-medium transition-colors ${
      active ? 'bg-surface-raised text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-surface-raised'
    }`
  // Labels fade to zero-width when collapsed so only the icons remain (matches Sidebar).
  const label = (extra = ''): string =>
    `truncate text-left transition-opacity duration-200 ${collapsed ? 'w-0 flex-none opacity-0 pointer-events-none' : `opacity-100 ${extra}`}`

  return (
    <div className={`shrink-0 flex flex-col bg-surface-raised border-r border-[var(--border)] overflow-x-hidden overflow-y-auto transition-[width] duration-200 ${collapsed ? 'w-14' : 'w-52'}`}>
      <div className="flex items-center px-4 pt-5 pb-3 min-h-[2.75rem]">
        <h1 className={`text-text-primary text-lg font-bold ${label('flex-1')}`}>Library</h1>
      </div>

      <div className="px-2 space-y-1">
        {LIB_SECTIONS.map(s => (
          <button key={s.key} onClick={() => onNav({ kind: 'lib', key: s.key })}
            title={collapsed ? s.label : undefined}
            className={row(nav.kind === 'lib' && nav.key === s.key)}>
            <span className="shrink-0">{s.icon}</span>
            <span aria-hidden={collapsed} className={label('flex-1')}>{s.label}</span>
            {s.key === 'songs' && <span aria-hidden={collapsed} className={`text-[10px] text-text-muted transition-opacity duration-200 ${collapsed ? 'w-0 opacity-0 pointer-events-none' : 'opacity-100'}`}>{songCount}</span>}
          </button>
        ))}
      </div>

      {/* Collapse toggle */}
      <button
        onClick={toggle}
        title={collapsed ? 'Expand menu' : 'Collapse menu'}
        className="mt-auto m-2 flex items-center gap-3 px-3 py-2 rounded text-sm font-medium text-text-muted hover:text-text-primary hover:bg-surface-raised transition-colors"
      >
        <span className="shrink-0">{collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</span>
        <span aria-hidden={collapsed} className={label('flex-1')}>Collapse</span>
      </button>
    </div>
  )
}

function ApiCompareDropdown({ value, onChange, disabled, failed, onRetry }: {
  value: 'all' | 'matched' | 'unmatched'
  onChange: (v: 'all' | 'matched' | 'unmatched') => void
  disabled: boolean
  failed: boolean
  onRetry: () => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent): void => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const handleKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const options: { value: 'all' | 'matched' | 'unmatched'; label: string }[] = [
    { value: 'all', label: 'All songs' },
    { value: 'matched', label: 'In API' },
    { value: 'unmatched', label: 'Not in API' },
  ]
  const currentLabel = options.find(o => o.value === value)?.label ?? 'All songs'

  if (failed) {
    return (
      <button
        onClick={onRetry}
        title="Couldn't load the API song list — click to retry"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-overlay text-text-muted hover:text-text-primary transition-colors"
      >
        Compare failed — retry
      </button>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={disabled}
        title="Compare your local titles against the API's song list"
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 ${
          open || value !== 'all' ? 'bg-accent/15 text-accent' : 'bg-surface-overlay text-text-muted hover:text-text-primary'
        }`}
      >
        {currentLabel}
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-40 bg-surface border border-[var(--border)] rounded-xl shadow-2xl z-50 p-1.5">
          {options.map(o => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false) }}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm transition-colors text-left ${
                value === o.value ? 'bg-accent/12 text-accent font-medium' : 'text-text-secondary hover:text-text-primary hover:bg-surface-raised'
              }`}
            >
              {value === o.value
                ? <CheckSquare2 size={14} className="text-accent shrink-0" />
                : <Square size={14} className="text-text-muted opacity-40 shrink-0" />}
              <span className="flex-1 truncate">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── main ─────────────────────────────────────────────────────────────────────

export default function LibraryTab(): JSX.Element {
  const { libraryTracks, libraryScanning, scanLibrary, libraryFolders, loadLibrary, setShowSettings, playTrack, playCollection, playNext, addToQueue, account, openLocalEditor, likedTrackIds, toggleLike, openUrlImport, openBulkTrackEditor, localPlaylists, addToLocalPlaylist, createLocalPlaylist } = useStorePick('libraryTracks', 'libraryScanning', 'scanLibrary', 'libraryFolders', 'loadLibrary', 'setShowSettings', 'playTrack', 'playCollection', 'playNext', 'addToQueue', 'account', 'openLocalEditor', 'likedTrackIds', 'toggleLike', 'openUrlImport', 'openBulkTrackEditor', 'localPlaylists', 'addToLocalPlaylist', 'createLocalPlaylist')

  const [nav, setNav] = useState<Nav>(() => ({ kind: 'lib', key: (localStorage.getItem('library:view') as LibKey) || 'albums' }))
  const [drill, setDrill] = useState<{ kind: 'album'; album: Album } | { kind: 'artist'; name: string } | null>(null)
  const [searchQ, setSearchQ] = useState('')
  // Shared song context menu (same one the Tracker/Playlists/Player use). The
  // queue captured at open-time drives its Play/Play-next/Add-to-queue actions.
  const [ctx, setCtx] = useState<{ track: LibraryTrack; queue: LibraryTrack[]; x: number; y: number } | null>(null)
  const [sortField, setSortField] = useState<'title' | 'album' | 'duration' | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [apiFilter, setApiFilter] = useState<'all' | 'matched' | 'unmatched'>('all')
  const [apiSongNames, setApiSongNames] = useState<Set<string> | null>(null)
  const [apiSongNamesFailed, setApiSongNamesFailed] = useState(false)
  const [apiLoadAttempt, setApiLoadAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setApiSongNamesFailed(false)
    loadAllSongs().then((all) => {
      if (cancelled) return
      const names = new Set<string>()
      for (const song of all) {
        const n = normalizeSongTitle(song.name)
        if (n) names.add(n)
        for (const alt of song.track_titles ?? []) {
          const an = normalizeSongTitle(alt)
          if (an) names.add(an)
        }
      }
      setApiSongNames(names)
    }).catch(() => { if (!cancelled) setApiSongNamesFailed(true) })
    return () => { cancelled = true }
  }, [apiLoadAttempt])

  const trackMatchesApi = (t: LibraryTrack): boolean => !!apiSongNames && apiSongNames.has(normalizeSongTitle(t.title))

  // ── multi-select (drives the bulk tag editor) ──
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Map<string, LibraryTrack>>(new Map())
  // Anchor for shift-click ranges, and the list currently on screen (set by
  // whichever view is rendering song rows — see useVisibleTracks).
  const anchorRef = useRef<string | null>(null)
  const visibleRef = useRef<LibraryTrack[]>([])

  const selection = useMemo<LibrarySelection>(() => ({
    selectMode,
    selected,
    registerVisible: (tracks) => { visibleRef.current = tracks },
    toggle: (track, list, extend) => {
      setSelectMode(true)
      setSelected(prev => {
        const next = new Map(prev)
        const anchor = anchorRef.current
        if (extend && anchor) {
          const from = list.findIndex(t => t.id === anchor)
          const to = list.findIndex(t => t.id === track.id)
          if (from >= 0 && to >= 0) {
            const [a, b] = from < to ? [from, to] : [to, from]
            for (let i = a; i <= b; i++) next.set(list[i].id, list[i])
            return next
          }
        }
        if (next.has(track.id)) next.delete(track.id)
        else next.set(track.id, track)
        return next
      })
      if (!extend) anchorRef.current = track.id
    },
  }), [selectMode, selected])

  const exitSelectMode = (): void => {
    setSelectMode(false)
    setSelected(new Map())
    anchorRef.current = null
  }

  // Deselecting the last track drops out of select mode on its own, so there's
  // no separate "Cancel" needed. Escape works too.
  useEffect(() => {
    if (selectMode && selected.size === 0) setSelectMode(false)
  }, [selectMode, selected])

  useEffect(() => {
    if (!selectMode) return
    const onKeyDown = (e: KeyboardEvent): void => { if (e.key === 'Escape') exitSelectMode() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectMode])

  const selectedTracks = useMemo(() => [...selected.values()], [selected])

  // ── Bulk "Add to playlist" ──
  // Library files are device-only, so local playlists are the only valid
  // target (a scanned file has no song id to give a synced playlist). The
  // per-track context menu has always offered this; the bulk bar hadn't.
  const [showBulkPlaylists, setShowBulkPlaylists] = useState(false)
  const [bulkNewName, setBulkNewName] = useState('')

  const closeBulkPlaylists = (): void => { setShowBulkPlaylists(false); setBulkNewName('') }

  const bulkAddToLocalPlaylist = (playlistId: string): void => {
    selectedTracks.forEach(t => addToLocalPlaylist(playlistId, t.id))
    closeBulkPlaylists()
    exitSelectMode()
  }

  const bulkCreateAndAdd = (): void => {
    const name = bulkNewName.trim()
    if (!name) return
    createLocalPlaylist(name)
    // createLocalPlaylist applies synchronously and parks the new id in
    // activeLocalPlaylistId (same trick SongContextMenu uses).
    const newId = useStore.getState().activeLocalPlaylistId
    if (newId) selectedTracks.forEach(t => addToLocalPlaylist(newId, t.id))
    closeBulkPlaylists()
    exitSelectMode()
  }

  const openCtx = (track: LibraryTrack, queue: LibraryTrack[], x: number, y: number) => setCtx({ track, queue, x, y })

  const navTo = (n: Nav) => {
    setNav(n); setDrill(null)
    if (n.kind === 'lib') localStorage.setItem('library:view', n.key)
  }
  const toggleSort = (f: 'title' | 'album' | 'duration') => {
    if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(f); setSortDir('asc') }
  }

  useEffect(() => { loadLibrary() }, [])
  // Reset drill when switching rail section
  useEffect(() => { setDrill(null) }, [nav])

  // ── derived collections ──
  const albums = useMemo<Album[]>(() => {
    const map = new Map<string, Album>()
    for (const t of libraryTracks) {
      const key = `${t.album || 'Unknown Album'}__${t.albumArtist || t.artist || 'Unknown Artist'}`
      let a = map.get(key)
      if (!a) { a = { key, name: t.album || 'Unknown Album', artist: t.albumArtist || t.artist || 'Unknown Artist', year: t.year, addedAt: 0, tracks: [], coverTrack: t }; map.set(key, a) }
      a.tracks.push(t)
      a.addedAt = Math.max(a.addedAt, t.addedAt || 0)
      if (t.trackNumber === 1 || (!a.coverTrack.hasAlbumArt && t.hasAlbumArt)) a.coverTrack = t
    }
    return [...map.values()]
  }, [libraryTracks])

  const artists = useMemo<Artist[]>(() => {
    const map = new Map<string, Artist>()
    const albumSets = new Map<string, Set<string>>()
    for (const t of libraryTracks) {
      const name = t.albumArtist || t.artist || 'Unknown Artist'
      let a = map.get(name)
      if (!a) { a = { name, tracks: [], albums: 0, coverTrack: t }; map.set(name, a); albumSets.set(name, new Set()) }
      a.tracks.push(t)
      albumSets.get(name)!.add(t.album || 'Unknown Album')
      if (!a.coverTrack.hasAlbumArt && t.hasAlbumArt) a.coverTrack = t
    }
    for (const [name, a] of map) a.albums = albumSets.get(name)!.size
    return [...map.values()].sort((x, y) => x.name.localeCompare(y.name))
  }, [libraryTracks])

  const q = searchQ.trim().toLowerCase()

  const albumsSorted = useMemo(() => {
    const base = nav.kind === 'lib' && nav.key === 'recent'
      ? [...albums].sort((a, b) => b.addedAt - a.addedAt)
      : [...albums].sort((a, b) => a.name.localeCompare(b.name))
    if (!q) return base
    return base.filter(a => a.name.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q))
  }, [albums, nav, q])

  const artistsFiltered = useMemo(() => q ? artists.filter(a => a.name.toLowerCase().includes(q)) : artists, [artists, q])

  const apiFilteredTracks = useMemo(() => {
    if (apiFilter === 'all' || !apiSongNames || nav.kind !== 'lib' || nav.key !== 'songs') return libraryTracks
    return libraryTracks.filter(t => apiFilter === 'matched' ? trackMatchesApi(t) : !trackMatchesApi(t))
  }, [libraryTracks, apiFilter, apiSongNames, nav])

  const songs = useMemo(() => {
    let list = q ? apiFilteredTracks.filter(t => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album.toLowerCase().includes(q)) : apiFilteredTracks
    if (sortField) {
      list = [...list].sort((a, b) => {
        let av: string | number, bv: string | number
        if (sortField === 'title') { av = a.title.toLowerCase(); bv = b.title.toLowerCase() }
        else if (sortField === 'album') { av = (a.album || '').toLowerCase(); bv = (b.album || '').toLowerCase() }
        else { av = a.duration; bv = b.duration }
        return sortDir === 'asc' ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0)
      })
    }
    return list
  }, [apiFilteredTracks, q, sortField, sortDir])

  const drillArtist = drill?.kind === 'artist' ? artists.find(a => a.name === drill.name) : undefined
  const drillArtistAlbums = drillArtist ? albums.filter(a => a.artist === drillArtist.name).sort((x, y) => (y.year ?? 0) - (x.year ?? 0)) : []

  const playAll = (list: LibraryTrack[], rnd = false) => { const q2 = (rnd ? shuffled(list) : list).map(toQueueTrack); if (q2.length) playCollection(q2) }
  const playAlbum = (a: Album) => playAll([...a.tracks].sort(byTrackNo))

  const showEmpty = libraryTracks.length === 0 && !libraryScanning
  const showToolbar = !drill && nav.kind === 'lib'

  const title = drill?.kind === 'album' ? drill.album.name
    : drill?.kind === 'artist' ? drill.name
    : LIB_SECTIONS.find(s => s.key === nav.key)?.label ?? 'Library'

  return (
    <SelectionCtx.Provider value={selection}>
    <div className="flex-1 flex overflow-hidden bg-surface">
      <BrowseRail nav={nav} onNav={navTo} songCount={libraryTracks.length} />

      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Toolbar (grid/list sections only; detail views carry their own header) */}
        {showToolbar && !showEmpty && !libraryScanning && (
          /* The whole bar must NOT be app-region:no-drag — Chromium computes drag
             regions as flat rect math (drag minus no-drag, stacking ignored), so a
             full-width no-drag bar here erased App's titlebar drag strip and made
             the window unmovable on this view. Only the controls punch holes. */
          <div className="shrink-0 flex items-center flex-wrap gap-x-3 gap-y-2 px-5 py-3 border-b border-[var(--border)]" style={{ paddingRight: (window as any).electron ? 188 : undefined }}>
            <h2 className="text-text-primary text-xl font-bold shrink-0">{title}</h2>
            <div className="relative flex-1 min-w-[120px] max-w-xs ml-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search library…"
                className="w-full pl-8 pr-3 py-1.5 bg-surface-overlay border border-[var(--border)] rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors" />
            </div>
            <div className="flex items-center gap-2 ml-auto" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
              {libraryTracks.length > 0 && (
                <>
                  <button onClick={() => playAll(songs)} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent-hover transition-colors">
                    <Play size={12} fill="currentColor" /> Play
                  </button>
                  <button onClick={() => playAll(songs, true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-overlay border border-[var(--border)] text-text-muted rounded-lg text-xs font-medium hover:text-text-primary transition-colors">
                    <Shuffle size={12} /> Shuffle
                  </button>
                </>
              )}
              {nav.kind === 'lib' && nav.key === 'songs' && libraryTracks.length > 0 && (
                <ApiCompareDropdown
                  value={apiFilter}
                  onChange={setApiFilter}
                  disabled={!apiSongNames}
                  failed={apiSongNamesFailed}
                  onRetry={() => setApiLoadAttempt(n => n + 1)}
                />
              )}
              <button onClick={() => openUrlImport()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-overlay border border-[var(--border)] text-text-muted rounded-lg text-xs font-medium hover:text-text-primary transition-colors"
                title="Download audio from a link into your library">
                <Link2 size={12} /> Add from URL
              </button>
              <button onClick={() => scanLibrary()} disabled={libraryScanning || libraryFolders.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-overlay border border-[var(--border)] text-text-muted rounded-lg text-xs font-medium hover:text-text-primary transition-colors disabled:opacity-40"
                title={libraryFolders.length === 0 ? 'Add folders in Settings first' : 'Scan library'}>
                {libraryScanning ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                {libraryScanning ? 'Scanning…' : 'Scan'}
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        {showEmpty ? (
          <EmptyState onOpenSettings={() => setShowSettings(true)} onImportUrl={() => openUrlImport()} />
        ) : libraryScanning ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <Loader2 size={32} className="animate-spin text-accent" />
            <p className="text-text-muted text-sm">Scanning your library…</p>
          </div>
        ) : drill?.kind === 'album' ? (
          <AlbumDetail album={drill.album} onBack={() => setDrill(null)} onContext={openCtx} />
        ) : drill?.kind === 'artist' && drillArtist ? (
          <ArtistDetail artist={drillArtist} albums={drillArtistAlbums} onBack={() => setDrill(null)}
            onOpenAlbum={a => setDrill({ kind: 'album', album: a })} onContext={openCtx} />
        ) : nav.kind === 'lib' && nav.key === 'artists' ? (
          <CardGrid circular count={artistsFiltered.length} render={i => {
            const a = artistsFiltered[i]
            return <ArtistCard key={a.name} artist={a} onOpen={() => setDrill({ kind: 'artist', name: a.name })} />
          }} />
        ) : nav.kind === 'lib' && nav.key === 'songs' ? (
          <SongList tracks={songs} onContext={openCtx}
            header={
              <div className="flex items-center gap-3 px-4 py-1.5 mb-1">
                <div className="w-5 text-[10px] text-text-muted uppercase tracking-wider text-center">#</div>
                <div className="w-10 shrink-0" />
                <button onClick={() => toggleSort('title')} className="flex-1 flex items-center gap-1 text-[10px] text-text-muted uppercase tracking-wider hover:text-text-primary transition-colors">
                  Title {sortField === 'title' && (sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
                </button>
                <button onClick={() => toggleSort('album')} className="hidden lg:flex items-center gap-1 w-[180px] text-[10px] text-text-muted uppercase tracking-wider hover:text-text-primary transition-colors">
                  Album {sortField === 'album' && (sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
                </button>
                <button onClick={() => toggleSort('duration')} className="flex items-center justify-end gap-1 text-text-muted hover:text-text-primary transition-colors shrink-0 w-10">
                  <Clock size={11} /> {sortField === 'duration' && (sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
                </button>
                <div className="w-7" />
              </div>
            } />
        ) : (
          /* albums + recently added */
          <CardGrid count={albumsSorted.length} render={i => {
            const a = albumsSorted[i]
            return <AlbumCard key={a.key} album={a} onOpen={() => setDrill({ kind: 'album', album: a })} onPlay={() => playAlbum(a)} />
          }} />
        )}

        {/* Bulk selection action bar */}
        {selectMode && (
          <div className="relative z-30 shrink-0 border-t border-[var(--border)] bg-surface px-4 py-2.5 flex items-center gap-2">
            <span className="text-sm text-text-primary font-medium flex-1">
              {selected.size} selected
            </span>
            <button
              onClick={() => setSelected(new Map(visibleRef.current.map(t => [t.id, t])))}
              className="text-xs text-text-muted hover:text-text-primary px-2 py-1 rounded transition-colors"
            >
              Select all
            </button>
            <button
              onClick={exitSelectMode}
              className="text-xs text-text-muted hover:text-text-primary px-2 py-1 rounded transition-colors"
            >
              Clear
            </button>
            <button
              onClick={() => { selectedTracks.forEach(t => addToQueue(toQueueTrack(t))) }}
              disabled={selected.size === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-overlay hover:bg-surface-raised text-text-primary rounded-lg text-xs font-medium disabled:opacity-50 transition-colors"
            >
              <ListPlus size={13} /> Add to queue
            </button>
            <div className="relative">
              <button
                onClick={() => setShowBulkPlaylists(v => !v)}
                disabled={selected.size === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-overlay hover:bg-surface-raised text-text-primary rounded-lg text-xs font-medium disabled:opacity-50 transition-colors"
              >
                <Plus size={13} /> Add to playlist
              </button>
              {showBulkPlaylists && (
                <>
                  <div className="fixed inset-0 z-40" onClick={closeBulkPlaylists} />
                  <div className="absolute right-0 bottom-full mb-1 z-50 w-56 bg-surface border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden">
                    <div className="px-3 py-2 border-b border-[var(--border)] text-[11px] uppercase tracking-wider text-text-muted font-semibold">
                      Add to playlist
                    </div>
                    <div className="max-h-56 overflow-y-auto py-1">
                      {localPlaylists.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-text-muted">No playlists yet.</p>
                      ) : localPlaylists.map(p => (
                        <button
                          key={p.id}
                          onClick={() => bulkAddToLocalPlaylist(p.id)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
                        >
                          <HardDrive size={14} className="shrink-0 text-text-muted" />
                          <span className="flex-1 truncate">{p.name}</span>
                        </button>
                      ))}
                    </div>
                    <div className="border-t border-[var(--border)] p-2 flex items-center gap-1.5">
                      <input
                        value={bulkNewName}
                        onChange={e => setBulkNewName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') bulkCreateAndAdd() }}
                        placeholder="New playlist…"
                        className="flex-1 min-w-0 bg-surface-overlay border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                      />
                      <button
                        onClick={bulkCreateAndAdd}
                        disabled={!bulkNewName.trim()}
                        className="shrink-0 p-1.5 rounded-lg bg-accent text-white disabled:opacity-40 transition-opacity"
                        title="Create playlist and add selection"
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
            <button
              onClick={() => openBulkTrackEditor(selectedTracks)}
              disabled={selected.size === 0}
              title="Edit tags across every selected file"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
            >
              <Pencil size={13} /> Edit tags
            </button>
          </div>
        )}
      </div>

      {ctx && (
        <SongContextMenu
          state={{ track: toQueueTrack(ctx.track), songId: userApi.trackIdToSongId(ctx.track.id), x: ctx.x, y: ctx.y } as SongContextMenuState}
          onClose={() => setCtx(null)}
          canEdit={!!account?.is_editor}
          onInfo={() => {}}
          onPlay={() => playTrack(toQueueTrack(ctx.track), ctx.queue.map(toQueueTrack))}
          onPlayNext={() => playNext(toQueueTrack(ctx.track))}
          onAddToQueue={() => addToQueue(toQueueTrack(ctx.track))}
          onSelect={() => selection.toggle(ctx.track, ctx.queue, false)}
          onEditLocalMetadata={() => openLocalEditor(ctx.track)}
          liked={likedTrackIds.includes(ctx.track.id)}
          onToggleLike={() => toggleLike(ctx.track.id)}
        />
      )}
    </div>
    </SelectionCtx.Provider>
  )
}
