// Group-level reads of the per-song version preferences in lib/songPrefs.
//
// Preferences are stored per song, but "which versions of this song do I want
// to hear" is really a property of the whole version GROUP - so every helper
// here takes the group's members and unions what each member's row says.
//
// Preferred versions ride on the existing `default_version` field rather than
// a new one: each member's row holds at most one label, and the group's
// preferred set is the union of them. Starring a version writes its label to
// that version's own row, which is how several versions can be preferred at
// once without changing the stored shape. Older rows that hold a *sibling's*
// label (a default set from another version's menu) still count - the union
// doesn't care which row a label lives on.
//
// Kept free of store imports so both the queue slice and lib-level helpers
// (compactGroups' shuffle) can use it without a cycle.
import { peekSongPref, type SongPrefMap } from './songPrefs'
import type { SongVersionMeta } from './versionsApi'

const norm = (label: string): string => label.trim().toLowerCase()

/** Label a recording-session member is preferred/excluded under when editors
 *  haven't given it a version label of its own. */
export const SESSION_VERSION_LABEL = 'Session'

/** The label preferences key a member by: its per-song `version` field (never
 *  `versionTitle`, which every member of a group shares and so can't tell them
 *  apart), or SESSION_VERSION_LABEL for an unlabelled session. Null = the
 *  member can be neither preferred nor excluded. */
export const prefLabel = (meta: Pick<SongVersionMeta, 'version' | 'isSession'> | null | undefined): string | null =>
  meta?.version || (meta?.isSession ? SESSION_VERSION_LABEL : null)

/** Matches a member against a version label ("v1", "TV Mix", "Session"). */
export const matchesVersionLabel = (meta: SongVersionMeta | null | undefined, label: string): boolean => {
  const own = prefLabel(meta)
  return !!own && norm(own) === norm(label)
}

/** Every version label this user prefers within `songId`'s group, normalized.
 *  Excluded labels are removed - an explicit exclusion beats a stale star. */
export function groupPreferredVersions(songId: number, group: SongVersionMeta[]): Set<string> {
  const preferred = new Set<string>()
  const own = peekSongPref(songId)?.default_version
  if (own) preferred.add(norm(own))
  for (const member of group) {
    const label = peekSongPref(member.songId)?.default_version
    if (label) preferred.add(norm(label))
  }
  for (const label of groupExcludedVersions(songId, group)) preferred.delete(label)
  return preferred
}

/** Version labels this user never wants auto-picked from `songId`'s group
 *  (e.g. compact view's shuffle-play) - a union across every member's own
 *  excluded list, since exclusion (like preference) is really a property of
 *  the group rather than any one row. */
export function groupExcludedVersions(songId: number, group: SongVersionMeta[]): Set<string> {
  const excluded = new Set<string>()
  for (const label of peekSongPref(songId)?.excluded_versions ?? []) excluded.add(norm(label))
  for (const member of group) {
    for (const label of peekSongPref(member.songId)?.excluded_versions ?? []) excluded.add(norm(label))
  }
  return excluded
}

/** True if `meta`'s label (prefLabel) is in `labels` (a set from one of the
 *  helpers above). Members with no label never match. */
export const hasVersionLabelIn = (meta: SongVersionMeta | null | undefined, labels: Set<string>): boolean => {
  const label = prefLabel(meta)
  return !!label && labels.has(norm(label))
}

/** Kept under its old name for the exclusion call sites. */
export const isExcludedVersion = hasVersionLabelIn

/** Picks which member of a group should play when the group as a whole was
 *  chosen (compact view's per-song shuffle). Preferred versions win, chosen
 *  at random when there are several - and may be versions outside
 *  `candidates`, since a preference is about the song, not the playlist.
 *  Otherwise a random non-excluded member of `candidates`. Falls back to any
 *  candidate if exclusions would leave nothing. */
