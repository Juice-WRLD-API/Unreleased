// Single-file download progress shared by the Files tab, the Tracker and the
// terminal. A CDN download is buffered into a Blob and hash-checked before
// the browser's own download starts, so without this the click looks like it
// did nothing until the whole file has arrived. Origin fallbacks hand off to
// the browser's download UI straight away, so their entry is dropped as soon
// as downloadFileSmart resolves.
//
// The list lives at module level rather than in a component, so a deeply
// memoized row (the Tracker's SongCard) can start a download without a
// callback threaded down to it, and whichever view is open shows the toast.
import { useSyncExternalStore } from 'react'
import cdnService, { downloadFileSmart } from '../lib/cdn'
import type { CdnDownloadProgress } from '../lib/cdnWebrtc'

export interface CdnFileDownload {
  id: number
  name: string
  /** null until the node sends its first bytes (resolve, signaling, ICE). */
  progress: CdnDownloadProgress | null
}

let downloads: CdnFileDownload[] = []
let nextId = 1
const listeners = new Set<() => void>()

function setDownloads(next: CdnFileDownload[]): void {
  downloads = next
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Same contract as downloadFileSmart - resolves to whether the donor boost
 *  applied - but shows up in the download toast while the CDN fetches it.
 *  `onProgress` also sees every update, for callers that report it
 *  themselves (the terminal). */
export async function startCdnFileDownload(
  path: string,
  filename: string,
  streamUrl: string,
  onProgress?: (p: CdnDownloadProgress) => void,
  /** Song id, so the "embed lyrics on download" setting can apply. */
  songId?: number | null
): Promise<boolean> {
  // CDN off: downloadFileSmart goes straight to the browser download.
  if (!cdnService.enabled) return downloadFileSmart(path, filename, streamUrl, undefined, songId)

  const id = nextId++
  setDownloads([...downloads, { id, name: filename, progress: null }])
  const track = (progress: CdnDownloadProgress): void => {
    setDownloads(downloads.map((d) => (d.id === id ? { ...d, progress } : d)))
    onProgress?.(progress)
  }
  try {
    return await downloadFileSmart(path, filename, streamUrl, track, songId)
  } finally {
    setDownloads(downloads.filter((d) => d.id !== id))
  }
}

/** In-flight CDN downloads, newest last. */
export function useCdnFileDownloads(): CdnFileDownload[] {
  return useSyncExternalStore(subscribe, () => downloads)
}

/** Toast label for the newest download: what step it's on, plus how many
 *  others are still running. */
export function fileDownloadLabel(list: CdnFileDownload[]): string {
  const latest = list[list.length - 1]
  if (!latest) return ''
  const p = latest.progress
  const step = !p ? 'Connecting…'
    : p.progress >= 100 ? 'Verifying…'
    : `${p.progress}%`
  const more = list.length > 1 ? ` (+${list.length - 1} more)` : ''
  return `${latest.name} · ${step}${more}`
}
