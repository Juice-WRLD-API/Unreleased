import { getFileExt, TEXT_EXTS } from './fileTypes'
import { formatBytes } from './format'
import { normalizeForSearch } from './juicewrldApi'
import { fetchEntryText, listDir, listSubtreeFlat, lookupEntry, resolveDir, unquote, type FilesCwd, type FsEntry } from './terminalFiles'

// Read-only shell tools for the file tree (cat, head, tail, wc, grep, locate,
// tree, du). Like `ls` and `get` they work on what /files/browse/ serves and
// stream URLs download. The ones that walk folders ask /files/list-all/?path=
// for the whole subtree in one request; only if that isn't available do they
// fall back to listing a level at a time, with hard caps they say so about.

function fileOf(cwd: FilesCwd, cmd: string): string {
  if (cwd.channel === null) throw new Error(`${cmd}: pick a channel first (cd files, then cd <channel>)`)
  return cwd.channel
}

// One flag word and the rest, the way a shell reads `-n 5 name`. Flags are only
// recognised before the first non-flag word, so a file called "-x" isn't one.
function takeFlags(arg: string): { flags: string[]; rest: string } {
  const flags: string[] = []
  let rest = arg.trim()
  for (;;) {
    const m = /^(-\S+)(?:\s+|$)/.exec(rest)
    if (!m) break
    flags.push(m[1])
    rest = rest.slice(m[0].length)
  }
  return { flags, rest }
}

async function textOf(cwd: FilesCwd, arg: string, cmd: string): Promise<{ name: string; text: string }> {
  const channel = fileOf(cwd, cmd)
  const typed = unquote(arg)
  if (!typed) throw new Error(`usage: ${cmd} <file>`)
  const { parent, entry } = await lookupEntry(cwd, typed, cmd)
  if (!entry) throw new Error(`${cmd}: ${typed}: no such file or directory`)
  if (entry.type === 'directory' || !entry.entry) throw new Error(`${cmd}: ${typed}: is a directory`)
  return { name: entry.name, text: await fetchEntryText(entry.entry, parent.channel ?? channel, cmd, typed) }
}

const linesOf = (text: string): string[] => {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

export async function catFile(cwd: FilesCwd, arg: string): Promise<string> {
  const { text } = await textOf(cwd, arg, 'cat')
  return text.replace(/\r\n/g, '\n').replace(/\n$/, '') || '(empty file)'
}

/** `head`/`tail [-n N | -N] <file>`, ten lines by default. */
export async function headTailFile(which: 'head' | 'tail', cwd: FilesCwd, arg: string): Promise<string> {
  const { flags, rest } = takeFlags(arg)
  let count = 10
  let file = rest
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i]
    if (/^-\d+$/.test(f)) count = Number(f.slice(1))
    else if (f === '-n') {
      // `-n 5 name`: the number came out of the file part, since it isn't a flag.
      const m = /^(\d+)(?:\s+|$)/.exec(file)
      if (!m) throw new Error(`usage: ${which} [-n N] <file>`)
      count = Number(m[1])
      file = file.slice(m[0].length)
    } else throw new Error(`${which}: unknown option ${f}`)
  }
  const lines = linesOf((await textOf(cwd, file, which)).text)
  const out = which === 'head' ? lines.slice(0, count) : count === 0 ? [] : lines.slice(-count)
  return out.join('\n') || '(empty file)'
}

export async function wcFile(cwd: FilesCwd, arg: string): Promise<string> {
  const { name, text } = await textOf(cwd, arg, 'wc')
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  const bytes = new TextEncoder().encode(text).length
  return `${String(linesOf(text).length).padStart(7)} ${String(words).padStart(7)} ${String(bytes).padStart(7)} ${name}`
}

// ─── Walking folders ──────────────────────────────────────────────────────────

interface Crawled { rel: string[]; entry: FsEntry }

// One request for the whole subtree when it can (nothing is ever truncated);
// otherwise breadth-first, a few listings at a time. `maxDirs` is then the
// request budget; folders past `maxDepth` are listed as entries but not
// entered (not a truncation - that was asked for), folders past the budget
// are (truncated). A single-level crawl is already one listing, so it skips
// the subtree call.
async function crawl(start: FilesCwd, maxDepth: number, maxDirs: number): Promise<{ items: Crawled[]; truncated: boolean }> {
  if (maxDepth > 1) {
    const flat = await listSubtreeFlat(start)
    if (flat) return { items: flat.filter((i) => i.rel.length <= maxDepth), truncated: false }
  }
  const items: Crawled[] = []
  const queue: { dir: FilesCwd; rel: string[] }[] = [{ dir: start, rel: [] }]
  let listed = 0
  let truncated = false
  while (queue.length > 0) {
    const batch = queue.splice(0, 4)
    const room = maxDirs - listed
    if (room <= 0) { truncated = true; break }
    if (batch.length > room) { truncated = true; batch.length = room }
    listed += batch.length
    const listings = await Promise.all(batch.map((b) => listDir(b.dir)))
    batch.forEach((b, i) => {
      for (const e of listings[i]) {
        const rel = [...b.rel, e.name]
        items.push({ rel, entry: e })
        if (e.type === 'directory' && rel.length < maxDepth) queue.push({ dir: { channel: b.dir.channel, dir: [...b.dir.dir, e.name] }, rel })
      }
    })
  }
  return { items, truncated: truncated || queue.length > 0 }
}

