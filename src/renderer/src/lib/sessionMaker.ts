// Session Maker: arrange takes from a studio session zip into a new song.
//
// Sessions live on the API as Pro Tools/Logic zips under "Studio Sessions/".
// Nothing is downloaded up front - lib/remoteZip reads the zip's directory
// and each take's WAV header by byte range, and a take's audio is only pulled
// once it's placed on the timeline or previewed.
//
// Pro Tools writes each take's original timeline position into its WAV's
// BWF `bext` chunk (TimeReference, in samples since session start), so every
// take can be dropped exactly where it was recorded against the beat - the
// .ptx project file itself is a closed format and isn't read.

import { apiFetch, buildStreamUrl, parseBrowseEntries, type JWApiBrowseResponse, type JWApiFileEntry } from './juicewrldApi'
import { ls } from './persist'
import { useStore } from '../store/useStore'
import { openRemoteZip, readEntry, readEntryHeads, type LocalZip, type RemoteZip, type ZipEntry } from './remoteZip'
import { toFileUrl } from './fileTypes'

export const SESSIONS_ROOT = 'Studio Sessions'

// ─── Browsing ────────────────────────────────────────────────────────────────

export interface SessionFolder { name: string; path: string; count: number }

async function browse(path: string): Promise<JWApiFileEntry[]> {
  return parseBrowseEntries(await apiFetch<JWApiBrowseResponse>('/files/browse/', { path }))
}

/** Era folders under Studio Sessions, in the API's own "1. …", "2. …" order. */
export async function listSessionFolders(): Promise<SessionFolder[]> {
  const items = (await browse(SESSIONS_ROOT)).filter((e) => e.type === 'directory')
  const num = (n: string): number => Number(/^(\d+)\./.exec(n)?.[1] ?? 999)
  return items
    .map((e) => ({ name: e.name, path: e.path, count: (e as { item_count?: number }).item_count ?? 0 }))
    .sort((a, b) => num(a.name) - num(b.name) || a.name.localeCompare(b.name))
}

export async function listSessionZips(folderPath: string): Promise<JWApiFileEntry[]> {
  return (await browse(folderPath)).filter((e) => e.type === 'file' && /\.zip$/i.test(e.name))
}

export async function searchSessionZips(term: string): Promise<JWApiFileEntry[]> {
  const items = parseBrowseEntries(await apiFetch<JWApiBrowseResponse>('/files/browse/', { path: SESSIONS_ROOT, search: term }))
  return items.filter((e) => e.type === 'file' && /\.zip$/i.test(e.name) && e.path.startsWith(SESSIONS_ROOT + '/'))
}

/** "Blue Day (ProTools).zip" -> "Blue Day". */
export function sessionTitle(zipName: string): string {
  return zipName.replace(/\.zip$/i, '').replace(/\s*[[({](ProTools|Pro Tools|Logic|Multi-Track Stems|FL Studio|Stems)[\])}]\s*$/i, '').trim()
}

// ─── Scanning a session ──────────────────────────────────────────────────────

export type TakeKind = 'beat' | 'take' | 'bounce' | 'other'

export interface Take {
  /** Stable within the zip: the entry path (minus .L/.R for split stereo). */
  id: string
  name: string
  kind: TakeKind
  entries: ZipEntry[]
  channels: number
  sampleRate: number | null
  /** Seconds; null until decoded for non-WAV files. */
  duration: number | null
  /** Original timeline position in seconds (already relative to the session origin), or null if the file carries none. */
  position: number | null
  rawTimeRef: number | null
}

export interface ScannedSession {
  zipPath: string
  zip: RemoteZip
  takes: Take[]
  bpm: number | null
}

interface WavInfo { sampleRate: number; channels: number; bitsPerSample: number; dataBytes: number | null; timeRef: number | null }

function parseWavHeader(b: Uint8Array, entrySize: number): WavInfo | null {
  if (b.length < 12) return null
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const riff = String.fromCharCode(b[0], b[1], b[2], b[3])
  if ((riff !== 'RIFF' && riff !== 'RF64') || String.fromCharCode(b[8], b[9], b[10], b[11]) !== 'WAVE') return null
  let p = 12
  let sampleRate = 0, channels = 0, bitsPerSample = 0
  let dataBytes: number | null = null, timeRef: number | null = null, ds64Data: number | null = null
  while (p + 8 <= b.length) {
    const id = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3])
    const size = v.getUint32(p + 4, true)
    const body = p + 8
    if (id === 'ds64' && body + 16 <= b.length) ds64Data = Number(v.getBigUint64(body + 8, true))
    else if (id === 'fmt ' && body + 16 <= b.length) {
      channels = v.getUint16(body + 2, true)
      sampleRate = v.getUint32(body + 4, true)
      bitsPerSample = v.getUint16(body + 14, true)
    } else if (id === 'bext' && body + 346 <= b.length) {
      timeRef = Number(v.getBigUint64(body + 338, true))
    } else if (id === 'data') {
      dataBytes = size === 0xffffffff && ds64Data != null ? ds64Data : Math.min(size, entrySize - body)
      break
    }
    p = body + size + (size & 1)
  }
  if (!sampleRate || !channels) return null
  return { sampleRate, channels, bitsPerSample, dataBytes, timeRef }
}

// AIFF parsing for Logic sessions, whose takes are .aif - Chromium's
// decodeAudioData doesn't read AIFF, so it's decoded by hand (PCM only).
interface AiffInfo { sampleRate: number; channels: number; bitsPerSample: number; frames: number; littleEndian: boolean; dataOffset: number | null }

function readExtended(v: DataView, o: number): number {
  const exp = ((v.getUint8(o) & 0x7f) << 8) | v.getUint8(o + 1)
  const hi = v.getUint32(o + 2), lo = v.getUint32(o + 6)
  if (!exp && !hi && !lo) return 0
  return (hi * 2 ** 32 + lo) * 2 ** (exp - 16383 - 63)
}

function parseAiffHeader(b: Uint8Array): AiffInfo | null {
  if (b.length < 12) return null
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const tag = (o: number): string => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
  const form = tag(8)
  if (tag(0) !== 'FORM' || (form !== 'AIFF' && form !== 'AIFC')) return null
  let p = 12
  let info: AiffInfo | null = null
  while (p + 8 <= b.length) {
    const id = tag(p), size = v.getUint32(p + 4), body = p + 8
    if (id === 'COMM' && body + 18 <= b.length) {
      const comp = form === 'AIFC' && body + 22 <= b.length ? tag(body + 18) : 'NONE'
      if (comp !== 'NONE' && comp !== 'sowt') return null
      info = {
        channels: v.getInt16(body), frames: v.getUint32(body + 2), bitsPerSample: v.getInt16(body + 6),
        sampleRate: readExtended(v, body + 8), littleEndian: comp === 'sowt', dataOffset: null,
      }
    } else if (id === 'SSND' && info) {
      info.dataOffset = body + 8 + v.getUint32(body)
      break
    }
    p = body + size + (size & 1)
  }
  return info && info.sampleRate > 0 && info.channels > 0 ? info : null
}

function decodeAiff(raw: ArrayBuffer, ctx: BaseAudioContext): AudioBuffer {
  const b = new Uint8Array(raw)
  const info = parseAiffHeader(b)
  if (!info || info.dataOffset == null) throw new Error('Unsupported AIFF')
  const { channels, bitsPerSample: bits, littleEndian: le } = info
  const bytes = Math.ceil(bits / 8)
  const frames = Math.min(info.frames, Math.floor((b.length - info.dataOffset) / (bytes * channels)))
  const out = ctx.createBuffer(channels, Math.max(1, frames), info.sampleRate)
  const data = Array.from({ length: channels }, (_, c) => out.getChannelData(c))
  const v = new DataView(raw)
  const scale = 2 ** (bytes * 8 - 1)
  let o = info.dataOffset
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      let x: number
      if (bytes === 2) x = v.getInt16(o, le)
      else if (bytes === 3) {
        x = le ? b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) : (b[o] << 16) | (b[o + 1] << 8) | b[o + 2]
        if (x & 0x800000) x -= 0x1000000
      } else if (bytes === 4) x = v.getInt32(o, le)
      else x = v.getInt8(o)
      data[c][i] = x / scale
      o += bytes
    }
  }
  return out
}

const AUDIO_RE = /\.(wav|aiff?|mp3|m4a|aac|flac|ogg)$/i
const STEREO_SPLIT_RE = /\.([LR])\.wav$/i
const BEAT_RE = /\b(\d{2,3}\s*bpm|bpm|prod|beat|instrumental|inst)\b/i

/** BPM from a beat file name: "NM - Claymore 140BPM", "COMPUTER [PROD STYN] - Am - 153". */
export function parseBpm(name: string): number | null {
  const base = name.replace(/(\.[LR])?\.(wav|mp3|m4a|aac|flac|ogg|zip)$/i, '')
  const m = /(\d{2,3}(?:\.\d+)?)\s*bpm/i.exec(base) ?? /bpm\s*[-_ ]?\s*(\d{2,3}(?:\.\d+)?)/i.exec(base)
    ?? /\s-\s*(\d{2,3})\s*$/.exec(base)
  const n = m ? Number(m[1]) : NaN
  return n >= 55 && n <= 220 ? n : null
}

const scanCache = new Map<string, Promise<ScannedSession>>()

