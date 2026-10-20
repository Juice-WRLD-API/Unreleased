// The app's lyrics, timed word by word for the lyric styles. Unreleased times its lyrics line by line (LRC), so each
// line's words are spread over the time it's sung, by syllables, never slower than an easy pace; lyrics with no
// timing at all are given an even pace over the song. "(yeah)" and "[uh]" are adlibs, kept apart from the words -
// though a style may sing every word as written instead (Karaoke).
// Pure logic, so it can be checked on its own.

export interface TimedWord { text: string; start: number; end: number }
export interface TimedLine {
  time: number
  text: string
  words: TimedWord[]
  adlibs: TimedWord[]
  /** Every word as written, the adlibs in their place: for a style that sings them in the line. */
  all?: TimedWord[]
}
export interface TimedLyrics { lines: TimedLine[]; isSynced: boolean }

function syllables(word: string): number {
  const text = word.toLowerCase().replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '')
  let count = 0, inVowel = false
  for (const ch of text) {
    const vowel = 'aeiouy'.includes(ch)
    if (vowel && !inVowel) count++
    inVowel = vowel
  }
  return Math.max(count, 1)
}

/** A line's words spread over the time it is sung, by syllables, never slower than an easy pace. */
export function spread(text: string, start: number, until: number | null): TimedWord[] {
  const parts = text.split(/\s+/).filter(Boolean)
  if (!parts.length) return []
  const weights = parts.map(syllables)
  const total = weights.reduce((a, b) => a + b, 0)
  const easy = total * 0.26 + 0.25
  const span = Math.max(Math.min(until != null ? until - start - 0.05 : easy, easy), 0.3)
  let time = start
  return parts.map((word, i) => {
    const length = (span * weights[i]) / total
    const w = { text: word, start: time, end: time + length }
    time += length
    return w
  })
}

/** "(yeah)" and "[uh]" are adlibs: kept apart from the line's own words. */
export function separate(words: TimedWord[]): { words: TimedWord[]; adlibs: TimedWord[] } {
  const kept: TimedWord[] = [], adlibs: TimedWord[] = []
  let open: TimedWord | null = null
  for (const word of words) {
    const opens = word.text.startsWith('(') || word.text.startsWith('[')
    if (!open && !opens) { kept.push(word); continue }
    const held: TimedWord = open ? { text: (open as TimedWord).text + ' ' + word.text, start: (open as TimedWord).start, end: word.end } : word
    open = held
    if (held.text.endsWith(')') || held.text.endsWith(']')) {
      const inside = held.text.replace(/^[()[\] ]+|[()[\] ]+$/g, '')
      if (inside) adlibs.push({ text: inside, start: held.start, end: held.end })
      open = null
    }
  }
  // An adlib never closed: its words were the line's own after all.
  if (open) { const from = open.start; kept.push(...words.filter((w) => w.start >= from)) }
  return { words: kept, adlibs }
}

/** Line-timed lyrics (the app's SyncedLyricLine), shifted by the lyrics offset, timed word by word. */
export function timedFromLines(lines: readonly { time: number; text: string }[], offset = 0): TimedLyrics {
  const sorted = lines.map((l) => ({ time: l.time + offset, text: l.text })).sort((a, b) => a.time - b.time)
  return {
    isSynced: true,
    lines: sorted.map((line, i) => {
      const next = sorted[i + 1] ? sorted[i + 1].time : null
      const all = spread(line.text, line.time, next)
      return { time: line.time, text: line.text, all, ...separate(all) }
    }),
  }
}

/** Lyrics with no timing, given an even pace over a song this long, so they can be shown word by word all the same. */
export function pacedFromText(text: string, duration: number): TimedLyrics {
  const sung = text.split(/\r?\n|\r/).filter((line) => line.trim())
  const length = duration > 0 ? duration : sung.length * 3
  const step = length / Math.max(sung.length, 1)
  return {
    isSynced: true,
    lines: sung.map((line, index) => {
      const start = index * step
      const all = spread(line, start, start + step)
      const { words, adlibs } = separate(all)
      return { time: start, text: words.map((w) => w.text).join(' '), words, adlibs, all }
    }),
  }
}
