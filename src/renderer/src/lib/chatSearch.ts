import type { ChatMessage, ChatUserBrief } from './chatApi'
import { splitForwardRef } from './chatForwardRef'
import { splitReplyRef } from './chatReplyRef'
import {
  decodeLocalNotice, decodeNewsShare, decodePlaylistShare, decodeSongInfoShare,
  decodeSongShare, decodeThemeShare, isModerationNotice,
} from './chatShare'

// Chat search is entirely client-side: DMs are end-to-end encrypted, so the
// server can never see the text to index. This file is the pure part - parse a
// query string into clauses, compile them against a context, and test messages.
// Loading and decrypting the messages lives in chatSearchIndex.ts.

export type FilterKey = 'from' | 'mentions' | 'has' | 'in' | 'before' | 'after' | 'on' | 'is'

const KEY_ALIASES: Record<string, FilterKey> = {
  from: 'from', author: 'from', by: 'from', sender: 'from',
  mentions: 'mentions', mention: 'mentions', mentioning: 'mentions',
  has: 'has', includes: 'has', include: 'has', with: 'has',
  in: 'in', channel: 'in', chat: 'in',
  before: 'before', until: 'before',
  after: 'after', since: 'after',
  on: 'on', during: 'on', date: 'on',
  is: 'is',
}

// What the autocomplete offers for a bare prefix; `includes` is listed because
// it is the spelling people reach for first.
const SUGGESTED_KEYS = ['from', 'mentions', 'has', 'includes', 'in', 'before', 'after', 'on', 'is']

export const FILTER_HELP: { key: FilterKey; example: string; blurb: string }[] = [
  { key: 'from', example: 'from:me', blurb: 'Messages by a person' },
  { key: 'mentions', example: 'mentions:me', blurb: 'Messages that @mention someone' },
  { key: 'has', example: 'includes:img', blurb: 'Images, video, links, files, songs…' },
  { key: 'in', example: 'in:general', blurb: 'Only one channel or conversation' },
  { key: 'before', example: 'before:2025-06-01', blurb: 'Sent before a date' },
  { key: 'after', example: 'after:7d', blurb: 'Sent after a date (7d, 2w, 3m, today…)' },
  { key: 'on', example: 'on:yesterday', blurb: 'Sent on a specific day' },
  { key: 'is', example: 'is:pinned', blurb: 'Pinned, edited, reply, thread, mine' },
]

// Canonical flag -> accepted spellings. `has:` and `is:` share one table: both
// are "does this message have property X", only the wording differs.
const FLAGS: { name: string; aliases: string[]; hint: string }[] = [
  { name: 'image', aliases: ['img', 'images', 'photo', 'photos', 'pic', 'pics', 'picture', 'pictures'], hint: 'Pictures, GIFs and image links' },
  { name: 'gif', aliases: ['gifs'], hint: 'Animated GIFs' },
  { name: 'video', aliases: ['videos', 'vid', 'movie', 'clip'], hint: 'Video files' },
  { name: 'audio', aliases: ['sound', 'music', 'voice', 'mp3'], hint: 'Audio files' },
  { name: 'file', aliases: ['files', 'doc', 'docs', 'document'], hint: 'Non-media attachments' },
  { name: 'attachment', aliases: ['attachments', 'upload', 'uploads', 'media'], hint: 'Anything uploaded' },
  { name: 'link', aliases: ['links', 'url', 'urls'], hint: 'Contains a web link' },
  { name: 'embed', aliases: ['embeds'], hint: 'Link or shared card' },
  { name: 'song', aliases: ['songs', 'track', 'tracks'], hint: 'A shared song' },
  { name: 'playlist', aliases: ['playlists'], hint: 'A shared playlist' },
  { name: 'news', aliases: [], hint: 'A shared news post' },
  { name: 'theme', aliases: ['themes', 'skin'], hint: 'A shared theme' },
  { name: 'code', aliases: ['snippet'], hint: 'Code or inline code' },
  { name: 'mention', aliases: ['mentions', 'ping'], hint: 'Mentions anyone' },
  { name: 'reaction', aliases: ['reactions', 'react'], hint: 'Has emoji reactions' },
  { name: 'reply', aliases: ['replies', 'replied'], hint: 'A reply to another message' },
  { name: 'thread', aliases: ['threads'], hint: 'Started a thread' },
  { name: 'pinned', aliases: ['pin', 'pins'], hint: 'Pinned messages' },
  { name: 'edited', aliases: ['edit', 'edits'], hint: 'Edited after sending' },
  { name: 'mine', aliases: ['me', 'own', 'my'], hint: 'Sent by you' },
]

