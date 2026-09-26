// Copying and saving cover art.
//
// Every cover the app displays is readable from the renderer: the API sends
// Access-Control-Allow-Origin (same as it does for audio — see the CORS notes
// in audioEffects.ts) and the desktop build's local-media scheme is registered
// with supportFetchAPI/corsEnabled, so a plain fetch() gets the bytes for API
// covers, local-file covers, and data:/blob: covers alike.
//
// From there the two platforms diverge. On desktop the bytes go to the main
// process, which owns the real clipboard and the native save dialog; on the web
// build they go to the async Clipboard API and an <a download> blob link.

import { JWAPI_SITE } from './juicewrldApi'

const JWAPI_HOST = new URL(JWAPI_SITE).hostname

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function desktop(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).electron
}

// A song with no custom cover of its own falls back to an era/project image
// under the API site's own /assets/ path ("/assets/jute.png"), a static file
// served with no CORS header at all - unlike the API's own endpoints, which
// send Access-Control-Allow-Origin. A plain <img> paints those fine (which is
// why they show up everywhere on screen), but fetch()/canvas can't read their
// bytes, so copy/save/ShareLyricsModal's export silently dropped the cover
// for exactly those songs. Retry through an image CORS proxy when the direct
// read fails.
const CORS_PROXIES: ((url: string) => string)[] = [
  (url) => `https://images.weserv.nl/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
]

// A proxy that's down or rate-limiting would otherwise hang whatever is
// awaiting these bytes - ShareLyricsModal's export buttons block on exactly
// this fetch before they rasterize the card.
const PROXY_TIMEOUT_MS = 8000

/** Whether `url` may be handed to a third-party proxy. Only the API's own
 *  https hosts qualify: a user's personal cover is a data:/blob: URL (or a
 *  local-media: one on desktop) that a proxy could never fetch anyway, and
 *  sending those out would leak a local file's contents off-device. */
function isProxyableCoverUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url)
    return protocol === 'https:' && (hostname === JWAPI_HOST || hostname.endsWith(`.${JWAPI_HOST}`))
  } catch {
    return false
  }
}

async function requestImageBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Image request failed (${res.status})`)
  const blob = await res.blob()
  if (!blob.size) throw new Error('Image was empty')
  return blob
}

async function fetchImageBlob(url: string): Promise<Blob> {
  try {
    return await requestImageBlob(url)
  } catch (err) {
    if (!isProxyableCoverUrl(url)) throw err
    for (const proxy of CORS_PROXIES) {
      try {
        const blob = await requestImageBlob(proxy(url), AbortSignal.timeout(PROXY_TIMEOUT_MS))
        // A proxy that's rate-limited or couldn't reach the origin still
        // answers 200, with its own HTML/JSON error page - that passes both
        // checks above and would be "copied" as a broken image otherwise.
        if (blob.type.startsWith('image/')) return blob
      } catch {
        // Fall through to the next proxy, then rethrow the direct failure -
        // that's the one worth reporting, not a proxy's own trouble.
      }
    }
    throw err
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image'))
    reader.readAsDataURL(blob)
  })
}

// Both clipboards only take PNG reliably — Chromium's async Clipboard API
// rejects anything else outright, and Electron's nativeImage decodes just
// PNG/JPEG — while covers arrive as JPEG or WebP. Re-encode through a canvas.
// (Saving keeps the original bytes instead, so a saved file isn't bloated by a
// pointless JPEG→PNG round trip.)
async function toPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not draw image')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((out) => (out ? resolve(out) : reject(new Error('Could not encode image'))), 'image/png')
  })
}

/** The song title as a filename, with the extension the bytes actually are. */
export function coverFileName(title: string, mime: string): string {
  const base = (title || 'cover')
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'cover'
  return `${base}.${MIME_EXT[mime] ?? 'jpg'}`
}

/** Fetches a remote cover and returns it as a data: URL, for embedding in
 *  contexts (like a canvas-rendered share card) that need the bytes inlined
 *  rather than a cross-origin <img> src. */
export async function fetchImageDataUrl(url: string): Promise<string> {
  return blobToDataUrl(await fetchImageBlob(url))
}

/** Puts the cover on the clipboard as an image, pasteable into other apps. */
export async function copyCoverImage(url: string): Promise<void> {
  const png = await toPngBlob(await fetchImageBlob(url))
  const el = desktop()
  if (el?.copyImageToClipboard) {
    const res = await el.copyImageToClipboard(await blobToDataUrl(png))
    if (res?.error) throw new Error(res.error)
    return
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}

/** Writes the cover to disk — a native Save-as dialog on desktop, a browser
 *  download on the web. Resolves 'canceled' if the user dismissed the dialog. */
export async function saveCoverImage(url: string, title: string): Promise<'saved' | 'canceled'> {
  const blob = await fetchImageBlob(url)
  const name = coverFileName(title, blob.type)
  const el = desktop()
  if (el?.saveImageFile) {
    const res = await el.saveImageFile({ defaultName: name, dataUrl: await blobToDataUrl(blob) })
    if (res?.error) throw new Error(res.error)
    return res?.canceled ? 'canceled' : 'saved'
  }
  // The cover's own URL is cross-origin, where `download` is ignored and the
  // browser navigates to the image instead — so hand the anchor a same-origin
  // blob: URL, which does honour the attribute (and the filename).
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 10_000)
  return 'saved'
}
