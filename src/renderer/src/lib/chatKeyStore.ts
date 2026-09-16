import type { IdentityKeyPair } from './chatCrypto'

const DB_NAME = 'unreleased-chat'
const DB_VERSION = 1
const META = 'meta'
const ROOM_KEYS = 'roomKeys'

interface StoredDevice {
  id: 'device'
  userId: number
  deviceId: string
  publicKey: ArrayBuffer
  secretKey: ArrayBuffer
  iv: ArrayBuffer
  registered: boolean
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
// stored secrets but never read its bytes back out.
async function wrappingKey(): Promise<CryptoKey> {
  const existing = await run<{ id: string; key: CryptoKey } | undefined>(META, 'readonly', (s) => s.get('wrap'))
  if (existing) return existing.key
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  await run(META, 'readwrite', (s) => s.put({ id: 'wrap', key }))
  return key
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
  registered: boolean
}

export async function loadDevice(userId: number): Promise<LocalDevice | null> {
  const row = await run<StoredDevice | undefined>(META, 'readonly', (s) => s.get('device'))
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
    }
  } catch {
    return null
  }
}

export async function saveDevice(device: LocalDevice): Promise<void> {
  const { data, iv } = await seal(device.identity.secretKey)
  const row: StoredDevice = {
    id: 'device',
    userId: device.userId,
    deviceId: device.deviceId,
    publicKey: device.identity.publicKey.slice().buffer,
    secretKey: data,
    iv,
    registered: device.registered,
  }
  await run(META, 'readwrite', (s) => s.put(row))
}

export async function clearDevice(): Promise<void> {
  await run(META, 'readwrite', (s) => s.delete('device'))
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

export async function putRoomKey(conversationId: number, version: number, key: Uint8Array): Promise<void> {
  const id = roomId(conversationId, version)
  roomKeyCache.set(id, key)
  const { data, iv } = await seal(key)
  await run(ROOM_KEYS, 'readwrite', (s) => s.put({ id, key: data, iv } satisfies StoredRoomKey))
}
