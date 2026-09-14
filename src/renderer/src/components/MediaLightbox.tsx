import { useEffect, useCallback, useState } from 'react'
import { X, ChevronLeft, ChevronRight, AlertCircle, Download, Loader2 } from 'lucide-react'
import { smallCoverUrl } from '../lib/juicewrldApi'
import { syncThemeColorMeta } from '../lib/themeEffects'

export interface LightboxItem {
  url: string
  type: 'image' | 'video'
  name: string
}

interface Props {
  items: LightboxItem[]
  index: number
  onClose: () => void
  onNav: (index: number) => void
}

export default function MediaLightbox({ items, index, onClose, onNav }: Props): JSX.Element | null {
  const [videoError, setVideoError] = useState(false)
  // Mobile browsers (iOS Safari especially) refuse to play a <video src=...>
  // pointed straight at the API's download endpoint unless the server
  // answers HTTP Range requests - without that it fails with a generic
  // "format not supported" error even for an ordinary mp4. Blob-loading it
  // (one full fetch, then an object URL) sidesteps that requirement
  // entirely, at the cost of buffering the whole file before playback
  // starts instead of streaming it. Tried only after the plain <video> tag
  // actually fails, so the normal streamed path stays the default.
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [blobFailed, setBlobFailed] = useState(false)
  const item = items[index]

  // Reset video state when item changes
  useEffect(() => {
    setVideoError(false)
    setBlobUrl(null)
    setBlobFailed(false)
  }, [index])

  useEffect(() => {
    if (!videoError || !item || item.type !== 'video' || blobUrl || blobFailed) return
    let cancelled = false
    fetch(item.url)
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.blob() })
      .then(blob => { if (!cancelled) setBlobUrl(URL.createObjectURL(blob)) })
      .catch(() => { if (!cancelled) setBlobFailed(true) })
    return () => { cancelled = true }
  }, [videoError, item, blobUrl, blobFailed])

  // Object URLs are only ever handed to this one <video> element - revoke on
  // swap/unmount rather than leaking one per video opened.
  useEffect(() => {
    if (!blobUrl) return
    return () => URL.revokeObjectURL(blobUrl)
  }, [blobUrl])

  const goPrev = useCallback(() => {
    if (index > 0) onNav(index - 1)
  }, [index, onNav])

  const goNext = useCallback(() => {
    if (index < items.length - 1) onNav(index + 1)
  }, [index, items.length, onNav])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, goPrev, goNext])

  // This overlay is `fixed inset-0` with its own black backdrop (deliberate -
  // photos/video look better against black than the app's theme surface), but
  // Safari's toolbar tinting samples whatever's actually painted at the top of
  // the viewport, not the app's theme-color intent. Left alone, that reads the
  // lightbox's black and turns the status bar/toolbar black too. Pin the meta
  // tag to match while this is open, then hand it back to the real theme.
  useEffect(() => {
    const themeColor = document.querySelector('meta[name="theme-color"]')
    themeColor?.setAttribute('content', '#000000')
    return () => syncThemeColorMeta()
  }, [])

  if (!item) return null

  const hasPrev = index > 0
  const hasNext = index < items.length - 1

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/95"
      onClick={onClose}
    >
      {/* Top bar - filename only. The counter/download/close controls used to
          live here too, right next to the Electron window's own minimize/
          maximize/close buttons - confusing and easy to misclick. They now
          float directly above the media itself instead. */}
      <div
        className="flex items-center px-4 py-3 shrink-0 bg-black/60 backdrop-blur-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-white/80 text-sm truncate max-w-[60vw]">{item.name}</span>
      </div>

      {/* Media area */}
      <div
        className="flex-1 flex items-center justify-center relative overflow-hidden"
        onClick={onClose}
      >
        {/* Prev button */}
        {hasPrev && (
          <button
            onClick={(e) => { e.stopPropagation(); goPrev() }}
            className="absolute left-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/80 transition-colors"
            title="Previous (←)"
          >
            <ChevronLeft size={24} />
          </button>
        )}

        {/* Content, with its own controls (counter/download/close) directly above it */}
        <div onClick={(e) => e.stopPropagation()} className="max-w-full max-h-full flex flex-col items-center gap-2">
          <div className="flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5">
            {items.length > 1 && (
              <span className="text-white/40 text-xs">{index + 1} / {items.length}</span>
            )}
            <a
              href={item.url}
              download={item.name}
              className="p-1.5 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              title="Download"
            >
              <Download size={16} />
            </a>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              title="Close (Esc)"
            >
              <X size={18} />
            </button>
          </div>
          {item.type === 'image' ? (
            <img
              src={item.url}
              alt={item.name}
              className="max-w-[90vw] max-h-[72vh] object-contain rounded shadow-2xl select-none"
              draggable={false}
            />
          ) : videoError && blobUrl ? (
            // Blob-loaded retry succeeded - plays from the fully-buffered
            // local object URL instead of the streamed endpoint.
            <video
              key={blobUrl}
              src={blobUrl}
              controls
              autoPlay
              className="max-w-[90vw] max-h-[72vh] rounded shadow-2xl"
              onError={() => setBlobFailed(true)}
            />
          ) : videoError && !blobFailed ? (
            // The streamed <video> just failed; the blob-fetch retry above
            // is in flight.
            <div className="flex flex-col items-center justify-center gap-3 text-white/60 p-8 w-[90vw] max-w-sm aspect-video">
              <Loader2 size={28} className="animate-spin text-white/30" />
              <p className="text-sm">Loading video…</p>
            </div>
          ) : videoError && blobFailed ? (
            <div className="flex flex-col items-center gap-3 text-white/60 p-8">
              <AlertCircle size={40} className="text-white/30" />
              <p className="text-sm">This video format cannot be played in the app.</p>
              <a
                href={item.url}
                download={item.name}
                className="text-accent text-sm underline"
              >
                Download file instead
              </a>
            </div>
          ) : (
            <video
              src={item.url}
              controls
              autoPlay
              className="max-w-[90vw] max-h-[72vh] rounded shadow-2xl"
              onError={() => setVideoError(true)}
            />
          )}
        </div>

        {/* Next button */}
        {hasNext && (
          <button
            onClick={(e) => { e.stopPropagation(); goNext() }}
            className="absolute right-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/80 transition-colors"
            title="Next (→)"
          >
            <ChevronRight size={24} />
          </button>
        )}
      </div>

      {/* Filmstrip (if multiple items) */}
      {items.length > 1 && (
        <div
          className="shrink-0 flex items-center gap-1.5 px-4 py-2 overflow-x-auto bg-black/60 backdrop-blur-sm"
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((it, i) => (
            <button
              key={it.url}
              onClick={() => onNav(i)}
              className={`shrink-0 w-12 h-12 rounded overflow-hidden border-2 transition-all ${
                i === index ? 'border-accent' : 'border-transparent opacity-50 hover:opacity-80'
              }`}
            >
              {it.type === 'image' ? (
                // 48px filmstrip cell - the degraded copy, while the main
                // view above keeps the original.
                <img src={smallCoverUrl(it.url)} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-surface-overlay flex items-center justify-center text-[10px] text-white/60 uppercase">
                  vid
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
