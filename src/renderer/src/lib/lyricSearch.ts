import type { JWApiSong } from './juicewrldApi'

// One lyric matcher for the Lyrics tab (desktop + mobile) and the terminal's
// `lyricfind`, so they can't drift apart. Searches the catalogue the app already
// loads (cached) rather than asking the API.
//
// Fuzzy mode ignores case, accents and punctuation, matches the phrase across line
// breaks, then falls back to "every word appears somewhere" (as a whole word,
// a prefix of 3+ letters, or within a typo or two). Exact mode is a plain
// case-insensitive substring match on the raw lyrics.

const normalize = (s: string): string => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/['’`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const maxEdits = (len: number): number => (len <= 3 ? 0 : len <= 6 ? 1 : 2)

// Optimal string alignment distance (a swapped pair counts as one edit), giving up
// once it is certain to exceed `max`.
function withinEdits(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false
  let prev2: number[] = []
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      cur[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return false
    prev2 = prev
    prev = cur
  }
  return prev[b.length] <= max
}

/** How well one query word matches one lyric word: 1 exact, 0.9 prefix, 0.7 typo, 0 none. */
function wordScore(token: string, word: string): number {
  if (token === word) return 1
  if (word.length >= 3 && token.startsWith(word)) return 0.9
  return word.length > 3 && withinEdits(token, word, maxEdits(word.length)) ? 0.7 : 0
}

interface Index { text: string; tokens: string[]; set: Set<string> }
const indexes = new WeakMap<JWApiSong, Index>()
function indexOf(song: JWApiSong): Index {
  let idx = indexes.get(song)
  if (!idx) {
    const text = normalize(song.lyrics ?? '')
    const tokens = [...new Set(text.split(' ').filter(Boolean))]
    idx = { text, tokens, set: new Set(tokens) }
    indexes.set(song, idx)
  }
  return idx
}

function bestWordScore(idx: Index, word: string): number {
  if (idx.set.has(word)) return 1
  let best = 0
  for (const t of idx.tokens) {
    const s = wordScore(t, word)
    if (s > best) best = s
  }
  return best
}

const countOccurrences = (hay: string, needle: string): number => hay.split(needle).length - 1

/** Songs whose lyrics match `query`, best first. */
export function searchLyrics(songs: JWApiSong[], query: string, fuzzy = true): JWApiSong[] {
  const q = query.trim()
  if (!q) return []
  const scored: { song: JWApiSong; score: number }[] = []
  if (!fuzzy) {
    const needle = q.toLowerCase()
    for (const song of songs) {
      if (!song.lyrics) continue
      const n = countOccurrences(song.lyrics.toLowerCase(), needle)
      if (n) scored.push({ song, score: n })
    }
  } else {
    const phrase = normalize(q)
    const words = phrase.split(' ').filter(Boolean)
    if (words.length === 0) return []
    for (const song of songs) {
      if (!song.lyrics) continue
      const idx = indexOf(song)
      if (idx.text.includes(phrase)) { scored.push({ song, score: 100 + Math.min(countOccurrences(idx.text, phrase), 50) }); continue }
      let total = 0
      for (const w of words) {
        const s = bestWordScore(idx, w)
        if (s === 0) { total = 0; break }
        total += s
      }
      if (total > 0) scored.push({ song, score: (total / words.length) * 50 })
    }
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.song)
}

/** The line of `lyrics` that best matches `query`, or '' if none does. */
export function bestLyricLine(lyrics: string | null | undefined, query: string, fuzzy = true): string {
  if (!lyrics) return ''
  const lines = lyrics.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!fuzzy) return lines.find((l) => l.toLowerCase().includes(query.trim().toLowerCase())) ?? ''
  const phrase = normalize(query)
  const words = phrase.split(' ').filter(Boolean)
  let best = ''
  let bestScore = 0
  for (const line of lines) {
    const norm = normalize(line)
    if (norm.includes(phrase)) return line
    const tokens = norm.split(' ')
    let score = 0
    for (const w of words) score += Math.max(0, ...tokens.map((t) => wordScore(t, w)))
    if (score > bestScore) { best = line; bestScore = score }
  }
  return best
}

/** Where to highlight in `lyrics` when the whole query isn't there verbatim: the
 *  longest query word found (loosely) in the best-matching line. */
export function locateFuzzy(lyrics: string, query: string): { idx: number; len: number } | null {
  const line = bestLyricLine(lyrics, query)
  if (!line) return null
  const lineStart = lyrics.indexOf(line)
  if (lineStart === -1) return null
  const words = normalize(query).split(' ').filter(Boolean).sort((a, b) => b.length - a.length)
  const tokens = [...line.matchAll(/[\p{L}\p{N}'’]+/gu)]
  for (const w of words) {
    const hit = tokens.find((t) => wordScore(normalize(t[0]), w) > 0)
    if (hit) return { idx: lineStart + (hit.index ?? 0), len: hit[0].length }
  }
  return { idx: lineStart, len: line.length }
}
