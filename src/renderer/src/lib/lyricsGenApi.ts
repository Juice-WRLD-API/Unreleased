// Donor lyrics generation (Whisper on the server): a song's audio in, plain
// lyrics, line-synced LRC or per-word LRC out to review. Audio already on the
// server (a catalogue song, a comp file) is named by id or path; anything else
// is uploaded. Nothing is written to the library; the result is a preview the
// user downloads or applies themselves. Routes live under
// /accounts/donor/lyrics/, and the administrator's model choice under
// /accounts/admin/lyrics/settings/. See backend docs/20-lyrics-generation.md.
import { routeUrl } from './apiServers'
import { apiRequest, authedRequest, authHeaders } from './apiClient'
import { getToken, trackIdToSongId } from './userApi'
import { buildStreamUrl } from './juicewrldApi'
import { DONOR_ALLOWED_EXTENSIONS, extensionOf, isImageFile } from './donorFilesApi'
import { ensureDonorUrl, isDonorStreamUrl } from './donorPlayback'
import { saveTimingDraft } from './lyricsTiming'
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

/** `estimated`: the aligner lost this word or line, so its time was spread between aligned neighbours. Absent on older jobs. */
export interface LyricsWordTiming { start: number; end: number; word: string; estimated?: boolean }
export interface LyricsSegment { start: number; end: number; text: string; words?: LyricsWordTiming[]; estimated?: boolean }

export interface LyricsGenResult {
  plain_lyrics: string
  synced_lyrics: string
  word_synced_lyrics: string
  segments: LyricsSegment[]
  /** How many lines / words have estimated timings (sync modes; absent on older jobs). */
  unaligned_lines?: number
  unaligned_words?: number
}

/** Where a job's audio sits on the server. `song` is null for a comp file named by path. */
export interface LyricsJobSource {
  channel: string | null
  path: string
  song: { id: number; public_id: number | null; name: string } | null
}

export interface LyricsGenJob {
  id: string
  mode: LyricsGenMode
  status: LyricsJobStatus
  /** Whole percent: 0-99 while processing (0 while the audio decodes and the
   *  model loads), 100 once completed, the last value after a failure. Absent
   *  on older servers. */
  progress?: number
  filename: string
  /** Null for an upload. Absent on older servers. */
  source?: LyricsJobSource | null
  plain_lyrics: string
  language: string
  /** Empty (`{}`) until the job completes. */
  result: Partial<LyricsGenResult>
  error: string
  created_at: string
  updated_at: string
}

/** A job as the list returns it: no lyrics, those come from `getLyricsJob`. */
export type LyricsGenJobSummary = Pick<LyricsGenJob, 'id' | 'mode' | 'status' | 'progress' | 'filename' | 'source' | 'language' | 'error' | 'created_at' | 'updated_at'>

/** Audio the server already has, so nothing is uploaded. With `songId` the
 *  job names the song (its `path` is in the primary comp); without it, the
 *  comp file at `path` in `channel` (empty: the primary comp). */
export interface LyricsServerAudio {
  songId?: number | null
  path: string
  channel?: string | null
}

/** What a job lists itself as: the song's name, else the file's. */
export const jobTitle = (job: Pick<LyricsGenJob, 'filename' | 'source'>): string => job.source?.song?.name || job.filename

/** A job's server audio, to run a follow-up on the same file. */
export function jobServerAudio(job: Pick<LyricsGenJob, 'source'>): LyricsServerAudio | null {
  const s = job.source
  return s ? { songId: s.song?.id ?? null, path: s.path, channel: s.channel } : null
}

/** The stream for server audio, for playing a result against it. */
export const serverAudioUrl = (a: LyricsServerAudio): string => buildStreamUrl(a.path, a.channel || undefined)

/** Same file? A missing channel is the primary comp, which a job names by slug,
 *  so only two channels that are both set are compared. */
export const sameServerAudio = (a: LyricsServerAudio, b: LyricsServerAudio): boolean =>
  a.path === b.path && (!a.channel || !b.channel || a.channel === b.channel)

/** A track that streams from a comp (`/files/download/?path=`), as server
 *  audio: by song when it is a catalogue song, else by path and channel. Null
 *  for local, donor and other audio, which has to be uploaded. */
export function trackServerAudio(track: Pick<Track, 'id' | 'streamUrl'>): LyricsServerAudio | null {
  const url = track.streamUrl ?? ''
  const route = [routeUrl('/files/download/'), routeUrl('/files/download-compressed/')].find((r) => url.startsWith(`${r}?`))
  if (!route) return null
  const params = new URLSearchParams(url.slice(route.length + 1))
  const path = params.get('path')
  if (!path || !LYRICS_AUDIO_EXTENSIONS.includes(extensionOf(path))) return null
  return { songId: trackIdToSongId(track.id), path, channel: params.get('channel') }
}

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

