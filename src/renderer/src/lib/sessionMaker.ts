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
import { vstApi, type PluginRef } from './vstPlugins'

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
  if (!(zipApi() && sessionFolder())) return cachedSessions()
  // Sessions downloaded before folder mode still live in the cache (and still open from it).
  const inFolder = (await folderZips()).map(({ zipPath, size }) => ({ zipPath, size }))
  const seen = new Set(inFolder.map((d) => d.zipPath))
  return [...inFolder, ...(await cachedSessions()).filter((d) => !seen.has(d.zipPath))]
}

async function cachedSessions(): Promise<DownloadedSession[]> {
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
  /** Where in the take the clip begins, take seconds. */
  offset: number
  /** How long it lasts on the timeline, seconds. It covers `length * speed` of the take. */
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
  /** Plays backwards. `offset` and `silent` are then in the backwards take's time,
   *  so trimming, splitting and comping treat it like any other clip. */
  reversed?: boolean
  /** Playback speed: 0.5 plays at half speed, twice as long. Missing is 1. */
  speed?: number
  /** Hold the pitch while the speed changes (time-stretch) instead of letting it
   *  follow like tape (sped up / slowed). */
  keepPitch?: boolean
  /** Pitch shift in semitones, on top of whatever the speed does. Missing is 0. */
  pitch?: number
}

export const FX_KEYS = ['reverb', 'echo', 'chorus'] as const
export type FxKey = (typeof FX_KEYS)[number]
export type TrackFx = Partial<Record<FxKey, number>>
export const FX_LABELS: Record<FxKey, string> = { reverb: 'Reverb', echo: 'Echo', chorus: 'Chorus' }

/** A lane's own processing, in signal order. Each is 0 (off) to 1. */
export const CHAIN_KEYS = ['lowCut', 'comp', 'presence', 'air', 'lofi'] as const
export type ChainKey = (typeof CHAIN_KEYS)[number]
export type TrackChain = Partial<Record<ChainKey, number>>
export const CHAIN_LABELS: Record<ChainKey, string> = { lowCut: 'Low cut', comp: 'Comp', presence: 'Presence', air: 'Air', lofi: 'Lo-fi' }

/** Echo repeat lengths, in beats. */
export const ECHO_NOTES = { '1/4': 1, '1/8.': 0.75, '1/8': 0.5, '1/16': 0.25 } as const
export type EchoNote = keyof typeof ECHO_NOTES
export const DEFAULT_ECHO_NOTE: EchoNote = '1/8.'
export const REVERB_SIZES = { small: { seconds: 0.9, preDelay: 0.01 }, medium: { seconds: 1.7, preDelay: 0.02 }, large: { seconds: 2.8, preDelay: 0.03 } } as const
export type ReverbSize = keyof typeof REVERB_SIZES
export const DEFAULT_REVERB_SIZE: ReverbSize = 'large'