const FLAG_BY_NAME = new Map<string, string>()
for (const f of FLAGS) {
  FLAG_BY_NAME.set(f.name, f.name)
  for (const a of f.aliases) FLAG_BY_NAME.set(a, f.name)
}
export const FLAG_NAMES = FLAGS.map((f) => f.name)
export const flagHint = (name: string): string => FLAGS.find((f) => f.name === name)?.hint ?? ''

export const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ---------------------------------------------------------------- tokens

export interface Token {
  start: number
  end: number
  raw: string
  negate: boolean
  key: FilterKey | null
  // A `key:` with nothing after it yet - the user is mid-typing; it filters
  // nothing and the autocomplete offers values for it.
  partial: boolean
  // For a filter these are the comma-separated alternatives; for text, the term.
  values: string[]
  phrase: boolean
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = input.length
  while (i < n) {
    while (i < n && /\s/.test(input[i])) i++
    if (i >= n) break
    const start = i
    let quoted = false
    let buf = ''
    // Parts of the token that were inside quotes, so `from:"Jo Smith"` keeps
    // its space but a stray quote mid-word is just a character.
    while (i < n && (quoted || !/\s/.test(input[i]))) {
      const ch = input[i]
      if (ch === '"') quoted = !quoted
      else buf += ch
      i++
    }
    const end = i
    const raw = input.slice(start, end)
    let body = buf
    let negate = false
    if (body.startsWith('-') && body.length > 1) { negate = true; body = body.slice(1) }
    const m = /^([a-zA-Z]+):(.*)$/s.exec(body)
    const key = m ? KEY_ALIASES[m[1].toLowerCase()] ?? null : null
    if (m && key) {
      const rest = m[2].trim()
      tokens.push({
        start, end, raw, negate, key,
        partial: rest === '',
        values: rest === '' ? [] : rest.split(',').map((v) => v.trim()).filter(Boolean),
        phrase: false,
      })
    } else {
      const phrase = raw.replace(/^-/, '').startsWith('"')
      const text = body.trim()
      if (text) tokens.push({ start, end, raw, negate, key: null, partial: false, values: [text], phrase })
    }
  }
  return tokens
}

// ---------------------------------------------------------------- facts

export interface AttachmentFact {
  name: string
  mime: string
  kind: 'image' | 'video' | 'audio' | 'file'
  gif: boolean
  // Encrypted attachment whose real name/type hasn't been decrypted yet.
  unresolved: boolean
}

export interface Facts {
  m: ChatMessage
  text: string
  // false => encrypted and we have no key / it failed to decrypt
  readable: boolean
  roomNames: string[]
  isConversation: boolean
  atts: AttachmentFact[]
  links: string[]
  haystack: string
  shares: Set<string>
  hasCode: boolean
  hasEveryone: boolean
  isReply: boolean
  mentionedHandles: string[]
}

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'heic']
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi']
const AUDIO_EXT = ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'opus', 'aac']
const extOf = (name: string): string => name.split('?')[0].split('.').pop()?.toLowerCase() ?? ''

export function attachmentFact(name: string, mime: string, unresolved: boolean): AttachmentFact {
  const mm = mime.toLowerCase()
  const ext = extOf(name)
  let kind: AttachmentFact['kind'] = 'file'
  if (mm.startsWith('image/') || IMAGE_EXT.includes(ext)) kind = 'image'
  else if (mm.startsWith('video/') || VIDEO_EXT.includes(ext)) kind = 'video'
  else if (mm.startsWith('audio/') || AUDIO_EXT.includes(ext)) kind = 'audio'
  return { name, mime, kind, gif: mm === 'image/gif' || ext === 'gif', unresolved }
}

