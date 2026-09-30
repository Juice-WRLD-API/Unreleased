// E2E v2 primitives (see the "Staff Chat E2E v2 Spec"). Everything signed or
// used as AEAD additional data goes through tbs(), so web, Android and iOS
// produce identical bytes:
//   - each item (the context string included) is a 4-byte big-endian length
//     followed by its bytes
//   - integers are 8-byte big-endian, strings are UTF-8
//   - keys, signatures, nonces and ciphertexts go in as their raw bytes, never
//     as base64 text
import { loadSodium } from './chatCrypto'

type Sodium = Awaited<ReturnType<typeof loadSodium>>
export type TbsItem = string | number | Uint8Array

const enc = new TextEncoder()

function itemBytes(item: TbsItem): Uint8Array {
  if (typeof item === 'string') return enc.encode(item)
  if (typeof item === 'number') {
    if (!Number.isSafeInteger(item) || item < 0) throw new Error(`tbs: bad integer ${item}`)
    const out = new Uint8Array(8)
    new DataView(out.buffer).setBigUint64(0, BigInt(item))
    return out
  }
  return item
}

export function tbs(context: string, ...items: TbsItem[]): Uint8Array {
  const parts = [context, ...items].map(itemBytes)
  const out = new Uint8Array(parts.reduce((n, p) => n + 4 + p.length, 0))
  const view = new DataView(out.buffer)
  let at = 0
  for (const p of parts) {
    view.setUint32(at, p.length)
    out.set(p, at + 4)
    at += 4 + p.length
  }
  return out
}

// --- base64 -----------------------------------------------------------------

export async function b64(bytes: Uint8Array): Promise<string> {
  const s = await loadSodium()
  return s.to_base64(bytes, s.base64_variants.ORIGINAL)
}

export async function unb64(text: string): Promise<Uint8Array> {
  const s = await loadSodium()
  return s.from_base64(text, s.base64_variants.ORIGINAL)
}

export async function b64url(bytes: Uint8Array): Promise<string> {
  const s = await loadSodium()
  return s.to_base64(bytes, s.base64_variants.URLSAFE_NO_PADDING)
}

export async function unb64url(text: string): Promise<Uint8Array> {
  const s = await loadSodium()
  return s.from_base64(text, s.base64_variants.URLSAFE_NO_PADDING)
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

// --- keys ---------------------------------------------------------------------

export interface SigningKeyPair {
  publicKey: Uint8Array
  secretKey: Uint8Array
}

export async function generateSigningKey(): Promise<SigningKeyPair> {
  const s = await loadSodium()
  const kp = s.crypto_sign_keypair()
  return { publicKey: kp.publicKey, secretKey: kp.privateKey }
}

// Same result as crypto_sign_ed25519_sk_to_pk, which the non-sumo
// libsodium-wrappers build doesn't ship: an Ed25519 secret key is its 32-byte
// seed followed by the public key, so re-derive from the seed.
export async function signingPublicFromSecret(secretKey: Uint8Array): Promise<Uint8Array> {
  const s = await loadSodium()
  if (secretKey.length !== 64) throw new Error('bad signing key')
  return s.crypto_sign_seed_keypair(secretKey.slice(0, 32)).publicKey
}

export async function sign(message: Uint8Array, secretKey: Uint8Array): Promise<Uint8Array> {
  const s = await loadSodium()
  return s.crypto_sign_detached(message, secretKey)
}

export async function verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
  const s = await loadSodium()
  try {
    return s.crypto_sign_verify_detached(signature, message, publicKey)
  } catch {
    return false
  }
}

async function hash(len: number, data: Uint8Array): Promise<Uint8Array> {
  const s = await loadSodium()
  return s.crypto_generichash(len, data, null)
}

// --- signed device lists --------------------------------------------------------

export interface ListDevice {
  device_id: string
  enc_pub: string   // base64
  sign_pub: string  // base64
}

const byDeviceId = (a: ListDevice, b: ListDevice): number => (a.device_id < b.device_id ? -1 : a.device_id > b.device_id ? 1 : 0)

export async function listBytes(userId: number, listVersion: number, devices: ListDevice[]): Promise<Uint8Array> {
  const items: TbsItem[] = [userId, listVersion]
  for (const d of [...devices].sort(byDeviceId)) {
    items.push(d.device_id, await unb64(d.enc_pub), await unb64(d.sign_pub))
  }
  return tbs('unrlsd/devices/v2', ...items)
}

// --- room keys ------------------------------------------------------------------

export async function keyCommitment(conversationId: number, keyVersion: number, roomKey: Uint8Array): Promise<Uint8Array> {
  return hash(32, tbs('unrlsd/roomkey/v2', conversationId, keyVersion, roomKey))
}

export const commitBytes = (conversationId: number, keyVersion: number, commitment: Uint8Array): Uint8Array =>
  tbs('unrlsd/commit/v2', conversationId, keyVersion, commitment)

export const envelopeBytes = (
  conversationId: number, keyVersion: number, recipientDeviceId: string, senderDeviceId: string, encryptedKey: Uint8Array,
): Uint8Array => tbs('unrlsd/envelope/v2', conversationId, keyVersion, recipientDeviceId, senderDeviceId, encryptedKey)