export interface SmTrack {
  id: string
  name: string
  gain: number
  /** -1 (left) to 1 (right); missing is centre. */
  pan?: number
  /** Effect sends, 0 (none) to 1. Missing is dry. */
  fx?: TrackFx
  /** Low cut, compressor, EQ and lo-fi on the lane itself. Missing is untouched. */
  chain?: TrackChain
  /** VST3 plug-ins on the lane, in order, ahead of its own chain (desktop app only). */
  plugins?: SmPlugin[]
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
  /** The shared echo's repeat at the project tempo. Missing is a dotted eighth. */
  echoNote?: EchoNote
  /** The shared reverb's size. Missing is large. */
  reverbSize?: ReverbSize
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

/** The clip and its lane. */
function locateClip(p: SmProject, clipId: string): { clip: SmClip; track: SmTrack } | null {
  for (const t of p.tracks) { const clip = t.clips.find((c) => c.id === clipId); if (clip) return { clip, track: t } }
  return null
}

/** Lanes whose clips can be takes of the same part as one on `lane`: those in the
 *  same take folder (or, for a lane in none, the others in none). Doubles, stacks
 *  and ad-libs kept outside the folder are never comped against its takes. */
const compsWith = (lane: SmTrack) => (t: SmTrack): boolean => !isBeatTrack(t) && (t.folder ?? null) === (lane.folder ?? null)

/** Clips on the vocal lanes covering the same stretch as `clipId` (it included), in lane order. */
export function alternatesOf(p: SmProject, clipId: string): SmClip[] {
  const found = locateClip(p, clipId)
  if (!found) return []
  const target = found.clip
  const s = target.start, e = target.start + target.length
  const out: SmClip[] = []
  for (const t of p.tracks.filter(compsWith(found.track))) {
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
    .map(([a, b]): Span => [Math.max(0, (a - c.offset) / clipSpeed(c)), Math.min(c.length, (b - c.offset) / clipSpeed(c))])
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
 *  clips inside it - those may be ad-libs. Only ever clips in the same folder. */
function swipeRivals(p: SmProject, clipId: string): Set<string> {
  const out = new Set(alternatesOf(p, clipId).map((c) => c.id))
  const found = locateClip(p, clipId)
  if (!found) return out
  const target = found.clip
  for (const t of p.tracks.filter(compsWith(found.track))) {
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
  const takeSpan = (c: SmClip): Span => [takeTime(c, Math.max(c.start, from)), takeTime(c, Math.min(c.start + c.length, to))]
  const settle = (c: SmClip, silent: Span[]): SmClip => {
    const { silent: _, ...rest } = c
    const end = takeTime(c, c.start + c.length)
    const inside = normSpans(silent.map(([a, b]): Span => [Math.max(a, c.offset), Math.min(b, end)]))
    if (inside.length === 1 && inside[0][0] <= c.offset + 1e-6 && inside[0][1] >= end - 1e-6) return { ...rest, muted: true }
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
            const base: Span[] = c.muted ? [[c.offset, takeTime(c, c.start + c.length)]] : c.silent ?? []
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

/** Saves a copy of the project under a fresh id and an unused "<name> copy" name, and returns it. */
export function duplicateProject(p: SmProject): SmProject {
  const taken = new Set(loadProjects().map((x) => x.name))
  const base = `${p.name.replace(/ copy(?: \d+)?$/, '')} copy`
  let name = base
  for (let i = 2; taken.has(name); i++) name = `${base} ${i}`
  const now = Date.now()
  const copy: SmProject = { ...structuredClone(p), id: uid(), name, createdAt: now, updatedAt: now }
  saveProject(copy)
  return copy
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
function scheduleClip(ctx: BaseAudioContext, dest: AudioNode, clip: SmClip, audio: ClipAudio, from: number, at: number, until = Infinity): AudioBufferSourceNode | null {
  if (clip.muted || clip.length <= 0) return null
  const { buffer, rate, stretch } = audio
  const origin = audio.origin ?? 0
  const speed = clipSpeed(clip)
  const u0 = Math.max(0, from - clip.start)
  const uEnd = Math.min(clip.length, until - clip.start, ((origin + buffer.duration) * stretch - clip.offset) / speed)
  if (uEnd <= u0) return null
  const base = at + (clip.start - from) // context time of the clip's u=0
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.playbackRate.value = rate
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
  // Offset and duration are in the buffer's own seconds: a stretched buffer runs `stretch` take seconds to each of its own,
  // and a plug-in run's buffer only holds the part of it from `origin` on.
  src.start(Math.max(at, base + u0), Math.max(0, (clip.offset + u0 * speed) / stretch - origin), ((uEnd - u0) * speed) / stretch)
  return src
}

// ─── Effects ─────────────────────────────────────────────────────────────────
// Each lane runs through its own chain (low cut → compressor → presence → air →
// lo-fi), then its pan, then feeds three shared send effects through its own
// send gains. The returns join the lanes at `out`, ahead of the mix limiter -
// so the A/B reference switch mutes them with the rest of the arrangement.
//
// Chromium's compressor delays what passes through it by a fixed look-ahead.
// Every lane always has one (left transparent when its knob is off), and the
// reference goes through as many transparent ones as the mix has stages, so
// nothing drifts out of time.

/** How long the effects ring on after the last clip ends: the reverb's longest
 *  tail, or the echo's repeats dying away (~40 dB over 5½ repeats at its feedback). */
const fxTail = (p: SmProject): number => Math.max(3.5, 5.5 * echoSeconds(p))

export const fxActive = (p: SmProject): boolean => p.tracks.some((t) => FX_KEYS.some((k) => (t.fx?.[k] ?? 0) > 0))

/** The echo's repeat in seconds: its note at the project tempo, or 375 ms with no tempo. */
export function echoSeconds(p: Pick<SmProject, 'bpm' | 'echoNote'>): number {
  if (!p.bpm) return 0.375
  return Math.min(1.9, (60 / p.bpm) * ECHO_NOTES[p.echoNote ?? DEFAULT_ECHO_NOTE])
}

/** A noise burst with a decaying envelope - a convolution reverb without shipping an IR file. */
function impulseResponse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate
  const length = Math.max(1, Math.floor(rate * seconds))
  const buf = ctx.createBuffer(2, length, rate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5)
  }
  return buf
}

interface FxBuses { inputs: Record<FxKey, GainNode>; set: (p: SmProject) => void; dispose: () => void }

function buildFxBuses(ctx: BaseAudioContext, out: AudioNode, p: SmProject): FxBuses {
  const nodes: AudioNode[] = []
  const lfos: OscillatorNode[] = []
  const make = <T extends AudioNode>(n: T): T => { nodes.push(n); return n }

  // Reverb: a short pre-delay keeps consonants clear of the wash. A size change swaps the convolver.
  const reverbIn = make(ctx.createGain())
  const pre = make(ctx.createDelay(0.1))
  const reverbOut = make(ctx.createGain())
  reverbOut.gain.value = 0.9
  reverbIn.connect(pre)
  reverbOut.connect(out)
  let convolver: ConvolverNode | null = null
  let size: ReverbSize | null = null
  const setReverb = (s: ReverbSize): void => {
    if (s === size) return
    size = s
    const next = ctx.createConvolver()
    next.buffer = impulseResponse(ctx, REVERB_SIZES[s].seconds)
    pre.delayTime.value = REVERB_SIZES[s].preDelay
    pre.connect(next).connect(reverbOut)
    if (convolver) { pre.disconnect(convolver); convolver.disconnect() }
    convolver = next
  }

  // Echo: feedback delay, repeats rolled off so they sit behind the original.
  const echoIn = make(ctx.createGain())
  const delay = make(ctx.createDelay(2))
  const feedback = make(ctx.createGain())
  feedback.gain.value = 0.42
  const tone = make(ctx.createBiquadFilter())
  tone.type = 'lowpass'
  tone.frequency.value = 4200
  echoIn.connect(delay).connect(tone)
  tone.connect(feedback).connect(delay)
  tone.connect(out)
  let echo = echoSeconds(p)
  delay.delayTime.value = echo

  // Chorus: two short delays swept by slow LFOs, panned apart.
  const chorusIn = make(ctx.createGain())
  for (const v of [{ base: 0.022, rate: 0.6, pan: -0.7 }, { base: 0.031, rate: 0.9, pan: 0.7 }]) {
    const d = make(ctx.createDelay(0.1))
    d.delayTime.value = v.base
    const lfo = ctx.createOscillator()
    lfo.frequency.value = v.rate
    const depth = make(ctx.createGain())
    depth.gain.value = 0.004
    lfo.connect(depth).connect(d.delayTime)
    lfo.start()
    lfos.push(lfo)
    const pn = make(ctx.createStereoPanner())
    pn.pan.value = v.pan
    chorusIn.connect(d).connect(pn).connect(out)
  }

  const set = (q: SmProject): void => {
    setReverb(q.reverbSize ?? DEFAULT_REVERB_SIZE)
    const e = echoSeconds(q)
    // Glides to a new time rather than jumping, which would click.
    if (e !== echo) { echo = e; delay.delayTime.setTargetAtTime(e, ctx.currentTime, 0.03) }
  }
  set(p)

  return {
    inputs: { reverb: reverbIn, echo: echoIn, chorus: chorusIn },
    set,
    dispose: () => {
      for (const l of lfos) { try { l.stop() } catch {} l.disconnect() }
      for (const n of nodes) n.disconnect()
      convolver?.disconnect()
    },
  }
}

/** How hard a send drives its effect: a full-scale send is a strong, still musical amount. */
const FX_DRIVE: Record<FxKey, number> = { reverb: 0.9, echo: 0.7, chorus: 0.7 }

const dbToGain = (db: number): number => 10 ** (db / 20)

/** The make-up gain a DynamicsCompressorNode adds by itself, dB (the Web Audio spec's
 *  (1 / full-range gain)^0.6, with the knee left out). */
const autoMakeupDb = (threshold: number, ratio: number): number => 0.6 * -threshold * (1 - 1 / ratio)

/** Where a lane's compressor holds the level: a vocal at this level comes out as loud as it went in. */
const COMP_ANCHOR_DB = -14

const lowCutHz = (v: number): number => 40 * (300 / 40) ** v
const compCurve = (v: number): { threshold: number; ratio: number } => ({ threshold: -10 - 20 * v, ratio: 1 + 5 * v })
/** Presence (a bell at 3.5 kHz) and air (a shelf from 10 kHz) at full. */
const EQ_MAX_DB = 8

/** What a chain knob is set to, in its own units. */
export function chainReadout(k: ChainKey, v: number): string {
  if (v <= 0) return 'off'
  switch (k) {
    case 'lowCut': return `${Math.round(lowCutHz(v))} Hz`
    case 'comp': return `${compCurve(v).ratio.toFixed(1)}:1`
    case 'presence': case 'air': return `+${(EQ_MAX_DB * v).toFixed(1)} dB`
    case 'lofi': return `${Math.round(v * 100)}%`
  }
}

export const chainActive = (c: TrackChain | undefined): boolean => !!c && CHAIN_KEYS.some((k) => (c[k] ?? 0) > 0)

/** A soft-clipping curve for the lo-fi drive; quieter overall the harder it's pushed, as the band-pass thins it out. */
function driveCurve(v: number): Float32Array<ArrayBuffer> {
  const k = 1 + 3 * v
  const n = 1024
  const curve = new Float32Array(n)
  const norm = Math.tanh(k) * Math.sqrt(k)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(k * x) / norm
  }
  return curve
}

interface LaneChain { input: AudioNode; output: AudioNode; set: (c: TrackChain | undefined) => void; dispose: () => void }

/** A lane's own processing. Every stage idles transparently at 0, so it can be adjusted live. */
function buildChain(ctx: BaseAudioContext): LaneChain {
  const lowCut = ctx.createBiquadFilter()
  lowCut.type = 'highpass'
  const comp = ctx.createDynamicsCompressor()
  comp.knee.value = 6
  comp.attack.value = 0.004
  comp.release.value = 0.18
  const compTrim = ctx.createGain()
  const presence = ctx.createBiquadFilter()
  presence.type = 'peaking'
  presence.frequency.value = 3500
  presence.Q.value = 0.9
  const air = ctx.createBiquadFilter()
  air.type = 'highshelf'
  air.frequency.value = 10000
  const lofiHp = ctx.createBiquadFilter()
  lofiHp.type = 'highpass'
  const lofiLp = ctx.createBiquadFilter()
  lofiLp.type = 'lowpass'
  const shaper = ctx.createWaveShaper()
  shaper.oversample = '2x'
  const nodes = [lowCut, comp, compTrim, presence, air, lofiHp, lofiLp, shaper]
  lowCut.connect(comp).connect(compTrim).connect(presence).connect(air).connect(lofiHp).connect(lofiLp).connect(shaper)
  let lofi = -1
  const set = (c: TrackChain | undefined): void => {
    const v = (k: ChainKey): number => clamp01(c?.[k] ?? 0)
    lowCut.frequency.value = v('lowCut') > 0 ? lowCutHz(v('lowCut')) : 10
    if (v('comp') > 0) {
      const { threshold, ratio } = compCurve(v('comp'))
      comp.knee.value = 6
      comp.threshold.value = threshold
      comp.ratio.value = ratio
      // Take the compressor's own make-up back off, then level it so a vocal at COMP_ANCHOR_DB comes out unchanged.
      const out = COMP_ANCHOR_DB <= threshold ? COMP_ANCHOR_DB : threshold + (COMP_ANCHOR_DB - threshold) / ratio
      compTrim.gain.value = dbToGain(COMP_ANCHOR_DB - out - autoMakeupDb(threshold, ratio))
    } else {
      // Ratio 1 with no knee is a straight line: the compressor passes audio untouched (just delayed).
      comp.knee.value = 0
      comp.threshold.value = 0
      comp.ratio.value = 1
      compTrim.gain.value = 1
    }
    presence.gain.value = EQ_MAX_DB * v('presence')
    air.gain.value = EQ_MAX_DB * v('air')
    const l = v('lofi')
    lofiHp.frequency.value = 20 * 25 ** l
    lofiLp.frequency.value = 20000 / 7 ** l
    if (l !== lofi) { lofi = l; shaper.curve = l > 0 ? driveCurve(l) : null }
  }
  return { input: lowCut, output: shaper, set, dispose: () => { for (const n of nodes) n.disconnect() } }
}

/** A compressor that leaves the audio alone - only its look-ahead delay, to keep a path in time with one that compresses. */
function latencyStage(ctx: BaseAudioContext): DynamicsCompressorNode {
  const c = ctx.createDynamicsCompressor()
  c.knee.value = 0
  c.threshold.value = 0
  c.ratio.value = 1
  return c
}

const LIMIT_DB = -1.5
const LIMIT_RATIO = 20

/** Catches overs on the mix: a fast, hard compressor just under full scale, its own make-up taken back off. */
function buildLimiter(ctx: BaseAudioContext): { input: AudioNode; output: AudioNode; dispose: () => void } {
  const l = ctx.createDynamicsCompressor()
  l.threshold.value = LIMIT_DB
  l.knee.value = 0
  l.ratio.value = LIMIT_RATIO
  l.attack.value = 0.001
  l.release.value = 0.12
  const trim = ctx.createGain()
  trim.gain.value = dbToGain(-autoMakeupDb(LIMIT_DB, LIMIT_RATIO))
  l.connect(trim)
  return { input: l, output: trim, dispose: () => { l.disconnect(); trim.disconnect() } }
}

/** Compressor stages the mix passes through: a lane's chain and the limiter. */
const MIX_LATENCY_STAGES = 2

// ─── Reverse ─────────────────────────────────────────────────────────────────

const reversedBuffers = new WeakMap<AudioBuffer, AudioBuffer>()
const reversedPeakArrays = new WeakMap<Float32Array, Float32Array>()

/** The take played backwards, made once per buffer. */
export function reversedBuffer(b: AudioBuffer): AudioBuffer {
  let r = reversedBuffers.get(b)
  if (!r) {
    r = new AudioBuffer({ numberOfChannels: b.numberOfChannels, length: b.length, sampleRate: b.sampleRate })
    for (let ch = 0; ch < b.numberOfChannels; ch++) {
      const src = b.getChannelData(ch), dst = r.getChannelData(ch)
      for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i]
    }
    reversedBuffers.set(b, r)
  }
  return r
}

/** A take's waveform peaks, backwards - what a reversed clip draws. */
export function reversedPeaks(p: Float32Array): Float32Array {
  let r = reversedPeakArrays.get(p)
  if (!r) { r = p.slice().reverse(); reversedPeakArrays.set(p, r) }
  return r
}

/** The take a clip reads: as recorded, or backwards when it's reversed. */
function clipSource(c: SmClip, bufferFor: BufferFor): AudioBuffer | undefined {
  const b = bufferFor(c.takeId)
  return b && c.reversed ? reversedBuffer(b) : b
}

/** Flips a clip between forwards and backwards over the same stretch of its take
 *  (`takeLength` seconds long), keeping its comp silences on the same audio. */
export function reverseClip(c: SmClip, takeLength: number): SmClip {
  const { reversed, silent, ...rest } = c
  const flipped = silent?.map(([a, b]): [number, number] => [takeLength - b, takeLength - a]).reverse()
  return {
    ...rest,
    offset: Math.max(0, takeLength - c.offset - c.length * clipSpeed(c)),
    ...(flipped?.length ? { silent: flipped } : {}),
    ...(reversed ? {} : { reversed: true }),
  }
}

// ─── Pitch and speed ─────────────────────────────────────────────────────────
// A clip reads its take at `rate` (the source's playbackRate), so speed and pitch
// move together like tape. When the pitch has to move differently from the
// speed - held while the speed changes, or shifted on its own - the take is first
// time-stretched by `stretch`, then read at `rate`. Stretching runs in the
// background once per take and amount; the clip is silent until it's ready.

export const MIN_SPEED = 0.25
export const MAX_SPEED = 4
export const MAX_PITCH = 24

export const clipSpeed = (c: SmClip): number => c.speed ?? 1

/** How fast the take is read: the pitch shift, times the speed unless the pitch is held. */
export const clipRate = (c: SmClip): number => 2 ** ((c.pitch ?? 0) / 12) * (c.keepPitch ? 1 : clipSpeed(c))

/** The time-stretch the take needs before it's read at clipRate (1 = none). Rounded, so near-equal settings share one. */
export const clipStretch = (c: SmClip): number => Math.round((clipSpeed(c) / clipRate(c)) * 1e4) / 1e4

/** Where timeline time `t` falls in the clip's take, seconds. */
export const takeTime = (c: SmClip, t: number): number => c.offset + (t - c.start) * clipSpeed(c)

/** The buffer a clip plays, how fast it's read, and how many take seconds each of its seconds holds.
 *  `origin` is where the buffer starts in the (stretched) take, seconds - a plug-in run only
 *  holds the part of the take its clips use. Missing is 0. */
interface ClipAudio { buffer: AudioBuffer; rate: number; stretch: number; origin?: number }

/** What a clip plays from right now - nothing while its stretch is still being made, and
 *  dry while its lane's plug-ins are still running over it. */
function clipAudio(c: SmClip, bufferFor: BufferFor, fx: LaneFx | null = null): ClipAudio | undefined {
  const src = clipSource(c, bufferFor)
  if (!src) return undefined
  const stretch = clipStretch(c)
  const buffer = stretch === 1 ? src : stretchEntry(src, stretch).buffer
  if (!buffer) return undefined
  if (fx && !c.muted) {
    const run = pluginRun(buffer, fx, clipSpan(c, buffer))
    if (run.buffer) return { buffer: run.buffer, rate: clipRate(c), stretch, origin: run.from / buffer.sampleRate }
  }
  return { buffer, rate: clipRate(c), stretch }
}

export type ClipAudioState = { stage: 'ready' | 'stretching' | 'plugins' } | { stage: 'failed'; error: string }

/** Where a clip's audio is: still being stretched, still going through its lane's plug-ins,
 *  stuck on a plug-in that failed, or ready. Asking starts whatever's missing. */
export function clipAudioState(c: SmClip, take: AudioBuffer, fx: LaneFx | null): ClipAudioState {
  const src = c.reversed ? reversedBuffer(take) : take
  const stretch = clipStretch(c)
  const buffer = stretch === 1 ? src : stretchEntry(src, stretch).buffer
  if (!buffer) return { stage: 'stretching' }
  if (!fx || c.muted) return { stage: 'ready' }
  const run = pluginRun(buffer, fx, clipSpan(c, buffer))
  return run.error ? { stage: 'failed', error: run.error } : run.buffer ? { stage: 'ready' } : { stage: 'plugins' }
}

/** Waits for every stretch and plug-in run the heard clips need - an export can't leave
 *  anything silent or dry. A plug-in that fails stops the export, named. */
async function prepareAll(p: SmProject, bufferFor: BufferFor): Promise<void> {
  const audible = new Set(audibleTracks(p).map((t) => t.id))
  await Promise.all(p.tracks.filter((t) => audible.has(t.id)).flatMap((t) => {
    const fx = laneFx(t, p.bpm)
    return t.clips.map(async (c) => {
      const src = c.muted ? undefined : clipSource(c, bufferFor)
      if (!src) return
      const buffer = clipStretch(c) === 1 ? src : await stretchEntry(src, clipStretch(c)).promise
      if (!fx) return
      const run = pluginRun(buffer, fx, clipSpan(c, buffer))
      await run.promise.catch(() => { throw new Error(`${t.name}: ${run.error ?? 'a plug-in failed'}`) })
    })
  }))
}

/** Changes a clip's speed or pitch. It keeps its start and the same stretch of take,
 *  so it grows or shrinks on the timeline, its fades with it. */
export function retimeClip(c: SmClip, patch: { speed?: number; pitch?: number; keepPitch?: boolean }): SmClip {
  const { speed: _s, pitch: _p, keepPitch: _k, ...rest } = c
  const speed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, patch.speed ?? clipSpeed(c)))
  const pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, patch.pitch ?? c.pitch ?? 0))
  const keepPitch = patch.keepPitch ?? c.keepPitch ?? false
  const scale = clipSpeed(c) / speed
  return {
    ...rest,
    length: c.length * scale,
    fadeIn: c.fadeIn * scale,
    fadeOut: c.fadeOut * scale,
    ...(speed !== 1 ? { speed } : {}),
    ...(pitch !== 0 ? { pitch } : {}),
    ...(keepPitch ? { keepPitch } : {}),
  }
}