export function pickGroupVersion(group: SongVersionMeta[], candidates: SongVersionMeta[]): SongVersionMeta | null {
  if (candidates.length === 0) return null
  const anchor = candidates[0].songId
  const random = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)]
  const preferred = groupPreferredVersions(anchor, group)
  const preferredMembers = group.filter(m => hasVersionLabelIn(m, preferred))
  if (preferredMembers.length > 0) return random(preferredMembers)
  const excluded = groupExcludedVersions(anchor, group)
  const allowed = candidates.filter(m => !hasVersionLabelIn(m, excluded))
  return random(allowed.length > 0 ? allowed : candidates)
}

/** One member of a version group, as far as preferences care: its song and
 *  its prefLabel (null = can't be preferred or excluded). */
export interface VersionPrefMember {
  songId: number
  version: string | null
}

/** Where the toggles below write - the store's setSongDefaultVersion /
 *  setSongExcludedVersions, passed in to keep this file store-free. */
export interface VersionPrefWriters {
  setDefault: (songId: number, version: string | null) => void
  setExcluded: (songId: number, versions: string[]) => void
}

/** The group's preferred and excluded labels (normalized) as `prefs` has them
 *  for `members` - the same union groupPreferredVersions takes, over an
 *  explicit prefs map so a React caller can re-derive it on change. */
export function memberVersionPrefs(members: VersionPrefMember[], prefs: SongPrefMap): { preferred: Set<string>; excluded: Set<string> } {
  const excluded = new Set<string>()
  for (const m of members) for (const label of prefs[m.songId]?.excluded_versions ?? []) excluded.add(norm(label))
  const preferred = new Set<string>()
  for (const m of members) {
    const label = prefs[m.songId]?.default_version
    if (label && !excluded.has(norm(label))) preferred.add(norm(label))
  }
  return { preferred, excluded }
}

/** The star/ban toggles over a group, shared by useVersionPrefToggles (the
 *  Change-version menu, the song-prefs panel, compact view, WRLD's version
 *  notch) and the terminal's `vprefs`, so both change the same rows. */
export function versionPrefToggles(members: VersionPrefMember[], prefs: SongPrefMap, write: VersionPrefWriters): {
  togglePreferred: (member: VersionPrefMember) => void
  toggleExcluded: (member: VersionPrefMember) => void
  clearPreferred: () => void
} {
  const { preferred, excluded } = memberVersionPrefs(members, prefs)

  const clearLabel = (label: string): void => {
    for (const m of members) {
      const d = prefs[m.songId]?.default_version
      if (d && norm(d) === label) write.setDefault(m.songId, null)
    }
  }

  const unexclude = (label: string): void => {
    for (const m of members) {
      const list = prefs[m.songId]?.excluded_versions ?? []
      if (list.some(v => norm(v) === label)) write.setExcluded(m.songId, list.filter(v => norm(v) !== label))
    }
  }

  const togglePreferred = (member: VersionPrefMember): void => {
    if (!member.version) return
    const label = norm(member.version)
    // Clearing has to reach wherever the label actually lives (its own row or
    // a sibling's) or the star would stay lit.
    if (preferred.has(label)) { clearLabel(label); return }
    // Preferring an excluded version un-excludes it - the two can't both hold.
    if (excluded.has(label)) unexclude(label)
    // A row holds one label; an older default can sit on a sibling's row
    // instead of its own. Move it home before overwriting so it stays preferred.
    const displaced = prefs[member.songId]?.default_version
    if (displaced && norm(displaced) !== label) {
      const home = members.find(m => m.songId !== member.songId && m.version && norm(m.version) === norm(displaced) && !prefs[m.songId]?.default_version)
      if (home) write.setDefault(home.songId, displaced)
    }
    write.setDefault(member.songId, member.version)
  }

  const toggleExcluded = (member: VersionPrefMember): void => {
    if (!member.version) return
    const label = norm(member.version)
    if (excluded.has(label)) { unexclude(label); return }
    // Excluding a preferred version drops the star - same reasoning as above.
    clearLabel(label)
    write.setExcluded(member.songId, [...(prefs[member.songId]?.excluded_versions ?? []), member.version])
  }

  const clearPreferred = (): void => {
    for (const m of members) if (prefs[m.songId]?.default_version) write.setDefault(m.songId, null)
  }

  return { togglePreferred, toggleExcluded, clearPreferred }
}
