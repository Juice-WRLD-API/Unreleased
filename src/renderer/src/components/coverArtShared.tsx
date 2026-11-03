// Image tiles shared by My cover art (Settings → Account) and the cover art
// review queue (Admin → Cover art).
import { useEffect, useState } from 'react'
import { ImageOff, Loader2 } from 'lucide-react'
import { buildImageUrl } from '../lib/juicewrldApi'
import type { CoverArtSubmission } from '../lib/coverArtApi'
import { useCoverArtImage } from '../hooks/useCoverArtImage'

function ImageBox({ url, loading, className, iconSize }: {
  url: string | null
  loading: boolean
  className: string
  iconSize: number
}): JSX.Element {
  const [broken, setBroken] = useState(false)
  useEffect(() => { setBroken(false) }, [url])
  return (
    <div className={`overflow-hidden bg-surface-raised flex items-center justify-center ${className}`}>
      {url && !broken ? (
        <img src={url} alt="" onError={() => setBroken(true)} className="w-full h-full object-cover" />
      ) : loading && !broken ? (
        <Loader2 size={iconSize} className="animate-spin text-text-muted" />
      ) : (
        <ImageOff size={iconSize} className="text-text-muted" />
      )}
    </div>
  )
}

/** A submission's own image: public once approved, otherwise fetched with the token. */
export function CoverArtImage({ sub, className = '', iconSize = 14 }: {
  sub: Pick<CoverArtSubmission, 'id' | 'status' | 'image_url'>
  className?: string
  iconSize?: number
}): JSX.Element {
  const { url, error } = useCoverArtImage(sub)
  return <ImageBox url={url} loading={!error} className={className} iconSize={iconSize} />
}

/** A song's cover from its site-relative `image_url` (or storage path). */
export function SongImage({ imageUrl, className = '', iconSize = 14 }: {
  imageUrl: string | null | undefined
  className?: string
  iconSize?: number
}): JSX.Element {
  return <ImageBox url={buildImageUrl(imageUrl) ?? null} loading={false} className={className} iconSize={iconSize} />
}
