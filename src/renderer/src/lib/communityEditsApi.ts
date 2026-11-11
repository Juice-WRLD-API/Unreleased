// Community remixes and edits (backend docs/23-community-edits.md). Anyone
// signed in can send one in; managers of the primary channel and admins
// approve it into the community channel in Files, at
// Remixes & Edits/Community-Made/<uuid>/edit.<ext>.
//
// The server turns away a file that is too much like one it already has (409)
// and says which one, so the app can send the user there instead.
import { routeUrl } from './apiServers'
import { getToken } from './userApi'
import { authHeaders, authedRequest } from './apiClient'

const BASE = routeUrl('/accounts/community-edits')
const ADMIN_BASE = routeUrl('/accounts/admin/community-edits')

export type CommunityEditStatus = 'pending' | 'approved' | 'rejected' | 'reversed'
export const COMMUNITY_EDIT_STATUSES: CommunityEditStatus[] = ['pending', 'approved', 'rejected', 'reversed']
export type CommunityEditKind = 'remix' | 'stem_edit' | 'other'
export const COMMUNITY_EDIT_KINDS: { id: CommunityEditKind; label: string }[] = [
  { id: 'remix', label: 'Remix' },
  { id: 'stem_edit', label: 'Stem edit' },
  { id: 'other', label: 'Other edit' },
]

export interface CommunityEdit {
  id: number
  title: string
  kind: CommunityEditKind
  /** Internal id of the song it is made from, if one was picked. */
  song: number | null
  song_public_id: number | null
  song_name: string | null
  submitter_id: number | null
  submitter_username: string | null
  /** Site-relative. Public once approved; before that it needs the token. */
  audio_url: string
  extension: string
  size: number
  duration: number
  sha256: string
  notes: string
  status: CommunityEditStatus
  reviewer_username: string | null
  review_notes: string
  comp_proposal_id: number | null
  /** The channel it was filed in once approved (`community`). */
  comp_channel: string | null
  /** Where it sits in that channel once approved. */
  comp_path: string | null
  created_at: string
  reviewed_at: string | null
}

/** The file an upload was matched with, and where to send the user. */
export type CommunityEditMatch = {
  source: string
  /** Percent. */
  score: number
  verdict: string
} & (
  | { target: 'file'; path: string; channel: string | null; title?: string }
  | { target: 'song'; song: { id: number; public_id: number; name: string }; path: string }
  /** Waiting for review. `submission` and `title` only when it is yours. */
  | { target: 'pending'; mine?: boolean; submission?: number; title?: string }
)

export interface CommunityEditPage {
  count: number
  limit: number
  offset: number
  results: CommunityEdit[]
}

export interface CommunityEditCounts { total: number; pending: number; approved: number; rejected: number; reversed: number }

export interface CommunityEditListParams {
  status?: CommunityEditStatus
  limit?: number
  offset?: number
}

export const COMMUNITY_EDIT_EXTENSIONS = ['mp3', 'm4a', 'flac', 'wav', 'ogg', 'opus', 'aiff', 'aif']
export const COMMUNITY_EDIT_ACCEPT = COMMUNITY_EDIT_EXTENSIONS.map((e) => `.${e}`).join(',')
export const COMMUNITY_EDIT_MAX_BYTES = 95 * 1024 * 1024
export const COMMUNITY_EDIT_MAX_TITLE = 200
export const COMMUNITY_EDIT_MAX_NOTES = 1000

/** Thrown when the server already has this edit (409); `match` says where it is. */
export class DuplicateEditError extends Error {
  constructor(message: string, readonly match: CommunityEditMatch) {
    super(message)
    this.name = 'DuplicateEditError'
  }
}

function listUrl(base: string, params: CommunityEditListParams = {}): string {
  const url = new URL(`${base}/`)
  if (params.status) url.searchParams.set('status', params.status)
  if (params.limit != null) url.searchParams.set('limit', String(params.limit))
  if (params.offset) url.searchParams.set('offset', String(params.offset))
  return url.toString()
}

/** The picked file's problem before anything is sent, or null when it looks fine. */
export function checkCommunityEditFile(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!COMMUNITY_EDIT_EXTENSIONS.includes(ext)) return 'Pick an MP3, M4A, FLAC, WAV, Ogg, Opus or AIFF file.'
  if (file.size > COMMUNITY_EDIT_MAX_BYTES) return 'Edits can be at most 95 MB.'
  return null
}

