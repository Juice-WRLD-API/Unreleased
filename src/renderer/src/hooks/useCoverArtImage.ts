import { useEffect, useState } from 'react'
import { publicCoverArtUrl, type CoverArtSubmission } from '../lib/coverArtApi'
import { cachedCoverArtImageUrl, ensureCoverArtImageUrl } from '../lib/coverArtImages'

// The image of one cover art submission: an approved one loads straight from
// its public URL, anything else is fetched with the token and shown as a
// blob URL.
export function useCoverArtImage(sub: Pick<CoverArtSubmission, 'id' | 'status' | 'image_url'> | null): { url: string | null; error: boolean } {
  const id = sub?.id ?? null
  const direct = sub ? publicCoverArtUrl(sub) : null
  const [blob, setBlob] = useState<{ id: number; url: string | null; error: boolean } | null>(null)

  useEffect(() => {
    if (id == null || direct) return
    const hit = cachedCoverArtImageUrl(id)
    if (hit) { setBlob({ id, url: hit, error: false }); return }
    let stale = false
    setBlob({ id, url: null, error: false })
    ensureCoverArtImageUrl(id)
      .then((url) => { if (!stale) setBlob({ id, url, error: false }) })
      .catch(() => { if (!stale) setBlob({ id, url: null, error: true }) })
    return () => { stale = true }
  }, [id, direct])

  if (id == null) return { url: null, error: false }
  if (direct) return { url: direct, error: false }
  return blob?.id === id ? { url: blob.url, error: blob.error } : { url: null, error: false }
}
