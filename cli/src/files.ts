import { formatBytes } from 'site:format'
import { apiFetch, fetchStream, streamUrl } from './api'

// The Node side of the site's lib/terminalFiles.ts: the Files tab as a little
// filesystem. The root lists the file channels, a channel is a directory, and
// below that it's the tree /files/browse/ serves. The site's file tools
// (terminalFileTools.ts) are compiled against this module in place of the
// browser one, so the exports they use keep the same names and shapes.

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number | null
  modified?: string | null
}

export interface FilesCwd {
  /** Channel slug, or null at the root where the channels are listed. */
  channel: string | null
  /** Folder names below the channel root. */
  dir: string[]
}

export const FILES_ROOT: FilesCwd = { channel: null, dir: [] }

export interface FsEntry {
  name: string
  type: 'file' | 'directory'
  size?: number | null
  entry?: FileEntry
}

export interface Channel { slug: string; name: string; description?: string; is_primary?: boolean }

const LIST_TTL_MS = 60_000
const listCache = new Map<string, { at: number; entries: FsEntry[] }>()
let channelCache: { at: number; channels: Channel[] } | null = null

const norm = (s: string): string => s.trim().toLowerCase()

export function unquote(s: string): string {
  const t = s.trim()
  return (t.startsWith('"') && t.endsWith('"') && t.length > 1) || (t.startsWith("'") && t.endsWith("'") && t.length > 1) ? t.slice(1, -1) : t
}

export function filesPathString(cwd: FilesCwd): string {
  return `~/files${cwd.channel ? `/${[cwd.channel, ...cwd.dir].join('/')}` : ''}`
}

export async function channelList(fresh = false): Promise<Channel[]> {
  if (!fresh && channelCache && Date.now() - channelCache.at < LIST_TTL_MS) return channelCache.channels
  const data = await apiFetch<{ channels?: Channel[] }>('/files/channels/')
  channelCache = { at: Date.now(), channels: data?.channels ?? [] }
  return channelCache.channels
}

/** Where the shell starts and `cd` / `cd ~` go: the primary channel, the one
 *  the Files tab opens on (the site's `cd files` lands in the open one). */
export async function homeCwd(): Promise<FilesCwd> {
  const channels = await channelList()
  const home = channels.find((c) => c.is_primary) ?? channels[0]
  return home ? { channel: home.slug, dir: [] } : FILES_ROOT
}

type BrowseResponse = FileEntry[] | { items: FileEntry[] }
const browseEntries = (data: BrowseResponse): FileEntry[] => (Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [])

const byListingOrder = (a: FsEntry, b: FsEntry): number =>
  a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.type === 'directory' ? -1 : 1

export async function listDir(cwd: FilesCwd, fresh = false): Promise<FsEntry[]> {
  if (cwd.channel === null) {
    return (await channelList(fresh)).map((c) => ({ name: c.slug, type: 'directory' as const }))
  }
  const key = `${cwd.channel}:${cwd.dir.join('/')}`
  const hit = listCache.get(key)
  if (!fresh && hit && Date.now() - hit.at < LIST_TTL_MS) return hit.entries
  const data = await apiFetch<BrowseResponse>('/files/browse/', { path: cwd.dir.join('/') || undefined, channel: cwd.channel })
  const entries = browseEntries(data).map((e): FsEntry => ({ name: e.name, type: e.type, size: e.size, entry: e })).sort(byListingOrder)
  listCache.set(key, { at: Date.now(), entries })
  return entries
}

/** Every file and folder under `path` from one /files/list-all/ request.
 *  Null while the server is still building its index. */
export async function listSubtree(path: string, channel: string): Promise<FileEntry[] | null> {
  const data = await apiFetch<{ items?: FileEntry[]; building?: boolean }>('/files/list-all/', { path: path || undefined, channel })
  if (data.building && !data.items?.length) return null
  return data.items ?? []
}

/** Every file (not folder) under `path`, one /files/browse/ call per folder -
 *  the fallback when list-all isn't ready. */
export async function listFilesRecursive(path: string, channel: string): Promise<FileEntry[]> {
  const entries = browseEntries(await apiFetch<BrowseResponse>('/files/browse/', { path: path || undefined, channel }))
  const files: FileEntry[] = []
  for (const entry of entries) {
    if (entry.type === 'file') files.push(entry)
    else files.push(...await listFilesRecursive(entry.path, channel))
  }
  return files
}

const treeCache = new Map<string, { at: number; items: { rel: string[]; entry: FsEntry }[] }>()

/** Everything below `cwd` with paths relative to it (cached a minute), or null
 *  when the server has no index ready yet so the caller walks folder by folder. */