interface StretchEntry { promise: Promise<AudioBuffer>; buffer?: AudioBuffer }
const stretches = new WeakMap<AudioBuffer, Map<number, StretchEntry>>()
/** Finished stretches kept per take; trying out settings shouldn't hold every one in memory. */
const STRETCHES_KEPT = 6
const stretchListeners = new Set<() => void>()
let stretchVer = 0
/** One stretch at a time, so a burst of them doesn't starve playback. */
let stretchQueue: Promise<unknown> = Promise.resolve()

/** Bumps each time a stretch or a plug-in run finishes (or fails). */
export const stretchVersion = (): number => stretchVer
export function subscribeStretches(fn: () => void): () => void {
  stretchListeners.add(fn)
  return () => { stretchListeners.delete(fn) }
}
function audioChanged(): void {
  stretchVer++
  for (const fn of stretchListeners) fn()
}

/** The take stretched by `stretch`, started on first ask. */
function stretchEntry(src: AudioBuffer, stretch: number): StretchEntry {
  let byAmount = stretches.get(src)
  if (!byAmount) { byAmount = new Map(); stretches.set(src, byAmount) }
  const have = byAmount.get(stretch)
  if (have) return have
  const job = stretchQueue.then(() => timeStretch(src, stretch))
  stretchQueue = job.catch(() => {})
  const entry: StretchEntry = { promise: job }
  const all = byAmount
  job.then((buf) => {
    entry.buffer = buf
    // Oldest finished ones go first.
    for (const [k, e] of all) { if (all.size <= STRETCHES_KEPT) break; if (e.buffer && e !== entry) all.delete(k) }
    audioChanged()
  }, () => { all.delete(stretch) })
  all.set(stretch, entry)
  return entry
}

