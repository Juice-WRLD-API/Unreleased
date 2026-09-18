// Shared data/logic for WrldView (the full-screen player). Desktop and
// mobile wrap this in their own layouts - keep behavior here. Several pieces
// of the original two files were NOT extracted here because they genuinely
// diverge in behavior, not just layout - see each hook's own comment for
// what's covered and what deliberately isn't.
import { useEffect, useRef, useState } from 'react'
import type { AccountUser } from '../lib/userApi'
import type { Track, FullTrack } from '../types'
import type { RadioTrack, RadioVote } from '../lib/radioLive'
import { buildImageUrl, apiFetch, songToTrack } from '../lib/juicewrldApi'
import type { JWApiSong } from '../lib/juicewrldApi'
import * as userApi from '../lib/userApi'
import { getActiveRadioClient } from '../lib/radioSocketService'
import { searchRadioLibrary } from '../lib/radioLibrary'
import type { RadioLibraryTrack } from '../lib/radioLibrary'
import { isLrcFormat, parseLrc } from '../lib/lyrics'
import { resumeEffectsContext } from '../lib/audioEffects'

type RadioFmMatchedSong = {
  songId: number | null
  imageUrl: string | null
  path: string | null
  lyrics: string | null
  syncedLyrics: string | null
  era: string | null
} | null

/** `artSrc` - the FM-or-track cover URL - plus the `artError` fallback flag
 * that resets whenever the source changes, and the song id a right-click
 * (desktop) or long-press (mobile) "Change cover" picker should target.
 * Byte-identical in both views. */
export function useWrldArt(
  radioFmActive: boolean,
  radioFmMatchedSong: RadioFmMatchedSong,
  radioFmNowPlaying: RadioTrack | null,
  currentTrackFull: FullTrack | null,
  currentTrack: Track | null,
): { artSrc: string | null; artError: boolean; setArtError: (v: boolean) => void; coverSongId: number | null } {
  const artSrc = radioFmActive
    ? (radioFmMatchedSong?.imageUrl ?? buildImageUrl(radioFmNowPlaying?.image_url) ?? null)
    : (buildImageUrl(currentTrackFull?.albumArt ?? currentTrack?.imageUrl ?? null) ?? null)

  const [artError, setArtError] = useState(false)
  useEffect(() => { setArtError(false) }, [artSrc])

  const coverSongId = radioFmActive
    ? (radioFmNowPlaying?.song_id ?? radioFmMatchedSong?.songId ?? null)
    : (currentTrack ? userApi.trackIdToSongId(currentTrack.id) : null)

  return { artSrc, artError, setArtError, coverSongId }
}

/** Text/track-trough colors read off the cover art's brightness (dark image
 * -> light text). `override` lets a caller skip the sampling entirely and
 * force a value - WrldView.desktop uses this for the "theme background"
 * option, which has no art to sample from; mobile has no such option and
 * always passes null. */
export function useArtTextContrast(
  artSrc: string | null,
  artError: boolean,
  isDarkSkin: boolean,
  radioFmActive: boolean,
  override: boolean | null,
): boolean {
  const [textIsDark, setTextIsDark] = useState(false)
  useEffect(() => {
    if (override != null) { setTextIsDark(override); return }
    if (!artSrc || artError) {
      setTextIsDark(!isDarkSkin && !radioFmActive)
      return
    }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 50; canvas.height = 50
        const ctx = canvas.getContext('2d')
        if (!ctx) { setTextIsDark(false); return }
        ctx.drawImage(img, 0, 0, 50, 50)
        const data = ctx.getImageData(0, 0, 50, 50).data
        let sum = 0
        for (let i = 0; i < data.length; i += 4)
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        const avg = sum / (data.length / 4)
        const factor = isDarkSkin ? 0.22 : 0.45
        setTextIsDark(avg * factor > 90)
      } catch { setTextIsDark(false) }
    }
    img.onerror = () => setTextIsDark(false)
    img.src = artSrc
  }, [artSrc, artError, isDarkSkin, radioFmActive, override])
  return textIsDark
}

