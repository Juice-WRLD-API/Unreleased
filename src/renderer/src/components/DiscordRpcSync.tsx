import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { useShallow } from 'zustand/react/shallow'
import { discordCoverUrl, matchLocalSongCover, songSearchPageUrl, PLAYER_SITE, type LocalSongCover } from '../lib/juicewrldApi'
import { eraFullName, loadEraFullNames } from '../lib/eras'

// How far the live playback position is allowed to drift from what we last
// told Discord before we resend. A seek (fast-forward/rewind) jumps
// currentTime well past this in a single tick; ordinary playback never does.
const SEEK_DRIFT_THRESHOLD_S = 2.5
const DRIFT_CHECK_MS = 3000

// Headless — pushes "now playing" facts to the main process whenever they
// change, which builds and applies the actual Discord Rich Presence activity.
// Deliberately does NOT subscribe to `currentTime`/`progress` for the normal
// update path: Discord renders its own live countdown from the start/end
// timestamps we send once, so re-sending on every playback tick would just
// spam (and exceed) the RPC rate limit for no visual benefit. A separate
// low-frequency drift check (see below) catches seeks, which otherwise leave
// Discord's countdown anchored to the pre-seek position indefinitely.
export default function DiscordRpcSync(): JSX.Element | null {
  const {
    currentTrack, isPlaying,
    radioFmActive, radioFmNowPlaying, radioFmMatchedSong,
  } = useStore(useShallow(s => ({
    currentTrack: s.currentTrack,
    isPlaying: s.isPlaying,
    radioFmActive: s.radioFmActive,
    radioFmNowPlaying: s.radioFmNowPlaying,
    radioFmMatchedSong: s.radioFmMatchedSong,
  })))

  // currentTime is read fresh (not subscribed) only at the moment we send an
  // update, so it doesn't trigger re-renders/re-sends on its own.
  const getCurrentTime = (): number => useStore.getState().currentTime

  const el = (window as any).electron
  // Era full names (e.g. "WOD" → "WRLD On Drugs") load asynchronously from
  // /eras/; this bumps the effect below once they arrive so an activity sent
  // with the bare abbreviation gets re-sent with the full name.
  const [erasReady, setErasReady] = useState(false)
  // Only worth the two /eras/ pages where an activity can actually be sent —
  // on the web build there's no RPC bridge at all, so this was two startup
  // requests whose result nothing could ever read.
  useEffect(() => {
    if (!el?.discordRpcSetActivity) return
    let on = true
    loadEraFullNames().then(() => { if (on) setErasReady(true) }).catch(() => {})
    return () => { on = false }
  }, [el])
  // Cover art for a locally-scanned file, resolved by matching it to the API's
  // song list (see matchLocalSongCover). Tagged with the track it was resolved
  // for, so a match arriving after the user has already skipped on can't be
  // applied to the wrong song.
  const [localCover, setLocalCover] = useState<{ trackId: string; cover: LocalSongCover | null } | null>(null)
  const lastSentKeyRef = useRef<string | null>(null)
  // What we last told Discord the position was, and when (wall-clock) — lets
  // the drift check below compute where Discord *thinks* playback is now and
  // compare it to where it actually is.
  const lastSentPosRef = useRef<{ currentTime: number; at: number } | null>(null)

  // A locally-scanned file has no curated `imageUrl`, and its `path` is a
  // filesystem path the API's cover-art endpoint can't resolve — so its cover
  // has to be earned by matching the file to a song the API hosts.
  const isLocalTrack = !!currentTrack?.id.startsWith('local-') && !currentTrack.imageUrl

  useEffect(() => {
    if (!isLocalTrack || !currentTrack) return
    let cancelled = false
    const trackId = currentTrack.id
    matchLocalSongCover(currentTrack.title)
      .then((cover) => { if (!cancelled) setLocalCover({ trackId, cover }) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [isLocalTrack, currentTrack?.id, currentTrack?.title])

  const matchedCover = currentTrack && localCover?.trackId === currentTrack.id ? localCover.cover : null
  // Local tracks pass null for the path — see discordCoverUrl — and fall back
  // to the matched song's cover, or to the static logo when nothing matched.
  const trackCoverUrl = currentTrack
    ? discordCoverUrl(currentTrack.imageUrl, isLocalTrack ? null : currentTrack.path) ?? matchedCover?.imageUrl ?? null
    : null
  // Full era name for API tracks ("WOD" → "WRLD On Drugs"), the bare
  // abbreviation until /eras/ has loaded, the matched song's era for local
  // files, then album for tracks with no era data at all.
  const trackEraSrc = currentTrack?.era || matchedCover?.era || undefined
  const trackEra = eraFullName(trackEraSrc) || trackEraSrc || currentTrack?.album || undefined

  // Target of the card's "Listen on API" button. Searched under the song's
  // canonical API name where one is known — `apiTitle` for a track the user
  // has renamed, the matched song's name for a local file — since the site's
  // search only knows the API's own titles. A local file that matched nothing
  // gets no button rather than one leading to an empty search.
  // API tracks (`jw-<id>`) and matched local files link to the song's own
  // /track/<id> page on the player; the search link is the fallback.
  const apiSongId = currentTrack?.id.startsWith('jw-') ? Number(currentTrack.id.slice(3)) : NaN
  const trackLinkUrl = !currentTrack
    ? null
    : isLocalTrack
      ? (matchedCover ? `${PLAYER_SITE}/track/${matchedCover.songId}` : null)
      : Number.isInteger(apiSongId)
        ? `${PLAYER_SITE}/track/${apiSongId}`
        : songSearchPageUrl(currentTrack.apiTitle || currentTrack.title) ?? null

  useEffect(() => {
    if (!el?.discordRpcSetActivity) return

    if (radioFmActive) {
      if (!radioFmNowPlaying) {
        if (lastSentKeyRef.current !== null) {
          el.discordRpcClearActivity?.()
          lastSentKeyRef.current = null
          lastSentPosRef.current = null
        }
        return
      }
      // Full era name when the abbreviation is known ("WOD" → "WRLD On
      // Drugs"), then the bare abbreviation, then stream metadata's album.
      const era = eraFullName(radioFmMatchedSong?.era) || radioFmMatchedSong?.era || radioFmNowPlaying.album || undefined
      // The matched song (cover + era) resolves asynchronously after the
      // now-playing update, so it — and the resolved era — are part of the
      // key; otherwise the resend carrying that data would be deduped away.
      const key = `radio:${radioFmNowPlaying.title}:${radioFmNowPlaying.artist}:${radioFmMatchedSong?.songId ?? ''}:${era ?? ''}`
      if (key === lastSentKeyRef.current) return
      lastSentKeyRef.current = key
      const currentTime = (radioFmNowPlaying.elapsed_ms ?? 0) / 1000
      lastSentPosRef.current = { currentTime, at: Date.now() }
      el.discordRpcSetActivity({
        title: radioFmNowPlaying.title,
        artist: radioFmNowPlaying.artist,
        isPlaying: true,
        currentTime,
        duration: (radioFmNowPlaying.duration_ms ?? 0) / 1000,
        isRadio: true,
        era,
        coverUrl: discordCoverUrl(radioFmMatchedSong?.imageUrl ?? radioFmNowPlaying.image_url, radioFmMatchedSong?.path) ?? null,
        // Radio points at the station itself rather than the song — someone
        // clicking through while it's live wants to tune in, not to search.
        linkUrl: `${PLAYER_SITE}/wrld`,
      })
      return
    }

    if (!currentTrack) {
      if (lastSentKeyRef.current !== null) {
        el.discordRpcClearActivity?.()
        lastSentKeyRef.current = null
        lastSentPosRef.current = null
      }
      return
    }

    // Paused: clear the Rich Presence entirely rather than showing a "frozen"
    // card. Discord has no real concept of "paused" for classic RPC — any
    // activity without timestamps still gets its own auto-ticking elapsed
    // indicator (the small controller-icon counter), so the only way to show
    // nothing misleading is to show nothing at all, same as native Spotify
    // integration does while paused.
    if (!isPlaying) {
      if (lastSentKeyRef.current !== null) {
        el.discordRpcClearActivity?.()
        lastSentKeyRef.current = null
        lastSentPosRef.current = null
      }
      return
    }

    // The era and the local-file cover both resolve asynchronously (era names
    // from /eras/, the cover from a title match), so both are in the key —
    // otherwise the resend that carries them would be deduped away.
    const key = `track:${currentTrack.id}:playing:${trackEra ?? ''}:${trackCoverUrl ?? ''}:${trackLinkUrl ?? ''}`
    if (key === lastSentKeyRef.current) return
    lastSentKeyRef.current = key
    const currentTime = getCurrentTime()
    lastSentPosRef.current = { currentTime, at: Date.now() }
    el.discordRpcSetActivity({
      title: currentTrack.title,
      artist: currentTrack.artist,
      isPlaying: true,
      currentTime,
      duration: currentTrack.duration,
      isRadio: false,
      era: trackEra,
      coverUrl: trackCoverUrl,
      linkUrl: trackLinkUrl,
    })
  }, [el, currentTrack?.id, currentTrack?.title, currentTrack?.artist, currentTrack?.duration, trackCoverUrl, trackEra, trackLinkUrl, isPlaying, radioFmActive, radioFmNowPlaying?.title, radioFmNowPlaying?.artist, radioFmNowPlaying?.album, radioFmMatchedSong?.imageUrl, radioFmMatchedSong?.path, radioFmMatchedSong?.era, erasReady])

  // Seek detection: periodically compare where Discord thinks playback is
  // (extrapolated from the last update) against the real live position, and
  // resend if they've diverged more than ordinary playback ever would.
  useEffect(() => {
    if (!el?.discordRpcSetActivity || !isPlaying || radioFmActive || !currentTrack) return
    const id = setInterval(() => {
      const last = lastSentPosRef.current
      if (!last) return
      // Extrapolate at the actual playback rate — at 1.5x/2x a 1x wall-clock
      // estimate falls behind real playback immediately, tripping the drift
      // threshold over and over and re-sending the activity every few
      // seconds: exactly the RPC rate-limit spam this check exists to avoid.
      const expected = last.currentTime + ((Date.now() - last.at) / 1000) * useStore.getState().playbackSpeed
      const actual = getCurrentTime()
      if (Math.abs(actual - expected) < SEEK_DRIFT_THRESHOLD_S) return
      lastSentPosRef.current = { currentTime: actual, at: Date.now() }
      el.discordRpcSetActivity({
        title: currentTrack.title,
        artist: currentTrack.artist,
        isPlaying: true,
        currentTime: actual,
        duration: currentTrack.duration,
        isRadio: false,
        era: trackEra,
        coverUrl: trackCoverUrl,
        linkUrl: trackLinkUrl,
      })
    }, DRIFT_CHECK_MS)
    return () => clearInterval(id)
  }, [el, isPlaying, radioFmActive, currentTrack, trackCoverUrl, trackEra, trackLinkUrl])

  return null
}
