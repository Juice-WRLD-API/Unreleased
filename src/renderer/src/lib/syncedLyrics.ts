// The Synced lyrics tool's model of an LRC: lines with an optional start, and
// in word mode the words of each line with optional starts of their own. The
// song editor's Sync, the Synced lyrics dialog and a generated sync's preview
// all edit through it.
//
// Reading keeps each line as it was, so a line nothing touched is written back
// exactly as read; a stamped or moved one is rewritten as `[m:ss.xx] text`, or
// with word times as `[m:ss.xx] <m:ss.xx>word <m:ss.xx>word<m:ss.xx>` (enhanced
// LRC, the format a generated word sync downloads as). The last stamp is when
// the line ends.
//
// Stamping sets a time wherever the audio is, even out of order (the tool
// marks those). Nudging keeps the order: a word can't pass its stamped
// neighbours, and a line's first word can't go before the line above ends.
import type { LyricsSegment } from './lyricsGenApi'

export interface SyncWord { text: string; start: number | null; estimated?: boolean }

export interface SyncLine {
  text: string
  start: number | null
  /** Word LRC's closing stamp: when the last word ends. */
  end: number | null
  /** Per-word timing; null on a line without any. Its words joined by spaces are `text`. */
  words: SyncWord[] | null
  /** Lyrics generation couldn't place this line, so its time is a guess. */
  estimated?: boolean
  /** The line as read, written back while nothing changes it. */
  raw?: string
  /** Not a lyric: a tag like [ar: Juice WRLD], or an empty line with no time. Kept, never shown. */
  hidden?: boolean
}

/** A word of a line, or (`word` null) the whole line. Indexes from 0 into the full list. */
export interface SyncTarget { line: number; word: number | null }
export type SyncMode = 'lines' | 'words'

const TIME = String.raw`(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)`
const LINE_RE = new RegExp(String.raw`^\s*\[${TIME}\][ \t]?(.*)$`)
const WORD_TAG = new RegExp(String.raw`<${TIME}>`, 'g')
const HAS_WORD_TAG = new RegExp(String.raw`<${TIME}>`)
const META_RE = /^\s*\[[a-z#]+\s*:[^\]]*\]\s*$/i
/** The smallest gap a nudge keeps between two starts: one LRC centisecond. */
const GAP = 0.01

const seconds = (m: string, s: string): number => Number(m) * 60 + Number(s.replace(':', '.'))
const cs = (t: number): number => Math.round(Math.max(0, t) * 100) / 100

/** 83.4 -> "1:23.40", the way the catalogue writes LRC. */
export function lrcStamp(sec: number): string {
  const c = Math.round(Math.max(0, sec) * 100)
  return `${Math.floor(c / 6000)}:${((c % 6000) / 100).toFixed(2).padStart(5, '0')}`
}

/** "1:23.40", "1:23", "83.4" -> seconds; null when it isn't a time. */
export function parseStamp(raw: string): number | null {
  const v = raw.trim()
  const m = /^(\d+):(\d{1,2})(?:[.:](\d{1,3}))?$/.exec(v)
  if (m) return Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(`0.${m[3]}`) : 0) : null
  return /^\d+(?:\.\d+)?$/.test(v) ? Number(v) : null
}

const splitWords = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean)

function readLine(raw: string): SyncLine {
  const m = LINE_RE.exec(raw)
  if (!m) {
    const text = raw.trim()
    return { text, start: null, end: null, words: null, raw, hidden: !text || META_RE.test(raw) }
  }
  const start = seconds(m[1], m[2])
  const body = m[3]
  if (!HAS_WORD_TAG.test(body)) return { text: body.trim(), start, end: null, words: null, raw }
  const words: SyncWord[] = []
  const add = (text: string, at: number | null): void => {
    splitWords(text).forEach((w, i) => words.push({ text: w, start: i === 0 ? at : null }))
  }
  let at: number | null = null
  let from = 0
  for (const t of body.matchAll(WORD_TAG)) {
    add(body.slice(from, t.index), at)
    at = seconds(t[1], t[2])
    from = (t.index ?? 0) + t[0].length
  }
  const tail = body.slice(from)
  let end: number | null = null
  if (tail.trim()) add(tail, at)
  else end = at
  return { text: words.map((w) => w.text).join(' '), start, end, words, raw }
}

