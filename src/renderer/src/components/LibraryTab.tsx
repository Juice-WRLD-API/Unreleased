import { useContentMotion } from '../hooks/useContentMotion'
import { useState, useEffect, useLayoutEffect, useRef, useMemo, createContext, useContext } from 'react'
import {
  Music, Play, Pause, Shuffle, Search, MoreHorizontal,
  ChevronLeft, ChevronRight, User, Disc3, Library,
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
import { Tile } from './Tile'
import './LibraryTab.css'

// Windowing geometry — kept in sync with the row/card markup below.
const SONG_ROW_H = 64       // one SongRow incl. padding
const GRID_PAD = 16         // grid outer padding, px
const GRID_GAP = 12         // gap between cards, px
const CARD_MIN = 300        // min card column width, px
const CARD_H = 128          // horizontal album/artist card, px

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
        className={`group flex items-center gap-3 pl-3 pr-2 h-16 border-b border-[var(--border)] transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
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
        <div className="w-11 h-11 rounded-lg overflow-hidden shrink-0 bg-surface-overlay">
          <AlbumArtThumb track={track} size={44} />
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
    <div className="library-album group">
      <button onClick={onOpen} className="library-album-open">
        <div className="library-album-cover">
          {art === undefined
            ? <div className="w-full h-full art-shimmer" />
            : art
            ? <img src={art} alt="" className="w-full h-full object-cover" loading="lazy" />
            : <div className="w-full h-full flex items-center justify-center text-text-muted"><Disc3 size={32} strokeWidth={1.3} /></div>}
        </div>
        <div className="min-w-0 flex-1 self-stretch flex flex-col justify-center py-1">
          <p className="text-text-primary text-sm font-semibold line-clamp-2 leading-5" title={album.name}>{album.name}</p>
          <p className="text-text-secondary text-xs truncate mt-1" title={album.artist}>{album.artist}</p>
          <p className="text-text-muted text-[11px] mt-auto pt-2 pr-8 truncate">{album.tracks.length} {album.tracks.length === 1 ? 'song' : 'songs'}{album.year ? ` · ${album.year}` : ''}</p>
        </div>
      </button>
      <button onClick={onPlay} aria-label={`Play ${album.name}`} className="library-album-play">
        <Play size={13} fill="currentColor" className="ml-0.5" />
      </button>
    </div>
  )
}

// ─── artist card (circular) ───────────────────────────────────────────────────

function ArtistCard({ artist, onOpen }: { artist: Artist; onOpen: () => void }): JSX.Element {
  const art = useTrackArt(artist.coverTrack)
  return (
    <button onClick={onOpen} className="library-artist">
        <div className="w-20 h-20 shrink-0 rounded-full overflow-hidden bg-surface-overlay">
          {art === undefined
            ? <div className="w-full h-full art-shimmer" />
            : art
            ? <img src={art} alt="" className="w-full h-full object-cover" loading="lazy" />
            : <div className="w-full h-full flex items-center justify-center text-text-muted"><User size={28} strokeWidth={1.3} /></div>}
        </div>
      <div className="min-w-0 flex-1">
        <p className="text-text-primary text-base font-semibold truncate">{artist.name}</p>
        <p className="text-text-secondary text-xs mt-2">{artist.albums} {artist.albums === 1 ? 'album' : 'albums'}</p>
        <p className="text-text-muted text-xs mt-1">{artist.tracks.length} {artist.tracks.length === 1 ? 'song' : 'songs'}</p>
      </div>
      <ChevronRight size={16} className="shrink-0 text-text-muted" />
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

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const compute = () => {
      const w = Math.max(0, el.clientWidth - GRID_PAD * 2 * appTextScale)
      const gap = GRID_GAP * appTextScale
      const c = Math.max(1, Math.floor((w + gap) / (CARD_MIN * appTextScale + gap)))
      setCols(c)
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [appTextScale])

  const rowStride = (CARD_H + GRID_GAP) * appTextScale
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
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 [scrollbar-gutter:stable]">
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
        <button onClick={onBack} className="flex items-center gap-1.5 my-3 text-xs font-medium text-text-muted hover:text-text-primary rounded-lg px-2 py-1.5 -ml-2">
          <ChevronLeft size={15} /> Back to collection
        </button>
      )}
      <div className="flex flex-wrap items-center gap-5 p-5 mb-5 rounded-2xl bg-surface-raised border border-[var(--border)]">
        <div className={`w-24 h-24 overflow-hidden shrink-0 bg-surface-overlay flex items-center justify-center ${round ? 'rounded-full' : 'rounded-xl'}`}>
          {art === undefined ? <div className="w-full h-full art-shimmer" />
            : art ? <img src={art} alt={title} className="w-full h-full object-cover" />
            : fallbackIcon}
        </div>
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-xs text-text-muted mb-1">{eyebrow}</p>
          <h2 className="text-text-primary text-2xl font-semibold tracking-tight mb-1 break-words">{title}</h2>
          <p className="text-text-secondary text-sm break-words">{subtitle}</p>
          <p className="text-text-muted text-xs mt-2">{meta}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onPlay} aria-label={`Play ${title}`} className="flex items-center justify-center w-12 h-12 bg-accent text-black rounded-full hover:bg-accent-hover">
            <Play size={21} fill="currentColor" className="ml-0.5" />
          </button>
          {onShuffle && <button onClick={onShuffle} aria-label={`Shuffle ${title}`} className="flex items-center justify-center w-10 h-10 text-text-secondary rounded-full hover:text-text-primary hover:bg-surface-overlay"><Shuffle size={18} /></button>}
        </div>
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
          <div className="library-album-grid">
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
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto py-12 px-5">
        <div className="flex items-center gap-3 mb-5 text-text-muted"><Disc3 size={38} strokeWidth={1} /><Music size={24} strokeWidth={1.3} /></div>
        <h2 className="text-3xl font-semibold tracking-tight text-text-primary">Add music to your library</h2>
        <p className="text-sm text-text-secondary mt-3 max-w-md leading-relaxed">Bring your own collection into Unreleased. Albums, artists, and songs will be organized here, ready to play.</p>
        <div className="library-album-grid mt-8">
          <button onClick={hasFolders ? onScan : onOpenSettings} className="flex items-start gap-4 p-5 text-left rounded-2xl border border-[var(--border)] bg-surface-raised hover:bg-surface-overlay">
            <FolderOpen size={22} className="text-accent shrink-0 mt-1" />
            <span><span className="block text-sm font-semibold text-text-primary">{hasFolders ? 'Scan music folders' : 'Choose music folders'}</span><span className="block text-xs text-text-muted leading-relaxed mt-2">{hasFolders ? 'Find audio in the folders you have already added.' : 'Use the audio files already on your computer.'}</span></span>
            <ChevronRight size={16} className="text-text-muted shrink-0 mt-1" />
          </button>
          <button onClick={onImportUrl} className="flex items-start gap-4 p-5 text-left rounded-2xl border border-[var(--border)] bg-surface-raised hover:bg-surface-overlay">
            <Link2 size={22} className="text-accent shrink-0 mt-1" />
            <span><span className="block text-sm font-semibold text-text-primary">Import from a link</span><span className="block text-xs text-text-muted leading-relaxed mt-2">Download audio into your local collection.</span></span>
            <ChevronRight size={16} className="text-text-muted shrink-0 mt-1" />
          </button>
        </div>
        <p className="flex items-center gap-2 text-text-muted text-xs mt-6"><HardDrive size={13} /> Stored on this device</p>
      </div>
    </div>
  )
}

// ─── library tabs ────────────────────────────────────────────────────────────

type LibKey = 'overview' | 'recent' | 'artists' | 'albums' | 'songs'
type Nav = { kind: 'lib'; key: LibKey }

const LIB_SECTIONS: { key: LibKey; label: string }[] = [
  { key: 'overview', label: 'Collection' },
  { key: 'albums', label: 'Albums' },
  { key: 'songs', label: 'Songs' },
  { key: 'artists', label: 'Artists' },
  { key: 'recent', label: 'Recently added' },
]

function LibraryOverview({ tracks, albums, artists, onNav, onOpenAlbum, onOpenArtist, onPlayAlbum, onShuffle, onContext, onSettings }: {
  tracks: LibraryTrack[]
  albums: Album[]
  artists: Artist[]
  onNav: (nav: Nav) => void
  onOpenAlbum: (album: Album) => void
  onOpenArtist: (name: string) => void
  onPlayAlbum: (album: Album) => void
  onShuffle: () => void
  onContext: (track: LibraryTrack, queue: LibraryTrack[], x: number, y: number) => void
  onSettings: () => void
}): JSX.Element {
  const { libraryFolders, libraryScanning, libraryLastScanned, scanLibrary } = useStorePick('libraryFolders', 'libraryScanning', 'libraryLastScanned', 'scanLibrary')
  const recentAlbums = useMemo(() => [...albums].sort((a, b) => b.addedAt - a.addedAt).slice(0, 6), [albums])
  const recentTracks = useMemo(() => [...tracks].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)), [tracks])
  const shownTracks = useMemo(() => recentTracks.slice(0, 6), [recentTracks])
  const featuredArtists = useMemo(() => [...artists].sort((a, b) => b.tracks.length - a.tracks.length).slice(0, 4), [artists])
  const duration = useMemo(() => tracks.reduce((sum, t) => sum + t.duration, 0), [tracks])
  useVisibleTracks(shownTracks)
  const shortcuts: { key: LibKey; label: string; count: number; icon: JSX.Element }[] = [
    { key: 'songs', label: 'Songs', count: tracks.length, icon: <Music size={20} /> },
    { key: 'albums', label: 'Albums', count: albums.length, icon: <Disc3 size={20} /> },
    { key: 'artists', label: 'Artists', count: artists.length, icon: <User size={20} /> },
  ]
  return (
    <div className="flex-1 min-h-0 overflow-y-auto pr-1 pb-1 [scrollbar-gutter:stable]">
      <nav aria-label="Browse your library" className="library-shortcuts mb-4">
        {shortcuts.map(s => <button key={s.key} onClick={() => onNav({ kind: 'lib', key: s.key })} className="library-shortcut">
          <span className="text-accent shrink-0">{s.icon}</span>
          <span className="flex-1 min-w-0"><span className="block text-sm font-semibold text-text-primary">{s.label}</span><span className="block text-xs text-text-muted mt-0.5">{s.count.toLocaleString()} in your library</span></span>
          <ChevronRight size={15} className="text-text-muted shrink-0" />
        </button>)}
      </nav>
      <div className="library-overview">
        <div className="min-w-0 flex flex-col gap-4">
          <Tile title="Recently added" icon={<Disc3 size={15} />} action={{ label: 'All albums', onClick: () => onNav({ kind: 'lib', key: 'recent' }) }} span="shrink-0">
            <div className="library-album-grid">
              {recentAlbums.map(album => <AlbumCard key={album.key} album={album} onOpen={() => onOpenAlbum(album)} onPlay={() => onPlayAlbum(album)} />)}
            </div>
          </Tile>
          <Tile title="Latest songs" icon={<Music size={15} />} action={{ label: 'All songs', onClick: () => onNav({ kind: 'lib', key: 'songs' }) }} span="shrink-0">
            <div className="-mx-2">
              {shownTracks.map((t, i) => <SongRow key={t.id} track={t} index={i} queue={recentTracks} onContext={onContext} showAlbum={false} />)}
            </div>
          </Tile>
        </div>
        <div className="library-overview-side min-w-0 flex flex-col gap-4">
          <Tile span="shrink-0">
            <div className="flex items-center gap-2 text-xs text-text-muted mb-3"><HardDrive size={14} /> On this device</div>
            <h2 className="text-lg font-semibold text-text-primary">Your collection</h2>
            <p className="text-xs text-text-secondary mt-1.5 mb-4">{tracks.length.toLocaleString()} songs · {formatTotalDuration(duration)}</p>
            <button onClick={onShuffle} className="flex items-center justify-center gap-2 py-2.5 rounded-full bg-accent text-black text-xs font-semibold hover:bg-accent-hover"><Shuffle size={14} /> Shuffle your library</button>
          </Tile>
          <Tile title="Artists" icon={<User size={15} />} action={{ label: 'All', onClick: () => onNav({ kind: 'lib', key: 'artists' }) }} span="shrink-0">
            <div className="space-y-1 -mx-1">
              {featuredArtists.map(artist => <button key={artist.name} onClick={() => onOpenArtist(artist.name)} className="w-full flex items-center gap-3 p-2 rounded-xl text-left hover:bg-surface-raised">
                <span className="w-10 h-10 shrink-0 rounded-full overflow-hidden"><AlbumArtThumb track={artist.coverTrack} size={40} /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-text-primary truncate">{artist.name}</span><span className="block text-xs text-text-muted mt-0.5">{artist.tracks.length} {artist.tracks.length === 1 ? 'song' : 'songs'}</span></span>
                <ChevronRight size={13} className="text-text-muted shrink-0" />
              </button>)}
            </div>
          </Tile>
          <Tile title="Music folders" icon={<FolderOpen size={15} />} action={{ label: 'Manage', onClick: onSettings }} span="shrink-0">
            {libraryFolders.length > 0 ? <div className="space-y-3 mb-4">
              {libraryFolders.slice(0, 3).map(folder => <div key={folder} className="flex items-start gap-2.5" title={folder}>
                <FolderOpen size={15} className="shrink-0 text-text-muted mt-0.5" />
                <div className="min-w-0"><p className="text-xs font-medium text-text-primary truncate">{folder.split(/[\\/]/).filter(Boolean).pop() || folder}</p><p className="text-[11px] text-text-muted truncate mt-0.5">{folder}</p></div>
              </div>)}
              {libraryFolders.length > 3 && <button onClick={onSettings} className="text-xs text-text-secondary hover:text-text-primary">{libraryFolders.length - 3} more folders</button>}
            </div> : <p className="text-xs text-text-muted leading-relaxed mb-4">Add your music folders to keep this collection up to date.</p>}
            <button onClick={() => scanLibrary()} disabled={libraryScanning || libraryFolders.length === 0} className="flex items-center justify-center gap-2 py-2 rounded-lg bg-surface-raised text-xs font-medium text-text-secondary hover:text-text-primary disabled:opacity-40">
              <RefreshCw size={13} className={libraryScanning ? 'animate-spin' : undefined} />{libraryScanning ? 'Scanning…' : 'Scan for music'}
            </button>
            {!!libraryLastScanned && <p className="text-[11px] text-text-muted mt-2.5" title={new Date(libraryLastScanned).toLocaleString()}>Last scan {new Date(libraryLastScanned).toLocaleDateString()}</p>}
          </Tile>
        </div>
      </div>
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

  const [nav, setNav] = useState<Nav>({ kind: 'lib', key: 'overview' })
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
  const [showLibraryMenu, setShowLibraryMenu] = useState(false)
  const libraryMenuRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (nav.key !== 'songs' || apiSongNames) return
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
  }, [apiLoadAttempt, nav.key, apiSongNames])

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
    setSearchQ('')
    setApiFilter('all')
    exitSelectMode()
    closeBulkPlaylists()
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
    if (nav.key === 'overview') return libraryTracks
    if (nav.key === 'songs') return songs
    if (nav.key === 'artists') return artistsFiltered.flatMap(a => [...a.tracks].sort((x, y) => x.title.localeCompare(y.title)))
    return albumsSorted.flatMap(a => [...a.tracks].sort(byTrackNo))
  }, [nav.key, songs, artistsFiltered, albumsSorted, libraryTracks])

  useEffect(() => {
    if (!drill && nav.key !== 'overview') visibleRef.current = browseTracks
    else if (drill && !drillAlbum && !drillArtist) setDrill(null)
  }, [browseTracks, drill, drillAlbum, drillArtist, nav.key])

  const playAll = (list: LibraryTrack[], rnd = false) => { const q2 = list.map(toQueueTrack); if (!q2.length) return; if (rnd) void shufflePlay(q2); else playCollection(q2) }
  const playAlbum = (a: Album) => playAll([...a.tracks].sort(byTrackNo))
  const openAlbum = (album: Album): void => { exitSelectMode(); closeBulkPlaylists(); setDrill({ kind: 'album', album }) }
  const openArtist = (name: string): void => { exitSelectMode(); closeBulkPlaylists(); setDrill({ kind: 'artist', name }) }
  const backToLibrary = (): void => { exitSelectMode(); closeBulkPlaylists(); setDrill(null) }

  const showEmpty = libraryTracks.length === 0 && !libraryScanning
  const isOverview = nav.key === 'overview' && !drill
  const showToolbar = !isOverview && !drill && libraryTracks.length > 0
  const resultCount = nav.key === 'songs' ? songs.length : nav.key === 'artists' ? artistsFiltered.length : albumsSorted.length
  const resultUnit = nav.key === 'songs' ? 'song' : nav.key === 'artists' ? 'artist' : 'album'
  const contentRef = useRef<HTMLDivElement>(null)
  const contentKey = drillAlbum ? `album:${drillAlbum.key}` : drillArtist ? `artist:${drillArtist.name}` : nav.key
  useContentMotion(contentRef, contentKey)

  const openLibrarySettings = (): void => openSettings('library')
  const sectionTitle = LIB_SECTIONS.find(s => s.key === nav.key)?.label ?? 'Collection'

  return (
    <SelectionCtx.Provider value={selection}>
    <div className="library-workspace">
      {/* Only individual controls opt out of the native titlebar drag region. */}
      <header className="library-topbar" style={{ paddingRight: IS_ELECTRON ? ELECTRON_TITLEBAR_CLEARANCE_X - 24 : undefined }}>
        <div className="flex items-center gap-2 min-w-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <h1>
            <button onClick={() => navTo({ kind: 'lib', key: 'overview' })} className="flex items-center gap-2 text-xl font-bold text-text-primary rounded-lg">
              <Library size={21} strokeWidth={1.6} /> Library
            </button>
          </h1>
          {!isOverview && <>
            <ChevronRight size={14} className="text-text-muted shrink-0" />
            {drill
              ? <span className="text-sm text-text-secondary truncate max-w-[14rem]">{drillAlbum?.name ?? drillArtist?.name}</span>
              : <select value={nav.key} onChange={e => navTo({ kind: 'lib', key: e.target.value as LibKey })} aria-label="Library view"
                  className="max-w-[10rem] bg-transparent text-sm text-text-secondary rounded-lg py-1.5 pr-1 cursor-pointer">
                  {LIB_SECTIONS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>}
          </>}
        </div>
        {!drill && libraryTracks.length > 0 && <div className="relative flex-1 min-w-[11rem] ml-auto" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input value={searchQ} onChange={e => {
            if (isOverview) navTo({ kind: 'lib', key: 'songs' })
            setSearchQ(e.target.value)
          }} aria-label="Search library"
            placeholder={nav.key === 'artists' ? 'Find an artist…' : nav.key === 'albums' || nav.key === 'recent' ? 'Find an album…' : 'Find music in your library…'}
            className="w-full pl-9 pr-8 py-2 rounded-full bg-surface-raised border border-[var(--border)] text-sm text-text-primary placeholder:text-text-muted" />
          {searchQ && <button onClick={() => setSearchQ('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-text-muted hover:text-text-primary"><X size={13} /></button>}
        </div>}
        <div className={'relative shrink-0 ' + (drill || libraryTracks.length === 0 ? 'ml-auto' : '')} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button ref={libraryMenuRef} onClick={() => setShowLibraryMenu(v => !v)} aria-haspopup="menu" aria-expanded={showLibraryMenu}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-accent text-black text-xs font-semibold hover:bg-accent-hover">
            <Plus size={15} /> Add music
          </button>
          {showLibraryMenu && <AnchoredContextMenu anchorRef={libraryMenuRef} title="Library" onClose={() => setShowLibraryMenu(false)} className="w-52" items={[
            { icon: FolderOpen, label: 'Music folders', onSelect: openLibrarySettings },
            { icon: Link2, label: 'Import from a link', onSelect: () => openUrlImport() },
            { icon: RefreshCw, label: libraryScanning ? 'Scanning…' : 'Scan for music', separatorBefore: true, disabled: libraryScanning || libraryFolders.length === 0, onSelect: () => { void scanLibrary() } },
          ]} />}
        </div>
      </header>
      {libraryScanning && libraryTracks.length > 0 && <div role="status" className="shrink-0 flex items-center gap-2 text-xs text-text-muted"><Loader2 size={13} className="animate-spin text-accent" /> Updating your collection…</div>}

      <div className={isOverview || showEmpty ? 'flex-1 min-h-0 flex flex-col overflow-hidden relative' : 'library-collection relative'}>
        {showToolbar && (
          <div className="shrink-0 flex items-center flex-wrap gap-2 px-4 py-3 border-b border-[var(--border)]">
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold text-text-primary">{sectionTitle}</h2>
              <p className="text-[11px] text-text-muted mt-0.5">{resultCount.toLocaleString()} {resultUnit}{resultCount === 1 ? '' : 's'}{q || (nav.key === 'songs' && apiFilter !== 'all') ? ' found' : ''}{nav.key === 'recent' ? ' · Newest first' : ''}</p>
            </div>
            {nav.key === 'songs' && <ApiCompareDropdown value={apiFilter} onChange={setApiFilter} disabled={!apiSongNames}
              failed={apiSongNamesFailed} onRetry={() => setApiLoadAttempt(n => n + 1)} />}
            <button onClick={() => playAll(browseTracks)} disabled={browseTracks.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 bg-accent text-black rounded-full text-xs font-semibold hover:bg-accent-hover disabled:opacity-40">
              <Play size={12} fill="currentColor" /> Play all
            </button>
            <button onClick={() => playAll(browseTracks, true)} disabled={browseTracks.length === 0} aria-label="Shuffle this collection"
              className="flex items-center justify-center w-8 h-8 rounded-full text-text-secondary hover:text-text-primary hover:bg-surface-overlay disabled:opacity-40">
              <Shuffle size={15} />
            </button>
          </div>
        )}

        {/* Content */}
        <div ref={contentRef} id="library-content" role="region" aria-label={sectionTitle}
          className="flex-1 min-h-0 flex flex-col overflow-hidden">
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
        ) : isOverview ? (
          <LibraryOverview tracks={libraryTracks} albums={albums} artists={artists} onNav={navTo}
            onOpenAlbum={openAlbum} onOpenArtist={openArtist} onPlayAlbum={playAlbum}
            onShuffle={() => playAll(libraryTracks, true)} onContext={openCtx} onSettings={openLibrarySettings} />
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
                <div className="w-11 shrink-0" />
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

        {/* Bulk selection action bar */}
        {selectMode && (
          <div className="relative z-30 shrink-0 rounded-xl border border-[var(--border)] bg-surface-raised mx-3 mb-3 mt-2 px-4 py-3 flex flex-wrap items-center gap-2">
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
