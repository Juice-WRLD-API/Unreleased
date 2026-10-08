import type sodiumType from 'libsodium-wrappers'

type Sodium = typeof sodiumType

let sodiumPromise: Promise<Sodium> | null = null

// Loaded on demand so the WASM/asm payload stays out of the main bundle.
export function loadSodium(): Promise<Sodium> {
  if (!sodiumPromise) {
    sodiumPromise = import('libsodium-wrappers').then(async (mod) => {
      const sodium = (mod.default ?? mod) as Sodium
      await sodium.ready
      return sodium
    })
  }
  return sodiumPromise
}

const B64 = () => loadSodium().then((s) => ({ s, v: s.base64_variants.ORIGINAL }))

export async function toB64(bytes: Uint8Array): Promise<string> {
  const { s, v } = await B64()
  return s.to_base64(bytes, v)
}

export async function fromB64(text: string): Promise<Uint8Array> {
  const { s, v } = await B64()
  return s.from_base64(text, v)
}

export interface IdentityKeyPair {
  publicKey: Uint8Array
  secretKey: Uint8Array
}

export async function generateIdentity(): Promise<IdentityKeyPair> {
  const s = await loadSodium()
  const kp = s.crypto_box_keypair()
  return { publicKey: kp.publicKey, secretKey: kp.privateKey }
}

export async function generateRoomKey(): Promise<Uint8Array> {
  const s = await loadSodium()
  return s.crypto_aead_xchacha20poly1305_ietf_keygen()
}

export async function sealRoomKey(roomKey: Uint8Array, recipientPublicKeyB64: string): Promise<string> {
  const { s, v } = await B64()
  const sealed = s.crypto_box_seal(roomKey, s.from_base64(recipientPublicKeyB64, v))
  return s.to_base64(sealed, v)
}

export async function openRoomKey(encryptedKeyB64: string, identity: IdentityKeyPair): Promise<Uint8Array> {
  const { s, v } = await B64()
  return s.crypto_box_seal_open(s.from_base64(encryptedKeyB64, v), identity.publicKey, identity.secretKey)
}

export interface Sealed {
  ciphertext: string
  nonce: string
}

export async function encryptBytes(plain: Uint8Array, roomKey: Uint8Array): Promise<{ bytes: Uint8Array; nonce: string }> {
  const { s, v } = await B64()
  const nonce = s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES)
  const bytes = s.crypto_aead_xchacha20poly1305_ietf_encrypt(plain, null, null, nonce, roomKey)
  return { bytes, nonce: s.to_base64(nonce, v) }
}

export async function decryptBytes(cipher: Uint8Array, nonceB64: string, roomKey: Uint8Array): Promise<Uint8Array> {
  const { s, v } = await B64()
  return s.crypto_aead_xchacha20poly1305_ietf_decrypt(null, cipher, null, s.from_base64(nonceB64, v), roomKey)
}

export async function encryptText(plain: string, roomKey: Uint8Array): Promise<Sealed> {
  const { bytes, nonce } = await encryptBytes(new TextEncoder().encode(plain), roomKey)
  return { ciphertext: await toB64(bytes), nonce }
}

export async function decryptText(ciphertextB64: string, nonceB64: string, roomKey: Uint8Array): Promise<string> {
  const plain = await decryptBytes(await fromB64(ciphertextB64), nonceB64, roomKey)
  return new TextDecoder().decode(plain)
}

// Reusing the attachment's nonce for its filename would repeat a nonce under one
// key, so the name carries its own nonce packed in front of the ciphertext.
export async function encryptName(name: string, roomKey: Uint8Array): Promise<string> {
  const s = await loadSodium()
  const { bytes, nonce } = await encryptBytes(new TextEncoder().encode(name), roomKey)
  const packed = new Uint8Array(s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES + bytes.length)
  packed.set(await fromB64(nonce), 0)
  packed.set(bytes, s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES)
  return toB64(packed)
}

export async function decryptName(packedB64: string, roomKey: Uint8Array): Promise<string> {
  const s = await loadSodium()
  const packed = await fromB64(packedB64)
  const n = s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
  const nonce = await toB64(packed.slice(0, n))
  return new TextDecoder().decode(await decryptBytes(packed.slice(n), nonce, roomKey))
}