// --- messages -------------------------------------------------------------------

export interface MessageAdInput {
  conversationId: number
  keyVersion: number
  senderUserId: number
  senderDeviceId: string
  clientId: string
  editSeq: number
  mentions: number[]
}

export function mentionsCsv(mentions: number[]): string {
  return [...new Set(mentions)].sort((a, b) => a - b).join(',')
}

export const messageAd = (m: MessageAdInput): Uint8Array =>
  tbs('unrlsd/msg/v2', m.conversationId, m.keyVersion, m.senderUserId, m.senderDeviceId, m.clientId, m.editSeq, mentionsCsv(m.mentions))

export const messageSigBytes = (ad: Uint8Array, nonce: Uint8Array, ct: Uint8Array): Uint8Array =>
  tbs('unrlsd/msgsig/v2', ad, nonce, ct)

export const attachmentAd = (conversationId: number, keyVersion: number, clientId: string, index: number): Uint8Array =>
  tbs('unrlsd/att/v2', conversationId, keyVersion, clientId, index)

// Hash of the encrypted file bytes as uploaded, so a receiver can tell the
// server handed back a different blob before even trying to open it.
export async function attachmentHash(cipherBytes: Uint8Array): Promise<string> {
  return b64(await hash(32, cipherBytes))
}

export async function aeadEncrypt(plain: Uint8Array, ad: Uint8Array, key: Uint8Array): Promise<{ ct: Uint8Array; nonce: Uint8Array }> {
  const s = await loadSodium()
  const nonce = s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES)
  return { ct: s.crypto_aead_xchacha20poly1305_ietf_encrypt(plain, ad, null, nonce, key), nonce }
}

export async function aeadDecrypt(ct: Uint8Array, ad: Uint8Array, nonce: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  const s = await loadSodium()
  return s.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, ad, nonce, key)
}

// --- to-device, backup, linking ---------------------------------------------------

export const toDeviceBytes = (type: string, senderDeviceId: string, recipientDeviceId: string, payload: Uint8Array): Uint8Array =>
  tbs('unrlsd/todevice/v2', type, senderDeviceId, recipientDeviceId, payload)

export const backupBytes = (userId: number, backupPub: Uint8Array): Uint8Array =>
  tbs('unrlsd/backup/v2', userId, backupPub)

export async function seal(plain: Uint8Array, recipientPub: Uint8Array): Promise<Uint8Array> {
  const s = await loadSodium()
  return s.crypto_box_seal(plain, recipientPub)
}

export async function sealOpen(sealed: Uint8Array, pub: Uint8Array, secret: Uint8Array): Promise<Uint8Array> {
  const s = await loadSodium()
  return s.crypto_box_seal_open(sealed, pub, secret)
}

// Short authentication string for linking without a camera: both screens
// show it and the person confirms they match.
export async function linkSas(sessionId: string, encPub: Uint8Array, signPub: Uint8Array): Promise<string> {
  const h = await hash(4, tbs('unrlsd/sas/v2', sessionId, encPub, signPub))
  const n = new DataView(h.buffer, h.byteOffset, 4).getUint32(0) % 1_000_000
  return String(n).padStart(6, '0')
}

// --- safety numbers -----------------------------------------------------------------

export async function safetyFingerprint(
  a: { userId: number; mskPub: Uint8Array }, b: { userId: number; mskPub: Uint8Array },
): Promise<Uint8Array> {
  const [lo, hi] = a.userId < b.userId ? [a, b] : [b, a]
  return hash(60, tbs('unrlsd/safety/v2', lo.userId, lo.mskPub, hi.userId, hi.mskPub))
}

export function safetyDigits(fp: Uint8Array): string[] {
  const groups: string[] = []
  for (let i = 0; i + 5 <= fp.length && groups.length < 12; i += 5) {
    let n = 0n
    for (let j = 0; j < 5; j++) n = (n << 8n) | BigInt(fp[i + j])
    groups.push(String(n % 100000n).padStart(5, '0'))
  }
  return groups
}

// --- recovery code (Crockford base32 of the 32-byte backup key) ---------------------

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function encodeRecoveryCode(bk: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bk) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31]
  return out.match(/.{1,4}/g)!.join('-')
}

export function decodeRecoveryCode(code: string): Uint8Array | null {
  const clean = code.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0')
  if (clean.length !== 52) return null
  const out = new Uint8Array(32)
  let bits = 0
  let value = 0
  let at = 0
  for (const ch of clean) {
    const v = CROCKFORD.indexOf(ch)
    if (v < 0) return null
    value = ((value << 5) | v) & 0xffff
    bits += 5
    if (bits >= 8) {
      if (at < 32) out[at++] = (value >>> (bits - 8)) & 0xff
      bits -= 8
    }
  }
  return at === 32 ? out : null
}

export async function backupKeyPair(bk: Uint8Array): Promise<{ publicKey: Uint8Array; secretKey: Uint8Array }> {
  const s = await loadSodium()
  const kp = s.crypto_box_seed_keypair(bk)
  return { publicKey: kp.publicKey, secretKey: kp.privateKey }
}

export async function randomBytes(n: number): Promise<Uint8Array> {
  const s = await loadSodium()
  return s.randombytes_buf(n)
}

export type { Sodium }