/** Lyrics derived from whichever source is live (FM match vs local track),
 * plus who's allowed to edit them. Byte-identical in both views. */
export function useWrldLyricsSource(
  radioFmActive: boolean,
  radioFmMatchedSong: RadioFmMatchedSong,
  currentTrackFull: FullTrack | null,
  account: AccountUser | null,
): { rawLyrics: string | null; isSynced: boolean; isEditor: boolean; syncedLines: ReturnType<typeof parseLrc> } {
  const rawLyrics = radioFmActive
    ? (radioFmMatchedSong?.syncedLyrics || radioFmMatchedSong?.lyrics || null)
    : (currentTrackFull?.syncedLyrics || currentTrackFull?.lyrics || null)
  const isSynced = rawLyrics ? isLrcFormat(rawLyrics) : false
  const isEditor = !!(account?.is_editor || account?.is_administrator)
  const syncedLines = rawLyrics && isSynced ? parseLrc(rawLyrics) : []
  return { rawLyrics, isSynced, isEditor, syncedLines }
}

/** Now-playing title/artist/album (FM-or-track), the transport-disabled
 * flags, and the FM on/off toggle handler. Byte-identical in both views. */
export function useWrldNowPlaying(
  radioFmActive: boolean,
  radioFmIsLive: boolean | null,
  radioFmNowPlaying: RadioTrack | null,
  currentTrack: Track | null,
  setRadioFmActive: (v: boolean) => void,
  setIsPlaying: (v: boolean) => void,
): {
  displayTitle: string | undefined
  displayArtist: string | undefined
  displayAlbum: string | undefined
  fmDisabled: boolean
  noTrack: boolean
  toggleFm: () => void
} {
  const fmDisabled = radioFmIsLive === false && !radioFmActive
  const displayTitle  = radioFmActive && radioFmNowPlaying ? radioFmNowPlaying.title  : currentTrack?.title
  const displayArtist = radioFmActive && radioFmNowPlaying ? radioFmNowPlaying.artist : currentTrack?.artist
  const displayAlbum  = radioFmActive && radioFmNowPlaying ? radioFmNowPlaying.album  : currentTrack?.album
  // Nothing to control - gray out and disable the transport so it doesn't
  // look interactive when there's no track loaded (and FM isn't filling in).
  const noTrack = !radioFmActive && !currentTrack

  const toggleFm = (): void => {
    const next = !radioFmActive
    if (next) {
      setIsPlaying(false)
      resumeEffectsContext()
      void getActiveRadioClient()?.startListening()?.catch(() => setRadioFmActive(false))
    } else {
      getActiveRadioClient()?.stopListening()
    }
    setRadioFmActive(next)
  }

  return { displayTitle, displayArtist, displayAlbum, fmDisabled, noTrack, toggleFm }
}

/** Play a sibling version of the current song from the version-notch menu.
 * Byte-identical in both views - fetching songVersions itself is NOT shared,
 * since desktop gates playability via resolveSessionEditSource(song).path
 * while mobile only checks song.path, a genuine behavioral difference. */
export function usePlayVersion(playTrack: (t: Track) => void): (songId: number) => Promise<void> {
  return async (songId: number): Promise<void> => {
    try {
      const song = await apiFetch<JWApiSong>(`/songs/${songId}/`)
      playTrack(songToTrack(song))
    } catch {}
  }
}

/** 999 FM "suggest next song" search + propose flow: debounced library
 * search, and the propose-queue handler with its confirm/error timers.
 * `notConnectedMessage` is the only thing that differs between views (the
 * copy shown when the socket rejects a proposal). */