/** WSOLA time-stretch: the result is 1/`tempo` as long, at the same pitch. 40 ms windows,
 *  half-overlapped, each slid up to 12 ms from where it would fall so its waveform
 *  carries on from the window before - which keeps a voice clean. */
async function timeStretch(b: AudioBuffer, tempo: number): Promise<AudioBuffer> {
  const sr = b.sampleRate, len = b.length, chs = b.numberOfChannels
  const N = 2 * Math.round(sr * 0.02)
  const H = N / 2
  const search = Math.round(sr * 0.012)
  // The coarse search runs on a mono copy at ~6 kHz; the pick is refined at full rate.
  const D = Math.max(1, Math.round(sr / 6000))
  const inp = Array.from({ length: chs }, (_, c) => b.getChannelData(c))
  const mono = new Float32Array(Math.ceil(len / D))
  for (const ch of inp) for (let i = 0; i < len; i++) mono[(i / D) | 0] += ch[i]
  const L = Math.floor(H / D)
  const outLen = Math.max(1, Math.ceil(len / tempo))
  const out = new AudioBuffer({ numberOfChannels: chs, length: outLen, sampleRate: sr })
  const outs = Array.from({ length: chs }, (_, c) => out.getChannelData(c))
  // A periodic Hann window: half-overlapped copies sum to exactly 1.
  const win = new Float32Array(N)
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)
  const x = inp[0]
  let prev = -N
  // Starts half a window early, so the opening isn't faded in by an unpartnered window.
  for (let o = -H, k = 0; o < outLen; o += H, k++) {
    // The first window reads the opening as is; the rest slide to line up.
    let pos = k === 0 ? o : Math.round(o * tempo)
    const nat = prev + H
    const n0 = Math.round(nat / D)
    const lo = Math.max(0, Math.round((pos - search) / D))
    const hi = Math.min(mono.length - L - 1, Math.round((pos + search) / D))
    if (k > 0 && nat >= 0 && nat + H <= len && n0 + L <= mono.length && hi >= lo) {
      // Coarse: normalised cross-correlation against the natural continuation of the last window.
      let energy = 0
      for (let j = 0; j < L; j++) energy += mono[lo + j] ** 2
      let best = lo, bestScore = -Infinity
      for (let q = lo; q <= hi; q++) {
        let dot = 0
        for (let j = 0; j < L; j++) dot += mono[n0 + j] * mono[q + j]
        const score = dot / Math.sqrt(energy + 1e-9)
        if (score > bestScore) { bestScore = score; best = q }
        energy += mono[q + L] ** 2 - mono[q] ** 2
      }
      // Fine: full rate, around the coarse pick.
      const c0 = best * D
      let fineScore = -Infinity
      pos = c0
      for (let q = Math.max(0, c0 - D); q <= Math.min(len - H, c0 + D); q++) {
        let dot = 0
        for (let j = 0; j < H; j += 2) dot += x[nat + j] * x[q + j]
        if (dot > fineScore) { fineScore = dot; pos = q }
      }
    }
    for (let c = 0; c < chs; c++) {
      const src = inp[c], dst = outs[c]
      const j0 = Math.max(0, -o, -pos), j1 = Math.min(N, outLen - o, len - pos)
      for (let j = j0; j < j1; j++) dst[o + j] += src[pos + j] * win[j]
    }
    prev = pos
    // Let the page breathe on long takes.
    if (k % 500 === 499) await new Promise((r) => setTimeout(r, 0))
  }
  return out
}