export function scanSession(zipPath: string, onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<ScannedSession> {
  const cached = scanCache.get(zipPath)
  if (cached) return cached
  const p = doScan(zipPath, onProgress, signal)
  scanCache.set(zipPath, p)
  p.catch(() => scanCache.delete(zipPath))
  return p
}

async function doScan(zipPath: string, onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<ScannedSession> {
  const zip = await openRemoteZip(buildStreamUrl(zipPath), signal, (await downloadedZip(zipPath)) ?? undefined)
  const files = zip.entries.filter((e) =>
    !e.isDir && AUDIO_RE.test(e.name) && !e.name.includes('__MACOSX/') && !/(^|\/)\._/.test(e.name) && e.size > 0)

  // Pro Tools splits stereo into "<name>.L.wav" + "<name>.R.wav".
  const groups = new Map<string, ZipEntry[]>()
  for (const f of files) {
    const m = STEREO_SPLIT_RE.exec(f.name)
    const key = m ? f.name.slice(0, m.index) : f.name
    const g = groups.get(key) ?? []
    g.push(f)
    groups.set(key, g)
  }
  const list = [...groups.entries()].map(([id, entries]) => ({
    id,
    entries: entries.sort((a, b) => (STEREO_SPLIT_RE.exec(a.name)?.[1] ?? '').localeCompare(STEREO_SPLIT_RE.exec(b.name)?.[1] ?? '')),
  }))

  // Pro Tools' header (fmt, bext, elm1...) sits well inside the first 32 KB.
  const wavFirsts = list.map((g) => g.entries[0]).filter((e) => /\.(wav|aiff?)$/i.test(e.name))
  onProgress?.(0, wavFirsts.length)
  const heads = await readEntryHeads(zip, wavFirsts, 32 * 1024, signal, (done) => onProgress?.(done, wavFirsts.length))
  const takes = list.map(({ id, entries }): Take => {
    const first = entries[0]
    const base = id.split('/').pop() ?? id
    const name = entries.length > 1 ? base : base.replace(/\.(wav|aiff?)$/i, '')
    const inBounces = /(^|\/)bounced files\//i.test(id)
    const head = heads.get(first)
    const info: WavInfo | null = head ? parseWavHeader(head, first.size) : null
    const aiff = !info && head ? parseAiffHeader(head) : null
    const channels = info ? info.channels * entries.length : aiff ? aiff.channels : 2
    const duration = info?.dataBytes != null && info.bitsPerSample
      ? info.dataBytes / (info.channels * (info.bitsPerSample / 8)) / info.sampleRate
      : aiff ? aiff.frames / aiff.sampleRate : null
    return {
      id,
      name,
      kind: inBounces ? 'bounce' : 'take',
      entries,
      channels,
      sampleRate: info?.sampleRate ?? aiff?.sampleRate ?? null,
      duration,
      position: null,
      rawTimeRef: info?.timeRef ?? null,
    }
  })

  // The beat: a name that says so, else the longest stereo file outside the bounces.
  const candidates = takes.filter((t) => t.kind === 'take')
  const named = candidates.filter((t) => BEAT_RE.test(t.name) || parseBpm(t.name) != null)
  const pickLongest = (ts: Take[]): Take | undefined => ts.reduce<Take | undefined>((a, t) => (!a || (t.duration ?? 0) > (a.duration ?? 0) ? t : a), undefined)
  const beat = pickLongest(named.filter((t) => t.channels >= 2)) ?? pickLongest(named)
    ?? pickLongest(candidates.filter((t) => t.channels >= 2 && (t.duration ?? 0) > 60))
  if (beat) beat.kind = 'beat'

  // Timeline origin, so the beat starts at 0:00. A beat recorded/bounced in
  // the session carries its real position; an imported one keeps whatever its
  // file had (usually 0) and sits at the session start, which Pro Tools
  // defaults to 01:00:00:00 - takes recorded there all read 3600 s and up.
  const withRef = takes.filter((t) => t.rawTimeRef != null && t.sampleRate && t.kind !== 'bounce')
  const secs = (t: Take): number => t.rawTimeRef! / t.sampleRate!
  const vocalSecs = withRef.filter((t) => t.kind !== 'beat').map(secs)
  const minVocal = vocalSecs.length ? Math.min(...vocalSecs) : 0
  let originSec = beat?.rawTimeRef && beat.sampleRate ? secs(beat) : Math.floor(minVocal / 3600) * 3600
  if (beat?.rawTimeRef && minVocal < originSec) originSec = Math.floor(minVocal / 3600) * 3600
  for (const t of withRef) {
    const pos = secs(t) - originSec
    // Way off the session (a file carried in from elsewhere) - no usable position.
    t.position = pos >= 0 && pos < 3600 ? pos : null
  }
  if (beat && beat.position == null) beat.position = 0
  // Stems/trackouts bounced without timestamps: full-length ones line up from 0:00.
  if (beat?.duration) {
    for (const t of takes) if (t.kind === 'take' && t.position == null && t.duration && Math.abs(t.duration - beat.duration) < 2) t.position = 0
  }

  const order: Record<TakeKind, number> = { beat: 0, take: 1, other: 2, bounce: 3 }
  takes.sort((a, b) => order[a.kind] - order[b.kind] || (a.position ?? 1e9) - (b.position ?? 1e9) || a.name.localeCompare(b.name, undefined, { numeric: true }))

  const bpm = (beat && parseBpm(beat.name)) ?? parseBpm(zipPath.split('/').pop() ?? '')
  return { zipPath, zip, takes, bpm }
}

// ─── Audio ───────────────────────────────────────────────────────────────────

let _ctx: AudioContext | null = null
export function audioContext(): AudioContext {
  if (!_ctx) _ctx = new AudioContext({ latencyHint: 'interactive' })
  return _ctx
}

export interface LoadedTake { buffer: AudioBuffer; peaks: Float32Array }

/** Peaks per second of audio stored for waveform drawing. */
export const PEAKS_PER_SEC = 200

function computePeaks(buffer: AudioBuffer): Float32Array {
  const step = buffer.sampleRate / PEAKS_PER_SEC
  const n = Math.ceil(buffer.length / step)
  const peaks = new Float32Array(n)
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < n; i++) {
      const s = Math.floor(i * step), e = Math.min(data.length, Math.floor((i + 1) * step))
      let m = peaks[i]
      for (let j = s; j < e; j++) { const a = data[j] < 0 ? -data[j] : data[j]; if (a > m) m = a }
      peaks[i] = m
    }
  }
  return peaks
}

const loadCache = new Map<string, Promise<LoadedTake>>()
const loadProgress = new Map<string, number>()
const progressListeners = new Set<() => void>()
const emitProgress = (): void => { for (const l of progressListeners) l() }
export function subscribeLoadProgress(fn: () => void): () => void { progressListeners.add(fn); return () => { progressListeners.delete(fn) } }
/** 0..1 while downloading, undefined when idle or done. */
export function peekLoadProgress(key: string): number | undefined { return loadProgress.get(key) }

const fetchSlots = { active: 0, queue: [] as (() => void)[] }
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (fetchSlots.active >= 8) await new Promise<void>((r) => fetchSlots.queue.push(r))
  fetchSlots.active++
  try { return await fn() } finally {
    fetchSlots.active--
    fetchSlots.queue.shift()?.()
  }
}

export const takeKey = (zipPath: string, takeId: string): string => `${zipPath}\u0000${takeId}`

export function loadTake(session: ScannedSession, take: Take): Promise<LoadedTake> {
  const key = takeKey(session.zipPath, take.id)
  const cached = loadCache.get(key)
  if (cached) return cached
  const p = withSlot(async () => {
    const totals = take.entries.map((e) => e.compressedSize)
    const got = take.entries.map(() => 0)
    const all = totals.reduce((a, b) => a + b, 0) || 1
    loadProgress.set(key, 0); emitProgress()
    const raw = await Promise.all(take.entries.map((e, i) => readEntry(session.zip, e, undefined, (r) => {
      got[i] = r
      loadProgress.set(key, got.reduce((a, b) => a + b, 0) / all); emitProgress()
    })))
    const ctx = audioContext()
    const decoded = await Promise.all(raw.map((r, i) => (/\.aiff?$/i.test(take.entries[i].name) ? decodeAiff(r, ctx) : ctx.decodeAudioData(r))))
    let buffer = decoded[0]
    if (decoded.length > 1) {
      const len = Math.max(...decoded.map((d) => d.length))
      buffer = ctx.createBuffer(decoded.length, len, decoded[0].sampleRate)
      decoded.forEach((d, i) => buffer.copyToChannel(d.getChannelData(0), i))
    }
    if (take.duration == null) take.duration = buffer.duration
    return { buffer, peaks: computePeaks(buffer) }
  }).finally(() => { loadProgress.delete(key); emitProgress() })
  loadCache.set(key, p)
  p.catch(() => loadCache.delete(key))
  return p
}

export function peekLoadedTake(zipPath: string, takeId: string): Promise<LoadedTake> | undefined {
  return loadCache.get(takeKey(zipPath, takeId))
}

// ─── Whole-session downloads ─────────────────────────────────────────────────
// Streaming a take costs ~2 s before the first byte; with the whole zip on the
// device, previews and loads are just a local read + decode. Kept in Cache
// Storage so it survives restarts (in memory only where that's unavailable).

