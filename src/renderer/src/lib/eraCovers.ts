// Per-era cover overrides. JWA shows one shared placeholder cover across every
// unreleased song in an era, so instead of personalizing covers one song at a
// time, a user can swap that placeholder for a cover of their own choosing and
// have it apply to every unreleased song in the era at once.
//
// Like coverRotation.ts, this module holds only data and synchronous
// accessors and deliberately imports nothing but the storage helper -
// juicewrldApi's songToTrack reads it on every song → Track conversion, so
// importing the API layer here would make it a cycle.
//
// The "unreleased only" and "personal cover wins" rules aren't enforced here -
// they're gated at the call sites (songToTrack, liteSongToTrack,
// applyPrefToTrack), same as coverRotation's rotated suggestions.
import { ls } from './persist'

/** era abbreviation (e.g. "WOD") → raw cover pointer, same shape a song
 *  preference's cover_url holds (resolved to a loadable URL by
 *  resolvePrefCoverUrl at the call site). */
let _covers: Record<string, string> = ls.get<Record<string, string>>('eraCovers') ?? {}

/** The override raw pointer for an era, if the user has set one. Synchronous
 *  for the same reason peekSongPref is - read during song → Track conversion. */
export function peekEraCover(era: string | null | undefined): string | undefined {
  return era ? _covers[era] : undefined
}

/** The full override map, for the settings UI to render against. */
export function getEraCovers(): Record<string, string> {
  return _covers
}

/** Sets (or, with raw = null, clears) the override for one era. */
export function setEraCoverRaw(era: string, raw: string | null): void {
  _covers = { ..._covers }
  if (raw) _covers[era] = raw
  else delete _covers[era]
  ls.set('eraCovers', _covers)
}
