// Donor lyrics generation (Whisper on the server): upload a song's audio, get
// back plain lyrics, line-synced LRC or per-word LRC to review. Nothing is
// written to the library; the result is a preview the user downloads or applies
// themselves. Routes live under /accounts/donor/lyrics/, and the administrator's
// model choice under /accounts/admin/lyrics/settings/. See
// backend docs/20-lyrics-generation.md.
import { routeUrl } from './apiServers'
import { authedRequest, authHeaders } from './apiClient'
import { getToken } from './userApi'
import { DONOR_ALLOWED_EXTENSIONS, extensionOf, isImageFile } from './donorFilesApi'
import { ensureDonorUrl, isDonorStreamUrl } from './donorPlayback'
import type { Track } from '../types'

const BASE = routeUrl('/accounts/donor/lyrics')
const ADMIN_URL = routeUrl('/accounts/admin/lyrics/settings/')
const ADMIN_JOBS = routeUrl('/accounts/admin/lyrics/jobs')

export const LYRICS_MAX_FILE_SIZE = 100 * 1024 * 1024
export const LYRICS_MAX_TEXT = 30_000
/** Audio the server takes: the donor upload types, less the images. */
export const LYRICS_AUDIO_EXTENSIONS = DONOR_ALLOWED_EXTENSIONS.filter((e) => !isImageFile({ filename: `x.${e}`, mime_type: '' }))

export type LyricsGenMode = 'plain' | 'synced' | 'word_synced'
export type LyricsJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
export type LyricsOutput = 'txt' | 'lrc' | 'enhanced_lrc'

export interface LyricsGenModeOption {
  mode: LyricsGenMode
  label: string
  requires_lyrics: boolean
  available: boolean
  unavailable_reason: string | null
}

export interface LyricsGenOptions {
  available: boolean
  unavailable_reason: string | null
  max_file_size: number
  options: LyricsGenModeOption[]
  preview_required: boolean
}

export interface LyricsWordTiming { start: number; end: number; word: string }
export interface LyricsSegment { start: number; end: number; text: string; words?: LyricsWordTiming[] }

export interface LyricsGenResult {
  plain_lyrics: string
  synced_lyrics: string
  word_synced_lyrics: string
  segments: LyricsSegment[]
}

export interface LyricsGenJob {
  id: string
  mode: LyricsGenMode
  status: LyricsJobStatus
  filename: string
  plain_lyrics: string
  language: string
  /** Empty (`{}`) until the job completes. */
  result: Partial<LyricsGenResult>
  error: string
  created_at: string
  updated_at: string
}

/** A job as the list returns it: no lyrics, those come from `getLyricsJob`. */
export type LyricsGenJobSummary = Pick<LyricsGenJob, 'id' | 'mode' | 'status' | 'filename' | 'language' | 'error' | 'created_at' | 'updated_at'>

export interface LyricsGenRequest {
  mode: LyricsGenMode
  /** Reviewed text, one lyric line per line. Sync modes take this or `syncedLyrics`. */
  plainLyrics?: string
  /** Existing LRC; its timestamps bound each line's alignment. */
  syncedLyrics?: string
  /** Two/three-letter code; omit to let Whisper detect it. */
  language?: string
}

export interface LyricsAdminSettings {
  /** The administrator's choice; empty when the server default applies. */
  whisper_model: string
  default_model: string
  effective_model: string
  available_models: string[]
  updated_by: string | null
  updated_at: string | null
}

export const isFinished = (job: Pick<LyricsGenJob, 'status'>): boolean => job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled'

/** Text with LRC timestamps goes up as `synced_lyrics`, anything else as `plain_lyrics`. */
export const looksLikeLrc = (text: string): boolean => /^\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/m.test(text)

const AUDIO_TYPE_EXTENSION: Record<string, string> = {
  'audio/flac': 'flac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/opus': 'opus',
}

/** A song's audio as a file to upload: its stream, its local file, or its
 *  donor blob. Named after the file when the path has an audio extension,
 *  otherwise after the title with one taken from the response type. */
export async function fetchTrackAudio(
  track: Pick<Track, 'title' | 'path' | 'streamUrl'>,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<File> {
  if (!track.streamUrl) throw new Error(`${track.title} has no audio to load`)
  const url = isDonorStreamUrl(track.streamUrl) ? await ensureDonorUrl(track.streamUrl) : track.streamUrl
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Couldn't load ${track.title} (HTTP ${res.status})`)
  const total = Number(res.headers.get('content-length')) || 0
  let blob: Blob
  if (res.body && total && onProgress) {
    const reader = res.body.getReader()
    const chunks: Uint8Array<ArrayBuffer>[] = []
    let loaded = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value as Uint8Array<ArrayBuffer>)
      loaded += value.length
      onProgress(Math.min(loaded / total, 1))
    }
    blob = new Blob(chunks, { type: res.headers.get('content-type') ?? '' })
  } else blob = await res.blob()
  const fromPath = track.path.split(/[\\/]/).pop() ?? ''
  if (LYRICS_AUDIO_EXTENSIONS.includes(extensionOf(fromPath))) return new File([blob], fromPath, { type: blob.type })
  const ext = AUDIO_TYPE_EXTENSION[blob.type.split(';')[0]] ?? 'mp3'
  return new File([blob], `${track.title.replace(/[\\/:*?"<>|]/g, '_')}.${ext}`, { type: blob.type })
}