// In the desktop app they go to a folder instead (chosen on first download, see
// "Folder mode" below) and are read back from there in byte ranges.

const ZIP_CACHE = 'session-maker-zips'
const hasCacheStorage = typeof caches !== 'undefined'
const memZips = new Map<string, Blob>()

export interface DownloadState { received: number; total: number; error?: string }
const downloads = new Map<string, DownloadState & { ac: AbortController }>()
const downloadListeners = new Set<() => void>()
let downloadVersion = 0
const emitDownloads = (): void => { downloadVersion++; for (const l of downloadListeners) l() }
export function subscribeDownloads(fn: () => void): () => void { downloadListeners.add(fn); return () => { downloadListeners.delete(fn) } }
/** Changes whenever any download starts, progresses, finishes or is removed. */
export const downloadsVersion = (): number => downloadVersion
export function peekDownload(zipPath: string): DownloadState | undefined { return downloads.get(zipPath) }

// ─── Folder mode (desktop app) ───────────────────────────────────────────────

interface SessionZipApi {
  pickFolder: () => Promise<string | null>
  sessionZipDownload: (p: { url: string; dir: string; filename: string }) => Promise<{ path?: string; size?: number; error?: string }>
  sessionZipDefaultDir: () => Promise<string>
  sessionZipList: (dir: string) => Promise<{ filename: string; path: string; size: number }[]>
  sessionZipRemove: (dir: string, filename: string) => Promise<boolean>
  onSessionZipProgress: (cb: (d: { filename: string; received: number; total: number }) => void) => () => void
}
const zipApi = (): SessionZipApi | null =>
  (typeof window !== 'undefined' ? (window as unknown as { electron?: SessionZipApi }).electron : undefined)?.sessionZipDownload ? (window as unknown as { electron: SessionZipApi }).electron : null

const DIR_KEY = 'sessionMaker.zipDir'
const NAMES_KEY = 'sessionMaker.zipNames'
export const sessionFolder = (): string | null => (zipApi() ? ls.get<string>(DIR_KEY) : null)
export const hasSessionFolderSupport = (): boolean => !!zipApi()
/** Until the user picks one, downloads go to Music/Unreleased/Sessions/Downloaded (created on first download). */
async function useDefaultSessionFolder(): Promise<string | null> {
  const api = zipApi()
  if (!api || ls.get<string>(DIR_KEY)) return ls.get<string>(DIR_KEY)
  const dir = await api.sessionZipDefaultDir().catch(() => null)
  if (dir && !ls.get<string>(DIR_KEY)) { ls.set(DIR_KEY, dir); emitDownloads() }
  return ls.get<string>(DIR_KEY)
}
void useDefaultSessionFolder()
export async function chooseSessionFolder(): Promise<string | null> {
  const api = zipApi()
  const dir = api && (await api.pickFolder())
  if (dir) { ls.set(DIR_KEY, dir); emitDownloads() }
  return dir || null
}
const zipNames = (): Record<string, string> => ls.get<Record<string, string>>(NAMES_KEY) ?? {}
const zipFilename = (zipPath: string): string => (zipPath.split("/").pop() || "session.zip").replace(/[<>:"\|?*]/g, "_")

/** A zip file on disk, read lazily in ranges through the app's local-media protocol. */
function fileZip(filePath: string, size: number): LocalZip {
  const url = toFileUrl(filePath)
  return {
    size,
    slice: (start, end) => ({
      arrayBuffer: async () => {
        const res = await fetch(url, { headers: { Range: `bytes=${start}-${Math.min(end, size) - 1}` } })
        if (res.status !== 206 && res.status !== 200) throw new Error(`Could not read the saved session (HTTP ${res.status})`)
        return res.arrayBuffer()
      },
    }),
  }
}

async function folderZips(): Promise<(DownloadedSession & { local: LocalZip })[]> {
  const api = zipApi()
  const dir = sessionFolder()
  if (!api || !dir) return []
  const names = zipNames()
  const files = new Map((await api.sessionZipList(dir)).map((f) => [f.filename, f]))
  const out: (DownloadedSession & { local: LocalZip })[] = []
  for (const [zipPath, filename] of Object.entries(names)) {
    const f = files.get(filename)
    if (f) out.push({ zipPath, size: f.size, local: fileZip(f.path, f.size) })
  }
  return out
}

export async function downloadedZip(zipPath: string): Promise<LocalZip | null> {
  if (zipApi() && sessionFolder()) {
    const hit = (await folderZips()).find((z) => z.zipPath === zipPath)
    if (hit) return hit.local
  }
  if (!hasCacheStorage) return memZips.get(zipPath) ?? null
  try {
    const res = await (await caches.open(ZIP_CACHE)).match(buildStreamUrl(zipPath))
    return res ? await res.blob() : null
  } catch { return null }
}

export interface DownloadedSession { zipPath: string; size: number }
export async function listDownloadedSessions(): Promise<DownloadedSession[]> {
  if (zipApi() && sessionFolder()) return (await folderZips()).map(({ zipPath, size }) => ({ zipPath, size }))
  if (!hasCacheStorage) return [...memZips].map(([zipPath, b]) => ({ zipPath, size: b.size }))
  try {
    const cache = await caches.open(ZIP_CACHE)
    const out: DownloadedSession[] = []
    for (const req of await cache.keys()) {
      const res = await cache.match(req)
      const zipPath = new URL(req.url).searchParams.get('path')
      if (res && zipPath) out.push({ zipPath, size: Number(res.headers.get('content-length')) || 0 })
    }
    return out
  } catch { return [] }
}

/** A scan made before the download finished keeps its own copy of the zip; point it at the local one. */
function markLocal(zipPath: string, local: LocalZip): void {
  void scanCache.get(zipPath)?.then((s) => { s.zip.local = local }, () => {})
}

/** Starts downloading a session from just its path and size, without scanning it first. */
export function downloadSessionByPath(zipPath: string, size: number): void {
  downloadSession({ zipPath, zip: { url: buildStreamUrl(zipPath), size, entries: [] }, takes: [], bpm: null })
}

// Session downloads also appear as rows in the app's Download Manager (store.downloads).
const MGR_PREFIX = 'session-dl:'
export const isSessionDownloadId = (id: string): boolean => id.startsWith(MGR_PREFIX)
export function cancelSessionDownloadRow(id: string): void { cancelDownload(id.slice(MGR_PREFIX.length)) }

function trackInManager(zipPath: string, total: number) {
  const id = MGR_PREFIX + zipPath
  const { addDownload, removeDownload, updateDownload, setShowDownloadManager } = useStore.getState()
  removeDownload(id)
  addDownload({ id, filename: sessionTitle(zipFilename(zipPath).replace(/\.zip$/i, '')), type: 'file', state: 'downloading', percent: 0, received: 0, total, detail: 'Session download' })
  setShowDownloadManager(true)
  let last = { bytes: 0, time: Date.now() }
  let lastPush = 0
  return {
    progress(received: number, tot?: number): void {
      const now = Date.now()
      if (now - lastPush < 250) return
      lastPush = now
      const dt = (now - last.time) / 1000
      const speedBps = dt >= 0.4 ? Math.max(0, (received - last.bytes) / dt) : undefined
      if (dt >= 0.4) last = { bytes: received, time: now }
      const t = tot || total
      updateDownload(id, { received, bytesReceived: received, total: t, percent: t ? Math.min(99, Math.round((received / t) * 100)) : 0, ...(speedBps !== undefined ? { speedBps } : {}) })
    },
    done(savePath?: string): void { updateDownload(id, { state: 'done', percent: 100, received: total, speedBps: undefined, savePath }) },
    fail(error: string): void { updateDownload(id, { state: 'error', speedBps: undefined, error }) },
    cancelled(): void { updateDownload(id, { state: 'cancelled', speedBps: undefined, error: 'Cancelled' }) },
  }
}

/** Downloads the whole session zip; from then on its takes load from the device. */
export function downloadSession(session: ScannedSession): void {
  const { zipPath, zip } = session
  const existing = downloads.get(zipPath)
  if (zip.local || (existing && !existing.error)) return
  const ac = new AbortController()
  const state: DownloadState & { ac: AbortController } = { received: 0, total: zip.size, ac }
  downloads.set(zipPath, state)
  emitDownloads()
  const mgr = trackInManager(zipPath, zip.size)
  let lastEmit = 0
  const api = zipApi()
  if (api) {
    void (async () => {
      const dir = sessionFolder() ?? (await useDefaultSessionFolder())
      if (!dir) { downloads.delete(zipPath); mgr.cancelled(); emitDownloads(); return }
      const filename = zipFilename(zipPath)
      const off = api.onSessionZipProgress((d) => {
        if (d.filename !== filename) return
        state.received = d.received
        if (d.total) state.total = d.total
        mgr.progress(state.received, state.total)
        emitDownloads()
      })
      try {
        const res = await api.sessionZipDownload({ url: zip.url, dir, filename })
        if (ac.signal.aborted) { void api.sessionZipRemove(dir, filename); mgr.cancelled(); return }
        if (res.error || res.size == null) throw new Error(res.error ?? 'Download failed')
        if (res.size !== zip.size) { void api.sessionZipRemove(dir, filename); throw new Error('Download was incomplete') }
        ls.set(NAMES_KEY, { ...zipNames(), [zipPath]: filename })
        zip.local = fileZip(res.path ?? '', res.size)
        markLocal(zipPath, zip.local)
        downloads.delete(zipPath)
        mgr.done(res.path)
      } catch (err) {
        if (ac.signal.aborted) { downloads.delete(zipPath); mgr.cancelled() }
        else { state.error = err instanceof Error ? err.message : String(err); mgr.fail(state.error) }
      } finally {
        off()
        emitDownloads()
      }
    })()
    return
  }
  void (async () => {
    const res = await fetch(zip.url, { signal: ac.signal })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const counted = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        state.received += chunk.length
        mgr.progress(state.received)
        const now = performance.now()
        if (now - lastEmit > 200) { lastEmit = now; emitDownloads() }
        ctl.enqueue(chunk)
      },
    }))
    let blob: Blob
    if (hasCacheStorage) {
      const cache = await caches.open(ZIP_CACHE)
      if (navigator.storage?.persist) void navigator.storage.persist().catch(() => {})
      await cache.put(zip.url, new Response(counted, { headers: { 'content-type': 'application/zip', 'content-length': String(zip.size) } }))
      const stored = await cache.match(zip.url)
      if (!stored) throw new Error('Could not store the session')
      blob = await stored.blob()
    } else {
      blob = await new Response(counted).blob()
      memZips.set(zipPath, blob)
    }
    if (blob.size !== zip.size) {
      void removeDownloadedSession(zipPath)
      throw new Error('Download was incomplete')
    }
    zip.local = blob
    markLocal(zipPath, blob)
    downloads.delete(zipPath)
    mgr.done()
    emitDownloads()
  })().catch((err) => {
    if (ac.signal.aborted) { downloads.delete(zipPath); mgr.cancelled() }
    else {
      const quota = err instanceof DOMException && err.name === 'QuotaExceededError'
      Object.assign(state, { error: quota ? 'Not enough storage space' : err instanceof Error ? err.message : String(err) })
      mgr.fail(state.error ?? 'Download failed')
    }
    emitDownloads()
  })
}

