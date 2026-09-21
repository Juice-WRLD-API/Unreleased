import { allRoomKeys, putRoomKey } from './chatKeyStore'

// Moving room keys between your own browsers by hand: only one device per
// person is keyed automatically (see primaryDevices in chatE2E), so a second
// browser gets its keys from an export made on the first one.
//
// The blob is `unrlsd-keys:v1:<base64>` over
//   salt(16) || iv(12) || AES-GCM(PBKDF2-SHA256(passphrase, salt, ITERATIONS))
// which is safe to paste into a chat or save to disk: without the passphrase
// it's useless. WebCrypto is used throughout - libsodium's build here has no
// password hash.

const PREFIX = 'unrlsd-keys:v1:'
const ITERATIONS = 600_000
const SALT_BYTES = 16
const IV_BYTES = 12

export interface TransferPayload {
  v: 1
  user: number
  keys: { c: number; k: string; kv: number }[]
}

const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes))
const unb64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0))

async function derive(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as Uint8Array<ArrayBuffer>, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export function looksLikeKeyExport(text: string): boolean {
  return text.trim().startsWith(PREFIX)
}

export async function exportKeys(userId: number, passphrase: string): Promise<{ blob: string; count: number }> {
  if (!passphrase) throw new Error('A passphrase is required')
  const held = await allRoomKeys()
  if (held.length === 0) throw new Error('This device holds no keys to export')
  const payload: TransferPayload = {
    v: 1,
    user: userId,
    keys: held.map((h) => ({ c: h.conversationId, kv: h.version, k: b64(h.key) })),
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await derive(passphrase, salt)
  const cipher = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  ))
  const packed = new Uint8Array(salt.length + iv.length + cipher.length)
  packed.set(salt, 0)
  packed.set(iv, salt.length)
  packed.set(cipher, salt.length + iv.length)
  return { blob: PREFIX + b64(packed), count: held.length }
}

export interface ImportResult {
  imported: number
  skipped: number
  conversations: number[]
  fromOtherAccount: boolean
}

export async function importKeys(userId: number, blob: string, passphrase: string): Promise<ImportResult> {
  const text = blob.trim()
  if (!looksLikeKeyExport(text)) throw new Error('That doesn’t look like a key export')
  let packed: Uint8Array
  try {
    packed = unb64(text.slice(PREFIX.length).trim())
  } catch {
    throw new Error('The export is damaged - copy it again in full')
  }
  if (packed.length <= SALT_BYTES + IV_BYTES) throw new Error('The export is damaged - copy it again in full')
  const key = await derive(passphrase, packed.slice(0, SALT_BYTES))
  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: packed.slice(SALT_BYTES, SALT_BYTES + IV_BYTES) as Uint8Array<ArrayBuffer> },
      key,
      packed.slice(SALT_BYTES + IV_BYTES) as Uint8Array<ArrayBuffer>,
    )
  } catch {
    throw new Error('Wrong passphrase, or the export is damaged')
  }
  let payload: TransferPayload
  try {
    payload = JSON.parse(new TextDecoder().decode(plain)) as TransferPayload
  } catch {
    throw new Error('The export is damaged - copy it again in full')
  }
  if (payload.v !== 1 || !Array.isArray(payload.keys)) throw new Error('Unsupported export version')
  const conversations = new Set<number>()
  let imported = 0
  let skipped = 0
  for (const entry of payload.keys) {
    let bytes: Uint8Array
    try {
      bytes = unb64(entry.k)
    } catch {
      skipped++
      continue
    }
    if (!Number.isFinite(entry.c) || !Number.isFinite(entry.kv) || bytes.length !== 32) {
      skipped++
      continue
    }
    await putRoomKey(entry.c, entry.kv, bytes)
    conversations.add(entry.c)
    imported++
  }
  return { imported, skipped, conversations: [...conversations], fromOtherAccount: payload.user !== userId }
}
