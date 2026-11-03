import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, Play, Shuffle, MoreHorizontal, Music, ListEnd, ListPlus, ListMusic, Plus, Loader2 } from 'lucide-react'
import { addSongsInBackground } from '../lib/optimisticPlaylist'
import { useStore, useStorePick } from '../store/useStore'
import * as albumsApi from '../lib/albumsApi'
import type { Album, AlbumSongEntry } from '../lib/albumsApi'
import { loadAllSongs, songToTrack, parseDuration, type JWApiSong } from '../lib/juicewrldApi'
import { formatDuration } from '../lib/format'
import { useCanEdit } from '../hooks/useChannelRoles'
import { useContentMotion } from '../hooks/useContentMotion'
import SongContextMenu, { type SongContextMenuState } from './SongContextMenu'
import ContextMenu from './ContextMenu'
import type { Track } from '../types'

// Albums laid out like Apple Music: a cover grid, and an album page with the
// artwork beside its title, Play / Shuffle, a numbered tracklist and the
// release details underneath.

const year = (a: Album): string => a.release_date?.slice(0, 4) ?? ''

/** "Album · 2018", or just the year for plain albums, as Apple's shelves do. */
const cardSubtitle = (a: Album): string =>
  [a.type && a.type !== 'Album' ? a.type : '', year(a)].filter(Boolean).join(' · ')

function longDate(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

/** Editions repeat the base album's title with a "(Deluxe)"-style suffix. */
const baseTitle = (title: string): string => title.replace(/\s*[([].*$/, '').trim().toLowerCase()

/** Clamped to three lines, with MORE only when the text is actually cut off. */
function Description({ text, className }: { text: string; className: string }): JSX.Element {
  const ref = useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = useState(false)
  const [clamped, setClamped] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || open) return
    const measure = (): void => setClamped(el.scrollHeight > el.clientHeight + 1)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text, open])
  return (
    <div className={className}>
      <p ref={ref} className={`text-text-secondary text-[13px] leading-relaxed whitespace-pre-line ${open ? '' : 'line-clamp-3'}`}>{text}</p>
      {(clamped || open) && (
        <button onClick={() => setOpen((o) => !o)} className="text-text-primary text-[11px] font-bold tracking-wide mt-1 hover:text-accent transition-colors">
          {open ? 'LESS' : 'MORE'}
        </button>
      )}
    </div>
  )
}

interface Row {
  entry: AlbumSongEntry
  /** The full catalogue song, needed to play it (null until the catalogue loads, or with no match). */
  song: JWApiSong | null
  songId: number | null
  name: string
  seconds: number
}

function AlbumCover({ url, title, className = '' }: { url?: string; title: string; className?: string }): JSX.Element {
  const [failed, setFailed] = useState(false)
  return (
    <div className={`relative aspect-square overflow-hidden bg-surface-raised flex items-center justify-center ${className}`}>
      {url && !failed
        ? <img src={url} alt={title} loading="lazy" decoding="async" onError={() => setFailed(true)} className="w-full h-full object-cover" />
        : <Music size={28} className="text-text-muted" />}
    </div>
  )
}

function AlbumCard({ album, cover, onOpen, onPlay }: { album: Album; cover?: string; onOpen: () => void; onPlay: () => void }): JSX.Element {
  return (
    <div className="group min-w-0">
      <div className="relative">
        <button onClick={onOpen} className="block w-full text-left" aria-label={album.title}>
          <AlbumCover url={cover} title={album.title} className="rounded-lg shadow-sm ring-1 ring-[var(--border)]" />
        </button>
        <span className="pointer-events-none absolute inset-0 rounded-lg bg-gradient-to-t from-black/45 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        <button
          onClick={onPlay}
          aria-label={`Play ${album.title}`}
          className="absolute bottom-2.5 left-2.5 w-9 h-9 rounded-full bg-black/45 backdrop-blur-md text-white flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-accent transition-[opacity,background-color] duration-300"
        >
          <Play size={15} className="ml-0.5" fill="currentColor" />
        </button>
      </div>
      <button onClick={onOpen} className="block w-full text-left mt-2 min-w-0">
        <p className="text-text-primary text-[13px] leading-snug font-medium truncate" title={album.title}>{album.title}</p>
        <p className="text-text-muted text-[13px] leading-snug truncate">{cardSubtitle(album) || album.artist?.name}</p>
      </button>
    </div>
  )
}

