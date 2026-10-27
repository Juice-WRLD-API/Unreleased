// Shared "compact view" grouping logic - collapses items that share a
// version_title into one group. Used by both the Tracker (ApiTrackerView)
// and Playlists (PlaylistsView) so the grouping math only lives once.
//
// There are two different fetch strategies because the two callers start
// from different places:
//   - The Tracker doesn't reliably have every song loaded (paginated,
//     filtered by category/search), so it has to ask juicewrldapi's
//     /versions/ table for every titled group app-wide and then fetch the
//     actual song objects.
//   - Playlists already has its full, unpaginated track list in hand, so it
//     only needs version metadata for those specific songs - no need to
//     fetch anything about the songs themselves.
import { apiFetch, OMIT_BULK, JWApiSong, getSongsByIds, songToTrack } from './juicewrldApi'
import { SongVersionMeta, getAllVersionGroups, getVersionMetaForSongs, getVersionGroupsForSongs, versionsEnabled } from './versionsApi'
import { pickGroupVersion } from './versionPrefs'
import type { Track } from '../types'

export interface CompactGroup<T> {
  groupId: number
  title: string
  members: { item: T; meta: SongVersionMeta }[]
}

function buildGroups<T>(metas: SongVersionMeta[], getItem: (songId: number) => T | undefined): CompactGroup<T>[] {
  // Keyed by songId within each group - the /versions/ table has no
  // uniqueness constraint, and dozens of songs actually have two rows in the
  // same group, which showed up here as the same song listed twice inside an
  // expanded group (with duplicate React keys to boot).
  const byGroup = new Map<number, Map<number, SongVersionMeta>>()
  for (const meta of metas) {
    if (!meta.versionTitle) continue
    if (!byGroup.has(meta.groupId)) byGroup.set(meta.groupId, new Map())
    const members = byGroup.get(meta.groupId)!
    if (!members.has(meta.songId)) members.set(meta.songId, meta)
  }
  return [...byGroup.entries()]
    .map(([groupId, groupMetas]) => {
      const metaList = [...groupMetas.values()]
      return {
        groupId,
        title: metaList.find(m => m.versionTitle)?.versionTitle ?? '',
        members: metaList
          .map(m => ({ item: getItem(m.songId), meta: m }))
          .filter((x): x is { item: T; meta: SongVersionMeta } => !!x.item),
      }
    })
    .filter(g => g.members.length > 0)
}

// Caches the built groups (not just the raw fetches) so reopening compact
// view - switching tabs and coming back, toggling the view off/on - is
// instant instead of re-running the /versions/ + /songs/ fetch and the
// group-building pass every time. Same TTL as versionsApi's own cache, and
// invalidated explicitly wherever this app writes a version/title change
// (see invalidateCompactGroupsCache callers) so an edit shows up immediately
// rather than waiting out the TTL.
const COMPACT_GROUPS_TTL = 30_000
let compactGroupsCache: { promise: Promise<CompactGroup<JWApiSong>[]>; ts: number } | null = null

// Invalidating the cache doesn't help a Tracker/Playlists compact view that's
// already mounted and already fetched - its load effect only re-runs when its
// own deps change, not when some other part of the app writes a version
// change. Without this, an edit only showed up after toggling compact view
// off/on or leaving and returning to the page. Subscribers re-fetch
// immediately (if they're currently showing compact view) instead.
const invalidationListeners = new Set<() => void>()

export function invalidateCompactGroupsCache(): void {
  compactGroupsCache = null
  for (const listener of invalidationListeners) listener()
}

export function subscribeCompactGroupsInvalidation(listener: () => void): () => void {
  invalidationListeners.add(listener)
  return () => { invalidationListeners.delete(listener) }
}

async function buildAllCompactGroups(): Promise<CompactGroup<JWApiSong>[]> {
  const [metas, songs] = await Promise.all([
    getAllVersionGroups(),
    apiFetch<JWApiSong[]>('/songs/', { all: 'true', omit: OMIT_BULK }),
  ])
  const songMap = new Map(songs.map(s => [s.id, s]))
  return buildGroups(metas, id => songMap.get(id))
}

/** Every titled version group app-wide, with full song objects fetched for
 *  each member - for callers (the Tracker) that can't rely on their own
 *  song list to contain every group's members. Fetches the whole catalog in
 *  one request (`?all=true`, same bulk mode the /versions/ table uses)
 *  rather than one request per versioned song - the catalog is small enough
 *  (~2500 songs) that this is both simpler and far faster than the
 *  thousands of individual /songs/{id}/ round trips that used to make
 *  compact view slow to open. */
export async function fetchAllCompactGroups(): Promise<CompactGroup<JWApiSong>[]> {
  if (!versionsEnabled) return []
  const now = Date.now()
  if (!compactGroupsCache || now - compactGroupsCache.ts > COMPACT_GROUPS_TTL) {
    compactGroupsCache = { promise: buildAllCompactGroups(), ts: now }
  }
  try {
    return await compactGroupsCache.promise
  } catch (e) {
    compactGroupsCache = null
    throw e
  }
}

/** Titled version groups among a known, already-loaded list of items (e.g. a
 *  playlist's tracks) - `getSongId` extracts each item's song id. */