export function cancelDownload(zipPath: string): void {
  const d = downloads.get(zipPath)
  if (!d) return
  d.ac.abort()
  useStore.getState().updateDownload(MGR_PREFIX + zipPath, { state: 'cancelled', speedBps: undefined, error: 'Cancelled' })
  downloads.delete(zipPath)
  emitDownloads()
}

export async function removeDownloadedSession(zipPath: string): Promise<void> {
  const api = zipApi()
  const dir = sessionFolder()
  const names = zipNames()
  if (api && dir && names[zipPath]) {
    await api.sessionZipRemove(dir, names[zipPath])
    delete names[zipPath]
    ls.set(NAMES_KEY, names)
  }
  memZips.delete(zipPath)
  if (hasCacheStorage) await (await caches.open(ZIP_CACHE)).delete(buildStreamUrl(zipPath)).catch(() => false)
  void scanCache.get(zipPath)?.then((s) => { s.zip.local = undefined }, () => {})
  emitDownloads()
}

// ─── Project model ───────────────────────────────────────────────────────────

export interface SmClip {
  id: string
  takeId: string
  /** Timeline position, seconds. */
  start: number
  /** Where in the take the clip begins, seconds. */
  offset: number
  length: number
  /** Linear gain. */
  gain: number
  fadeIn: number
  fadeOut: number
  /** Left on the timeline but silent - an alternate take while comping. */
  muted?: boolean
  /** Stretches left silent by swipe comping, in take seconds (offset-relative, so
   *  they stay with the audio when the clip is moved, trimmed or split). Sorted, apart. */
  silent?: [number, number][]
}

export interface SmTrack {
  id: string
  name: string
  gain: number
  /** -1 (left) to 1 (right); missing is centre. */
  pan?: number
  muted: boolean
  solo: boolean
  clips: SmClip[]
  /** The beat lane is left out of comping. Older projects only have the name. */
  role?: 'beat'
  /** The take folder this lane is in (SmProject.folders). Its lanes sit together. */
  folder?: string
}

/** Lanes holding takes of the same parts, shown under one comp lane. */
export interface TakeFolder { id: string; name: string }

export interface TakeCategory { id: string; name: string }

export interface SmProject {
  v: 1
  id: string
  name: string
  zipPath: string
  bpm: number | null
  /** Where bar 1 beat 1 sits on the timeline, seconds. */
  gridOffset: number
  masterGain: number
  tracks: SmTrack[]
  loop?: { start: number; end: number; on: boolean } | null
  /** The original bounce to A/B against: a take id and where it starts on the timeline. */
  reference?: { takeId: string; offset: number } | null
  /** Display names the user gave takes, by take id. The files themselves keep their names. */
  takeNames?: Record<string, string>
  /** User-made groups for the take bin ("Adlibs", "Hooks"…), in display order. */
  takeCategories?: TakeCategory[]
  /** Which category each take is in, by take id. Takes not listed sit in the plain "Takes" section. */
  takeCategory?: Record<string, string>
  /** Take folders, in no particular order - their lanes' positions place them. */
  folders?: TakeFolder[]
  createdAt: number
  updatedAt: number
}

export const uid = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

export function newProject(session: ScannedSession, name: string): SmProject {
  const beat = session.takes.find((t) => t.kind === 'beat')
  const tracks: SmTrack[] = []
  if (beat && beat.duration) {
    tracks.push({
      id: uid(), name: 'Beat', role: 'beat', gain: 1, muted: false, solo: false,
      clips: [{ id: uid(), takeId: beat.id, start: beat.position ?? 0, offset: 0, length: beat.duration, gain: 1, fadeIn: 0, fadeOut: 0 }],
    })
  }
  const folder: TakeFolder = { id: uid(), name: 'Vocals' }
  for (let i = 1; i <= 3; i++) tracks.push({ id: uid(), name: `Vocals ${i}`, gain: 1, muted: false, solo: false, clips: [], folder: folder.id })
  const now = Date.now()
  const ref = defaultReference(session)
  return {
    v: 1, id: uid(), name, zipPath: session.zipPath, bpm: session.bpm, gridOffset: beat?.position ?? 0, masterGain: 1, tracks,
    loop: null, reference: ref ? { takeId: ref.id, offset: 0 } : null, folders: [folder], createdAt: now, updatedAt: now,
  }
}

/** The bounce to A/B against: a WAV over its MP3 copy, the latest version by name. */
export function defaultReference(session: ScannedSession): Take | undefined {
  const bounces = session.takes.filter((t) => t.kind === 'bounce')
  const wav = bounces.filter((t) => /\.wav$/i.test(t.entries[0].name))
  const pool = wav.length ? wav : bounces
  return [...pool].sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))[0]
}

export const isBeatTrack = (t: SmTrack): boolean => t.role === 'beat' || (t.role == null && t.name === 'Beat')

/** Clips on the vocal lanes covering the same stretch as `clipId` (it included), in lane order. */
export function alternatesOf(p: SmProject, clipId: string): SmClip[] {
  let target: SmClip | undefined
  for (const t of p.tracks) target ??= t.clips.find((c) => c.id === clipId)
  if (!target) return []
  const s = target.start, e = target.start + target.length
  const out: SmClip[] = []
  for (const t of p.tracks) {
    if (isBeatTrack(t)) continue
    for (const c of [...t.clips].sort((a, b) => a.start - b.start)) {
      // Takes of the same part: each covers at least half of the other. A long
      // take isn't an alternate of a short punch-in or ad-lib that sits inside it.
      const overlap = Math.min(e, c.start + c.length) - Math.max(s, c.start)
      if (c.id === clipId || (overlap > 0 && overlap >= c.length / 2 && overlap >= target.length / 2)) out.push(c)
    }
  }
  return out
}

// ─── Swipe comping ───────────────────────────────────────────────────────────

type Span = [number, number]
/** Crossfade across each comp edge, seconds. Silent stretches shorter than this, or closer together, merge away. */
export const COMP_XF = 0.01

function normSpans(spans: Span[]): Span[] {
  const out: Span[] = []
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1]
    if (last && a - last[1] < COMP_XF) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out.filter(([a, b]) => b - a >= COMP_XF)
}

function subtractSpan(spans: Span[], [a, b]: Span): Span[] {
  return normSpans(spans.flatMap(([x, y]): Span[] => (y <= a || x >= b ? [[x, y]] : [...(x < a ? [[x, a] as Span] : []), ...(y > b ? [[b, y] as Span] : [])])))
}

/** The clip's silent stretches within it, in clip time (0 = its left edge). A muted clip is one stretch. */
export function silentSpans(c: SmClip): Span[] {
  if (c.muted) return [[0, c.length]]
  if (!c.silent) return []
  return c.silent
    .map(([a, b]): Span => [Math.max(0, a - c.offset), Math.min(c.length, b - c.offset)])
    .filter(([a, b]) => b - a > 1e-6)
}

const isComped = (c: SmClip): boolean => c.muted || silentSpans(c).length > 0
export const hasMutedClips = (p: SmProject): boolean => p.tracks.some((t) => t.clips.some(isComped))

export function unmuteAll(p: SmProject): SmProject {
  const clear = (c: SmClip): SmClip => { const { silent: _, ...rest } = c; return { ...rest, muted: false } }
  return { ...p, tracks: p.tracks.map((t) => (t.clips.some((c) => c.muted || c.silent) ? { ...t, clips: t.clips.map((c) => (c.muted || c.silent ? clear(c) : c)) } : t)) }
}

