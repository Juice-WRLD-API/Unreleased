import { isPrimaryChannelSlug } from '../hooks/useChannelRoles'
import { useStore } from '../store/useStore'
import { triggerDownload } from './apiFilesShared'
import { downloadFileSmart } from './cdn'
import { openZipTarget, saveItems, type ZipItem } from './clientZip'
import { formatBytes } from './format'
import { apiFetch, buildStreamUrl, listFilesRecursive, parseBrowseEntries, type JWApiBrowseResponse, type JWApiFileEntry } from './juicewrldApi'

// The Files tab as a little filesystem for the admin terminal: the root lists
// the file channels, a channel is a directory, and below that it's the same
// tree /files/browse/ serves. Everything goes through the calls the Files tab
// itself makes (browse, the stream URL, client-side ZIPs), so what you can see
// and download here is exactly what the Files tab offers.
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
  entry?: JWApiFileEntry
}

const LIST_TTL_MS = 60_000
const listCache = new Map<string, { at: number; entries: FsEntry[] }>()

const norm = (s: string): string => s.trim().toLowerCase()

export function unquote(s: string): string {
  const t = s.trim()
  return (t.startsWith('"') && t.endsWith('"') && t.length > 1) || (t.startsWith("'") && t.endsWith("'") && t.length > 1) ? t.slice(1, -1) : t
}

export function filesPathString(cwd: FilesCwd): string {
  return `~/files${cwd.channel ? `/${[cwd.channel, ...cwd.dir].join('/')}` : ''}`
}

async function channelList(): Promise<{ slug: string; name: string }[]> {
  const store = useStore.getState()
  if (store.channels.length === 0) await store.loadChannels()
  return useStore.getState().channels
}

/** The channel `cd files` should land in: whichever the Files tab has open. */
export async function defaultFilesCwd(): Promise<FilesCwd> {
  const channels = await channelList()
  const active = useStore.getState().activeChannel
  const slug = channels.find((c) => c.slug === active)?.slug ?? channels[0]?.slug ?? null
  return slug ? { channel: slug, dir: [] } : FILES_ROOT
}

export async function listDir(cwd: FilesCwd, fresh = false): Promise<FsEntry[]> {
  if (cwd.channel === null) {
    return (await channelList()).map((c) => ({ name: c.slug, type: 'directory' as const }))
  }
  const key = `${cwd.channel}:${cwd.dir.join('/')}`
  const hit = listCache.get(key)
  if (!fresh && hit && Date.now() - hit.at < LIST_TTL_MS) return hit.entries
  const data = await apiFetch<JWApiBrowseResponse>('/files/browse/', { path: cwd.dir.join('/') || undefined, channel: cwd.channel })
  const entries = parseBrowseEntries(data)
    .map((e): FsEntry => ({ name: e.name, type: e.type, size: e.size, entry: e }))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.type === 'directory' ? -1 : 1))
  listCache.set(key, { at: Date.now(), entries })
  return entries
}

/** Walks `input` ("..", "a/b", "/", "/chan/a") from `cwd`, checking every
 *  step against the real listing (case-insensitive) and returning the
 *  properly-cased result. Throws a shell-style message on a missing folder. */
export async function resolveDir(cwd: FilesCwd, input: string): Promise<FilesCwd> {
  const raw = unquote(input)
  let at: FilesCwd = raw.startsWith('/') ? FILES_ROOT : { channel: cwd.channel, dir: [...cwd.dir] }
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (at.dir.length > 0) at = { channel: at.channel, dir: at.dir.slice(0, -1) }
      else at = FILES_ROOT
      continue
    }
    const match = (await listDir(at)).find((e) => e.type === 'directory' && norm(e.name) === norm(part))
    if (!match) throw new Error(`${input}: no such directory`)
    at = at.channel === null ? { channel: match.name, dir: [] } : { channel: at.channel, dir: [...at.dir, match.name] }
  }
  return at
}

