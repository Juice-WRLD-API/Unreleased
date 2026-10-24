import { useContentMotion } from '../hooks/useContentMotion'
import { useState, useEffect, useLayoutEffect, useRef, useMemo, createContext, useContext } from 'react'
import {
  Music, Play, Pause, Shuffle, Search, MoreHorizontal,
  ChevronLeft, LayoutGrid, List, Sparkles, User,
  FolderOpen, Clock, Loader2, ChevronDown, ChevronUp, Link2, RefreshCw, X,
  CheckSquare2, Square, Pencil, ListPlus, Plus, HardDrive, ListMusic,
} from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import { LibraryTrack } from '../types'
import { libraryTrackToTrack as toQueueTrack } from '../lib/fileTypes'
import { loadAllSongs, normalizeSongTitle } from '../lib/juicewrldApi'
import { IS_ELECTRON, ELECTRON_TITLEBAR_CLEARANCE_X } from '../lib/platform'
import * as userApi from '../lib/userApi'
import SongContextMenu, { SongContextMenuState } from './SongContextMenu'
import { useVirtualWindow } from '../hooks/useVirtualWindow'
import { formatDuration, formatTotalDuration } from '../lib/format'
import { AnchoredContextMenu } from './ContextMenu'
import { addTracksInBackground } from '../lib/optimisticPlaylist'

// Windowing geometry — kept in sync with the row/card markup below.
const SONG_ROW_H = 56       // one SongRow incl. padding
const GRID_PAD = 24         // grid outer padding, px
const GRID_GAP = 20         // gap between cards, px
const CARD_MIN = 164        // min card column width, px
const CARD_TEXT_H = 64      // fixed text block beneath square art, px

// ─── helpers ────────────────────────────────────────────────────────────────

const byTrackNo = (a: LibraryTrack, b: LibraryTrack) => (a.trackNumber ?? 999) - (b.trackNumber ?? 999)

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

