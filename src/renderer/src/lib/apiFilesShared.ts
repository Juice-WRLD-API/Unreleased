// Pure helpers shared by ApiFilesView.desktop.tsx and .mobile.tsx - the
// /files/* browser's path/sort/track-building logic, identical on both.
import { apiFetch, apiFilePathToTrack, buildStreamUrl, JWApiFileEntry, JWApiPaginatedResponse, JWApiSong } from './juicewrldApi'
import { getFileExt } from './fileTypes'
import { Track } from '../types'

export type ViewMode = 'list' | 'grid'
export type SortBy = 'name' | 'type' | 'size'
export type SortDir = 'asc' | 'desc'
export type ZipStatus = 'idle' | 'starting' | 'zipping' | 'done' | 'error'

export function breadcrumbs(path: string): { label: string; path: string }[] {
  if (!path) return []
  const parts = path.split('/').filter(Boolean)
  return parts.map((label, i) => ({ label, path: parts.slice(0, i + 1).join('/') }))
}

export function parentFolder(path: string): string {
  const i = path.lastIndexOf('/')
  return i > 0 ? path.slice(0, i) : ''
}

export function fileToTrack(entry: JWApiFileEntry, channel?: string): Track {
  return apiFilePathToTrack(entry.path, entry.name, channel)
}

export function sortEntries(entries: JWApiFileEntry[], by: SortBy, dir: SortDir): JWApiFileEntry[] {
  return [...entries].sort((a, b) => {
    // Dirs always first
    const aDir = a.type === 'directory'
    const bDir = b.type === 'directory'
    if (aDir !== bDir) return aDir ? -1 : 1

    let cmp = 0
    if (by === 'name') {
      cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    } else if (by === 'type') {
      const aExt = getFileExt(a.name)
      const bExt = getFileExt(b.name)
      cmp = aExt.localeCompare(bExt) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    } else if (by === 'size') {
      cmp = (a.size ?? 0) - (b.size ?? 0)
    }
    return dir === 'asc' ? cmp : -cmp
  })
}

export function pathToUrl(folderPath: string): string {
  if (!folderPath) return '/files'
  return '/files/' + folderPath.split('/').map(encodeURIComponent).join('/')
}

export function urlToPath(pathname: string): string {
  if (!pathname.startsWith('/files/')) return ''
  return decodeURIComponent(pathname.slice('/files/'.length))
}

/** The URL "Copy link" puts on the clipboard: the file's stream URL, or a
 *  deep link to the folder itself for a directory. */
export function fileEntryLinkUrl(entry: JWApiFileEntry, channel: string | undefined): string {
  return entry.type === 'file'
    ? buildStreamUrl(entry.path, channel)
    : window.location.origin + pathToUrl(entry.path)
}

/** Best-guess Tracker song for a file, by stripping its extension and
 *  taking the top search hit - used to open "Find in Tracker" / the song
 *  info panel from a file row. Identical fetch in both views; what they do
 *  with the result (open a global panel vs. a local modal) differs. */
export async function findSongByFilename(name: string): Promise<JWApiSong | null> {
  const title = name.replace(/\.[^.]+$/, '')
  try {
    const data = await apiFetch<JWApiPaginatedResponse>('/songs/', { search: title, page_size: 5 })
    return data.results[0] ?? null
  } catch {
    return null
  }
}

/** Downloads a URL via a throwaway anchor click - the same trick used for a
 *  file's stream URL and for a completed ZIP job's download_url. */
export function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
