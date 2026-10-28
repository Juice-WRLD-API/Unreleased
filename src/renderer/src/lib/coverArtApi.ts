// Cover art submissions (backend docs/22-cover-art.md). Anyone signed in can
// send in cover art for a song; managers of the primary channel and admins
// approve or reject it. Approving points the song's `image_url` at the
// submission's image, which then becomes public.
//
// Songs are picked by internal `id`, the same as edit proposals.
import { routeUrl } from './apiServers'
import { buildImageUrl } from './juicewrldApi'
import { getToken } from './userApi'
import { apiRequest, authHeaders, authedRequest, defaultParseError } from './apiClient'

const BASE = routeUrl('/accounts/cover-art')
const ADMIN_BASE = routeUrl('/accounts/admin/cover-art')

export type CoverArtStatus = 'pending' | 'approved' | 'rejected' | 'reversed'
export const COVER_ART_STATUSES: CoverArtStatus[] = ['pending', 'approved', 'rejected', 'reversed']

export interface CoverArtSubmission {
  id: number
  song: number | null
  song_public_id: number | null
  song_name: string | null
  /** What the song shows now. Null once the song is deleted. */
  song_image_url: string | null
  submitter_id: number | null
  submitter_username: string | null
  /** Site-relative, like a song's image_url. Public only once approved. */
  image_url: string
  mime: string
  width: number
  height: number
  size: number
  notes: string
  status: CoverArtStatus
  reviewer_username: string | null
  review_notes: string
  /** The song's image_url before this cover replaced it (set on approval). */
  previous_image_url: string | null
  created_at: string
  reviewed_at: string | null
}

export interface CoverArtPage {
  count: number
  limit: number
  offset: number
  results: CoverArtSubmission[]
}

export interface CoverArtCounts { total: number; pending: number; approved: number; rejected: number; reversed: number }

/** The song the submit dialog is open for (the store's `coverArtModal`). */
export interface CoverArtTarget {
  songId: number
  songName: string
  /** The cover the song shows now, for comparison. */
  currentCover?: string | null
}

export interface CoverArtListParams {
  status?: CoverArtStatus
  song?: number
  limit?: number
  offset?: number
}

// What the server accepts (it re-encodes and caps the stored copy at 3000 px).
export const COVER_ART_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const COVER_ART_MAX_BYTES = 20 * 1024 * 1024
export const COVER_ART_MIN_SIDE = 300
export const COVER_ART_MAX_SIDE = 6000
export const COVER_ART_MAX_NOTES = 1000

function listUrl(base: string, params: CoverArtListParams = {}): string {
  const url = new URL(`${base}/`)
  if (params.status) url.searchParams.set('status', params.status)
  if (params.song != null) url.searchParams.set('song', String(params.song))
  if (params.limit != null) url.searchParams.set('limit', String(params.limit))
  if (params.offset) url.searchParams.set('offset', String(params.offset))
  return url.toString()
}

/** Your own submissions, newest first. */
export async function listMyCoverArt(params: CoverArtListParams = {}): Promise<CoverArtPage> {
  return authedRequest<CoverArtPage>(listUrl(BASE, params), { method: 'GET' }, getToken())
}

export async function getMyCoverArt(id: number): Promise<CoverArtSubmission> {
  return authedRequest<CoverArtSubmission>(`${BASE}/${id}/`, { method: 'GET' }, getToken())
}

// An oversized upload can be stopped by the proxy before Django sees it, and
// that 413 comes back as an HTML page with no `detail`.
async function submitParseError(res: Response): Promise<string> {
  const message = await defaultParseError(res)
  if (res.status === 413 && message.startsWith('Request failed')) return 'Cover art can be at most 20 MB.'
  return message
}

/** Multipart upload; the server's `detail` is the thrown message on 400/413/429. */
export async function submitCoverArt(songId: number, image: File | Blob, notes?: string): Promise<CoverArtSubmission> {
  const form = new FormData()
  form.append('song', String(songId))
  form.append('image', image, image instanceof File ? image.name : 'cover')
  if (notes?.trim()) form.append('notes', notes.trim())
  // No Content-Type: fetch sets the multipart boundary itself.
  return apiRequest<CoverArtSubmission>(`${BASE}/`, {
    method: 'POST',
    headers: authHeaders(getToken()),
    body: form,
    parseError: submitParseError,
  })
}

/** Withdraws a pending submission; the server deletes its image. */
export async function withdrawCoverArt(id: number): Promise<void> {
  await authedRequest<unknown>(`${BASE}/${id}/`, { method: 'DELETE' }, getToken())
}

/** The submitted image itself. Needed for anything not approved: those are
 *  only served with the token, so an <img> can't point at them. */
export async function fetchCoverArtImage(id: number): Promise<Blob> {
  const res = await fetch(`${BASE}/${id}/image/`, { headers: authHeaders(getToken()) })
  if (!res.ok) throw new Error(res.status === 404 ? 'Image not found' : `Could not load the image (${res.status})`)
  return res.blob()
}

/** A URL an <img> can load without auth, or null when the image is private. */
export function publicCoverArtUrl(sub: Pick<CoverArtSubmission, 'status' | 'image_url'>): string | null {
  return sub.status === 'approved' ? buildImageUrl(sub.image_url) ?? null : null
}

// ── Review (manager of the primary channel, or administrator) ────────────────

export async function adminListCoverArt(params: CoverArtListParams = {}): Promise<CoverArtPage> {
  return authedRequest<CoverArtPage>(listUrl(ADMIN_BASE, params), { method: 'GET' }, getToken())
}

export async function adminCoverArtCounts(): Promise<CoverArtCounts> {
  return authedRequest<CoverArtCounts>(`${ADMIN_BASE}/?counts=1`, { method: 'GET' }, getToken())
}

export async function adminReviewCoverArt(id: number, action: 'approve' | 'reject', reviewNotes?: string): Promise<CoverArtSubmission> {
  return authedRequest<CoverArtSubmission>(`${ADMIN_BASE}/${id}/review/`, {
    method: 'POST',
    body: JSON.stringify({ action, review_notes: reviewNotes?.trim() ?? '' }),
  }, getToken())
}

/** Takes back an approval; the song goes back to its previous cover if it
 *  still shows this one. */
export async function adminReverseCoverArt(id: number): Promise<CoverArtSubmission> {
  return authedRequest<CoverArtSubmission>(`${ADMIN_BASE}/${id}/reverse/`, { method: 'POST' }, getToken())
}

/** Checks a picked file against the server's limits before uploading, so the
 *  common mistakes don't cost an upload. Gives the image's size when it looks
 *  fine, or the reason it won't be accepted. */
export async function checkCoverArtFile(file: File): Promise<{ width: number; height: number } | string> {
  if (!COVER_ART_TYPES.includes(file.type)) return 'Pick a JPEG, PNG or WebP image.'
  if (file.size > COVER_ART_MAX_BYTES) return 'Cover art can be at most 20 MB.'
  let width = 0
  let height = 0
  try {
    const bitmap = await createImageBitmap(file)
    width = bitmap.width
    height = bitmap.height
    bitmap.close()
  } catch {
    return 'That image could not be read.'
  }
  if (width < COVER_ART_MIN_SIDE || height < COVER_ART_MIN_SIDE) return `The image is ${width}×${height}. Each side needs at least ${COVER_ART_MIN_SIDE} pixels.`
  if (width > COVER_ART_MAX_SIDE || height > COVER_ART_MAX_SIDE) return `The image is ${width}×${height}. Each side can be at most ${COVER_ART_MAX_SIDE} pixels.`
  return { width, height }
}
