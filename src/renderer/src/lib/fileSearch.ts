import { apiRequest } from './apiClient'
import { apiUrl, normalizeForSearch, searchFiles, type JWApiFileEntry } from './juicewrldApi'
import { getFileExt, getMediaType } from './fileTypes'
import { maxEdits, withinEdits } from './lyricSearch'

// Query syntax and matching for the Files search box (and the file picker).
// The server's /files/browse/?search= only finds names containing the whole
// query as one contiguous string, so this searches the channel's full file
// index (/files/list-all/, ~1 MB gzipped, fetched once and kept a few minutes)
// on the client instead:
//
//   lucid snippet        every word must match, in any order; at least one in
//                        the name, the rest may match a parent folder
//   "forget me"          a quoted phrase must appear as written
//   -remix  -"tv mix"    leave out anything matching
//   ext:mp3,wav          extension (commas = any of)
//   type:audio           audio, image, video, text, archive, folder, file
//   in:snippets          somewhere under a folder whose name contains this
//   size:>10mb           also <, >=, <=; kb / mb / gb (bare numbers are MB)
//
// Any filter takes a leading "-" too. Matching ignores case, accents and
// punctuation, and "juicewrld" finds "Juice WRLD". When nothing matches
// exactly, words of 4+ letters get typo tolerance (the same budget lyric
// search uses) and the result is flagged `fuzzy`.

type FilterKey = 'ext' | 'type' | 'in' | 'size'

const KEY_ALIASES: Record<string, FilterKey> = {
  ext: 'ext', extension: 'ext', format: 'ext',
  type: 'type', kind: 'type', is: 'type',
  in: 'in', folder: 'in', dir: 'in', under: 'in',
  size: 'size',
}

const TYPE_ALIASES: Record<string, string> = {
  audio: 'audio', music: 'audio', sound: 'audio', song: 'audio', songs: 'audio',
  image: 'image', images: 'image', img: 'image', picture: 'image', pic: 'image', photo: 'image', cover: 'image', art: 'image',
  video: 'video', videos: 'video', vid: 'video', clip: 'video',
  text: 'text', txt: 'text', doc: 'text',
  archive: 'archive', archives: 'archive', zip: 'archive', zips: 'archive',
  folder: 'folder', folders: 'folder', dir: 'folder', directory: 'folder',
  file: 'file', files: 'file',
  other: 'other',
}

const ARCHIVE_EXTS = new Set(['.zip', '.rar', '.7z', '.tar', '.gz'])

export const FILE_SEARCH_HELP: { field: string; example: string }[] = [
  { field: 'any order', example: 'snippet lucid' },
  { field: 'phrase', example: '"forget me"' },
  { field: 'exclude', example: '-remix' },
  { field: 'extension', example: 'ext:mp3,wav' },
  { field: 'type', example: 'type:archive' },
  { field: 'folder', example: 'in:"studio sessions"' },
  { field: 'size', example: 'size:>50mb' },
]

interface Term { text: string; compact: string; phrase: boolean; negate: boolean }
interface Filter { key: FilterKey; values: string[]; negate: boolean; size?: { op: '<' | '>' | '<=' | '>='; bytes: number } }

export interface FileQuery {
  terms: Term[]
  filters: Filter[]
  /** The longest word or phrase, for a quick server-side search before the index
   *  is in (the server can only narrow by one contiguous string). */
  serverTerm: string
}

const compact = (s: string): string => s.replace(/ /g, '')

const TOKEN_RE = /(-?)(?:([a-zA-Z]+):)?(?:"([^"]*)"?|(\S+))/g

const UNITS: Record<string, number> = { b: 1, k: 1024, kb: 1024, m: 1024 ** 2, mb: 1024 ** 2, g: 1024 ** 3, gb: 1024 ** 3 }

function parseSize(raw: string): Filter['size'] | null {
  const m = /^(<=|>=|<|>)?\s*(\d+(?:\.\d+)?)\s*([kmg]?b?)?$/i.exec(raw.trim())
  if (!m) return null
  const unit = UNITS[(m[3] || 'mb').toLowerCase()]
  return unit ? { op: (m[1] as '<' | '>' | '<=' | '>=') || '>=', bytes: parseFloat(m[2]) * unit } : null
}