/** Makes `clipId` the only take heard over its stretch: its alternates are muted, it's unmuted. */
export function compTo(p: SmProject, clipId: string): SmProject {
  const alts = new Set(alternatesOf(p, clipId).map((c) => c.id))
  return {
    ...p,
    tracks: p.tracks.map((t) => (t.clips.some((c) => alts.has(c.id))
      ? { ...t, clips: t.clips.map((c) => { if (!alts.has(c.id)) return c; const { silent: _, ...rest } = c; return { ...rest, muted: c.id !== clipId } }) }
      : t)),
  }
}

/** What a swipe on `clipId` silences: its alternates, and a longer take it sits
 *  over (swiping a punch-in uses it in place of the take under it). Not shorter
 *  clips inside it - those may be ad-libs. */
function swipeRivals(p: SmProject, clipId: string): Set<string> {
  const out = new Set(alternatesOf(p, clipId).map((c) => c.id))
  let target: SmClip | undefined
  for (const t of p.tracks) target ??= t.clips.find((c) => c.id === clipId)
  if (!target) return out
  for (const t of p.tracks) {
    if (isBeatTrack(t)) continue
    for (const c of t.clips) {
      const overlap = Math.min(target.start + target.length, c.start + c.length) - Math.max(target.start, c.start)
      if (c.length > target.length && overlap >= target.length / 2) out.add(c.id)
    }
  }
  out.delete(clipId)
  return out
}

/** Swipe comping: `clipId` is heard from timeline `from` to `to`, and its rivals there are silent. */
export function swipeComp(p: SmProject, clipId: string, from: number, to: number): SmProject {
  const rivals = swipeRivals(p, clipId)
  const takeSpan = (c: SmClip): Span => [Math.max(c.start, from) - c.start + c.offset, Math.min(c.start + c.length, to) - c.start + c.offset]
  const settle = (c: SmClip, silent: Span[]): SmClip => {
    const { silent: _, ...rest } = c
    const inside = normSpans(silent.map(([a, b]): Span => [Math.max(a, c.offset), Math.min(b, c.offset + c.length)]))
    if (inside.length === 1 && inside[0][0] <= c.offset + 1e-6 && inside[0][1] >= c.offset + c.length - 1e-6) return { ...rest, muted: true }
    return silent.length ? { ...rest, muted: false, silent } : { ...rest, muted: false }
  }
  return {
    ...p,
    tracks: p.tracks.map((t) => {
      if (!t.clips.some((c) => c.id === clipId || rivals.has(c.id))) return t
      return {
        ...t,
        clips: t.clips.map((c) => {
          if (c.id === clipId) {
            const base: Span[] = c.muted ? [[c.offset, c.offset + c.length]] : c.silent ?? []
            return settle(c, subtractSpan(base, takeSpan(c)))
          }
          if (!rivals.has(c.id) || c.muted) return c
          const span = takeSpan(c)
          if (span[1] - span[0] <= 0) return c
          return settle(c, normSpans([...(c.silent ?? []), span]))
        }),
      }
    }),
  }
}

export function projectEnd(p: SmProject): number {
  let end = 0
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.length)
  return end
}

/** Every take placed at its recorded position, packed onto as few lanes as don't overlap
 *  (the take folder's, when there is one). */
export function placeAllTakes(project: SmProject, session: ScannedSession): SmProject {
  const placed = new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.takeId)))
  const todo = session.takes.filter((t) => t.kind === 'take' && t.position != null && t.duration && !placed.has(t.id))
  if (!todo.length) return project
  const tracks = project.tracks.map((t) => ({ ...t, clips: [...t.clips] }))
  // With a take folder, takes go in its lanes - not an ad-lib or reference lane that happens to be free.
  const home = lastFolder(tracks)
  const lanes = tracks.filter((t) => !isBeatTrack(t) && (!home || t.folder === home))
  const fits = (t: SmTrack, s: number, e: number): boolean => t.clips.every((c) => c.start >= e - 1e-3 || c.start + c.length <= s + 1e-3)
  for (const take of todo) {
    const s = take.position!, e = s + take.duration!
    let lane = lanes.find((t) => fits(t, s, e))
    if (!lane) {
      lane = { id: uid(), name: `Vocals ${lanes.length + 1}`, gain: 1, muted: false, solo: false, clips: [], folder: lastFolder(tracks) }
      lanes.push(lane)
      tracks.push(lane)
    }
    lane.clips.push({ id: uid(), takeId: take.id, start: s, offset: 0, length: take.duration!, gain: 1, fadeIn: 0, fadeOut: 0 })
  }
  return normalizeFolders({ ...project, tracks })
}

// ─── Take folders ────────────────────────────────────────────────────────────

const withoutFolder = (t: SmTrack): SmTrack => { const { folder: _, ...rest } = t; return rest }

/** The folder of the last vocal lane that's in one - where new take lanes go. */
export function lastFolder(tracks: SmTrack[]): string | undefined {
  for (let i = tracks.length - 1; i >= 0; i--) if (!isBeatTrack(tracks[i]) && tracks[i].folder) return tracks[i].folder
  return undefined
}

/** Each folder's lanes together, where its first lane is; no empty folders, no
 *  lanes in a missing one, the beat in none. Returns `p` itself when that already holds. */
export function normalizeFolders(p: SmProject): SmProject {
  const folders = p.folders ?? []
  if (!folders.length && !p.tracks.some((t) => t.folder)) return p
  const known = new Set(folders.map((f) => f.id))
  const clean = p.tracks.map((t) => (t.folder && (!known.has(t.folder) || isBeatTrack(t)) ? withoutFolder(t) : t))
  const tracks: SmTrack[] = []
  const placed = new Set<string>()
  for (const t of clean) {
    if (!t.folder) { tracks.push(t); continue }
    if (placed.has(t.folder)) continue
    placed.add(t.folder)
    tracks.push(...clean.filter((x) => x.folder === t.folder))
  }
  const kept = folders.filter((f) => placed.has(f.id))
  if (kept.length === folders.length && tracks.every((t, i) => t === p.tracks[i])) return p
  return { ...p, tracks, folders: kept }
}

export type TimelineRow =
  | { kind: 'folder'; folder: TakeFolder; open: boolean; members: number[] }
  | { kind: 'track'; trackIdx: number; folder?: string }

/** What the timeline shows top to bottom: a folder's row, then its lanes unless it's folded. */
export function timelineRows(p: SmProject, closed: ReadonlySet<string>): TimelineRow[] {
  const byId = new Map((p.folders ?? []).map((f) => [f.id, f]))
  const rows: TimelineRow[] = []
  const folderRows = new Map<string, Extract<TimelineRow, { kind: 'folder' }>>()
  p.tracks.forEach((t, i) => {
    const f = t.folder ? byId.get(t.folder) : undefined
    if (!f) { rows.push({ kind: 'track', trackIdx: i }); return }
    let row = folderRows.get(f.id)
    if (!row) {
      row = { kind: 'folder', folder: f, open: !closed.has(f.id), members: [] }
      folderRows.set(f.id, row)
      rows.push(row)
    }
    row.members.push(i)
    if (row.open) rows.push({ kind: 'track', trackIdx: i, folder: f.id })
  })
  return rows
}

/** Puts the lanes (never the beat) in a new folder, gathered where the first of them is. */
export function groupIntoFolder(p: SmProject, trackIds: string[], name: string): { project: SmProject; folderId: string | null } {
  const ids = new Set(p.tracks.filter((t) => trackIds.includes(t.id) && !isBeatTrack(t)).map((t) => t.id))
  if (!ids.size) return { project: p, folderId: null }
  const folder: TakeFolder = { id: uid(), name }
  const tracks = p.tracks.map((t) => (ids.has(t.id) ? { ...t, folder: folder.id } : t))
  return { project: normalizeFolders({ ...p, tracks, folders: [...(p.folders ?? []), folder] }), folderId: folder.id }
}

/** Removes the folder; its lanes stay where they are. */
export function ungroupFolder(p: SmProject, folderId: string): SmProject {
  return normalizeFolders({ ...p, tracks: p.tracks.map((t) => (t.folder === folderId ? withoutFolder(t) : t)), folders: (p.folders ?? []).filter((f) => f.id !== folderId) })
}

/** The heard stretches of a clip, in clip time - what's left between its silences. */
export function audibleSpans(c: SmClip): [number, number][] {
  const out: [number, number][] = []
  let at = 0
  for (const [a, b] of silentSpans(c)) {
    if (a > at) out.push([at, a])
    at = Math.max(at, b)
  }
  if (at < c.length) out.push([at, c.length])
  return out.filter(([a, b]) => b - a > 1e-6)
}

// ─── Saved projects ──────────────────────────────────────────────────────────

const LS_PROJECTS = 'sessionMaker:projects'

