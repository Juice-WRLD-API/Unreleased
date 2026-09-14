// Playlist folders - a local-first grouping layer over the user's playlists.
// A folder just holds a list of playlist *keys* ("api:<id>" / "local:<id>",
// the same composite keys the Playlists grid already uses for multi-select),
// so one folder can mix synced and device-local playlists.
//
// Like lib/songPrefs and lib/reports, this module imports nothing so it can be
// pulled in anywhere without an import cycle. Folders live in the store
// (persisted to localStorage) and, once the endpoints exist, sync their synced
// playlists' membership to the account - local playlists always stay on the
// device (the server never learns their ids). See lib/foldersApi.

export interface PlaylistFolder {
  id: string
  name: string
  /** Member playlist keys, in display order. "api:<id>" or "local:<id>". */
  playlistKeys: string[]
  createdAt: number
  updatedAt: number
}

/** Composite key for a playlist, matching the Playlists grid's convention. */
export function playlistKey(kind: 'api' | 'local', id: number | string): string {
  return `${kind}:${id}`
}

/** Splits a composite key back into its parts (null if malformed). */
export function parsePlaylistKey(key: string): { kind: 'api' | 'local'; id: string } | null {
  const i = key.indexOf(':')
  if (i < 0) return null
  const kind = key.slice(0, i)
  if (kind !== 'api' && kind !== 'local') return null
  return { kind, id: key.slice(i + 1) }
}

export function newFolderId(): string {
  try {
    return `folder-${crypto.randomUUID()}`
  } catch {
    return `folder-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

/** Trimmed name or null - a folder must have a real name. */
export function normalizeFolderName(name: string | null | undefined): string | null {
  const t = name?.trim()
  return t ? t : null
}

/** Every playlist key that currently lives in some folder. Used to keep the
 *  ungrouped sections from also showing a playlist that's been filed away. */
export function allFolderedKeys(folders: PlaylistFolder[]): Set<string> {
  const out = new Set<string>()
  for (const f of folders) for (const k of f.playlistKeys) out.add(k)
  return out
}

/** The folder a playlist belongs to, or null. A key lives in at most one
 *  folder (the move actions enforce that), so the first hit is authoritative. */
export function folderOfPlaylist(folders: PlaylistFolder[], key: string): PlaylistFolder | null {
  return folders.find((f) => f.playlistKeys.includes(key)) ?? null
}

/** The numeric ids of the synced (api:) playlists in a folder - the only
 *  membership the server can be told about. */
export function apiPlaylistIds(folder: PlaylistFolder): number[] {
  const ids: number[] = []
  for (const key of folder.playlistKeys) {
    const parsed = parsePlaylistKey(key)
    if (parsed?.kind === 'api') {
      const n = Number(parsed.id)
      if (Number.isFinite(n)) ids.push(n)
    }
  }
  return ids
}

// ── Server (profile blob) shape ──────────────────────────────────────────────

/** Folder shape stored on the user profile's `playlist_folders` JSON field -
 *  synced playlists only; `local:` members never leave the device. Ids are the
 *  client-generated folder ids, round-tripped through the blob, which is what
 *  lets a login merge re-attach this device's local members to the right
 *  folder (see the store's syncFolders). */
export interface ServerPlaylistFolder {
  id: string
  name: string
  playlist_ids: number[]
}

/** Backend validator limits on the `playlist_folders` blob. */
export const SERVER_FOLDERS_LIMIT = 200
export const SERVER_FOLDER_PLAYLISTS_LIMIT = 500

export function toServerFolders(folders: PlaylistFolder[]): ServerPlaylistFolder[] {
  return folders.slice(0, SERVER_FOLDERS_LIMIT).map((f) => ({
    id: f.id,
    name: f.name,
    playlist_ids: apiPlaylistIds(f).slice(0, SERVER_FOLDER_PLAYLISTS_LIMIT),
  }))
}

/** Drops member keys that no longer point at a real playlist (deleted since),
 *  and folders left empty by that pruning stay - an empty folder is still a
 *  folder the user made. Returns the SAME array reference when nothing changed
 *  so callers can skip a redundant persist/re-render. */
export function pruneFolders(folders: PlaylistFolder[], validKeys: Set<string>): PlaylistFolder[] {
  let changed = false
  const next = folders.map((f) => {
    const kept = f.playlistKeys.filter((k) => validKeys.has(k))
    if (kept.length === f.playlistKeys.length) return f
    changed = true
    return { ...f, playlistKeys: kept }
  })
  return changed ? next : folders
}