/** LRC down to its words: no line or word times, no [ar:]-style tags, no empty timed lines. */
export function lrcToPlain(lrc: string): string {
  return lrc.split(/\r?\n/)
    .filter((l) => !/^\s*\[[a-z]+:[^\]]*\]\s*$/i.test(l))
    .map((l) => l.replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '').replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim())
    .filter(Boolean)
    .join('\n')
}

/** The words of a song's (or job's) lyrics for either sync mode: the plain
 *  text, or the LRC cut down to its words when that's all there is. Some songs
 *  keep LRC in the plain field, so both are checked. */
export function lyricsToTime(plain: string, lrc: string): string {
  const p = plain.trim()
  return p && !looksLikeLrc(p) ? p : lrcToPlain(lrc.trim() || p)
}

/** What a sync job sends: word sync always gets plain text, so LRC typed or
 *  opened for it loses its times. */
export const textForMode = (mode: LyricsGenMode, text: string): string =>
  (mode === 'word_synced' && looksLikeLrc(text) ? lrcToPlain(text) : text).trim()

export interface AdlibSpan { start: number; end: number }

/** Adlibs: the parenthesised asides in a lyric line, "(yeah)" or "(What?)".
 *  One span per outermost pair on a line. An unclosed one isn't an adlib, and
 *  brackets are skipped, so "[Chorus (x2)]" and "[ti:Song (Remix)]" stay. */
export function findAdlibs(text: string): AdlibSpan[] {
  const out: AdlibSpan[] = []
  let depth = 0
  let square = 0
  let open = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\n') { depth = 0; square = 0 }
    else if (c === '[') square++
    else if (c === ']') square = Math.max(0, square - 1)
    else if (square) continue
    else if (c === '(') { if (depth++ === 0) open = i }
    else if (c === ')' && depth && --depth === 0) out.push({ start: open, end: i + 1 })
  }
  return out
}

const CUT = '\u0000'

/** The text without its adlibs, except those starting at an offset in `keep`.
 *  The spaces around a removed adlib close up, and a line left with no words
 *  (only an adlib, or an adlib and its LRC times) goes. */
export function removeAdlibs(text: string, keep: ReadonlySet<number> = new Set()): string {
  const spans = findAdlibs(text).filter((a) => !keep.has(a.start))
  if (!spans.length) return text
  let marked = ''
  let at = 0
  for (const s of spans) { marked += text.slice(at, s.start) + CUT; at = s.end }
  marked += text.slice(at)
  return marked.split('\n').flatMap((line) => {
    if (!line.includes(CUT)) return [line]
    const joined = line.replace(/[ \t]*\u0000(?:[ \t]*\u0000)*[ \t]*/g, (m, offset: number) => {
      const before = line.slice(0, offset)
      const after = line.slice(offset + m.length)
      if (!before.trim() || !after || /^[,.!?;:)\]]/.test(after)) return ''
      return /[ \t]/.test(m) ? ' ' : ''
    }).trim()
    return joined.replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]|<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim() ? [joined] : []
  }).join('\n')
}

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

function requestFields(req: LyricsGenRequest): Record<string, string> {
  const out: Record<string, string> = { mode: req.mode }
  if (req.plainLyrics) out.plain_lyrics = req.plainLyrics
  else if (req.syncedLyrics) out.synced_lyrics = req.syncedLyrics
  if (req.language) out.language = req.language
  return out
}

/** Starts a job on audio the server already has: read in place, so there is
 *  no upload and no size limit (the 30-minute one still applies). A song goes
 *  as `song_id`: the server tries public ids first, but internal ids (94000
 *  and up) sit far above every public id, and most songs have no public id. */
export function createLyricsJobFromServer(audio: LyricsServerAudio, req: LyricsGenRequest, signal?: AbortSignal): Promise<LyricsGenJob> {
  const source = audio.songId
    ? { song_id: audio.songId }
    : { file_path: audio.path, ...(audio.channel ? { channel: audio.channel } : {}) }
  // Some deployed servers only accept form data here, including for server audio.
  const body = new FormData()
  for (const [key, value] of Object.entries({ ...source, ...requestFields(req) })) body.append(key, String(value))
  return apiRequest(`${BASE}/jobs/`, { method: 'POST', body, headers: authHeaders(getToken()), signal })
}

/** Starts a job on an upload. XHR rather than fetch so a 100 MB upload can report progress. */
export function createLyricsJob(
  file: File,
  req: LyricsGenRequest,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<LyricsGenJob> {
  const body = new FormData()
  body.append('file', file)
  for (const [k, v] of Object.entries(requestFields(req))) body.append(k, v)
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

/** Also forgets any timing this device tuned for the job. */
export async function deleteLyricsJob(id: string): Promise<void> {
  await authedRequest(`${BASE}/jobs/${encodeURIComponent(id)}/`, { method: 'DELETE' }, getToken())
  saveTimingDraft(id, null)
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