const URL_RE = /https?:\/\/[^\s<>()"]+/gi
const GIF_HOSTS = /(^|\.)(tenor\.com|giphy\.com|media\.tenor\.com|gfycat\.com)$/i

function linkIsImage(url: string): boolean {
  try {
    const u = new URL(url)
    return IMAGE_EXT.includes(extOf(u.pathname)) || GIF_HOSTS.test(u.hostname)
  } catch { return false }
}
function linkIsGif(url: string): boolean {
  try {
    const u = new URL(url)
    return extOf(u.pathname) === 'gif' || GIF_HOSTS.test(u.hostname)
  } catch { return false }
}

// The searchable body of a message: reply/forward envelopes removed, and the
// app's own share payloads (which are protocol strings, not prose) classified
// instead of searched as text.
export function bodyOf(raw: string): { text: string; shares: Set<string>; isReply: boolean } {
  const shares = new Set<string>()
  if (isModerationNotice(raw) || decodeLocalNotice(raw)) return { text: '', shares, isReply: false }
  const fwd = splitForwardRef(raw)
  const rep = splitReplyRef(fwd.body)
  const text = rep.body
  if (decodeSongShare(text) || decodeSongInfoShare(text)) shares.add('song')
  if (decodePlaylistShare(text)) shares.add('playlist')
  if (decodeNewsShare(text)) shares.add('news')
  if (decodeThemeShare(text)) shares.add('theme')
  return { text: shares.size ? '' : text, shares, isReply: !!rep.ref }
}

export function buildFacts(
  m: ChatMessage,
  rawText: string | null,
  roomNames: string[],
  attMeta: (id: number) => { name: string; mime: string } | null,
): Facts {
  const readable = rawText !== null
  const { text, shares, isReply } = bodyOf(rawText ?? '')
  const atts = m.attachments.map((a) => {
    if (m.is_encrypted) {
      const meta = attMeta(a.id)
      return meta ? attachmentFact(meta.name, meta.mime, false) : attachmentFact('attachment', 'application/octet-stream', true)
    }
    return attachmentFact(a.name, a.mime, false)
  })
  const links = text.match(URL_RE) ?? []
  const handles = [...text.matchAll(/(?:^|[\s(])@([^\s@,.;:!?()]+)/g)].map((x) => fold(x[1]))
  return {
    m, text, readable, roomNames, isConversation: m.conversation != null, atts, links, shares,
    hasCode: /```|`[^`\n]+`/.test(text),
    hasEveryone: handles.includes('everyone'),
    isReply: isReply || m.parent != null,
    mentionedHandles: handles,
    haystack: fold([text, ...atts.map((a) => a.name), ...links].join('\n')),
  }
}

// ---------------------------------------------------------------- dates

const DAY = 86_400_000
const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

// Returns [start, end) in ms, or null when the value isn't a date we know.
export function parseDateRange(value: string, now = Date.now()): [number, number] | null {
  const v = value.trim().toLowerCase()
  const today = startOfDay(new Date(now))
  if (v === 'today') return [today, today + DAY]
  if (v === 'yesterday') return [today - DAY, today]
  const rel = /^(\d+)\s*(d|w|m|y|day|days|week|weeks|month|months|year|years)(?:\s*ago)?$/.exec(v)
  if (rel) {
    const k = Number(rel[1])
    const unit = rel[2][0]
    const d = new Date(today)
    if (unit === 'd') d.setDate(d.getDate() - k)
    else if (unit === 'w') d.setDate(d.getDate() - k * 7)
    else if (unit === 'm') d.setMonth(d.getMonth() - k)
    else d.setFullYear(d.getFullYear() - k)
    return [d.getTime(), d.getTime() + DAY]
  }
  const iso = /^(\d{4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?$/.exec(v)
  if (iso) {
    const y = Number(iso[1])
    const mo = iso[2] ? Number(iso[2]) - 1 : null
    const da = iso[3] ? Number(iso[3]) : null
    if (mo !== null && (mo < 0 || mo > 11)) return null
    if (da !== null && (da < 1 || da > 31)) return null
    if (mo === null) return [new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()]
    if (da === null) return [new Date(y, mo, 1).getTime(), new Date(y, mo + 1, 1).getTime()]
    const s = new Date(y, mo, da).getTime()
    return [s, new Date(y, mo, da + 1).getTime()]
  }
  const parsed = Date.parse(value)
  if (!Number.isNaN(parsed)) { const s = startOfDay(new Date(parsed)); return [s, s + DAY] }
  return null
}

// ---------------------------------------------------------------- compile

export interface SearchContext {
  meId: number | null
  users: ChatUserBrief[]
  now?: number
}

export interface Clause {
  token: Token
  negate: boolean
  key: FilterKey | null
  // Human label for the chip: "from Alice", "has image", "after 7d".
  label: string
  // Set when the filter's value can't be understood. Such a clause matches
  // nothing, so a typo shows "no results" instead of silently widening.
  error: string | null
  test: ((f: Facts) => boolean) | null
}

export interface Compiled {
  clauses: Clause[]
  terms: string[]
  active: boolean
  hasError: boolean
}

function resolveUsers(value: string, ctx: SearchContext): ChatUserBrief[] {
  const v = fold(value.replace(/^@/, ''))
  if (!v) return []
  if (v === 'me' || v === 'myself' || v === 'i') return ctx.users.filter((u) => u.id === ctx.meId)
  const names = (u: ChatUserBrief): string[] => [fold(u.username ?? ''), fold(u.display_name ?? '')].filter(Boolean)
  const exact = ctx.users.filter((u) => names(u).includes(v))
  if (exact.length) return exact
  const prefix = ctx.users.filter((u) => names(u).some((n) => n.startsWith(v)))
  if (prefix.length) return prefix
  return ctx.users.filter((u) => names(u).some((n) => n.includes(v)))
}

const userLabel = (u: ChatUserBrief): string => u.display_name || u.username

function flagTest(name: string, ctx: SearchContext): (f: Facts) => boolean {
  switch (name) {
    case 'image': return (f) => f.atts.some((a) => a.kind === 'image') || f.links.some(linkIsImage)
    case 'gif': return (f) => f.atts.some((a) => a.gif) || f.links.some(linkIsGif)
    case 'video': return (f) => f.atts.some((a) => a.kind === 'video')
    case 'audio': return (f) => f.atts.some((a) => a.kind === 'audio')
    case 'file': return (f) => f.atts.some((a) => a.kind === 'file')
    case 'attachment': return (f) => f.atts.length > 0
    case 'link': return (f) => f.links.length > 0
    case 'embed': return (f) => f.links.length > 0 || f.shares.size > 0
    case 'song': return (f) => f.shares.has('song')
    case 'playlist': return (f) => f.shares.has('playlist')
    case 'news': return (f) => f.shares.has('news')
    case 'theme': return (f) => f.shares.has('theme')
    case 'code': return (f) => f.hasCode
    case 'mention': return (f) => f.m.mentions.length > 0 || f.mentionedHandles.length > 0
    case 'reaction': return (f) => f.m.reactions.some((r) => r.count > 0)
    case 'reply': return (f) => f.isReply
    case 'thread': return (f) => f.m.reply_count > 0
    case 'pinned': return (f) => f.m.pinned
    case 'edited': return (f) => !!f.m.edited_at
    case 'mine': return (f) => f.m.author.id === ctx.meId
    default: return () => false
  }
}

function compileFilter(t: Token, ctx: SearchContext): Pick<Clause, 'label' | 'error' | 'test'> {
  const key = t.key!
  const joined = t.values.join(', ')
  const fail = (error: string): Pick<Clause, 'label' | 'error' | 'test'> => ({ label: `${key} ${joined}`, error, test: null })
  switch (key) {
    case 'from': {
      const people = t.values.flatMap((v) => resolveUsers(v, ctx))
      if (!people.length) return fail(`No one named “${joined}”`)
      const ids = new Set(people.map((p) => p.id))
      return { label: `from ${[...new Map(people.map((p) => [p.id, userLabel(p)])).values()].slice(0, 3).join(', ')}`, error: null, test: (f) => ids.has(f.m.author.id) }
    }
    case 'mentions': {
      const everyone = t.values.some((v) => fold(v.replace(/^@/, '')) === 'everyone')
      const people = t.values.flatMap((v) => resolveUsers(v, ctx))
      if (!people.length && !everyone) return fail(`No one named “${joined}”`)
      const ids = new Set(people.map((p) => p.id))
      const handles = new Set(people.flatMap((p) => [fold(p.username ?? ''), fold(p.display_name ?? '')]).filter(Boolean))
      const names = [...new Map(people.map((p) => [p.id, userLabel(p)])).values()]
      if (everyone) names.push('everyone')
      return {
        label: `mentions ${names.slice(0, 3).join(', ')}`, error: null,
        test: (f) => f.m.mentions.some((id) => ids.has(id))
          || f.mentionedHandles.some((h) => handles.has(h))
          || (everyone && f.hasEveryone),
      }
    }
    case 'has':
    case 'is': {
      const names: string[] = []
      for (const v of t.values) {
        const canon = FLAG_BY_NAME.get(fold(v))
        if (!canon) return fail(`Unknown “${v}” - try ${FLAG_NAMES.slice(0, 5).join(', ')}…`)
        names.push(canon)
      }
      const tests = names.map((n) => flagTest(n, ctx))
      return { label: `${key} ${names.join(', ')}`, error: null, test: (f) => tests.some((fn) => fn(f)) }
    }
    case 'in': {
      const wanted = t.values.map((v) => fold(v.replace(/^#/, '')))
      return {
        label: `in ${t.values.map((v) => v.replace(/^#/, '')).join(', ')}`, error: null,
        test: (f) => wanted.some((w) => {
          if (w === 'dm' || w === 'dms') return f.isConversation
          if (w === 'channels') return !f.isConversation
          return f.roomNames.some((r) => fold(r).includes(w))
        }),
      }
    }
    case 'before':
    case 'after':
    case 'on': {
      const ranges = t.values.map((v) => parseDateRange(v, ctx.now))
      if (ranges.some((r) => !r)) return fail(`Not a date: “${joined}” - try 2025-06-01, 7d or yesterday`)
      const rs = ranges as [number, number][]
      const ts = (f: Facts): number => new Date(f.m.created_at).getTime()
      const test = key === 'before' ? (f: Facts) => rs.some(([s]) => ts(f) < s)
        : key === 'after' ? (f: Facts) => rs.some(([, e]) => ts(f) >= e)
        : (f: Facts) => rs.some(([s, e]) => ts(f) >= s && ts(f) < e)
      return { label: `${key} ${joined}`, error: null, test }
    }
  }
}

export function compileQuery(query: string, ctx: SearchContext): Compiled {
  const clauses: Clause[] = []
  const terms: string[] = []
  for (const token of tokenize(query)) {
    if (token.key) {
      if (token.partial) continue
      const c = compileFilter(token, ctx)
      clauses.push({ token, negate: token.negate, key: token.key, ...c })
    } else {
      const term = fold(token.values[0])
      if (!term) continue
      if (!token.negate) terms.push(token.values[0])
      clauses.push({
        token, negate: token.negate, key: null,
        label: token.phrase ? `“${token.values[0]}”` : token.values[0], error: null,
        test: (f) => f.haystack.includes(term),
      })
    }
  }
  return { clauses, terms, active: clauses.length > 0, hasError: clauses.some((c) => c.error) }
}

export function matches(compiled: Compiled, f: Facts): boolean {
  if (f.m.deleted_at) return false
  for (const c of compiled.clauses) {
    if (!c.test) return false
    const ok = c.test(f)
    if (c.negate ? ok : !ok) return false
  }
  return true
}

// ---------------------------------------------------------------- snippets

export interface Snippet { parts: { text: string; hit: boolean }[] }

export function snippetOf(text: string, terms: string[], max = 220): Snippet {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return { parts: [] }
  const pieces = [...new Set(terms.map((t) => t.trim()).filter(Boolean))].sort((a, b) => b.length - a.length)
  let re: RegExp | null = null
  try { if (pieces.length) re = new RegExp(pieces.map(escapeRe).join('|'), 'gi') } catch { re = null }
  let from = 0
  let to = flat.length
  if (flat.length > max) {
    const first = re ? flat.search(re) : -1
    from = Math.max(0, Math.min(first < 0 ? 0 : first - 60, flat.length - max))
    to = Math.min(flat.length, from + max)
  }
  const slice = flat.slice(from, to)
  const parts: Snippet['parts'] = []
  if (from > 0) parts.push({ text: '…', hit: false })
  if (re) {
    let last = 0
    re.lastIndex = 0
    for (let m = re.exec(slice); m; m = re.exec(slice)) {
      if (m[0] === '') { re.lastIndex++; continue }
      if (m.index > last) parts.push({ text: slice.slice(last, m.index), hit: false })
      parts.push({ text: m[0], hit: true })
      last = m.index + m[0].length
    }
    if (last < slice.length) parts.push({ text: slice.slice(last), hit: false })
  } else {
    parts.push({ text: slice, hit: false })
  }
  if (to < flat.length) parts.push({ text: '…', hit: false })
  return { parts }
}

// ---------------------------------------------------------------- autocomplete

export interface Suggestion {
  label: string
  detail?: string
  // Replacement for the whole token under the caret (no trailing space).
  insert: string
  // true => the token is finished, so add a space after it
  done: boolean
  kind: 'key' | 'user' | 'room' | 'flag' | 'date'
}

export interface SuggestSources {
  users: ChatUserBrief[]
  rooms: string[]
}

export function tokenAtCaret(input: string, caret: number): { start: number; end: number; text: string } {
  // Scan by whitespace (quotes aside) so an in-progress `"half phrase` still counts.
  let i = 0
  const n = input.length
  while (i < n) {
    while (i < n && /\s/.test(input[i])) i++
    const start = i
    let quoted = false
    while (i < n && (quoted || !/\s/.test(input[i]))) { if (input[i] === '"') quoted = !quoted; i++ }
    if (caret >= start && caret <= i && i > start) return { start, end: i, text: input.slice(start, i) }
  }
  return { start: caret, end: caret, text: '' }
}

const DATE_PRESETS: [string, string][] = [
  ['today', 'Since midnight'], ['yesterday', 'The day before'], ['7d', '7 days ago'],
  ['30d', '30 days ago'], ['3m', '3 months ago'], ['1y', 'A year ago'],
]

const needsQuote = (v: string): boolean => /\s/.test(v)
const q = (v: string): string => (needsQuote(v) ? `"${v}"` : v)

export function suggest(input: string, caret: number, src: SuggestSources, limit = 8): { range: [number, number]; items: Suggestion[] } {
  const tok = tokenAtCaret(input, caret)
  const range: [number, number] = [tok.start, tok.end]
  if (!tok.text) return { range, items: [] }
  const neg = tok.text.startsWith('-')
  const body = neg ? tok.text.slice(1) : tok.text
  const prefix = neg ? '-' : ''
  const colon = body.indexOf(':')

  if (colon < 0) {
    if (body.startsWith('"') || body.length < 1) return { range, items: [] }
    const b = fold(body)
    const items = SUGGESTED_KEYS.filter((k) => k.startsWith(b) && k !== b)
      .map<Suggestion>((k) => ({ label: `${k}:`, detail: FILTER_HELP.find((h) => h.key === (KEY_ALIASES[k]))?.blurb, insert: `${prefix}${k}:`, done: false, kind: 'key' }))
    return { range, items: items.slice(0, limit) }
  }

  const key = KEY_ALIASES[body.slice(0, colon).toLowerCase()]
  if (!key) return { range, items: [] }
  const keyText = body.slice(0, colon)
  const valuePart = body.slice(colon + 1)
  const lastComma = valuePart.lastIndexOf(',')
  const head = lastComma >= 0 ? valuePart.slice(0, lastComma + 1) : ''
  const typed = fold(valuePart.slice(lastComma + 1).replace(/^"/, '').replace(/^[@#]/, ''))
  const chosen = new Set(head.split(',').map((x) => fold(x)).filter(Boolean))
  const build = (value: string, detail: string | undefined, kind: Suggestion['kind'], multi: boolean): Suggestion => ({
    label: value, detail, kind, done: !multi,
    insert: `${prefix}${keyText}:${head}${q(value)}`,
  })

  let items: Suggestion[] = []
  if (key === 'from' || key === 'mentions') {
    const seen = new Set<string>()
    const list: Suggestion[] = []
    const add = (value: string, detail: string | undefined): void => {
      if (seen.has(value) || chosen.has(fold(value))) return
      seen.add(value)
      list.push(build(value, detail, 'user', true))
    }
    if ('me'.startsWith(typed)) add('me', 'You')
    if (key === 'mentions' && 'everyone'.startsWith(typed)) add('everyone', '@everyone pings')
    for (const u of src.users) {
      if (!u.username) continue
      const hay = [fold(u.username), fold(u.display_name ?? '')]
      if (!typed || hay.some((h) => h.startsWith(typed)) || hay.some((h) => h.includes(typed))) {
        add(u.username, u.display_name && u.display_name !== u.username ? u.display_name : undefined)
      }
    }
    items = list.sort((a, b) => Number(!fold(a.label).startsWith(typed)) - Number(!fold(b.label).startsWith(typed)))
  } else if (key === 'in') {
    const names = [...new Set(src.rooms)]
    items = names.filter((r) => !chosen.has(fold(r)) && (!typed || fold(r).includes(typed)))
      .map((r) => build(r, undefined, 'room', true))
    for (const special of ['dms', 'channels']) {
      if (special.startsWith(typed) && !chosen.has(special)) items.push(build(special, special === 'dms' ? 'Only direct messages' : 'Only server channels', 'room', true))
    }
  } else if (key === 'has' || key === 'is') {
    items = FLAGS.filter((f) => !chosen.has(f.name) && (!typed || f.name.startsWith(typed) || f.aliases.some((a) => a.startsWith(typed))))
      .map((f) => build(f.name, f.hint, 'flag', true))
  } else {
    items = DATE_PRESETS.filter(([p]) => !typed || p.startsWith(typed)).map(([p, d]) => build(p, d, 'date', false))
    const today = new Date()
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    if (!typed || iso.startsWith(typed)) items.push(build(iso, 'Today, as a date', 'date', false))
  }
  // Don't offer exactly what's already typed.
  items = items.filter((s) => s.insert !== tok.text)
  return { range, items: items.slice(0, limit) }
}

// Toggle a `key:value` token in the query - used by the quick-filter chips.
export function hasToken(query: string, token: string): boolean {
  const want = token.toLowerCase()
  return tokenize(query).some((t) => !t.negate && t.raw.toLowerCase() === want)
}

export function toggleToken(query: string, token: string): string {
  const want = token.toLowerCase()
  const found = tokenize(query).find((t) => !t.negate && t.raw.toLowerCase() === want)
  if (found) return (query.slice(0, found.start) + query.slice(found.end)).replace(/\s{2,}/g, ' ').trim()
  return `${query.trim()} ${token}`.trim()
}

export function removeToken(query: string, token: Token): string {
  return (query.slice(0, token.start) + query.slice(token.end)).replace(/\s{2,}/g, ' ').trim()
}
