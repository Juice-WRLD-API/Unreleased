// Copying and saving cover art. Every cover the app displays is readable from
// the renderer: the API sends Access-Control-Allow-Origin (same as it does
// for audio - see the CORS notes in audioEffects.ts), so a plain fetch() gets
// the bytes for API covers and data:/blob: covers alike. Copy goes through
// the async Clipboard API; save through an <a download> blob link.

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
}

async function fetchImageBlob(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Image request failed (${res.status})`)
  const blob = await res.blob()
  if (!blob.size) throw new Error('Image was empty')
  return blob
}

// Chromium's async Clipboard API only takes PNG reliably - it rejects
// anything else outright - while covers arrive as JPEG or WebP. Re-encode
// through a canvas. (Saving keeps the original bytes instead, so a saved
// file isn't bloated by a pointless JPEG→PNG round trip.)
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

/** Puts the cover on the clipboard as an image, pasteable into other apps. */
export async function copyCoverImage(url: string): Promise<void> {
  const png = await toPngBlob(await fetchImageBlob(url))
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}

/** Fetches a remote cover and returns it as a data: URL, for embedding in
 *  contexts (like a canvas-rendered share card) that need the bytes inlined
 *  rather than a cross-origin <img> src. */
export async function fetchImageDataUrl(url: string): Promise<string> {
  const blob = await fetchImageBlob(url)
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image'))
    reader.readAsDataURL(blob)
  })
}

/** Writes the cover to disk as a browser download. */
export async function saveCoverImage(url: string, title: string): Promise<'saved' | 'canceled'> {
  const blob = await fetchImageBlob(url)
  const name = coverFileName(title, blob.type)
  // The cover's own URL is cross-origin, where `download` is ignored and the
  // browser navigates to the image instead - so hand the anchor a same-origin
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
