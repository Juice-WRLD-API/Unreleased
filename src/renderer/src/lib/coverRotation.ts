// Which suggested cover a song is currently showing, for the "rotate suggested
// covers" setting (see coverSuggestions.ts for the search that produces the
// candidates, and the store's rotateSuggestedCovers for the toggle).
//
// Like songPrefs.ts, this module holds only data and synchronous accessors and
// deliberately imports nothing but the storage helper: juicewrldApi's
// songToTrack reads it on every song → Track conversion, so importing the API
// layer here would make it a cycle. The async half lives in
// coverSuggestions.ts, which may import freely.
//
// Only the *chosen URL* is persisted, never a candidate index: the candidate
// list comes from a file search that changes as files are added, so an index
// would silently point at a different cover later. Resolving position by
// looking the URL up in the current list degrades gracefully instead.
//
// Nothing here ever writes songPrefs.cover_url - a rotated cover is a display
// choice, not a user override. Writing one would defeat the "user hasn't set a
// cover" condition that gates rotation, and sync junk up to the profile.
import { ls } from './persist'

let _chosen: Record<number, string> = ls.get<Record<number, string>>('rotatedCovers') ?? {}

// One short URL per song ever rotated. Capped so a long-lived install can't
// grow this without bound; insertion order approximates least-recently-started.
const MAX_REMEMBERED = 1000

/** The suggested cover currently chosen for a song, if any. Synchronous for
 *  the same reason peekSongPref is - it's read during song → Track conversion. */
export function peekRotatedCover(songId: number): string | undefined {
  return _chosen[songId]
}

/** Records the cover a song has rotated onto. */
export function rememberRotatedCover(songId: number, url: string): void {
  _chosen[songId] = url
  const keys = Object.keys(_chosen)
  if (keys.length > MAX_REMEMBERED) {
    for (const k of keys.slice(0, keys.length - MAX_REMEMBERED)) delete _chosen[Number(k)]
  }
  ls.set('rotatedCovers', _chosen)
}

/** Forgets every rotated cover, so songs fall back to their own art. Called
 *  when the setting is switched off - otherwise covers would freeze on
 *  whichever suggestion happened to be showing when it was disabled. */
export function clearRotatedCovers(): void {
  _chosen = {}
  ls.set('rotatedCovers', _chosen)
}