/** The listing `ls` prints: folders first, size on the left. */
export function formatListing(entries: FsEntry[], cwd: FilesCwd, limit = 400): string {
  if (entries.length === 0) return '(empty)'
  const shown = entries.slice(0, limit)
  const lines = shown.map((e) => {
    if (cwd.channel === null) return e.name + '/'
    const size = e.type === 'directory' ? '<dir>' : e.size != null ? formatBytes(e.size) : '-'
    return `${size.padStart(10)}  ${e.name}${e.type === 'directory' ? '/' : ''}`
  })
  if (entries.length > limit) lines.push(`… ${entries.length - limit} more`)
  return lines.join('\n')
}

/** Splits "a/b/pre" into the folder to list and the prefix being typed. */
export function splitTyped(arg: string): { dirPart: string; prefix: string } {
  const slash = arg.lastIndexOf('/')
  return slash === -1 ? { dirPart: '', prefix: arg } : { dirPart: arg.slice(0, slash + 1), prefix: arg.slice(slash + 1) }
}

export interface DownloadResult {
  message: string
}

/** `get <path>`: one file downloads directly (via the CDN first on the primary
 *  channel, same as the Files tab); a folder is zipped client-side with its
 *  structure kept; `*` zips everything in the current folder. The ZIP shows up
 *  in the Transfers panel like any other bulk download. */
export async function downloadPath(cwd: FilesCwd, arg: string): Promise<DownloadResult> {
  if (cwd.channel === null) throw new Error('get: pick a channel first (cd <channel>)')
  const channel = cwd.channel
  const typed = unquote(arg)
  if (!typed) throw new Error('usage: get <file | folder | *>')

  let parent = cwd
  let targets: FsEntry[]
  let archiveName: string
  if (typed === '*') {
    targets = await listDir(cwd)
    archiveName = cwd.dir[cwd.dir.length - 1] ?? channel
  } else {
    const slash = typed.replace(/\/+$/, '').lastIndexOf('/')
    const parentPart = slash === -1 ? '' : typed.slice(0, slash + 1)
    const leaf = typed.replace(/\/+$/, '').slice(slash + 1)
    parent = parentPart ? await resolveDir(cwd, parentPart) : cwd
    if (parent.channel === null) throw new Error(`get: ${typed}: not a file`)
    const match = (await listDir(parent)).find((e) => norm(e.name) === norm(leaf))
    if (!match) throw new Error(`get: ${typed}: no such file or directory`)
    targets = [match]
    archiveName = match.name
  }
  if (targets.length === 0) throw new Error('get: nothing to download here')

  const single = targets.length === 1 ? targets[0] : null
  if (single?.type === 'file' && single.entry) {
    const streamUrl = buildStreamUrl(single.entry.path, channel)
    const channels = useStore.getState().channels
    if (isPrimaryChannelSlug(channels, channel)) await downloadFileSmart(single.entry.path, single.name, streamUrl)
    else triggerDownload(streamUrl, single.name)
    return { message: `downloading ${single.name}${single.size != null ? ` (${formatBytes(single.size)})` : ''}` }
  }

  // Folders and `*`: a ZIP. The save dialog needs the keypress' user
  // activation, so ask for the target before the (slow) recursive listing.
  const target = await openZipTarget(archiveName)
  if (!target) return { message: 'cancelled' }
  const items: ZipItem[] = []
  for (const t of targets) {
    if (!t.entry) continue
    if (t.type === 'file') {
      items.push({ name: t.name, url: buildStreamUrl(t.entry.path, channel), size: t.size })
      continue
    }
    const prefix = t.entry.path.replace(/\/+$/, '') + '/'
    for (const file of await listFilesRecursive(t.entry.path, channel)) {
      const rel = file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.name
      items.push({ name: `${t.name}/${rel}`, url: buildStreamUrl(file.path, channel), size: file.size })
    }
  }
  if (items.length === 0) throw new Error('get: no files to download')
  const { saved, failed, cancelled } = await saveItems(target, items)
  if (cancelled) return { message: 'cancelled' }
  return { message: `saved ${saved} file${saved === 1 ? '' : 's'} as ${target.filename}${failed ? ` (${failed} failed)` : ''}` }
}
