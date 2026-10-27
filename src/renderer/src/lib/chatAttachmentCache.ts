// Decrypted chat attachments, kept as blob URLs across AttachmentView mounts.
// Without this every room switch (or a message scrolling back into view)
// downloaded and decrypted each encrypted image again, showing the busy card
// in between. Bounded by size, oldest out first, since an attachment can be up
// to AUTO_LOAD_MAX_BYTES and a busy room adds up quickly.
const MAX_BYTES = 100 * 1024 * 1024

export interface DecryptedEntry {
  url: string
  name: string
  mime: string
}

const cache = new Map<string, DecryptedEntry & { bytes: number }>() // oldest first
let total = 0

export function peekDecryptedAttachment(key: string): DecryptedEntry | null {
  const hit = cache.get(key)
  if (!hit) return null
  // Touch so what's on screen is the last to be evicted.
  cache.delete(key)
  cache.set(key, hit)
  return hit
}

/** Stores a decrypted body and returns its blob URL, which the cache owns:
 *  callers must not revoke it. */
export function rememberDecryptedAttachment(key: string, blob: Blob, name: string, mime: string): DecryptedEntry {
  const existing = peekDecryptedAttachment(key)
  if (existing) return existing
  const entry = { url: URL.createObjectURL(blob), name, mime, bytes: blob.size }
  cache.set(key, entry)
  total += entry.bytes
  // Always keep the newest, even when it alone is over the budget.
  for (const [k, e] of cache) {
    if (total <= MAX_BYTES || k === key) break
    URL.revokeObjectURL(e.url)
    cache.delete(k)
    total -= e.bytes
  }
  return entry
}

/** Drop everything held in memory (sign-out). */
export function clearDecryptedAttachments(): void {
  for (const e of cache.values()) URL.revokeObjectURL(e.url)
  cache.clear()
  total = 0
}
