// Hand-tuned timing for a finished sync job. In the Play-along preview (or
// with `lyricsgen timing`) a word or a whole line is moved earlier or later,
// or set to where the audio is, and the LRC downloads are rebuilt from the
// tuned lines in the server's own format. The server keeps its result: the
// changes are a draft kept on this device, per job, until the preview expires.
//
// Starts stay in order. A word can't pass its neighbours, and a line's first
// word can't go before the previous line's last one, or the preview would
// light a line before the one above it had finished.
import type { LyricsGenJob, LyricsOutput, LyricsSegment } from './lyricsGenApi'
import { ls } from './persist'

/** A word of a line, or (`word` null) the whole line. Indexes from 0. */
export interface TimingTarget { line: number; word: number | null }

/** The smallest gap kept between two starts: one LRC centisecond. */
const GAP = 0.01
const DRAFT_KEY = 'lyricsTiming:'
/** Previews expire after 7 days; a draft outlives its job by a day at most. */
const DRAFT_TTL = 8 * 24 * 3600 * 1000

const round = (t: number): number => Math.round(t * 1000) / 1000
const clamp = (t: number, lo: number, hi: number): number => Math.min(Math.max(t, lo), hi)

/** Lines with start times, from the job's segments or, failing that, its LRC. */
export function timedLines(job: LyricsGenJob): LyricsSegment[] {
  const segs = job.result.segments
  if (segs?.length) return segs
  const out: LyricsSegment[] = []
  for (const raw of (job.result.synced_lyrics ?? '').split(/\r?\n/)) {
    const m = /^\s*\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\](.*)$/.exec(raw)
    if (!m) continue
    const start = Number(m[1]) * 60 + Number(m[2].replace(':', '.'))
    out.push({ start, end: start, text: m[3].replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim() })
  }
  for (let i = 0; i < out.length; i++) out[i].end = out[i + 1]?.start ?? out[i].start + 4
  return out
}

/** 83.4 -> "1:23.40", the way LRC writes it. */
export function lrcTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}

/** "+0.25s", "-1.10s". */
export const offsetText = (sec: number): string => `${sec < 0 ? '-' : '+'}${Math.abs(sec).toFixed(2)}s`

/** Where a target starts. */
export function targetStart(lines: LyricsSegment[], t: TimingTarget): number {
  const l = lines[t.line]
  return t.word === null ? l.start : l.words![t.word].start
}

/** The latest start in a line: its last word's, or its own. */
const lastStart = (l: LyricsSegment): number => Math.max(l.start, l.words?.length ? l.words[l.words.length - 1].start : l.start)

/** Where line `i` may start (`floor`) and its last word may reach (`ceiling`). */
function lineRoom(lines: LyricsSegment[], i: number): { floor: number; ceiling: number } {
  const prev = lines[i - 1]
  const next = lines[i + 1]
  return { floor: prev ? lastStart(prev) + GAP : 0, ceiling: next ? next.start - GAP : Infinity }
}

/** A line and its words `d` seconds later, its end kept short of the next line. */
const moveLine = (l: LyricsSegment, d: number, next: LyricsSegment | undefined): LyricsSegment => ({
  ...l,
  start: round(l.start + d),
  end: round(Math.max(lastStart(l) + d, Math.min(l.end + d, next ? next.start : Infinity))),
  words: l.words?.map((w) => ({ ...w, start: round(w.start + d), end: round(w.end + d) })),
})

/** Puts `line` in at `i`, cutting the line above short so they don't overlap. */
function place(lines: LyricsSegment[], i: number, line: LyricsSegment): LyricsSegment[] {
  const out = lines.slice()
  out[i] = line
  const prev = lines[i - 1]
  if (prev && prev.end > line.start) out[i - 1] = { ...prev, end: Math.max(lastStart(prev), line.start) }
  return out
}