// ─── VST3 plug-ins ────────────────────────────────────────────────────────────
// Web Audio can't run plug-ins, so in the desktop app a lane's plug-ins run in a native
// helper, offline: the part of each take the lane's clips use goes through its chain
// once, in the background, and the lane plays the result - dry until it's back. New
// settings run it again. Their latency is trimmed off, so nothing drifts against the
// other lanes.

export interface SmPlugin {
  id: string
  /** The .vst3 module, and the effect's class id inside it. */
  path: string
  cid: string
  name: string
  vendor?: string
  /** The plug-in's own settings, base64 - only it can read them. */
  state?: string
  bypass?: boolean
}

/** Which plug-in window belongs to which lane's plug-in. */
export const pluginEditorKey = (trackId: string, pluginId: string): string => `${trackId}:${pluginId}`

/** A lane's plug-ins that are on, as one cache key. */
export interface LaneFx { key: string; chain: PluginRef[]; bpm: number; names: string[] }
const laneFxs = new WeakMap<SmPlugin[], { bpm: number; fx: LaneFx | null }>()

/** The lane's running chain, or null when it has no plug-ins on. Same lane, same object. */
export function laneFx(t: SmTrack, bpm: number | null): LaneFx | null {
  const list = t.plugins
  if (!list?.length) return null
  const b = bpm ?? 120
  const have = laneFxs.get(list)
  if (have && have.bpm === b) return have.fx
  const on = list.filter((pl) => !pl.bypass)
  const chain = on.map((pl) => ({ path: pl.path, cid: pl.cid, state: pl.state ?? '' }))
  const fx = chain.length ? { key: `${hashString(JSON.stringify(chain))}@${b}`, chain, bpm: b, names: on.map((pl) => pl.name) } : null
  laneFxs.set(list, { bpm: b, fx })
  return fx
}