export function loadProjects(): SmProject[] {
  return (ls.get<SmProject[]>(LS_PROJECTS) ?? []).filter((p) => p && p.v === 1).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function saveProject(p: SmProject): void {
  const rest = loadProjects().filter((x) => x.id !== p.id)
  ls.set(LS_PROJECTS, [p, ...rest])
}

export function deleteProject(id: string): void {
  ls.set(LS_PROJECTS, loadProjects().filter((x) => x.id !== id))
}

export function parseProjectFile(text: string): SmProject {
  const p = JSON.parse(text) as SmProject
  if (!p || p.v !== 1 || typeof p.zipPath !== 'string' || !Array.isArray(p.tracks)) throw new Error('Not a Session Maker project')
  return { ...p, id: uid(), updatedAt: Date.now() }
}

// ─── Playback / rendering ────────────────────────────────────────────────────

type BufferFor = (takeId: string) => AudioBuffer | undefined

function audibleTracks(p: SmProject): SmTrack[] {
  const anySolo = p.tracks.some((t) => t.solo)
  return p.tracks.filter((t) => !t.muted && (!anySolo || t.solo))
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

/** Schedules one clip into `dest`: timeline time `from` lands at context time
 *  `at`, and nothing past timeline time `until` plays (a loop's end). */
function scheduleClip(ctx: BaseAudioContext, dest: AudioNode, clip: SmClip, buffer: AudioBuffer, from: number, at: number, until = Infinity): AudioBufferSourceNode | null {
  if (clip.muted || clip.length <= 0) return null
  const u0 = Math.max(0, from - clip.start)
  const uEnd = Math.min(clip.length, until - clip.start, buffer.duration - clip.offset)
  if (uEnd <= u0) return null
  const base = at + (clip.start - from) // context time of the clip's u=0
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const g = ctx.createGain()
  const gainAt = (u: number): number => {
    let k = clip.gain
    if (clip.fadeIn > 0 && u < clip.fadeIn) k *= u / clip.fadeIn
    if (clip.fadeOut > 0 && u > clip.length - clip.fadeOut) k *= Math.max(0, (clip.length - u) / clip.fadeOut)
    return k
  }
  g.gain.setValueAtTime(gainAt(u0), base + u0)
  if (clip.fadeIn > 0 && u0 < clip.fadeIn) g.gain.linearRampToValueAtTime(clip.gain, base + Math.min(clip.fadeIn, uEnd))
  if (clip.fadeOut > 0 && uEnd > clip.length - clip.fadeOut) {
    const a = clip.length - clip.fadeOut
    if (u0 < a) g.gain.setValueAtTime(clip.gain, base + a)
    g.gain.linearRampToValueAtTime(gainAt(uEnd), base + uEnd)
  }
  // Cut short by a loop end: a 5 ms ramp so the wrap doesn't click.
  if (uEnd < clip.length && uEnd - u0 > 0.01) {
    g.gain.setValueAtTime(gainAt(uEnd - 0.005), base + uEnd - 0.005)
    g.gain.linearRampToValueAtTime(0, base + uEnd)
  }
  // Swipe-comp silences: their own gain stage, crossfading COMP_XF across each edge.
  const spans = silentSpans(clip)
  if (spans.length) {
    const h = COMP_XF / 2
    const level = (u: number): number => {
      let k = 1
      for (const [a, b] of spans) {
        const down = a <= 0 ? 0 : clamp01((a + h - u) / COMP_XF)
        const up = b >= clip.length ? 0 : clamp01((u - (b - h)) / COMP_XF)
        k = Math.min(k, Math.max(down, up))
      }
      return k
    }
    const sg = ctx.createGain()
    sg.gain.setValueAtTime(level(u0), base + u0)
    for (const [a, b] of spans) {
      const ramps: [number, number, number][] = []
      if (a > 0) ramps.push([a - h, a + h, 0])
      if (b < clip.length) ramps.push([b - h, b + h, 1])
      for (const [t1, t2, v] of ramps) {
        if (t2 <= u0 || t1 >= uEnd) continue
        if (t1 > u0) sg.gain.setValueAtTime(1 - v, base + t1)
        sg.gain.linearRampToValueAtTime(v, base + t2)
      }
    }
    src.connect(sg).connect(g).connect(dest)
  } else {
    src.connect(g).connect(dest)
  }
  src.start(Math.max(at, base + u0), clip.offset + u0, uEnd - u0)
  return src
}

export interface LoopRange { start: number; end: number }
export interface Reference { buffer: AudioBuffer; offset: number }
export type AB = 'mix' | 'ref'

/** The reference bounce as a clip: `offset` is where it starts on the timeline (negative skips into it). */
function referenceClip(r: Reference): SmClip {
  const into = Math.max(0, -r.offset)
  return { id: 'ref', takeId: 'ref', start: Math.max(0, r.offset), offset: into, length: r.buffer.duration - into, gain: 1, fadeIn: 0, fadeOut: 0 }
}

export class SessionEngine {
  private sources = new Set<AudioBufferSourceNode>()
  private trackGains = new Map<string, GainNode>()
  private trackPans = new Map<string, StereoPannerNode>()
  private master: GainNode | null = null
  private mixBus: GainNode | null = null
  private refBus: GainNode | null = null
  private startedAt = 0
  private startedFrom = 0
  private loop: LoopRange | null = null
  private nextLoopAt = 0
  private pump: ReturnType<typeof setInterval> | null = null
  private ab: AB = 'mix'
  private preview: AudioBufferSourceNode | null = null
  private previewBuf: AudioBuffer | null = null
  private previewOut: GainNode | null = null
  private previewMeter: AnalyserNode | null = null
  private previewStartedAt = 0
  private previewFrom = 0
  private previewOnEnd: (() => void) | null = null
  private previewVol = 1
  previewLooping = false
  playing = false

  position(): number {
    if (!this.playing) return this.startedFrom
    const t = this.startedFrom + Math.max(0, audioContext().currentTime - this.startedAt)
    const l = this.loop
    if (l && t >= l.end) return l.start + ((t - l.end) % (l.end - l.start))
    return t
  }

  play(p: SmProject, from: number, bufferFor: BufferFor, opts: { loop?: LoopRange | null; reference?: Reference | null } = {}): void {
    this.stopSources()
    const ctx = audioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    this.master = ctx.createGain()
    this.master.connect(ctx.destination)
    const mixBus = (this.mixBus = ctx.createGain())
    mixBus.connect(this.master)
    const refBus = (this.refBus = ctx.createGain())
    refBus.connect(this.master)
    for (const t of p.tracks) {
      const tg = ctx.createGain()
      const pan = ctx.createStereoPanner()
      tg.connect(pan).connect(mixBus)
      this.trackGains.set(t.id, tg)
      this.trackPans.set(t.id, pan)
    }
    const ref = opts.reference ?? null
    const segment = (segFrom: number, until: number, at: number): void => {
      for (const t of p.tracks) {
        const tg = this.trackGains.get(t.id)
        if (!tg) continue
        for (const c of t.clips) {
          const b = bufferFor(c.takeId)
          if (b) this.track(scheduleClip(ctx, tg, c, b, segFrom, at, until))
        }
      }
      if (ref) this.track(scheduleClip(ctx, refBus, referenceClip(ref), ref.buffer, segFrom, at, until))
    }

    const at = ctx.currentTime + 0.06
    const l = opts.loop && opts.loop.end - opts.loop.start > 0.05 && from < opts.loop.end ? opts.loop : null
    this.loop = l
    if (l) {
      segment(from, l.end, at)
      // Keep ~1.5 s of loop passes scheduled ahead, so the wrap is sample-tight.
      this.nextLoopAt = at + (l.end - from)
      const fill = (): void => {
        while (this.nextLoopAt - ctx.currentTime < 1.5) {
          segment(l.start, l.end, this.nextLoopAt)
          this.nextLoopAt += l.end - l.start
        }
      }
      fill()
      this.pump = setInterval(fill, 250)
    } else {
      segment(from, Infinity, at)
    }
    this.startedAt = at
    this.startedFrom = from
    this.playing = true
    this.applyMix(p)
  }

  private track(s: AudioBufferSourceNode | null): void {
    if (!s) return
    this.sources.add(s)
    s.onended = () => { this.sources.delete(s); s.disconnect() }
  }

  /** Volume/mute/solo changes without restarting playback. */
  applyMix(p: SmProject): void {
    if (this.master) this.master.gain.value = p.masterGain
    const audible = new Set(audibleTracks(p).map((t) => t.id))
    for (const t of p.tracks) {
      const g = this.trackGains.get(t.id)
      if (g) g.gain.value = audible.has(t.id) ? t.gain : 0
      const pan = this.trackPans.get(t.id)
      if (pan) pan.pan.value = t.pan ?? 0
    }
    this.setAB(this.ab, true)
  }

  /** Flips between the arrangement and the reference bounce, in sync. */
  setAB(ab: AB, instant = false): void {
    this.ab = ab
    const now = audioContext().currentTime
    for (const [bus, on] of [[this.mixBus, ab === 'mix'], [this.refBus, ab === 'ref']] as const) {
      if (!bus) continue
      bus.gain.cancelScheduledValues(now)
      // A short crossfade: an instant gain jump clicks.
      if (instant) bus.gain.setValueAtTime(on ? 1 : 0, now)
      else bus.gain.setTargetAtTime(on ? 1 : 0, now, 0.01)
    }
  }

  pause(): void {
    this.startedFrom = this.position()
    this.stopSources()
    this.playing = false
  }

  seek(t: number): void {
    this.startedFrom = Math.max(0, t)
  }

  private stopSources(): void {
    if (this.pump) { clearInterval(this.pump); this.pump = null }
    for (const s of this.sources) { s.onended = null; try { s.stop() } catch {} s.disconnect() }
    this.sources.clear()
    for (const g of this.trackGains.values()) g.disconnect()
    this.trackGains.clear()
    for (const pan of this.trackPans.values()) pan.disconnect()
    this.trackPans.clear()
    for (const n of [this.mixBus, this.refBus, this.master]) n?.disconnect()
    this.mixBus = this.refBus = this.master = null
    this.loop = null
  }

  /** Plays a take on its own, outside the arrangement. Pause/seek/loop keep the buffer around. */
  playPreview(buffer: AudioBuffer, onEnd: () => void, from = 0): void {
    this.stopPreview()
    this.previewBuf = buffer
    this.previewOnEnd = onEnd
    this.startPreview(from)
  }

  private startPreview(from: number): void {
    const buffer = this.previewBuf
    if (!buffer) return
    this.haltPreviewSource()
    const ctx = audioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    if (!this.previewOut) {
      this.previewOut = ctx.createGain()
      this.previewMeter = ctx.createAnalyser()
      this.previewMeter.fftSize = 64
      this.previewMeter.smoothingTimeConstant = 0.7
      this.previewOut.connect(this.previewMeter)
      this.previewMeter.connect(ctx.destination)
    }
    this.previewOut.gain.value = this.previewVol
    const at = Math.max(0, Math.min(from, buffer.duration - 0.01))
    const s = ctx.createBufferSource()
    s.buffer = buffer
    s.loop = this.previewLooping
    s.connect(this.previewOut)
    s.onended = () => {
      if (this.preview !== s) return
      this.preview = null
      this.previewFrom = 0
      this.previewOnEnd?.()
    }
    s.start(0, at)
    this.preview = s
    this.previewFrom = at
    this.previewStartedAt = ctx.currentTime
  }

  private haltPreviewSource(): void {
    const s = this.preview
    this.preview = null
    if (s) { try { s.stop() } catch {} s.disconnect() }
  }

  get previewActive(): boolean { return !!this.previewBuf }
  get previewPlaying(): boolean { return !!this.preview }
  get previewDuration(): number { return this.previewBuf?.duration ?? 0 }

  previewPosition(): number {
    const d = this.previewDuration
    if (!this.preview || !d) return this.previewFrom
    const t = this.previewFrom + (audioContext().currentTime - this.previewStartedAt)
    return this.previewLooping ? t % d : Math.min(t, d)
  }

  pausePreview(): void {
    if (!this.preview) return
    const t = this.previewPosition()
    this.haltPreviewSource()
    this.previewFrom = t
  }

  resumePreview(): void {
    if (this.previewBuf && !this.preview) this.startPreview(this.previewFrom >= this.previewDuration - 0.02 ? 0 : this.previewFrom)
  }

  seekPreview(t: number): void {
    const to = Math.max(0, Math.min(t, this.previewDuration))
    if (this.preview) this.startPreview(to)
    else this.previewFrom = to
  }

  setPreviewLoop(on: boolean): void {
    this.previewLooping = on
    if (this.preview) this.startPreview(this.previewPosition())
  }

  setPreviewVolume(v: number): void {
    this.previewVol = v
    if (this.previewOut) this.previewOut.gain.value = v
  }

  /** Fills `out` with the preview's spectrum (0-255); all zeros when nothing is sounding. */
  previewLevels(out: Uint8Array<ArrayBuffer>): void {
    if (this.preview && this.previewMeter) this.previewMeter.getByteFrequencyData(out)
    else out.fill(0)
  }

  stopPreview(): void {
    this.haltPreviewSource()
    this.previewBuf = null
    this.previewOnEnd = null
    this.previewFrom = 0
  }

  dispose(): void {
    this.stopSources()
    this.stopPreview()
    this.playing = false
  }
}

export async function renderProject(p: SmProject, bufferFor: BufferFor, sampleRate = 48000): Promise<AudioBuffer> {
  const end = projectEnd(p)
  if (end <= 0) throw new Error('Nothing to export - the timeline is empty')
  const ctx = new OfflineAudioContext(2, Math.ceil((end + 0.25) * sampleRate), sampleRate)
  const master = ctx.createGain()
  master.gain.value = p.masterGain
  master.connect(ctx.destination)
  const audible = new Set(audibleTracks(p).map((t) => t.id))
  for (const t of p.tracks) {
    if (!audible.has(t.id)) continue
    const tg = ctx.createGain()
    tg.gain.value = t.gain
    const pan = ctx.createStereoPanner()
    pan.pan.value = t.pan ?? 0
    tg.connect(pan).connect(master)
    for (const c of t.clips) {
      const b = bufferFor(c.takeId)
      if (b) scheduleClip(ctx, tg, c, b, 0, 0)
    }
  }
  return ctx.startRendering()
}

// ─── Reference alignment ─────────────────────────────────────────────────────
// Lines the original bounce up with the arrangement. The bounce contains the
// very same beat audio, so the waveforms themselves are matched: both are
// rendered to mono, cross-correlated at 1 kHz with phase-transform weighting
// (GCC-PHAT - every frequency counts equally, so mastering EQ and the vocals
// the arrangement doesn't have barely move the peak), then refined at 8 kHz
// around that lag. Tested against repeating 4-bar loops, where envelope
// matching kept landing a loop off.

const ALIGN_SR = 8000
/** Coarse pass runs at ALIGN_SR / ALIGN_DECIMATE. */
const ALIGN_DECIMATE = 8
/** The best peak must beat every other lag (outside ±50 ms) by this much to count as a clear match. */
const ALIGN_CLEAR_RATIO = 4

async function toMono(buffer: AudioBuffer, sampleRate: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil(buffer.duration * sampleRate)), sampleRate)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.connect(ctx.destination)
  src.start()
  return (await ctx.startRendering()).getChannelData(0)
}