export function parseFileQuery(raw: string): FileQuery {
  const terms: Term[] = []
  const filters: Filter[] = []
  let serverTerm = ''
  for (const m of raw.matchAll(TOKEN_RE)) {
    const negate = m[1] === '-'
    const key = m[2] ? KEY_ALIASES[m[2].toLowerCase()] : undefined
    const quoted = m[3] !== undefined
    const value = (quoted ? m[3] : m[4]) ?? ''
    // "ext:" with nothing after it yet - mid-typing, filters nothing.
    if (!m[2] && /^[a-zA-Z]+:$/.test(value) && KEY_ALIASES[value.slice(0, -1).toLowerCase()]) continue
    if (m[2] && key) {
      if (key === 'size') {
        const size = parseSize(value)
        if (size) filters.push({ key, values: [], negate, size })
        continue
      }
      const values = value.split(',').map((v) => (key === 'ext' ? v.trim().toLowerCase().replace(/^\.?/, '.') : normalizeForSearch(v))).filter((v) => v && v !== '.')
      if (values.length) filters.push({ key, values, negate })
      continue
    }
    // An unknown "word:" stays plain text, so "5:30" or "pt:2" still search as typed.
    const asTyped = m[2] ? `${m[2]}:${value}` : value
    const text = normalizeForSearch(asTyped)
    if (!text) continue
    terms.push({ text, compact: compact(text), phrase: quoted, negate })
    // As typed, not normalized: searchFiles sends its own punctuation variants.
    if (!negate && asTyped.length > serverTerm.length) serverTerm = asTyped
  }
  return { terms, filters, serverTerm }
}

/** Whether the query asks for anything - a word to find or a filter. Only
 *  exclusions ("-remix") would list the whole tree, so that searches nothing. */
export function hasQuery(q: FileQuery): boolean {
  return q.terms.some((t) => !t.negate) || q.filters.length > 0
}

// ─── Index ────────────────────────────────────────────────────────────────────

interface Prepared {
  entry: JWApiFileEntry
  name: string
  nameCompact: string
  folder: string
  folderCompact: string
  folderParts: string[]
  words: string[]
  ext: string
  kind: string
}

export interface FileIndex { items: Prepared[]; vocab: string[] }

const INDEX_TTL_MS = 5 * 60_000
const indexes = new Map<string, { at: number; index: Promise<FileIndex | null> }>()

export function prepareFileIndex(raw: JWApiFileEntry[]): FileIndex {
  const folderCache = new Map<string, { text: string; compact: string; parts: string[] }>()
  const vocab = new Set<string>()
  const items = raw.map((entry): Prepared => {
    const slash = entry.path.lastIndexOf('/')
    const folderPath = slash > 0 ? entry.path.slice(0, slash) : ''
    let folder = folderCache.get(folderPath)
    if (!folder) {
      const parts = folderPath ? folderPath.split('/').map(normalizeForSearch) : []
      const text = parts.join(' ')
      folder = { text, compact: compact(text), parts }
      folderCache.set(folderPath, folder)
    }
    const name = normalizeForSearch(entry.name)
    const words = [...new Set(`${name} ${folder.text}`.split(' ').filter(Boolean))]
    for (const w of words) vocab.add(w)
    const ext = entry.type === 'directory' ? '' : getFileExt(entry.name)
    const kind = entry.type === 'directory' ? 'folder' : ARCHIVE_EXTS.has(ext) ? 'archive' : getMediaType(entry.name)
    return { entry, name, nameCompact: compact(name), folder: folder.text, folderCompact: folder.compact, folderParts: folder.parts, words, ext, kind }
  })
  return { items, vocab: [...vocab] }
}

/** The channel's whole file tree, prepared for searching. Null while the
 *  server is still building its index (or the call fails) - callers fall back
 *  to the plain server search. */
export function loadFileIndex(channel: string): Promise<FileIndex | null> {
  const hit = indexes.get(channel)
  if (hit && Date.now() - hit.at < INDEX_TTL_MS) return hit.index
  // Straight through apiRequest, not apiFetch: the response is ~9 MB of JSON,
  // far past what the offline cache stores, and stringifying it just to
  // find that out costs a noticeable stall.
  const index = apiRequest<{ items?: JWApiFileEntry[]; building?: boolean }>(apiUrl('/files/list-all/', { channel: channel || undefined }), { cache: 'no-cache' })
    .then((data) => (data.building && !data.items?.length ? null : prepareFileIndex(data.items ?? [])))
    .catch(() => null)
  index.then((r) => { if (!r) indexes.delete(channel) })
  indexes.set(channel, { at: Date.now(), index })
  return index
}

// ─── Matching ─────────────────────────────────────────────────────────────────

const textHas = (text: string, textCompact: string, t: Term): boolean =>
  text.includes(t.text) || (!t.phrase && textCompact.includes(t.compact))

