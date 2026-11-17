// Lines a music video's sound up with the song, so WRLD can show the video in
// time with the audio that's actually playing. Videos rarely run the song
// straight: Lean Wit Me's plays 23 s of intro, the song, then a 33 s skit in the
// middle before the song picks up again. So the match is made piece by piece:
// every 6 s of the song is looked for anywhere in the video, by the rhythm of
// its onsets (drums and syllables survive a different mix or a voice-over),
// and the result is a list of spans, each with its own offset into the video.
import { buildStreamUrl } from './juicewrldApi'
import { routeUrl } from './apiServers'
import { ls } from './persist'
import { createSharedFlight } from './sharedFlight'
import type { SyncSpan, VideoSync } from './videoFollow'

/** Decoding rate: plenty for onsets, and small enough to keep a five-minute song in a few MB. */
export const SYNC_RATE = 10240
const COARSE_HOP = 512 // 50 ms
const FINE = 4 // fine hop = 12.5 ms
const WIN = 240 // 12 s of coarse frames
const STEP = 120 // 6 s
/** How strong a window's best match must be (mean product of z-scored onsets) and how far above the usual. */
const MIN_PEAK = 0.3
const MIN_RATIO = 5
/** Share of the song that must be found before the video is worth showing at all. */
const MIN_COVERED = 0.4
/** What a window scores for "not in the video", and what moving to another offset costs. */
const NONE_FIT = MIN_PEAK * 0.8
const SWITCH = 0.5
/** Spans shorter than this fold into the one before: a cut that brief is the boundary search wobbling. */
const MIN_SPAN = 1.5

// The spans and reading them live in videoFollow, which the cleared desk's curtain uses without the API client.
export { videoTimeAt, type SyncSpan, type VideoSync } from './videoFollow'