/** Box-filter decimation: crude, but the coarse pass only needs the lows. */
function decimate(x: Float32Array, f: number): Float32Array {
  const out = new Float32Array(Math.floor(x.length / f))
  for (let i = 0; i < out.length; i++) {
    let sum = 0
    for (let j = i * f, end = j + f; j < end; j++) sum += x[j]
    out[i] = sum / f
  }
  return out
}

/** In-place radix-2 FFT; `inverse` leaves the result unscaled. */
function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr; im[b] = im[a] - ti
        re[a] += tr; im[a] += ti
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
    }
  }
}

/** The k in (-a.length, b.length) maximising the phase-transform cross-correlation
 *  of a[i] with b[i+k], and how many times the next best lag (outside ±50 ms) it is. */
function bestLag(a: Float32Array, b: Float32Array, sampleRate: number): { lag: number; ratio: number } {
  let n = 1
  while (n < a.length + b.length) n <<= 1
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n)
  ar.set(a); br.set(b)
  fft(ar, ai); fft(br, bi)
  // conj(A)·B, normalised to unit magnitude
  for (let i = 0; i < n; i++) {
    const r = ar[i] * br[i] + ai[i] * bi[i], im = ar[i] * bi[i] - ai[i] * br[i]
    const m = Math.hypot(r, im) + 1e-12
    ar[i] = r / m; ai[i] = im / m
  }
  fft(ar, ai, true)
  let best = -Infinity, lag = 0
  for (let k = -(a.length - 1); k < b.length; k++) {
    const v = ar[(k + n) % n]
    if (v > best) { best = v; lag = k }
  }
  const gap = Math.round(0.05 * sampleRate)
  let second = -Infinity
  for (let k = -(a.length - 1); k < b.length; k++) {
    if (Math.abs(k - lag) > gap) second = Math.max(second, ar[(k + n) % n])
  }
  return { lag, ratio: second > 0 ? best / second : Infinity }
}

/** Best sample lag of `b` against `a` within lag ± radius, by direct correlation of their first differences. */
function refineLag(a: Float32Array, b: Float32Array, lag: number, radius: number): number {
  const da = new Float32Array(a.length), db = new Float32Array(b.length)
  for (let i = 1; i < a.length; i++) da[i] = a[i] - a[i - 1]
  for (let i = 1; i < b.length; i++) db[i] = b[i] - b[i - 1]
  // The overlap at the rough lag, capped to 30 s around its middle.
  const lo = Math.max(radius, -lag + radius), hi = Math.min(a.length - radius, b.length - lag - radius)
  if (hi - lo < ALIGN_SR) return lag
  const span = Math.min(hi - lo, 30 * ALIGN_SR)
  const s0 = lo + Math.floor((hi - lo - span) / 2), s1 = s0 + span
  let best = -Infinity, out = lag
  for (let k = lag - radius; k <= lag + radius; k++) {
    let v = 0
    for (let i = s0; i < s1; i++) v += da[i] * db[i + k]
    if (v > best) { best = v; out = k }
  }
  return out
}

export interface Alignment {
  /** Where the original should start on the timeline, seconds. */
  offset: number
  /** True when the match stands well clear of every other candidate. */
  confident: boolean
}

/** Finds where `reference` lines up with the arrangement. Every track is heard
 *  (mute and solo are listening state); muted clips stay out, as they're comp choices. */