/** A titled horizontal row of covers ("More by Juice WRLD", "Other Versions"). */
function Shelf({ title, albums, coverOf, onOpen, onPlay }: {
  title: string; albums: Album[]; coverOf: (a: Album) => string | undefined; onOpen: (a: Album) => void; onPlay: (a: Album) => void
}): JSX.Element | null {
  if (albums.length === 0) return null
  return (
    <section className="mt-10">
      <h2 className="text-text-primary text-xl font-bold mb-3">{title}</h2>
      <div className="flex gap-5 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1 snap-x">
        {albums.map((a) => (
          <div key={a.id} className="w-[160px] md:w-[180px] shrink-0 snap-start">
            <AlbumCard album={a} cover={coverOf(a)} onOpen={() => onOpen(a)} onPlay={() => onPlay(a)} />
          </div>
        ))}
      </div>
    </section>
  )
}

export default function AlbumsView(): JSX.Element {
  const { albumsSelectedId: selectedId, setAlbumsSelectedId: setSelectedId, songPrefs, currentTrack, isPlaying, playTrack, shufflePlay, playNext, addToQueue, setActiveView, previousView, playlists, account, refreshPlaylists, setShowUserAuth } =
    useStorePick('albumsSelectedId', 'setAlbumsSelectedId', 'songPrefs', 'currentTrack', 'isPlaying', 'playTrack', 'shufflePlay', 'playNext', 'addToQueue', 'setActiveView', 'previousView', 'playlists', 'account', 'refreshPlaylists', 'setShowUserAuth')
  const canEdit = useCanEdit()
  const [albums, setAlbums] = useState<Album[] | null>(null)
  const [error, setError] = useState(false)
  const [songIndex, setSongIndex] = useState<Map<string, JWApiSong>>(new Map())
  const [catalogReady, setCatalogReady] = useState(false)
  const [type, setType] = useState<string>('All')
  const [ctxMenu, setCtxMenu] = useState<SongContextMenuState | null>(null)
  const [albumMenu, setAlbumMenu] = useState<{ x: number; y: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    albumsApi.fetchAlbums()
      .then((list) => setAlbums([...list].sort((a, b) => (b.release_date ?? '').localeCompare(a.release_date ?? ''))))
      .catch(() => setError(true))
    // Album rows only carry paths (and, on newer servers, a name and length);
    // playing needs the full song, so resolve paths against the catalogue.
    loadAllSongs()
      .then((all) => setSongIndex(albumsApi.indexSongsByPath(all)))
      .catch(() => undefined)
      .finally(() => setCatalogReady(true))
  }, [])

  // /albums?id=<id> opens that album, and back/forward moves between them.
  useEffect(() => {
    const fromUrl = (): void => {
      if (window.location.pathname !== '/albums') return
      const id = Number(new URLSearchParams(window.location.search).get('id'))
      setSelectedId(Number.isFinite(id) && id > 0 ? id : null)
    }
    if (window.location.protocol !== 'file:' && new URLSearchParams(window.location.search).has('id')) fromUrl()
    window.addEventListener('popstate', fromUrl)
    return () => window.removeEventListener('popstate', fromUrl)
  }, [setSelectedId])

  const album = albums?.find((a) => a.id === selectedId) ?? null

  useContentMotion(contentRef, album ? `a${album.id}` : 'grid', albums !== null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [selectedId])

  const coverOf = (a: Album): string | undefined => albumsApi.albumCoverUrl(a, songIndex, songPrefs)

  const rowsOf = (a: Album): Row[] => albumsApi.albumTracks(a).map((entry) => {
    const song = songIndex.get(entry.path) ?? null
    const songId = song?.id ?? entry.song?.id ?? null
    const apiName = song?.name ?? entry.song?.name ?? entry.path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? entry.path
    return {
      entry, song, songId,
      name: (songId != null && songPrefs[songId]?.name) || apiName,
      seconds: parseDuration(song?.length ?? entry.song?.length),
    }
  })

  const tracksOf = (a: Album): Track[] => rowsOf(a).flatMap((r) => (r.song ? [songToTrack(r.song)] : []))

  const songIdsOf = (a: Album): number[] => rowsOf(a).flatMap((r) => (r.songId != null ? [r.songId] : []))

  const playAlbum = (a: Album, startAt = 0): void => {
    const queue = tracksOf(a)
    if (queue.length > 0) playTrack(queue[Math.min(startAt, queue.length - 1)], queue)
  }

  const types = useMemo(() => {
    const seen = new Set((albums ?? []).map((a) => a.type).filter((t): t is string => !!t))
    return seen.size > 1 ? ['All', ...['Album', 'EP', 'Mixtape'].filter((t) => seen.has(t)), ...[...seen].filter((t) => !['Album', 'EP', 'Mixtape'].includes(t))] : []
  }, [albums])
  const shown = (albums ?? []).filter((a) => type === 'All' || a.type === type)

  const back = (): void => {
    if (album) setSelectedId(null)
    else setActiveView(previousView && previousView !== 'albums' ? previousView : 'home')
  }

  // ── grid ───────────────────────────────────────────────────────────────────
  const grid = (
    <>
      <h1 className="text-text-primary text-[28px] md:text-[32px] font-bold leading-tight">Albums</h1>
      {types.length > 0 && (
        <div className="flex gap-1.5 mt-4 overflow-x-auto no-scrollbar">
          {types.map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`px-3.5 py-1 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors ${type === t ? 'bg-text-primary text-surface' : 'bg-surface-raised text-text-secondary hover:text-text-primary'}`}
            >
              {t === 'All' ? 'All' : t === 'EP' ? 'EPs' : `${t}s`}
            </button>
          ))}
        </div>
      )}
      {albums === null && !error && (
        <div className="flex justify-center py-24"><Loader2 size={22} className="animate-spin text-text-muted" /></div>
      )}
      {error && <p className="text-text-muted text-sm py-24 text-center">Couldn't load albums. Check your connection and try again.</p>}
      {albums !== null && (
        <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-5 gap-y-7 mt-6">
          {shown.map((a) => (
            <AlbumCard key={a.id} album={a} cover={coverOf(a)} onOpen={() => setSelectedId(a.id)} onPlay={() => playAlbum(a)} />
          ))}
        </div>
      )}
    </>
  )

  // ── album page ─────────────────────────────────────────────────────────────
  const detail = (a: Album): JSX.Element => {
    const rows = rowsOf(a)
    const playable = rows.filter((r) => r.song).length
    const total = rows.reduce((n, r) => n + r.seconds, 0)
    const minutes = Math.round(total / 60)
    const cover = coverOf(a)
    const meta = [(a.type || 'Album').toUpperCase(), year(a)].filter(Boolean).join(' · ')
    const key = baseTitle(a.title)
    const versions = (albums ?? []).filter((o) => o.id !== a.id && baseTitle(o.title) === key)
    const more = (albums ?? []).filter((o) => o.id !== a.id && baseTitle(o.title) !== key)
    const waiting = !catalogReady && playable === 0 && rows.length > 0

    const playButton = 'flex items-center justify-center gap-2 h-9 px-6 rounded-lg text-[13px] font-semibold transition-[opacity,background-color] disabled:opacity-40'

    return (
      <>
        <div className="relative">
          <header className="flex flex-col items-center text-center md:flex-row md:items-end md:text-left gap-5 md:gap-8">
            <AlbumCover url={cover} title={a.title} className="w-[min(68vw,280px)] md:w-[270px] shrink-0 rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.28)] ring-1 ring-[var(--border)]" />
            <div className="min-w-0 flex-1 md:pb-1">
              <h1 className="text-text-primary text-[22px] md:text-[28px] font-bold leading-tight">{a.title}</h1>
              <p className="text-accent text-[19px] md:text-[22px] font-medium leading-tight mt-0.5">{a.artist?.name || 'Juice WRLD'}</p>
              <p className="text-text-muted text-[11px] font-semibold tracking-wide mt-2">{meta}</p>
              {a.description && <Description key={a.id} text={a.description} className="mt-3 max-w-2xl hidden md:block" />}
              <div className="flex items-center gap-2.5 mt-5 justify-center md:justify-start">
                <button onClick={() => playAlbum(a)} disabled={playable === 0} className={`${playButton} flex-1 md:flex-none bg-surface-raised text-accent md:bg-accent md:text-white hover:opacity-90`}>
                  {waiting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />} Play
                </button>
                <button onClick={() => void shufflePlay(tracksOf(a))} disabled={playable === 0} className={`${playButton} flex-1 md:flex-none bg-surface-raised text-accent md:bg-accent md:text-white hover:opacity-90`}>
                  <Shuffle size={14} /> Shuffle
                </button>
                <button
                  onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAlbumMenu({ x: r.left, y: r.bottom + 6 }) }}
                  disabled={playable === 0}
                  aria-label="More"
                  className="hidden md:flex ml-auto w-9 h-9 rounded-full bg-surface-raised text-accent items-center justify-center hover:bg-surface-overlay transition-colors disabled:opacity-40"
                >
                  <MoreHorizontal size={18} />
                </button>
              </div>
            </div>
          </header>

          {a.description && <Description key={a.id} text={a.description} className="mt-5 md:hidden" />}

          {/* Tracklist: zebra rows on desktop, hairlines on narrow windows. */}
          <ol className="mt-7 md:mt-8 -mx-2 md:mx-0">
            {rows.map((r, i) => {
              const active = r.songId != null && currentTrack?.id === `jw-${r.songId}`
              const startIndex = rows.slice(0, i).filter((x) => x.song).length
              const openMenu = (x: number, y: number): void => {
                if (!r.song) return
                const track = songToTrack(r.song)
                setCtxMenu((prev) => (prev?.track.id === track.id ? null : { track, songId: r.song!.id, x, y }))
              }
              return (
                <li key={`${r.entry.path}-${i}`}>
                  <div
                    role="button"
                    tabIndex={r.song ? 0 : -1}
                    aria-disabled={!r.song}
                    onClick={() => r.song && playAlbum(a, startIndex)}
                    onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && r.song) { e.preventDefault(); playAlbum(a, startIndex) } }}
                    onContextMenu={(e) => { e.preventDefault(); openMenu(e.clientX, e.clientY) }}
                    className={`group flex items-center gap-3 h-11 px-2 md:px-3 md:rounded-md ${i % 2 === 0 ? 'md:bg-surface-raised' : ''} ${r.song ? 'cursor-default hover:bg-surface-overlay md:hover:bg-surface-overlay' : 'opacity-45'} transition-colors`}
                  >
                    <span className="w-6 shrink-0 flex items-center justify-center text-[13px] tabular-nums">
                      {active ? (
                        <span className={`flex items-end gap-[2px] h-3 text-accent ${isPlaying ? 'album-eq-playing' : ''}`} aria-label="Now playing">
                          <span className="album-eq-bar" /><span className="album-eq-bar" /><span className="album-eq-bar" />
                        </span>
                      ) : (
                        <>
                          <span className={`text-text-muted ${r.song ? 'group-hover:hidden' : ''}`}>{r.entry.order || i + 1}</span>
                          {r.song && <Play size={12} className="hidden group-hover:block text-text-primary" fill="currentColor" />}
                        </>
                      )}
                    </span>
                    <span className={`flex-1 min-w-0 truncate text-[13px] border-b border-[var(--border)] md:border-0 h-full flex items-center ${active ? 'text-accent font-medium' : 'text-text-primary'}`} title={r.name}>
                      <span className="truncate">{r.name}</span>
                    </span>
                    {r.song && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openMenu(e.clientX, e.clientY) }}
                        aria-label="More options"
                        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-accent opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-highest transition-opacity"
                      >
                        <MoreHorizontal size={16} />
                      </button>
                    )}
                    <span className="w-12 shrink-0 text-right text-text-muted text-[13px] tabular-nums">{r.seconds ? formatDuration(r.seconds) : ''}</span>
                  </div>
                </li>
              )
            })}
          </ol>
          {rows.length === 0 && <p className="text-text-muted text-sm mt-8">No tracks listed for this album yet.</p>}

          <footer className="mt-5 text-text-muted text-[13px] leading-relaxed">
            {a.release_date && <p>{longDate(a.release_date)}</p>}
            <p>
              {rows.length} {rows.length === 1 ? 'song' : 'songs'}
              {minutes > 0 && `, ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`}
            </p>
            {a.release_date && <p>℗ {year(a)} {a.artist?.name || 'Juice WRLD'}</p>}
          </footer>

          <Shelf title="Other Versions" albums={versions} coverOf={coverOf} onOpen={(o) => setSelectedId(o.id)} onPlay={(o) => playAlbum(o)} />
          <Shelf title={`More by ${a.artist?.name || 'Juice WRLD'}`} albums={more} coverOf={coverOf} onOpen={(o) => setSelectedId(o.id)} onPlay={(o) => playAlbum(o)} />
        </div>

        {albumMenu && (
          <ContextMenu
            x={albumMenu.x}
            y={albumMenu.y}
            onClose={() => setAlbumMenu(null)}
            title={a.title}
            items={[
              { label: 'Play Next', icon: ListPlus, onSelect: () => { [...tracksOf(a)].reverse().forEach((t) => playNext(t)) } },
              { label: 'Add to Queue', icon: ListEnd, onSelect: () => { tracksOf(a).forEach((t) => addToQueue(t)) } },
              {
                label: 'Add to Playlist',
                icon: Plus,
                onOpen: () => { if (account) void refreshPlaylists() },
                children: account
                  ? playlists.map((p) => ({ label: p.name, icon: ListMusic, onSelect: () => { void addSongsInBackground(p.id, songIdsOf(a)) } }))
                  : [],
                childrenEmpty: account ? 'No playlists yet.' : undefined,
                childrenFooter: !account ? (
                  <div className="p-1">
                    <p className="text-xs text-text-muted mb-2">Log in to save to playlists.</p>
                    <button onClick={() => { setShowUserAuth(true); setAlbumMenu(null) }} className="w-full py-1.5 rounded-lg bg-accent/15 text-accent text-xs font-semibold">
                      Log in
                    </button>
                  </div>
                ) : undefined,
              },
            ]}
          />
        )}
      </>
    )
  }

  return (
    <>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto relative isolate">
        {/* Artwork tint behind the header, the way Apple Music washes the
            page top in the cover's colors. */}
        {album && coverOf(album) && (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[460px] overflow-hidden" aria-hidden>
            <img src={coverOf(album)} alt="" className="w-full h-full object-cover scale-125 blur-[80px] opacity-25 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
          </div>
        )}
        <div ref={contentRef} className="relative px-5 md:px-8 pt-5 pb-12 max-w-[1400px] mx-auto">
          <button
            onClick={back}
            aria-label="Back"
            title="Back"
            className="relative z-10 flex items-center gap-0.5 -ml-1.5 mb-3 px-1 py-1 rounded-lg text-accent text-[15px] hover:opacity-80 transition-opacity"
          >
            <ChevronLeft size={20} />
            {album && <span>Albums</span>}
          </button>
          {album ? detail(album) : grid}
        </div>
      </div>

      {ctxMenu && (
        <SongContextMenu
          state={ctxMenu}
          onClose={() => setCtxMenu(null)}
          canEdit={canEdit}
          onInfo={() => ctxMenu.songId != null && useStore.getState().setInfoSongId(ctxMenu.songId)}
          onPlay={() => {
            if (!album) return
            const tracks = tracksOf(album)
            const at = tracks.findIndex((t) => t.id === ctxMenu.track.id)
            if (at >= 0) playTrack(tracks[at], tracks)
          }}
        />
      )}
    </>
  )
}
