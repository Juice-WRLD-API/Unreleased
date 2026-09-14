// Song "version" grouping - e.g. "She's The One (v1)" / "(v2)" / "(TV Mix)"
// linked together as the same underlying song. juicewrldapi.com's own
// /versions/ table backs this (previously a separate Supabase project).
//
// The table's list endpoint (GET /versions/) doesn't apply its query params
// (group_id=, search=, title=) server-side, so any filtering by group or
// title has to happen client-side - fetched in one shot via ?all=true (same
// bulk mode /songs/ supports) rather than paging through it. GET
// /versions/{song_id}/ is the one endpoint that *does* filter server-side (0
// or 1 result for that song), so single-song lookups go through that instead
// of the full list.
//
// Writes (POST to create a row, PATCH /versions/{song_id}/{version_id}/ to
// update one - both the song id AND the row's own id are required in the
// path, PATCH on /versions/{song_id}/ alone returns 405) require an
// editor/admin auth token; there's no bulk-write endpoint, so group
// merges/title changes touching multiple rows send one request per
// affected song.
import { JWAPI_BASE, apiFetch } from './juicewrldApi'
import { getToken } from './userApi'

/** Always true now that this is core juicewrldapi functionality rather than
 *  optional Supabase config - kept as an export so existing call sites that
 *  gate version UI on it don't need to change. */
export const versionsEnabled = true

interface VersionRow {
  id: number
  song_id: number
  group_id: number
  version: string | null
  title: string | null
  created_at: string
  created_by: string | null
}

interface VersionsPage {
  count: number
  next: string | null
  previous: string | null
  results: VersionRow[]
}

/** Version metadata for one song within a linked group. */
export interface SongVersionMeta {
  songId: number
  groupId: number
  version: string | null
  versionTitle: string | null
  addedBy: string | null
}

function toMeta(row: VersionRow): SongVersionMeta {
  return { songId: row.song_id, groupId: row.group_id, version: row.version, versionTitle: row.title, addedBy: row.created_by }
}

async function getRow(songId: number): Promise<VersionRow | null> {
  const data = await apiFetch<VersionsPage>(`/versions/${songId}/`)
  return data.results[0] ?? null
}

// Full-table fetch (via ?all=true, same as juicewrldApi's /songs/ bulk mode),
// cached briefly since most operations here (group lookup, title search,
// bulk metadata) need the whole set and re-fetching it on every call would
// make the Tracker's compact view and song-info lookups noticeably slow.
// Invalidated immediately after any write so merges/title changes are
// reflected right away rather than waiting out the TTL.
const ALL_ROWS_TTL = 30_000
let allRowsCache: { promise: Promise<VersionRow[]>; ts: number } | null = null

function invalidateAllRowsCache(): void {
  allRowsCache = null
}

async function fetchAllRows(): Promise<VersionRow[]> {
  return apiFetch<VersionRow[]>('/versions/', { all: 'true' })
}

async function getAllRows(): Promise<VersionRow[]> {
  const now = Date.now()
  if (!allRowsCache || now - allRowsCache.ts > ALL_ROWS_TTL) {
    allRowsCache = { promise: fetchAllRows(), ts: now }
  }
  try {
    return await allRowsCache.promise
  } catch (e) {
    allRowsCache = null
    throw e
  }
}