export function parseSyncedLyrics(lrc: string): SyncLine[] {
  return lrc ? lrc.split(/\r?\n/).map(readLine) : []
}

function writeLine(l: SyncLine): string {
  if (l.raw !== undefined) return l.raw
  const start = lineStart(l)
  if (start === null) return l.text
  if (!l.words?.some((w) => w.start !== null)) return `[${lrcStamp(start)}] ${l.text}`.trimEnd()
  const body = l.words.map((w) => (w.start !== null ? `<${lrcStamp(w.start)}>` : '') + w.text).join(' ')
  return `[${lrcStamp(start)}] ${body}${l.end !== null ? `<${lrcStamp(l.end)}>` : ''}`
}

export const serializeSyncedLyrics = (lines: SyncLine[]): string => lines.map(writeLine).join('\n')

/** Plain lyrics as untimed lines, one per non-empty line. */
export const linesFromPlain = (text: string): SyncLine[] =>
  text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((t) => ({ text: t, start: null, end: null, words: null }))

/** The words of an LRC with every time taken out. */
export const plainOf = (lines: SyncLine[]): string => lines.filter((l) => !l.hidden && l.text).map((l) => l.text).join('\n')

// ── Reading the timing ──

/** When a line starts: its own stamp, else its first stamped word's. */
export function lineStart(l: SyncLine): number | null {
  if (l.start !== null) return l.start
  return l.words?.find((w) => w.start !== null)?.start ?? null
}

/** The latest stamp in a line. */
function lastStart(l: SyncLine): number | null {
  let t = lineStart(l)
  for (const w of l.words ?? []) if (w.start !== null && (t === null || w.start > t)) t = w.start
  return t
}

/** A line's words, timed or not. */
export const wordsOf = (l: SyncLine): SyncWord[] => l.words ?? splitWords(l.text).map((text) => ({ text, start: null }))

export function targetStart(lines: SyncLine[], t: SyncTarget): number | null {
  const l = lines[t.line]
  if (!l) return null
  return t.word === null ? lineStart(l) : wordsOf(l)[t.word]?.start ?? null
}

/** Does any line carry word times? */
export const hasWordTiming = (lines: SyncLine[]): boolean => lines.some((l) => l.words?.some((w) => w.start !== null))

const visible = (l: SyncLine | undefined): boolean => !!l && !l.hidden
/** Lines that have words to time in word mode. */
const wordy = (l: SyncLine | undefined): boolean => visible(l) && !!l!.text

/** The line sung at `t`: the one with the latest start at or before it. */
export function lineAt(lines: SyncLine[], t: number): number {
  let lit = -1
  let best = -Infinity
  lines.forEach((l, i) => {
    const s = visible(l) ? lineStart(l) : null
    if (s !== null && s <= t && s >= best) { best = s; lit = i }
  })
  return lit
}

/** The word of a line sung at `t`. An untimed word lights with the one before
 *  it, and the first with the line. */
export function wordAt(l: SyncLine, t: number): number {
  let lit = -1
  let at = l.start
  wordsOf(l).forEach((w, j) => {
    if (w.start !== null) at = w.start
    if (at !== null && at <= t) lit = j
  })
  return lit
}

/** The next or previous line (lines mode) or word, words running on across lines. */
export function stepTarget(lines: SyncLine[], t: SyncTarget, by: 1 | -1, mode: SyncMode): SyncTarget {
  if (mode === 'lines') {
    for (let i = t.line + by; i >= 0 && i < lines.length; i += by) if (visible(lines[i])) return { line: i, word: null }
    return t
  }
  // From a whole line, down is its first word and up the last word above.
  const j = t.word === null ? (by > 0 ? 0 : -1) : t.word + by
  if (j >= 0 && j < wordsOf(lines[t.line]).length && wordy(lines[t.line])) return { line: t.line, word: j }
  for (let i = t.line + by; i >= 0 && i < lines.length; i += by) {
    if (wordy(lines[i])) return { line: i, word: by > 0 ? 0 : wordsOf(lines[i]).length - 1 }
  }
  return t
}

