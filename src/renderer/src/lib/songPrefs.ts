// Per-user, per-song overrides for API songs: a personal display name, a
// personal cover picked from the API's storage, a preferred version to play
// within the song's version group, and a play counter.
//
// This module holds only the data and its synchronous accessors, and
// deliberately imports nothing: juicewrldApi's songToTrack reads it on every
// song → Track conversion, so anything imported here would become a circular
// dependency of the API layer. The pieces live elsewhere:
//   - network calls          → preferencesApi.ts
//   - writes + React state   → the Zustand store (`songPrefs`)
//   - playback resolution    → queueSlice's version swap
//   - cover URL resolution   → juicewrldApi's resolvePrefCoverUrl
//
// The store owns every write and mirrors its map in here via setSongPrefsCache
// so non-React callers always resolve against the current overrides.

/** One user's overrides for one song - mirrors the API row shape. */
export interface SongPreference {
  /** Numeric API song id (the row's `song` field). */
  song: number
  /** Custom display name, or null to use the song's own title. */
  name: string | null
  /** Cover to use instead of the song's own image, as a pointer into the
   *  API's storage. Resolved to a loadable URL by resolvePrefCoverUrl. */
  cover_url: string | null
  /** Preferred version *label* (e.g. "v1", "OG", "TV Mix") within this song's
   *  version group - matched against the /versions/ table's `version` field
   *  rather than holding a song id, so it survives songs being relinked or
   *  groups being merged. A default set on any member governs the whole group;
   *  see queueSlice's groupDefaultVersion. */
  default_version: string | null
  /** Version *labels* (same matching rules as `default_version`) this user
   *  never wants picked automatically within the group - e.g. a random pick
   *  for a compact-view shuffle-play. Doesn't affect explicitly choosing the
   *  version from the "Change version" menu. Excluded on any member governs
   *  the whole group; see queueSlice's groupExcludedVersions. */
  excluded_versions: string[]
  /** How many times this user has played the song. */
  playcount: number
}

export type SongPrefMap = Record<number, SongPreference>

/** A change to a preference row - only the fields being set. */
export type SongPrefPatch = Partial<Omit<SongPreference, 'song'>>

let _prefs: SongPrefMap = {}

/** Synchronous read for callers that can't reach the store without a cycle
 *  (songToTrack, liteSongToTrack, the version swap). */
export function peekSongPref(songId: number): SongPreference | undefined {
  return _prefs[songId]
}

/** Mirrors the store's map into this module. Called on every write, on
 *  hydrate, after a login merge, and when a pop-out window receives a synced
 *  patch (which goes through setState and so bypasses the store's actions). */
export function setSongPrefsCache(next: SongPrefMap): void {
  _prefs = next
}

/** True if any song has a default version set. Lets playback skip the
 *  version-group lookup entirely for users who've never set one, instead of
 *  paying a /versions/ round trip on every track change. */
export function hasAnyDefaultVersion(): boolean {
  for (const songId in _prefs) {
    if (_prefs[songId].default_version) return true
  }
  return false
}

/** A row with no overrides yet, so callers can patch a song that has no
 *  preferences without repeating the defaults. */
export function emptySongPref(songId: number): SongPreference {
  return { song: songId, name: null, cover_url: null, default_version: null, excluded_versions: [], playcount: 0 }
}

/** True once a row carries no overrides and no play history - the store drops
 *  these instead of keeping empty rows around forever. */
export function isEmptySongPref(p: SongPreference): boolean {
  return p.name == null && p.cover_url == null && p.default_version == null
    && (p.excluded_versions?.length ?? 0) === 0 && p.playcount === 0
}

/** Normalizes a user-entered name/version to either a non-empty trimmed
 *  string or null, so a cleared text field stores an absent override rather
 *  than an empty string that would read as "" everywhere downstream. */
export function normalizePrefText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** Server-side cap on `user_preferences` rows (the profile-blob validator's
 *  limit). Local storage keeps everything; only the pushed copy is capped. */
export const SERVER_PREFS_LIMIT = 500

/** Fits the prefs array under the server's row cap. Rows with real overrides
 *  (name/cover/default version) survive first - a playcount-only row is the
 *  cheapest thing to lose since every song played past the threshold creates
 *  one - then higher playcounts win among the rest. */
export function capSongPrefs(prefs: SongPreference[], max = SERVER_PREFS_LIMIT): SongPreference[] {
  if (prefs.length <= max) return prefs
  const hasOverride = (p: SongPreference): boolean =>
    p.name != null || p.cover_url != null || p.default_version != null || (p.excluded_versions?.length ?? 0) > 0
  return [...prefs]
    .sort((a, b) => (Number(hasOverride(b)) - Number(hasOverride(a))) || (b.playcount - a.playcount))
    .slice(0, max)
}
