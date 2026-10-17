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
import { peekSongPref } from './songPrefs'
import type { SongVersionMeta } from './versionsApi'

const norm = (label: string): string => label.trim().toLowerCase()

/** Matches a member against a version label ("v1", "TV Mix"). Compares the
 *  per-song `version` field only - `versionTitle` is shared by every member of
 *  a group and so can't distinguish between them. */
export const matchesVersionLabel = (meta: SongVersionMeta | null | undefined, label: string): boolean =>
  !!meta?.version && norm(meta.version) === norm(label)

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

/** True if `meta`'s version label is in `labels` (a set from one of the
 *  helpers above). Members with no version label (recording sessions, etc.)
 *  never match, so they can be neither preferred nor excluded. */
export const hasVersionLabelIn = (meta: SongVersionMeta | null | undefined, labels: Set<string>): boolean =>
  !!meta?.version && labels.has(norm(meta.version))

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