/** Onset strength per hop: how sharply the (high-passed) loudness rises, z-scored. */
export function onsetEnvelope(x: Float32Array, hop: number): Float32Array {
  const n = Math.floor(x.length / hop)
  const out = new Float32Array(n)
  let prev = 0
  for (let i = 0; i < n; i++) {
    let sum = 0
    const o = i * hop
    for (let j = 1; j < hop; j++) { const d = x[o + j] - x[o + j - 1]; sum += d * d }
    const e = Math.log1p(1000 * Math.sqrt(sum / (hop - 1)))
    out[i] = i === 0 ? 0 : Math.max(0, e - prev)
    prev = e
  }
  let mean = 0
  for (let i = 0; i < n; i++) mean += out[i]
  mean /= n || 1
  let v = 0
  for (let i = 0; i < n; i++) { out[i] -= mean; v += out[i] * out[i] }
  const sd = Math.sqrt(v / (n || 1)) || 1
  for (let i = 0; i < n; i++) out[i] /= sd
  return out
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/** The spans for a song's and a video's audio at SYNC_RATE, or null when the video doesn't hold the song. */
export async function alignAudio(song: Float32Array, video: Float32Array, signal?: AbortSignal): Promise<VideoSync | null> {
  const es = onsetEnvelope(song, COARSE_HOP)
  const ev = onsetEnvelope(video, COARSE_HOP)
  if (es.length < WIN || ev.length < WIN) return null
  const lagsOf = ev.length - WIN + 1

  // Every window's match at every offset, kept to weigh the chosen offsets against later.
  const starts: number[] = []
  for (let a = 0; a + WIN <= es.length; a += STEP) starts.push(a)
  if (es.length - (starts[starts.length - 1] + WIN) > STEP / 2) starts.push(es.length - WIN)
  const corr: Float32Array[] = []
  const best: { lag: number; peak: number; strong: boolean }[] = []
  const w = new Float32Array(WIN)
  for (const a of starts) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    let m = 0
    for (let j = 0; j < WIN; j++) m += es[a + j]
    m /= WIN
    let sd = 0
    for (let j = 0; j < WIN; j++) { w[j] = es[a + j] - m; sd += w[j] * w[j] }
    sd = Math.sqrt(sd / WIN) || 1
    for (let j = 0; j < WIN; j++) w[j] /= sd
    const c = new Float32Array(lagsOf)
    let k0 = 0
    for (let k = 0; k < lagsOf; k++) {
      let s = 0
      for (let j = 0; j < WIN; j++) s += w[j] * ev[k + j]
      c[k] = s / WIN
      if (c[k] > c[k0]) k0 = k
    }
    // The usual level, from a sample of the offsets.
    const sample: number[] = []
    for (let k = 0; k < lagsOf; k += 5) sample.push(Math.abs(c[k]))
    sample.sort((x, y) => x - y)
    const median = sample[sample.length >> 1] || 1e-9
    corr.push(c)
    best.push({ lag: k0 - a, peak: c[k0], strong: c[k0] >= MIN_PEAK && c[k0] / median >= MIN_RATIO })
    await tick()
  }

  // Offsets two neighbouring windows agree on are real; a lone one is usually the song's intro found in the outro.
  const candidates: number[] = []
  best.forEach((b, i) => {
    if (!b.strong) return
    const agrees = [best[i - 1], best[i + 1]].some((n) => n?.strong && Math.abs(n.lag - b.lag) <= 2)
    if (agrees && !candidates.some((c) => Math.abs(c - b.lag) <= 2)) candidates.push(b.lag)
  })
  if (!candidates.length) return null

  // Each window takes one of the agreed offsets, or none. A chorus is often in the video twice, so a window can fit a
  // later copy as well as the right one; the video would jump there and back. Changing offset therefore costs, and is
  // only worth it where the match stays better for a while (a skit cut in, a verse left out).
  const at = (i: number, lag: number): number => {
    let v = 0
    for (let d = -2; d <= 2; d++) {
      const k = Math.min(lagsOf - 1, Math.max(0, starts[i] + lag + d))
      v = Math.max(v, corr[i][k])
    }
    return v
  }
  const states: (number | null)[] = [null, ...candidates]
  const fit = (i: number, s: number | null): number => (s === null ? NONE_FIT : at(i, s))
  let score = states.map((s) => fit(0, s))
  const from: number[][] = []
  for (let i = 1; i < starts.length; i++) {
    const back: number[] = []
    score = states.map((s, j) => {
      let bestK = j
      let bestV = score[j]
      score.forEach((v, k) => { if (k !== j && v - SWITCH > bestV) { bestV = v - SWITCH; bestK = k } })
      back.push(bestK)
      return bestV + fit(i, s)
    })
    from.push(back)
  }
  let state = score.indexOf(Math.max(...score))
  const pick: (number | null)[] = new Array(starts.length)
  for (let i = starts.length - 1; i >= 0; i--) {
    pick[i] = states[state]
    if (i > 0) state = from[i - 1][state]
  }
  const covered = pick.filter((p) => p !== null).length / pick.length
  if (covered < MIN_COVERED || pick.filter((p) => p !== null).length < 3) return null

  // Each offset to 12.5 ms, over the windows that took it.
  const fs = onsetEnvelope(song, COARSE_HOP / FINE)
  const fv = onsetEnvelope(video, COARSE_HOP / FINE)
  const fine = new Map<number, number>()
  for (const lag of candidates) {
    const wins = starts.filter((_, i) => pick[i] === lag)
    if (!wins.length) continue
    let bestD = 0
    let bestS = -Infinity
    for (let d = -3 * FINE; d <= 3 * FINE; d++) {
      let s = 0
      for (const a of wins) {
        for (let t = a * FINE; t < (a + WIN) * FINE && t < fs.length; t++) {
          const u = t + lag * FINE + d
          if (u >= 0 && u < fv.length) s += fs[t] * fv[u]
        }
      }
      if (s > bestS) { bestS = s; bestD = d }
    }
    fine.set(lag, lag * FINE + bestD)
    await tick()
  }

  // Where one span hands over to the next, to the fine hop: the cut that keeps the most matching onsets on each side.
  const spans: { at: number; lag: number | null }[] = [{ at: 0, lag: pick[0] === null ? null : fine.get(pick[0])! }]
  for (let i = 0; i + 1 < pick.length; i++) {
    if (pick[i] === pick[i + 1]) continue
    const A = pick[i] === null ? null : fine.get(pick[i]!)!
    const B = pick[i + 1] === null ? null : fine.get(pick[i + 1]!)!
    const from = starts[i] * FINE
    const to = Math.min(fs.length, (starts[i + 1] + WIN) * FINE)
    const prod = (t: number, L: number | null): number => {
      if (L === null) return 0
      const u = t + L
      return u >= 0 && u < fv.length ? fs[t] * fv[u] : -1
    }
    // score(x) = Σ[from,x) A + Σ[x,to) B = const + Σ[from,x) (A - B)
    let run = 0
    let bestRun = 0
    let cut = from
    for (let t = from; t < to; t++) {
      run += prod(t, A) - prod(t, B)
      if (run > bestRun) { bestRun = run; cut = t + 1 }
    }
    spans.push({ at: cut, lag: B })
  }
  const hop = COARSE_HOP / FINE / SYNC_RATE
  const secs = (v: number): number => Math.round(v * hop * 1000) / 1000
  const out: SyncSpan[] = []
  spans.forEach((s, i) => {
    const span = { at: secs(s.at), lag: s.lag === null ? null : secs(s.lag) }
    const end = i + 1 < spans.length ? secs(spans[i + 1].at) : Infinity
    // The first span always starts at 0; a short one hands its time to the next instead.
    if (end - span.at < MIN_SPAN && i + 1 < spans.length) { if (!out.length) spans[i + 1].at = 0; return }
    if (out.length && out[out.length - 1].lag === span.lag) return
    out.push(out.length ? span : { ...span, at: 0 })
  })
  return { spans: out, covered: Math.round(covered * 100) / 100 }
}

