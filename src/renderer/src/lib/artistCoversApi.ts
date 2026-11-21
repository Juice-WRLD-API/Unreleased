// Artist folders (backend docs/22-cover-art.md "Artist folders"). An account an
// administrator made an artist (`account.is_artist`) has its own folder,
// `Cover Arts/<artist_folder>/` in the community channel of Files, and uploads
// and removes covers there with no review.
import { routeUrl } from './apiServers'
import { buildStreamUrl } from './juicewrldApi'
import { getToken } from './userApi'
import { apiRequest, authHeaders, authedRequest, defaultParseError } from './apiClient'

const BASE = routeUrl('/accounts/artist/covers')

export interface ArtistCover {
  /** File name inside the folder, e.g. `Lucid Dreams alt.png`. */
  name: string
  /** Full Files path, `Cover Arts/<folder>/<name>`. */
  path: string
  channel: string
  size: number
  hash: string
  updated_at: string
}

export interface ArtistFolder {
  folder: string
  path: string
  channel: string
  max_files: number
  files: ArtistCover[]
}

export async function getArtistFolder(): Promise<ArtistFolder> {
  return authedRequest<ArtistFolder>(`${BASE}/`, { method: 'GET' }, getToken())
}

async function uploadParseError(res: Response): Promise<string> {
  const message = await defaultParseError(res)
  if (res.status === 413 && message.startsWith('Request failed')) return 'Cover art can be at most 20 MB.'
  return message
}

/** Adds a cover to your folder at once. `name` is the file name without its
 *  extension; the uploaded file's name is used when it is left out. */
export async function uploadArtistCover(image: File | Blob, name?: string): Promise<ArtistCover> {
  const form = new FormData()
  form.append('image', image, image instanceof File ? image.name : 'cover')
  if (name?.trim()) form.append('name', name.trim())
  return apiRequest<ArtistCover>(`${BASE}/`, {
    method: 'POST',
    headers: authHeaders(getToken()),
    body: form,
    parseError: uploadParseError,
  })
}

/** Takes a cover out of your folder (it goes to the comp archive). */
export async function deleteArtistCover(name: string): Promise<void> {
  await authedRequest<unknown>(`${BASE}/?name=${encodeURIComponent(name)}`, { method: 'DELETE' }, getToken())
}

/** Small copy first, the full file as the fallback. */
export function artistCoverSources(cover: Pick<ArtistCover, 'path' | 'channel'>): string[] {
  const full = buildStreamUrl(cover.path, cover.channel)
  return [`${full}&small=1`, full]
}