export function useRadioSuggest(notConnectedMessage: string): {
  suggestQuery: string
  setSuggestQuery: (v: string) => void
  suggestResults: RadioLibraryTrack[]
  suggestLoading: boolean
  proposed: string | null
  proposeError: string | null
  handlePropose: (track: RadioLibraryTrack) => void
  dismissProposed: () => void
} {
  const [suggestQuery, setSuggestQuery] = useState('')
  const [suggestResults, setSuggestResults] = useState<RadioLibraryTrack[]>([])
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [proposed, setProposed] = useState<string | null>(null)
  const [proposeError, setProposeError] = useState<string | null>(null)
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const proposeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (suggestTimer.current) clearTimeout(suggestTimer.current)
    if (!suggestQuery.trim()) { setSuggestResults([]); setSuggestLoading(false); return }
    setSuggestLoading(true)
    suggestTimer.current = setTimeout(async () => {
      // Search the DJ's published library, not /songs/ - only these ids can be
      // resolved back to a playable file by propose_queue.
      try {
        setSuggestResults(await searchRadioLibrary(suggestQuery))
      } catch { setSuggestResults([]) }
      setSuggestLoading(false)
    }, 400)
    return () => { if (suggestTimer.current) clearTimeout(suggestTimer.current) }
  }, [suggestQuery])

  const handlePropose = (track: RadioLibraryTrack): void => {
    // Only confirm if the proposal actually went out over the socket - a
    // closed/absent connection used to still flash "Proposed" while nothing
    // was ever sent.
    const sent = getActiveRadioClient()?.proposeQueue(track.id) ?? false
    const name = track.title
    setSuggestQuery('')
    setSuggestResults([])
    if (proposeTimer.current) clearTimeout(proposeTimer.current)
    if (sent) {
      setProposeError(null)
      setProposed(name)
      proposeTimer.current = setTimeout(() => setProposed(null), 4000)
    } else {
      setProposed(null)
      setProposeError(notConnectedMessage)
      proposeTimer.current = setTimeout(() => setProposeError(null), 4000)
    }
  }

  const dismissProposed = (): void => {
    setProposed(null)
    if (proposeTimer.current) clearTimeout(proposeTimer.current)
  }

  return { suggestQuery, setSuggestQuery, suggestResults, suggestLoading, proposed, proposeError, handlePropose, dismissProposed }
}

/** 999 FM vote-to-skip/queue countdown: resets the local vote selection on a
 * new ballot (rising edge of `active`, not equality - see inline comment),
 * then ticks a local 1s countdown kept in sync with (not recreated on) each
 * server broadcast. `onNewVote` covers the one bit of extra reset state each
 * view keeps beside `myVote` (desktop clears a vote-send error, mobile
 * un-dismisses the vote card). */
export function useRadioVoteCountdown(
  voteActive: boolean | undefined,
  secondsLeft: number | null | undefined,
  onNewVote?: () => void,
): { myVote: 'yes' | 'no' | null; setMyVote: (v: 'yes' | 'no' | null) => void; localSecondsLeft: number | null } {
  const [myVote, setMyVote] = useState<'yes' | 'no' | null>(null)
  const [localSecondsLeft, setLocalSecondsLeft] = useState<number | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wasVoteActiveRef = useRef(false)

  useEffect(() => {
    const isActive = !!voteActive
    if (isActive && !wasVoteActiveRef.current) {
      setMyVote(null)
      onNewVote?.()
    }
    wasVoteActiveRef.current = isActive
    // onNewVote deliberately excluded - each caller passes a fresh closure
    // every render, and it's only ever invoked from this rising-edge check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voteActive])

  useEffect(() => {
    if (!voteActive || secondsLeft == null) {
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
      setLocalSecondsLeft(null)
      return
    }
    setLocalSecondsLeft(secondsLeft)
    if (!countdownRef.current) {
      countdownRef.current = setInterval(() => {
        setLocalSecondsLeft(s => (s != null && s > 0) ? s - 1 : 0)
      }, 1000)
    }
  }, [voteActive, secondsLeft])

  // Unmount-only cleanup for the countdown interval
  useEffect(() => () => { if (countdownRef.current) clearInterval(countdownRef.current) }, [])

  return { myVote, setMyVote, localSecondsLeft }
}
