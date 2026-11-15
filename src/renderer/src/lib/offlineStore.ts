// IndexedDB storage behind offline playlist downloads (see offlineDownloads).
// Three stores:
//   audio     - one file per track id, nothing else, so listing what's
//               downloaded never has to touch the blobs
//   tracks    - per-track bookkeeping: size, the file path it was saved from,
//               and which downloaded playlists hold it
//   playlists - each downloaded playlist: its detail as last fetched (so it
//               opens with no network) and the track ids it wants
// Covers don't live here: they go in Cache Storage under COVER_CACHE, keyed by
// their own URL, so the service worker can answer an <img> for them offline.
// No imports on purpose: userApi reads it for its offline fallback, and the
// store and Player both load it, so it must not pull either of them in.

const DB_NAME = 'unreleased-offline'
const DB_VERSION = 1
const AUDIO = 'audio'
const TRACKS = 'tracks'
const PLAYLISTS = 'playlists'

export const COVER_CACHE = 'offline-covers'

export interface OfflineTrackRecord {
  id: string
  /** Bytes on disk. */
  size: number
  /** The file the audio came from: a different one later means the song's
   *  audio was replaced, and it's downloaded again. */
  path: string
  title: string
  /** Downloaded playlists that hold this track. */
  playlists: number[]
  savedAt: number
}

export interface OfflinePlaylistRecord {
  id: number
  name: string
  /** The PlaylistDetail as last fetched. Typed loosely so this module doesn't
   *  import userApi (which imports this one). */
  detail: unknown
  /** Track ids that can be downloaded, in playlist order. */
  trackIds: string[]
  /** Entries that can't be: local files, removed songs. */
  skipped: number
  coverUrls: string[]
  savedAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(AUDIO)) db.createObjectStore(AUDIO)
        if (!db.objectStoreNames.contains(TRACKS)) db.createObjectStore(TRACKS, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(PLAYLISTS)) db.createObjectStore(PLAYLISTS, { keyPath: 'id' })
      }
      req.onsuccess = () => {
        const db = req.result
        // Another tab upgrading (a newer build) needs this connection closed.
        db.onversionchange = () => { db.close(); dbPromise = null }
        resolve(db)
      }
      req.onerror = () => { dbPromise = null; reject(req.error) }
    })
  }
  return dbPromise
}

function idbRequest<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'))
  })
}

export async function getAudio(trackId: string): Promise<Blob | null> {
  const db = await openDb()
  const blob = await idbRequest<Blob | undefined>(db.transaction(AUDIO).objectStore(AUDIO).get(trackId))
  return blob ?? null
}

export async function getTrackRecords(): Promise<OfflineTrackRecord[]> {
  const db = await openDb()
  return idbRequest<OfflineTrackRecord[]>(db.transaction(TRACKS).objectStore(TRACKS).getAll())
}

export async function getTrackRecord(trackId: string): Promise<OfflineTrackRecord | null> {
  const db = await openDb()
  return (await idbRequest<OfflineTrackRecord | undefined>(db.transaction(TRACKS).objectStore(TRACKS).get(trackId))) ?? null
}

export async function getPlaylistRecords(): Promise<OfflinePlaylistRecord[]> {
  const db = await openDb()
  return idbRequest<OfflinePlaylistRecord[]>(db.transaction(PLAYLISTS).objectStore(PLAYLISTS).getAll())
}

export async function getPlaylistRecord(id: number): Promise<OfflinePlaylistRecord | null> {
  const db = await openDb()
  return (await idbRequest<OfflinePlaylistRecord | undefined>(db.transaction(PLAYLISTS).objectStore(PLAYLISTS).get(id))) ?? null
}

export async function putPlaylistRecord(record: OfflinePlaylistRecord): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(PLAYLISTS, 'readwrite')
  tx.objectStore(PLAYLISTS).put(record)
  await done(tx)
}

// The read-modify-write helpers below chain their requests through callbacks
// rather than awaiting between them: older WebKit commits a transaction as
// soon as control returns to the event loop, and a promise continuation could
// land after that.

