import { useEffect, useMemo, useState } from 'react'
import { useStore, useStorePick } from '../store/useStore'
import { loadRecentTracks } from '../lib/recentTracks'
import { playlistCoverUrl, loadAllSongs, songToTrack, type JWApiSong } from '../lib/juicewrldApi'
import { peekPlaylistCover } from '../lib/userApi'
import { loadRecentPlaylistIds } from '../lib/recentPlaylists'
import { loadStats as loadHeardleStats, todayKey as heardleToday } from '../lib/heardle'
import { loadStats as loadWordleStats, todayKey as wordleToday } from '../lib/wordle'
import { loadTierlistLibrary, rankedCount as tierlistRankedCount } from '../lib/tierlist'
import { ALL_CHANNEL, fetchNews, peekNews, type NewsItem } from '../lib/newsApi'
import { isHomeSectionVisible } from '../lib/homeSections'
import { getActiveRadioClient } from '../lib/radioSocketService'
import { resumeEffectsContext } from '../lib/audioEffects'
import * as albumsApi from '../lib/albumsApi'
import type { Album } from '../lib/albumsApi'
import type { PlaylistSummary } from '../lib/userApi'
import type { Track, ViewType } from '../types'

/** Set to false to hide the Albums tile on Home and skip its /albums/ fetch. */
export const HOME_ALBUMS_SHOWN: boolean = true
// Home's playlist strip scrolls sideways; past this many, "All" is closer.
const HOME_PLAYLIST_LIMIT = 30

// Home unmounts whenever another view opens. Keeping the last album list and
// its song index here means coming back paints Albums at once instead of
// waiting on the network again; the fetch on mount still refreshes both.
let albumsMemo: Album[] | null = null
let albumIndexMemo: Map<string, JWApiSong> | null = null
const newestFirst = (list: Album[]): Album[] =>
  [...list].sort((a, b) => (b.release_date ?? '').localeCompare(a.release_date ?? ''))

export interface HomeAlbumCard {
  key: string
  title: string
  subtitle: string
  cover: string | undefined
  /** Opens the album's page. */
  open: () => void
  play: () => void
}

// A daily puzzle (streak + played-today) vs. Tier List, which is a standing
// ranking with no daily reset - same card shell, different second line.
export type GameCard =
  | { view: ViewType; label: string; kind: 'daily'; streak: number; done: boolean }
  | { view: ViewType; label: string; kind: 'freeform'; sub: string }

export interface HomePlaylistCard {
  key: string
  name: string
  subtitle: string
  // A single cover image, or (mutually exclusive) up to 4 track covers to lay
  // out as a mosaic - the same fallback a playlist with no cover of its own
  // gets everywhere else in the app. Exactly one of the two is set.
  cover: string | null
  mosaic: string[] | null
  open: () => void
  /** Only set for the account's own API playlists - lets the caller offer the
   *  full PlaylistContextMenu (rename/delete/export/…) on right-click, same
   *  as the sidebar's playlist list. Followed/guest playlists don't have a
   *  PlaylistSummary to hand it, so they just don't get a menu. */
  playlist?: PlaylistSummary
}