async function startDir(cwd: FilesCwd, path: string, cmd: string): Promise<FilesCwd> {
  fileOf(cwd, cmd)
  const typed = unquote(path)
  return typed ? resolveDir(cwd, typed) : cwd
}

const MORE = (truncated: boolean): string => (truncated ? '\n(stopped early - too many folders; try a narrower path)' : '')

/** `locate <name>`: every file or folder under here whose name matches. `*` and
 *  `?` work as wildcards; otherwise it's a plain substring, case-insensitive. */
export async function locateName(cwd: FilesCwd, arg: string): Promise<string> {
  const m = /^("[^"]+"|'[^']+'|\S+)\s*([\s\S]*)$/.exec(arg.trim())
  if (!m) throw new Error('usage: locate <name> [folder]')
  const pattern = unquote(m[1]).toLowerCase()
  const start = await startDir(cwd, m[2], 'locate')
  const re = /[*?]/.test(pattern)
    ? new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
    : null
  const { items, truncated } = await crawl(start, 8, 150)
  const plain = normalizeForSearch(pattern)
  const hits = items.filter((i) => (re ? re.test(i.entry.name.toLowerCase()) : normalizeForSearch(i.entry.name).includes(plain)))
  if (hits.length === 0) return `nothing named "${unquote(m[1])}" under ${start.channel}/${start.dir.join('/')}${MORE(truncated)}`
  const shown = hits.slice(0, 200).map((h) => h.rel.join('/') + (h.entry.type === 'directory' ? '/' : ''))
  return [...shown, ...(hits.length > shown.length ? [`… ${hits.length - shown.length} more`] : [])].join('\n') + MORE(truncated)
}

/** `tree [-L depth] [folder]`: the folder as an indented tree, two levels by default. */
export async function treeView(cwd: FilesCwd, arg: string): Promise<string> {
  const { flags, rest } = takeFlags(arg)
  let depth = 2
  let path = rest
  for (const f of flags) {
    if (f === '-L') {
      const m = /^(\d+)(?:\s+|$)/.exec(path)
      if (!m) throw new Error('usage: tree [-L depth] [folder]')
      depth = Math.min(6, Math.max(1, Number(m[1])))
      path = path.slice(m[0].length)
    } else if (/^-L\d+$/.test(f)) depth = Math.min(6, Math.max(1, Number(f.slice(2))))
    else throw new Error(`tree: unknown option ${f}`)
  }
  const start = await startDir(cwd, path, 'tree')
  const { items, truncated } = await crawl(start, depth, 80)
  const children = new Map<string, Crawled[]>()
  for (const item of items) {
    const key = item.rel.slice(0, -1).join('/')
    children.set(key, [...(children.get(key) ?? []), item])
  }
  const lines: string[] = [start.dir.length ? start.dir[start.dir.length - 1] : start.channel ?? '.']
  const LIMIT = 300
  const walk = (key: string, prefix: string): void => {
    const kids = children.get(key) ?? []
    kids.forEach((k, i) => {
      if (lines.length > LIMIT) return
      const last = i === kids.length - 1
      lines.push(`${prefix}${last ? '└── ' : '├── '}${k.entry.name}${k.entry.type === 'directory' ? '/' : ''}`)
      if (k.entry.type === 'directory') walk(k.rel.join('/'), prefix + (last ? '    ' : '│   '))
    })
  }
  walk('', '')
  const dirs = items.filter((i) => i.entry.type === 'directory').length
  const files = items.length - dirs
  if (lines.length > LIMIT) lines.length = LIMIT
  return `${lines.join('\n')}\n\n${dirs} director${dirs === 1 ? 'y' : 'ies'}, ${files} file${files === 1 ? '' : 's'}${lines.length >= LIMIT ? ' (listing cut off)' : ''}${MORE(truncated)}`
}

