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
import { openRemoteZip, readEntry, readEntryHeads, type RemoteZip, type ZipEntry } from './remoteZip'

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
  const zip = await openRemoteZip(buildStreamUrl(zipPath), signal)
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
}

export interface SmTrack {
  id: string
  name: string
  gain: number
  muted: boolean
  solo: boolean
  clips: SmClip[]
  /** The beat lane is left out of comping. Older projects only have the name. */
  role?: 'beat'
}

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
  for (let i = 1; i <= 3; i++) tracks.push({ id: uid(), name: `Vocals ${i}`, gain: 1, muted: false, solo: false, clips: [] })
  const now = Date.now()
  const ref = defaultReference(session)
  return {
    v: 1, id: uid(), name, zipPath: session.zipPath, bpm: session.bpm, gridOffset: beat?.position ?? 0, masterGain: 1, tracks,
    loop: null, reference: ref ? { takeId: ref.id, offset: 0 } : null, createdAt: now, updatedAt: now,
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
      const overlap = Math.min(e, c.start + c.length) - Math.max(s, c.start)
      if (c.id === clipId || overlap > Math.min(0.5, (c.length + target.length) / 4)) out.push(c)
    }
  }
  return out
}

/** Makes `clipId` the only take heard over its stretch: its alternates are muted, it's unmuted. */
export function compTo(p: SmProject, clipId: string): SmProject {
  const alts = new Set(alternatesOf(p, clipId).map((c) => c.id))
  return {
    ...p,
    tracks: p.tracks.map((t) => (t.clips.some((c) => alts.has(c.id))
      ? { ...t, clips: t.clips.map((c) => (alts.has(c.id) ? { ...c, muted: c.id !== clipId } : c)) }
      : t)),
  }
}

export function projectEnd(p: SmProject): number {
  let end = 0
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.length)
  return end
}

/** Every take placed at its recorded position, packed onto as few lanes as don't overlap. */
export function placeAllTakes(project: SmProject, session: ScannedSession): SmProject {
  const placed = new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.takeId)))
  const todo = session.takes.filter((t) => t.kind === 'take' && t.position != null && t.duration && !placed.has(t.id))
  if (!todo.length) return project
  const tracks = project.tracks.map((t) => ({ ...t, clips: [...t.clips] }))
  const lanes = tracks.filter((t) => !isBeatTrack(t))
  const fits = (t: SmTrack, s: number, e: number): boolean => t.clips.every((c) => c.start >= e - 1e-3 || c.start + c.length <= s + 1e-3)
  for (const take of todo) {
    const s = take.position!, e = s + take.duration!
    let lane = lanes.find((t) => fits(t, s, e))
    if (!lane) {
      lane = { id: uid(), name: `Vocals ${lanes.length + 1}`, gain: 1, muted: false, solo: false, clips: [] }
      lanes.push(lane)
      tracks.push(lane)
    }
    lane.clips.push({ id: uid(), takeId: take.id, start: s, offset: 0, length: take.duration!, gain: 1, fadeIn: 0, fadeOut: 0 })
  }
  return { ...project, tracks }
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
  src.connect(g).connect(dest)
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
      tg.connect(mixBus)
      this.trackGains.set(t.id, tg)
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
    for (const n of [this.mixBus, this.refBus, this.master]) n?.disconnect()
    this.mixBus = this.refBus = this.master = null
    this.loop = null
  }

  playPreview(buffer: AudioBuffer, onEnd: () => void): void {
    this.stopPreview()
    const ctx = audioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const s = ctx.createBufferSource()
    s.buffer = buffer
    s.connect(ctx.destination)
    s.onended = () => { if (this.preview === s) { this.preview = null; onEnd() } }
    s.start()
    this.preview = s
  }

  stopPreview(): void {
    const s = this.preview
    this.preview = null
    if (s) { try { s.stop() } catch {} s.disconnect() }
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
    tg.connect(master)
    for (const c of t.clips) {
      const b = bufferFor(c.takeId)
      if (b) scheduleClip(ctx, tg, c, b, 0, 0)
    }
  }
  return ctx.startRendering()
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