function passesFilter(p: Prepared, f: Filter): boolean {
  let hit: boolean
  if (f.key === 'size') {
    const size = p.entry.type === 'directory' ? null : p.entry.size
    if (size == null || !f.size) hit = false
    else {
      const { op, bytes } = f.size
      hit = op === '<' ? size < bytes : op === '>' ? size > bytes : op === '<=' ? size <= bytes : size >= bytes
    }
  } else if (f.key === 'ext') hit = f.values.includes(p.ext)
  else if (f.key === 'type') hit = f.values.some((v) => { const k = TYPE_ALIASES[v] ?? v; return k === 'file' ? p.kind !== 'folder' : p.kind === k })
  else hit = f.values.some((v) => p.folderParts.some((part) => part.includes(v)))
  return f.negate ? !hit : hit
}

/** Whether `p` matches every term; `close` maps a term to the vocabulary words
 *  within its typo budget (fuzzy pass only). */
function matchesTerms(p: Prepared, positives: Term[], negatives: Term[], close?: Map<Term, Set<string>>): boolean {
  for (const t of negatives) if (textHas(p.name, p.nameCompact, t) || textHas(p.folder, p.folderCompact, t)) return false
  if (positives.length === 0) return true
  let inName = false
  for (const t of positives) {
    if (textHas(p.name, p.nameCompact, t)) { inName = true; continue }
    if (textHas(p.folder, p.folderCompact, t)) continue
    const near = close?.get(t)
    if (!near || !p.words.some((w) => near.has(w))) return false
    // A typo hit counts as "in the name" when the near word is one of its words.
    if (!inName && p.name.split(' ').some((w) => near.has(w))) inName = true
  }
  return inName
}

/** Vocabulary words a query word could be a typo of, or a typo'd start of. */
function closeWords(vocab: string[], term: string): Set<string> {
  const max = maxEdits(term.length)
  const out = new Set<string>()
  if (max === 0) return out
  for (const w of vocab) {
    if (withinEdits(w, term, max) || (w.length > term.length && withinEdits(w.slice(0, term.length), term, max))) out.add(w)
  }
  return out
}

export interface FileSearchResult {
  entries: JWApiFileEntry[]
  /** Matches before the display cap. */
  total: number
  /** Nothing matched exactly; these are typo-tolerant matches. */
  fuzzy: boolean
}

export const MAX_FILE_RESULTS = 1000

/** Searches entries already in hand (an index, or a server search's results)
 *  with the full syntax. `within` limits it to one folder and below. */
export function searchFileIndex(items: Prepared[] | JWApiFileEntry[], q: FileQuery, opts: { within?: string; vocab?: string[] } = {}): FileSearchResult {
  const prepared = (items.length && 'entry' in items[0] ? items : prepareFileIndex(items as JWApiFileEntry[]).items) as Prepared[]
  const prefix = opts.within ? `${opts.within.toLowerCase()}/` : ''
  const scoped = prefix ? prepared.filter((p) => p.entry.path.toLowerCase().startsWith(prefix)) : prepared
  const filtered = q.filters.length ? scoped.filter((p) => q.filters.every((f) => passesFilter(p, f))) : scoped
  const positives = q.terms.filter((t) => !t.negate)
  const negatives = q.terms.filter((t) => t.negate)

  let hits = filtered.filter((p) => matchesTerms(p, positives, negatives))
  let fuzzy = false
  const fuzzable = positives.filter((t) => !t.phrase && t.text.length >= 4 && !t.text.includes(' '))
  if (hits.length === 0 && fuzzable.length > 0) {
    const vocab = opts.vocab ?? [...new Set(filtered.flatMap((p) => p.words))]
    const close = new Map(fuzzable.map((t) => [t, closeWords(vocab, t.text)]))
    hits = filtered.filter((p) => matchesTerms(p, positives, negatives, close))
    fuzzy = hits.length > 0
  }
  return { entries: hits.slice(0, MAX_FILE_RESULTS).map((p) => p.entry), total: hits.length, fuzzy }
}

const NO_RESULTS: FileSearchResult = { entries: [], total: 0, fuzzy: false }

/** One-shot search with the full syntax: the channel's index when it's
 *  available, else the plain server search on the query's longest word,
 *  filtered through the same syntax (no typo fallback beyond what it found). */
export async function runFileSearch(raw: string, channel: string, within?: string): Promise<FileSearchResult> {
  const q = parseFileQuery(raw)
  if (!hasQuery(q)) return NO_RESULTS
  const index = await loadFileIndex(channel)
  if (index) return searchFileIndex(index.items, q, { within, vocab: index.vocab })
  if (!q.serverTerm) return NO_RESULTS
  const extra: Record<string, string> = {}
  if (channel) extra.channel = channel
  if (within) extra.path = within
  return searchFileIndex(await searchFiles(q.serverTerm, extra), q)
}
