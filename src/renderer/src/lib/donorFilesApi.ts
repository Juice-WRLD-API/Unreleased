// Donor personal file storage (1 GB, audio + images, optional share links).
// Routes live under /accounts/donor/ - see docs/content.tsx "Donor File Storage".
import { JWAPI_BASE } from './juicewrldApi'
import { authedRequest, authHeaders } from './apiClient'
import { getToken } from './userApi'

const BASE = `${JWAPI_BASE}/accounts/donor`

export const DONOR_MAX_FILE_SIZE = 100 * 1024 * 1024
export const DONOR_ALLOWED_EXTENSIONS = [
  'mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'aiff', 'wma',
  'jpg', 'jpeg', 'png', 'gif', 'webp',
]
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp'])

export interface DonorFile {
  file_id: string
  filename: string
  mime_type: string
  size: number
  is_shared: boolean
  share_token: string
  share_url: string
  created_at: string
  updated_at: string
}

export interface DonorQuota {
  used: number
  quota: number
  remaining: number
}

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

export function isImageFile(f: Pick<DonorFile, 'filename' | 'mime_type'>): boolean {
  return f.mime_type.startsWith('image/') || IMAGE_EXTENSIONS.has(extensionOf(f.filename))
}

/** Client-side pre-check so an obviously bad pick fails before the upload. */
export function validateDonorUpload(file: File, quota: DonorQuota | null): string | null {
  if (!DONOR_ALLOWED_EXTENSIONS.includes(extensionOf(file.name))) {
    return `${file.name}: file type not allowed`
  }
  if (file.size > DONOR_MAX_FILE_SIZE) return `${file.name}: over the 100 MB per-file limit`
  if (quota && file.size > quota.remaining) return `${file.name}: not enough storage left`
  return null
}

export function listDonorFiles(): Promise<{ files: DonorFile[]; quota: DonorQuota }> {
  return authedRequest(`${BASE}/files/`, {}, getToken())
}

export async function uploadDonorFile(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<{ file: DonorFile; quota: DonorQuota }> {
  // XHR rather than fetch so a 100 MB upload can report progress.
  const body = new FormData()
  body.append('file', file)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/files/upload/`)
    for (const [k, v] of Object.entries(authHeaders(getToken()))) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.onload = () => {
      let data: unknown
      try { data = JSON.parse(xhr.responseText) } catch { data = undefined }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as { file: DonorFile; quota: DonorQuota })
        return
      }
      const d = data as { detail?: string; error?: string } | undefined
      const msg = xhr.status === 429
        ? 'Upload limit reached (60 per hour). Try again later.'
        : d?.detail || d?.error || `Upload failed (${xhr.status})`
      reject(new Error(msg))
    }
    xhr.send(body)
  })
}

export function updateDonorFile(
  fileId: string,
  patch: { filename?: string; is_shared?: boolean },
): Promise<DonorFile> {
  return authedRequest(`${BASE}/files/${fileId}/`, { method: 'PATCH', body: JSON.stringify(patch) }, getToken())
}

export function deleteDonorFile(fileId: string): Promise<{ detail: string; quota: DonorQuota }> {
  return authedRequest(`${BASE}/files/${fileId}/`, { method: 'DELETE' }, getToken())
}

/** Own-file bytes as a blob. The endpoint needs the token header, so an
 *  <audio src>/<img src> can't hit it directly - callers use an object URL. */
export async function fetchDonorFileBlob(fileId: string): Promise<Blob> {
  const res = await fetch(`${BASE}/files/${fileId}/download/`, { headers: authHeaders(getToken()) })
  if (!res.ok) throw new Error(`Could not load file (${res.status})`)
  return res.blob()
}
