// BLAKE2b-256 hashing for CDN integrity checks - verifies a P2P node served
// the exact bytes in the master hash list before the blob is trusted. Reuses
// the same lazily-loaded libsodium instance as chat E2E (chatCrypto.ts):
// crypto_generichash with a 32-byte output *is* BLAKE2b-256, so this needs
// no extra dependency.
import { loadSodium } from './chatCrypto'

export async function blake2bHexFromBlob(blob: Blob): Promise<string> {
  const sodium = await loadSodium()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return sodium.crypto_generichash(32, bytes, null, 'hex')
}
