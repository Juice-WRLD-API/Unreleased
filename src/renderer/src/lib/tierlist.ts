// Data + persistence for the Tier List game - drag songs into ranked rows and
// save the result locally. Unlike Heardle/Wordle this has no daily puzzle or
// scoring: it's a personal ranking, so state is just "which lists exist",
// and per list "what tiers exist", "which songs sit in each tier, in what
// order" and "which songs the list draws from", all kept in localStorage.
import { normalizeTitle } from './heardle'
import type { HeardleSong, PoolId } from './heardle'
import type { Album } from './albumsApi'

export interface Tier {
  id: string
  label: string
  color: string
}

export const TIER_COLOR_PRESETS = [
  '#ff7f7f', '#ffbf7f', '#ffdf7f', '#ffff7f', '#bfff7f',
  '#7fffbf', '#7fdfff', '#7fbfff', '#bf7fff', '#ff7fdf',
]

function defaultTiers(): Tier[] {
  return [
    { id: 's', label: 'S', color: '#ff7f7f' },
    { id: 'a', label: 'A', color: '#ffbf7f' },
    { id: 'b', label: 'B', color: '#ffdf7f' },
    { id: 'c', label: 'C', color: '#ffff7f' },
    { id: 'd', label: 'D', color: '#bfff7f' },
    { id: 'unheard', label: "Haven't heard", color: '#7fffbf' },
  ]
}

/** Which songs a list draws its unranked pool from. Saved with the list, so
 *  an album list reopens on that album. */
export interface TierlistFilters {
  /** Never empty - the UI keeps one selected. With an album set, 'released'
   *  means the album's own tracks and 'unreleased' means their other
   *  versions (OGs, alternate takes), not the album era's whole leak pile. */
  categories: PoolId[]
  /** Era names to draw from; empty means all. Ignored while an album is set. */
  eras: string[]
  albumId: number | null
}

export interface Tierlist {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  tiers: Tier[]
  /** tierId -> song ids in display order. A song is in at most one tier;
   *  anything absent is still in the unranked pool. */
  rows: Record<string, number[]>
  filters: TierlistFilters
  /** Anyone with the link (and visitors to the owner's profile) can view it.
   *  Only meaningful once the list is on the account. */
  isPublic: boolean
  // ─── Account sync (see lib/tierlistSync) ───
  /** The list's id on the account, once uploaded. */
  serverId?: number
  /** Account the list was uploaded to - lists from another account are
   *  dropped locally when a different one signs in (they're safe on theirs). */
  ownerId?: number
  /** `updatedAt` as of the last successful sync; differs = unsynced edits. */
  syncedAt?: number
  /** Server `updated_at` as of the last sync, to spot edits from elsewhere. */
  serverUpdatedAt?: string
}

export interface TierlistLibrary {
  activeId: string
  lists: Tierlist[]
  /** Server ids of lists deleted here whose DELETE hasn't gone through yet. */
  pendingDeletes: number[]
}

/** Has edits the account doesn't have yet. */
export function isDirty(l: Tierlist): boolean {
  return l.serverId === undefined || l.syncedAt !== l.updatedAt
}

const DEFAULT_FILTERS: TierlistFilters = { categories: ['released', 'unreleased'], eras: [], albumId: null }

