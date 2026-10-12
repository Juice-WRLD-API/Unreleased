// Saves a Blob the user asked to "download" — a playlist ZIP, a synced-
// lyrics export, a bulk track — to wherever that means on the current
// platform.
//
// Desktop/web: a plain `<a download>` click on a blob: URL, same as it's
// always been. Android: that technique silently no-ops in this WebView (it
// isn't a real browser and doesn't wire `download` up to an actual save), so
// every download in the app quietly did nothing there — this routes through
// DownloadsPlugin.java instead, which writes into the real Downloads folder.

import { isAndroidApp } from './androidUpdate'
import { useStore } from '../store/useStore'
import { IS_IOS, IS_NATIVE_APP } from './platform'
import { Directory, Filesystem } from '@capacitor/filesystem'

interface DownloadsPlugin {
  save(opts: { filename: string; base64: string; mimeType: string; folderUri?: string }): Promise<{ filename: string }>
  pickFolder(): Promise<{ canceled?: boolean; uri?: string; name?: string }>
  releaseFolder(opts: { uri: string }): Promise<void>
}

function androidPlugin(): DownloadsPlugin | null {
  const cap = (window as unknown as { Capacitor?: { Plugins?: { Downloads?: DownloadsPlugin } } }).Capacitor
  return cap?.Plugins?.Downloads ?? null
}

/** Opens the system folder picker and, on success, saves the choice as the
 *  download destination (see useStore's downloadFolder). Returns the picked
 *  folder's display name, or null if the user backed out or the plugin isn't
 *  available (non-Android). Doesn't touch the store on cancel. */
export async function pickDownloadFolder(): Promise<string | null> {
  const plugin = androidPlugin()
  if (!plugin) return null
  const result = await plugin.pickFolder()
  if (result.canceled || !result.uri) return null
  // Releasing the previous folder's grant (if any) is best-effort and
  // shouldn't block adopting the new one.
  const prev = useStore.getState().downloadFolder
  if (prev) plugin.releaseFolder({ uri: prev.uri }).catch(() => {})
  useStore.getState().setDownloadFolder({ uri: result.uri, name: result.name ?? result.uri })
  return result.name ?? null
}

/** Resets the download destination back to the platform default. */
export function clearDownloadFolder(): void {
  const prev = useStore.getState().downloadFolder
  if (prev) androidPlugin()?.releaseFolder({ uri: prev.uri }).catch(() => {})
  useStore.getState().setDownloadFolder(null)
}

/** Blob → base64 payload (no data: URI prefix), off the main-thread-blocking
 *  path — FileReader is async even though the blob is already in memory. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // "data:<mime>;base64,<payload>" — only the payload goes over the bridge.
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** Saves `blob` as `filename`. Resolves once the save has actually happened —
 *  callers that show a "Saved" state should wait for this, not fire-and-forget. */
export async function saveFile(filename: string, blob: Blob): Promise<void> {
  if (IS_NATIVE_APP && IS_IOS) {
    // Documents is visible under On My iPhone > Unreleased in Files.
    // A download anchor does not save blobs in WKWebView.
    const safeName = filename.replace(/[\\/\x00-\x1f]/g, '_').replace(/^\.+$/, '_') || 'download'
    await Filesystem.writeFile({
      path: safeName,
      data: await blobToBase64(blob),
      directory: Directory.Documents,
    })
    return
  }
  if (isAndroidApp()) {
    const plugin = androidPlugin()
    if (!plugin) throw new Error('Downloads plugin unavailable')
    const base64 = await blobToBase64(blob)
    const folderUri = useStore.getState().downloadFolder?.uri
    await plugin.save({ filename, base64, mimeType: blob.type || 'application/octet-stream', folderUri })
    return
  }
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}

export function reportSaveError(error: unknown): void {
  console.error('Download failed', error)
  window.alert(`Could not save the file: ${error instanceof Error ? error.message : String(error)}`)
}

export async function saveUrl(filename: string, url: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Download failed (${response.status})`)
  await saveFile(filename, await response.blob())
}

/** Covers declarative download links in shared web views, including chat. */
export function installNativeDownloads(): void {
  if (!isAndroidApp() && !(IS_NATIVE_APP && IS_IOS)) return
  document.addEventListener('click', (event) => {
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[download]') : null
    if (!anchor || event.defaultPrevented) return
    event.preventDefault()
    void saveUrl(anchor.download || 'download', anchor.href).catch(reportSaveError)
  })
}