async function decodeMono(url: string, signal?: AbortSignal): Promise<Float32Array> {
  let res: Response | null = null
  // The server cuts only a couple of these at once and answers 429 beyond that.
  for (let attempt = 0; attempt < 6; attempt++) {
    res = await fetch(url, { signal })
    if (res.status !== 429) break
    await new Promise((r) => setTimeout(r, 3000 + attempt * 2000))
  }
  if (!res || !res.ok) throw new Error(`Audio for syncing failed (${res?.status ?? 'no answer'})`)
  const buf = await res.arrayBuffer()
  const audio = await new OfflineAudioContext(1, 1, SYNC_RATE).decodeAudioData(buf)
  const out = new Float32Array(audio.length)
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const ch = audio.getChannelData(c)
    for (let i = 0; i < ch.length; i++) out[i] += ch[i] / audio.numberOfChannels
  }
  return out
}

/** A video's sound alone, as a small MP3 the server cuts from it. */
export function videoAudioUrl(path: string): string {
  return `${routeUrl('/files/download-compressed/')}?path=${encodeURIComponent(path)}&bitrate=64k`
}

const ALIGN_VERSION = 1
const cacheKey = (videoPath: string, songPath: string): string => `mvSync${ALIGN_VERSION}:${videoPath}|${songPath}`
// One line-up per video and song. Callers bring their own abort signal, which
// must not cancel the job: WRLD remounts (fullscreen, leaving the view) drop
// the old wait and join again a moment later, and the cleared desk waits on
// the same line-up. A signal aborts only that wait (see sharedFlight).
const flights = createSharedFlight<VideoSync | null>()
let forceSerial = 0

/** A sync already worked out on this device: the spans, null for "doesn't hold the song", undefined when never tried. */
export function cachedVideoSync(videoPath: string, songPath: string): VideoSync | null | undefined {
  const hit = ls.get<{ sync: VideoSync | null }>(cacheKey(videoPath, songPath))
  return hit && typeof hit === 'object' && 'sync' in hit ? hit.sync : undefined
}

export function forgetVideoSync(videoPath: string, songPath: string): void {
  ls.remove(cacheKey(videoPath, songPath))
}

/** Lines the video at `videoPath` up with the song file at `songPath` (both in the primary channel), once per device:
 *  the result, a match or not, is kept. Downloads the song (a few MB) and the video's sound as a 64k MP3. */
export function alignMusicVideo(videoPath: string, songPath: string, opts: { signal?: AbortSignal; force?: boolean } = {}): Promise<VideoSync | null> {
  const key = cacheKey(videoPath, songPath)
  if (!opts.force) {
    const hit = cachedVideoSync(videoPath, songPath)
    if (hit !== undefined) return Promise.resolve(hit)
  }
  // A forced redo does its own pass. It still must not be the abort signal of
  // whoever else is already waiting on the pass that's in flight.
  const flightKey = opts.force ? `${key}\0${++forceSerial}` : key
  return flights.join(flightKey, async (signal) => {
    const [song, video] = await Promise.all([
      decodeMono(buildStreamUrl(songPath), signal),
      decodeMono(videoAudioUrl(videoPath), signal),
    ])
    const sync = await alignAudio(song, video, signal)
    ls.set(key, { sync })
    return sync
  }, opts.signal)
}
