import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownAZ, AudioLines, ChevronRight, CornerLeftUp, File as FileIcon, FileArchive, FileImage, FileText, FileVideo, Folder, FolderOpen, FolderSearch,
  History, Import, Loader2, Music, Pause, Play, RefreshCw, Search, X,
} from 'lucide-react'
import { audioContext, decodeAudioFile, formatTime, isAudioName } from '../lib/sessionMaker'
import { formatBytes } from '../lib/format'

// A file explorer for the take bin: open a folder on this device, walk its
// subfolders, listen to audio files and pull them into the project (double-click,
// Enter, the Import button, or drag onto a lane). Uses the File System Access API
// where there is one (Electron, Chromium), else a folder <input> snapshot.

type PermState = 'granted' | 'denied' | 'prompt'
interface DirHandle extends FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>
  queryPermission?(o: { mode: 'read' }): Promise<PermState>
  requestPermission?(o: { mode: 'read' }): Promise<PermState>
}
type Picker = (o?: { mode?: 'read'; id?: string }) => Promise<DirHandle>
const picker = (): Picker | undefined => (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker

export interface FsNode { path: string; name: string; dir: boolean; size: number; modified: number; handle?: FileSystemHandle; file?: File; kids?: FsNode[] }

const HIDDEN_RE = /^(\.|desktop\.ini$|thumbs\.db$|\$recycle\.bin$|system volume information$)/i
const stripExt = (n: string): string => n.replace(/\.[^.]+$/, '') || n
const extOf = (n: string): string => (/\.([^.]+)$/.exec(n)?.[1] ?? '').toLowerCase()

async function readDir(node: FsNode): Promise<FsNode[]> {
  if (node.kids) return node.kids
  const pending: Promise<FsNode>[] = []
  for await (const c of (node.handle as DirHandle).values()) {
    if (HIDDEN_RE.test(c.name)) continue
    const path = `${node.path}/${c.name}`
    if (c.kind === 'directory') pending.push(Promise.resolve({ path, name: c.name, dir: true, size: 0, modified: 0, handle: c }))
    else {
      pending.push((c as FileSystemFileHandle).getFile().then(
        (f) => ({ path, name: c.name, dir: false, size: f.size, modified: f.lastModified, handle: c, file: f }),
        () => ({ path, name: c.name, dir: false, size: 0, modified: 0, handle: c }),
      ))
    }
  }
  return Promise.all(pending)
}

const fileOf = async (n: FsNode): Promise<File> => (n.handle ? (n.handle as FileSystemFileHandle).getFile() : n.file!)

/** Every audio file in the nodes, folders searched all the way down (up to `limit`). */
async function collectAudio(nodes: FsNode[], limit = 500): Promise<File[]> {
  const out: File[] = []
  const walk = async (list: FsNode[]): Promise<void> => {
    for (const n of list) {
      if (out.length >= limit) return
      if (n.dir) await walk(await readDir(n).catch(() => []))
      else if (isAudioName(n.name)) out.push(await fileOf(n))
    }
  }
  await walk(nodes)
  return out
}

// ─── Dragging onto the timeline ──────────────────────────────────────────────

export const FS_DRAG = 'text/x-fs-files'
let dragged: FsNode[] = []
/** The audio files in what's being dragged out of the explorer. */
export const draggedFsFiles = (): Promise<File[]> => collectAudio(dragged)

// ─── Recent folders (handles survive restarts in IndexedDB) ──────────────────

interface Recent { name: string; handle: DirHandle; at: number }
const RECENT_DB = 'session-maker-explorer'
function recentStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(RECENT_DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('kv')
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const r = fn(req.result.transaction('kv', mode).objectStore('kv'))
      r.onsuccess = () => resolve(r.result as T)
      r.onerror = () => reject(r.error)
    }
  })
}
const loadRecents = (): Promise<Recent[]> => recentStore<Recent[] | undefined>('readonly', (s) => s.get('recents')).then((r) => r ?? [], () => [])
const saveRecents = (r: Recent[]): Promise<unknown> => recentStore('readwrite', (s) => s.put(r, 'recents')).catch(() => {})

async function rememberFolder(h: DirHandle): Promise<Recent[]> {
  const cur = await loadRecents()
  const keep: Recent[] = []
  for (const r of cur) if (!(await r.handle.isSameEntry(h).catch(() => false))) keep.push(r)
  const next = [{ name: h.name, handle: h, at: Date.now() }, ...keep].slice(0, 6)
  await saveRecents(next)
  return next
}

