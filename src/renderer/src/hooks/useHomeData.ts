import { useEffect, useMemo, useState } from 'react'
import { useStorePick } from '../store/useStore'
import { loadRecentTracks } from '../lib/recentTracks'
import { filterListeningPlaysByDays } from '../lib/listeningPlays'
import { playlistCoverUrl, apiFetch, apiPeek, type JWApiStats } from '../lib/juicewrldApi'
import { peekPlaylistCover } from '../lib/userApi'
import { loadStats as loadHeardleStats, todayKey as heardleToday } from '../lib/heardle'
import { loadStats as loadWordleStats, todayKey as wordleToday } from '../lib/wordle'
import { loadTierlistState } from '../lib/tierlist'
import { ALL_CHANNEL, fetchNews, peekNews, type NewsItem } from '../lib/newsApi'
import { isHomeSectionVisible } from '../lib/homeSections'
import { getActiveRadioClient } from '../lib/radioSocketService'
import { resumeEffectsContext } from '../lib/audioEffects'
import type { Track, ViewType } from '../types'

// A daily puzzle (streak + played-today) vs. Tier List, which is a standing
// ranking with no daily reset — same card shell, different second line.
export type GameCard =
  | { view: ViewType; label: string; kind: 'daily'; streak: number; done: boolean }
  | { view: ViewType; label: string; kind: 'freeform'; sub: string }

export interface HomePlaylistCard {
  key: string
  name: string
  subtitle: string
  // A single cover image, or (mutually exclusive) up to 4 track covers to lay
  // out as a mosaic — the same fallback a playlist with no cover of its own
  // gets everywhere else in the app. Exactly one of the two is set.
  cover: string | null
  mosaic: string[] | null
  open: () => void
}

// Everything the Home dashboard shows, shared by the mobile and desktop
// shells so the two can never drift on what a section means or contains —
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
// genuinely needs song durations, so it isn't shown here — /stats owns that.
export function useHomeData() {
  const {
    account, playlists, guestPlaylists, followedPlaylists, likedTrackIds,
    listeningPlays, setActiveView, setPendingPlaylistId, playTrack, openProfile,
    radioFmActive, setRadioFmActive, radioFmIsLive, radioFmNowPlaying,
    homeSectionVisibility, refreshPlaylists, setIsPlaying,
  } = useStorePick(
    'account', 'playlists', 'guestPlaylists', 'followedPlaylists', 'likedTrackIds',
    'listeningPlays', 'setActiveView', 'setPendingPlaylistId', 'playTrack', 'openProfile',
    'radioFmActive', 'setRadioFmActive', 'radioFmIsLive', 'radioFmNowPlaying',
    'homeSectionVisibility', 'refreshPlaylists', 'setIsPlaying',
  )

  const showSection = (id: string): boolean => isHomeSectionVisible(id, homeSectionVisibility)

  // On a fresh app launch, playlists load as one step of loadAccount()'s long
  // sequential chain (getMe → favorites → prefs → folders → reports → THEN
  // playlists) — Home routinely finishes mounting before that chain gets to
  // its playlists step, and it's just one more await away from never getting
  // there at all if an earlier step throws. Rather than depend on that chain,
  // Home asks for its own copy directly; refreshPlaylists() already no-ops
  // without an account and collapses concurrent callers (see its _inFlight
  // guard), so this is free when the chain already covered it.
  useEffect(() => {
    if (account) refreshPlaylists()
  }, [account, refreshPlaylists])

  // localStorage-backed, so read once per mount rather than per render. Home is
  // remounted on every visit (it's a route), which is exactly when this should
  // refresh — a song played while you were on another tab shows up on return.
  const recent = useMemo(() => loadRecentTracks(), [])

  // Same stale-while-revalidate pattern as NewsView: paint the last cached
  // page instantly, then let the network response replace it.
  const [newsItems, setNewsItems] = useState<NewsItem[]>(() => peekNews({ channel: ALL_CHANNEL })?.results ?? [])
  useEffect(() => {
    fetchNews({ channel: ALL_CHANNEL }).then((res) => setNewsItems(res.results)).catch(() => undefined)
  }, [])

  // Site-wide catalog totals (GET /stats/), shown next to the user's own
  // listening numbers in the hero. Same stale-while-revalidate shape as News:
  // ApiTrackerView already warms this exact cache key, so most visits paint
  // it instantly from there.
  const [siteStats, setSiteStats] = useState<JWApiStats | null>(() => apiPeek<JWApiStats>('/stats/') ?? null)
  useEffect(() => {
    apiFetch<JWApiStats>('/stats/').then(setSiteStats).catch(() => undefined)
  }, [])

  const games = useMemo((): GameCard[] => {
    const heardle = loadHeardleStats('daily')
    const wordle = loadWordleStats()
    const rankedCount = Object.keys(loadTierlistState().assignments).length
    return [
      { view: 'heardle', label: 'Heardle', kind: 'daily', streak: heardle.currentStreak, done: heardle.lastDay === heardleToday() },
      { view: 'wordle', label: 'Wordle', kind: 'daily', streak: wordle.currentStreak, done: wordle.lastDay === wordleToday() },
      { view: 'tierlist', label: 'Tier List', kind: 'freeform', sub: rankedCount > 0 ? `${rankedCount} ranked` : 'Rank your songs' },
    ]
  }, [])

  const totalPlays = listeningPlays.length
  const distinctSongs = useMemo(
    () => new Set(listeningPlays.map((e) => e.song)).size,
    [listeningPlays],
  )
  const weekPlays = useMemo(
    () => filterListeningPlaysByDays(listeningPlays, 7).length,
    [listeningPlays],
  )

  // Server playlists need an account; the local kinds don't. Signed out we just
  // show what exists locally rather than prompting to sign in.
  const ownPlaylists = account ? playlists : []
  const playlistRow: HomePlaylistCard[] = [
    ...ownPlaylists.filter((p) => p.track_count > 0).map((p) => {
      // `playlists` is fetched with omit_cover_image=true (PlaylistsView's own
      // grid pays that same cost), so a summary object almost never carries
      // its own cover_image/cover_image_url — peekPlaylistCover's cache is the
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
  ].slice(0, 10)

  const openTrack = (track: Track): void => { playTrack(track) }

  // Mirrors NewsNotifier's openPost: NewsView reads this sessionStorage key
  // on mount to jump straight to the tapped post.
  const openNewsItem = (item: NewsItem): void => {
    setActiveView('news')
    try { sessionStorage.setItem('news:openPostId', String(item.id)) } catch {}
    window.dispatchEvent(new CustomEvent('news:open', { detail: item.id }))
  }

  // Navigating to WRLD used to land on the page without actually tuning in —
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
    setActiveView, openProfile,
    showSection,
    recent, newsItems, games, playlistRow,
    totalPlays, distinctSongs, weekPlays, siteStats,
    openTrack, openNewsItem, openRadioFm,
  }
}