async function writeVersions<T>(path: string, method: 'POST' | 'PATCH', body: Record<string, unknown>): Promise<T> {
  const token = getToken()
  if (!token) throw new Error('Not logged in')
  const res = await fetch(`${JWAPI_BASE}/versions${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let message = `Versions API error ${res.status}`
    try {
      const data = await res.json()
      if (data?.detail) message = data.detail
    } catch {}
    throw new Error(message)
  }
  invalidateAllRowsCache()
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

async function createRow(songId: number, groupId: number, version?: string | null, title?: string | null): Promise<void> {
  await writeVersions('/', 'POST', { song_id: songId, group_id: groupId, version: version ?? null, title: title ?? null })
}

async function patchRow(songId: number, versionId: number, body: Record<string, unknown>): Promise<void> {
  await writeVersions(`/${songId}/${versionId}/`, 'PATCH', body)
}

/** All other songs grouped with this one (excluding itself), with their
 *  version metadata. Empty if ungrouped.
 *
 *  Dedupes by song_id (keeping the most recently created row per song) -
 *  the /versions/ table has no unique constraint on (song_id, group_id), so
 *  a double-submitted "link versions" action leaves two identical rows per
 *  song and would otherwise show the same version twice in the UI. */
export async function getVersionGroup(songId: number): Promise<SongVersionMeta[]> {
  try {
    const row = await getRow(songId)
    if (!row) return []
    const all = await getAllRows()
    const bySong = new Map<number, VersionRow>()
    for (const r of all) {
      if (r.group_id !== row.group_id || r.song_id === songId) continue
      const existing = bySong.get(r.song_id)
      if (!existing || r.created_at > existing.created_at) bySong.set(r.song_id, r)
    }
    return Array.from(bySong.values()).map(toMeta)
  } catch {
    return []
  }
}

/** Every titled version group's rows. Used by the Tracker's compact view -
 *  deliberately independent of whichever songs happen to be paginated into
 *  the Tracker at the time, since a group's members can easily span pages
 *  the Tracker hasn't loaded yet (or won't, under the current category/search
 *  filter). */
export async function getAllVersionGroups(): Promise<SongVersionMeta[]> {
  try {
    const all = await getAllRows()
    return all.filter(r => r.title != null).map(toMeta)
  } catch {
    return []
  }
}

/** Version metadata for a known, bounded set of songs (e.g. a playlist's
 *  tracks) - only songs actually linked into a group come back. */
export async function getVersionMetaForSongs(songIds: number[]): Promise<Map<number, SongVersionMeta>> {
  if (songIds.length === 0) return new Map()
  try {
    const ids = new Set(songIds)
    const all = await getAllRows()
    const out = new Map<number, SongVersionMeta>()
    for (const row of all) {
      if (ids.has(row.song_id)) out.set(row.song_id, toMeta(row))
    }
    return out
  } catch {
    return new Map()
  }
}

/** Groups two songs as versions of each other. If one is already in a group,
 *  the other joins it (inheriting its title); if both are in different
 *  groups already, the groups merge (all members repointed to the lower
 *  group id, and the surviving title - whichever side had one set - is
 *  written to every row so the merged group doesn't end up with two songs
 *  claiming different titles). */
export async function linkSongVersion(songId: number, otherSongId: number): Promise<void> {
  if (songId === otherSongId) return
  const [a, b] = await Promise.all([getRow(songId), getRow(otherSongId)])
  if (a && b) {
    if (a.group_id === b.group_id) return
    const keep = Math.min(a.group_id, b.group_id)
    const drop = Math.max(a.group_id, b.group_id)
    const survivingTitle = (a.group_id === keep ? a.title : b.title) ?? (a.group_id === keep ? b.title : a.title)
    const all = await getAllRows()
    await Promise.all(
      all
        .filter(r => r.group_id === keep || r.group_id === drop)
        .filter(r => r.group_id === drop || (survivingTitle != null && r.title !== survivingTitle))
        .map(r => patchRow(r.song_id, r.id, {
          group_id: keep,
          ...(survivingTitle != null ? { title: survivingTitle } : {}),
        }))
    )
  } else if (a) {
    await createRow(otherSongId, a.group_id, null, a.title)
  } else if (b) {
    await createRow(songId, b.group_id, null, b.title)
  } else {
    const groupId = Math.min(songId, otherSongId)
    await Promise.all([createRow(songId, groupId), createRow(otherSongId, groupId)])
  }
}

/** This song's own version number/title/author, if it's linked into a group.
 *  Null if ungrouped. */
export async function getOwnVersionMeta(songId: number): Promise<SongVersionMeta | null> {
  try {
    const row = await getRow(songId)
    return row ? toMeta(row) : null
  } catch {
    return null
  }
}

/** Sets this song's own version label (e.g. "v1", "TV Mix") - distinct per
 *  song within a group, unlike the shared version title below. If the song
 *  isn't linked to anything yet, this creates a standalone one-song group
 *  for it (group_id = its own song id) rather than silently no-op'ing.
 *  Returns the group id the song ends up in, for setting the shared title
 *  afterward. */
export async function setSongVersion(
  songId: number,
  version: string | null,
  existingGroupId?: number | null
): Promise<number> {
  const groupId = existingGroupId ?? songId
  if (existingGroupId == null) {
    await createRow(songId, groupId, version)
  } else {
    // PATCH needs the row's own id in the path alongside the song id
    const row = await getRow(songId)
    if (row) await patchRow(songId, row.id, { version, group_id: groupId })
    else await createRow(songId, groupId, version)
  }
  return groupId
}

/** A group id nothing is using yet. Standalone groups conventionally reuse the
 *  song's own id (see setSongVersion); when that's already taken - the song is
 *  currently in a group whose id came from it - pick the next free integer
 *  instead. Nothing reads meaning from the number, only equality. */
function freeGroupId(all: VersionRow[], songId: number): number {
  const used = new Set<number>()
  for (const r of all) used.add(r.group_id)
  if (!used.has(songId)) return songId
  let candidate = songId
  for (const g of used) if (g > candidate) candidate = g
  candidate += 1
  while (used.has(candidate)) candidate += 1
  return candidate
}

/** Retitles from the perspective of ONE song.
 *
 *  The title belongs to the group, so renaming it in place would rename every
 *  linked song - which is rarely what an editor typing in one song's title
 *  field means. Instead, a song that shares its group with others is split out
 *  into a new group carrying the new title, leaving the original group and its
 *  remaining members untouched. A song that's alone in its group is simply
 *  retitled, since there's nothing to split from.
 *
 *  Joining an existing title is the separate, explicit path (the autocomplete
 *  suggestions → joinVersionGroup), and renaming a whole group on purpose is
 *  still setGroupVersionTitle, used by the bulk editor and the Tracker's
 *  "link versions" flow.
 *
 *  Returns the group id the song ends up in. */
export async function setOwnVersionTitle(
  songId: number,
  versionTitle: string | null,
  existingGroupId?: number | null,
): Promise<number> {
  const row = await getRow(songId)
  const all = await getAllRows()
  if (!row) {
    const groupId = existingGroupId ?? freeGroupId(all, songId)
    await createRow(songId, groupId, null, versionTitle)
    return groupId
  }

  const others = new Set<number>()
  for (const r of all) if (r.group_id === row.group_id && r.song_id !== songId) others.add(r.song_id)
  if (others.size === 0) {
    await patchRow(songId, row.id, { title: versionTitle })
    return row.group_id
  }

  // Move every row this song owns in the old group - the table has no unique
  // constraint on (song_id, group_id), so a double-submitted link can leave
  // duplicates behind that would otherwise keep the song in both groups.
  const groupId = freeGroupId(all, songId)
  const own = all.filter(r => r.song_id === songId && r.group_id === row.group_id)
  await Promise.all(own.map(r => patchRow(songId, r.id, { group_id: groupId, title: versionTitle })))
  return groupId
}

/** Sets the version title for every song in a group at once, so linked
 *  songs always agree on the title (e.g. "She's The One"). Group-wide by
 *  design - see setOwnVersionTitle for the single-song editor's rename. */
export async function setGroupVersionTitle(groupId: number, versionTitle: string | null): Promise<void> {
  const all = await getAllRows()
  const members = all.filter(r => r.group_id === groupId)
  await Promise.all(members.map(row => patchRow(row.song_id, row.id, { title: versionTitle })))
}

/** An existing version title plus the group it belongs to - picking one of
 *  these should join that group, not just copy the text (see
 *  joinVersionGroup below). */
export interface VersionTitleSuggestion {
  title: string
  groupId: number
}

/** Distinct existing version titles matching `query`, for autocompleting the
 *  title field so editors reuse e.g. "TV Mix" instead of typing variants of
 *  it across different groups. Empty query returns the most recent titles. */
export async function searchVersionTitles(query: string, limit = 8): Promise<VersionTitleSuggestion[]> {
  try {
    const q = query.trim().toLowerCase()
    const all = await getAllRows()
    const matches = (q ? all.filter(r => r.title && r.title.toLowerCase().includes(q)) : all.filter(r => r.title != null))
      .slice()
      .sort((r1, r2) => r2.created_at.localeCompare(r1.created_at))
    const seen = new Set<string>()
    const out: VersionTitleSuggestion[] = []
    for (const r of matches) {
      const title = r.title
      if (!title || seen.has(title)) continue
      seen.add(title)
      out.push({ title, groupId: r.group_id })
      if (out.length >= limit) break
    }
    return out
  } catch {
    return []
  }
}

/** Merges `songId` into an existing group (e.g. the one behind a title
 *  autocomplete suggestion), the same way linkSongVersion merges two songs'
 *  groups. Returns the group id the song ends up in. */
export async function joinVersionGroup(songId: number, targetGroupId: number): Promise<number> {
  const row = await getRow(songId)
  if (!row) {
    await createRow(songId, targetGroupId)
    return targetGroupId
  }
  if (row.group_id === targetGroupId) return targetGroupId
  const keep = Math.min(row.group_id, targetGroupId)
  const drop = Math.max(row.group_id, targetGroupId)
  const all = await getAllRows()
  await Promise.all(all.filter(r => r.group_id === drop).map(r => patchRow(r.song_id, r.id, { group_id: keep })))
  return keep
}