/** Where tapping starts: the first line or word without a time, else the first. */
export function firstTarget(lines: SyncLine[], mode: SyncMode, untimed = true): SyncTarget | null {
  let first: SyncTarget | null = null
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (mode === 'lines') {
      if (!visible(l)) continue
      first ??= { line: i, word: null }
      if (untimed && lineStart(l) === null) return { line: i, word: null }
    } else {
      if (!wordy(l)) continue
      first ??= { line: i, word: 0 }
      const j = wordsOf(l).findIndex((w) => w.start === null)
      if (untimed && j >= 0) return { line: i, word: j }
    }
  }
  return untimed ? null : first
}

/** How much is timed: lines in lines mode, words in word mode. */
export function syncProgress(lines: SyncLine[], mode: SyncMode): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const l of lines) {
    if (mode === 'lines') {
      if (!visible(l)) continue
      total++
      if (lineStart(l) !== null) done++
    } else if (wordy(l)) {
      const ws = wordsOf(l)
      total += ws.length
      done += ws.filter((w) => w.start !== null).length
    }
  }
  return { done, total }
}

export const targetKey = (t: SyncTarget): string => (t.word === null ? `${t.line}` : `${t.line}.${t.word}`)

/** Stamps that start before one above them: their keys (see targetKey). */
export function outOfOrder(lines: SyncLine[]): Set<string> {
  const out = new Set<string>()
  let latest = -Infinity
  lines.forEach((l, i) => {
    if (!visible(l)) return
    const s = lineStart(l)
    if (s !== null) {
      if (s < latest - 0.005) out.add(`${i}`)
      latest = Math.max(latest, s)
    }
    l.words?.forEach((w, j) => {
      if (w.start === null) return
      if (w.start < latest - 0.005) out.add(`${i}.${j}`)
      latest = Math.max(latest, w.start)
    })
  })
  return out
}

// ── Changing the timing ──

/** A changed line: no longer written back as read. */
function touch(l: SyncLine, patch: Partial<SyncLine>): SyncLine {
  const { raw: _raw, ...rest } = l
  return { ...rest, ...patch }
}

const put = (lines: SyncLine[], i: number, l: SyncLine): SyncLine[] => lines.map((x, k) => (k === i ? l : x))

/** A line and everything timed in it `d` seconds later. */
function moveLine(l: SyncLine, d: number): SyncLine {
  return touch(l, {
    start: l.start === null ? null : cs(l.start + d),
    end: l.end === null ? null : cs(l.end + d),
    words: l.words?.map((w) => (w.start === null ? w : { ...w, start: cs(w.start + d), estimated: false })) ?? null,
    estimated: false,
  })
}

/** Sets a line or word to start at `time`. A line moves with its words; a
 *  line's start follows its first timed word when it had none, when the two
 *  started together, or when the word moves ahead of it. */
export function stampTarget(lines: SyncLine[], t: SyncTarget, time: number): SyncLine[] {
  const l = lines[t.line]
  if (!l) return lines
  const at = cs(time)
  if (t.word === null) {
    const from = lineStart(l)
    const moved = from === null ? touch(l, { start: at, estimated: false }) : moveLine(l, at - from)
    return put(lines, t.line, { ...moved, start: at })
  }
  const ws = wordsOf(l)
  const w = ws[t.word]
  if (!w) return lines
  const words = ws.map((x, k) => (k === t.word ? { ...x, start: at, estimated: false } : x))
  const leads = ws.slice(0, t.word).every((x) => x.start === null)
  const tied = l.start !== null && w.start !== null && Math.abs(l.start - w.start) < 0.005
  const start = leads && (l.start === null || tied || at < l.start) ? at : l.start
  const last = Math.max(...words.map((x) => x.start ?? -Infinity), start ?? -Infinity)
  return put(lines, t.line, touch(l, { words, start, end: l.end !== null && l.end <= last ? null : l.end }))
}