/** Two 32-bit FNV-style hashes side by side - enough to tell plug-in settings apart. */
function hashString(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x9747b28c ^ s.length
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 ^ c, 0x5bd1e995)
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)
}

/** Part of one (stretched) take through one chain: its frames `from` to `to`. */
interface PluginRun {
  key: string
  from: number
  to: number
  /** Handed to the helper - its span is fixed from then on. */
  started: boolean
  promise: Promise<AudioBuffer>
  buffer?: AudioBuffer
  error?: string
  /** When it was last asked for, to keep the settings in use. */
  used: number
}
const pluginRuns = new WeakMap<AudioBuffer, PluginRun[]>()
/** Settings kept per take: the current ones and the one before, so undo or A/B doesn't re-run. */
const SETTINGS_KEPT = 2
/** Audio fed in ahead of a clip, so the plug-ins have settled by the time it starts. */
const PRE_ROLL = 2
/** Spans widen to whole seconds, so a small trim doesn't need a new run. */
const SPAN_GRID = 1
let runClock = 0
/** One run at a time - each is a stretch of take through a whole chain. */
let pluginQueue: Promise<unknown> = Promise.resolve()

/** The frames of its (stretched) take a clip reads, with pre-roll, widened to the grid. */
function clipSpan(c: SmClip, src: AudioBuffer): [number, number] {
  const sr = src.sampleRate, stretch = clipStretch(c)
  const a = Math.floor((c.offset / stretch - PRE_ROLL) / SPAN_GRID) * SPAN_GRID
  const b = Math.ceil((c.offset + c.length * clipSpeed(c)) / stretch / SPAN_GRID) * SPAN_GRID
  const from = Math.max(0, Math.min(src.length - 1, Math.floor(a * sr)))
  return [from, Math.max(from + 1, Math.min(src.length, Math.ceil(b * sr)))]
}