function SongRow({ track, index, queue, onContext, showAlbum = true }: {
  track: LibraryTrack
  index: number
  queue: LibraryTrack[]
  onContext: (track: LibraryTrack, queue: LibraryTrack[], x: number, y: number) => void
  showAlbum?: boolean
}): JSX.Element {
  const { playTrack, currentTrack, isPlaying, setIsPlaying } = useStorePick('playTrack', 'currentTrack', 'isPlaying', 'setIsPlaying')
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
    <div>
      <div
        className={`group flex items-center gap-3 pl-3 pr-2 py-2 rounded-lg transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
          isSelected ? 'bg-accent/10' : isCurrent ? 'bg-accent/5' : 'hover:bg-surface-raised'
        }`}
        role="group"
        tabIndex={0}
        aria-label={`${track.title}, ${track.artist || 'Unknown Artist'}${selectMode ? isSelected ? ', selected' : ', not selected' : ''}`}
        onClick={handleClick}
        onDoubleClick={() => { if (!selectMode) play() }}
        onKeyDown={e => {
          if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
          e.preventDefault()
          if (selectMode || e.ctrlKey || e.metaKey) sel?.toggle(track, queue, e.shiftKey)
          else play()
        }}
        onContextMenu={e => { e.preventDefault(); onContext(track, queue, e.clientX, e.clientY) }}
      >
        <div className="relative w-5 shrink-0 flex items-center justify-center">
          {selectMode
            ? (isSelected
                ? <CheckSquare2 size={14} className="text-accent" />
                : <Square size={14} className="text-text-muted" />)
            : <>
              <span className={`text-text-muted text-xs tabular-nums group-hover:invisible group-focus-within:invisible ${isCurrent ? 'invisible' : ''}`}>{index + 1}</span>
              <button onClick={e => { e.stopPropagation(); play() }} onDoubleClick={e => e.stopPropagation()}
                aria-label={isCurrent && isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
                className={`absolute inset-0 flex items-center justify-center rounded focus-visible:ring-2 focus-visible:ring-accent ${isCurrent ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}>
                {isCurrent && isPlaying
                  ? <Pause size={13} fill="currentColor" className="text-accent" />
                  : <Play size={13} fill="currentColor" className={isCurrent ? 'text-accent' : 'text-text-primary'} />}
              </button>
            </>}
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
          onDoubleClick={e => e.stopPropagation()}
          aria-label={`More options for ${track.title}`}
          className="w-7 h-7 shrink-0 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-opacity focus-visible:ring-2 focus-visible:ring-accent"
        >
          <MoreHorizontal size={15} />
        </button>
      </div>
    </div>
  )
}

// ─── album card ───────────────────────────────────────────────────────────────

function AlbumCard({ album, onOpen, onPlay }: { album: Album; onOpen: () => void; onPlay: () => void }): JSX.Element {
  const art = useTrackArt(album.coverTrack)
  return (
    <div className="group relative min-w-0 rounded-xl">
      <button onClick={onOpen} className="block w-full text-left rounded-xl focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4 focus-visible:ring-offset-surface">
        <div className="relative rounded-xl overflow-hidden aspect-square bg-surface-overlay border border-[var(--border)] mb-3">
          {art === undefined
            ? <div className="w-full h-full art-shimmer" />
            : art
            ? <img src={art} alt="" className="w-full h-full object-cover" loading="lazy" />
            : <div className="w-full h-full flex items-center justify-center text-text-muted"><Music size={40} /></div>}
          <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity" />
        </div>
        <div style={{ height: `${CARD_TEXT_H / 16}rem` }} className="overflow-hidden px-0.5">
          <p className="text-text-primary text-sm font-semibold truncate leading-5 group-hover:text-accent transition-colors" title={album.name}>{album.name}</p>
          <p className="text-text-secondary text-xs truncate leading-5" title={album.artist}>{album.artist}</p>
          <p className="text-text-muted text-xs leading-5">{album.tracks.length} {album.tracks.length === 1 ? 'song' : 'songs'}{album.year ? ` · ${album.year}` : ''}</p>
        </div>
      </button>
      <button onClick={onPlay} aria-label={`Play ${album.name}`}
        className="absolute right-3 w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-accent-hover transition-opacity focus-visible:ring-2 focus-visible:ring-text-primary"
        style={{ bottom: `${(CARD_TEXT_H + 24) / 16}rem` }}>
        <Play size={17} fill="currentColor" className="ml-0.5" />
      </button>
    </div>
  )
}

// ─── artist card (circular) ───────────────────────────────────────────────────

function ArtistCard({ artist, onOpen }: { artist: Artist; onOpen: () => void }): JSX.Element {
  const art = useTrackArt(artist.coverTrack)
  return (
    <button onClick={onOpen} className="group block w-full min-w-0 text-center rounded-xl focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4 focus-visible:ring-offset-surface">
      <div className="relative w-full aspect-square mb-3">
        <div className="relative w-full h-full rounded-full overflow-hidden bg-surface-overlay border border-[var(--border)]">
          {art === undefined
            ? <div className="w-full h-full art-shimmer" />
            : art
            ? <img src={art} alt="" className="w-full h-full object-cover" loading="lazy" />
            : <div className="w-full h-full flex items-center justify-center text-text-muted"><User size={40} /></div>}
        </div>
      </div>
      <div className="px-1 overflow-hidden" style={{ height: `${CARD_TEXT_H / 16}rem` }}>
        <p className="text-text-primary text-sm font-semibold truncate leading-5 group-hover:text-accent transition-colors">{artist.name}</p>
        <p className="text-text-secondary text-xs leading-5">{artist.albums} {artist.albums === 1 ? 'album' : 'albums'}</p>
        <p className="text-text-muted text-xs leading-5">{artist.tracks.length} {artist.tracks.length === 1 ? 'song' : 'songs'}</p>
      </div>
    </button>
  )
}

// ─── virtualized card grid (albums & artists) ─────────────────────────────────

function NoResults(): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <Search size={28} className="text-text-muted" />
      <div>
        <h2 className="text-sm font-semibold text-text-primary">No matches in your library</h2>
        <p className="text-sm text-text-muted mt-1">Try another search or change your filters.</p>
      </div>
    </div>
  )
}

function CardGrid({ count, render }: {
  count: number
  render: (i: number) => JSX.Element
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const appTextScale = useStore(s => s.appTextScale)
  const [cols, setCols] = useState(1)
  const [colW, setColW] = useState(CARD_MIN)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const compute = () => {
      const w = Math.max(0, el.clientWidth - GRID_PAD * 2 * appTextScale)
      const gap = GRID_GAP * appTextScale
      const c = Math.max(1, Math.floor((w + gap) / (CARD_MIN * appTextScale + gap)))
      setCols(c)
      setColW((w - (c - 1) * gap) / c)
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [appTextScale])

  const rowStride = colW + (CARD_TEXT_H + 12 /* mb-3 */ + GRID_GAP) * appTextScale
  const rows = Math.ceil(count / cols)
  const { start, end, totalHeight } = useVirtualWindow(scrollRef, contentRef, rows, rowStride)

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto [scrollbar-gutter:stable]" style={{ padding: `${GRID_PAD / 16}rem` }}>
      {count === 0 ? (
        <NoResults />
      ) : (
        <div ref={contentRef} style={{ height: totalHeight, position: 'relative' }}>
          {Array.from({ length: end - start }, (_, r) => {
            const row = start + r
            return (
              <div key={row} style={{
                position: 'absolute', top: row * rowStride, left: 0, right: 0,
                display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gap: GRID_GAP * appTextScale,
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

function SongList({ tracks, header, onContext, showAlbum = true }: {
  tracks: LibraryTrack[]
  header?: JSX.Element
  onContext: (track: LibraryTrack, queue: LibraryTrack[], x: number, y: number) => void
  showAlbum?: boolean
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
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 [scrollbar-gutter:stable]">
      {header}
      {tracks.length === 0 ? (
        <NoResults />
      ) : (
        <div ref={contentRef} style={{ height: totalHeight, position: 'relative' }}>
          {tracks.slice(start, end).map((t, i) => {
            const index = start + i
            return (
              <div key={t.id} style={{ position: 'absolute', top: index * rowH, left: 0, right: 0, height: rowH }}>
                <SongRow track={t} index={index} queue={tracks} onContext={onContext} showAlbum={showAlbum} />
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
      {onBack && (
        <button onClick={onBack} className="flex items-center gap-1.5 mt-4 mb-5 text-xs font-medium text-text-muted hover:text-text-primary transition-colors focus-visible:ring-2 focus-visible:ring-accent rounded-lg px-2 py-1.5 -ml-2">
          <ChevronLeft size={15} /> Back to library
        </button>
      )}
      <div className="flex flex-wrap items-end gap-6 pb-5">
        <div className={`w-32 h-32 xl:w-44 xl:h-44 overflow-hidden shrink-0 bg-surface-overlay border border-[var(--border)] flex items-center justify-center ${round ? 'rounded-full' : 'rounded-2xl'}`}>
          {art === undefined ? <div className="w-full h-full art-shimmer" />
            : art ? <img src={art} alt={title} className="w-full h-full object-cover" />
            : fallbackIcon}
        </div>
        <div className="pb-1 min-w-0 flex-1 basis-48">
          <p className="text-xs font-medium text-text-muted mb-2">{eyebrow}</p>
          <h2 className="text-text-primary text-3xl xl:text-4xl font-bold tracking-tight mb-2 break-words">{title}</h2>
          <p className="text-text-secondary text-sm break-words">{subtitle}</p>
          <p className="text-text-muted text-xs mt-2">{meta}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 pb-5 mb-2 border-b border-[var(--border)]">
        <button onClick={onPlay} className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-full text-xs font-semibold hover:bg-accent-hover transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
          <Play size={16} fill="currentColor" className="ml-0.5" /> Play
        </button>
        {onShuffle && (
          <button onClick={onShuffle} className="flex items-center gap-2 px-4 py-2 bg-surface-overlay text-text-secondary rounded-full text-xs font-semibold hover:text-text-primary hover:bg-surface-highest transition-colors focus-visible:ring-2 focus-visible:ring-accent">
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
  const { playCollection, shufflePlay } = useStorePick('playCollection', 'shufflePlay')
  const art = useTrackArt(album.coverTrack)
  const tracks = useMemo(() => [...album.tracks].sort(byTrackNo), [album])
  const total = tracks.reduce((s, t) => s + t.duration, 0)
  const play = (list: LibraryTrack[]) => { const q = list.map(toQueueTrack); if (q.length) playCollection(q) }
  const shuffle = (list: LibraryTrack[]) => { void shufflePlay(list.map(toQueueTrack)) }
  return (
    <SongList tracks={tracks} onContext={onContext} showAlbum={false} header={
      <DetailHeader
        art={art} eyebrow="Album" title={album.name}
        subtitle={`${album.artist}${album.year ? ` · ${album.year}` : ''}`}
        meta={`${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'} · ${formatTotalDuration(total)}`}
        onBack={onBack} onPlay={() => play(tracks)} onShuffle={() => shuffle(tracks)}
        fallbackIcon={<Music size={48} className="text-text-muted" />}
      />
    } />
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
  const { playCollection, shufflePlay } = useStorePick('playCollection', 'shufflePlay')
  const art = useTrackArt(artist.coverTrack)
  const allTracks = useMemo(() => [...artist.tracks].sort((a, b) => a.title.localeCompare(b.title)), [artist])
  const total = artist.tracks.reduce((s, t) => s + t.duration, 0)
  const play = (list: LibraryTrack[]) => { const q = list.map(toQueueTrack); if (q.length) playCollection(q) }
  const shuffle = (list: LibraryTrack[]) => { void shufflePlay(list.map(toQueueTrack)) }
  return (
    <SongList tracks={allTracks} onContext={onContext} header={<>
      <DetailHeader
        art={art} round eyebrow="Artist" title={artist.name}
        subtitle={`${albums.length} ${albums.length === 1 ? 'album' : 'albums'}`}
        meta={`${artist.tracks.length} ${artist.tracks.length === 1 ? 'song' : 'songs'} · ${formatTotalDuration(total)}`}
        onBack={onBack} onPlay={() => play(allTracks)} onShuffle={() => shuffle(allTracks)}
        fallbackIcon={<User size={48} className="text-text-muted" />}
      />
      {albums.length > 0 && (
        <div className="py-4">
          <h3 className="text-text-primary text-sm font-semibold mb-4">Albums</h3>
          <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(10.25rem, 1fr))' }}>
            {albums.map(a => <AlbumCard key={a.key} album={a} onOpen={() => onOpenAlbum(a)} onPlay={() => play([...a.tracks].sort(byTrackNo))} />)}
          </div>
        </div>
      )}
      <div className="pt-4 pb-3">
        <h3 className="text-text-primary text-sm font-semibold">Songs</h3>
      </div>
    </>} />
  )
}

// ─── empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onOpenSettings, onImportUrl, onScan, hasFolders }: {
  onOpenSettings: () => void
  onImportUrl: () => void
  onScan: () => void
  hasFolders: boolean
}): JSX.Element {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-6 text-center">
      <div className="min-h-full flex flex-col items-center justify-center py-6">
      <div className="w-20 h-20 rounded-2xl bg-surface-raised border border-[var(--border)] flex items-center justify-center mb-6">
        <FolderOpen size={32} strokeWidth={1.5} className="text-accent" />
      </div>
      <div className="max-w-sm">
        <h2 className="text-text-primary text-xl font-bold tracking-tight mb-2">Your music, right here</h2>
        <p className="text-text-muted text-sm leading-relaxed">{hasFolders
          ? 'Scan your folders to find your music. Your files will appear here, organized by album, artist, and song.'
          : 'Add a folder of music from your computer, or import audio from a link. Listen and organize it all here.'}</p>
      </div>
      <div className="flex flex-wrap justify-center items-center gap-2 mt-6">
        <button onClick={hasFolders ? onScan : onOpenSettings} className="flex items-center gap-2 px-4 py-2.5 bg-accent text-white rounded-full text-xs font-semibold hover:bg-accent-hover transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
          {hasFolders ? <RefreshCw size={14} /> : <FolderOpen size={14} />}{hasFolders ? 'Scan folders' : 'Add music folders'}
        </button>
        <button onClick={onImportUrl} className="flex items-center gap-2 px-4 py-2.5 bg-surface-overlay text-text-secondary rounded-full text-xs font-semibold hover:text-text-primary hover:bg-surface-highest transition-colors focus-visible:ring-2 focus-visible:ring-accent">
          <Link2 size={14} /> Add from URL
        </button>
      </div>
      <p className="text-text-muted text-xs mt-5">Local files stay on this device.</p>
      </div>
    </div>
  )
}

