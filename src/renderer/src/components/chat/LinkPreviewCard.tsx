import { memo, useEffect, useState } from 'react'
import { firstPreviewUrl, loadLinkPreview, type LinkPreview } from '../../lib/linkPreview'

function PreviewCard({ url }: { url: string }): JSX.Element | null {
  const [preview, setPreview] = useState<LinkPreview | null>(null)
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPreview(null)
    setImageFailed(false)
    loadLinkPreview(url).then((p) => { if (!cancelled) setPreview(p) })
    return () => { cancelled = true }
  }, [url])

  // Nothing while loading or when the link has no preview: most links in a
  // message shouldn't leave a placeholder behind.
  if (!preview) return null
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="mt-1 flex w-full max-w-md overflow-hidden rounded-xl border border-[var(--border)] border-l-[3px] border-l-accent bg-surface-raised/60 hover:bg-surface-raised transition-colors"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2.5">
        <span className="truncate text-[11px] text-text-muted">{preview.siteName}</span>
        <span className="line-clamp-2 break-words text-sm font-semibold text-text-primary">{preview.title}</span>
        {preview.description && <span className="line-clamp-2 break-words text-xs text-text-secondary">{preview.description}</span>}
      </span>
      {preview.image && !imageFailed && (
        <img
          src={preview.image}
          alt=""
          loading="lazy"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
          className="h-auto w-24 shrink-0 self-stretch object-cover sm:w-28"
        />
      )}
    </a>
  )
}

/** A card for the first previewable link in a message's text. */
function LinkPreviewCard({ text }: { text: string }): JSX.Element | null {
  const url = firstPreviewUrl(text)
  return url ? <PreviewCard url={url} /> : null
}

export default memo(LinkPreviewCard)