const ago = (t: number): string => {
  const s = (Date.now() - t) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

// ─── Look ────────────────────────────────────────────────────────────────────

const EXT_STYLE: Record<string, string> = {
  wav: 'text-sky-400 bg-sky-400/10', aif: 'text-violet-400 bg-violet-400/10', aiff: 'text-violet-400 bg-violet-400/10',
  mp3: 'text-emerald-400 bg-emerald-400/10', flac: 'text-amber-400 bg-amber-400/10', m4a: 'text-pink-400 bg-pink-400/10',
  aac: 'text-pink-400 bg-pink-400/10', ogg: 'text-teal-400 bg-teal-400/10', zip: 'text-orange-400 bg-orange-400/10',
}
function iconFor(name: string): { Icon: typeof FileIcon; cls: string } {
  const e = extOf(name)
  if (isAudioName(name)) return { Icon: Music, cls: (EXT_STYLE[e] ?? 'text-accent').split(' ')[0] }
  if (/^(zip|rar|7z|tar|gz)$/.test(e)) return { Icon: FileArchive, cls: 'text-orange-400' }
  if (/^(png|jpe?g|gif|webp|bmp|svg|heic)$/.test(e)) return { Icon: FileImage, cls: 'text-fuchsia-400' }
  if (/^(mp4|mov|mkv|avi|webm)$/.test(e)) return { Icon: FileVideo, cls: 'text-rose-400' }
  if (/^(txt|md|json|rtf|pdf|doc|docx|log|ptx|als|flp|logicx|cpr|rpp)$/.test(e)) return { Icon: FileText, cls: 'text-text-secondary' }
  return { Icon: FileIcon, cls: 'text-text-muted' }
}

type Sort = 'name' | 'size' | 'date'
const SORT_LABEL: Record<Sort, string> = { name: 'Name', size: 'Size', date: 'Newest' }
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
function sortNodes(list: FsNode[], sort: Sort): FsNode[] {
  return [...list].sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1)
    : sort === 'size' && !a.dir ? b.size - a.size
    : sort === 'date' && !a.dir ? b.modified - a.modified
    : collator.compare(a.name, b.name)))
}

interface Row { node: FsNode; depth: number; sub?: string }
interface Preview { path: string; state: 'loading' | 'playing' | 'error'; start: number; dur: number }