/** Moves a word, or a whole line with its words, by `delta` seconds, as far
 *  as its neighbours allow. A line's start follows its first word when the
 *  two started together, or when the word moves ahead of it. */
export function shiftTiming(lines: LyricsSegment[], t: TimingTarget, delta: number): LyricsSegment[] {
  const l = lines[t.line]
  const next = lines[t.line + 1]
  const { floor, ceiling } = lineRoom(lines, t.line)

  if (t.word === null) {
    const d = round(clamp(delta, floor - l.start, ceiling - lastStart(l)))
    return d ? place(lines, t.line, { ...moveLine(l, d, next), estimated: false }) : lines
  }
  const ws = l.words!
  const j = t.word
  const w = ws[j]
  const last = j === ws.length - 1
  const start = round(clamp(w.start + delta, j > 0 ? ws[j - 1].start + GAP : floor, last ? ceiling : ws[j + 1].start - GAP))
  if (start === w.start) return lines
  const end = round(Math.max(start, Math.min(w.end + start - w.start, last ? (next ? next.start : Infinity) : ws[j + 1].start)))
  const words = ws.map((x, k) =>
    k === j ? { ...x, start, end, estimated: false }
    : k === j - 1 && x.end > start ? { ...x, end: start }
    : x)
  const tied = j === 0 && Math.abs(l.start - w.start) < 0.0005
  return place(lines, t.line, {
    ...l,
    words,
    start: j === 0 && (tied || start < l.start) ? start : l.start,
    end: last ? round(Math.max(l.end, end)) : l.end,
  })
}

/** Moves a target so it starts at `time` (or as near as its neighbours allow). */
export const setTimingStart = (lines: LyricsSegment[], t: TimingTarget, time: number): LyricsSegment[] =>
  shiftTiming(lines, t, time - targetStart(lines, t))

/** Puts a target back where the server had it: a word to its start, a line
 *  with all its words. Neighbours moved in the meantime still bound it. */
export function resetTiming(lines: LyricsSegment[], original: LyricsSegment[], t: TimingTarget): LyricsSegment[] {
  const o = original[t.line]
  const { floor, ceiling } = lineRoom(lines, t.line)
  if (t.word === null) {
    // The line as the server had it, slid as one piece if a neighbour has
    // since moved into its way.
    const d = o.start < floor ? floor - o.start : lastStart(o) > ceiling ? Math.max(floor - o.start, ceiling - lastStart(o)) : 0
    return place(lines, t.line, d ? moveLine(o, d, lines[t.line + 1]) : o)
  }
  const ow = o.words![t.word]
  const out = setTimingStart(lines, t, ow.start)
  const l = out[t.line]
  if (l.words![t.word].start !== ow.start) return out
  const line = { ...l, words: l.words!.map((x, k) => (k === t.word ? ow : x)) }
  // Every word back where it was: the line goes back as it was, too.
  return place(out, t.line, sameWords(line, o) && o.start >= floor ? o : line)
}

const sameWords = (a: LyricsSegment, b: LyricsSegment): boolean =>
  (a.words ?? []).every((w, k) => w.start === b.words![k].start)

/** Has this target moved from where the server had it? */
export function isMoved(lines: LyricsSegment[], original: LyricsSegment[], t: TimingTarget): boolean {
  const l = lines[t.line]
  const o = original[t.line]
  if (t.word !== null) return l.words![t.word].start !== o.words![t.word].start
  return l.start !== o.start || !sameWords(l, o)
}

/** How many words (or, for a line without words, lines) were moved. */
export function countTimingEdits(original: LyricsSegment[], lines: LyricsSegment[]): number {
  let n = 0
  for (let i = 0; i < lines.length; i++) {
    const ws = lines[i].words
    if (ws?.length) n += ws.filter((w, j) => w.start !== original[i].words![j].start).length
    else if (lines[i].start !== original[i].start) n++
  }
  return n
}

