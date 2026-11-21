import type { JWApiSong } from './juicewrldApi'

type SongTitle = Pick<JWApiSong, 'id' | 'name' | 'track_titles'>

function titleKey(title: string): string {
  return title.trim().replace(/\s+/g, ' ').replace(/[‘’]/g, "'").toLowerCase()
}

type Matcher = (text: string) => { text: string; songId?: number }[]

// One matcher per catalogue array (loadAllSongs hands every caller the same one
// until its TTL runs out). The title regex alternates every song name, so
// running it over a chat's worth of lines took ~270 ms, and the panel paid that
// again on every mount (each WRLD visit). Lines are cached by text too, so a
// remount only runs the regex for lines it hasn't seen.
const matchers = new WeakMap<readonly SongTitle[], Matcher>()
const LINE_CACHE_MAX = 1000

// The newest matcher, by its title list: a new catalogue array with the same
// titles (the 5-minute refetch) keeps the compiled regex and the line cache.
let latest: { sig: string; matcher: Matcher } | null = null

export function matchRadioChatSongs(songs: readonly SongTitle[]): Matcher {
  const known = matchers.get(songs)
  if (known) return known
  const titles = collectTitles(songs)
  const sig = JSON.stringify([...titles])
  if (latest?.sig !== sig) {
    const match = buildMatcher(titles)
    const lines = new Map<string, ReturnType<Matcher>>()
    const matcher: Matcher = (text) => {
      let parts = lines.get(text)
      if (!parts) {
        if (lines.size >= LINE_CACHE_MAX) lines.delete(lines.keys().next().value as string)
        parts = match(text)
        lines.set(text, parts)
      }
      return parts
    }
    latest = { sig, matcher }
  }
  matchers.set(songs, latest.matcher)
  return latest.matcher
}

function collectTitles(songs: readonly SongTitle[]): Map<string, number | null> {
  const titles = new Map<string, number | null>()
  for (const song of songs) {
    for (const title of [song.name, ...(song.track_titles ?? [])]) {
      const key = titleKey(title)
      if (!/[\p{L}\p{N}]/u.test(key)) continue
      const prior = titles.get(key)
      titles.set(key, prior === undefined || prior === song.id ? song.id : null)
    }
  }
  return titles
}

// Letters, marks, digits and _: a title may not start or end inside a word.
const WORD = /[\p{L}\p{M}\p{N}_]/u
const SPACE = /\s/
// Skipped over, as they are, so a title inside one isn't linked.
const URL_AT = /(?:https?:\/\/|www\.)[^\s<>]+/iy
const SHORTCODE_AT = /:[a-z0-9_]+:/iy

interface TitleNode { next: Map<string, TitleNode>; key?: string }

/** Whether the code point starting at `i` is a word character. */
const wordAt = (text: string, i: number): boolean => {
  if (i >= text.length) return false
  const cp = text.codePointAt(i)!
  return WORD.test(String.fromCodePoint(cp))
}

/** Whether the code point ending just before `i` is a word character. */
const wordBefore = (text: string, i: number): boolean => {
  if (i <= 0) return false
  const low = text.charCodeAt(i - 1)
  const at = low >= 0xdc00 && low <= 0xdfff && i >= 2 && isHigh(text.charCodeAt(i - 2)) ? i - 2 : i - 1
  return wordAt(text, at)
}

const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff

// Titles as a character trie over their keys (titleKey). A regex alternating
// every title did the same job, but tried thousands of alternatives at each
// position: ~750 ms over a chat backlog. Walking the trie reads only the
// titles that really start there. Same rules as that regex: the leftmost
// match wins, a URL or :shortcode: there is skipped whole, otherwise the
// longest title that ends outside a word, with any run of spaces matching a
// title's space and curly apostrophes matching a straight one.
function buildMatcher(titles: Map<string, number | null>): Matcher {
  if (!titles.size) return (text) => [{ text }]

  const root: TitleNode = { next: new Map() }
  for (const key of titles.keys()) {
    let node = root
    for (let i = 0; i < key.length; i++) {
      let child = node.next.get(key[i])
      if (!child) node.next.set(key[i], child = { next: new Map() })
      node = child
    }
    node.key = key
  }

  /** The end and key of the longest title starting at `from`, or null. */
  const titleAt = (text: string, from: number): { end: number; key: string } | null => {
    let node = root
    let found: { end: number; key: string } | null = null
    let i = from
    while (i < text.length) {
      let c = text[i]
      let step = 1
      if (SPACE.test(c)) {
        c = ' '
        while (i + step < text.length && SPACE.test(text[i + step])) step++
      } else if (c === '‘' || c === '’') {
        c = "'"
      } else {
        c = c.toLowerCase()
      }
      const child = node.next.get(c)
      if (!child) break
      node = child
      i += step
      if (node.key !== undefined && !wordAt(text, i)) found = { end: i, key: node.key }
    }
    return found
  }

  return (text) => {
    const parts: { text: string; songId?: number }[] = []
    let end = 0
    let i = 0
    while (i < text.length) {
      // A match never starts halfway through a surrogate pair.
      if (i > 0 && isHigh(text.charCodeAt(i - 1)) && text.charCodeAt(i) >= 0xdc00 && text.charCodeAt(i) <= 0xdfff) { i++; continue }
      URL_AT.lastIndex = i
      SHORTCODE_AT.lastIndex = i
      const skip = URL_AT.exec(text) ?? SHORTCODE_AT.exec(text)
      if (skip) { i += skip[0].length; continue }
      const hit = wordBefore(text, i) ? null : titleAt(text, i)
      if (!hit) { i++; continue }
      const start = i
      const after = hit.end
      i = after
      const songId = titles.get(hit.key)
      if (songId == null) continue
      // Very short titles double as common words. Require a standalone message or a quote.
      if (hit.key.length <= 3 && /[\p{L}\p{N}]/u.test(text.slice(0, start) + text.slice(after)) &&
          !(/["“‘']$/.test(text.slice(0, start)) && /^["”’']/.test(text.slice(after)))) continue
      if (start > end) parts.push({ text: text.slice(end, start) })
      parts.push({ text: text.slice(start, after), songId })
      end = after
    }
    if (end < text.length) parts.push({ text: text.slice(end) })
    return parts
  }
}
