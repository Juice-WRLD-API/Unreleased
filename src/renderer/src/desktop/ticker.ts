// The Lyrics Ticker's line: the one being sung now, else the song's name and artist - between lines, before the words
// come, and when they aren't timed. Read from the app's own lyrics (FM's matched song while 999 FM plays).
import { useStore } from '../store/useStore'
import { getAudioCurrentTime } from '../components/Player'
import { getCurrentLineIndex, isLrcFormat, parseLrc } from '../lib/lyrics'
import type { SyncedLyricLine } from '../types'

let parsedFor: string | null = null
let parsed: SyncedLyricLine[] = []

export function tickerLine(): string {
  const s = useStore.getState()
  const fm = s.radioFmActive
  const title = fm ? s.radioFmNowPlaying?.title : s.currentTrack?.title
  const artist = fm ? s.radioFmNowPlaying?.artist : s.currentTrack?.artist
  const name = title ? `${title}${artist ? ` — ${artist}` : ''}` : 'Unreleased'
  const raw = fm
    ? (s.radioFmMatchedSong?.syncedLyrics || s.radioFmMatchedSong?.lyrics || null)
    : (s.currentTrackFull && s.currentTrackFull.id === s.currentTrack?.id ? s.currentTrackFull.syncedLyrics || s.currentTrackFull.lyrics : null)
  if (!raw || !isLrcFormat(raw)) return name
  if (raw !== parsedFor) { parsedFor = raw; parsed = parseLrc(raw) }
  const i = getCurrentLineIndex(parsed, getAudioCurrentTime() - s.lyricsOffset)
  return (i >= 0 ? parsed[i]?.text?.trim() : '') || name
}