export async function alignReference(p: SmProject, bufferFor: BufferFor, reference: AudioBuffer): Promise<Alignment | null> {
  const all = { ...p, masterGain: 1, tracks: p.tracks.map((t) => ({ ...t, muted: false, solo: false })) }
  if (!all.tracks.some((t) => t.clips.some((c) => !c.muted && bufferFor(c.takeId)))) return null
  const stereo = await renderProject(all, bufferFor, ALIGN_SR)
  const mix = new Float32Array(stereo.length)
  for (let c = 0; c < stereo.numberOfChannels; c++) {
    const d = stereo.getChannelData(c)
    for (let i = 0; i < d.length; i++) mix[i] += d[i] / stereo.numberOfChannels
  }
  const ref = await toMono(reference, ALIGN_SR)
  const rough = bestLag(decimate(ref, ALIGN_DECIMATE), decimate(mix, ALIGN_DECIMATE), ALIGN_SR / ALIGN_DECIMATE)
  const lag = refineLag(ref, mix, rough.lag * ALIGN_DECIMATE, 2 * ALIGN_DECIMATE)
  // ref[i] lines up with mix[i + lag], and the mix starts at timeline 0.
  return { offset: lag / ALIGN_SR, confident: rough.ratio >= ALIGN_CLEAR_RATIO }
}

// ─── Tempo and bar 1 ─────────────────────────────────────────────────────────
// Studio beats run at one fixed tempo, so a single grid fits the whole file. A
// comb over 30 s of the beat picks the tempo, then one over the whole file pins
// tempo and phase (a tenth of a BPM off drifts ~100 ms over a song). Bar 1 is
// the first beat at the first hit - beats are bounced from the downbeat, and
// when that's wrong "Bar 1 at playhead" fixes it.

/** 5 ms frames at ALIGN_SR. */
const TEMPO_HOP = 40
const TEMPO_WIN = 4 * TEMPO_HOP
const FRAME_SEC = TEMPO_HOP / ALIGN_SR
/** A frame's rise means a hit about here in its window: the energy jumps as the hit enters it. */
const ONSET_LAG = (TEMPO_WIN - TEMPO_HOP / 2) / ALIGN_SR
/** Half- and double-time read the same, so this picks the double-time one trap beats are made at. */
const TEMPO_MIN = 90, TEMPO_MAX = 180
/** How well (vs the best grid) a grid through the first hit must fit for that hit to be taken as bar 1. */
const BAR1_FIT = 0.7

/** Rise in log energy of the first difference, in 20 ms windows 5 ms apart: peaks at hits. */
function onsetStrength(x: Float32Array): Float32Array {
  const n = Math.max(0, Math.floor((x.length - TEMPO_WIN) / TEMPO_HOP))
  const sq = (i: number): number => { const d = i > 0 ? x[i] - x[i - 1] : 0; return d * d }
  let e = 0
  for (let i = 0; i < TEMPO_WIN; i++) e += sq(i)
  const out = new Float32Array(n)
  let prev = Math.log(1 + 1000 * e)
  for (let f = 1; f < n; f++) {
    for (let i = (f - 1) * TEMPO_HOP, end = i + TEMPO_HOP; i < end; i++) e += sq(i + TEMPO_WIN) - sq(i)
    const l = Math.log(1 + 1000 * Math.max(0, e))
    out[f] = Math.max(0, l - prev)
    prev = l
  }
  // A little smoothing so beat positions rounded to a frame still land on the peak.
  const sm = new Float32Array(n)
  for (let f = 0; f < n; f++) sm[f] = 0.25 * (out[f - 1] ?? 0) + 0.5 * out[f] + 0.25 * (out[f + 1] ?? 0)
  return sm
}

/** Mean onset strength on beats every `period` frames from `phase`, over env[from, to). */
function combAt(env: Float32Array, period: number, phase: number, from: number, to: number): number {
  let s = 0, k = 0
  for (let t = from + phase; t < to; t += period, k++) s += env[Math.round(t)] ?? 0
  return k ? s / k : 0
}

/** Beats score, and so do the 8ths between them - that's what tells the real
 *  tempo from one that lands on every third 8th. */
function gridScore(env: Float32Array, period: number, phase: number, from = 0, to = env.length): number {
  to = Math.min(to, env.length - 1)
  return combAt(env, period, phase, from, to) + 0.5 * combAt(env, period, phase + period / 2, from, to)
}

/** Best phase for `bpm` over env[from, to). */
function fitTempo(env: Float32Array, bpm: number, from = 0, to = env.length): { phase: number; score: number } {
  const period = 60 / bpm / FRAME_SEC
  let best = -Infinity, phase = 0
  for (let p = 0; p < period; p++) {
    const s = gridScore(env, period, p, from, to)
    if (s > best) { best = s; phase = p }
  }
  return { phase, score: best }
}

export interface TempoGuess {
  bpm: number
  /** Where bar 1 beat 1 falls in the audio, seconds. */
  bar1: number
}

/** Tempo and where bar 1 starts, from a beat (or any steady-tempo audio). */
export async function detectTempo(buffer: AudioBuffer): Promise<TempoGuess | null> {
  // A window of silence in front, so a hit at the very start rises into a window like every other one.
  const mono = await toMono(buffer, ALIGN_SR)
  const padded = new Float32Array(mono.length + TEMPO_WIN)
  padded.set(mono, TEMPO_WIN)
  const env = onsetStrength(padded)
  if (env.length * FRAME_SEC < 8) return null
  // Rough: 30 s from the middle, in 0.1 BPM steps - coarser lets an in-between
  // tempo drift off its own hits and lose to a triplet relative.
  const span = Math.min(env.length, Math.round(30 / FRAME_SEC))
  const from = Math.floor((env.length - span) / 2)
  let bpm = TEMPO_MIN, best = { phase: 0, score: -Infinity }
  for (let b = TEMPO_MIN; b < TEMPO_MAX; b += 0.1) {
    const f = fitTempo(env, b, from, from + span)
    if (f.score > best.score) { best = f; bpm = b }
  }
  if (best.score <= 0) return null
  // Then over the whole file: 0.02 BPM steps, then 0.002.
  best = fitTempo(env, bpm)
  for (const [range, step] of [[0.3, 0.02], [0.02, 0.002]]) {
    const centre = bpm
    for (let b = centre - range; b <= centre + range + 1e-9; b += step) {
      const f = fitTempo(env, b)
      if (f.score > best.score) { best = f; bpm = b }
    }
  }
  // Producers set whole (or half) BPMs: prefer one when it fits about as well.
  for (const round of [Math.round(bpm), Math.round(bpm * 2) / 2]) {
    const f = fitTempo(env, round)
    if (Math.abs(round - bpm) < 0.01 || f.score >= best.score * 0.98) { bpm = round; best = f; break }
  }
  bpm = Math.round(bpm * 1000) / 1000
  const period = 60 / bpm / FRAME_SEC
  // First hit: the first frame reaching a third of the loud hits' strength.
  const sorted = Float32Array.from(env).sort()
  const loud = sorted[Math.floor(sorted.length * 0.995)]
  const first = Math.max(0, env.findIndex((v) => v >= loud / 3))
  // Bar 1 on the first hit, as long as a grid through it fits nearly as well as
  // the best one - the best can sit on the offbeats when the 8ths hit hardest.
  // Otherwise (a pickup before the downbeat), the first grid beat at or after it.
  // The first frame over the threshold is the hit's rising edge; its peak is a frame or two on.
  let peak = first, peakScore = -Infinity
  for (let f = Math.max(0, first - 3); f <= first + 3; f++) {
    const sc = gridScore(env, period, f % period)
    if (sc > peakScore) { peakScore = sc; peak = f }
  }
  const bar1 = peakScore >= best.score * BAR1_FIT
    ? peak
    : best.phase + Math.ceil((first - period / 4 - best.phase) / period) * period
  return { bpm, bar1: Math.max(0, bar1 * FRAME_SEC + ONSET_LAG - TEMPO_WIN / ALIGN_SR) }
}

/** Highest absolute sample over every channel - above 1 the WAV clips. */
export function peakOf(buffer: AudioBuffer): number {
  let peak = 0
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c)
    for (let i = 0; i < d.length; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > peak) peak = v }
  }
  return peak
}

/** Scales every channel in place. */
export function scaleBuffer(buffer: AudioBuffer, k: number): void {
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c)
    for (let i = 0; i < d.length; i++) d[i] *= k
  }
}

/** 24-bit PCM WAV - the takes are 24-bit, so this doesn't throw resolution away. */
export function encodeWav(buffer: AudioBuffer): Blob {
  const ch = buffer.numberOfChannels, sr = buffer.sampleRate, n = buffer.length
  const bytesPer = 3
  const dataLen = n * ch * bytesPer
  const out = new ArrayBuffer(44 + dataLen)
  const v = new DataView(out)
  const str = (o: number, s: string): void => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true)
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * bytesPer, true); v.setUint16(32, ch * bytesPer, true); v.setUint16(34, 24, true)
  str(36, 'data'); v.setUint32(40, dataLen, true)
  const chans = Array.from({ length: ch }, (_, c) => buffer.getChannelData(c))
  let o = 44
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]))
      const x = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff)
      v.setUint8(o, x & 0xff); v.setUint8(o + 1, (x >> 8) & 0xff); v.setUint8(o + 2, (x >> 16) & 0xff)
      o += 3
    }
  }
  return new Blob([out], { type: 'audio/wav' })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function formatTime(sec: number): string {
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`
}