let nextSeq = 1
function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${nextSeq++}`
}

export function newTierId(): string {
  return newId('tier')
}

export function newTierlist(name: string, filters: TierlistFilters = DEFAULT_FILTERS): Tierlist {
  const now = Date.now()
  const tiers = defaultTiers()
  return {
    id: newId('list'),
    name,
    createdAt: now,
    updatedAt: now,
    tiers,
    rows: Object.fromEntries(tiers.map((t) => [t.id, []])),
    filters: { ...filters, categories: [...filters.categories], eras: [...filters.eras] },
    isPublic: false,
  }
}

// ─── Persistence ─────────────────────────────────────────────────────────────

const LS_KEY = 'unreleased:tierlist:v2'
// The single-list format this replaced: { tiers, assignments: songId -> tierId }.
const LS_KEY_V1 = 'unreleased:tierlist:v1'

export function sanitizeList(raw: Partial<Tierlist>): Tierlist | null {
  if (!raw || typeof raw.id !== 'string' || !Array.isArray(raw.tiers) || raw.tiers.length === 0) return null
  const rows: Record<string, number[]> = {}
  const seen = new Set<number>()
  for (const t of raw.tiers) {
    rows[t.id] = (raw.rows?.[t.id] ?? []).filter((id) => {
      if (typeof id !== 'number' || seen.has(id)) return false
      seen.add(id)
      return true
    })
  }
  const f = raw.filters ?? DEFAULT_FILTERS
  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Tier list',
    createdAt: raw.createdAt ?? Date.now(),
    updatedAt: raw.updatedAt ?? Date.now(),
    tiers: raw.tiers,
    rows,
    filters: {
      categories: f.categories?.length ? f.categories : DEFAULT_FILTERS.categories,
      eras: Array.isArray(f.eras) ? f.eras : [],
      albumId: typeof f.albumId === 'number' ? f.albumId : null,
    },
    isPublic: raw.isPublic === true,
    serverId: typeof raw.serverId === 'number' ? raw.serverId : undefined,
    ownerId: typeof raw.ownerId === 'number' ? raw.ownerId : undefined,
    syncedAt: typeof raw.syncedAt === 'number' ? raw.syncedAt : undefined,
    serverUpdatedAt: typeof raw.serverUpdatedAt === 'string' ? raw.serverUpdatedAt : undefined,
  }
}

function migrateV1(): Tierlist | null {
  try {
    const raw = localStorage.getItem(LS_KEY_V1)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { tiers?: Tier[]; assignments?: Record<string, string> }
    if (!Array.isArray(parsed.tiers) || parsed.tiers.length === 0) return null
    const list = newTierlist('My tier list')
    list.tiers = parsed.tiers
    list.rows = Object.fromEntries(parsed.tiers.map((t) => [t.id, [] as number[]]))
    for (const [songId, tierId] of Object.entries(parsed.assignments ?? {})) {
      list.rows[tierId]?.push(Number(songId))
    }
    return list
  } catch {
    return null
  }
}

function defaultLibrary(): TierlistLibrary {
  const list = migrateV1() ?? newTierlist('My tier list')
  return { activeId: list.id, lists: [list], pendingDeletes: [] }
}

export function loadTierlistLibrary(): TierlistLibrary {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return defaultLibrary()
    const parsed = JSON.parse(raw) as Partial<TierlistLibrary>
    const lists = (parsed.lists ?? []).map(sanitizeList).filter((l): l is Tierlist => l !== null)
    if (lists.length === 0) return defaultLibrary()
    const activeId = lists.some((l) => l.id === parsed.activeId) ? parsed.activeId as string : lists[0].id
    const pendingDeletes = (parsed.pendingDeletes ?? []).filter((id): id is number => typeof id === 'number')
    return { activeId, lists, pendingDeletes }
  } catch {
    return defaultLibrary()
  }
}

export function saveTierlistLibrary(lib: TierlistLibrary): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(lib))
  } catch {}
}

/** Songs ranked in a list, across every tier. */
export function rankedCount(list: Tierlist): number {
  let n = 0
  for (const ids of Object.values(list.rows)) n += ids.length
  return n
}

// ─── Row edits ───────────────────────────────────────────────────────────────

export interface DropPosition {
  /** Song the drop landed on, if it landed on one. */
  targetId: number
  side: 'before' | 'after'
}

/** Moves `songId` into `tierId` (null = back to the unranked pool), next to
 *  `at` when given, otherwise at the end of the row. Returns `rows` itself
 *  when nothing changes so callers can skip a save. */
export function placeSong(
  rows: Record<string, number[]>,
  songId: number,
  tierId: string | null,
  at?: DropPosition | null,
): Record<string, number[]> {
  const currentTier = Object.keys(rows).find((k) => rows[k].includes(songId)) ?? null
  if (currentTier === tierId && (!at || at.targetId === songId)) return rows
  if (tierId === null && currentTier === null) return rows

  const next: Record<string, number[]> = {}
  for (const [k, ids] of Object.entries(rows)) next[k] = ids.filter((id) => id !== songId)
  if (tierId === null) return next

  const row = next[tierId] ?? []
  const idx = at ? row.indexOf(at.targetId) : -1
  if (idx < 0) row.push(songId)
  else row.splice(at!.side === 'after' ? idx + 1 : idx, 0, songId)
  next[tierId] = row
  return next
}

// ─── Pool filtering ──────────────────────────────────────────────────────────

/** A title with its version/feature tags stripped - "Lucid Dreams (OG)",
 *  "Lucid Dreams [v2]" and "Lucid Dreams" all come out the same. */
function baseTitle(title: string): string {
  return normalizeTitle(title.replace(/\s*[([{][^)\]}]*[)\]}]/g, ' '))
}

export interface AlbumMatch {
  kind: 'track' | 'version'
  /** Position of the album track this song is (or is a version of), so the
   *  pool can list the tracklist in order with each track's versions after it. */
  order: number
}

/** Whether `song` is one of `album`'s tracks or another version of one -
 *  linked through the /versions/ table (`groupOf`: songId -> groupId), or
 *  failing that sharing a base title with a track. Versions only ever come
 *  from the unreleased catalogue: a released song that merely shares a
 *  title (a remix, a deluxe cut) isn't part of the album. */
export function albumMatcher(
  album: Album,
  pool: HeardleSong[],
  groupOf: Map<number, number>,
): (song: HeardleSong) => AlbumMatch | null {
  const orderByPath = new Map(album.songs.map((s) => [s.path, s.order]))
  const orderByGroup = new Map<number, number>()
  const orderByTitle = new Map<string, number>()
  for (const t of pool) {
    const order = orderByPath.get(t.path)
    if (order === undefined) continue
    const g = groupOf.get(t.id)
    if (g !== undefined && !orderByGroup.has(g)) orderByGroup.set(g, order)
    for (const title of t.titles) {
      const b = baseTitle(title)
      if (b && !orderByTitle.has(b)) orderByTitle.set(b, order)
    }
  }
  return (song) => {
    const own = orderByPath.get(song.path)
    if (own !== undefined) return { kind: 'track', order: own }
    if (song.category === 'released') return null
    const g = groupOf.get(song.id)
    const byGroup = g !== undefined ? orderByGroup.get(g) : undefined
    if (byGroup !== undefined) return { kind: 'version', order: byGroup }
    for (const t of song.titles) {
      const byTitle = orderByTitle.get(baseTitle(t))
      if (byTitle !== undefined) return { kind: 'version', order: byTitle }
    }
    return null
  }
}

/** Search across every alias, punctuation- and case-blind (same rules as
 *  Heardle's dropdown), plus the era name. */
export function matchesSearch(song: HeardleSong, query: string): boolean {
  const q = normalizeTitle(query)
  if (!q) return true
  if (song.titles.some((t) => normalizeTitle(t).includes(q))) return true
  return !!song.era && normalizeTitle(song.era).includes(q)
}
