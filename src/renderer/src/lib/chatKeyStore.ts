import type { IdentityKeyPair } from './chatCrypto'
import type { SigningKeyPair } from './chatV2Crypto'

const DB_NAME = 'unreleased-chat'
const DB_VERSION = 1
const META = 'meta'
const ROOM_KEYS = 'roomKeys'

interface StoredDevice {
  // `device:<userId>`; older builds kept one shared `device` row, which
  // loadDevice still reads (see deviceRowId).
  id: string
  userId: number
  deviceId: string
  publicKey: ArrayBuffer
  secretKey: ArrayBuffer
  iv: ArrayBuffer
  registered: boolean
  // v2 device signing key (Ed25519); absent on devices set up before v2.
  signPublicKey?: ArrayBuffer
  signSecretKey?: ArrayBuffer
  signIv?: ArrayBuffer
}

interface StoredRoomKey {
  id: string
  key: ArrayBuffer
  iv: ArrayBuffer
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(ROOM_KEYS)) db.createObjectStore(ROOM_KEYS, { keyPath: 'id' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        dbPromise = null
        reject(req.error)
      }
    })
  }
  return dbPromise
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode)
    const req = fn(tx.objectStore(store))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  }))
}

// The wrapping key is non-extractable: script can use it to decrypt the
// stored secrets but never read its bytes back out. Memoized so concurrent
// first callers share one key - two racing generateKey()s would each seal
// with their own and the losing one's secrets could never be opened again.
let wrapPromise: Promise<CryptoKey> | null = null

function wrappingKey(): Promise<CryptoKey> {
  if (!wrapPromise) {
    wrapPromise = (async () => {
      const existing = await run<{ id: string; key: CryptoKey } | undefined>(META, 'readonly', (s) => s.get('wrap'))
      if (existing) return existing.key
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
      await run(META, 'readwrite', (s) => s.put({ id: 'wrap', key }))
      return key
    })().catch((err) => {
      wrapPromise = null
      throw err
    })
  }
  return wrapPromise
}

async function seal(bytes: Uint8Array): Promise<{ data: ArrayBuffer; iv: ArrayBuffer }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await wrappingKey(), bytes as Uint8Array<ArrayBuffer>)
  return { data, iv: iv.buffer }
}

async function unseal(data: ArrayBuffer, iv: ArrayBuffer): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await wrappingKey(), data))
}

export interface LocalDevice {
  userId: number
  deviceId: string
  identity: IdentityKeyPair
  signing?: SigningKeyPair
  registered: boolean
}

// One row per account: a single shared row meant signing a second account in
// on this browser overwrote the first one's identity, while the server kept
// that (now secretless) device as the first account's keyed primary.
const LEGACY_DEVICE_ROW = 'device'
const deviceRowId = (userId: number): string => `device:${userId}`

export async function loadDevice(userId: number): Promise<LocalDevice | null> {
  const row = await run<StoredDevice | undefined>(META, 'readonly', (s) => s.get(deviceRowId(userId)))
    ?? await run<StoredDevice | undefined>(META, 'readonly', (s) => s.get(LEGACY_DEVICE_ROW))
  if (!row || row.userId !== userId) return null
  try {
    return {
      userId: row.userId,
      deviceId: row.deviceId,
      registered: row.registered,
      identity: {
        publicKey: new Uint8Array(row.publicKey),
        secretKey: await unseal(row.secretKey, row.iv),
      },
      signing: row.signPublicKey && row.signSecretKey && row.signIv
        ? { publicKey: new Uint8Array(row.signPublicKey), secretKey: await unseal(row.signSecretKey, row.signIv) }
        : undefined,
    }
  } catch {
    return null
  }
}

export async function saveDevice(device: LocalDevice): Promise<void> {
  const { data, iv } = await seal(device.identity.secretKey)
  const row: StoredDevice = {
    id: deviceRowId(device.userId),
    userId: device.userId,
    deviceId: device.deviceId,
    publicKey: device.identity.publicKey.slice().buffer,
    secretKey: data,
    iv,
    registered: device.registered,
  }
  if (device.signing) {
    const signed = await seal(device.signing.secretKey)
    row.signPublicKey = device.signing.publicKey.slice().buffer
    row.signSecretKey = signed.data
    row.signIv = signed.iv
  }
  await run(META, 'readwrite', (s) => s.put(row))
  // Migrated off the shared legacy row - drop it if it was ours, so another
  // account's loadDevice can't fall back to it.
  const legacy = await run<StoredDevice | undefined>(META, 'readonly', (s) => s.get(LEGACY_DEVICE_ROW))
  if (legacy?.userId === device.userId) await run(META, 'readwrite', (s) => s.delete(LEGACY_DEVICE_ROW))
}