/** The stamps either side of a target that a nudge can't pass. */
function bounds(lines: SyncLine[], t: SyncTarget): { floor: number; ceiling: number } {
  const l = lines[t.line]
  let floor = -Infinity
  let ceiling = Infinity
  const ws = wordsOf(l)
  if (t.word !== null) {
    for (let j = t.word - 1; j >= 0 && floor === -Infinity; j--) if (ws[j].start !== null) floor = ws[j].start! + GAP
    for (let j = t.word + 1; j < ws.length && ceiling === Infinity; j++) if (ws[j].start !== null) ceiling = ws[j].start! - GAP
  }
  if (floor === -Infinity) {
    for (let i = t.line - 1; i >= 0; i--) {
      const s = visible(lines[i]) ? lastStart(lines[i]) : null
      if (s !== null) { floor = s + GAP; break }
    }
  }
  if (ceiling === Infinity) {
    for (let i = t.line + 1; i < lines.length; i++) {
      const s = visible(lines[i]) ? lineStart(lines[i]) : null
      if (s !== null) { ceiling = s - GAP; break }
    }
    // A whole line has to fit its last word in before the next line.
    if (t.word === null && ceiling !== Infinity) ceiling -= (lastStart(l) ?? 0) - (lineStart(l) ?? 0)
  }
  return { floor: Math.max(floor, 0), ceiling }
}

/** Moves a timed target by `delta` seconds, as far as its neighbours allow.
 *  `stopped` says a neighbour cut it short. One already out of order moves freely. */
export function nudgeTarget(lines: SyncLine[], t: SyncTarget, delta: number): { lines: SyncLine[]; stopped: boolean } {
  const from = targetStart(lines, t)
  if (from === null) return { lines, stopped: false }
  const { floor, ceiling } = bounds(lines, t)
  const inside = from >= floor - 0.0005 && from <= ceiling + 0.0005 && floor <= ceiling
  const to = cs(inside ? Math.min(Math.max(from + delta, floor), ceiling) : from + delta)
  if (Math.abs(to - from) < 0.005) return { lines, stopped: Math.abs(delta) > 0 }
  return { lines: stampTarget(lines, t, to), stopped: Math.abs(to - from - delta) > 0.005 }
}

/** Takes a target's time away: a line loses its own and its words'. */
export function clearTarget(lines: SyncLine[], t: SyncTarget): SyncLine[] {
  const l = lines[t.line]
  if (!l) return lines
  if (t.word === null) return put(lines, t.line, touch(l, { start: null, end: null, words: null, estimated: false }))
  const ws = wordsOf(l)
  const w = ws[t.word]
  const tied = l.start !== null && w?.start !== null && Math.abs(l.start - (w?.start ?? 0)) < 0.005
  const words = ws.map((x, k) => (k === t.word ? { ...x, start: null } : x))
  const anyTimed = words.some((x) => x.start !== null)
  return put(lines, t.line, touch(l, {
    words: anyTimed ? words : null,
    start: t.word === 0 && tied && anyTimed ? null : l.start,
    end: anyTimed ? l.end : null,
  }))
}

/** Every stamp `delta` seconds later, held so the earliest stays at 0 or after. */
export function shiftAll(lines: SyncLine[], delta: number): { lines: SyncLine[]; by: number } {
  let earliest = Infinity
  for (const l of lines) {
    const s = visible(l) ? lineStart(l) : null
    if (s !== null) earliest = Math.min(earliest, s)
  }
  if (earliest === Infinity) return { lines, by: 0 }
  const by = Math.max(delta, -earliest)
  if (Math.abs(by) < 0.005) return { lines, by: 0 }
  return { lines: lines.map((l) => (visible(l) && lineStart(l) !== null ? moveLine(l, by) : l)), by }
}