/** Hex SHA-256 of the file, read on this device. */
export async function sha256OfFile(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** A file with exactly these bytes that the server already has, or null.
 *  Cheap: only the hash is sent. The full check runs on submit. */
export async function checkCommunityEditHash(sha256: string, signal?: AbortSignal): Promise<CommunityEditMatch | null> {
  const url = new URL(`${BASE}/check/`)
  url.searchParams.set('sha256', sha256)
  const res = await authedRequest<{ match: CommunityEditMatch | null }>(url.toString(), { method: 'GET', signal }, getToken())
  return res.match
}

export interface CommunityEditFields {
  title: string
  kind: CommunityEditKind
  /** Internal song id. */
  songId?: number | null
  notes?: string
}

/** Uploads an edit. Rejects with DuplicateEditError when the server already has it. */
export function submitCommunityEdit(
  file: File,
  fields: CommunityEditFields,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<CommunityEdit> {
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('title', fields.title.trim())
  form.append('kind', fields.kind)
  if (fields.songId != null) form.append('song', String(fields.songId))
  if (fields.notes?.trim()) form.append('notes', fields.notes.trim())
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/`)
    for (const [k, v] of Object.entries(authHeaders(getToken()))) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total) }
    const onAbort = (): void => xhr.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.onloadend = () => signal?.removeEventListener('abort', onAbort)
    xhr.onload = () => {
      let data: Record<string, unknown> | undefined
      try { data = JSON.parse(xhr.responseText) } catch { data = undefined }
      if (xhr.status >= 200 && xhr.status < 300) { resolve(data as unknown as CommunityEdit); return }
      const detail = data?.detail ? String(data.detail) : undefined
      if (xhr.status === 409 && data?.match) { reject(new DuplicateEditError(detail ?? 'We already have this edit.', data.match as CommunityEditMatch)); return }
      // The proxy stops oversized uploads with an HTML page and no detail.
      if (xhr.status === 413) { reject(new Error(detail ?? 'Edits can be at most 95 MB.')); return }
      if (xhr.status === 429) { reject(new Error(detail ?? 'You have sent in a lot of edits today. Try again tomorrow.')); return }
      reject(new Error(detail ?? `Could not send the edit (${xhr.status})`))
    }
    xhr.send(form)
  })
}

/** Your own submissions, newest first. */
export async function listMyCommunityEdits(params: CommunityEditListParams = {}): Promise<CommunityEditPage> {
  return authedRequest<CommunityEditPage>(listUrl(BASE, params), { method: 'GET' }, getToken())
}

export async function getMyCommunityEdit(id: number): Promise<CommunityEdit> {
  return authedRequest<CommunityEdit>(`${BASE}/${id}/`, { method: 'GET' }, getToken())
}

/** Withdraws a pending submission; the server deletes its file. */
export async function withdrawCommunityEdit(id: number): Promise<void> {
  await authedRequest<unknown>(`${BASE}/${id}/`, { method: 'DELETE' }, getToken())
}

/** The submitted audio. Needed for anything not approved: those are only
 *  served with the token, so an <audio> can't point at them. */
export async function fetchCommunityEditAudio(id: number, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(`${BASE}/${id}/audio/`, { headers: authHeaders(getToken()), signal })
  if (!res.ok) throw new Error(res.status === 404 ? 'Audio not found' : `Could not load the audio (${res.status})`)
  return res.blob()
}

// ── Review (manager of the primary channel, or administrator) ────────────────

export async function adminListCommunityEdits(params: CommunityEditListParams = {}): Promise<CommunityEditPage> {
  return authedRequest<CommunityEditPage>(listUrl(ADMIN_BASE, params), { method: 'GET' }, getToken())
}

export async function adminCommunityEditCounts(): Promise<CommunityEditCounts> {
  return authedRequest<CommunityEditCounts>(`${ADMIN_BASE}/?counts=1`, { method: 'GET' }, getToken())
}

export async function adminReviewCommunityEdit(id: number, action: 'approve' | 'reject', reviewNotes?: string): Promise<CommunityEdit> {
  return authedRequest<CommunityEdit>(`${ADMIN_BASE}/${id}/review/`, {
    method: 'POST',
    body: JSON.stringify({ action, review_notes: reviewNotes?.trim() ?? '' }),
  }, getToken())
}

/** Takes back an approval; the file is taken out of Files. */
export async function adminReverseCommunityEdit(id: number): Promise<CommunityEdit> {
  return authedRequest<CommunityEdit>(`${ADMIN_BASE}/${id}/reverse/`, { method: 'POST' }, getToken())
}

export const communityEditKindLabel = (kind: string): string =>
  COMMUNITY_EDIT_KINDS.find((k) => k.id === kind)?.label ?? 'Edit'