export async function clearDevice(userId: number): Promise<void> {
  await run(META, 'readwrite', (s) => s.delete(deviceRowId(userId)))
  await run(META, 'readwrite', (s) => s.delete(mskRowId(userId)))
  await run(META, 'readwrite', (s) => s.delete(LEGACY_DEVICE_ROW))
  await run(ROOM_KEYS, 'readwrite', (s) => s.clear())
}

const roomKeyCache = new Map<string, Uint8Array>()
const roomId = (conversationId: number, version: number) => `${conversationId}:${version}`

export async function getRoomKey(conversationId: number, version: number): Promise<Uint8Array | null> {
  const id = roomId(conversationId, version)
  const cached = roomKeyCache.get(id)
  if (cached) return cached
  const row = await run<StoredRoomKey | undefined>(ROOM_KEYS, 'readonly', (s) => s.get(id))
  if (!row) return null
  try {
    const key = await unseal(row.key, row.iv)
    roomKeyCache.set(id, key)
    return key
  } catch {
    return null
  }
}

// Every room key this device holds, for export to another browser. Rows whose
// wrapping failed to open are skipped rather than aborting the whole export.
export async function allRoomKeys(): Promise<{ conversationId: number; version: number; key: Uint8Array }[]> {
  const rows = await run<StoredRoomKey[]>(ROOM_KEYS, 'readonly', (s) => s.getAll())
  const out: { conversationId: number; version: number; key: Uint8Array }[] = []
  for (const row of rows) {
    const [conversationId, version] = row.id.split(':').map(Number)
    if (!Number.isFinite(conversationId) || !Number.isFinite(version)) continue
    try {
      out.push({ conversationId, version, key: await unseal(row.key, row.iv) })
    } catch {
      continue
    }
  }
  return out
}

export async function putRoomKey(conversationId: number, version: number, key: Uint8Array): Promise<void> {
  const id = roomId(conversationId, version)
  roomKeyCache.set(id, key)
  const { data, iv } = await seal(key)
  await run(ROOM_KEYS, 'readwrite', (s) => s.put({ id, key: data, iv } satisfies StoredRoomKey))
}

export async function hasRoomKey(conversationId: number, version: number): Promise<boolean> {
  return (await getRoomKey(conversationId, version)) !== null
}

// --- E2E v2 ---------------------------------------------------------------------
// The master signing key, and what this account has learned about everyone
// else's: the MSK it pinned on first sight, the highest device-list version it
// has seen (so the server can't replay an older list that still had a revoked
// device in it), and whether the person compared safety numbers.

interface StoredSecret {
  id: string
  data: ArrayBuffer
  iv: ArrayBuffer
}

const mskRowId = (userId: number): string => `msk:${userId}`

export async function loadMsk(userId: number): Promise<Uint8Array | null> {
  const row = await run<StoredSecret | undefined>(META, 'readonly', (s) => s.get(mskRowId(userId)))
  if (!row) return null
  try {
    return await unseal(row.data, row.iv)
  } catch {
    return null
  }
}

export async function saveMsk(userId: number, secret: Uint8Array): Promise<void> {
  const { data, iv } = await seal(secret)
  await run(META, 'readwrite', (s) => s.put({ id: mskRowId(userId), data, iv } satisfies StoredSecret))
}

export async function clearMsk(userId: number): Promise<void> {
  await run(META, 'readwrite', (s) => s.delete(mskRowId(userId)))
}

export interface TrustRecord {
  // base64 MSK public key pinned for this user; '' until first seen.
  mskPub: string
  listVersion: number
  verified: boolean
  // Set when the server shows a different MSK than the pinned one; cleared
  // when the viewer accepts it (which re-pins and drops `verified`).
  changedTo?: string
}

const trustRowId = (me: number, them: number): string => `trust:${me}:${them}`

export async function getTrust(me: number, them: number): Promise<TrustRecord | null> {
  const row = await run<({ id: string } & TrustRecord) | undefined>(META, 'readonly', (s) => s.get(trustRowId(me, them)))
  if (!row) return null
  const { id: _id, ...rest } = row
  return rest
}

export async function putTrust(me: number, them: number, record: TrustRecord): Promise<void> {
  await run(META, 'readwrite', (s) => s.put({ id: trustRowId(me, them), ...record }))
}