/** Saves a track's file and records that `playlistId` holds it, in one
 *  transaction, so a file is never on disk without the record that lets it be
 *  cleaned up. */
export async function putTrack(record: Omit<OfflineTrackRecord, 'playlists'>, blob: Blob, playlistId: number): Promise<void> {
  const db = await openDb()
  const tx = db.transaction([AUDIO, TRACKS], 'readwrite')
  const tracks = tx.objectStore(TRACKS)
  const get = tracks.get(record.id)
  get.onsuccess = () => {
    const existing = get.result as OfflineTrackRecord | undefined
    const playlists = Array.from(new Set([...(existing?.playlists ?? []), playlistId]))
    tx.objectStore(AUDIO).put(blob, record.id)
    tracks.put({ ...record, playlists })
  }
  await done(tx)
}

/** Records that `playlistId` also holds an already-saved track. False when the
 *  track isn't saved. */
export async function addTrackRef(trackId: string, playlistId: number): Promise<boolean> {
  const db = await openDb()
  const tx = db.transaction(TRACKS, 'readwrite')
  const store = tx.objectStore(TRACKS)
  let found = false
  const get = store.get(trackId)
  get.onsuccess = () => {
    const rec = get.result as OfflineTrackRecord | undefined
    found = !!rec
    if (rec && !rec.playlists.includes(playlistId)) store.put({ ...rec, playlists: [...rec.playlists, playlistId] })
  }
  await done(tx)
  return found
}

/** Drops `playlistId`'s hold on these tracks and deletes the files nothing
 *  else holds. Returns the ids whose files were deleted. */
export async function releaseTracks(trackIds: string[], playlistId: number): Promise<string[]> {
  if (trackIds.length === 0) return []
  const db = await openDb()
  const tx = db.transaction([AUDIO, TRACKS], 'readwrite')
  const tracks = tx.objectStore(TRACKS)
  const audio = tx.objectStore(AUDIO)
  const deleted: string[] = []
  for (const id of trackIds) {
    const get = tracks.get(id)
    get.onsuccess = () => {
      const rec = get.result as OfflineTrackRecord | undefined
      if (!rec) return
      const playlists = rec.playlists.filter((p) => p !== playlistId)
      if (playlists.length) tracks.put({ ...rec, playlists })
      else { tracks.delete(id); audio.delete(id); deleted.push(id) }
    }
  }
  await done(tx)
  return deleted
}

export async function deleteTracks(trackIds: string[]): Promise<void> {
  const db = await openDb()
  const tx = db.transaction([AUDIO, TRACKS], 'readwrite')
  for (const id of trackIds) {
    tx.objectStore(AUDIO).delete(id)
    tx.objectStore(TRACKS).delete(id)
  }
  await done(tx)
}

export async function deletePlaylistRecord(id: number): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(PLAYLISTS, 'readwrite')
  tx.objectStore(PLAYLISTS).delete(id)
  await done(tx)
}

/** Everything, files and covers included (sign-out, "Remove all"). */
export async function clearOfflineStore(): Promise<void> {
  const db = await openDb()
  const tx = db.transaction([AUDIO, TRACKS, PLAYLISTS], 'readwrite')
  tx.objectStore(AUDIO).clear()
  tx.objectStore(TRACKS).clear()
  tx.objectStore(PLAYLISTS).clear()
  await done(tx)
  if (typeof caches !== 'undefined') await caches.delete(COVER_CACHE).catch(() => false)
}

/** Saves a cover for offline use. Best effort: a cover that won't download
 *  just shows the placeholder offline. The service worker serves these when
 *  the network fails, matching other sizes of the same cover too (see sw.js). */
export async function saveCover(url: string): Promise<void> {
  if (typeof caches === 'undefined' || !/^https?:/.test(url)) return
  const cache = await caches.open(COVER_CACHE)
  if (await cache.match(url, { ignoreVary: true })) return
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' })
  if (res.ok) await cache.put(url, res)
}

export async function deleteCovers(urls: string[]): Promise<void> {
  if (typeof caches === 'undefined' || urls.length === 0) return
  const cache = await caches.open(COVER_CACHE)
  await Promise.all(urls.map((u) => cache.delete(u)))
}