export async function groupItemsByVersion<T>(items: T[], getSongId: (item: T) => number): Promise<CompactGroup<T>[]> {
  if (!versionsEnabled || items.length === 0) return []
  const metaMap = await getVersionMetaForSongs(items.map(getSongId))
  const itemMap = new Map(items.map(item => [getSongId(item), item]))
  return buildGroups([...metaMap.values()], id => itemMap.get(id))
}

/** One row of Playlists' compact view: a song, however many of its versions
 *  the playlist holds. */
export interface SongUnit<T> {
  /** Version group id, or null for a song with no other versions. */
  groupId: number | null
  /** The playlist's entries for this song, in playlist order (always at
   *  least one). The first stands in for the song in the row itself. */
  items: { item: T; meta: SongVersionMeta | null }[]
  /** Every version in the group - including ones the playlist doesn't hold.
   *  Empty for a single-version song. */
  versions: SongVersionMeta[]
}

/** Collapses a playlist into one unit per song: entries sharing a version
 *  group (titled or not) merge, in order of their first appearance. Songs
 *  whose group has only themselves stay plain units with no versions. */
export async function groupPlaylistBySong<T>(items: T[], getSongId: (item: T) => number): Promise<SongUnit<T>[]> {
  const { groupOf, groups } = versionsEnabled
    ? await getVersionGroupsForSongs(items.map(getSongId).filter(id => id >= 0))
    : { groupOf: new Map<number, number>(), groups: new Map<number, SongVersionMeta[]>() }
  const units: SongUnit<T>[] = []
  const unitByGroup = new Map<number, SongUnit<T>>()
  for (const item of items) {
    const songId = getSongId(item)
    const groupId = groupOf.get(songId)
    const versions = groupId != null ? groups.get(groupId) ?? [] : []
    const meta = versions.find(m => m.songId === songId) ?? null
    if (groupId == null || versions.length < 2) {
      units.push({ groupId: null, items: [{ item, meta }], versions: [] })
      continue
    }
    const existing = unitByGroup.get(groupId)
    if (existing) { existing.items.push({ item, meta }); continue }
    const unit: SongUnit<T> = { groupId, items: [{ item, meta }], versions }
    unitByGroup.set(groupId, unit)
    units.push(unit)
  }
  return units
}

/** One track per song for a per-song shuffle - see pickGroupVersion for how
 *  the version is chosen. A preferred version outside the playlist is fetched
 *  so it can be queued; if that fails (or it has no file), the playlist's own
 *  entry plays instead. The caller shuffles the order. */
export async function pickSongVersions(units: SongUnit<Track>[]): Promise<Track[]> {
  const picks = units.map(u => {
    if (u.versions.length === 0) return { track: u.items[0].item, fetchId: null as number | null }
    const candidates = u.items.map(i => i.meta).filter((m): m is SongVersionMeta => !!m)
    const pick = pickGroupVersion(u.versions, candidates)
    const inPlaylist = pick ? u.items.find(i => i.meta?.songId === pick.songId)?.item : undefined
    if (!pick || inPlaylist) return { track: inPlaylist ?? u.items[0].item, fetchId: null }
    return { track: u.items[0].item, fetchId: pick.songId }
  })
  const fetchIds = picks.map(p => p.fetchId).filter((id): id is number => id != null)
  const fetched = new Map<number, Track>()
  if (fetchIds.length > 0) {
    try {
      for (const song of await getSongsByIds(fetchIds)) if (song.path) fetched.set(song.id, songToTrack(song))
    } catch {
      // Fall back to the playlist's own entries below.
    }
  }
  return picks.map(p => (p.fetchId != null ? fetched.get(p.fetchId) ?? p.track : p.track))
}

// Plain substring matching is apostrophe-sensitive - searching "wouldnt"
// (as typed on most keyboards without hunting for a curly quote) wouldn't
// match a title like "You Wouldn't Understand" otherwise. The server-side
// searchall the normal list uses is presumably more lenient about this;
// stripping every apostrophe variant from both sides before comparing gets
// this filter to the same place without a full fuzzy-search rewrite.
export function stripApostrophes(s: string): string {
  return s.replace(/['’‘]/g, '')
}

/** Client-side search filter for compact groups - both fetch strategies
 *  above are independent of whatever's in each view's search box, so
 *  without this, typing a search query while compact view is active would
 *  silently do nothing. If the query matches the group's title, the whole
 *  group is kept (searching "TV Mix" should show that entire group);
 *  otherwise members are filtered individually via `getSearchText`. */
export function filterCompactGroups<T>(
  groups: CompactGroup<T>[],
  query: string,
  getSearchText: (item: T) => string
): CompactGroup<T>[] {
  const q = stripApostrophes(query.trim().toLowerCase())
  if (!q) return groups
  return groups
    .map(g => {
      const groupMatches = stripApostrophes(g.title.toLowerCase()).includes(q)
      const members = groupMatches ? g.members : g.members.filter(m => stripApostrophes(getSearchText(m.item).toLowerCase()).includes(q))
      return { ...g, members }
    })
    .filter(g => g.members.length > 0)
}