function dropRuns(runs: PluginRun[], gone: (r: PluginRun) => boolean): void {
  for (let i = runs.length - 1; i >= 0; i--) if (gone(runs[i])) runs.splice(i, 1)
}

/** The run that covers frames `from`-`to` of the take through the lane's chain, started
 *  when there's none. Only the stretch of take the lane's clips use is ever run - a new
 *  run covers everything this chain has needed of the take so far, and clips asking
 *  while one is still waiting its turn just widen it. */
function pluginRun(src: AudioBuffer, fx: LaneFx, [from, to]: [number, number]): PluginRun {
  let runs = pluginRuns.get(src)
  if (!runs) { runs = []; pluginRuns.set(src, runs) }
  const all = runs
  const mine = all.filter((r) => r.key === fx.key)
  const covering = mine.filter((r) => r.from <= from && r.to >= to)
  const have = covering.find((r) => r.buffer) ?? covering.find((r) => !r.error) ?? covering[0]
  if (have) { have.used = ++runClock; return have }
  const waiting = mine.find((r) => !r.started)
  if (waiting) {
    waiting.from = Math.min(waiting.from, from)
    waiting.to = Math.max(waiting.to, to)
    waiting.used = ++runClock
    return waiting
  }
  const entry = { key: fx.key, started: false, used: ++runClock } as PluginRun
  entry.from = Math.min(from, ...mine.map((r) => r.from))
  entry.to = Math.max(to, ...mine.map((r) => r.to))
  const job = pluginQueue.then(() => {
    // Settings that moved on again before this run's turn came are skipped.
    if (!all.includes(entry)) throw new Error('Replaced by newer settings')
    entry.started = true
    return runPlugins(src, fx, entry.from, entry.to)
  })
  pluginQueue = job.catch(() => {})
  entry.promise = job
  job.then(
    (buf) => {
      entry.buffer = buf
      // Smaller finished runs this one covers aren't needed any more.
      dropRuns(all, (r) => r !== entry && r.key === entry.key && (!!r.buffer || !!r.error) && r.from >= entry.from && r.to <= entry.to)
      audioChanged()
    },
    (e: Error) => { if (all.includes(entry)) { entry.error = e.message; audioChanged() } },
  )
  all.push(entry)
  // Keep the settings asked for most recently - this one and the one before.
  const lastUse = new Map<string, number>()
  for (const r of all) lastUse.set(r.key, Math.max(lastUse.get(r.key) ?? 0, r.used))
  const keep = new Set([...lastUse.entries()].sort((x, y) => y[1] - x[1]).slice(0, SETTINGS_KEPT).map(([k]) => k))
  dropRuns(all, (r) => !keep.has(r.key))
  return entry
}