export async function listSubtreeFlat(cwd: FilesCwd): Promise<{ rel: string[]; entry: FsEntry }[] | null> {
  if (cwd.channel === null) return null
  const base = cwd.dir.join('/')
  const key = `${cwd.channel}:${base}`
  const hit = treeCache.get(key)
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.items
  let raw: FileEntry[] | null
  try { raw = await listSubtree(base, cwd.channel) } catch { return null }
  if (raw === null) return null
  const prefix = base ? `${base.toLowerCase()}/` : ''
  const items: { rel: string[]; entry: FsEntry }[] = []
  for (const e of raw) {
    if (prefix && !e.path.toLowerCase().startsWith(prefix)) continue
    items.push({ rel: e.path.slice(prefix.length).split('/'), entry: { name: e.name, type: e.type, size: e.size, entry: e } })
  }
  // Folders before files, then natural name order, at every level.
  const kind = (it: { rel: string[]; entry: FsEntry }, i: number): string => (i < it.rel.length - 1 ? 'directory' : it.entry.type)
  items.sort((a, b) => {
    for (let i = 0; ; i++) {
      if (i >= a.rel.length) return -1
      if (i >= b.rel.length) return 1
      if (a.rel[i] === b.rel[i]) continue
      const ka = kind(a, i)
      const kb = kind(b, i)
      if (ka !== kb) return ka === 'directory' ? -1 : 1
      return a.rel[i].localeCompare(b.rel[i], undefined, { numeric: true, sensitivity: 'base' })
    }
  })
  treeCache.set(key, { at: Date.now(), items })
  return items
}

/** Walks `input` ("..", "a/b", "/", "/chan/a", "~/files/chan/a") from `cwd`,
 *  checking every step against the real listing (case-insensitive) and
 *  returning the properly-cased result. */
export async function resolveDir(cwd: FilesCwd, input: string): Promise<FilesCwd> {
  // The prompt shows ~/files/..., so a path pasted from it means the root.
  const raw = unquote(input).replace(/^~\/files(?=\/|$)/i, '/')
  let at: FilesCwd = raw.startsWith('/') ? FILES_ROOT : { channel: cwd.channel, dir: [...cwd.dir] }
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      at = at.dir.length > 0 ? { channel: at.channel, dir: at.dir.slice(0, -1) } : FILES_ROOT
      continue
    }
    const match = (await listDir(at)).find((e) => e.type === 'directory' && norm(e.name) === norm(part))
    if (!match) throw new Error(`${input.trim()}: no such directory`)
    at = at.channel === null ? { channel: match.name, dir: [] } : { channel: at.channel, dir: [...at.dir, match.name] }
  }
  return at
}

/** The listing `ls` prints: folders first, size on the left. */
export function formatListing(entries: FsEntry[], cwd: FilesCwd, limit = Infinity): string {
  if (entries.length === 0) return '(empty)'
  const shown = entries.slice(0, limit)
  const lines = shown.map((e) => {
    if (cwd.channel === null) return e.name + '/'
    const size = e.type === 'directory' ? '<dir>' : e.size != null ? formatBytes(e.size) : '-'
    return `${size.padStart(10)}  ${e.name}${e.type === 'directory' ? '/' : ''}`
  })
  if (entries.length > shown.length) lines.push(`… ${entries.length - shown.length} more`)
  return lines.join('\n')
}

/** Splits "a/b/pre" into the folder to list and the prefix being typed. */
export function splitTyped(arg: string): { dirPart: string; prefix: string } {
  const slash = arg.lastIndexOf('/')
  return slash === -1 ? { dirPart: '', prefix: arg } : { dirPart: arg.slice(0, slash + 1), prefix: arg.slice(slash + 1) }
}

const TEXT_MAX_BYTES = 2 * 1024 * 1024

/** A file's text the way the Files tab's viewer loads it: 2 MB cap, binary
 *  files refused. `cmd` and `label` only shape the error. */
export async function fetchEntryText(entry: FileEntry, channel: string, cmd: string, label: string): Promise<string> {
  let res: Response
  try { res = await fetchStream(streamUrl(entry.path, channel)) } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new Error(`${cmd}: ${label}: couldn't load (${(err as Error).message})`)
  }
  const buf = await res.arrayBuffer()
  if (buf.byteLength > TEXT_MAX_BYTES) throw new Error(`${cmd}: ${label}: too large (${formatBytes(buf.byteLength)}, limit ${formatBytes(TEXT_MAX_BYTES)})`)
  const bytes = new Uint8Array(buf)
  if (bytes.subarray(0, 8000).includes(0)) throw new Error(`${cmd}: ${label}: looks like a binary file`)
  return new TextDecoder('utf-8').decode(bytes)
}

/** Finds `typed` ("name", "a/b/name", "/chan/a/name") from `cwd`: the folder
 *  it sits in, and the entry itself (null when nothing by that name is there). */
export async function lookupEntry(cwd: FilesCwd, typedArg: string, cmd: string): Promise<{ parent: FilesCwd; leaf: string; entry: FsEntry | null }> {
  const typed = unquote(typedArg)
  const slash = typed.lastIndexOf('/')
  const leaf = typed.slice(slash + 1)
  if (!leaf) throw new Error(`${cmd}: no file name`)
  const parent = slash === -1 ? cwd : await resolveDir(cwd, typed.slice(0, slash + 1))
  if (parent.channel === null) return { parent, leaf, entry: null }
  return { parent, leaf, entry: (await listDir(parent)).find((e) => norm(e.name) === norm(leaf)) ?? null }
}

/** A text file from the tree (for `source`); null when there's nothing by that name. */
export async function readTextFile(cwd: FilesCwd, arg: string, cmd: string): Promise<{ name: string; text: string } | null> {
  const { parent, entry } = await lookupEntry(cwd, arg, cmd)
  if (!entry) return null
  if (entry.type === 'directory' || !entry.entry || parent.channel === null) throw new Error(`${cmd}: ${unquote(arg)}: is a directory`)
  return { name: entry.name, text: await fetchEntryText(entry.entry, parent.channel, cmd, unquote(arg)) }
}