export default function SessionFileExplorer({ active, importing, importedKeys, onImport, onPreviewStart }: {
  active: boolean
  importing: boolean
  /** `name-without-extension|size` of files already in the project. */
  importedKeys: Set<string>
  onImport: (files: File[]) => void
  onPreviewStart?: () => void
}): JSX.Element {
  const [root, setRoot] = useState<FsNode | null>(null)
  const [trail, setTrail] = useState<FsNode[]>([])
  const [kids, setKids] = useState<Map<string, FsNode[]>>(new Map())
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<string[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [audioOnly, setAudioOnly] = useState(false)
  const [sort, setSort] = useState<Sort>('name')
  const [recents, setRecents] = useState<Recent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [deep, setDeep] = useState<'idle' | 'busy' | 'done'>('idle')
  const [collecting, setCollecting] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const byPath = useRef(new Map<string, FsNode>())
  const kidsRef = useRef(kids)
  kidsRef.current = kids
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const current = trail[trail.length - 1] ?? null

  useEffect(() => { void loadRecents().then(setRecents) }, [])

  const load = useCallback(async (node: FsNode): Promise<FsNode[]> => {
    const have = kidsRef.current.get(node.path)
    if (have) return have
    setLoading((s) => new Set(s).add(node.path))
    try {
      const list = await readDir(node)
      for (const n of list) byPath.current.set(n.path, n)
      setKids((m) => new Map(m).set(node.path, list))
      return list
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return []
    } finally {
      setLoading((s) => { const n = new Set(s); n.delete(node.path); return n })
    }
  }, [])

  const showRoot = useCallback((node: FsNode) => {
    byPath.current = new Map([[node.path, node]])
    setRoot(node); setTrail([node]); setKids(new Map()); kidsRef.current = new Map()
    setExpanded(new Set()); setSel([]); setCursor(null); setQuery(''); setDeep('idle'); setError(null)
    void load(node)
  }, [load])

  const openHandle = useCallback(async (h: DirHandle) => {
    try {
      if (h.queryPermission && (await h.queryPermission({ mode: 'read' })) !== 'granted') {
        if ((await h.requestPermission?.({ mode: 'read' })) !== 'granted') { setError(`No permission to read "${h.name}"`); return }
      }
      showRoot({ path: h.name, name: h.name, dir: true, size: 0, modified: 0, handle: h })
      setRecents(await rememberFolder(h))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [showRoot])

  const pickFolder = useCallback(async () => {
    const p = picker()
    if (!p) { inputRef.current?.click(); return }
    try { await openHandle(await p({ mode: 'read', id: 'session-maker' })) }
    catch (err) { if ((err as DOMException)?.name !== 'AbortError') setError(err instanceof Error ? err.message : String(err)) }
  }, [openHandle])

  /** Fallback: a folder <input> gives a flat list of files with relative paths. */
  const fromInput = (files: File[]): void => {
    if (!files.length) return
    const top = files[0].webkitRelativePath.split('/')[0] || 'Folder'
    const rootNode: FsNode = { path: top, name: top, dir: true, size: 0, modified: 0, kids: [] }
    const dirs = new Map([[top, rootNode]])
    const dirAt = (path: string): FsNode => {
      let d = dirs.get(path)
      if (d) return d
      const i = path.lastIndexOf('/')
      d = { path, name: path.slice(i + 1), dir: true, size: 0, modified: 0, kids: [] }
      dirs.set(path, d)
      dirAt(path.slice(0, i)).kids!.push(d)
      return d
    }
    for (const f of files) {
      const rel = f.webkitRelativePath || `${top}/${f.name}`
      const parts = rel.split('/')
      if (parts.some((p) => HIDDEN_RE.test(p))) continue
      dirAt(parts.slice(0, -1).join('/')).kids!.push({ path: rel, name: f.name, dir: false, size: f.size, modified: f.lastModified, file: f })
    }
    showRoot(rootNode)
  }

  const refresh = (): void => {
    if (!root) return
    const keepTrail = trail.map((n) => n.path)
    const keepOpen = expanded
    const fresh: FsNode = { ...root, kids: root.kids }
    showRoot(fresh)
    // Walk back down to where we were, reopening the folders that were open.
    void (async () => {
      let node = fresh
      const t = [fresh]
      for (const path of keepTrail.slice(1)) {
        const next = (await load(node)).find((n) => n.path === path)
        if (!next) break
        t.push(next); node = next
      }
      setTrail(t)
      for (const p of keepOpen) { const n = byPath.current.get(p); if (n) await load(n) }
      setExpanded(new Set([...keepOpen].filter((p) => byPath.current.has(p))))
    })()
  }

  const enter = (node: FsNode): void => {
    if (!root) return
    const parts = node.path.slice(root.path.length + 1).split('/')
    const t = [root]
    for (let i = 1; i <= parts.length; i++) { const n = byPath.current.get(`${root.path}/${parts.slice(0, i).join('/')}`); if (n) t.push(n) }
    setTrail(t); setSel([]); setCursor(null); setQuery(''); setDeep('idle')
    void load(node)
    listRef.current?.scrollTo({ top: 0 })
  }
  const goUp = (): void => { if (trail.length > 1) { const from = current!; setTrail(trail.slice(0, -1)); setSel([from.path]); setCursor(from.path) } }

  const toggleDir = (node: FsNode, open?: boolean): void => {
    const isOpen = expanded.has(node.path)
    const want = open ?? !isOpen
    if (want === isOpen) return
    setExpanded((s) => { const n = new Set(s); if (want) n.add(node.path); else n.delete(node.path); return n })
    if (want) void load(node)
  }

  /** Loads every folder under the current one, so search sees all of it. */
  const deepLoad = async (): Promise<void> => {
    if (!current) return
    setDeep('busy')
    let budget = 400
    const walk = async (n: FsNode): Promise<void> => {
      if (budget-- <= 0) return
      for (const c of await load(n)) if (c.dir) await walk(c)
    }
    await walk(current)
    setDeep('done')
  }

  // ── Rows ──
  const q = query.trim().toLowerCase()
  const rows = useMemo<Row[]>(() => {
    if (!current) return []
    const out: Row[] = []
    const keep = (n: FsNode): boolean => n.dir || !audioOnly || isAudioName(n.name)
    if (q) {
      // Search: every loaded file or folder under the current one, flat, with where it lives.
      const walk = (path: string): void => {
        for (const n of sortNodes(kids.get(path) ?? [], sort)) {
          if (keep(n) && n.name.toLowerCase().includes(q)) out.push({ node: n, depth: 0, sub: path.slice(current.path.length + 1) || undefined })
          if (n.dir) walk(n.path)
        }
      }
      walk(current.path)
      return out
    }
    const walk = (path: string, depth: number): void => {
      for (const n of sortNodes(kids.get(path) ?? [], sort)) {
        if (!keep(n)) continue
        out.push({ node: n, depth })
        if (n.dir && expanded.has(n.path)) walk(n.path, depth + 1)
      }
    }
    walk(current.path, 0)
    return out
  }, [current, kids, expanded, q, audioOnly, sort])
  const order = useMemo(() => rows.map((r) => r.node.path), [rows])
  const selSet = useMemo(() => new Set(sel), [sel])
  const unloadedDirs = useMemo(() => {
    if (!current || !q) return 0
    let n = 0
    const walk = (path: string): void => { for (const c of kids.get(path) ?? []) if (c.dir) { if (kids.has(c.path)) walk(c.path); else n++ } }
    walk(current.path)
    return n
  }, [current, kids, q])

  const stats = useMemo(() => {
    const list = current ? kids.get(current.path) ?? [] : []
    let folders = 0, files = 0, audio = 0, bytes = 0
    for (const n of list) { if (n.dir) folders++; else { files++; bytes += n.size; if (isAudioName(n.name)) audio++ } }
    return { folders, files, audio, bytes, loaded: !!current && kids.has(current.path) }
  }, [current, kids])

  // ── Selection ──
  const select = (path: string, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): void => {
    if (e.ctrlKey || e.metaKey) setSel((cur) => (cur.includes(path) ? cur.filter((p) => p !== path) : [...cur, path]))
    else if (e.shiftKey && cursor) {
      const a = order.indexOf(cursor), b = order.indexOf(path)
      if (a >= 0 && b >= 0) { setSel(order.slice(Math.min(a, b), Math.max(a, b) + 1)); return }
      setSel([path])
    } else setSel([path])
    setCursor(path)
  }
  const selNodes = (): FsNode[] => sel.map((p) => byPath.current.get(p)).filter((n): n is FsNode => !!n)
  const selFiles = selNodes().filter((n) => !n.dir)
  const selAudio = selFiles.filter((n) => isAudioName(n.name))
  const selDirs = sel.length - selFiles.length
  const selBytes = selFiles.reduce((s, n) => s + n.size, 0)

  const importNodes = async (nodes: FsNode[]): Promise<void> => {
    if (!nodes.length || importing) return
    setCollecting(true)
    try {
      const files = await collectAudio(nodes)
      if (!files.length) { setError('No audio files in that selection'); return }
      onImport(files)
    } finally { setCollecting(false) }
  }

  // ── Preview ──
  const voice = useRef<{ src: AudioBufferSourceNode; token: number } | null>(null)
  const token = useRef(0)
  const stopPreview = useCallback(() => {
    token.current++
    try { voice.current?.src.stop() } catch { /* already stopped */ }
    voice.current = null
    setPreview(null)
  }, [])
  const playPreview = async (n: FsNode): Promise<void> => {
    if (preview?.path === n.path) { stopPreview(); return }
    stopPreview()
    onPreviewStart?.()
    const my = ++token.current
    setPreview({ path: n.path, state: 'loading', start: 0, dur: 0 })
    try {
      const buf = await decodeAudioFile(await fileOf(n))
      if (my !== token.current) return
      const ctx = audioContext()
      await ctx.resume()
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      src.onended = () => { if (voice.current?.src === src) { voice.current = null; setPreview(null) } }
      src.start()
      voice.current = { src, token: my }
      setPreview({ path: n.path, state: 'playing', start: ctx.currentTime, dur: buf.duration })
    } catch {
      if (my === token.current) setPreview({ path: n.path, state: 'error', start: 0, dur: 0 })
    }
  }
  useEffect(() => { if (!active) stopPreview() }, [active, stopPreview])
  useEffect(() => stopPreview, [stopPreview])

  // ── Keyboard ──
  const onKey = (e: React.KeyboardEvent): void => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    const at = cursor ? order.indexOf(cursor) : -1
    const node = cursor ? byPath.current.get(cursor) : undefined
    const move = (i: number): void => {
      const p = order[Math.max(0, Math.min(order.length - 1, i))]
      if (!p) return
      if (e.shiftKey && cursor) { const a = order.indexOf(sel[0] ?? cursor), b = order.indexOf(p); setSel(order.slice(Math.min(a, b), Math.max(a, b) + 1)) }
      else setSel([p])
      setCursor(p)
      listRef.current?.querySelector(`[data-path="${CSS.escape(p)}"]`)?.scrollIntoView({ block: 'nearest' })
    }
    let handled = true
    const k = e.key
    if (k === 'ArrowDown') move(at + 1)
    else if (k === 'ArrowUp') move(at < 0 ? 0 : at - 1)
    else if (k === 'Home') move(0)
    else if (k === 'End') move(order.length - 1)
    else if (k === 'ArrowRight' && node?.dir) { if (expanded.has(node.path)) move(at + 1); else toggleDir(node, true) }
    else if (k === 'ArrowLeft' && node) {
      if (node.dir && expanded.has(node.path)) toggleDir(node, false)
      else { const parent = node.path.slice(0, node.path.lastIndexOf('/')); if (order.includes(parent)) move(order.indexOf(parent)) }
    }
    else if (k === 'Enter') {
      if (sel.length === 1 && node?.dir) enter(node)
      else void importNodes(selNodes())
    }
    else if (k === ' ' && node && !node.dir && isAudioName(node.name)) void playPreview(node)
    else if (k === ' ' && preview) stopPreview()
    else if (k === 'Backspace') goUp()
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'a') setSel(order)
    else if (k === 'Escape') { if (preview) stopPreview(); else setSel([]) }
    else if (k === 'F5') refresh()
    else handled = false
    if (handled) { e.preventDefault(); e.stopPropagation() }
  }

  const onDragStart = (n: FsNode, e: React.DragEvent): void => {
    const nodes = selSet.has(n.path) ? selNodes() : [n]
    dragged = nodes
    e.dataTransfer.setData(FS_DRAG, '1')
    e.dataTransfer.effectAllowed = 'copy'
    const ghost = document.createElement('div')
    ghost.textContent = nodes.length > 1 ? `${nodes.length} items` : n.name
    ghost.style.cssText = 'position:fixed;top:-100px;left:0;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:4px 10px;border-radius:999px;font:600 12px system-ui;color:#fff;background:rgb(var(--accent-rgb));box-shadow:3px 3px 0 rgb(var(--accent-rgb) / 0.4),6px 6px 0 rgb(var(--accent-rgb) / 0.2)'
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 12, 12)
    setTimeout(() => ghost.remove())
  }

  const folderInput = (
    <input
      ref={(el) => { inputRef.current = el; el?.setAttribute('webkitdirectory', '') }}
      type="file" multiple className="hidden"
      onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; fromInput(files) }}
    />
  )

  // ── No folder yet ──
  if (!root) {
    return (
      <div className="flex-1 overflow-y-auto p-3 animate-fade-in">
        {folderInput}
        <div className="relative overflow-hidden rounded-2xl border border-[var(--border)] p-5 text-center bg-gradient-to-br from-accent/20 via-accent/[0.06] to-transparent">
          <div className="pointer-events-none absolute -top-10 -right-10 w-32 h-32 rounded-full bg-accent/25 blur-3xl" />
          <div className="relative mx-auto mb-3 w-14 h-14 rounded-2xl bg-accent/15 ring-1 ring-accent/30 flex items-center justify-center text-accent shadow-[0_0_30px_rgb(var(--accent-rgb)/0.35)]">
            <FolderOpen size={26} />
          </div>
          <div className="relative text-sm font-semibold text-text-primary">Browse your files</div>
          <div className="relative mt-1 text-xs text-text-muted leading-relaxed">Open a folder to look through it and its subfolders. Listen to any audio file, then double-click it or drag it onto a lane.</div>
          <button
            className="relative mt-4 h-9 px-4 rounded-xl inline-flex items-center gap-2 text-sm font-medium bg-accent text-white hover:bg-accent-hover shadow-lg shadow-accent/25 transition"
            onClick={() => void pickFolder()}
          >
            <FolderSearch size={16} /> Open folder
          </button>
        </div>
        {error && <div className="mt-3 text-xs text-red-400">{error}</div>}
        {recents.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center gap-1.5 px-1 pb-1.5 text-[11px] uppercase tracking-wider text-text-muted"><History size={12} /> Recent</div>
            <div className="space-y-1">
              {recents.map((r) => (
                <div key={`${r.name}${r.at}`} className="group flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-surface-overlay cursor-pointer transition-colors" onClick={() => void openHandle(r.handle)}>
                  <div className="w-8 h-8 rounded-lg bg-amber-400/10 text-amber-400 flex items-center justify-center shrink-0"><Folder size={16} fill="currentColor" fillOpacity={0.25} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-text-primary truncate">{r.name}</div>
                    <div className="text-[11px] text-text-muted">{ago(r.at)}</div>
                  </div>
                  <button
                    className="w-6 h-6 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-[var(--surface-raised)] opacity-0 group-hover:opacity-100 transition"
                    title="Forget this folder"
                    onClick={(e) => { e.stopPropagation(); const next = recents.filter((x) => x !== r); setRecents(next); void saveRecents(next) }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  const busy = importing || collecting
  return (
    <div className="flex-1 flex flex-col min-h-0" data-fs-explorer>
      {folderInput}
      {/* Where we are */}
      <div className="shrink-0 p-2 pb-0">
        <div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-gradient-to-br from-accent/[0.14] via-accent/[0.04] to-transparent p-2.5">
          <div className="pointer-events-none absolute -top-8 -right-8 w-24 h-24 rounded-full bg-accent/20 blur-2xl" />
          <div className="relative flex items-center gap-2.5">
            <div className="w-9 h-9 shrink-0 rounded-xl bg-accent/15 ring-1 ring-accent/25 text-accent flex items-center justify-center"><FolderOpen size={18} /></div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-text-primary truncate" title={current?.path}>{current?.name}</div>
              <div className="text-[11px] text-text-muted tabular-nums truncate">
                {!stats.loaded ? 'Reading…' : [
                  stats.folders && `${stats.folders} folder${stats.folders === 1 ? '' : 's'}`,
                  `${stats.files} file${stats.files === 1 ? '' : 's'}`,
                  stats.audio && `${stats.audio} audio`,
                  stats.bytes && formatBytes(stats.bytes),
                ].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div className="flex items-center">
              <IconBtn title="Up a folder (Backspace)" disabled={trail.length < 2} onClick={goUp}><CornerLeftUp size={14} /></IconBtn>
              <IconBtn title="Refresh (F5)" onClick={refresh}><RefreshCw size={13} /></IconBtn>
              <IconBtn title="Open another folder" onClick={() => void pickFolder()}><FolderSearch size={14} /></IconBtn>
              <IconBtn title="Close folder" onClick={() => { stopPreview(); setRoot(null); setTrail([]) }}><X size={14} /></IconBtn>
            </div>
          </div>
          {trail.length > 1 && (
            <div className="relative mt-2 flex items-center gap-0.5 overflow-x-auto text-[11px] whitespace-nowrap scrollbar-none">
              {trail.map((n, i) => (
                <React.Fragment key={n.path}>
                  {i > 0 && <ChevronRight size={11} className="shrink-0 text-text-muted/60" />}
                  <button
                    className={`shrink-0 px-1.5 py-0.5 rounded-md transition-colors ${i === trail.length - 1 ? 'text-accent bg-accent/10' : 'text-text-muted hover:text-text-primary hover:bg-[var(--surface-raised)]'}`}
                    onClick={() => { setTrail(trail.slice(0, i + 1)); setSel([]); setCursor(null) }}
                  >
                    {n.name}
                  </button>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
        {/* Filter */}
        <div className="flex gap-1 py-2">
          <div className="relative flex-1 min-w-0">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); if (!e.target.value) setDeep('idle') }}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setQuery('') } else if (e.key === 'ArrowDown') { e.preventDefault(); listRef.current?.focus(); if (order[0]) { setSel([order[0]]); setCursor(order[0]) } } }}
              placeholder={`Search ${current?.name ?? ''}…`}
              className="h-8 w-full pl-8 pr-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent/60"
            />
          </div>
          <IconBtn boxed on={audioOnly} title={audioOnly ? 'Showing audio only - click to show every file' : 'Show audio files only'} onClick={() => setAudioOnly(!audioOnly)}><AudioLines size={14} /></IconBtn>
          <button
            className="h-8 px-2 shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] flex items-center gap-1 text-[11px] text-text-secondary hover:text-text-primary"
            title="Sort by"
            onClick={() => setSort(sort === 'name' ? 'date' : sort === 'date' ? 'size' : 'name')}
          >
            <ArrowDownAZ size={13} /> {SORT_LABEL[sort]}
          </button>
        </div>
      </div>

      {/* Listing */}
      <div
        ref={listRef}
        tabIndex={0}
        onKeyDown={onKey}
        className="relative flex-1 overflow-y-auto outline-none pb-2"
        onClick={(e) => { if (e.target === e.currentTarget) setSel([]) }}
      >
        {rows.map((r, i) => (
          <ExplorerRow
            key={r.node.path}
            row={r}
            open={expanded.has(r.node.path)}
            loading={loading.has(r.node.path)}
            selected={selSet.has(r.node.path)}
            joinUp={selSet.has(r.node.path) && i > 0 && selSet.has(rows[i - 1].node.path)}
            joinDown={selSet.has(r.node.path) && i < rows.length - 1 && selSet.has(rows[i + 1].node.path)}
            imported={!r.node.dir && importedKeys.has(`${stripExt(r.node.name)}|${r.node.size}`)}
            count={r.node.dir ? kids.get(r.node.path)?.length : undefined}
            preview={preview?.path === r.node.path ? preview : null}
            onSelect={(e) => { listRef.current?.focus({ preventScroll: true }); select(r.node.path, e) }}
            onToggle={() => toggleDir(r.node)}
            onOpen={() => (r.node.dir ? enter(r.node) : isAudioName(r.node.name) ? void importNodes([r.node]) : undefined)}
            onPreview={() => void playPreview(r.node)}
            onDragStart={(e) => onDragStart(r.node, e)}
          />
        ))}
        {stats.loaded && !rows.length && (
          <div className="mx-3 mt-3 px-3 py-6 rounded-xl border border-dashed border-[var(--border)] text-center text-xs text-text-muted">
            {q ? `Nothing matching "${query}"` : audioOnly ? 'No audio files here' : 'This folder is empty'}
          </div>
        )}
        {!stats.loaded && <div className="flex justify-center py-6 text-text-muted"><Loader2 size={18} className="animate-spin" /></div>}
        {q && unloadedDirs > 0 && deep !== 'done' && (
          <button
            className="mx-3 mt-2 w-[calc(100%-1.5rem)] h-8 rounded-lg flex items-center justify-center gap-1.5 text-[11px] text-accent bg-accent/10 hover:bg-accent/15 transition"
            disabled={deep === 'busy'}
            onClick={() => void deepLoad()}
          >
            {deep === 'busy' ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
            {deep === 'busy' ? 'Searching subfolders…' : `Also search ${unloadedDirs} unopened folder${unloadedDirs === 1 ? '' : 's'}`}
          </button>
        )}
        {error && (
          <div className="mx-3 mt-2 px-2.5 py-2 rounded-lg bg-red-500/10 text-[11px] text-red-400 flex items-start gap-2">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><X size={12} /></button>
          </div>
        )}
      </div>

      {/* Selection / hint */}
      <div className="shrink-0 border-t border-[var(--border)] px-2.5 py-2">
        {sel.length > 0 ? (
          <div className="flex items-center gap-2 animate-fade-in">
            <div className="flex-1 min-w-0 text-[11px] text-text-muted tabular-nums truncate">
              <span className="font-medium text-accent">{sel.length} selected</span>
              {selFiles.length > 0 && ` · ${formatBytes(selBytes)}`}
              {selDirs > 0 && ` · ${selDirs} folder${selDirs === 1 ? '' : 's'}`}
            </div>
            <button
              className="h-7 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-medium bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition"
              disabled={busy || (!selAudio.length && !selDirs)}
              title={selDirs ? 'Import every audio file in the selection, folders included (Enter)' : 'Import into this project (Enter)'}
              onClick={() => void importNodes(selNodes())}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Import size={13} />} Import{selAudio.length && !selDirs ? ` ${selAudio.length}` : ''}
            </button>
            <IconBtn title="Clear selection (Esc)" onClick={() => setSel([])}><X size={13} /></IconBtn>
          </div>
        ) : (
          <div className="text-[11px] text-text-muted leading-snug">
            Double-click or drag onto a lane to import · <kbd className="font-sans">Space</kbd> to listen
          </div>
        )}
      </div>
    </div>
  )
}

function IconBtn({ children, title, onClick, disabled, on, boxed }: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; on?: boolean; boxed?: boolean }): JSX.Element {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`shrink-0 flex items-center justify-center transition-colors disabled:opacity-30 disabled:pointer-events-none ${boxed ? 'h-8 w-8 rounded-lg border border-[var(--border)]' : 'h-7 w-7 rounded-md'} ${on ? 'bg-accent/15 text-accent border-accent/40' : `${boxed ? 'bg-[var(--surface-raised)]' : ''} text-text-muted hover:text-text-primary hover:bg-[var(--surface-raised)]`}`}
    >
      {children}
    </button>
  )
}

const ExplorerRow = memo(function ExplorerRow({ row, open, loading, selected, joinUp, joinDown, imported, count, preview, onSelect, onToggle, onOpen, onPreview, onDragStart }: {
  row: Row; open: boolean; loading: boolean; selected: boolean; joinUp: boolean; joinDown: boolean; imported: boolean; count?: number; preview: Preview | null
  onSelect: (e: React.MouseEvent) => void; onToggle: () => void; onOpen: () => void; onPreview: () => void; onDragStart: (e: React.DragEvent) => void
}): JSX.Element {
  const { node, depth, sub } = row
  const audio = !node.dir && isAudioName(node.name)
  const { Icon, cls } = iconFor(node.name)
  const ext = extOf(node.name)
  const playing = preview?.state === 'playing'
  return (
    <div
      data-path={node.path}
      draggable
      onDragStart={onDragStart}
      onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) onSelect(e) }}
      onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('button')) onOpen() }}
      title={`${node.path}${node.dir ? '\nClick the arrow to expand · double-click to open' : audio ? `\n${imported ? 'Already in this project · ' : ''}Double-click to import · drag onto a lane` : ''}`}
      className={`group relative flex items-center gap-1.5 mx-1 pr-2 h-8 rounded-lg cursor-default transition-colors ${selected ? 'bg-accent/[0.18]' : preview ? 'bg-accent/10' : 'hover:bg-surface-overlay'} ${selected && joinUp ? 'rounded-t-none' : ''} ${selected && joinDown ? 'rounded-b-none' : ''} ${!node.dir && !audio ? 'opacity-60' : ''}`}
      style={{ paddingLeft: 6 + depth * 14 }}
    >
      {/* Indent guides */}
      {Array.from({ length: depth }, (_, d) => (
        <span key={d} className="absolute top-0 bottom-0 w-px bg-[var(--border)]" style={{ left: 13 + d * 14 }} />
      ))}
      {node.dir ? (
        <button className="w-4 h-4 shrink-0 flex items-center justify-center text-text-muted hover:text-text-primary" onClick={onToggle} tabIndex={-1}>
          {loading ? <Loader2 size={11} className="animate-spin" /> : <ChevronRight size={13} className={`transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />}
        </button>
      ) : <span className="w-4 shrink-0" />}
      {node.dir ? (
        <span className="w-6 h-6 shrink-0 flex items-center justify-center text-amber-400">
          {open ? <FolderOpen size={15} /> : <Folder size={15} fill="currentColor" fillOpacity={0.25} />}
        </span>
      ) : audio ? (
        <button
          className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center transition-all ${preview ? 'bg-accent text-white shadow-[0_0_12px_rgb(var(--accent-rgb)/0.55)]' : `${cls} group-hover:bg-[var(--surface-raised)] group-hover:text-text-primary`}`}
          title={preview?.state === 'error' ? "Couldn't play this file" : playing ? 'Stop (Space)' : 'Listen (Space)'}
          onClick={onPreview}
          tabIndex={-1}
        >
          {preview?.state === 'loading' ? <Loader2 size={11} className="animate-spin" />
            : playing ? <Pause size={10} fill="currentColor" />
            : <>
                <Music size={13} className="group-hover:hidden" />
                <Play size={10} fill="currentColor" className="ml-px hidden group-hover:block" />
              </>}
        </button>
      ) : (
        <span className={`w-6 h-6 shrink-0 flex items-center justify-center ${cls}`}><Icon size={14} /></span>
      )}
      <div className="flex-1 min-w-0">
        <div className={`text-[12.5px] truncate leading-tight ${preview?.state === 'error' ? 'text-red-400' : preview ? 'text-accent font-medium' : 'text-text-primary'}`}>{node.name}</div>
        {sub && <div className="text-[10px] text-text-muted truncate leading-tight">{sub}</div>}
      </div>
      {imported && <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_6px_rgb(var(--accent-rgb)/0.8)]" title="Already in this project" />}
      {node.dir
        ? count != null && <span className="text-[10px] tabular-nums text-text-muted">{count}</span>
        : <>
            {playing && preview ? <span className="text-[10px] tabular-nums text-accent">{formatTime(preview.dur)}</span> : <span className="text-[10px] tabular-nums text-text-muted">{formatBytes(node.size)}</span>}
            {ext && <span className={`px-1 rounded text-[9px] font-semibold uppercase tracking-wide ${EXT_STYLE[ext] ?? 'text-text-muted bg-[var(--surface-raised)]'}`}>{ext}</span>}
          </>}
      {playing && preview && <PreviewBar start={preview.start} dur={preview.dur} />}
    </div>
  )
})

function PreviewBar({ start, dur }: { start: number; dur: number }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      const f = Math.min(1, (audioContext().currentTime - start) / dur)
      if (ref.current) ref.current.style.transform = `scaleX(${f})`
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [start, dur])
  return (
    <div className="absolute left-2 right-2 bottom-0.5 h-[2px] rounded-full bg-accent/15 overflow-hidden pointer-events-none">
      <div ref={ref} className="h-full bg-accent origin-left" style={{ transform: 'scaleX(0)' }} />
    </div>
  )
}