async function runPlugins(src: AudioBuffer, fx: LaneFx, from: number, to: number): Promise<AudioBuffer> {
  const api = vstApi()
  if (!api) throw new Error('Plug-ins need the desktop app')
  // Copied out: a view would send the whole channel across.
  const channels = Array.from({ length: Math.min(2, src.numberOfChannels) }, (_, c) => src.getChannelData(c).slice(from, to))
  const res = await api.vstProcess({ sampleRate: src.sampleRate, bpm: fx.bpm, chain: fx.chain, channels })
  if (!res.channels?.length) {
    const who = res.plugin != null ? fx.names[res.plugin] : undefined
    throw new Error(`${who ? `${who}: ` : ''}${res.error ?? 'the plug-ins failed'}`)
  }
  const out = new AudioBuffer({ numberOfChannels: res.channels.length, length: to - from, sampleRate: src.sampleRate })
  res.channels.forEach((ch, c) => out.copyToChannel(ch.subarray(0, to - from), c))
  return out
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
  private trackSends = new Map<string, Record<FxKey, GainNode>>()
  private chains = new Map<string, LaneChain>()
  private fx: FxBuses | null = null
  private master: GainNode | null = null
  private mixBus: GainNode | null = null
  private refBus: GainNode | null = null
  /** The limiter and the reference's latency stages, torn down with the rest. */
  private busNodes: { dispose: () => void }[] = []
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
    // Lanes and effect returns → limiter → A/B switch; the reference → latency stages → A/B switch.
    const mixBus = (this.mixBus = ctx.createGain())
    mixBus.connect(this.master)
    const limiter = buildLimiter(ctx)
    limiter.output.connect(mixBus)
    const refBus = (this.refBus = ctx.createGain())
    refBus.connect(this.master)
    const refIn = ctx.createGain()
    const stages = Array.from({ length: MIX_LATENCY_STAGES }, () => latencyStage(ctx))
    stages.reduce<AudioNode>((n, st) => n.connect(st), refIn).connect(refBus)
    this.busNodes = [limiter, ...[refIn, ...stages].map((n) => ({ dispose: () => n.disconnect() }))]
    const fx = (this.fx = buildFxBuses(ctx, limiter.input, p))
    for (const t of p.tracks) {
      const tg = ctx.createGain()
      const chain = buildChain(ctx)
      const pan = ctx.createStereoPanner()
      tg.connect(chain.input)
      chain.output.connect(pan).connect(limiter.input)
      const sends = {} as Record<FxKey, GainNode>
      for (const k of FX_KEYS) {
        const send = (sends[k] = ctx.createGain())
        send.gain.value = 0
        pan.connect(send).connect(fx.inputs[k])
      }
      this.chains.set(t.id, chain)
      this.trackGains.set(t.id, tg)
      this.trackPans.set(t.id, pan)
      this.trackSends.set(t.id, sends)
    }
    const ref = opts.reference ?? null
    const segment = (segFrom: number, until: number, at: number): void => {
      for (const t of p.tracks) {
        const tg = this.trackGains.get(t.id)
        if (!tg) continue
        const lane = laneFx(t, p.bpm)
        for (const c of t.clips) {
          const a = clipAudio(c, bufferFor, lane)
          if (a) this.track(scheduleClip(ctx, tg, c, a, segFrom, at, until))
        }
      }
      if (ref) this.track(scheduleClip(ctx, refIn, referenceClip(ref), { buffer: ref.buffer, rate: 1, stretch: 1 }, segFrom, at, until))
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

  /** Volume/mute/solo and effect changes without restarting playback. */
  applyMix(p: SmProject): void {
    if (this.master) this.master.gain.value = p.masterGain
    this.fx?.set(p)
    const audible = new Set(audibleTracks(p).map((t) => t.id))
    for (const t of p.tracks) {
      const g = this.trackGains.get(t.id)
      if (g) g.gain.value = audible.has(t.id) ? t.gain : 0
      this.chains.get(t.id)?.set(t.chain)
      const pan = this.trackPans.get(t.id)
      if (pan) pan.pan.value = t.pan ?? 0
      const sends = this.trackSends.get(t.id)
      if (sends) for (const k of FX_KEYS) sends[k].gain.value = clamp01(t.fx?.[k] ?? 0) * FX_DRIVE[k]
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
    for (const sends of this.trackSends.values()) for (const s of Object.values(sends)) s.disconnect()
    this.trackSends.clear()
    for (const c of this.chains.values()) c.dispose()
    this.chains.clear()
    for (const n of this.busNodes) n.dispose()
    this.busNodes = []
    this.fx?.dispose()
    this.fx = null
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
  // Let the reverb/echo tails ring out past the last clip.
  await prepareAll(p, bufferFor)
  const lag = MIX_LATENCY_STAGES * (await compressorLatency(sampleRate))
  const ctx = new OfflineAudioContext(2, Math.ceil((end + (fxActive(p) ? fxTail(p) : 0.25)) * sampleRate) + lag, sampleRate)
  const master = ctx.createGain()
  master.gain.value = p.masterGain
  master.connect(ctx.destination)
  const limiter = buildLimiter(ctx)
  limiter.output.connect(master)
  const fx = buildFxBuses(ctx, limiter.input, p)
  const audible = new Set(audibleTracks(p).map((t) => t.id))
  for (const t of p.tracks) {
    if (!audible.has(t.id)) continue
    const tg = ctx.createGain()
    tg.gain.value = t.gain
    const chain = buildChain(ctx)
    chain.set(t.chain)
    const pan = ctx.createStereoPanner()
    for (const k of FX_KEYS) {
      const amount = clamp01(t.fx?.[k] ?? 0)
      if (amount <= 0) continue
      const send = ctx.createGain()
      send.gain.value = amount * FX_DRIVE[k]
      pan.connect(send).connect(fx.inputs[k])
    }
    pan.pan.value = t.pan ?? 0
    tg.connect(chain.input)
    chain.output.connect(pan).connect(limiter.input)
    const lane = laneFx(t, p.bpm)
    for (const c of t.clips) {
      const a = clipAudio(c, bufferFor, lane)
      if (a) scheduleClip(ctx, tg, c, a, 0, 0)
    }
  }
  const rendered = await ctx.startRendering()
  if (!lag) return rendered
  // Drop the compressors' look-ahead, so the file starts at timeline 0.
  const out = new AudioBuffer({ numberOfChannels: rendered.numberOfChannels, length: rendered.length - lag, sampleRate })
  for (let ch = 0; ch < rendered.numberOfChannels; ch++) out.copyToChannel(rendered.getChannelData(ch).subarray(lag), ch)
  return out
}

const compressorLatencies = new Map<number, Promise<number>>()

/** How many frames a compressor holds audio back by (its look-ahead), measured once per sample rate. */
function compressorLatency(sampleRate: number): Promise<number> {
  let p = compressorLatencies.get(sampleRate)
  if (!p) {
    p = (async () => {
      const ctx = new OfflineAudioContext(1, Math.ceil(sampleRate * 0.1), sampleRate)
      const click = ctx.createBuffer(1, 1, sampleRate)
      click.getChannelData(0)[0] = 0.5
      const src = ctx.createBufferSource()
      src.buffer = click
      src.connect(latencyStage(ctx)).connect(ctx.destination)
      src.start(0)
      const data = (await ctx.startRendering()).getChannelData(0)
      const at = data.findIndex((x) => Math.abs(x) > 1e-3)
      return at < 0 ? 0 : at
    })()
    compressorLatencies.set(sampleRate, p)
  }
  return p
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