/** Puts a target back where `original` had it. Only when that line's text is the same. */
export function resetTarget(lines: SyncLine[], original: SyncLine[], t: SyncTarget): SyncLine[] {
  const o = original[t.line]
  const l = lines[t.line]
  if (!o || !l || o.text !== l.text) return lines
  if (t.word === null) return put(lines, t.line, o)
  const s = wordsOf(o)[t.word]?.start ?? null
  return s === null ? clearTarget(lines, t) : stampTarget(lines, t, s)
}

/** Has this target moved from where `original` had it? */
export function isMoved(lines: SyncLine[], original: SyncLine[] | null | undefined, t: SyncTarget): boolean {
  const o = original?.[t.line]
  const l = lines[t.line]
  if (!o || !l || o.text !== l.text) return false
  if (t.word !== null) return (wordsOf(l)[t.word]?.start ?? null) !== (wordsOf(o)[t.word]?.start ?? null)
  return lineStart(l) !== lineStart(o) || wordsOf(l).some((w, j) => w.start !== (wordsOf(o)[j]?.start ?? null))
}

// ── Changing the lines ──

/** New text for a line. In a line with word times, the words that stayed at
 *  its start and end keep theirs. */
export function setLineText(lines: SyncLine[], i: number, text: string): SyncLine[] {
  const l = lines[i]
  const next = splitWords(text)
  if (!l || next.join(' ') === l.text) return lines
  if (!l.words) return put(lines, i, touch(l, { text: next.join(' '), hidden: false }))
  const old = l.words
  let head = 0
  while (head < old.length && head < next.length && old[head].text === next[head]) head++
  let tail = 0
  while (tail < old.length - head && tail < next.length - head && old[old.length - 1 - tail].text === next[next.length - 1 - tail]) tail++
  const words = next.map((w, k) => (k < head ? old[k] : k >= next.length - tail ? old[old.length - (next.length - k)] : { text: w, start: null }))
  return put(lines, i, touch(l, { text: next.join(' '), words: words.some((w) => w.start !== null) ? words : null }))
}

export const insertLine = (lines: SyncLine[], at: number, text = ''): SyncLine[] =>
  [...lines.slice(0, at), { text: text.trim(), start: null, end: null, words: null }, ...lines.slice(at)]

export const removeLine = (lines: SyncLine[], i: number): SyncLine[] => lines.filter((_, k) => k !== i)

// ── A generated sync's segments ──

export function linesFromSegments(segs: LyricsSegment[], words: boolean): SyncLine[] {
  return segs.map((s) => ({
    text: s.text,
    start: s.start,
    end: words && s.words?.length ? s.end : null,
    words: words && s.words?.length ? s.words.map((w) => ({ text: w.word.trim(), start: w.start, estimated: w.estimated })) : null,
    estimated: s.estimated,
  }))
}

/** `base` with the tool's starts, for a sync's timing draft. Every word keeps
 *  its length, cut short where the next one starts. */
export function segmentsFromLines(lines: SyncLine[], base: LyricsSegment[]): LyricsSegment[] {
  const starts = base.map((b, i) => lineStart(lines[i]) ?? b.start)
  return base.map((b, i) => {
    const l = lines[i]
    const start = starts[i]
    const next = starts[i + 1] ?? Infinity
    const d = start - b.start
    const ws = b.words?.map((w, j) => {
      const s = l?.words ? l.words[j]?.start ?? w.start : w.start + d
      return { ...w, start: s, estimated: l?.words ? l.words[j]?.estimated : w.estimated }
    })
    const words = ws?.map((w, j) => {
      const cut = ws[j + 1]?.start ?? next
      const end = Math.max(w.start, Math.min(w.start + (b.words![j].end - b.words![j].start), cut))
      return { ...w, end: Math.round(end * 1000) / 1000 }
    })
    const last = words?.length ? words[words.length - 1].start : start
    const end = Math.max(last, Math.min(l?.end ?? b.end + d, next))
    return { ...b, start, end, words, estimated: l?.estimated ?? b.estimated }
  })
}
