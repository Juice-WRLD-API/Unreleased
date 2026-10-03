import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { formatBytes } from 'site:format'
import { fetchStream, streamUrl } from './api'
import { listDir, listFilesRecursive, listSubtree, resolveDir, unquote, type FileEntry, type FilesCwd, type FsEntry } from './files'
import { progressLine } from './out'

// `get`: the site's download, but onto disk. A file is saved as it is; a
// folder (or `*`) is saved as a folder with its structure kept, where the site
// would build a ZIP. Everything lands in the current local directory unless
// -o says otherwise, and existing files are left alone unless -f.

const norm = (s: string): string => s.trim().toLowerCase()
const CONCURRENCY = 3

// Names come from the server, so each path segment is made safe for the local
// filesystem: no `..`, no separators, nothing Windows refuses.
function safeSegment(name: string): string {
  let s = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
  if (process.platform === 'win32') s = s.replace(/[. ]+$/, '')
  if (!s || s === '.' || s === '..') s = '_'
  return s
}

function safeJoin(root: string, segments: string[]): string {
  const out = join(root, ...segments.map(safeSegment))
  const rel = relative(root, out)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`refusing to write outside ${root}`)
  return out
}

interface Job { url: string; dest: string; label: string; size?: number | null }

export interface GetOptions { dest: string; force: boolean }

/** `get [-o dir] [-f] <file | folder | *>` - flags parsed here. */
export function parseGetArgs(arg: string, cwdLocal: string): { opts: GetOptions; target: string } {
  let rest = arg.trim()
  const opts: GetOptions = { dest: cwdLocal, force: false }
  for (;;) {
    const flag = /^(-o|--out)\s+("[^"]+"|'[^']+'|\S+)\s*/.exec(rest)
    if (flag) { opts.dest = resolve(cwdLocal, unquote(flag[2])); rest = rest.slice(flag[0].length); continue }
    const force = /^(-f|--force)(?:\s+|$)/.exec(rest)
    if (force) { opts.force = true; rest = rest.slice(force[0].length); continue }
    break
  }
  return { opts, target: unquote(rest) }
}

async function filesUnder(entry: FileEntry, channel: string): Promise<FileEntry[]> {
  const folder = entry.path.replace(/\/+$/, '')
  try {
    const all = await listSubtree(folder, channel)
    if (all) {
      const prefix = `${folder.toLowerCase()}/`
      return all.filter((e) => e.type === 'file' && e.path.toLowerCase().startsWith(prefix))
    }
  } catch (err) { if ((err as Error).name === 'AbortError') throw err }
  return listFilesRecursive(folder, channel)
}

async function saveOne(job: Job, onBytes: (n: number) => void): Promise<void> {
  mkdirSync(dirname(job.dest), { recursive: true })
  const part = `${job.dest}.part`
  const res = await fetchStream(job.url)
  if (!res.body) throw new Error('empty response')
  const counter = new Transform({ transform(chunk: Buffer, _enc, done) { onBytes(chunk.length); done(null, chunk) } })
  try {
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), counter, createWriteStream(part))
    renameSync(part, job.dest)
  } catch (err) {
    rmSync(part, { force: true })
    throw err
  }
}

export async function downloadPath(cwd: FilesCwd, arg: string, cwdLocal: string): Promise<string> {
  const { opts, target } = parseGetArgs(arg, cwdLocal)
  if (!target) throw new Error('usage: get [-o dir] [-f] <file | folder | *>')
  if (cwd.channel === null && !target.includes('/')) throw new Error('get: pick a channel first (cd <channel>)')

  let parent = cwd
  let targets: FsEntry[]
  if (target === '*') {
    targets = await listDir(cwd)
  } else {
    const trimmed = target.replace(/\/+$/, '')
    const slash = trimmed.lastIndexOf('/')
    const leaf = trimmed.slice(slash + 1)
    parent = slash === -1 ? cwd : await resolveDir(cwd, trimmed.slice(0, slash + 1))
    if (parent.channel === null) throw new Error(`get: ${target}: pick something inside a channel`)
    const match = (await listDir(parent)).find((e) => norm(e.name) === norm(leaf))
    if (!match) throw new Error(`get: ${target}: no such file or directory`)
    targets = [match]
  }
  const channel = parent.channel
  if (!channel) throw new Error('get: pick a channel first (cd <channel>)')
  if (targets.length === 0) throw new Error('get: nothing to download here')

  // Work out every file first, so the progress line can count down.
  const jobs: Job[] = []
  for (const t of targets) {
    if (!t.entry) continue
    if (t.type === 'file') {
      jobs.push({ url: streamUrl(t.entry.path, channel), dest: safeJoin(opts.dest, [t.name]), label: t.name, size: t.size })
      continue
    }
    const prefix = t.entry.path.replace(/\/+$/, '') + '/'
    for (const file of await filesUnder(t.entry, channel)) {
      const rel = file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.name
      jobs.push({ url: streamUrl(file.path, channel), dest: safeJoin(opts.dest, [t.name, ...rel.split('/')]), label: `${t.name}/${rel}`, size: file.size })
    }
  }
  if (jobs.length === 0) throw new Error('get: no files to download')

  const todo = opts.force ? jobs : jobs.filter((j) => !existsSync(j.dest))
  const skipped = jobs.length - todo.length
  const totalBytes = todo.reduce((n, j) => n + (j.size ?? 0), 0)
  let doneBytes = 0
  let done = 0
  let failed = 0
  const failures: string[] = []
  const progress = progressLine()
  const tick = (label: string): void => progress.update(`[${done + failed}/${todo.length}] ${formatBytes(doneBytes)}${totalBytes ? ` / ${formatBytes(totalBytes)}` : ''}  ${label}`)

  try {
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < todo.length) {
        const job = todo[next++]
        tick(job.label)
        try {
          await saveOne(job, (n) => { doneBytes += n; tick(job.label) })
          done++
        } catch (err) {
          if ((err as Error).name === 'AbortError') throw err
          failed++
          failures.push(`${job.label}: ${(err as Error).message}`)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker))
  } finally {
    progress.done()
  }

  if (todo.length === 1 && failed === 1) throw new Error(`get: ${failures[0]}`)
  const where = relative(cwdLocal, opts.dest) || '.'
  const extra = [skipped ? `${skipped} already there (-f to overwrite)` : '', failed ? `${failed} failed` : ''].filter(Boolean).join(', ')
  if (jobs.length === 1 && todo.length === 1 && done === 1) {
    const size = statSync(todo[0].dest).size
    return `saved ${relative(cwdLocal, todo[0].dest)} (${formatBytes(size)})`
  }
  if (todo.length === 0) return `nothing to do: ${jobs.length === 1 ? `${relative(cwdLocal, jobs[0].dest)} is` : `all ${jobs.length} files are`} already there (-f to overwrite)`
  const head = `saved ${done} file${done === 1 ? '' : 's'} (${formatBytes(doneBytes)}) to ${where}${extra ? ` - ${extra}` : ''}`
  if (failed) throw new Error([head, ...failures.slice(0, 10).map((f) => `  ${f}`), ...(failures.length > 10 ? [`  … ${failures.length - 10} more`] : [])].join('\n'))
  return head
}