// ─── library tabs ────────────────────────────────────────────────────────────

type LibKey = 'recent' | 'artists' | 'albums' | 'songs'
type Nav = { kind: 'lib'; key: LibKey }

const LIB_SECTIONS: { key: LibKey; label: string; icon: JSX.Element }[] = [
  { key: 'albums', label: 'Albums', icon: <LayoutGrid size={14} /> },
  { key: 'songs', label: 'Songs', icon: <List size={14} /> },
  { key: 'artists', label: 'Artists', icon: <User size={14} /> },
  { key: 'recent', label: 'Recently added', icon: <Sparkles size={14} /> },
]

function LibraryTabs({ nav, onNav }: { nav: Nav; onNav: (n: Nav) => void }): JSX.Element {
  return (
    <div role="tablist" aria-label="Library views" className="flex flex-wrap items-center gap-1 w-fit rounded-xl bg-surface-overlay p-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      {LIB_SECTIONS.map((s, i) => (
        <button key={s.key} id={`library-tab-${s.key}`} role="tab"
          aria-selected={nav.key === s.key} aria-controls="library-content" tabIndex={nav.key === s.key ? 0 : -1}
          onClick={() => onNav({ kind: 'lib', key: s.key })}
          onKeyDown={e => {
            const offset = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
            if (!offset && e.key !== 'Home' && e.key !== 'End') return
            e.preventDefault()
            const index = e.key === 'Home' ? 0 : e.key === 'End' ? LIB_SECTIONS.length - 1 : (i + offset + LIB_SECTIONS.length) % LIB_SECTIONS.length
            const key = LIB_SECTIONS[index].key
            onNav({ kind: 'lib', key })
            document.getElementById(`library-tab-${key}`)?.focus()
          }}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-accent ${nav.key === s.key
            ? 'bg-surface text-text-primary shadow-sm'
            : 'text-text-muted hover:text-text-primary'}`}>
          {s.icon}{s.label}
        </button>
      ))}
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
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-surface-overlay text-text-muted hover:text-text-primary transition-colors focus-visible:ring-2 focus-visible:ring-accent"
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
        aria-expanded={open}
        aria-haspopup="true"
        title="Compare your local titles against the API's song list"
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-accent ${
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
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm transition-colors text-left focus-visible:ring-2 focus-visible:ring-accent ${
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
  const { libraryTracks, libraryScanning, libraryLastScanned, scanLibrary, libraryFolders, loadLibrary, openSettings, playTrack, playCollection, shufflePlay, playNext, addToQueue, account, openLocalEditor, likedTrackIds, toggleLike, openUrlImport, openBulkTrackEditor, localPlaylists, addToLocalPlaylist, createLocalPlaylist, playlists } = useStorePick('libraryTracks', 'libraryScanning', 'libraryLastScanned', 'scanLibrary', 'libraryFolders', 'loadLibrary', 'openSettings', 'playTrack', 'playCollection', 'shufflePlay', 'playNext', 'addToQueue', 'account', 'openLocalEditor', 'likedTrackIds', 'toggleLike', 'openUrlImport', 'openBulkTrackEditor', 'localPlaylists', 'addToLocalPlaylist', 'createLocalPlaylist', 'playlists')

  const [nav, setNav] = useState<Nav>(() => {
    const saved = localStorage.getItem('library:view')
    return { kind: 'lib', key: LIB_SECTIONS.find(s => s.key === saved)?.key ?? 'albums' }
  })
  const [drill, setDrill] = useState<{ kind: 'album'; album: Album } | { kind: 'artist'; name: string } | null>(null)
  const [searchQ, setSearchQ] = useState('')
  // Shared song context menu (same one the Tracker/Playlists/Player use). The
  // queue captured at open-time drives its Play/Play-next/Add-to-queue actions.
  const [ctx, setCtx] = useState<{ track: LibraryTrack; queue: LibraryTrack[]; x: number; y: number } | null>(null)
  const [sortField, setSortField] = useState<'title' | 'album' | 'duration'>('title')
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
  // Either kind of playlist: a synced one holds them as local-file entries
  // (playable on this device only, and only in a private playlist), a local
  // one by library id. The per-track context menu offers the same.
  const [showBulkPlaylists, setShowBulkPlaylists] = useState(false)
  const bulkPlBtnRef = useRef<HTMLButtonElement>(null)
  const [bulkNewName, setBulkNewName] = useState('')

  const closeBulkPlaylists = (): void => { setShowBulkPlaylists(false); setBulkNewName('') }

  const bulkAddToLocalPlaylist = (playlistId: string): void => {
    selectedTracks.forEach(t => addToLocalPlaylist(playlistId, t.id))
    closeBulkPlaylists()
    exitSelectMode()
  }

  const bulkAddToSyncedPlaylist = (playlistId: number): void => {
    const tracks = selectedTracks.map(toQueueTrack)
    closeBulkPlaylists()
    exitSelectMode()
    void addTracksInBackground(playlistId, tracks)
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
    exitSelectMode()
    closeBulkPlaylists()
    localStorage.setItem('library:view', n.key)
  }
  const toggleSort = (f: 'title' | 'album' | 'duration') => {
    if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(f); setSortDir('asc') }
  }

  useEffect(() => { loadLibrary() }, [])

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
  const drillAlbum = drill?.kind === 'album' ? albums.find(a => a.key === drill.album.key) : undefined
  const drillArtistAlbums = drillArtist ? albums.filter(a => a.artist === drillArtist.name).sort((x, y) => (y.year ?? 0) - (x.year ?? 0)) : []

  // Collection playback follows the visible search results and their order.
  const browseTracks = useMemo(() => {
    if (nav.key === 'songs') return songs
    if (nav.key === 'artists') return artistsFiltered.flatMap(a => [...a.tracks].sort((x, y) => x.title.localeCompare(y.title)))
    return albumsSorted.flatMap(a => [...a.tracks].sort(byTrackNo))
  }, [nav.key, songs, artistsFiltered, albumsSorted])

  useEffect(() => {
    if (!drill) visibleRef.current = browseTracks
    else if (!drillAlbum && !drillArtist) setDrill(null)
  }, [browseTracks, drill, drillAlbum, drillArtist])

  const playAll = (list: LibraryTrack[], rnd = false) => { const q2 = list.map(toQueueTrack); if (!q2.length) return; if (rnd) void shufflePlay(q2); else playCollection(q2) }
  const playAlbum = (a: Album) => playAll([...a.tracks].sort(byTrackNo))
  const openAlbum = (album: Album): void => { exitSelectMode(); closeBulkPlaylists(); setDrill({ kind: 'album', album }) }
  const openArtist = (name: string): void => { exitSelectMode(); closeBulkPlaylists(); setDrill({ kind: 'artist', name }) }
  const backToLibrary = (): void => { exitSelectMode(); closeBulkPlaylists(); setDrill(null) }

  const showEmpty = libraryTracks.length === 0 && !libraryScanning
  const showToolbar = !drill && libraryTracks.length > 0
  const resultCount = nav.key === 'songs' ? songs.length : nav.key === 'artists' ? artistsFiltered.length : albumsSorted.length
  const resultUnit = nav.key === 'songs' ? 'song' : nav.key === 'artists' ? 'artist' : 'album'
  const contentRef = useRef<HTMLDivElement>(null)
  const contentKey = drillAlbum ? `album:${drillAlbum.key}` : drillArtist ? `artist:${drillArtist.name}` : nav.key
  useContentMotion(contentRef, contentKey)

  const openLibrarySettings = (): void => openSettings('library')

  return (
    <SelectionCtx.Provider value={selection}>
    <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
      {/* Only controls opt out of dragging, preserving the window's title strip. */}
      <header className="shrink-0 px-6 pt-5 pb-4 border-b border-[var(--border)]">
        <div className="flex flex-wrap items-start gap-4 mb-5" style={{ paddingRight: IS_ELECTRON ? ELECTRON_TITLEBAR_CLEARANCE_X - GRID_PAD : undefined }}>
          <div className="min-w-0 flex-1 basis-48">
            <h1 className="text-xl font-bold text-text-primary mb-1">Library</h1>
            <p className="text-xs text-text-muted leading-5">{libraryTracks.length > 0
              ? `${libraryTracks.length.toLocaleString()} ${libraryTracks.length === 1 ? 'song' : 'songs'} · ${albums.length.toLocaleString()} ${albums.length === 1 ? 'album' : 'albums'} · ${artists.length.toLocaleString()} ${artists.length === 1 ? 'artist' : 'artists'}`
              : 'Your local music, all in one place.'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <button onClick={() => openUrlImport()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-surface-overlay text-text-secondary text-xs font-medium hover:bg-surface-highest hover:text-text-primary transition-colors focus-visible:ring-2 focus-visible:ring-accent">
              <Plus size={14} /> Add from URL
            </button>
            <button onClick={openLibrarySettings}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-surface-overlay text-text-secondary text-xs font-medium hover:bg-surface-highest hover:text-text-primary transition-colors focus-visible:ring-2 focus-visible:ring-accent">
              <FolderOpen size={14} /> Music folders
            </button>
            <button onClick={() => scanLibrary()} disabled={libraryScanning || libraryFolders.length === 0}
              className="w-8 h-8 flex items-center justify-center rounded-full text-text-muted hover:bg-surface-overlay hover:text-text-primary transition-colors disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={libraryScanning ? 'Scanning library' : 'Scan library'}
              title={libraryFolders.length === 0 ? 'Add a music folder to scan' : libraryScanning ? 'Scanning library…' : 'Scan library'}>
              <RefreshCw size={15} className={libraryScanning ? 'animate-spin' : undefined} />
            </button>
          </div>
        </div>
        <LibraryTabs nav={nav} onNav={navTo} />
      </header>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
        {showToolbar && (
          <div className="shrink-0 px-6 pt-4 pb-3">
            <div className="flex items-center flex-wrap gap-2.5">
              <div className="relative flex-1 min-w-[12rem]" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                <input value={searchQ} onChange={e => setSearchQ(e.target.value)} aria-label="Search library"
                  placeholder={nav.key === 'artists' ? 'Search artists…' : nav.key === 'songs' ? 'Search songs, artists, or albums…' : 'Search albums or artists…'}
                  className="w-full pl-9 pr-9 py-2 bg-surface-overlay border border-transparent rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:border-accent/40 focus:ring-1 focus:ring-accent" />
                {searchQ && <button onClick={() => setSearchQ('')} aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-text-muted hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent"><X size={14} /></button>}
              </div>
              {nav.key === 'songs' && (
                <ApiCompareDropdown value={apiFilter} onChange={setApiFilter} disabled={!apiSongNames}
                  failed={apiSongNamesFailed} onRetry={() => setApiLoadAttempt(n => n + 1)} />
              )}
              <button onClick={() => playAll(browseTracks)} disabled={browseTracks.length === 0}
                className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white rounded-full text-xs font-semibold hover:bg-accent-hover transition-colors disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
                <Play size={13} fill="currentColor" /> Play all
              </button>
              <button onClick={() => playAll(browseTracks, true)} disabled={browseTracks.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 bg-surface-overlay text-text-secondary rounded-full text-xs font-medium hover:text-text-primary hover:bg-surface-highest transition-colors disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-accent">
                <Shuffle size={14} /> Shuffle
              </button>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs text-text-muted pt-3">
              <span>{resultCount.toLocaleString()} {resultUnit}{resultCount === 1 ? '' : 's'}{q || (nav.key === 'songs' && apiFilter !== 'all') ? ' found' : ''}</span>
              {nav.key === 'recent' && <span>Newest first</span>}
            </div>
          </div>
        )}

        {/* Content */}
        <div ref={contentRef} id="library-content" role="tabpanel" aria-labelledby={`library-tab-${nav.key}`} tabIndex={0}
          className="flex-1 min-h-0 flex flex-col overflow-hidden focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent">
        {showEmpty ? (
          <EmptyState onOpenSettings={openLibrarySettings} onImportUrl={() => openUrlImport()}
            onScan={() => scanLibrary()} hasFolders={libraryFolders.length > 0} />
        ) : libraryScanning && libraryTracks.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3" role="status">
            <Loader2 size={32} className="animate-spin text-accent" />
            <p className="text-text-primary text-sm font-medium">Finding your music…</p>
            <p className="text-text-muted text-xs">Reading the audio files in your music folders.</p>
          </div>
        ) : drillAlbum ? (
          <AlbumDetail key={drillAlbum.key} album={drillAlbum} onBack={backToLibrary} onContext={openCtx} />
        ) : drillArtist ? (
          <ArtistDetail key={drillArtist.name} artist={drillArtist} albums={drillArtistAlbums} onBack={backToLibrary}
            onOpenAlbum={openAlbum} onContext={openCtx} />
        ) : nav.key === 'artists' ? (
          <CardGrid key="artists" count={artistsFiltered.length} render={i => {
            const a = artistsFiltered[i]
            return <ArtistCard key={a.name} artist={a} onOpen={() => openArtist(a.name)} />
          }} />
        ) : nav.key === 'songs' ? (
          <SongList tracks={songs} onContext={openCtx}
            header={
              <div className="sticky top-0 z-10 bg-surface flex items-center gap-3 pl-3 pr-2 py-2.5 mb-1 border-b border-[var(--border)]">
                <div className="w-5 text-xs text-text-muted text-center">#</div>
                <div className="w-10 shrink-0" />
                <button onClick={() => toggleSort('title')} aria-label={`Sort by title${sortField === 'title' ? (sortDir === 'asc' ? ', descending' : ', ascending') : ''}`} className="flex-1 flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors rounded focus-visible:ring-2 focus-visible:ring-accent">
                  Title {sortField === 'title' && (sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
                </button>
                <button onClick={() => toggleSort('album')} aria-label="Sort by album" className="hidden lg:flex items-center gap-1 w-[180px] text-xs text-text-muted hover:text-text-primary transition-colors rounded focus-visible:ring-2 focus-visible:ring-accent">
                  Album {sortField === 'album' && (sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
                </button>
                <button onClick={() => toggleSort('duration')} aria-label="Sort by duration" className="flex items-center justify-end gap-1 text-text-muted hover:text-text-primary transition-colors shrink-0 w-10 rounded focus-visible:ring-2 focus-visible:ring-accent">
                  <Clock size={11} /> {sortField === 'duration' && (sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
                </button>
                <div className="w-7" />
              </div>
            } />
        ) : (
          /* albums + recently added */
          <CardGrid key={nav.key} count={albumsSorted.length} render={i => {
            const a = albumsSorted[i]
            return <AlbumCard key={a.key} album={a} onOpen={() => openAlbum(a)} onPlay={() => playAlbum(a)} />
          }} />
        )}
        </div>

        <div className="shrink-0 flex items-center gap-2 px-6 py-2.5 border-t border-[var(--border)] text-xs text-text-muted" role="status">
          {libraryScanning ? <><Loader2 size={12} className="animate-spin text-accent" /><span>Scanning music folders…</span></> : <>
            <HardDrive size={12} />
            <span>On this device</span>
            {libraryFolders.length > 0 && <span>· {libraryFolders.length} {libraryFolders.length === 1 ? 'folder' : 'folders'}</span>}
            {!!libraryLastScanned && <span className="ml-auto truncate" title={new Date(libraryLastScanned).toLocaleString()}>Last scanned {new Date(libraryLastScanned).toLocaleDateString()}</span>}
          </>}
        </div>

        {/* Bulk selection action bar */}
        {selectMode && (
          <div className="relative z-30 shrink-0 border-t border-[var(--border)] bg-surface px-6 py-3 flex flex-wrap items-center gap-2 [&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-accent">
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
                ref={bulkPlBtnRef}
                onClick={() => setShowBulkPlaylists(v => !v)}
                disabled={selected.size === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-overlay hover:bg-surface-raised text-text-primary rounded-lg text-xs font-medium disabled:opacity-50 transition-colors"
              >
                <Plus size={13} /> Add to playlist
              </button>
              {showBulkPlaylists && (
                <AnchoredContextMenu
                  anchorRef={bulkPlBtnRef}
                  title="Add to playlist"
                  onClose={closeBulkPlaylists}
                  className="w-56"
                  items={localPlaylists.length === 0 && (!account || playlists.length === 0)
                    ? [{ label: 'No playlists yet.', disabled: true }]
                    : [
                        ...(account ? playlists.map(p => ({ icon: ListMusic, label: p.name, disabled: p.is_public, onSelect: () => bulkAddToSyncedPlaylist(p.id) })) : []),
                        ...localPlaylists.map((p, i) => ({ icon: HardDrive, label: p.name, separatorBefore: i === 0 && !!account && playlists.length > 0, onSelect: () => bulkAddToLocalPlaylist(p.id) })),
                      ]}
                  footer={(
                    <div className="flex items-center gap-1.5 p-1">
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
                  )}
                />
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
