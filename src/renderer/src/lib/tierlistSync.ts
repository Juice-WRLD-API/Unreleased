// Keeps the local tier list library (lib/tierlist, localStorage) in step with
// the signed-in account's /library/tierlists/. localStorage stays the source
// the UI renders from - sync runs in the background and folds its results
// back in, so the game works identically signed out, offline, or against a
// server that doesn't have these routes yet.
//
// Conflict rule is last-writer-wins per list: an unsynced local edit is
// pushed over whatever the server has; a list with no local edits takes the
// server's copy whenever its `updated_at` moved (edited on another device).
import {
  listTierlists, createTierlist, updateTierlist, deleteTierlist, isUnsupported, TierlistApiError,
} from './tierlistApi'
import type { ServerTierlist, TierlistData } from './tierlistApi'
import { isDirty, newTierlist, rankedCount, sanitizeList } from './tierlist'
import type { Tierlist, TierlistLibrary } from './tierlist'

export type SyncResult = 'ok' | 'unsupported'

/** Read the latest library / apply a change to it. `apply` must take effect
 *  synchronously (the hook backs it with a ref), since each step reads what
 *  the previous one wrote. */
export interface SyncIO {
  get: () => TierlistLibrary
  apply: (fn: (lib: TierlistLibrary) => TierlistLibrary) => void
}

export function toData(l: Tierlist): TierlistData {
  return { v: 1, tiers: l.tiers, rows: l.rows, filters: l.filters }
}

/** A server row as a local list. Local id is kept when replacing an existing
 *  list so the active selection doesn't jump. */
export function fromServer(s: ServerTierlist, ownerId: number | undefined, localId?: string): Tierlist | null {
  const updatedAt = Date.parse(s.updated_at) || Date.now()
  const list = sanitizeList({
    id: localId ?? `srv-${s.id}`,
    name: s.name,
    createdAt: Date.parse(s.created_at) || updatedAt,
    updatedAt,
    tiers: s.data?.tiers,
    rows: s.data?.rows,
    filters: s.data?.filters,
    isPublic: s.is_public,
    serverId: s.id,
    ownerId,
    syncedAt: updatedAt,
    serverUpdatedAt: s.updated_at,
  })
  return list
}

function withValidActive(lib: TierlistLibrary): TierlistLibrary {
  if (lib.lists.length === 0) {
    const fresh = newTierlist('My tier list')
    return { ...lib, activeId: fresh.id, lists: [fresh] }
  }
  return lib.lists.some((l) => l.id === lib.activeId) ? lib : { ...lib, activeId: lib.lists[0].id }
}

/** Two-way sync: pull the account's lists, reconcile, then push local edits. */
export async function fullSync(io: SyncIO, accountId: number): Promise<SyncResult> {
  let server: ServerTierlist[]
  try {
    server = await listTierlists()
  } catch (err) {
    if (isUnsupported(err)) return 'unsupported'
    throw err
  }
  const byId = new Map(server.map((s) => [s.id, s]))

  io.apply((lib) => {
    const known = new Set<number>()
    const lists: Tierlist[] = []
    for (const l of lib.lists) {
      // Another account's lists live on that account - don't show or merge them.
      if (l.ownerId !== undefined && l.ownerId !== accountId) continue
      if (l.serverId === undefined) { lists.push(l); continue }
      known.add(l.serverId)
      const s = byId.get(l.serverId)
      if (!s) {
        // Deleted elsewhere. Keep it only if there are edits here worth
        // saving, and then as a new upload.
        if (isDirty(l)) lists.push({ ...l, serverId: undefined, syncedAt: undefined, serverUpdatedAt: undefined })
        continue
      }
      if (!isDirty(l) && s.updated_at !== l.serverUpdatedAt) {
        lists.push(fromServer(s, accountId, l.id) ?? l)
      } else {
        lists.push(l)
      }
    }
    const pending = new Set(lib.pendingDeletes)
    for (const s of server) {
      if (known.has(s.id) || pending.has(s.id)) continue
      const pulled = fromServer(s, accountId)
      if (pulled) lists.push(pulled)
    }
    return withValidActive({ ...lib, lists })
  })

  await pushChanges(io, accountId)
  return 'ok'
}

/** Sends pending deletes and every list with unsynced edits. */
export async function pushChanges(io: SyncIO, accountId: number): Promise<SyncResult> {
  for (const serverId of io.get().pendingDeletes) {
    try {
      await deleteTierlist(serverId)
    } catch (err) {
      // Already gone is as good as deleted; anything else retries next time.
      if (!(err instanceof TierlistApiError && err.status === 404)) {
        if (isUnsupported(err)) return 'unsupported'
        throw err
      }
    }
    io.apply((lib) => ({ ...lib, pendingDeletes: lib.pendingDeletes.filter((id) => id !== serverId) }))
  }

  // A list the server rejects (400/413 - failed validation) shouldn't hold
  // up the rest: skip it, keep going, and report the failure at the end.
  let rejected: TierlistApiError | null = null
  for (const l of io.get().lists.filter(isDirty)) {
    if (l.ownerId !== undefined && l.ownerId !== accountId) continue
    // The blank list every empty library gets isn't worth an account row
    // until something is actually done with it.
    if (l.serverId === undefined && l.createdAt === l.updatedAt && rankedCount(l) === 0) continue
    const pushedAt = l.updatedAt
    const body = { name: l.name, is_public: l.isPublic, data: toData(l) }
    let saved: ServerTierlist
    try {
      saved = l.serverId !== undefined
        ? await updateTierlist(l.serverId, body)
        : await createTierlist(body)
    } catch (err) {
      if (l.serverId !== undefined && err instanceof TierlistApiError && err.status === 404) {
        // Deleted on another device mid-edit: re-create rather than lose it.
        saved = await createTierlist(body)
      } else if (err instanceof TierlistApiError && (err.status === 400 || err.status === 413)) {
        rejected = err
        continue
      } else {
        if (isUnsupported(err)) return 'unsupported'
        throw err
      }
    }
    io.apply((lib) => ({
      ...lib,
      lists: lib.lists.map((cur) => cur.id !== l.id ? cur : {
        ...cur,
        serverId: saved.id,
        ownerId: accountId,
        serverUpdatedAt: saved.updated_at,
        // Edited again while the request was out: leave it dirty so the
        // newer edit goes up on the next pass.
        syncedAt: cur.updatedAt === pushedAt ? pushedAt : cur.syncedAt,
      }),
    }))
  }
  if (rejected) throw rejected
  return 'ok'
}