export function getLyricsGenOptions(signal?: AbortSignal): Promise<LyricsGenOptions> {
  return authedRequest(`${BASE}/options/`, { signal }, getToken())
}

/** Starts a job. XHR rather than fetch so a 100 MB upload can report progress. */
export function createLyricsJob(
  file: File,
  req: LyricsGenRequest,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<LyricsGenJob> {
  const body = new FormData()
  body.append('file', file)
  body.append('mode', req.mode)
  if (req.plainLyrics) body.append('plain_lyrics', req.plainLyrics)
  else if (req.syncedLyrics) body.append('synced_lyrics', req.syncedLyrics)
  if (req.language) body.append('language', req.language)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/jobs/`)
    for (const [k, v] of Object.entries(authHeaders(getToken()))) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total) }
    const onAbort = (): void => xhr.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.onloadend = () => signal?.removeEventListener('abort', onAbort)
    xhr.onload = () => {
      let data: unknown
      try { data = JSON.parse(xhr.responseText) } catch { data = undefined }
      if (xhr.status >= 200 && xhr.status < 300) { resolve(data as LyricsGenJob); return }
      const d = data as Record<string, unknown> | undefined
      const first = d && !d.detail ? Object.values(d)[0] : undefined
      const msg = d?.detail ? String(d.detail) : first !== undefined ? String(Array.isArray(first) ? first[0] : first) : `Lyrics generation failed to start (${xhr.status})`
      reject(new Error(msg))
    }
    xhr.send(body)
  })
}

/** The caller's jobs, newest first. */
export async function listLyricsJobs(signal?: AbortSignal): Promise<LyricsGenJobSummary[]> {
  const page = await authedRequest<{ results: LyricsGenJobSummary[] }>(`${BASE}/jobs/`, { signal }, getToken())
  return page.results
}

export function getLyricsJob(id: string, signal?: AbortSignal): Promise<LyricsGenJob> {
  return authedRequest(`${BASE}/jobs/${encodeURIComponent(id)}/`, { signal }, getToken())
}

/** A finished job's text as a download (`txt`, `lrc` or `enhanced_lrc`). */
export async function fetchLyricsJobOutput(id: string, output: LyricsOutput, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${BASE}/jobs/${encodeURIComponent(id)}/?output=${output}`, { headers: authHeaders(getToken()), signal })
  if (!res.ok) {
    let msg = `Could not load the lyrics (${res.status})`
    try { const d = await res.json(); if (d?.detail) msg = String(d.detail) } catch {}
    throw new Error(msg)
  }
  return res.text()
}

export function deleteLyricsJob(id: string): Promise<void> {
  return authedRequest(`${BASE}/jobs/${encodeURIComponent(id)}/`, { method: 'DELETE' }, getToken())
}

export function getLyricsAdminSettings(signal?: AbortSignal): Promise<LyricsAdminSettings> {
  return authedRequest(ADMIN_URL, { signal }, getToken())
}

/** `''` reverts to the server's default model. */
export function setLyricsWhisperModel(model: string): Promise<LyricsAdminSettings> {
  return authedRequest(ADMIN_URL, { method: 'PUT', body: JSON.stringify({ whisper_model: model }) }, getToken())
}

export interface LyricsAdminJobSummary extends LyricsGenJobSummary { user: { id: number; username: string } }
export type LyricsAdminJob = LyricsGenJob & Pick<LyricsAdminJobSummary, 'user'>

export interface LyricsAdminJobPage {
  count: number
  /** Queued + processing jobs across all users, whatever the filter. */
  active: number
  results: LyricsAdminJobSummary[]
}

export interface LyricsAdminJobQuery {
  /** A job status, or `active` for queued + processing. */
  status?: string
  user?: string
  limit?: number
  offset?: number
}

/** Every user's jobs, newest first (administrators). */
export function listAdminLyricsJobs(query: LyricsAdminJobQuery = {}, signal?: AbortSignal): Promise<LyricsAdminJobPage> {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') params.set(k, String(v))
  const qs = params.toString()
  return authedRequest(`${ADMIN_JOBS}/${qs ? `?${qs}` : ''}`, { signal }, getToken())
}

export function getAdminLyricsJob(id: string, signal?: AbortSignal): Promise<LyricsAdminJob> {
  return authedRequest(`${ADMIN_JOBS}/${encodeURIComponent(id)}/`, { signal }, getToken())
}

export async function fetchAdminLyricsJobOutput(id: string, output: LyricsOutput, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${ADMIN_JOBS}/${encodeURIComponent(id)}/?output=${output}`, { headers: authHeaders(getToken()), signal })
  if (!res.ok) {
    let msg = `Could not load the lyrics (${res.status})`
    try { const d = await res.json(); if (d?.detail) msg = String(d.detail) } catch {}
    throw new Error(msg)
  }
  return res.text()
}

/** Stops a queued or processing job. One already inside Whisper runs to the end and its result is discarded. */
export function cancelAdminLyricsJob(id: string): Promise<LyricsAdminJob> {
  return authedRequest(`${ADMIN_JOBS}/${encodeURIComponent(id)}/cancel/`, { method: 'POST' }, getToken())
}
