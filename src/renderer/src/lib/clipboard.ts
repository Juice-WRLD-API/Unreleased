/** Copies text via Electron's native clipboard bridge when present. The app's
 *  permission handler denies clipboard-write, so navigator.clipboard.writeText
 *  fails inside the desktop app; it's only the fallback for the plain web build. */
export function copyText(text: string): Promise<unknown> {
  const el = (window as any).electron
  return el?.copyTextToClipboard ? el.copyTextToClipboard(text) : navigator.clipboard.writeText(text)
}

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })

/** Copies a PNG blob as an image, via the native bridge in Electron (see copyText). */
export async function copyPngImage(blob: Blob): Promise<void> {
  const el = (window as any).electron
  if (el?.copyImageToClipboard) {
    await el.copyImageToClipboard(await blobToDataUrl(blob))
    return
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}