/** `du [folder]`: how much is in each subfolder, and in total. */
export async function diskUsage(cwd: FilesCwd, arg: string): Promise<string> {
  const start = await startDir(cwd, arg, 'du')
  const { items, truncated } = await crawl(start, 64, 250)
  const sizes = new Map<string, { bytes: number; files: number }>()
  let loose = { bytes: 0, files: 0 }
  let total = { bytes: 0, files: 0 }
  for (const { rel, entry } of items) {
    if (entry.type !== 'file') continue
    const bytes = entry.size ?? 0
    total = { bytes: total.bytes + bytes, files: total.files + 1 }
    if (rel.length === 1) { loose = { bytes: loose.bytes + bytes, files: loose.files + 1 }; continue }
    const held = sizes.get(rel[0]) ?? { bytes: 0, files: 0 }
    sizes.set(rel[0], { bytes: held.bytes + bytes, files: held.files + 1 })
  }
  const rows = [...sizes.entries()].sort((a, b) => b[1].bytes - a[1].bytes)
  const lines = rows.slice(0, 60).map(([name, v]) => `${formatBytes(v.bytes).padStart(10)}  ${String(v.files).padStart(6)} files  ${name}/`)
  if (loose.files > 0) lines.push(`${formatBytes(loose.bytes).padStart(10)}  ${String(loose.files).padStart(6)} files  (files directly here)`)
  lines.push(`${formatBytes(total.bytes).padStart(10)}  ${String(total.files).padStart(6)} files  total`)
  return lines.join('\n') + MORE(truncated)
}

// ─── grep ─────────────────────────────────────────────────────────────────────

const GREP_FILE_CAP = 80
const GREP_FILE_MAX_BYTES = 1024 * 1024
const GREP_LINE_CAP = 200

/** `grep [-s] [-r] [-l] <text> [folder | file]`: searches inside the text files
 *  of the current folder (add -r for subfolders). Case-insensitive unless -s.
 *  Only readable text formats are opened, and only the first 80 of them. */
export async function grepFiles(cwd: FilesCwd, arg: string): Promise<string> {
  fileOf(cwd, 'grep')
  const { flags, rest } = takeFlags(arg)
  let sensitive = false
  let recursive = false
  let namesOnly = false
  for (const f of flags) {
    for (const c of f.slice(1)) {
      if (c === 's') sensitive = true
      else if (c === 'r' || c === 'R') recursive = true
      else if (c === 'l') namesOnly = true
      else if (c !== 'i' && c !== 'n') throw new Error(`grep: unknown option -${c}`)
    }
  }
  const m = /^("[^"]+"|'[^']+'|\S+)\s*([\s\S]*)$/.exec(rest)
  if (!m) throw new Error('usage: grep [-s] [-r] [-l] <text> [folder | file]')
  const needle = unquote(m[1])
  const fold = (t: string): string => (sensitive ? t : t.toLowerCase())
  const target = unquote(m[2])

  // A named file searches just that file; otherwise a folder (here by default).
  const candidates: { label: string; entry: FsEntry; channel: string }[] = []
  let truncated = false
  const single = target ? await lookupEntry(cwd, target, 'grep') : null
  if (single?.entry && single.entry.type === 'file' && single.parent.channel) {
    candidates.push({ label: single.entry.name, entry: single.entry, channel: single.parent.channel })
  } else {
    const start = target ? await resolveDir(cwd, target) : cwd
    const crawled = await crawl(start, recursive ? 8 : 1, recursive ? 60 : 1)
    truncated = crawled.truncated
    for (const { rel, entry } of crawled.items) {
      if (entry.type === 'file' && start.channel) candidates.push({ label: rel.join('/'), entry, channel: start.channel })
    }
  }

  const readable = candidates.filter((c) => TEXT_EXTS.has(getFileExt(c.entry.name)) && (c.entry.size ?? 0) <= GREP_FILE_MAX_BYTES)
  const skipped = candidates.length - readable.length
  const scan = readable.slice(0, GREP_FILE_CAP)
  const out: string[] = []
  const matchedFiles: string[] = []
  let cut = false
  for (let i = 0; i < scan.length && !cut; i += 4) {
    const texts = await Promise.all(scan.slice(i, i + 4).map(async (c) => {
      try { return await fetchEntryText(c.entry.entry!, c.channel, 'grep', c.label) } catch { return null }
    }))
    texts.forEach((text, j) => {
      if (text === null || cut) return
      const { label } = scan[i + j]
      let hit = false
      linesOf(text).forEach((line, n) => {
        if (cut || !fold(line).includes(fold(needle))) return
        hit = true
        if (namesOnly) return
        if (out.length >= GREP_LINE_CAP) { cut = true; return }
        out.push(`${label}:${n + 1}: ${line.length > 200 ? `${line.slice(0, 200)}…` : line}`)
      })
      if (hit) matchedFiles.push(label)
    })
  }

  const body = namesOnly ? matchedFiles : out
  const notes = [
    `searched ${scan.length} text file${scan.length === 1 ? '' : 's'}`,
    ...(skipped > 0 ? [`${skipped} skipped (not text, or over ${formatBytes(GREP_FILE_MAX_BYTES)})`] : []),
    ...(readable.length > scan.length ? [`stopped at ${GREP_FILE_CAP} files`] : []),
    ...(cut ? [`stopped at ${GREP_LINE_CAP} matches`] : []),
    ...(truncated ? ['not every folder was reached'] : []),
  ].join(' · ')
  return `${body.length ? body.join('\n') : `no matches for "${needle}"`}\n(${notes})`
}