// Everything the Home dashboard shows, shared by the mobile and desktop
// shells so the two can never drift on what a section means or contains -
// they differ only in layout.
//
// It's a dashboard over things the app already knows, not a new data source:
// every field below reads from the store or localStorage synchronously, so
// Home paints instantly and works offline. News is the sole exception, and it
// paints from cache first (same stale-while-revalidate pattern as NewsView).
//
// Deliberately NOT using lib/listeningStats' buildListeningStats: it operates
// on songs joined against the stats catalog, and resolving that costs ~25
// requests on a cold cache (lib/statsCatalog). The counts below come straight
// off the raw play events instead. Listening *time* is the one number that
// genuinely needs song durations, so it isn't shown here - /stats owns that.
export function useHomeData() {
  const {
    account, playlists, guestPlaylists, followedPlaylists, likedTrackIds,
    songPrefs, setActiveView, setPendingPlaylistId, playTrack,
    radioFmActive, setRadioFmActive, radioFmIsLive, radioFmNowPlaying,
    homeSectionVisibility, ensurePlaylists, setIsPlaying, recentTracksRev,
  } = useStorePick(
    'account', 'playlists', 'guestPlaylists', 'followedPlaylists', 'likedTrackIds',
    'songPrefs', 'setActiveView', 'setPendingPlaylistId', 'playTrack',
    'radioFmActive', 'setRadioFmActive', 'radioFmIsLive', 'radioFmNowPlaying',
    'homeSectionVisibility', 'ensurePlaylists', 'setIsPlaying', 'recentTracksRev',
  )

  const showSection = (id: string): boolean => isHomeSectionVisible(id, homeSectionVisibility)

  // loadAccount() starts the playlist fetch alongside getMe, and the last list
  // is painted from the offline cache before that. If that fetch failed, Home
  // tries again: ensurePlaylists() no-ops without an account, once this
  // session has loaded them, and joins a fetch already in flight, so this
  // costs nothing on later visits.
  useEffect(() => {
    if (account) ensurePlaylists()
  }, [account, ensurePlaylists])

  // localStorage-backed, so read once per mount rather than per render. Home is
  // remounted on every visit (it's a route), which is exactly when this should
  // refresh - a song played while you were on another tab shows up on return.
  // recentTracksRev also re-reads it when the post-sign-in backfill lands.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recent = useMemo(() => loadRecentTracks(), [recentTracksRev])

  // Same stale-while-revalidate pattern as NewsView: paint the last cached
  // page instantly, then let the network response replace it.
  const [newsItems, setNewsItems] = useState<NewsItem[]>(() => peekNews({ channel: ALL_CHANNEL })?.results ?? [])
  useEffect(() => {
    fetchNews({ channel: ALL_CHANNEL }).then((res) => setNewsItems(res.results)).catch(() => undefined)
  }, [])

  // Album objects carry track paths, not full song metadata - resolved
  // against the whole catalog (?all=true, same fetch/cache the versions
  // table and WrldView's own album browser use) for cover art and to build
  // a playable queue. Newest release first, same "what's fresh" ordering as
  // Recently played.
  // First paint comes from this session's last list, else the cached pages.
  const [albums, setAlbums] = useState<Album[]>(() => {
    if (!HOME_ALBUMS_SHOWN) return []
    if (albumsMemo) return albumsMemo
    const cached = albumsApi.peekAlbums()
    return cached ? newestFirst(cached) : []
  })
  const [albumSongIndex, setAlbumSongIndex] = useState<Map<string, JWApiSong>>(() => albumIndexMemo ?? new Map())
  // True until the first fetch settles when there was nothing to paint, so
  // Home can hold the Albums slot instead of reshuffling the bento later.
  const [albumsPending, setAlbumsPending] = useState(() => HOME_ALBUMS_SHOWN && albums.length === 0)
  useEffect(() => {
    if (!HOME_ALBUMS_SHOWN) return
    albumsApi.fetchAlbums()
      .then((list) => {
        albumsMemo = newestFirst(list)
        setAlbums(albumsMemo)
        // The catalogue is ~10 MB of JSON, and Home is the desktop landing
        // page - only pull it in when some album actually lists tracks to
        // resolve. The public list can come back with none at all, and then
        // the whole download bought nothing.
        if (!list.some((a) => a.songs?.length)) return
        return loadAllSongs()
          .then((all) => {
            albumIndexMemo = albumsApi.indexSongsByPath(all)
            setAlbumSongIndex(albumIndexMemo)
          })
      })
      .catch(() => undefined)
      .finally(() => setAlbumsPending(false))
  }, [])

  const albumRow: HomeAlbumCard[] = useMemo(() => albums.map((album) => {
    const tracks = albumsApi.albumTracks(album)
    return {
      key: `a${album.id}`,
      title: album.title,
      subtitle: album.release_date ? album.release_date.slice(0, 4) : (album.artist?.name ?? ''),
      cover: albumsApi.albumCoverUrl(album, albumSongIndex, songPrefs),
      open: () => { useStore.getState().setAlbumsSelectedId(album.id); setActiveView('albums') },
      play: () => {
        const queue = tracks
          .map((t) => albumSongIndex.get(t.path))
          .filter((s): s is JWApiSong => !!s)
          .map(songToTrack)
        if (queue.length > 0) playTrack(queue[0], queue)
      },
    }
  }), [albums, albumSongIndex, songPrefs, playTrack, setActiveView])

  const games = useMemo((): GameCard[] => {
    const heardle = loadHeardleStats('daily')
    const wordle = loadWordleStats()
    const tierlists = loadTierlistLibrary().lists
    const rankedCount = tierlists.reduce((n, l) => n + tierlistRankedCount(l), 0)
    const tierSub = rankedCount === 0
      ? 'Rank your songs'
      : tierlists.length > 1 ? `${tierlists.length} lists · ${rankedCount} ranked` : `${rankedCount} ranked`
    return [
      { view: 'heardle', label: 'Heardle', kind: 'daily', streak: heardle.currentStreak, done: heardle.lastDay === heardleToday() },
      { view: 'wordle', label: 'Wordle', kind: 'daily', streak: wordle.currentStreak, done: wordle.lastDay === wordleToday() },
      { view: 'tierlist', label: 'Tier List', kind: 'freeform', sub: tierSub },
    ]
  }, [])

  // Server playlists need an account; the local kinds don't. Signed out we just
  // show what exists locally rather than prompting to sign in.
  const ownPlaylists = account ? playlists : []
  const playlistRow: HomePlaylistCard[] = [
    ...ownPlaylists.filter((p) => p.track_count > 0).map((p) => {
      // `playlists` is fetched with omit_cover_image=true (PlaylistsView's own
      // grid pays that same cost), so a summary object almost never carries
      // its own cover_image/cover_image_url - peekPlaylistCover's cache is the
      // real source, warmed in the background by prefetchPlaylistDetails at
      // startup and by PlaylistsView whenever it's been opened. A miss (cache
      // still cold) just falls back to the icon, same as before.
      const cached = peekPlaylistCover(p.id)
      const cover = cached?.cover_image_url ?? cached?.cover_image ?? playlistCoverUrl(p) ?? null
      const mosaicUrls = cached?.trackImages?.slice(0, 4) ?? []
      const useMosaic = !cover && mosaicUrls.length >= 4
      return {
        key: `p${p.id}`,
        name: p.name,
        subtitle: `${p.track_count} song${p.track_count === 1 ? '' : 's'}`,
        cover: useMosaic ? null : cover,
        mosaic: useMosaic ? mosaicUrls : null,
        open: () => { setPendingPlaylistId(p.id); setActiveView('playlists') },
        playlist: p,
      }
    }),
    ...followedPlaylists.filter((p) => p.trackCount > 0).map((p) => ({
      key: `f${p.id}`,
      name: p.name,
      subtitle: `${p.trackCount} song${p.trackCount === 1 ? '' : 's'}`,
      cover: p.coverUrl,
      mosaic: null,
      open: () => { setPendingPlaylistId(p.id); setActiveView('playlists') },
    })),
    ...guestPlaylists.filter((p) => p.tracks.length > 0).map((p) => {
      const mosaicUrls = p.tracks.slice(0, 4).map((t) => t.imageUrl).filter((u): u is string => !!u)
      const useMosaic = mosaicUrls.length >= 4
      return {
        key: `g${p.id}`,
        name: p.name,
        subtitle: `${p.tracks.length} song${p.tracks.length === 1 ? '' : 's'}`,
        cover: useMosaic ? null : (p.tracks[0]?.imageUrl ?? null),
        mosaic: useMosaic ? mosaicUrls : null,
        open: () => setActiveView('playlists'),
      }
    }),
  ]
  // Recently opened first (Array.sort is stable, so never-opened playlists
  // keep their existing order after them). Guest playlists have no numeric id
  // in the recents list and stay at the end.
  const recentIds = loadRecentPlaylistIds()
  const recencyRank = (c: HomePlaylistCard): number => {
    if (c.key.startsWith('g')) return recentIds.length
    const i = recentIds.indexOf(Number(c.key.slice(1)))
    return i < 0 ? recentIds.length : i
  }
  playlistRow.sort((a, b) => recencyRank(a) - recencyRank(b))
  playlistRow.splice(HOME_PLAYLIST_LIMIT)

  const openTrack = (track: Track): void => { playTrack(track) }

  // Mirrors NewsNotifier's openPost: NewsView reads this sessionStorage key
  // on mount to jump straight to the tapped post.
  const openNewsItem = (item: NewsItem): void => {
    setActiveView('news')
    try { sessionStorage.setItem('news:openPostId', String(item.id)) } catch {}
    window.dispatchEvent(new CustomEvent('news:open', { detail: item.id }))
  }

  // Navigating to WRLD used to land on the page without actually tuning in -
  // the 999 FM toggle there is a separate click. Mirrors that toggle's own
  // "turn on" branch (WrldView's top-left button) so the shortcut here does
  // both in one action, same as clicking through and then hitting the toggle.
  const openRadioFm = (): void => {
    if (!radioFmActive) {
      setIsPlaying(false)
      resumeEffectsContext()
      void getActiveRadioClient()?.startListening()?.catch(() => setRadioFmActive(false))
      setRadioFmActive(true)
    }
    setActiveView('wrld')
  }

  return {
    account, likedTrackIds, radioFmIsLive, radioFmNowPlaying,
    setActiveView,
    showSection,
    recent, newsItems, games, playlistRow, albumRow, albumsPending,
    openTrack, openNewsItem, openRadioFm,
  }
}