/** The next or previous target from `t`: words run on across lines; lines step by line. */
export function stepTarget(lines: LyricsSegment[], t: TimingTarget, by: 1 | -1): TimingTarget {
  if (t.word === null) return { line: clamp(t.line + by, 0, lines.length - 1), word: null }
  const j = t.word + by
  if (j >= 0 && j < (lines[t.line].words?.length ?? 0)) return { line: t.line, word: j }
  for (let i = t.line + by; i >= 0 && i < lines.length; i += by) {
    const n = lines[i].words?.length ?? 0
    if (n) return { line: i, word: by > 0 ? 0 : n - 1 }
  }
  return t
}

/** "00:12.50", the server's LRC stamp (centiseconds, two-digit minutes). */
function stamp(sec: number): string {
  const cs = Math.round(sec * 100)
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${two(Math.floor(cs / 6000))}:${two(Math.floor((cs % 6000) / 100))}.${two(cs % 100)}`
}

export const segmentsToLrc = (lines: LyricsSegment[]): string =>
  lines.map((l) => `[${stamp(l.start)}]${l.text}`).join('\n')

/** Per-word LRC: `[line]<word>word <word>word<end>`. A line with no word
 *  timings (an older job) goes as a plain timed line. */
export const segmentsToEnhancedLrc = (lines: LyricsSegment[]): string =>
  lines.map((l) => (l.words?.length
    ? `[${stamp(l.start)}]${l.words.map((w) => `<${stamp(w.start)}>${w.word}`).join(' ')}<${stamp(l.end)}>`
    : `[${stamp(l.start)}]${l.text}`)).join('\n')

/** A job's text built from tuned lines; null for plain text, which timing doesn't touch. */
export function timingOutput(lines: LyricsSegment[], output: LyricsOutput): string | null {
  return output === 'lrc' ? segmentsToLrc(lines) : output === 'enhanced_lrc' ? segmentsToEnhancedLrc(lines) : null
}

interface TimingDraft { saved: number; lines: LyricsSegment[] }

/** Same lines and words as the job's own, so a draft still fits it. */
function fits(draft: LyricsSegment[], original: LyricsSegment[]): boolean {
  return draft.length === original.length && draft.every((l, i) =>
    l.text === original[i].text && (l.words?.length ?? 0) === (original[i].words?.length ?? 0)
    && (l.words ?? []).every((w, j) => w.word === original[i].words![j].word))
}

/** This device's tuned lines for a job, or null when it has none. */
export function loadTimingDraft(job: LyricsGenJob): LyricsSegment[] | null {
  const d = ls.get<TimingDraft>(DRAFT_KEY + job.id)
  return d?.lines && fits(d.lines, timedLines(job)) ? d.lines : null
}

let pruned = false

/** Keeps a job's tuned lines; null forgets them. The first save of a run also
 *  clears out drafts for previews that have since expired. */
export function saveTimingDraft(jobId: string, lines: LyricsSegment[] | null): void {
  if (!lines) { ls.remove(DRAFT_KEY + jobId); return }
  ls.set<TimingDraft>(DRAFT_KEY + jobId, { saved: Date.now(), lines })
  if (pruned) return
  pruned = true
  try {
    const prefix = `unreleased:${DRAFT_KEY}`
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (!key?.startsWith(prefix)) continue
      const saved = (JSON.parse(localStorage.getItem(key) ?? 'null') as TimingDraft | null)?.saved ?? 0
      if (Date.now() - saved > DRAFT_TTL) localStorage.removeItem(key)
    }
  } catch { /* storage unavailable */ }
}

/** The job's lines as this device has tuned them, and how many moves that is. */
export function jobTiming(job: LyricsGenJob): { lines: LyricsSegment[]; original: LyricsSegment[]; edits: number } {
  const original = timedLines(job)
  const lines = loadTimingDraft(job) ?? original
  return { lines, original, edits: countTimingEdits(original, lines) }
}
