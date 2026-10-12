import React, { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  Activity, ArrowDown, ArrowLeft, ArrowUp, Check, Info, ClipboardCopy, ClipboardPaste, CopyPlus, Eraser, FolderInput, FolderMinus, FolderPlus, Headphones, Highlighter, ChevronDown, ChevronLeft, ChevronRight, Copy, Crosshair, Download, FileDown, FileUp, Flag, HardDrive, HardDriveDownload, Layers, Loader2, Magnet,
  Minus, Pause, Play, Pencil, Plus, Power, Gauge, Redo2, RefreshCw, Repeat, Rewind, RotateCcw, RotateCw, Scissors, Search, SquareDashedMousePointer, Settings2, SkipBack, SlidersHorizontal, Trash2, Undo2, Volume2, VolumeX, Wand2, X,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import { useStore } from '../store/useStore'
import { useIsMobile } from '../hooks/useIsMobile'
import { onOpenSessionRequest, takePendingSession } from '../lib/sessionMakerOpen'
import { formatBytes } from '../lib/format'
import { useVstPlugins, vstApi, vstPlugins, type VstScan } from '../lib/vstPlugins'
import ContextMenu, { type ContextMenuItem } from './ContextMenu'
import type { JWApiFileEntry } from '../lib/juicewrldApi'
import {
  PEAKS_PER_SEC, SessionEngine, alignReference, detectTempo, cancelDownload, chooseSessionFolder, downloadSession, downloadSessionByPath, hasSessionFolderSupport, sessionFolder, downloadsVersion, listDownloadedSessions, peekDownload, removeDownloadedSession, subscribeDownloads, alternatesOf, compTo, hasMutedClips, unmuteAll, defaultReference, deleteProject, duplicateProject, isBeatTrack, downloadBlob, encodeWav, formatTime, listSessionFolders, listSessionZips,
  loadProjects, loadTake, newProject, parseProjectFile, peakOf, peekLoadProgress, placeAllTakes, projectEnd, renderProject, scaleBuffer,
  saveProject, scanSession, searchSessionZips, sessionTitle, silentSpans, swipeComp, audibleSpans, groupIntoFolder, lastFolder, normalizeFolders, timelineRows, ungroupFolder, subscribeLoadProgress, takeKey, uid,
  CHAIN_KEYS, CHAIN_LABELS, DEFAULT_ECHO_NOTE, DEFAULT_REVERB_SIZE, ECHO_NOTES, FX_KEYS, FX_LABELS, REVERB_SIZES, audioContext, chainActive, chainReadout, clipAudioState, clipSpeed, copyEffects, editTracksFx, hasEffects, laneFx, pasteEffects, pluginEditorKey, pluginRows, echoSeconds, retimeClip, reverseClip, reversedPeaks, stretchVersion, subscribeStretches, takeTime, MAX_PITCH, MAX_SPEED, MIN_SPEED,
  type ChainKey, type FxCopy, type FxEdit, type LaneFx, type PluginRow, type SmPlugin, type EchoNote, type FxKey, type ReverbSize, type TrackChain, type TrackFx, type AB, type DownloadedSession, type LoadedTake, type LoopRange, type ScannedSession, type SessionFolder, type SmClip, type SmProject, type SmTrack, type Take, type TakeCategory, type TakeFolder, type TimelineRow,
} from '../lib/sessionMaker'

const HEADER_W = 208
const LANE_H = 76
const RULER_H = 30
const MIN_PPS = 4
const MAX_PPS = 600
const TILE_W = 2048
const TRACK_COLORS = ['#a78bfa', '#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#22d3ee', '#fb923c', '#a3e635']

type GridDiv = 'off' | 'bar' | 'beat' | 'half' | 'quarter'
const GRID_BEATS: Record<GridDiv, number> = { off: 0, bar: 4, beat: 1, half: 0.5, quarter: 0.25 }

const btn = 'inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors disabled:opacity-40 disabled:pointer-events-none'
const btnOn = 'bg-accent/15 text-accent hover:text-accent'
const input = 'h-8 px-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-text-primary outline-none focus:border-accent/60'

interface Opened { project: SmProject; session: ScannedSession }

// ─── Root ────────────────────────────────────────────────────────────────────

export default function SessionMakerView(): JSX.Element {
  const isMobile = useIsMobile()
  const [opened, setOpened] = useState<Opened | null>(null)
  const [opening, setOpening] = useState<{ label: string; done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const open = useCallback(async (zipPath: string, existing?: SmProject) => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setError(null)
    const label = sessionTitle(zipPath.split('/').pop() ?? zipPath)
    setOpening({ label, done: 0, total: 0 })
    try {
      const session = await scanSession(zipPath, (done, total) => { if (!ac.signal.aborted) setOpening({ label, done, total }) }, ac.signal)
      if (ac.signal.aborted) return
      if (!session.takes.length) throw new Error('No audio files found in this session')
      const project = existing ?? newProject(session, label)
      saveProject(project)
      setOpened({ project, session })
    } catch (err) {
      if (!ac.signal.aborted) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (abortRef.current === ac) setOpening(null)
    }
  }, [])

  // A session handed over by the song menu / terminal, or a /session-maker?zip=<path> link.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('zip')
    if (fromUrl) window.history.replaceState(window.history.state, '', '/session-maker')
    const first = takePendingSession() ?? fromUrl
    if (first) void open(first)
    const off = onOpenSessionRequest(() => {
      const z = takePendingSession()
      if (z) { setOpened(null); void open(z) }
    })
    return () => { off(); abortRef.current?.abort() }
  }, [open])

  if (isMobile) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center">
        <Layers size={36} className="text-text-muted" />
        <div className="text-text-primary font-semibold">Session Maker is desktop-only</div>
        <div className="text-text-muted text-sm max-w-xs">Open the site on a computer (or the desktop app) to arrange studio sessions.</div>
      </div>
    )
  }

  if (opened) {
    return <SessionEditor key={opened.project.id} initial={opened.project} session={opened.session} onClose={() => setOpened(null)} onOpenCopy={(project) => setOpened({ project, session: opened.session })} />
  }

  return <SessionBrowser opening={opening} error={error} onOpenZip={(p) => void open(p)} onOpenProject={(p) => void open(p.zipPath, p)} />
}

const HELP_ROWS: [string, string][] = [
  ['Drag takes onto a lane', 'Place a take'],
  ['Double-click a take', 'Drop it where it was recorded'],
  ['Ctrl/Shift+click', 'Select several takes or track headers'],
  ['Enter', 'Place the selected takes'],
  ['Drag headers / Alt+↑↓', 'Reorder tracks'],
  ['F2', 'Rename a take'],
  ['Space', 'Play / pause'],
  ['L', 'Loop'],
  ['[  ]', 'Cycle alternate takes'],
  ['C', 'Comp'],
  ['K', 'Swipe comp: drag across a take to hear it there'],
  ['Folder chevron', 'Fold a take folder down to its comp lane'],
  ['←→ / ↑↓', 'Move clips a grid step / a lane (Alt+←→ fine)'],
  ['M', 'Mute clip'],
  ['R', 'Original / your mix'],
  ['S', 'Split'],
  ['Ctrl+D', 'Duplicate'],
  ['Del', 'Remove'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
  ['- / +  or  Ctrl+wheel', 'Zoom'],
]

/** Shortcut and gesture cheat sheet, opened from the toolbar. */
function HelpMenu(): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button className={`${btn} ${open ? btnOn : ''}`} title="Shortcuts and tips" onClick={() => setOpen(!open)}><Info size={15} /></button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-80 p-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-xl">
          <div className="text-[11px] uppercase tracking-wider text-text-muted mb-2">Shortcuts &amp; tips</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
            {HELP_ROWS.map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="font-mono text-text-primary whitespace-nowrap">{k}</dt>
                <dd className="text-text-muted">{v}</dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      )}
    </div>
  )
}

/** Downloads the whole session zip, so takes load from the device instead of streaming. */
function SessionDownloadButton({ session, full }: { session: ScannedSession; full?: boolean }): JSX.Element {
  useSyncExternalStore(subscribeDownloads, downloadsVersion)
  const d = peekDownload(session.zipPath)
  const size = formatBytes(session.zip.size)
  const cls = full ? `${btn} w-full justify-start` : btn
  if (session.zip.local) {
    return (
      <button
        className={`${cls} text-accent hover:text-red-400`}
        title={`This session (${size}) is on your device - takes load instantly. Click to remove the download.`}
        onClick={() => { if (confirm(`Remove the downloaded session (${size})? Takes will stream again.`)) void removeDownloadedSession(session.zipPath) }}
      >
        <Check size={15} /> Downloaded
      </button>
    )
  }
  if (d && !d.error) {
    return (
      <button className={`${cls} tabular-nums`} title="Downloading the whole session - click to cancel" onClick={() => cancelDownload(session.zipPath)}>
        <Loader2 size={15} className="animate-spin" /> {Math.floor((d.received / (d.total || 1)) * 100)}%
      </button>
    )
  }
  return (
    <button
      className={`${cls} ${d?.error ? 'text-red-400' : ''}`}
      title={d?.error ? `Download failed: ${d.error} - click to retry` : `Download the whole session (${size}) so previews and takes load instantly. It's kept for next time.`}
      onClick={() => downloadSession(session)}
    >
      <HardDriveDownload size={15} /> {d?.error ? 'Retry' : size}
    </button>
  )
}

// ─── Browser ─────────────────────────────────────────────────────────────────

function SessionBrowser({ opening, error, onOpenZip, onOpenProject }: {
  opening: { label: string; done: number; total: number } | null
  error: string | null
  onOpenZip: (zipPath: string) => void
  onOpenProject: (p: SmProject) => void
}): JSX.Element {
  const [folders, setFolders] = useState<SessionFolder[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [zips, setZips] = useState<Record<string, JWApiFileEntry[]>>({})
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<JWApiFileEntry[] | null>(null)
  const [projects, setProjects] = useState<SmProject[]>(() => loadProjects())
  const [loadError, setLoadError] = useState<string | null>(null)
  // Multi-select: ctrl/shift-click (or the boxes) pick sessions; plain clicks then toggle too.
  const [picked, setPicked] = useState<Map<string, number>>(() => new Map())
  const togglePicked = (z: JWApiFileEntry): void =>
    setPicked((m) => { const n = new Map(m); if (n.has(z.path)) n.delete(z.path); else n.set(z.path, z.size ?? 0); return n })
  const fileRef = useRef<HTMLInputElement>(null)
  const dlVersion = useSyncExternalStore(subscribeDownloads, downloadsVersion)
  const [downloaded, setDownloaded] = useState<DownloadedSession[]>([])
  useEffect(() => { void listDownloadedSessions().then(setDownloaded) }, [dlVersion])
  const downloadedPaths = useMemo(() => new Set(downloaded.map((d) => d.zipPath)), [downloaded])

  useEffect(() => {
    listSessionFolders().then(setFolders).catch(() => setLoadError('Could not load the session list'))
  }, [])

  useEffect(() => {
    if (!expanded || zips[expanded]) return
    listSessionZips(expanded).then((z) => setZips((m) => ({ ...m, [expanded]: z }))).catch(() => setZips((m) => ({ ...m, [expanded]: [] })))
  }, [expanded, zips])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults(null); return }
    let live = true
    const t = setTimeout(() => {
      searchSessionZips(q).then((r) => { if (live) setResults(r) }).catch(() => { if (live) setResults([]) })
    }, 300)
    return () => { live = false; clearTimeout(t) }
  }, [query])

  const importFile = async (f: File): Promise<void> => {
    try {
      const p = parseProjectFile(await f.text())
      saveProject(p)
      setProjects(loadProjects())
      onOpenProject(p)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not read that file')
    }
  }

  const zipRow = (z: JWApiFileEntry): JSX.Element => {
    const on = picked.has(z.path)
    return (
      <button
        key={z.path}
        onClick={(e) => { if (e.shiftKey || e.ctrlKey || e.metaKey || picked.size > 0) togglePicked(z); else onOpenZip(z.path) }}
        disabled={!!opening}
        className={`group w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-surface-overlay transition-colors disabled:opacity-50 ${on ? 'bg-accent/10' : ''}`}
      >
        <span
          role="checkbox"
          aria-checked={on}
          title={on ? 'Deselect' : 'Select'}
          onClick={(e) => { e.stopPropagation(); togglePicked(z) }}
          className={`shrink-0 w-[15px] h-[15px] rounded border flex items-center justify-center ${on ? 'bg-accent border-accent text-white' : 'border-[var(--border)] text-transparent'} ${on || picked.size > 0 ? '' : 'hidden group-hover:flex'}`}
        >
          <Check size={11} />
        </span>
        {!on && picked.size === 0 && <Layers size={15} className="text-text-muted shrink-0 group-hover:hidden" />}
        <span className="flex-1 truncate text-sm text-text-primary">{sessionTitle(z.name)}</span>
        {downloadedPaths.has(z.path) && <span title="Downloaded - opens and previews instantly"><HardDrive size={13} className="text-accent" /></span>}
        <span className="text-xs text-text-muted tabular-nums">{z.size ? formatBytes(z.size) : ''}</span>
      </button>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 pt-12 pb-16">
        <div className="flex items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Session Maker</h1>
            <p className="text-sm text-text-muted mt-1 max-w-xl">
              Open a studio session, drag takes onto the timeline over the beat, and arrange your own version. Takes stream straight out of the session - nothing to download first, though downloading a whole session makes previews instant.
            </p>
          </div>
        </div>

        {opening && (
          <div className="mb-6 p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] flex items-center gap-3">
            <Loader2 size={18} className="animate-spin text-accent" />
            <div className="flex-1">
              <div className="text-sm text-text-primary">Opening {opening.label}…</div>
              <div className="text-xs text-text-muted">{opening.total ? `Reading takes ${opening.done}/${opening.total}` : 'Reading the session'}</div>
            </div>
          </div>
        )}
        {(error || loadError) && (
          <div className="mb-6 p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-sm text-red-400">{error || loadError}</div>
        )}

        <div className="grid grid-cols-[1fr_320px] gap-8">
          <section>
            {picked.size > 0 && (
              <div className="mb-3 flex items-center gap-1 px-3 py-1.5 rounded-xl border border-accent/40 bg-accent/10 text-sm">
                <span className="flex-1 text-text-primary tabular-nums">{picked.size} selected · {formatBytes([...picked.values()].reduce((n, v) => n + v, 0))}</span>
                <button
                  className={btn}
                  title="Download the selected sessions"
                  onClick={() => { for (const [path, size] of picked) if (!downloadedPaths.has(path)) downloadSessionByPath(path, size); setPicked(new Map()) }}
                >
                  <HardDriveDownload size={15} /> Download
                </button>
                {[...picked.keys()].some((p) => downloadedPaths.has(p)) && (
                  <button
                    className={`${btn} hover:text-red-400`}
                    title="Remove the downloaded copies of the selected sessions"
                    onClick={() => {
                      const gone = [...picked.keys()].filter((p) => downloadedPaths.has(p))
                      if (confirm(`Remove ${gone.length} downloaded session${gone.length === 1 ? '' : 's'}? Takes will stream again.`)) { for (const p of gone) void removeDownloadedSession(p); setPicked(new Map()) }
                    }}
                  >
                    <Trash2 size={15} /> Remove
                  </button>
                )}
                <button className={btn} onClick={() => setPicked(new Map())}>Clear</button>
              </div>
            )}
            <div className="relative mb-3">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sessions…" className={`${input} w-full pl-9 h-10`} />
            </div>
            {results ? (
              <div className="space-y-0.5">
                {results.length ? results.map(zipRow) : <div className="text-sm text-text-muted px-3 py-6">No sessions match "{query}".</div>}
              </div>
            ) : !folders ? (
              <div className="flex items-center gap-2 text-sm text-text-muted px-3 py-6"><Loader2 size={15} className="animate-spin" /> Loading sessions…</div>
            ) : (
              <div className="space-y-1">
                {folders.filter((f) => f.count > 0).map((f) => (
                  <div key={f.path} className="rounded-xl border border-[var(--border)] overflow-hidden">
                    <button
                      onClick={() => setExpanded(expanded === f.path ? null : f.path)}
                      className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-surface-overlay transition-colors"
                    >
                      {expanded === f.path ? <ChevronDown size={16} className="text-text-muted" /> : <ChevronRight size={16} className="text-text-muted" />}
                      <span className="flex-1 text-sm font-medium text-text-primary">{f.name.replace(/^\d+\.\s*/, '').replace(/\s*\(Sessions\)$/i, '')}</span>
                      <span className="text-xs text-text-muted">{f.count}</span>
                    </button>
                    {expanded === f.path && (
                      <div className="px-1.5 pb-1.5 border-t border-[var(--border)]">
                        {zips[f.path] ? zips[f.path].map(zipRow) : <div className="flex items-center gap-2 text-sm text-text-muted px-3 py-3"><Loader2 size={14} className="animate-spin" /> Loading…</div>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <aside>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-text-primary">Your projects</h2>
              <button className={btn} onClick={() => fileRef.current?.click()} title="Open a project file">
                <FileUp size={15} /> Import
              </button>
              <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f) }} />
            </div>
            {projects.length === 0 ? (
              <div className="text-sm text-text-muted p-4 rounded-xl border border-dashed border-[var(--border)]">
                Projects you make are saved here automatically.
              </div>
            ) : (
              <div className="space-y-1">
                {projects.map((p) => (
                  <div key={p.id} className="group flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-overlay transition-colors">
                    <button className="flex-1 min-w-0 text-left" disabled={!!opening} onClick={() => onOpenProject(p)}>
                      <div className="text-sm text-text-primary truncate">{p.name}</div>
                      <div className="text-xs text-text-muted truncate">
                        {sessionTitle(p.zipPath.split('/').pop() ?? '')} · {p.tracks.reduce((n, t) => n + t.clips.length, 0)} clips · {new Date(p.updatedAt).toLocaleDateString()}
                      </div>
                    </button>
                    <button
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-text-muted hover:text-text-primary transition"
                      title="Duplicate project"
                      onClick={() => { duplicateProject(p); setProjects(loadProjects()) }}
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-text-muted hover:text-red-400 transition"
                      title="Delete project"
                      onClick={() => { if (confirm(`Delete "${p.name}"?`)) { deleteProject(p.id); setProjects(loadProjects()) } }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {hasSessionFolderSupport() && (
              <div className="flex items-center gap-2 mt-8 text-xs text-text-muted">
                <HardDrive size={14} className="shrink-0" />
                <span className="flex-1 min-w-0 truncate" title={sessionFolder() ?? undefined}>{sessionFolder() ?? 'Downloads ask for a folder'}</span>
                <button className="text-accent hover:underline shrink-0" onClick={() => void chooseSessionFolder().then(() => listDownloadedSessions().then(setDownloaded))}>
                  {sessionFolder() ? 'Change' : 'Choose'}
                </button>
              </div>
            )}

            {downloaded.length > 0 && (
              <>
                <div className="flex items-center justify-between mt-8 mb-3">
                  <h2 className="text-sm font-semibold text-text-primary">Downloaded</h2>
                  <span className="text-xs text-text-muted tabular-nums">{formatBytes(downloaded.reduce((n, d) => n + d.size, 0))}</span>
                </div>
                <div className="space-y-1">
                  {downloaded.map((d) => (
                    <div key={d.zipPath} className="group flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-overlay transition-colors">
                      <button className="flex-1 min-w-0 flex items-center gap-2 text-left" disabled={!!opening} onClick={() => onOpenZip(d.zipPath)}>
                        <HardDrive size={14} className="text-accent shrink-0" />
                        <span className="flex-1 truncate text-sm text-text-primary">{sessionTitle(d.zipPath.split('/').pop() ?? '')}</span>
                        <span className="text-xs text-text-muted tabular-nums">{formatBytes(d.size)}</span>
                      </button>
                      <button
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-text-muted hover:text-red-400 transition"
                        title="Remove the download (projects are kept)"
                        onClick={() => void removeDownloadedSession(d.zipPath)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

// ─── Editor ──────────────────────────────────────────────────────────────────

type DragMode = 'move' | 'trimL' | 'trimR' | 'fadeIn' | 'fadeOut'
interface DragState {
  mode: DragMode
  clipId: string
  trackIdx: number
  startX: number
  startY: number
  orig: SmClip
  /** Every clip a 'move' drags: the whole selection when the grabbed clip is part of it. */
  group: { orig: SmClip; trackIdx: number }[]
  /** Plain click on a clip inside a multi-selection: narrows to it on release if nothing was dragged. */
  collapseTo?: string
  snapshot: SmProject
  moved: boolean
  /** The last applied result, so pointer moves that snap to the same spot don't re-render. */
  last?: string
}

function findClip(p: SmProject, clipId: string): { track: SmTrack; trackIdx: number; clip: SmClip } | null {
  for (let i = 0; i < p.tracks.length; i++) {
    const clip = p.tracks[i].clips.find((c) => c.id === clipId)
    if (clip) return { track: p.tracks[i], trackIdx: i, clip }
  }
  return null
}

function mapClip(p: SmProject, clipId: string, fn: (c: SmClip) => SmClip): SmProject {
  return { ...p, tracks: p.tracks.map((t) => (t.clips.some((c) => c.id === clipId) ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? fn(c) : c)) } : t)) }
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
const sameIds = (a: string[], b: string[]): boolean => a.length === b.length && a.every((id, i) => id === b[i])

/** A callback whose identity never changes but always runs the latest closure - keeps memoized rows from re-rendering. */
function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn)
  ref.current = fn
  return useCallback((...args: A) => ref.current(...args), [])
}
const dbOf = (g: number): number => (g <= 0 ? -60 : 20 * Math.log10(g))
const gainOf = (db: number): number => (db <= -60 ? 0 : Math.pow(10, db / 20))

function SessionEditor({ initial, session: scanned, onClose, onOpenCopy }: { initial: SmProject; session: ScannedSession; onClose: () => void; onOpenCopy: (p: SmProject) => void }): JSX.Element {
  // Projects saved before references existed get the default one.
  const [project, setProject] = useState<SmProject>(() => {
    if (initial.reference !== undefined) return initial
    const ref = defaultReference(scanned)
    return { ...initial, reference: ref ? { takeId: ref.id, offset: 0 } : null }
  })
  const projectRef = useRef(project)
  projectRef.current = project
  const undoRef = useRef<SmProject[]>([])
  const redoRef = useRef<SmProject[]>([])
  const [, bumpHistory] = useState(0)
  // The session as the editor sees it: takes carry any names the user gave them.
  const takeNames = project.takeNames
  const session = useMemo<ScannedSession>(
    () => (takeNames && Object.keys(takeNames).length ? { ...scanned, takes: scanned.takes.map((t) => (takeNames[t.id] ? { ...t, name: takeNames[t.id] } : t)) } : scanned),
    [scanned, takeNames],
  )

  const [pps, setPps] = useState(40)
  const ppsRef = useRef(pps)
  ppsRef.current = pps
  const [grid, setGrid] = useState<GridDiv>(session.bpm ? 'beat' : 'off')
  const [follow, setFollow] = useState(true)
  // Clip ids; the last is the "primary" one the inspector, comping and alternates act on.
  const [selection, setSelection] = useState<string[]>([])
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const selected = selection.length ? selection[selection.length - 1] : null
  const setSelected = useCallback((id: string | null) => setSelection(id ? [id] : []), [])
  const selectedSet = useMemo(() => new Set(selection), [selection])
  // Track ids, in click order; the last one anchors shift-click ranges.
  const [trackSel, setTrackSel] = useState<string[]>([])
  const trackSelRef = useRef(trackSel)
  trackSelRef.current = trackSel
  const trackSelSet = useMemo(() => new Set(trackSel), [trackSel])
  // Clips and tracks don't stay selected at the same time.
  useEffect(() => { if (selection.length) setTrackSel((cur) => (cur.length ? [] : cur)) }, [selection])
  const marqueeRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [loaded, setLoaded] = useState<Map<string, LoadedTake>>(() => new Map())
  const [failed, setFailed] = useState<Set<string>>(() => new Set())
  const [previewing, setPreviewing] = useState<string | null>(null)
  const previewingRef = useRef(previewing)
  previewingRef.current = previewing
  const [previewPaused, setPreviewPaused] = useState(false)
  const [previewLoop, setPreviewLoop] = useState(false)
  const [previewVolume, setPreviewVolume] = useState(1)
  // Right-click menu for a take in the bin, or for a clip of it on the timeline.
  const [takeMenu, setTakeMenu] = useState<{ takeId: string; clipId?: string; x: number; y: number } | null>(null)
  // Which take's name is being edited, and where - the bin row or the clip inspector.
  const [renaming, setRenaming] = useState<{ takeId: string; where: 'bin' | 'inspector' } | null>(null)
  // Tracks being dragged to a new position, and the gap (0..tracks.length) they'd land in.
  // Tracks being dragged, and the gap between timeline rows (0..rows.length) they'd land in.
  const [trackDrag, setTrackDrag] = useState<{ ids: string[]; insertAt: number } | null>(null)
  // Take folders folded down to their comp lane (view state only), and a folder's right-click menu.
  const [closedFolders, setClosedFolders] = useState<Set<string>>(() => new Set())
  const [folderMenu, setFolderMenu] = useState<{ folderId: string; x: number; y: number } | null>(null)
  // Categories folded shut in the bin (view state only), the one whose name is being edited, and its right-click menu.
  const [closedCats, setClosedCats] = useState<Set<string>>(() => new Set())
  const [renamingCat, setRenamingCat] = useState<string | null>(null)
  const [catMenu, setCatMenu] = useState<{ catId: string; x: number; y: number } | null>(null)
  const [catDropTarget, setCatDropTarget] = useState<string | null>(null)
  // A drag that ends anywhere (dropped on the timeline, cancelled) clears the highlight.
  useEffect(() => {
    const clear = (): void => setCatDropTarget(null)
    window.addEventListener('dragend', clear)
    return () => window.removeEventListener('dragend', clear)
  }, [])
  const [trackMenu, setTrackMenu] = useState<{ trackId: string; x: number; y: number } | null>(null)
  const editBinName = useCallback((takeId: string | null) => setRenaming(takeId ? { takeId, where: 'bin' } : null), [])
  // Takes selected in the bin, in click order; the last anchors shift-click ranges.
  const [binSel, setBinSel] = useState<string[]>([])
  const binSelRef = useRef(binSel)
  binSelRef.current = binSel
  const binSelSet = useMemo(() => new Set(binSel), [binSel])
  const binListRef = useRef<HTMLDivElement>(null)
  /** Visible bin order, for shift-click ranges and Ctrl+A. */
  const binOrderRef = useRef<string[]>([])
  const placeFromBinRef = useRef<(t: Take) => void>(() => {})
  const [exporting, setExporting] = useState<string | null>(null)
  const [projMenu, setProjMenu] = useState(false)
  const projMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!projMenu) return
    const onDown = (e: PointerEvent): void => { if (!projMenuRef.current?.contains(e.target as Node)) setProjMenu(false) }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [projMenu])
  const [binQuery, setBinQuery] = useState('')
  const [showBounces, setShowBounces] = useState(false)
  const [ab, setAb] = useState<AB>('mix')

  const engineRef = useRef<SessionEngine>()
  if (!engineRef.current) engineRef.current = new SessionEngine()
  const engine = engineRef.current
  const closePreview = useCallback(() => { engine.stopPreview(); setPreviewing(null); setPreviewPaused(false) }, [engine])
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)

  const takesById = useMemo(() => new Map(session.takes.map((t) => [t.id, t])), [session])
  const rows = useMemo(() => timelineRows(project, closedFolders), [project, closedFolders])
  const rowsLayoutRef = useRef(rows)
  rowsLayoutRef.current = rows
  const scannedNames = useMemo(() => new Map(scanned.takes.map((t) => [t.id, t.name])), [scanned])
  const loadedRef = useRef(loaded)
  loadedRef.current = loaded
  const bufferFor = useCallback((takeId: string) => loadedRef.current.get(takeId)?.buffer, [])

  // ── History ──
  const pushUndo = (prev: SmProject): void => {
    undoRef.current.push(prev)
    if (undoRef.current.length > 200) undoRef.current.shift()
    redoRef.current = []
  }
  // Live edits (typing, slider drags) apply as they happen; a burst of them
  // becomes one undo step, closed once input pauses or anything else touches history.
  const liveRef = useRef<{ start: SmProject; latest: SmProject; timer: ReturnType<typeof setTimeout> } | null>(null)
  const settleLive = useCallback(() => {
    const live = liveRef.current
    if (!live) return
    liveRef.current = null
    clearTimeout(live.timer)
    if (live.latest !== live.start) { pushUndo(live.start); bumpHistory((n) => n + 1) }
  }, [])
  const setLive = useCallback((next: SmProject) => {
    const live = liveRef.current
    if (live) clearTimeout(live.timer)
    liveRef.current = { start: live?.start ?? projectRef.current, latest: next, timer: setTimeout(settleLive, 800) }
    setProject(next)
  }, [settleLive])
  useEffect(() => () => { if (liveRef.current) clearTimeout(liveRef.current.timer) }, [])
  const commit = useCallback((next: SmProject, prev: SmProject = projectRef.current) => {
    settleLive()
    // Take folders' lanes stay together whatever moved them.
    next = normalizeFolders(next)
    if (next === prev) return
    pushUndo(prev)
    setProject(next)
    bumpHistory((n) => n + 1)
  }, [settleLive])
  const undo = useCallback(() => {
    settleLive()
    const prev = undoRef.current.pop()
    if (!prev) return
    redoRef.current.push(projectRef.current)
    setProject(prev)
    bumpHistory((n) => n + 1)
  }, [settleLive])
  const redo = useCallback(() => {
    settleLive()
    const next = redoRef.current.pop()
    if (!next) return
    undoRef.current.push(projectRef.current)
    setProject(next)
    bumpHistory((n) => n + 1)
  }, [settleLive])

  // ── Autosave ──
  useEffect(() => {
    const t = setTimeout(() => saveProject({ ...project, updatedAt: Date.now() }), 400)
    return () => clearTimeout(t)
  }, [project])

  // ── Load every take that's on the timeline ──
  const usedTakeIds = useMemo(() => [...new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.takeId)))], [project.tracks])
  const ensureLoaded = useCallback((take: Take): Promise<LoadedTake> => {
    const p = loadTake(session, take)
    p.then((lt) => setLoaded((m) => (m.get(take.id) === lt ? m : new Map(m).set(take.id, lt))))
      .catch(() => setFailed((s) => new Set(s).add(take.id)))
    return p
  }, [session])
  useEffect(() => {
    for (const id of usedTakeIds) {
      const take = takesById.get(id)
      if (take && !loadedRef.current.has(id)) void ensureLoaded(take).catch(() => {})
    }
  }, [usedTakeIds, takesById, ensureLoaded])

  // ── Transport ──
  const playOpts = useCallback((): { loop: LoopRange | null; reference: { buffer: AudioBuffer; offset: number } | null } => {
    const p = projectRef.current
    const refBuf = p.reference ? loadedRef.current.get(p.reference.takeId)?.buffer : undefined
    return {
      loop: p.loop?.on ? { start: p.loop.start, end: p.loop.end } : null,
      reference: refBuf && p.reference ? { buffer: refBuf, offset: p.reference.offset } : null,
    }
  }, [])
  const play = useCallback(() => {
    const s = useStore.getState()
    if (s.isPlaying) s.setIsPlaying(false)
    engine.stopPreview()
    setPreviewing(null)
    engine.play(projectRef.current, engine.position(), bufferFor, playOpts())
    setPlaying(true)
  }, [engine, bufferFor, playOpts])
  const pause = useCallback(() => { engine.pause(); setPlaying(false) }, [engine])
  const toggle = useCallback(() => (engine.playing ? pause() : play()), [engine, play, pause])
  const seek = useCallback((t: number) => {
    const to = Math.max(0, t)
    if (engine.playing) engine.play(projectRef.current, to, bufferFor, playOpts())
    else engine.seek(to)
  }, [engine, bufferFor, playOpts])
  // Dragging the playhead: playback holds while it moves and resumes from where it's dropped.
  const scrubResume = useRef(false)
  const scrub = useCallback((t: number, phase: 'start' | 'move' | 'end') => {
    if (phase === 'start') {
      scrubResume.current = engine.playing
      if (engine.playing) engine.pause()
    }
    engine.seek(t)
    if (phase === 'end' && scrubResume.current) {
      scrubResume.current = false
      engine.play(projectRef.current, t, bufferFor, playOpts())
    }
  }, [engine, bufferFor, playOpts])

  // Edits while playing: re-schedule clips from where we are. Mix changes go live without a restart.
  // Bumps only when clips, the loop or the reference change - not on mix moves (gain/mute keep each track's clips array).
  const clipsSig = useRef<{ ids: string[]; arrs: SmClip[][]; loop: unknown; ref: unknown; ver: number }>({ ids: [], arrs: [], loop: null, ref: null, ver: 0 })
  const clipsKey = useMemo(() => {
    const r = clipsSig.current
    const ids = project.tracks.map((t) => t.id)
    const arrs = project.tracks.map((t) => t.clips)
    const loopKey = project.loop ? `${project.loop.start}|${project.loop.end}|${project.loop.on}` : null
    const refKey = project.reference ? `${project.reference.takeId}|${project.reference.offset}` : null
    if (!sameIds(ids, r.ids) || arrs.length !== r.arrs.length || arrs.some((a, i) => a !== r.arrs[i]) || loopKey !== r.loop || refKey !== r.ref) {
      clipsSig.current = { ids, arrs, loop: loopKey, ref: refKey, ver: r.ver + 1 }
    }
    return clipsSig.current.ver
  }, [project.tracks, project.loop, project.reference])
  const loadedKey = loaded.size
  // A clip's time-stretch finishing: it can be heard now.
  const stretchKey = useSyncExternalStore(subscribeStretches, stretchVersion)
  useEffect(() => {
    if (engine.playing) engine.play(projectRef.current, engine.position(), bufferFor, playOpts())
  }, [clipsKey, loadedKey, stretchKey, engine, bufferFor, playOpts])
  useEffect(() => { engine.applyMix(project) }, [project, engine])
  useEffect(() => {
    engine.onError = (message) => { setPlaying(false); alert(`Session playback stopped: ${message}`) }
    return () => { engine.onError = null }
  }, [engine])

  useEffect(() => () => engine.dispose(), [engine])
  // The app's own player starting should stop us, not play on top.
  useEffect(() => useStore.subscribe((s, prev) => {
    if (s.isPlaying && !prev.isPlaying && engine.playing) { engine.pause(); setPlaying(false) }
    if (s.isPlaying && !prev.isPlaying && engine.previewPlaying) { engine.pausePreview(); setPreviewPaused(true) }
  }), [engine])

  // Stop at the end of the arrangement.
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => {
      const p = projectRef.current
      if (!p.loop?.on && engine.position() > projectEnd(p) + 0.5) { engine.pause(); engine.seek(0); setPlaying(false) }
    }, 250)
    return () => clearInterval(id)
  }, [playing, engine])

  // ── Grid ──
  const beatLen = project.bpm ? 60 / project.bpm : 0
  const snapStep = beatLen * GRID_BEATS[grid]
  const snapAbs = useCallback((t: number, alt: boolean): number => {
    if (!snapStep || alt) return t
    const g = projectRef.current.gridOffset
    return g + Math.round((t - g) / snapStep) * snapStep
  }, [snapStep])

  // ── Reference A/B ──
  const refTake = project.reference ? takesById.get(project.reference.takeId) : undefined
  const refLoading = !!refTake && ab === 'ref' && !loaded.has(refTake.id) && !failed.has(refTake.id)
  useEffect(() => {
    if (ab === 'ref' && refTake && !loadedRef.current.has(refTake.id)) void ensureLoaded(refTake).catch(() => {})
  }, [ab, refTake, ensureLoaded])
  const toggleAB = useCallback(() => {
    if (!projectRef.current.reference) return
    setAb((cur) => {
      const next: AB = cur === 'mix' ? 'ref' : 'mix'
      engine.setAB(next)
      return next
    })
  }, [engine])
  const setReference = useCallback((takeId: string | null) => {
    const p = projectRef.current
    commit({ ...p, reference: takeId ? { takeId, offset: p.reference?.takeId === takeId ? p.reference.offset : 0 } : null })
    if (!takeId) { setAb('mix'); engine.setAB('mix') }
  }, [commit, engine])
  const [aligning, setAligning] = useState(false)
  const [alignNote, setAlignNote] = useState<string | null>(null)
  useEffect(() => setAlignNote(null), [project.reference?.takeId])
  const lineUpReference = useStableCallback(async (): Promise<void> => {
    const p = projectRef.current
    const take = p.reference ? takesById.get(p.reference.takeId) : undefined
    if (!take || aligning) return
    setAligning(true)
    setAlignNote(null)
    try {
      const buffers = await loadTimelineTakes(p, true)
      const ref = await ensureLoaded(take)
      const res = await alignReference(p, (id) => buffers.get(id), ref.buffer)
      if (!res) { setAlignNote('Put the beat or some takes on the timeline first'); return }
      const cur = projectRef.current
      if (cur.reference?.takeId !== take.id) return
      commit({ ...cur, reference: { ...cur.reference, offset: res.offset } })
      if (!res.confident) setAlignNote('No clear match - A/B it to check')
    } catch (err) {
      setAlignNote(err instanceof Error ? err.message : String(err))
    } finally {
      setAligning(false)
    }
  })

  // ── Grid ──
  // The beat lane's first clip: tempo comes from its audio, bar 1 is placed through it on the timeline.
  const beatClipOf = (p: SmProject): SmClip | undefined => p.tracks.filter(isBeatTrack).flatMap((t) => t.clips).sort((a, b) => a.start - b.start)[0]
  const hasBeatClip = !!beatClipOf(project)
  const [detecting, setDetecting] = useState(false)
  const detectingRef = useRef(false)
  const detectGrid = useStableCallback(async (quiet = false): Promise<void> => {
    const clip = beatClipOf(projectRef.current)
    const take = clip && takesById.get(clip.takeId)
    if (!clip || !take || detectingRef.current) return
    detectingRef.current = true
    setDetecting(true)
    try {
      const g = await detectTempo((await ensureLoaded(take)).buffer)
      if (!g) { if (!quiet) alert("Couldn't find a steady tempo in the beat"); return }
      commit({ ...projectRef.current, bpm: g.bpm * clipSpeed(clip), gridOffset: clip.start + (g.bar1 - clip.offset) / clipSpeed(clip) })
      setGrid((v) => (v === 'off' ? 'beat' : v))
    } catch (err) {
      if (!quiet) alert(err instanceof Error ? err.message : String(err))
    } finally {
      detectingRef.current = false
      setDetecting(false)
    }
  })
  // No tempo in the file name: work it out from the beat when the project opens.
  useEffect(() => { if (projectRef.current.bpm == null) void detectGrid(true) }, [detectGrid])
  const setBar1AtPlayhead = useCallback(() => commit({ ...projectRef.current, gridOffset: engine.position() }), [commit, engine])

  // ── Loop ──
  const setLoop = useCallback((range: LoopRange | null, on = true) => {
    const p = projectRef.current
    commit({ ...p, loop: range && range.end - range.start > 0.05 ? { ...range, on } : null })
  }, [commit])
  const toggleLoop = useCallback(() => {
    const p = projectRef.current
    if (p.loop) { commit({ ...p, loop: { ...p.loop, on: !p.loop.on } }); return }
    // Nothing set yet: loop the selected clip, else four bars (or 8 s) from the playhead.
    const picked = selectionRef.current.map((id) => findClip(p, id)).filter((f): f is NonNullable<typeof f> => !!f)
    if (picked.length) {
      setLoop({ start: Math.min(...picked.map((f) => f.clip.start)), end: Math.max(...picked.map((f) => f.clip.start + f.clip.length)) })
      return
    }
    const bar = p.bpm ? (60 / p.bpm) * 4 : 0
    const at = engine.position()
    const start = bar ? p.gridOffset + Math.floor((at - p.gridOffset) / bar) * bar : at
    setLoop({ start: Math.max(0, start), end: Math.max(0, start) + (bar ? bar * 4 : 8) })
  }, [commit, setLoop, engine])

  // ── Comping ──
  const compClip = useCallback((clipId: string) => commit(compTo(projectRef.current, clipId)), [commit])
  const cycleAlternate = useCallback((dir: 1 | -1) => {
    if (!selected) return
    const alts = alternatesOf(projectRef.current, selected)
    if (alts.length < 2) return
    const i = alts.findIndex((c) => c.id === selected)
    const next = alts[(i + dir + alts.length) % alts.length]
    commit(compTo(projectRef.current, next.id))
    setSelected(next.id)
  }, [selected, commit])
  const toggleClipMute = useCallback((ids: string[]) => {
    const p = projectRef.current
    const set = new Set(ids)
    const clips = p.tracks.flatMap((t) => t.clips).filter((c) => set.has(c.id))
    const muted = clips.some((c) => !c.muted)
    commit({ ...p, tracks: p.tracks.map((t) => (t.clips.some((c) => set.has(c.id)) ? { ...t, clips: t.clips.map((c) => (set.has(c.id) ? { ...c, muted } : c)) } : t)) })
  }, [commit])
  /** Flips each clip to play backwards over the same stretch (or forwards again). */
  const reverseClips = useCallback((ids: string[]) => {
    const p = projectRef.current
    const set = new Set(ids)
    const flip = (c: SmClip): SmClip => {
      const len = loadedRef.current.get(c.takeId)?.buffer.duration ?? takesById.get(c.takeId)?.duration
      return len ? reverseClip(c, len) : c
    }
    commit({ ...p, tracks: p.tracks.map((t) => (t.clips.some((c) => set.has(c.id)) ? { ...t, clips: t.clips.map((c) => (set.has(c.id) ? flip(c) : c)) } : t)) })
  }, [commit, takesById])
  /** Sets speed / pitch on each clip - `patch` can depend on the clip, for relative moves. */
  const retimeClips = useCallback((ids: string[], patch: RetimePatch | ((c: SmClip) => RetimePatch)) => {
    let next = projectRef.current
    for (const id of ids) next = mapClip(next, id, (c) => retimeClip(c, typeof patch === 'function' ? patch(c) : patch))
    commit(next)
  }, [commit])

  // ── Clip operations ──
  type Placement = { take: Take; trackIdx: number | null; at: number | null }
  // Places several takes in one commit (one undo step). trackIdx null = first free vocal lane, past the end = a new lane.
  const placeTakes = useCallback((items: Placement[], alt = false) => {
    if (!items.length) return
    const go = (durations: number[]): void => {
      let p = projectRef.current
      const ids: string[] = []
      items.forEach((it, i) => {
        const r = withPlacedTake(p, it.take, durations[i], it.trackIdx, it.at, alt)
        p = r.project
        ids.push(r.clipId)
      })
      commit(p)
      setSelection(ids)
    }
    const known = items.map((it) => it.take.duration)
    if (known.every((d): d is number => !!d)) go(known)
    else void Promise.all(items.map((it) => (it.take.duration ? it.take.duration : ensureLoaded(it.take).then((lt) => lt.buffer.duration)))).then(go).catch(() => {})
  }, [commit, ensureLoaded, beatLen, snapAbs, engine])
  const placeTake = useCallback((take: Take, trackIdx: number | null, at: number | null, alt = false) => placeTakes([{ take, trackIdx, at }], alt), [placeTakes])

  function withPlacedTake(p: SmProject, take: Take, duration: number, trackIdx: number | null, at: number | null, alt: boolean): { project: SmProject; clipId: string } {
    let start: number
    if (at == null) start = take.position ?? engine.position()
    else if (take.position != null && beatLen && !alt) {
      // Keep the take's original groove: move it by whole beats from where it was recorded.
      start = take.position + Math.round((at - take.position) / beatLen) * beatLen
    } else start = snapAbs(at, alt)
    start = Math.max(0, start)
    const clip: SmClip = { id: uid(), takeId: take.id, start, offset: 0, length: duration, gain: 1, fadeIn: 0, fadeOut: 0 }
    const free = (t: SmTrack): boolean => t.clips.every((c) => c.start >= start + duration - 1e-3 || c.start + c.length <= start + 1e-3)
    let idx = trackIdx
    if (idx == null || idx >= p.tracks.length) {
      // Takes go in the take folder's lanes when there is one; the reference anywhere free.
      const home = take.kind === 'bounce' ? undefined : lastFolder(p.tracks)
      idx = trackIdx == null ? p.tracks.findIndex((t) => !isBeatTrack(t) && (!home || t.folder === home) && free(t)) : -1
    }
    const tracks = [...p.tracks]
    if (idx < 0 || idx >= tracks.length) {
      // A lane made because nothing had room joins the take folder; one asked for (dropped below the last lane) doesn't.
      const folder = trackIdx == null && take.kind !== 'bounce' ? lastFolder(tracks) : undefined
      tracks.push({ id: uid(), name: take.kind === 'bounce' ? 'Reference' : `Vocals ${tracks.length}`, gain: 1, muted: false, solo: false, clips: [], ...(folder ? { folder } : {}) })
      idx = tracks.length - 1
    }
    tracks[idx] = { ...tracks[idx], clips: [...tracks[idx].clips, clip] }
    return { project: { ...p, tracks }, clipId: clip.id }
  }

  const deleteClips = useCallback((ids: string[]) => {
    const p = projectRef.current
    const set = new Set(ids)
    commit({ ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !set.has(c.id)) })) })
    setSelection([])
  }, [commit])

  /** Splits every given clip the cut point falls inside; the right-hand halves (and any untouched clips) stay selected. */
  const splitClips = useCallback((ids: string[], at: number) => {
    const p = projectRef.current
    const set = new Set(ids)
    const picked: string[] = []
    let changed = false
    const tracks = p.tracks.map((t) => ({
      ...t,
      clips: t.clips.flatMap((clip) => {
        if (!set.has(clip.id)) return [clip]
        if (at <= clip.start + 0.02 || at >= clip.start + clip.length - 0.02) { picked.push(clip.id); return [clip] }
        const left: SmClip = { ...clip, length: at - clip.start, fadeOut: 0 }
        const right: SmClip = { ...clip, id: uid(), start: at, offset: takeTime(clip, at), length: clip.start + clip.length - at, fadeIn: 0 }
        changed = true
        picked.push(right.id)
        return [left, right]
      }),
    }))
    if (!changed) return
    commit({ ...p, tracks })
    setSelection(picked)
  }, [commit])

  /** Arrow keys: shifts the clips `dt` seconds (not before 0) and `dLane` lanes (only if they all fit). Held keys make one undo step. */
  const moveClips = useCallback((ids: string[], dt: number, dLane: number) => {
    const p = projectRef.current
    const set = new Set(ids)
    const at = p.tracks.flatMap((t, i) => t.clips.filter((c) => set.has(c.id)).map((c) => ({ c, i })))
    if (!at.length) return
    const shift = Math.max(dt, -Math.min(...at.map((g) => g.c.start)))
    const lanes = Math.min(...at.map((g) => g.i)) + dLane >= 0 && Math.max(...at.map((g) => g.i)) + dLane < p.tracks.length ? dLane : 0
    if (!shift && !lanes) return
    setLive({
      ...p,
      tracks: p.tracks.map((t, i) => {
        const incoming = at.filter((g) => g.i + lanes === i).map((g): SmClip => ({ ...g.c, start: g.c.start + shift }))
        const without = t.clips.filter((c) => !set.has(c.id))
        return incoming.length || without.length !== t.clips.length ? { ...t, clips: [...without, ...incoming] } : t
      }),
    })
  }, [setLive])

  /** Copies the whole selection as one block, placed right after it. */
  const duplicateClips = useCallback((ids: string[]) => {
    const p = projectRef.current
    const set = new Set(ids)
    const clips = p.tracks.flatMap((t) => t.clips).filter((c) => set.has(c.id))
    if (!clips.length) return
    const first = Math.min(...clips.map((c) => c.start))
    const span = Math.max(...clips.map((c) => c.start + c.length)) - first
    const shift = snapStep ? Math.ceil(span / snapStep - 1e-6) * snapStep : span
    const made: string[] = []
    commit({
      ...p,
      tracks: p.tracks.map((t) => {
        const copies = t.clips.filter((c) => set.has(c.id)).map((c) => { const copy: SmClip = { ...c, id: uid(), start: c.start + shift }; made.push(copy.id); return copy })
        return copies.length ? { ...t, clips: [...t.clips, ...copies] } : t
      }),
    })
    setSelection(made)
  }, [commit, snapStep])

  // Mute, solo and volume on a selected track apply to every selected track; names stay per-track.
  const updateTrack = useCallback((trackId: string, patch: Partial<SmTrack>, history = true) => {
    const p = projectRef.current
    const sel = trackSelRef.current
    const group = sel.includes(trackId) && !('name' in patch) ? new Set(sel) : new Set([trackId])
    const next = { ...p, tracks: p.tracks.map((t) => (group.has(t.id) ? { ...t, ...patch } : t)) }
    if (history) commit(next)
    else setLive(next)
  }, [commit, setLive])
  const sharedFx = useMemo<SharedFx>(
    () => ({ bpm: project.bpm, echoNote: project.echoNote ?? DEFAULT_ECHO_NOTE, reverbSize: project.reverbSize ?? DEFAULT_REVERB_SIZE }),
    [project.bpm, project.echoNote, project.reverbSize],
  )
  const setSharedFx = useCallback((patch: Partial<Pick<SmProject, 'echoNote' | 'reverbSize'>>) => commit({ ...projectRef.current, ...patch }), [commit])

  // ── VST3 plug-ins (desktop app) ──
  const vst = useVstPlugins()
  const [openEditors, setOpenEditors] = useState<ReadonlySet<string>>(() => new Set())
  const openSettings = useStore((s) => s.openSettings)
  // A window opened on a plug-in several lanes share (added to them together) edits all of them.
  const editorLinks = useRef(new Map<string, string[]>())
  const editPlugin = useCallback((lanes: string[], pl: SmPlugin, where: string) => {
    const key = pluginEditorKey(lanes[0], pl.id)
    editorLinks.current.set(key, lanes)
    void vstApi()?.vstEditOpen({
      key, lanes, path: pl.path, cid: pl.cid, state: pl.state ?? '',
      title: `${pl.name} - ${where}`, sampleRate: engine.nativePlayback ? 48000 : audioContext().sampleRate,
    }).then((r) => { if (r.error) alert(r.error) })
  }, [])
  // The same plug-in as plain sliders, for any VST3 - by pluginEditorKey.
  const controlPlugin = useCallback((lanes: string[], pl: SmPlugin, where: string) => {
    const key = pluginEditorKey(lanes[0], pl.id)
    editorLinks.current.set(key, lanes)
    void vstApi()?.vstEditOpen({
      key, generic: true, lanes, path: pl.path, cid: pl.cid, state: pl.state ?? '',
      title: `${pl.name} - ${where}`, sampleRate: engine.nativePlayback ? 48000 : audioContext().sampleRate,
    }).then((r) => { if (r.error) alert(r.error) })
  }, [])
  const closePlugin = useCallback((trackId: string, pluginId: string) => { void vstApi()?.vstEditClose(pluginEditorKey(trackId, pluginId)) }, [])
  useEffect(() => {
    const api = vstApi()
    if (!api) return
    const open = new Set<string>()
    const off = api.onVstEditor((e) => {
      if (e.type === 'open') { open.add(e.key); setOpenEditors(new Set(open)) }
      else if (e.type === 'closed') { open.delete(e.key); editorLinks.current.delete(e.key); setOpenEditors(new Set(open)) }
      else if (e.type === 'error') alert(e.error ?? 'The plug-in window failed')
      else if (e.type === 'state' && e.state) {
        // Tweaks in the plug-in's window land on its lane's plug-in - or every linked lane's -
        // grouped for undo like a slider drag.
        const at = e.key.indexOf(':')
        const trackId = e.key.slice(0, at), pluginId = e.key.slice(at + 1)
        const lanes = new Set(editorLinks.current.get(e.key) ?? [trackId])
        const p = projectRef.current
        let changed = false
        const tracks = p.tracks.map((t) => {
          if (!lanes.has(t.id) || !t.plugins?.some((pl) => pl.id === pluginId && pl.state !== e.state)) return t
          changed = true
          return { ...t, plugins: t.plugins.map((pl) => (pl.id === pluginId ? { ...pl, state: e.state } : pl)) }
        })
        if (changed) setLive({ ...p, tracks })
      }
    })
    return () => { off(); for (const k of open) void api.vstEditClose(k) }
  }, [setLive])
  const pluginHost = useMemo<PluginHost | null>(
    () => (vst.available ? { scan: vst.list, scanning: vst.scanning, open: openEditors, edit: editPlugin, controls: controlPlugin, manage: () => openSettings('plugins') } : null),
    [vst.available, vst.list, vst.scanning, openEditors, editPlugin, controlPlugin, openSettings],
  )

  // ── The FX popover: one lane, the selected lanes, or a take folder's lanes ──
  const [fxPop, setFxPop] = useState<FxTarget | null>(null)
  const [, setFxClipVer] = useState(0)
  const fxPlace = (x: number, y: number): { left: number; top: number } => ({
    left: Math.max(8, Math.min(x, window.innerWidth - 268)),
    top: Math.max(8, Math.min(y, window.innerHeight - 430)),
  })
  const openLaneFx = useCallback((trackId: string, anchor: HTMLElement) => {
    const p = projectRef.current
    const sel = trackSelRef.current
    const ids = sel.includes(trackId) && sel.length > 1 ? p.tracks.filter((t) => sel.includes(t.id)).map((t) => t.id) : [trackId]
    const r = anchor.getBoundingClientRect()
    setFxPop((cur) => (cur?.anchor === anchor ? null : { ids, anchor, ...fxPlace(r.left, r.bottom + 4) }))
  }, [])
  const openFolderFx = useCallback((folderId: string, anchor: HTMLElement) => {
    const ids = projectRef.current.tracks.filter((t) => t.folder === folderId).map((t) => t.id)
    const r = anchor.getBoundingClientRect()
    setFxPop((cur) => (cur?.anchor === anchor ? null : { ids, folderId, anchor, ...fxPlace(r.left, r.bottom + 4) }))
  }, [])
  const editFx = useCallback((ids: string[], e: FxEdit, history: boolean) => {
    if (e.kind === 'removePlugin') for (const id of ids) closePlugin(id, e.id)
    const p = projectRef.current
    const next = editTracksFx(p, ids, e)
    if (next === p) return
    if (history) commit(next)
    else setLive(next)
  }, [commit, setLive, closePlugin])
  const copyLaneFx = useCallback((trackId: string) => {
    const t = projectRef.current.tracks.find((x) => x.id === trackId)
    if (!t) return
    fxClipboard = { fx: copyEffects(t), from: t.name }
    setFxClipVer((n) => n + 1)
  }, [])
  const pasteLaneFx = useCallback((ids: string[]) => {
    if (!fxClipboard) return
    const p = projectRef.current
    // Their own plug-ins are replaced, so their windows go too.
    for (const t of p.tracks) if (ids.includes(t.id)) for (const pl of t.plugins ?? []) closePlugin(t.id, pl.id)
    commit(pasteEffects(p, ids, fxClipboard.fx))
  }, [commit, closePlugin])

  const selectTrack = useCallback((trackId: string, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    const ids = projectRef.current.tracks.map((t) => t.id)
    const cur = trackSelRef.current
    let next: string[]
    if (e.ctrlKey || e.metaKey) next = cur.includes(trackId) ? cur.filter((id) => id !== trackId) : [...cur, trackId]
    else if (e.shiftKey && cur.length) {
      const anchor = cur[cur.length - 1]
      const a = ids.indexOf(anchor), b = ids.indexOf(trackId)
      const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1)
      // Keep the anchor last so the next shift-click ranges from it.
      next = [...cur.filter((id) => !range.includes(id)), ...range.filter((id) => id !== anchor), anchor]
    } else next = [trackId]
    setTrackSel(next)
    setSelection([])
  }, [])

  const renameTake = useCallback((takeId: string, name: string) => {
    const p = projectRef.current
    const original = scanned.takes.find((t) => t.id === takeId)?.name
    const names = { ...(p.takeNames ?? {}) }
    const n = name.trim()
    if (!n || n === original) delete names[takeId]
    else names[takeId] = n
    if ((p.takeNames?.[takeId] ?? '') === (names[takeId] ?? '')) return
    commit({ ...p, takeNames: names })
  }, [commit, scanned])

  // ── Take categories ──
  const addCategory = useCallback((takeIds: string[] = []): string => {
    const p = projectRef.current
    const cats = p.takeCategories ?? []
    let name = 'New category', n = 2
    while (cats.some((c) => c.name === name)) name = `New category ${n++}`
    const cat: TakeCategory = { id: uid(), name }
    const map = { ...(p.takeCategory ?? {}) }
    for (const id of takeIds) map[id] = cat.id
    commit({ ...p, takeCategories: [...cats, cat], takeCategory: map })
    setRenamingCat(cat.id)
    return cat.id
  }, [commit])
  const renameCategory = useCallback((catId: string, name: string) => {
    const p = projectRef.current
    const n = name.trim()
    if (!n || p.takeCategories?.find((c) => c.id === catId)?.name === n) return
    commit({ ...p, takeCategories: (p.takeCategories ?? []).map((c) => (c.id === catId ? { ...c, name: n } : c)) })
  }, [commit])
  // Deleting a category keeps its takes; they go back to the plain Takes section.
  const deleteCategory = useCallback((catId: string) => {
    const p = projectRef.current
    const map = Object.fromEntries(Object.entries(p.takeCategory ?? {}).filter(([, c]) => c !== catId))
    commit({ ...p, takeCategories: (p.takeCategories ?? []).filter((c) => c.id !== catId), takeCategory: map })
  }, [commit])
  const moveCategory = useCallback((catId: string, dir: -1 | 1) => {
    const p = projectRef.current
    const cats = [...(p.takeCategories ?? [])]
    const i = cats.findIndex((c) => c.id === catId)
    if (i < 0 || i + dir < 0 || i + dir >= cats.length) return
    ;[cats[i], cats[i + dir]] = [cats[i + dir], cats[i]]
    commit({ ...p, takeCategories: cats })
  }, [commit])
  /** Puts takes in a category, or back in plain Takes with null. */
  const sendToCategory = useCallback((takeIds: string[], catId: string | null) => {
    const p = projectRef.current
    const map = { ...(p.takeCategory ?? {}) }
    let changed = false
    for (const id of takeIds) {
      if ((map[id] ?? null) === catId) continue
      changed = true
      if (catId) map[id] = catId
      else delete map[id]
    }
    if (changed) commit({ ...p, takeCategory: map })
    // Make sure the takes stay in view.
    if (catId) setClosedCats((s) => { if (!s.has(catId)) return s; const n = new Set(s); n.delete(catId); return n })
  }, [commit])

  const openTakeMenu = useCallback((takeId: string, e: React.MouseEvent, clipId?: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (clipId && !selectionRef.current.includes(clipId)) setSelected(clipId)
    if (!clipId && !binSelRef.current.includes(takeId)) setBinSel([takeId])
    setTakeMenu({ takeId, clipId, x: e.clientX, y: e.clientY })
  }, [setSelected])

  const addTrack = useCallback(() => {
    const p = projectRef.current
    commit({ ...p, tracks: [...p.tracks, { id: uid(), name: `Track ${p.tracks.length + 1}`, gain: 1, muted: false, solo: false, clips: [] }] })
  }, [commit])

  // Deleting a selected track deletes the whole track selection.
  const removeTrack = useCallback((trackId: string) => {
    const p = projectRef.current
    const sel = trackSelRef.current
    const gone = new Set(sel.includes(trackId) ? sel : [trackId])
    commit({ ...p, tracks: p.tracks.filter((t) => !gone.has(t.id)) })
    setTrackSel((cur) => cur.filter((id) => !gone.has(id)))
  }, [commit])

  const openTrackMenu = useCallback((trackId: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!trackSelRef.current.includes(trackId)) { setTrackSel([trackId]); setSelection([]) }
    setTrackMenu({ trackId, x: e.clientX, y: e.clientY })
  }, [])

  /** Moves the given tracks, as one block in their current order, into gap `insertAt` of the track list. */
  /** `folder`: the folder the moved tracks join (null: none); left out, they keep theirs. */
  const moveTracksTo = useCallback((ids: string[], insertAt: number, folder?: string | null) => {
    const p = projectRef.current
    const set = new Set(ids)
    const block = p.tracks.filter((t) => set.has(t.id)).map((t) => {
      if (folder === undefined || (t.folder ?? null) === folder) return t
      if (folder) return { ...t, folder }
      const { folder: _, ...rest } = t
      return rest
    })
    const rest = p.tracks.filter((t) => !set.has(t.id))
    const k = p.tracks.slice(0, insertAt).filter((t) => !set.has(t.id)).length
    const tracks = [...rest.slice(0, k), ...block, ...rest.slice(k)]
    if (tracks.every((t, i) => t === p.tracks[i])) return
    commit({ ...p, tracks })
  }, [commit])

  /** Drops tracks into the gap above timeline row `r`. Right under an open folder's
   *  row, or between two of its lanes, they join it; anywhere else they're in none. */
  const dropTracksAt = useCallback((ids: string[], r: number, keepFolder: boolean) => {
    const rs = rowsLayoutRef.current
    const next = rs[r], prev = rs[r - 1]
    const at = !next ? projectRef.current.tracks.length : next.kind === 'track' ? next.trackIdx : next.members[0]
    let folder: string | null = null
    if (prev?.kind === 'folder' && prev.open) folder = prev.folder.id
    else if (prev?.kind === 'track' && prev.folder && next?.kind === 'track' && next.folder === prev.folder) folder = prev.folder
    moveTracksTo(ids, at, keepFolder ? undefined : folder)
  }, [moveTracksTo])

  /** Drags tracks up or down by their header; `onClick` runs instead when the pointer barely moved.
   *  A whole folder keeps its folder; single lanes join whichever they're dropped into. */
  const startTrackDrag = useCallback((ids: string[], e: React.PointerEvent, keepFolder: boolean, onClick?: () => void) => {
    const y0 = e.clientY
    let dragging = false
    let insertAt = -1
    const move = (ev: PointerEvent): void => {
      if (!dragging && Math.abs(ev.clientY - y0) < 5) return
      if (!dragging) {
        dragging = true
        ;(document.activeElement as HTMLElement | null)?.blur()
        window.getSelection()?.removeAllRanges()
        document.body.style.cursor = 'grabbing'
      }
      const box = rowsRef.current?.getBoundingClientRect()
      if (!box) return
      const at = clamp(Math.round((ev.clientY - box.top) / LANE_H), 0, rowsLayoutRef.current.length)
      if (at !== insertAt) { insertAt = at; setTrackDrag({ ids, insertAt: at }) }
      // Near the top/bottom edge of the timeline, scroll so far-away lanes are reachable.
      const sc = scrollRef.current
      if (sc) {
        const r = sc.getBoundingClientRect()
        if (ev.clientY < r.top + RULER_H + 24) sc.scrollTop -= 14
        else if (ev.clientY > r.bottom - 24) sc.scrollTop += 14
      }
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      document.body.style.cursor = ''
      setTrackDrag(null)
      if (dragging && insertAt >= 0) dropTracksAt(ids, insertAt, keepFolder)
      else if (!dragging) onClick?.()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }, [dropTracksAt])

  // Pressing on a header selects it; dragging it (or the selection it's part of) up or down reorders.
  const onTrackPointerDown = useCallback((trackId: string, e: React.PointerEvent) => {
    const cur = trackSelRef.current
    const plain = !(e.shiftKey || e.ctrlKey || e.metaKey)
    // A plain press inside a multi-selection keeps it, so the whole group can be dragged; a click without dragging narrows it.
    const inGroup = plain && cur.length > 1 && cur.includes(trackId)
    if (!inGroup) selectTrack(trackId, e)
    if (!plain) return
    const ids = inGroup ? projectRef.current.tracks.filter((t) => cur.includes(t.id)).map((t) => t.id) : [trackId]
    startTrackDrag(ids, e, false, inGroup ? () => setTrackSel([trackId]) : undefined)
  }, [selectTrack, startTrackDrag])

  // A folder's row: selects its lanes (so volume and the track menu act on them all); dragging moves the folder.
  const onFolderPointerDown = useCallback((folderId: string, e: React.PointerEvent) => {
    if (e.button !== 0) return
    const ids = projectRef.current.tracks.filter((t) => t.folder === folderId).map((t) => t.id)
    setTrackSel(ids)
    setSelection([])
    startTrackDrag(ids, e, true)
  }, [startTrackDrag])

  /** Alt+Up/Down: nudge tracks (the selection by default) one lane - past a whole folder they aren't in. */
  const nudgeTracks = useCallback((dir: -1 | 1, ids: string[] = trackSelRef.current) => {
    const p = projectRef.current
    const idx = p.tracks.map((t, i) => (ids.includes(t.id) ? i : -1)).filter((i) => i >= 0)
    if (!idx.length) return
    const own = p.tracks[idx[0]].folder
    if (dir < 0 && idx[0] > 0) {
      const above = p.tracks[idx[0] - 1]
      moveTracksTo(ids, above.folder && above.folder !== own ? p.tracks.findIndex((t) => t.folder === above.folder) : idx[0] - 1)
    } else if (dir > 0 && idx[idx.length - 1] < p.tracks.length - 1) {
      const below = p.tracks[idx[idx.length - 1] + 1]
      let to = idx[idx.length - 1] + 2
      if (below.folder && below.folder !== own) p.tracks.forEach((t, i) => { if (t.folder === below.folder) to = i + 1 })
      moveTracksTo(ids, to)
    }
  }, [moveTracksTo])

  // ── Pointer: clips ──
  /** Timeline row under clientY (may be past either end). */
  const rowAt = (clientY: number): number => {
    const r = rowsRef.current?.getBoundingClientRect()
    if (!r) return 0
    return Math.floor((clientY - r.top) / LANE_H)
  }
  /** Track under clientY: a folder's row counts as its first lane, below the last row is one past the end (a new lane). */
  const laneAt = (clientY: number): number => {
    const row = rowAt(clientY), rs = rowsLayoutRef.current
    if (row < 0) return 0
    if (row >= rs.length) return projectRef.current.tracks.length
    const x = rs[row]
    return x.kind === 'track' ? x.trackIdx : x.members[0]
  }
  const timeAt = (clientX: number): number => {
    const r = rowsRef.current?.getBoundingClientRect()
    if (!r) return 0
    return Math.max(0, (clientX - r.left - HEADER_W) / ppsRef.current)
  }

  // ── Swipe comping: with the comp tool on, dragging across a vocal clip makes it the take heard there ──
  const [compTool, setCompTool] = useState(false)
  const compToolRef = useRef(compTool)
  compToolRef.current = compTool
  const [swipe, setSwipe] = useState<{ clipId: string; from: number; to: number } | null>(null)
  const startSwipe = useStableCallback((e: React.PointerEvent, clipId: string): boolean => {
    const f = findClip(projectRef.current, clipId)
    if (!f || isBeatTrack(f.track)) return false
    const c = f.clip
    const at = (clientX: number, alt: boolean): number => clamp(snapAbs(timeAt(clientX), alt), c.start, c.start + c.length)
    const t0 = at(e.clientX, e.altKey)
    let t1 = t0
    setSelected(clipId)
    setSwipe({ clipId, from: t0, to: t0 })
    const move = (ev: PointerEvent): void => {
      t1 = at(ev.clientX, ev.altKey)
      setSwipe({ clipId, from: Math.min(t0, t1), to: Math.max(t0, t1) })
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setSwipe(null)
      if (Math.abs(t1 - t0) >= 0.02) commit(swipeComp(projectRef.current, clipId, Math.min(t0, t1), Math.max(t0, t1)))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return true
  })

  const onClipPointerDown = useCallback((e: React.PointerEvent, clipId: string, mode: DragMode) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const p = projectRef.current
    const f = findClip(p, clipId)
    if (!f) return
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    const cur = selectionRef.current
    if (mode === 'move' && !additive && compToolRef.current && startSwipe(e, clipId)) return
    if (mode === 'move' && additive) {
      // Shift/Ctrl-click toggles the clip in or out of the selection without dragging.
      setSelection(cur.includes(clipId) ? cur.filter((id) => id !== clipId) : [...cur, clipId])
      return
    }
    // Grabbing one of several selected clips drags them all; a plain click narrows to it.
    const groupDrag = mode === 'move' && cur.length > 1 && cur.includes(clipId)
    if (groupDrag) setSelection([...cur.filter((id) => id !== clipId), clipId])
    else setSelected(clipId)
    const ids = groupDrag ? cur : [clipId]
    const group = ids.flatMap((id) => { const g = findClip(p, id); return g ? [{ orig: g.clip, trackIdx: g.trackIdx }] : [] })
    dragRef.current = { mode, clipId, trackIdx: f.trackIdx, startX: e.clientX, startY: e.clientY, orig: f.clip, group, collapseTo: groupDrag ? clipId : undefined, snapshot: p, moved: false }
    // Window listeners, not pointer capture: moving a clip to another lane
    // remounts its element, which would drop the capture mid-drag.
    const move = (ev: PointerEvent): void => dragMoveRef.current(ev)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      dragEndRef.current()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }, [setSelected, startSwipe])

  const onClipPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    if (!d.moved && Math.abs(e.clientX - d.startX) < 3 && Math.abs(e.clientY - d.startY) < 3) return
    d.moved = true
    const dx = (e.clientX - d.startX) / ppsRef.current
    const o = d.orig
    const take = takesById.get(o.takeId)
    const takeLen = take?.duration ?? loadedRef.current.get(o.takeId)?.buffer.duration ?? o.offset + o.length
    const alt = e.altKey
    let next = d.snapshot
    const same = (key: string): boolean => { if (d.last === key) return true; d.last = key; return false }
    if (d.mode === 'move') {
      let shift = dx
      if (snapStep && !alt) shift = Math.round(dx / snapStep) * snapStep
      shift = Math.max(shift, -Math.min(...d.group.map((g) => g.orig.start)))
      const n = d.snapshot.tracks.length
      const laneShift = clamp(
        clamp(laneAt(e.clientY), 0, n - 1) - d.trackIdx,
        -Math.min(...d.group.map((g) => g.trackIdx)),
        n - 1 - Math.max(...d.group.map((g) => g.trackIdx)),
      )
      if (same(`${shift}|${laneShift}`)) return
      const ids = new Set(d.group.map((g) => g.orig.id))
      next = {
        ...d.snapshot,
        tracks: d.snapshot.tracks.map((t, i) => {
          const incoming = d.group.filter((g) => g.trackIdx + laneShift === i).map((g): SmClip => ({ ...g.orig, start: g.orig.start + shift }))
          const without = t.clips.filter((c) => !ids.has(c.id))
          return incoming.length || without.length !== t.clips.length ? { ...t, clips: [...without, ...incoming] } : t
        }),
      }
    } else if (d.mode === 'trimL') {
      let start = snapAbs(o.start + dx, alt)
      start = clamp(start, Math.max(0, o.start - o.offset / clipSpeed(o)), o.start + o.length - 0.05)
      const delta = start - o.start
      if (same(`${start}`)) return
      next = mapClip(d.snapshot, o.id, (c) => ({ ...c, start, offset: takeTime(o, start), length: o.length - delta, fadeIn: Math.min(c.fadeIn, o.length - delta) }))
    } else if (d.mode === 'trimR') {
      let end = snapAbs(o.start + o.length + dx, alt)
      end = clamp(end, o.start + 0.05, o.start + (takeLen - o.offset) / clipSpeed(o))
      if (same(`${end}`)) return
      next = mapClip(d.snapshot, o.id, (c) => ({ ...c, length: end - o.start, fadeOut: Math.min(c.fadeOut, end - o.start) }))
    } else if (d.mode === 'fadeIn') {
      next = mapClip(d.snapshot, o.id, (c) => ({ ...c, fadeIn: clamp(o.fadeIn + dx, 0, o.length - o.fadeOut) }))
    } else if (d.mode === 'fadeOut') {
      next = mapClip(d.snapshot, o.id, (c) => ({ ...c, fadeOut: clamp(o.fadeOut - dx, 0, o.length - o.fadeIn) }))
    }
    setProject(next)
  }, [snapStep, snapAbs, takesById])

  const onClipPointerUp = useCallback(() => {
    const d = dragRef.current
    dragRef.current = null
    if (d?.moved) commit(projectRef.current, d.snapshot)
    else if (d?.collapseTo) setSelected(d.collapseTo)
  }, [commit, setSelected])
  const dragMoveRef = useRef(onClipPointerMove)
  dragMoveRef.current = onClipPointerMove
  const dragEndRef = useRef(onClipPointerUp)
  dragEndRef.current = onClipPointerUp

  // ── Marquee: drag on empty lane space to select the clips it touches ──
  const onLanePointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    const base = additive ? selectionRef.current : []
    if (!additive) setTrackSel((cur) => (cur.length ? [] : cur))
    const x0 = e.clientX, y0 = e.clientY
    let dragged = false
    const hit = (x1: number, y1: number): string[] => {
      const p = projectRef.current
      const rs = rowsLayoutRef.current
      const [ra, rb] = [clamp(rowAt(y0), 0, rs.length - 1), clamp(rowAt(y1), 0, rs.length - 1)].sort((a, b) => a - b)
      const [ta, tb] = [timeAt(x0), timeAt(x1)].sort((a, b) => a - b)
      // A folded folder's row stands for all its lanes; an open one's lanes have rows of their own.
      const lanes = rs.slice(ra, rb + 1).flatMap((r) => (r.kind === 'track' ? [r.trackIdx] : r.open ? [] : r.members))
      const ids = lanes.flatMap((i) => p.tracks[i].clips.filter((c) => c.start < tb && c.start + c.length > ta).map((c) => c.id))
      const inBox = new Set(ids)
      return [...base.filter((id) => !inBox.has(id)), ...ids]
    }
    // Pointer moves come faster than frames; coalesce to one hit-test + paint per frame.
    let raf = 0, lastX = x0, lastY = y0
    const frame = (): void => {
      raf = 0
      const box = marqueeRef.current
      if (box) {
        box.style.display = 'block'
        box.style.left = `${Math.min(x0, lastX)}px`
        box.style.top = `${Math.min(y0, lastY)}px`
        box.style.width = `${Math.abs(lastX - x0)}px`
        box.style.height = `${Math.abs(lastY - y0)}px`
      }
      const next = hit(lastX, lastY)
      if (!sameIds(next, selectionRef.current)) setSelection(next)
    }
    const move = (ev: PointerEvent): void => {
      if (!dragged && Math.abs(ev.clientX - x0) < 4 && Math.abs(ev.clientY - y0) < 4) return
      dragged = true
      lastX = ev.clientX
      lastY = ev.clientY
      if (!raf) raf = requestAnimationFrame(frame)
    }
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      if (raf) { cancelAnimationFrame(raf); frame() }
      if (marqueeRef.current) marqueeRef.current.style.display = 'none'
      if (!dragged) {
        if (!additive) setSelection([])
        seek(timeAt(ev.clientX))
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  // ── Drop from the take bin ──
  const onDrop = (e: React.DragEvent): void => {
    const id = e.dataTransfer.getData('text/x-session-take')
    const take = id ? takesById.get(id) : undefined
    if (!take) return
    e.preventDefault()
    const lane = laneAt(e.clientY)
    const at = timeAt(e.clientX)
    let group: Take[] = []
    try { group = (JSON.parse(e.dataTransfer.getData('text/x-session-takes') || '[]') as string[]).map((t) => takesById.get(t)).filter((t): t is Take => !!t && t.id !== take.id && t.kind !== 'bounce') } catch {}
    // The grabbed take lands where it's dropped; the rest keep their recorded distance from it and find free lanes.
    placeTakes([
      { take, trackIdx: lane, at },
      ...group.map((t) => ({ take: t, trackIdx: null, at: t.position != null && take.position != null ? at + (t.position - take.position) : at })),
    ], e.altKey)
  }

  // ── Keyboard ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      let handled = true
      // With a take in the preview deck, Space drives the preview instead of the arrangement.
      if (e.code === 'Space' && previewingRef.current) {
        if (engine.previewPlaying) { engine.pausePreview(); setPreviewPaused(true) }
        else if (engine.previewActive) { engine.resumePreview(); setPreviewPaused(false) }
      }
      else if (e.code === 'Space') toggle()
      else if (mod && k === 'z' && !e.shiftKey) undo()
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) redo()
      else if (mod && k === 'a' && binListRef.current?.contains(document.activeElement)) setBinSel(binOrderRef.current)
      else if (mod && k === 'a' && trackSelRef.current.length) setTrackSel(projectRef.current.tracks.map((t) => t.id))
      else if (k === 'enter' && !mod && binSelRef.current.length && binListRef.current?.contains(document.activeElement)) { const t = takesById.get(binSelRef.current[binSelRef.current.length - 1]); if (t) placeFromBinRef.current(t) }
      else if (mod && k === 'a') setSelection(projectRef.current.tracks.flatMap((t) => t.clips.map((c) => c.id)))
      else if (mod && k === 'd' && selection.length) duplicateClips(selection)
      else if ((k === 'delete' || k === 'backspace') && selection.length) deleteClips(selection)
      else if ((k === 'delete' || k === 'backspace') && trackSelRef.current.length) removeTrack(trackSelRef.current[0])
      else if (k === 's' && !mod && selection.length) splitClips(selection, engine.position())
      else if (k === 'home') seek(0)
      else if ((k === '=' || k === '+') && !mod) setPps((v) => clamp(v * 1.25, MIN_PPS, MAX_PPS))
      else if (k === '-' && !mod) setPps((v) => clamp(v / 1.25, MIN_PPS, MAX_PPS))
      else if (k === 'escape' && previewingRef.current && !selection.length && !trackSelRef.current.length && !binSelRef.current.length) closePreview()
      else if (k === 'escape') { setSelection([]); setTrackSel([]); setBinSel([]) }
      else if (k === 'l' && !mod) toggleLoop()
      else if (k === 'r' && !mod) toggleAB()
      else if (k === 'c' && !mod && selected) compClip(selected)
      else if (k === 'k' && !mod) setCompTool((v) => !v)
      else if (k === 'm' && !mod && selection.length) toggleClipMute(selection)
      else if (e.altKey && k === 'arrowup' && trackSelRef.current.length) nudgeTracks(-1)
      else if (e.altKey && k === 'arrowdown' && trackSelRef.current.length) nudgeTracks(1)
      // Arrows move the selected clips: a grid step (or 0.1 s with snap off), Alt for a fine 10 ms; up/down a lane.
      else if ((k === 'arrowleft' || k === 'arrowright') && !mod && selection.length) moveClips(selection, (k === 'arrowleft' ? -1 : 1) * (e.altKey ? 0.01 : snapStep || 0.1), 0)
      else if ((k === 'arrowup' || k === 'arrowdown') && !mod && selection.length) moveClips(selection, 0, k === 'arrowup' ? -1 : 1)
      else if (k === ']' && !mod) cycleAlternate(1)
      else if (k === '[' && !mod) cycleAlternate(-1)
      else handled = false
      if (handled) { e.preventDefault(); e.stopPropagation() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [toggle, undo, redo, selected, selection, duplicateClips, deleteClips, splitClips, seek, engine, toggleLoop, toggleAB, compClip, toggleClipMute, cycleAlternate, closePreview, removeTrack, takesById, nudgeTracks, moveClips, snapStep])

  // ── Zoom around the pointer ──
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const x = e.clientX - r.left - HEADER_W
      const t = (el.scrollLeft + x) / ppsRef.current
      const next = clamp(ppsRef.current * Math.pow(1.0015, -e.deltaY), MIN_PPS, MAX_PPS)
      setPps(next)
      requestAnimationFrame(() => { el.scrollLeft = t * next - x })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ── Export ──
  /** Every take on the timeline, loaded. Read from what was awaited, not
   *  loadedRef - that only catches up once React re-renders. `skipFailed` leaves
   *  out takes that won't load instead of throwing. */
  const loadTimelineTakes = async (p: SmProject, skipFailed = false): Promise<Map<string, AudioBuffer>> => {
    const ids = [...new Set(p.tracks.flatMap((t) => t.clips.map((c) => c.takeId)))]
    const loads = ids.map((id) => { const t = takesById.get(id); return t ? ensureLoaded(t) : Promise.reject(new Error('Missing take')) })
    const out = new Map<string, AudioBuffer>()
    if (skipFailed) {
      const settled = await Promise.allSettled(loads)
      settled.forEach((r, i) => { if (r.status === 'fulfilled') out.set(ids[i], r.value.buffer) })
    } else {
      (await Promise.all(loads)).forEach((lt, i) => out.set(ids[i], lt.buffer))
    }
    return out
  }
  const exportWav = (): Promise<void> => renderToWav(projectRef.current, `${projectRef.current.name || 'session'}.wav`)
  const renderToWav = async (p: SmProject, filename: string): Promise<void> => {
    if (exporting) return
    try {
      setExporting('Loading takes…')
      const buffers = await loadTimelineTakes(p)
      setExporting('Rendering…')
      const buf = await renderProject(p, (id) => buffers.get(id))
      const peak = peakOf(buf)
      if (peak > 1) {
        // Down to -0.3 dBFS, leaving a little room for the converter.
        const target = 10 ** (-0.3 / 20)
        const over = 20 * Math.log10(peak)
        const fit = confirm(`This export peaks at +${over.toFixed(1)} dB and will clip.\n\nOK - turn it down ${(over + 0.3).toFixed(1)} dB so it fits\nCancel - export it as it is`)
        if (fit) scaleBuffer(buf, target / peak)
      }
      downloadBlob(encodeWav(buf), filename)
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(null)
    }
  }
  const exportTake = (take: Take): void => {
    void ensureLoaded(take).then((lt) => downloadBlob(encodeWav(lt.buffer), `${take.name}.wav`)).catch((err) => alert(err instanceof Error ? err.message : String(err)))
  }
  const exportProject = (): void => {
    const p = projectRef.current
    downloadBlob(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }), `${p.name || 'session'}.session.json`)
  }

  // The take in the preview deck stays there (paused) after it ends, until it's closed or another is picked.
  const togglePreview = useStableCallback((take: Take): void => {
    if (previewingRef.current === take.id) {
      if (engine.previewPlaying) { engine.pausePreview(); setPreviewPaused(true) }
      else if (engine.previewActive) { engine.resumePreview(); setPreviewPaused(false) }
      return
    }
    if (engine.playing) pause()
    engine.stopPreview()
    setPreviewing(take.id)
    setPreviewPaused(false)
    void ensureLoaded(take).then((lt) => {
      if (previewingRef.current !== take.id) return
      engine.playPreview(lt.buffer, () => { if (previewingRef.current === take.id) setPreviewPaused(true) })
    }).catch(() => { if (previewingRef.current === take.id) setPreviewing(null) })
  })
  const selectedBinTakes = (): Take[] => binSelRef.current.map((id) => takesById.get(id)).filter((t): t is Take => !!t)
  // Acting on a take that's part of a multi-selection acts on the whole selection.
  const binGroup = (take: Take): Take[] => (binSelRef.current.length > 1 && binSelRef.current.includes(take.id) ? selectedBinTakes() : [take])
  const placeFromBin = useStableCallback((take: Take) => {
    const group = binGroup(take).filter((t) => t.kind !== 'bounce')
    placeTakes((group.length ? group : [take]).map((t) => ({ take: t, trackIdx: null, at: null })))
  })
  placeFromBinRef.current = placeFromBin
  const selectBinTake = useStableCallback((takeId: string, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    const cur = binSelRef.current
    const order = binOrderRef.current
    if (e.ctrlKey || e.metaKey) setBinSel(cur.includes(takeId) ? cur.filter((id) => id !== takeId) : [...cur, takeId])
    else if (e.shiftKey && cur.length) {
      const anchor = cur[cur.length - 1]
      const a = order.indexOf(anchor), b = order.indexOf(takeId)
      if (a < 0 || b < 0) { setBinSel([takeId]); return }
      const range = order.slice(Math.min(a, b), Math.max(a, b) + 1)
      setBinSel([...cur.filter((id) => !range.includes(id)), ...range.filter((id) => id !== anchor), anchor])
    } else setBinSel(cur.length === 1 && cur[0] === takeId ? cur : [takeId])
  })
  const binDragIds = useStableCallback((takeId: string): string[] => (binSelRef.current.length > 1 && binSelRef.current.includes(takeId) ? binSelRef.current : [takeId]))
  const referenceFromBin = useStableCallback((take: Take) => setReference(take.id))
  const togglePreviewLoop = (): void => { engine.setPreviewLoop(!previewLoop); setPreviewLoop(!previewLoop) }
  const setPreviewVol = (v: number): void => { engine.setPreviewVolume(v); setPreviewVolume(v) }
  const previewTake = previewing ? takesById.get(previewing) : undefined

  // ── Take folders ──
  const toggleFolder = useCallback((id: string) => setClosedFolders((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n }), [])
  const renameFolder = useCallback((id: string, name: string) => {
    const p = projectRef.current
    setLive({ ...p, folders: (p.folders ?? []).map((f) => (f.id === id ? { ...f, name } : f)) })
  }, [setLive])
  // M and S on a folder act on all its lanes: on unless every lane already is.
  const folderToggle = useCallback((id: string, key: 'muted' | 'solo') => {
    const p = projectRef.current
    const on = !p.tracks.filter((t) => t.folder === id).every((t) => t[key])
    const other = key === 'muted' ? 'solo' : 'muted'
    commit({ ...p, tracks: p.tracks.map((t) => (t.folder === id ? { ...t, [key]: on, [other]: on ? false : t[other] } : t)) })
  }, [commit])
  const folderMute = useCallback((id: string) => folderToggle(id, 'muted'), [folderToggle])
  const folderSolo = useCallback((id: string) => folderToggle(id, 'solo'), [folderToggle])
  const openFolderMenu = useCallback((folderId: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setFolderMenu({ folderId, x: e.clientX, y: e.clientY })
  }, [])
  // Clicking a stretch of the comp lane selects the clip it comes from.
  const onCompClipDown = useCallback((e: React.PointerEvent, clipId: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    if (e.shiftKey || e.ctrlKey || e.metaKey) setSelection((cur) => (cur.includes(clipId) ? cur.filter((id) => id !== clipId) : [...cur, clipId]))
    else setSelected(clipId)
  }, [setSelected])

  const renderFolderMenu = (): JSX.Element | null => {
    const m = folderMenu
    const p = projectRef.current
    const folder = m ? (p.folders ?? []).find((f) => f.id === m.folderId) : undefined
    if (!m || !folder) return null
    const lanes = p.tracks.filter((t) => t.folder === folder.id)
    const clips = lanes.flatMap((t) => t.clips)
    const open = !closedFolders.has(folder.id)
    const addLane = (): void => {
      let last = -1
      p.tracks.forEach((t, i) => { if (t.folder === folder.id) last = i })
      const t: SmTrack = { id: uid(), name: `Vocals ${lanes.length + 1}`, gain: 1, muted: false, solo: false, clips: [], folder: folder.id }
      commit({ ...p, tracks: [...p.tracks.slice(0, last + 1), t, ...p.tracks.slice(last + 1)] })
      setClosedFolders((cur) => { if (!cur.has(folder.id)) return cur; const n = new Set(cur); n.delete(folder.id); return n })
    }
    const deleteAll = (): void => {
      const gone = new Set(lanes.map((t) => t.id))
      commit({ ...p, tracks: p.tracks.filter((t) => !gone.has(t.id)) })
      setTrackSel((cur) => cur.filter((id) => !gone.has(id)))
      setSelection((cur) => cur.filter((id) => !clips.some((c) => c.id === id)))
    }
    return (
      <ContextMenu
        x={m.x}
        y={m.y}
        title={folder.name || 'Take folder'}
        subtitle={`${lanes.length} lane${lanes.length === 1 ? '' : 's'} · ${clips.length} take${clips.length === 1 ? '' : 's'}`}
        onClose={() => setFolderMenu(null)}
        items={[
          { icon: Pencil, label: 'Rename', onSelect: () => setTimeout(() => { const el = document.querySelector<HTMLInputElement>(`[data-folder-name="${folder.id}"]`); el?.focus(); el?.select() }) },
          { icon: open ? ChevronDown : ChevronRight, label: open ? 'Fold to the comp lane' : 'Show the take lanes', onSelect: () => toggleFolder(folder.id) },
          { icon: Plus, label: 'Add a take lane', onSelect: addLane },
          clips.length > 0 && { icon: SquareDashedMousePointer, label: `Select its clips (${clips.length})`, onSelect: () => setSelection(clips.map((c) => c.id)) },
          lanes.length > 0 && { icon: SlidersHorizontal, label: `Effects on all ${lanes.length} lane${lanes.length === 1 ? '' : 's'}…`, separatorBefore: true, onSelect: () => setFxPop({ ids: lanes.map((t) => t.id), folderId: folder.id, anchor: null, ...fxPlace(m.x, m.y) }) },
          lanes.length > 0 && fxClipboard && { icon: ClipboardPaste, label: `Paste effects from ${fxClipboard.from} to all its lanes`, onSelect: () => pasteLaneFx(lanes.map((t) => t.id)) },
          lanes.some(hasEffects) && {
            icon: RotateCcw,
            label: 'Clear effects on all its lanes',
            onSelect: () => {
              for (const t of lanes) for (const pl of t.plugins ?? []) closePlugin(t.id, pl.id)
              commit({ ...p, tracks: p.tracks.map((t) => (t.folder === folder.id ? { ...t, fx: undefined, chain: undefined, plugins: undefined } : t)) })
            },
          },
          'divider',
          { icon: FolderMinus, label: 'Ungroup (keep the lanes)', onSelect: () => commit(ungroupFolder(p, folder.id)) },
          { icon: Trash2, label: `Delete the folder and its ${lanes.length} lane${lanes.length === 1 ? '' : 's'}`, danger: true, onSelect: deleteAll },
        ]}
      />
    )
  }

  const renderTrackMenu = (): JSX.Element | null => {
    const m = trackMenu
    const p = projectRef.current
    const idx = m ? p.tracks.findIndex((t) => t.id === m.trackId) : -1
    if (!m || idx < 0) return null
    const track = p.tracks[idx]
    const group = trackSel.includes(track.id) && trackSel.length > 1 ? p.tracks.filter((t) => trackSel.includes(t.id)) : [track]
    const ids = new Set(group.map((t) => t.id))
    const many = group.length > 1
    const what = many ? `${group.length} tracks` : 'track'
    const clips = group.flatMap((t) => t.clips)
    const newTrack = (): SmTrack => ({ id: uid(), name: `Track ${p.tracks.length + 1}`, gain: 1, muted: false, solo: false, clips: [], ...(track.folder ? { folder: track.folder } : {}) })
    const insertAt = (at: number): void => {
      const t = newTrack()
      commit({ ...p, tracks: [...p.tracks.slice(0, at), t, ...p.tracks.slice(at)] })
      setTrackSel([t.id])
    }
    const move = (dir: -1 | 1): void => nudgeTracks(dir, [track.id])
    const foldable = group.filter((t) => !isBeatTrack(t))
    const toFolder = (): void => {
      const { project: next, folderId } = groupIntoFolder(p, foldable.map((t) => t.id), 'Takes')
      if (!folderId) return
      commit(next)
      setTimeout(() => { const el = document.querySelector<HTMLInputElement>(`[data-folder-name="${folderId}"]`); el?.focus(); el?.select() })
    }
    const inFolder = group.filter((t) => t.folder)
    const outOfFolder = (): void => commit({ ...p, tracks: p.tracks.map((t) => { if (!ids.has(t.id) || !t.folder) return t; const { folder: _, ...rest } = t; return rest }) })
    const duplicate = (): void => {
      const copies: string[] = []
      const tracks = p.tracks.flatMap((t) => {
        if (!ids.has(t.id)) return [t]
        const { role: _role, ...rest } = t
        const copy: SmTrack = { ...rest, id: uid(), name: `${t.name} copy`, solo: false, clips: t.clips.map((c) => ({ ...c, id: uid() })) }
        copies.push(copy.id)
        return [t, copy]
      })
      commit({ ...p, tracks })
      setTrackSel(copies)
    }
    const exportTracks = (): void => {
      const solo: SmProject = { ...p, reference: null, tracks: group.map((t) => ({ ...t, muted: false, solo: false })) }
      void renderToWav(solo, `${p.name || 'session'} - ${many ? `${group.length} tracks` : track.name}.wav`)
    }
    return (
      <ContextMenu
        x={m.x}
        y={m.y}
        title={many ? `${group.length} tracks` : track.name}
        subtitle={`${clips.length} clip${clips.length === 1 ? '' : 's'}${many ? '' : ` · ${dbOf(track.gain).toFixed(1)} dB`}`}
        onClose={() => setTrackMenu(null)}
        items={[
          !many && { icon: Pencil, label: 'Rename', onSelect: () => setTimeout(() => { const el = document.querySelector<HTMLInputElement>(`[data-track-name="${track.id}"]`); el?.focus(); el?.select() }) },
          { icon: track.muted ? Volume2 : VolumeX, label: `${track.muted ? 'Unmute' : 'Mute'}${many ? ` ${what}` : ''}`, onSelect: () => updateTrack(track.id, { muted: !track.muted }) },
          { icon: Headphones, label: `${track.solo ? 'Unsolo' : 'Solo'}${many ? ` ${what}` : ''}`, active: track.solo, onSelect: () => updateTrack(track.id, { solo: !track.solo }) },
          track.gain !== 1 && { icon: RotateCcw, label: `Reset volume${many ? 's' : ''} to 0 dB`, onSelect: () => updateTrack(track.id, { gain: 1 }) },
          { icon: SlidersHorizontal, label: many ? `Effects on ${what}…` : 'Effects…', separatorBefore: true, onSelect: () => setFxPop({ ids: group.map((t) => t.id), anchor: null, ...fxPlace(m.x, m.y) }) },
          !many && { icon: Copy, label: 'Copy effects', disabled: !hasEffects(track), onSelect: () => copyLaneFx(track.id) },
          fxClipboard && { icon: ClipboardPaste, label: `Paste effects from ${fxClipboard.from}${many ? ` to ${what}` : ''}`, onSelect: () => pasteLaneFx(group.map((t) => t.id)) },
          group.some(hasEffects) && {
            icon: RotateCcw,
            label: `Clear effects${many ? ` on ${what}` : ''}`,
            onSelect: () => {
              for (const id of trackSelRef.current.includes(track.id) ? trackSelRef.current : [track.id]) {
                for (const pl of projectRef.current.tracks.find((t) => t.id === id)?.plugins ?? []) closePlugin(id, pl.id)
              }
              updateTrack(track.id, { fx: undefined, chain: undefined, plugins: undefined })
            },
          },
          'divider',
          clips.length > 0 && { icon: SquareDashedMousePointer, label: `Select clips (${clips.length})`, onSelect: () => setSelection(clips.map((c) => c.id)) },
          { icon: CopyPlus, label: `Duplicate ${what}`, onSelect: duplicate },
          !many && { icon: ArrowUp, label: 'Move up', disabled: idx === 0, onSelect: () => move(-1) },
          !many && { icon: ArrowDown, label: 'Move down', disabled: idx === p.tracks.length - 1, onSelect: () => move(1) },
          !many && { icon: Plus, label: 'Add track above', onSelect: () => insertAt(idx) },
          !many && { icon: Plus, label: 'Add track below', onSelect: () => insertAt(idx + 1) },
          foldable.length > 0 && { icon: FolderPlus, label: `Put ${foldable.length > 1 ? `${foldable.length} tracks` : 'track'} in a take folder`, separatorBefore: true, onSelect: toFolder },
          inFolder.length > 0 && { icon: FolderMinus, label: `Take ${inFolder.length > 1 ? `${inFolder.length} tracks` : 'track'} out of the folder`, onSelect: outOfFolder },
          'divider',
          clips.length > 0 && { icon: FileDown, label: `Export ${many ? `${group.length} tracks` : 'track'} as WAV`, disabled: !!exporting, onSelect: exportTracks },
          clips.length > 0 && { icon: Eraser, label: `Clear clips (${clips.length})`, danger: true, onSelect: () => commit({ ...p, tracks: p.tracks.map((t) => (ids.has(t.id) ? { ...t, clips: [] } : t)) }) },
          { icon: Trash2, label: `Delete ${what}`, kbd: ['Del'], danger: true, onSelect: () => removeTrack(track.id) },
        ]}
      />
    )
  }

  const sendToItem = (takeIds: string[]): ContextMenuItem => {
    const p = projectRef.current
    const cats = p.takeCategories ?? []
    const current = new Set(takeIds.map((id) => p.takeCategory?.[id] ?? null))
    const only = current.size === 1 ? [...current][0] : undefined
    return {
      icon: FolderInput,
      label: 'Send to category',
      children: [
        ...cats.map((c, i) => ({ label: c.name, icon: CategoryDot(i), checked: only === c.id, onSelect: () => sendToCategory(takeIds, c.id) })),
        cats.length > 0 && 'divider',
        { label: 'No category', checked: only === null, disabled: only === null, onSelect: () => sendToCategory(takeIds, null) },
        'divider',
        { icon: FolderPlus, label: 'New category…', onSelect: () => addCategory(takeIds) },
      ],
    }
  }

  const renderCatMenu = (): JSX.Element | null => {
    const m = catMenu
    const p = projectRef.current
    const cats = p.takeCategories ?? []
    const i = m ? cats.findIndex((c) => c.id === m.catId) : -1
    if (!m || i < 0) return null
    const cat = cats[i]
    const members = session.takes.filter((t) => p.takeCategory?.[t.id] === cat.id)
    const placeable = members.filter((t) => t.kind !== 'bounce')
    return (
      <ContextMenu
        x={m.x}
        y={m.y}
        title={cat.name}
        subtitle={`${members.length} take${members.length === 1 ? '' : 's'}`}
        onClose={() => setCatMenu(null)}
        items={[
          members.length > 0 && { icon: SquareDashedMousePointer, label: `Select all (${members.length})`, onSelect: () => setBinSel(members.map((t) => t.id)) },
          placeable.length > 0 && { icon: Wand2, label: `Place all where recorded (${placeable.length})`, onSelect: () => placeTakes(placeable.map((t) => ({ take: t, trackIdx: null, at: null }))) },
          'divider',
          { icon: Pencil, label: 'Rename', onSelect: () => setRenamingCat(cat.id) },
          { icon: ArrowUp, label: 'Move up', disabled: i === 0, onSelect: () => moveCategory(cat.id, -1) },
          { icon: ArrowDown, label: 'Move down', disabled: i === cats.length - 1, onSelect: () => moveCategory(cat.id, 1) },
          { icon: FolderPlus, label: 'New category', onSelect: () => addCategory() },
          'divider',
          { icon: Trash2, label: 'Delete category', danger: true, onSelect: () => deleteCategory(cat.id) },
        ]}
      />
    )
  }

  const renderTakeMenu = (): JSX.Element | null => {
    const m = takeMenu
    const take = m ? takesById.get(m.takeId) : undefined
    if (!m || !take) return null
    const p = projectRef.current
    const clip = m.clipId ? findClip(p, m.clipId)?.clip : undefined
    const clipSel = clip ? (selection.includes(clip.id) ? selection : [clip.id]) : []
    const many = clipSel.length > 1 ? ` ${clipSel.length} clips` : ' clip'
    const onTimeline = p.tracks.flatMap((t) => t.clips).filter((c) => c.takeId === take.id)
    const original = scannedNames.get(take.id) ?? take.name
    const renamed = take.name !== original
    const sounding = previewing === take.id && !previewPaused
    const isRef = p.reference?.takeId === take.id
    const group = !clip && binSel.length > 1 && binSel.includes(take.id) ? selectedBinTakes() : null
    if (group) {
      const placeable = group.filter((t) => t.kind !== 'bounce')
      const ids = new Set(group.map((t) => t.id))
      const groupClips = p.tracks.flatMap((t) => t.clips).filter((c) => ids.has(c.takeId))
      const renamedOnes = group.filter((t) => t.name !== (scannedNames.get(t.id) ?? t.name))
      const len = group.reduce((a, t) => a + (t.duration ?? 0), 0)
      const n = placeable.length
      return (
        <ContextMenu
          x={m.x}
          y={m.y}
          title={`${group.length} takes`}
          subtitle={`${formatTime(len)} total`}
          onClose={() => setTakeMenu(null)}
          items={[
            { icon: sounding ? Pause : Play, label: sounding ? `Pause ${take.name}` : `Preview ${take.name}`, onSelect: () => togglePreview(take) },
            'divider',
            n > 0 && { icon: Wand2, label: `Place ${n} where recorded`, kbd: ['Enter'], onSelect: () => placeTakes(placeable.map((t) => ({ take: t, trackIdx: null, at: null }))) },
            n > 0 && { icon: Plus, label: `Place ${n} at playhead`, onSelect: () => { const at = engine.position(), first = Math.min(...placeable.map((t) => t.position ?? 0)); placeTakes(placeable.map((t) => ({ take: t, trackIdx: null, at: at + (t.position ?? first) - first })), true) } },
            n > 0 && { icon: Plus, label: `Place ${n} on new tracks`, onSelect: () => placeTakes(placeable.map((t, i) => ({ take: t, trackIdx: p.tracks.length + i, at: null }))) },
            groupClips.length > 0 && { icon: SquareDashedMousePointer, label: `Select on timeline (${groupClips.length})`, onSelect: () => { setSelection(groupClips.map((c) => c.id)); seek(Math.min(...groupClips.map((c) => c.start))) } },
            groupClips.length > 0 && { icon: Trash2, label: `Remove from timeline (${groupClips.length})`, danger: true, onSelect: () => deleteClips(groupClips.map((c) => c.id)) },
            'divider',
            renamedOnes.length > 0 && { icon: RotateCcw, label: `Restore original names (${renamedOnes.length})`, onSelect: () => { const names = { ...(p.takeNames ?? {}) }; for (const t of renamedOnes) delete names[t.id]; commit({ ...p, takeNames: names }) } },
            sendToItem(group.map((t) => t.id)),
            { icon: ClipboardCopy, label: 'Copy names', onSelect: () => void navigator.clipboard.writeText(group.map((t) => t.name).join('\n')).catch(() => {}) },
            { icon: FileDown, label: `Export ${group.length} as WAV`, onSelect: () => { for (const t of group) exportTake(t) } },
            'divider',
            { icon: X, label: 'Clear selection', kbd: ['Esc'], onSelect: () => setBinSel([]) },
          ]}
        />
      )
    }
    return (
      <ContextMenu
        x={m.x}
        y={m.y}
        title={take.name}
        subtitle={[renamed ? original : null, take.duration != null ? formatTime(take.duration) : null, take.position != null ? `recorded @ ${formatTime(take.position)}` : null].filter(Boolean).join(' · ')}
        onClose={() => setTakeMenu(null)}
        items={[
          clip && { icon: clip.muted ? Volume2 : VolumeX, label: `${clip.muted ? 'Unmute' : 'Mute'}${many}`, kbd: ['M'], onSelect: () => toggleClipMute(clipSel) },
          clip && { icon: Rewind, label: `${clip.reversed ? 'Play forwards' : 'Reverse'}${many}`, active: !!clip.reversed, onSelect: () => reverseClips(clipSel) },
          clip && {
            icon: Gauge,
            label: `Speed & pitch${many}`,
            trailing: retimeLabel(clip) || undefined,
            children: [
              { label: 'Slowed (80%)', checked: clipSpeed(clip) === 0.8 && !clip.keepPitch, onSelect: () => retimeClips(clipSel, { speed: 0.8, keepPitch: false }) },
              { label: 'Sped up (125%)', checked: clipSpeed(clip) === 1.25 && !clip.keepPitch, onSelect: () => retimeClips(clipSel, { speed: 1.25, keepPitch: false }) },
              { label: 'Half speed, same pitch', checked: clipSpeed(clip) === 0.5 && !!clip.keepPitch, onSelect: () => retimeClips(clipSel, { speed: 0.5, keepPitch: true }) },
              { label: 'Double speed, same pitch', checked: clipSpeed(clip) === 2 && !!clip.keepPitch, onSelect: () => retimeClips(clipSel, { speed: 2, keepPitch: true }) },
              { label: 'Pitch up a semitone', separatorBefore: true, onSelect: () => retimeClips(clipSel, (c) => ({ pitch: (c.pitch ?? 0) + 1 })) },
              { label: 'Pitch down a semitone', onSelect: () => retimeClips(clipSel, (c) => ({ pitch: (c.pitch ?? 0) - 1 })) },
              {
                icon: Pencil,
                label: 'Custom…',
                separatorBefore: true,
                panel: ({ close }) => <RetimePanel clip={clip} onApply={(patch) => { retimeClips(clipSel, patch); close() }} />,
              },
              { icon: RotateCcw, label: 'Normal speed and pitch', disabled: !retimeLabel(clip), onSelect: () => retimeClips(clipSel, { speed: 1, pitch: 0, keepPitch: false }) },
            ],
          },
          clip && { icon: Scissors, label: `Split${many} at playhead`, kbd: ['S'], onSelect: () => splitClips(clipSel, engine.position()) },
          clip && { icon: Copy, label: `Duplicate${many}`, kbd: ['Ctrl', 'D'], onSelect: () => duplicateClips(clipSel) },
          clip && { icon: Repeat, label: 'Loop this clip', onSelect: () => setLoop({ start: clip.start, end: clip.start + clip.length }) },
          clip && { icon: Trash2, label: `Delete${many}`, kbd: ['Del'], danger: true, onSelect: () => deleteClips(clipSel) },
          clip && 'divider',
          { icon: sounding ? Pause : Play, label: sounding ? 'Pause preview' : previewing === take.id ? 'Resume preview' : 'Preview', onSelect: () => togglePreview(take) },
          take.kind === 'bounce'
            ? { icon: Layers, label: isRef ? 'Stop using as reference' : 'Use as reference', checked: isRef, onSelect: () => setReference(isRef ? null : take.id) }
            : { icon: Wand2, label: take.position != null ? 'Place where it was recorded' : 'Place on the timeline', onSelect: () => placeTake(take, null, null) },
          take.kind !== 'bounce' && { icon: Plus, label: 'Place at playhead', onSelect: () => placeTake(take, null, engine.position(), true) },
          take.kind !== 'bounce' && { icon: Plus, label: 'Place on a new track', onSelect: () => placeTake(take, p.tracks.length, null) },
          !clip && onTimeline.length > 0 && { icon: SquareDashedMousePointer, label: `Select on timeline (${onTimeline.length})`, onSelect: () => { setSelection(onTimeline.map((c) => c.id)); seek(Math.min(...onTimeline.map((c) => c.start))) } },
          !clip && onTimeline.length > 0 && { icon: Trash2, label: `Remove from timeline (${onTimeline.length})`, danger: true, onSelect: () => deleteClips(onTimeline.map((c) => c.id)) },
          'divider',
          { icon: Pencil, label: 'Rename…', kbd: clip ? undefined : ['F2'], onSelect: () => setRenaming({ takeId: take.id, where: clip ? 'inspector' : 'bin' }) },
          renamed && { icon: RotateCcw, label: 'Restore original name', onSelect: () => renameTake(take.id, '') },
          sendToItem([take.id]),
          { icon: ClipboardCopy, label: 'Copy name', onSelect: () => void navigator.clipboard.writeText(take.name).catch(() => {}) },
          { icon: FileDown, label: 'Export as WAV', onSelect: () => exportTake(take) },
        ]}
      />
    )
  }

  // ── Layout ──
  const end = projectEnd(project)
  const [viewW, setViewW] = useState(1200)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const contentW = Math.max(viewW - HEADER_W, (end + 60) * pps)
  const placedIds = useMemo(() => new Set(usedTakeIds), [usedTakeIds])
  const sel = selected ? findClip(project, selected) : null
  const selAlts = sel ? alternatesOf(project, sel.clip.id) : []
  const loop = project.loop ?? null

  const bounceTakes = session.takes.filter((t) => t.kind === 'bounce')
  const bq = binQuery.trim().toLowerCase()
  const binTakes = session.takes.filter((t) => !bq || t.name.toLowerCase().includes(bq) || (scannedNames.get(t.id) ?? '').toLowerCase().includes(bq))
  const beats = binTakes.filter((t) => t.kind === 'beat')
  const categories = project.takeCategories ?? []
  const catOf = (t: Take): string | null => { const c = project.takeCategory?.[t.id]; return c && categories.some((x) => x.id === c) ? c : null }
  // The beat keeps its own section; any other take in a category is listed there instead.
  const vocals = binTakes.filter((t) => (t.kind === 'take' || t.kind === 'other') && !catOf(t))
  const byCat = categories.map((c) => ({ cat: c, takes: binTakes.filter((t) => t.kind !== 'beat' && catOf(t) === c.id) }))
  const bounces = binTakes.filter((t) => t.kind === 'bounce' && !catOf(t))
  binOrderRef.current = [...beats, ...byCat.flatMap((g) => (closedCats.has(g.cat.id) ? [] : g.takes)), ...vocals, ...(showBounces ? bounces : [])].map((t) => t.id)
  const unplacedWithPos = session.takes.some((t) => t.kind === 'take' && t.position != null && !placedIds.has(t.id))

  const laneGrid = beatLen && grid !== 'off'
    ? {
        backgroundImage: `repeating-linear-gradient(to right, var(--border) 0 1px, transparent 1px ${beatLen * 4 * pps}px), repeating-linear-gradient(to right, color-mix(in srgb, var(--border) 45%, transparent) 0 1px, transparent 1px ${beatLen * pps}px)`,
        backgroundPosition: `${project.gridOffset * pps}px 0`,
      }
    : undefined

  const binRows = (list: Take[]): JSX.Element[] => list.map((t, i, a) => {
    const bounce = t.kind === 'bounce'
    return (
      <BinRow
        key={t.id} take={t} selected={binSelSet.has(t.id)} joinUp={i > 0 && binSelSet.has(a[i - 1].id)} joinDown={i < a.length - 1 && binSelSet.has(a[i + 1].id)}
        onSelect={selectBinTake} dragIds={binDragIds} originalName={scannedNames.get(t.id) ?? t.name} onRename={renameTake}
        editing={renaming?.where === 'bin' && renaming.takeId === t.id} onEditing={editBinName} onMenu={openTakeMenu} zipPath={session.zipPath}
        placed={placedIds.has(t.id) || (bounce && project.reference?.takeId === t.id)} previewing={previewing === t.id} previewPaused={previewing === t.id && previewPaused}
        engine={engine} failed={failed.has(t.id)} onPreview={togglePreview} onPlace={bounce ? referenceFromBin : placeFromBin}
        placeHint={bounce ? 'Double-click to use it as the reference' : undefined}
      />
    )
  })

  return (
    <div className="flex-1 flex flex-col overflow-hidden select-none">
      {renderTakeMenu()}
      {renderTrackMenu()}
      {renderFolderMenu()}
      {fxPop && (
        <FxPopover
          target={fxPop}
          lanes={project.tracks.filter((t) => fxPop.ids.includes(t.id))}
          folderName={fxPop.folderId ? (project.folders ?? []).find((f) => f.id === fxPop.folderId)?.name || 'Take folder' : undefined}
          shared={sharedFx}
          host={pluginHost}
          clipboard={fxClipboard}
          onEdit={editFx}
          onShared={setSharedFx}
          onCopy={copyLaneFx}
          onPaste={pasteLaneFx}
          onClose={() => setFxPop(null)}
        />
      )}
      {renderCatMenu()}
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-1 px-3 pt-8 pb-2 border-b border-[var(--border)]">
        <button className={btn} title="Back to sessions" onClick={() => { engine.dispose(); saveProject({ ...projectRef.current, updatedAt: Date.now() }); onClose() }}>
          <ArrowLeft size={16} />
        </button>
        <input
          value={project.name}
          onChange={(e) => setLive({ ...projectRef.current, name: e.target.value })}
          className="h-8 px-2 w-56 rounded-lg bg-transparent hover:bg-[var(--surface-raised)] focus:bg-[var(--surface-raised)] text-sm font-semibold text-text-primary outline-none"
        />
        <div className="w-px h-5 bg-[var(--border)] mx-1" />
        <button className={btn} title="Back to start (Home)" onClick={() => seek(0)}><SkipBack size={16} /></button>
        <button className={`${btn} w-10 bg-accent/15 text-accent hover:text-accent`} title="Play / pause (Space)" onClick={toggle}>
          {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
        </button>
        <TimeReadout engine={engine} bpm={project.bpm} gridOffset={project.gridOffset} />
        <div className="w-px h-5 bg-[var(--border)] mx-1" />
        <label className="flex items-center gap-1.5 text-xs text-text-muted">
          BPM
          <input
            type="number" min={40} max={240} step={0.01}
            value={project.bpm ?? ''}
            placeholder="—"
            onChange={(e) => { const p = projectRef.current, v = Number(e.target.value); setLive({ ...p, bpm: e.target.value === '' ? null : v > 0 ? v : p.bpm }) }}
            className={`${input} w-[72px] tabular-nums`}
          />
        </label>
        <button className={btn} title={hasBeatClip ? 'Detect the tempo and bar 1 from the beat' : 'Put the beat on its lane to detect the tempo'} onClick={() => void detectGrid()} disabled={!hasBeatClip || detecting}>
          {detecting ? <Loader2 size={15} className="animate-spin" /> : <Activity size={15} />}
        </button>
        <button className={btn} title="Make the playhead bar 1" onClick={setBar1AtPlayhead} disabled={!project.bpm}><Flag size={15} /></button>
        <select value={grid} onChange={(e) => setGrid(e.target.value as GridDiv)} className={`${input} ml-1`} title="Snap to grid (hold Alt while dragging to ignore it)" disabled={!project.bpm}>
          <option value="off">Snap off</option>
          <option value="bar">Bar</option>
          <option value="beat">Beat</option>
          <option value="half">1/8</option>
          <option value="quarter">1/16</option>
        </select>
        <button className={`${btn} ${follow ? btnOn : ''}`} title="Follow playhead" onClick={() => setFollow(!follow)}><Magnet size={15} /></button>
        <button className={`${btn} ${loop?.on ? btnOn : ''}`} title="Loop (L) - drag across the ruler to set the range" onClick={toggleLoop}><Repeat size={15} /></button>
        <button className={`${btn} ${compTool ? btnOn : ''}`} title="Swipe comp (K) - drag across a take to hear it there instead of the others" onClick={() => setCompTool(!compTool)}><Highlighter size={15} /></button>
        {hasMutedClips(project) && (
          <button className={btn} title="Unmute every muted clip" onClick={() => commit(unmuteAll(projectRef.current))}><Volume2 size={15} /> Unmute all</button>
        )}
        <div className="w-px h-5 bg-[var(--border)] mx-1" />
        <button className={btn} title="Zoom out (-, Ctrl+wheel)" onClick={() => setPps((v) => clamp(v / 1.4, MIN_PPS, MAX_PPS))}><Minus size={15} /></button>
        <button className={btn} title="Zoom in (+, Ctrl+wheel)" onClick={() => setPps((v) => clamp(v * 1.4, MIN_PPS, MAX_PPS))}><Plus size={15} /></button>
        <button className={btn} title="Undo (Ctrl+Z)" disabled={!undoRef.current.length} onClick={undo}><Undo2 size={15} /></button>
        <button className={btn} title="Redo (Ctrl+Shift+Z)" disabled={!redoRef.current.length} onClick={redo}><Redo2 size={15} /></button>
        <div className="flex-1" />
        <HelpMenu />
        <label className="flex items-center gap-1.5 text-text-muted mr-1" title="Master volume">
          <Volume2 size={15} />
          <input type="range" min={0} max={1.5} step={0.01} value={project.masterGain} onChange={(e) => setLive({ ...projectRef.current, masterGain: Number(e.target.value) })} className="w-24 accent-[rgb(var(--accent-rgb))]" />
        </label>
        <div ref={projMenuRef} className="relative">
          <button
            className={`${btn} ${projMenu ? btnOn : ab === 'ref' ? 'bg-amber-500/20 text-amber-400 hover:text-amber-400' : ''}`}
            title="Reference, download, save and export"
            onClick={() => setProjMenu(!projMenu)}
          >
            {exporting ? <Loader2 size={15} className="animate-spin" /> : <Settings2 size={15} />} {ab === 'ref' ? 'Original' : exporting || 'Project'}
          </button>
          {projMenu && (
            <div className="absolute right-0 top-full mt-1 z-50 w-72 p-2 space-y-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-xl">
              {bounceTakes.length > 0 && (
                <div className="p-1 pb-2 space-y-1.5 border-b border-[var(--border)]">
                  <div className="text-[11px] uppercase tracking-wider text-text-muted">Original to compare against</div>
                  <select
                    value={project.reference?.takeId ?? ''}
                    onChange={(e) => setReference(e.target.value || null)}
                    className={`${input} w-full`}
                    title="The original bounce to compare against"
                  >
                    <option value="">No reference</option>
                    {bounceTakes.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}{/\.mp3$/i.test(t.entries[0].name) ? ' (mp3)' : ''}</option>
                    ))}
                  </select>
                  {project.reference && (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number" step={0.01}
                        value={Number(project.reference.offset.toFixed(3))}
                        onChange={(e) => { const p = projectRef.current; if (p.reference) setLive({ ...p, reference: { ...p.reference, offset: Number(e.target.value) || 0 } }) }}
                        title="Where the original starts on the timeline, in seconds - nudge it until it lines up"
                        className={`${input} w-[80px] tabular-nums`}
                      />
                      <button
                        className={`${btn} bg-[var(--surface-raised)]`}
                        title="Line the original up with your arrangement"
                        onClick={() => void lineUpReference()}
                        disabled={aligning}
                      >
                        {aligning ? <Loader2 size={14} className="animate-spin" /> : <Crosshair size={14} />}
                      </button>
                      <button
                        className={`${btn} flex-1 ${ab === 'ref' ? 'bg-amber-500/20 text-amber-400 hover:text-amber-400' : 'bg-[var(--surface-raised)]'}`}
                        title="Switch between your arrangement and the original, in sync (R)"
                        onClick={toggleAB}
                      >
                        {refLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                        {ab === 'ref' ? 'Playing original' : 'Playing your mix'}
                      </button>
                    </div>
                  )}
                  {project.reference && alignNote && <div className="text-xs text-amber-400">{alignNote}</div>}
                </div>
              )}
              <SessionDownloadButton session={session} full />
              <button className={`${btn} w-full justify-start`} title="Save the project as a file (share it - it holds no audio)" onClick={() => { exportProject(); setProjMenu(false) }}>
                <FileDown size={15} /> Save project file
              </button>
              <button
                className={`${btn} w-full justify-start`}
                title="Save a copy of this project and switch to it (this one stays as it is)"
                onClick={() => {
                  const current = { ...projectRef.current, updatedAt: Date.now() }
                  saveProject(current)
                  engine.dispose()
                  onOpenCopy(duplicateProject(current))
                }}
              >
                <Copy size={15} /> Duplicate project
              </button>
              <button className={`${btn} w-full justify-start bg-accent text-white hover:bg-accent-hover hover:text-white`} title="Render the arrangement to a WAV file" onClick={() => void exportWav()} disabled={!!exporting || end <= 0}>
                {exporting ? <><Loader2 size={15} className="animate-spin" /> {exporting}</> : <><Download size={15} /> Export WAV</>}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Take bin */}
        <div className="w-72 shrink-0 flex flex-col border-r border-[var(--border)]">
          <div className="p-2 space-y-2 border-b border-[var(--border)]">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input value={binQuery} onChange={(e) => setBinQuery(e.target.value)} placeholder={`Filter ${session.takes.length} files…`} className={`${input} w-full pl-8`} />
            </div>
            <button
              className={`${btn} w-full justify-start`}
              disabled={!unplacedWithPos}
              title="Put every take back where it was recorded, on as many lanes as needed"
              onClick={() => commit(placeAllTakes(projectRef.current, session))}
            >
              <Wand2 size={15} /> Place all takes at original positions
            </button>
          </div>
          {binSel.length > 1 && (
            <div className="shrink-0 flex items-center gap-1 px-3 py-1.5 border-b border-[var(--border)] bg-accent/10 text-xs animate-fade-in">
              <span className="font-medium text-accent tabular-nums">{binSel.length} selected</span>
              <div className="flex-1" />
              <button className="h-6 px-2 rounded-md text-accent hover:bg-accent/15" title="Place them where they were recorded (Enter)" onClick={() => { const t = takesById.get(binSel[binSel.length - 1]); if (t) placeFromBin(t) }}>Place</button>
              <button className="h-6 w-6 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-[var(--surface-raised)]" title="Clear selection (Esc)" onClick={() => setBinSel([])}><X size={13} /></button>
            </div>
          )}
          <div ref={binListRef} className="flex-1 overflow-y-auto py-1">
            {beats.length > 0 && <BinHeading>Beat</BinHeading>}
            {binRows(beats)}
            {byCat.map(({ cat, takes }, ci) => {
              const open = !closedCats.has(cat.id)
              return (
                <React.Fragment key={cat.id}>
                  <CategoryHeading
                    cat={cat}
                    index={ci}
                    count={takes.length}
                    open={open}
                    renaming={renamingCat === cat.id}
                    dropTarget={catDropTarget === cat.id}
                    onToggle={() => setClosedCats((s) => { const n = new Set(s); if (open) n.add(cat.id); else n.delete(cat.id); return n })}
                    onRename={(name) => { setRenamingCat(null); if (name != null) renameCategory(cat.id, name) }}
                    onStartRename={() => setRenamingCat(cat.id)}
                    onMenu={(e) => { e.preventDefault(); setCatMenu({ catId: cat.id, x: e.clientX, y: e.clientY }) }}
                    onDragTarget={(on) => setCatDropTarget((cur) => (on ? cat.id : cur === cat.id ? null : cur))}
                    onDropTakes={(ids) => { setCatDropTarget(null); sendToCategory(ids, cat.id) }}
                  />
                  {open && binRows(takes)}
                  {open && !takes.length && !bq && <div className="mx-3 mb-1 px-2 py-2 rounded-lg border border-dashed border-[var(--border)] text-[11px] text-text-muted text-center">Drag takes here, or right-click one → Send to category</div>}
                </React.Fragment>
              )
            })}
            <div
              className={`flex items-center rounded-md mx-1 transition-colors ${catDropTarget === '' ? 'bg-accent/15' : ''}`}
              onDragOver={(e) => { if (e.dataTransfer.types.includes('text/x-session-take') && categories.length) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setCatDropTarget('') } }}
              onDragLeave={() => setCatDropTarget((cur) => (cur === '' ? null : cur))}
              onDrop={(e) => { e.preventDefault(); setCatDropTarget(null); sendToCategory(droppedTakeIds(e), null) }}
            >
              {(vocals.length > 0 || categories.length > 0) && <BinHeading>Takes · {vocals.length}</BinHeading>}
              <div className="flex-1" />
              <button className="mr-1 mt-2 h-6 px-1.5 rounded-md flex items-center gap-1 text-[11px] text-text-muted hover:text-text-primary hover:bg-[var(--surface-raised)]" title="New take category" onClick={() => addCategory()}>
                <FolderPlus size={13} /> Category
              </button>
            </div>
            {binRows(vocals)}
            {bounces.length > 0 && (
              <button className="w-full flex items-center gap-1 px-3 pt-3 pb-1 text-[11px] uppercase tracking-wider text-text-muted hover:text-text-secondary" onClick={() => setShowBounces(!showBounces)}>
                {showBounces ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Bounces · {bounces.length}
              </button>
            )}
            {showBounces && binRows(bounces)}
          </div>
          {previewTake && (
            <PreviewDeck
              key={previewTake.id}
              take={previewTake}
              zipPath={session.zipPath}
              engine={engine}
              loaded={loaded.get(previewTake.id)}
              paused={previewPaused}
              loop={previewLoop}
              volume={previewVolume}
              placed={placedIds.has(previewTake.id) || project.reference?.takeId === previewTake.id}
              onToggle={() => togglePreview(previewTake)}
              onClose={closePreview}
              onLoop={togglePreviewLoop}
              onVolume={setPreviewVol}
              onPlace={() => (previewTake.kind === 'bounce' ? setReference(previewTake.id) : placeTake(previewTake, null, null))}
            />
          )}
        </div>

        {/* Timeline */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div ref={scrollRef} className="timeline-scroll flex-1 overflow-auto relative" style={{ '--track-header-w': `${HEADER_W}px` } as React.CSSProperties}>
            <div style={{ width: HEADER_W + contentW, minHeight: '100%' }} className="relative flex flex-col">
              {/* Ruler */}
              <div className="sticky top-0 z-20 flex shrink-0" style={{ height: RULER_H }}>
                <div className="sticky left-0 z-10 shrink-0 bg-[var(--surface)] border-b border-r border-[var(--border)]" style={{ width: HEADER_W }} />
                <Ruler width={contentW} pps={pps} bpm={project.bpm} gridOffset={project.gridOffset} loop={loop} snap={snapAbs} onSeek={seek} onLoop={(r) => setLoop(r)} />
              </div>

              {/* Lanes */}
              <div ref={rowsRef} className="relative flex-1 flex flex-col" onDragOver={(e) => { if (e.dataTransfer.types.includes('text/x-session-take')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }} onDrop={onDrop}>
                {trackDrag && (
                  // Where the dragged tracks will land; a line across the full width, stronger over the header column.
                  <div className="absolute left-0 right-0 z-40 pointer-events-none" style={{ top: trackDrag.insertAt * LANE_H - 1 }}>
                    <div className="h-0.5 bg-accent/60" />
                    <div className="sticky left-0 -mt-[5px] flex items-center" style={{ width: HEADER_W }}>
                      <div className="w-2.5 h-2.5 rounded-full bg-accent shadow-[0_0_10px_rgb(var(--accent-rgb)/0.8)]" />
                      <div className="flex-1 h-[3px] bg-accent" />
                      {trackDrag.ids.length > 1 && <span className="ml-1 px-1.5 rounded-full bg-accent text-white text-[10px] font-semibold leading-4">{trackDrag.ids.length}</span>}
                    </div>
                  </div>
                )}
                {rows.map((row) => {
                  if (row.kind === 'folder') {
                    const members = row.members.map((i) => project.tracks[i])
                    const ids = members.map((t) => t.id)
                    const anySolo = project.tracks.some((t) => t.solo)
                    return (
                      <div key={`folder:${row.folder.id}`} className="flex shrink-0 border-b border-[var(--border)] transition-opacity" style={{ height: LANE_H, opacity: trackDrag && ids.every((id) => trackDrag.ids.includes(id)) ? 0.35 : 1 }}>
                        <FolderHeader
                          folder={row.folder}
                          members={members}
                          open={row.open}
                          selected={ids.length > 0 && ids.every((id) => trackSelSet.has(id))}
                          onToggle={toggleFolder}
                          onRename={renameFolder}
                          onPointerDown={onFolderPointerDown}
                          onMute={folderMute}
                          onSolo={folderSolo}
                          onFx={openFolderFx}
                          onMenu={openFolderMenu}
                        />
                        <CompLane
                          members={row.members.map((i) => ({ track: project.tracks[i], color: TRACK_COLORS[i % TRACK_COLORS.length], heard: !project.tracks[i].muted && (!anySolo || project.tracks[i].solo) }))}
                          loaded={loaded}
                          takesById={takesById}
                          pps={pps}
                          width={contentW}
                          laneStyle={laneGrid}
                          selectedSet={selectedSet}
                          onClipDown={onCompClipDown}
                          onLanePointerDown={onLanePointerDown}
                          onMenu={openTakeMenu}
                        />
                      </div>
                    )
                  }
                  const ti = row.trackIdx
                  const track = project.tracks[ti]
                  return (
                  <div key={track.id} className="flex shrink-0 border-b border-[var(--border)] transition-opacity" style={{ height: LANE_H, opacity: trackDrag?.ids.includes(track.id) ? 0.35 : 1 }}>
                    <TrackHeader
                      track={track}
                      nested={!!row.folder}
                      color={TRACK_COLORS[ti % TRACK_COLORS.length]}
                      selected={trackSelSet.has(track.id)}
                      groupSize={trackSelSet.has(track.id) ? trackSel.length : 1}
                      onSelect={onTrackPointerDown}
                      onFx={openLaneFx}
                      onChange={updateTrack}
                      onRemove={removeTrack}
                      onMenu={openTrackMenu}
                    />
                    <div
                      className="relative shrink-0"
                      style={{ width: contentW, ...laneGrid, opacity: track.muted ? 0.45 : 1 }}
                      onPointerDown={onLanePointerDown}
                      onContextMenu={(e) => openTrackMenu(track.id, e)}
                    >
                      {track.clips.map((c) => (
                        <ClipView
                          key={c.id}
                          clip={c}
                          take={takesById.get(c.takeId)}
                          zipPath={session.zipPath}
                          loaded={loaded.get(c.takeId)}
                          failed={failed.has(c.takeId)}
                          pps={pps}
                          color={TRACK_COLORS[ti % TRACK_COLORS.length]}
                          selected={selectedSet.has(c.id)}
                          compTool={compTool && !isBeatTrack(track)}
                          swipe={swipe?.clipId === c.id ? swipe : undefined}
                          fx={laneFx(track, project.bpm)}
                          onPointerDown={onClipPointerDown}
                          onMenu={openTakeMenu}
                        />
                      ))}
                    </div>
                  </div>
                  )
                })}
                {/* Drop below the last lane to start a new one */}
                <div className="flex flex-1" style={{ minHeight: LANE_H }}>
                  {/* Padding lines the icon up with the track names above (colour bar + header + input padding). */}
                  <div className="sticky left-0 z-10 shrink-0 flex items-start pt-2 pl-1.5 pr-2 bg-[var(--surface)] border-r border-[var(--border)]" style={{ width: HEADER_W }}>
                    <button className={`${btn} w-full justify-start`} onClick={addTrack}><Plus size={15} /> Add track</button>
                  </div>
                  <div style={{ width: contentW }} />
                </div>
              </div>

              {loop?.on && (
                <div
                  className="absolute bottom-0 z-[5] pointer-events-none bg-accent/[0.07] border-x border-accent/40"
                  style={{ top: RULER_H, left: HEADER_W + loop.start * pps, width: (loop.end - loop.start) * pps }}
                />
              )}
              <div ref={marqueeRef} className="fixed z-30 pointer-events-none border border-accent bg-accent/10" style={{ display: 'none' }} />
              <Playhead engine={engine} pps={pps} follow={follow && playing} scrollRef={scrollRef} onScrub={scrub} />
            </div>
          </div>

          {/* Inspector */}
          {sel && (
            <ClipInspector
              clip={sel.clip}
              take={takesById.get(sel.clip.takeId)}
              originalName={scannedNames.get(sel.clip.takeId)}
              renaming={renaming?.where === 'inspector' && renaming.takeId === sel.clip.takeId}
              setRenaming={(on) => setRenaming(on ? { takeId: sel.clip.takeId, where: 'inspector' } : null)}
              onRename={renameTake}
              onChange={(patch, history) => {
                // Gain and fades apply to every selected clip.
                let next = projectRef.current
                for (const id of selectionRef.current) {
                  next = mapClip(next, id, (c) => {
                    const m = { ...c, ...patch }
                    return { ...m, fadeIn: Math.min(m.fadeIn, m.length - m.fadeOut), fadeOut: Math.min(m.fadeOut, m.length - m.fadeIn) }
                  })
                }
                if (history) commit(next)
                else setLive(next)
              }}
              alternates={selAlts.length}
              alternateIndex={selAlts.findIndex((c) => c.id === sel.clip.id)}
              onCycle={cycleAlternate}
              onComp={() => compClip(sel.clip.id)}
              count={selection.length}
              onToggleMute={() => toggleClipMute(selection)}
              onReverse={() => reverseClips(selection)}
              onRetime={(patch) => retimeClips(selection, patch)}
              onLoop={() => setLoop({ start: sel.clip.start, end: sel.clip.start + sel.clip.length })}
              onSplit={() => splitClips(selection, engine.position())}
              onDuplicate={() => duplicateClips(selection)}
              onDelete={() => deleteClips(selection)}
              onLocate={() => seek(sel.clip.start)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

/** Ids carried by a take drag from the bin: the whole selection when one of it was grabbed. */
function droppedTakeIds(e: React.DragEvent): string[] {
  try {
    const many = JSON.parse(e.dataTransfer.getData('text/x-session-takes') || 'null') as string[] | null
    if (many?.length) return many
  } catch {}
  const one = e.dataTransfer.getData('text/x-session-take')
  return one ? [one] : []
}

const catColor = (i: number): string => TRACK_COLORS[(i + 3) % TRACK_COLORS.length]
/** A menu icon that's just the category's colour dot. */
function CategoryDot(i: number): React.ElementType {
  return function Dot({ size = 14 }: { size?: number }): JSX.Element {
    return <span className="inline-flex items-center justify-center" style={{ width: size, height: size }}><span className="w-2 h-2 rounded-full" style={{ background: catColor(i) }} /></span>
  }
}

function CategoryHeading({ cat, index, count, open, renaming, dropTarget, onToggle, onRename, onStartRename, onMenu, onDragTarget, onDropTakes }: {
  cat: TakeCategory; index: number; count: number; open: boolean; renaming: boolean; dropTarget: boolean
  onToggle: () => void; onRename: (name: string | null) => void; onStartRename: () => void
  onMenu: (e: React.MouseEvent) => void; onDragTarget: (on: boolean) => void; onDropTakes: (ids: string[]) => void
}): JSX.Element {
  const color = catColor(index)
  return (
    <div
      className={`group/cat flex items-center gap-1.5 mx-1 mt-2 px-2 h-7 rounded-md transition-colors ${dropTarget ? 'bg-accent/15 ring-1 ring-inset ring-accent/50' : 'hover:bg-surface-overlay'}`}
      onContextMenu={onMenu}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('text/x-session-take')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragTarget(true) } }}
      onDragLeave={() => onDragTarget(false)}
      onDrop={(e) => { e.preventDefault(); onDropTakes(droppedTakeIds(e)) }}
    >
      <button className="flex items-center text-text-muted hover:text-text-primary" onClick={onToggle} title={open ? 'Collapse' : 'Expand'}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 8px ${color}80` }} />
      {renaming
        ? <div className="flex-1 min-w-0"><RenameInput value={cat.name} onDone={onRename} className="!text-[12px]" /></div>
        : <button
            className="flex-1 min-w-0 text-left text-[11px] uppercase tracking-wider font-semibold truncate"
            style={{ color }}
            onClick={onToggle}
            onDoubleClick={(e) => { e.stopPropagation(); onStartRename() }}
            title="Click to fold · double-click to rename · right-click for more"
          >
            {cat.name} <span className="text-text-muted font-normal">· {count}</span>
          </button>}
      {!renaming && (
        <button className="w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-text-primary opacity-0 group-hover/cat:opacity-100 transition" title="Rename category" onClick={onStartRename}>
          <Pencil size={11} />
        </button>
      )}
    </div>
  )
}

function BinHeading({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wider text-text-muted">{children}</div>
}

function useLoadProgress(key: string): number | undefined {
  return useSyncExternalStore(subscribeLoadProgress, () => peekLoadProgress(key))
}

const BinRow = memo(function BinRow({ take, selected, joinUp, joinDown, onSelect, dragIds, originalName, zipPath, placed, previewing, previewPaused, engine, failed, editing, onEditing, onMenu, onPreview, onPlace, onRename, placeHint = 'Double-click to place it where it was recorded' }: {
  take: Take; selected: boolean; joinUp: boolean; joinDown: boolean; onSelect: (takeId: string, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void
  dragIds: (takeId: string) => string[]
  originalName: string; zipPath: string; placed: boolean; previewing: boolean; previewPaused: boolean; engine: SessionEngine; failed: boolean
  editing: boolean; onEditing: (takeId: string | null) => void; onMenu: (takeId: string, e: React.MouseEvent) => void
  onPreview: (t: Take) => void; onPlace: (t: Take) => void; onRename: (takeId: string, name: string) => void; placeHint?: string
}): JSX.Element {
  const progress = useLoadProgress(takeKey(zipPath, take.id))
  const loading = previewing && progress !== undefined
  const sounding = previewing && !previewPaused && !loading
  const renamed = take.name !== originalName
  const rowRef = useRef<HTMLDivElement>(null)
  // Opened from the right-click menu while the row is scrolled away.
  useEffect(() => { if (editing) rowRef.current?.scrollIntoView({ block: 'nearest' }) }, [editing])
  return (
    <div
      ref={rowRef}
      draggable={!editing}
      tabIndex={0}
      onContextMenu={(e) => onMenu(take.id, e)}
      onDragStart={(e) => {
        const ids = dragIds(take.id)
        e.dataTransfer.setData('text/x-session-take', take.id)
        if (ids.length > 1) {
          e.dataTransfer.setData('text/x-session-takes', JSON.stringify(ids))
          // A stacked badge instead of the browser's ghost of one row.
          const ghost = document.createElement('div')
          ghost.textContent = `${ids.length} takes`
          ghost.style.cssText = 'position:fixed;top:-100px;left:0;padding:4px 10px;border-radius:999px;font:600 12px system-ui;color:#fff;background:rgb(var(--accent-rgb));box-shadow:3px 3px 0 rgb(var(--accent-rgb) / 0.4),6px 6px 0 rgb(var(--accent-rgb) / 0.2)'
          document.body.appendChild(ghost)
          e.dataTransfer.setDragImage(ghost, 12, 12)
          setTimeout(() => ghost.remove())
        }
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={(e) => { if (!editing && !(e.target as HTMLElement).closest('button')) onSelect(take.id, e) }}
      onDoubleClick={editing ? undefined : () => onPlace(take)}
      onKeyDown={(e) => { if (e.key === 'F2' && !editing) { e.preventDefault(); onEditing(take.id) } }}
      title={`${renamed ? `${originalName}\n` : ''}${take.id}\n${placeHint} · Ctrl/Shift+click to select several · right-click for more`}
      className={`group relative overflow-hidden outline-none focus-visible:ring-1 focus-visible:ring-accent/50 flex items-center gap-2 mx-1 px-2 py-1.5 rounded-lg cursor-grab active:cursor-grabbing transition-colors ${selected && joinUp ? 'rounded-t-none' : ''} ${selected && joinDown ? 'rounded-b-none' : ''} ${selected ? 'bg-accent/[0.18]' : previewing ? 'bg-accent/10' : 'hover:bg-surface-overlay'} ${previewing ? 'ring-1 ring-inset ring-accent/40' : ''}`}
    >
      <button
        onClick={() => onPreview(take)}
        className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center transition-all ${previewing ? 'bg-accent text-white shadow-[0_0_14px_rgb(var(--accent-rgb)/0.55)]' : 'bg-[var(--surface-raised)] text-text-secondary hover:text-text-primary hover:scale-105'}`}
        title={!previewing ? 'Preview' : previewPaused ? 'Resume preview' : 'Pause preview'}
      >
        {loading
          ? <span className="text-[9px] tabular-nums">{Math.round(progress * 100)}</span>
          : sounding
            ? <>
                <span className="group-hover:hidden"><LevelBars engine={engine} bars={3} className="h-3 gap-[2px]" barClass="w-[2px] bg-white" /></span>
                <Pause size={12} fill="currentColor" className="hidden group-hover:block" />
              </>
            : <Play size={12} fill="currentColor" className="ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        {editing
          ? <RenameInput value={take.name} placeholder={originalName} onDone={(name) => { onEditing(null); if (name != null) onRename(take.id, name) }} />
          : <div className={`text-[13px] truncate ${failed ? 'text-red-400' : previewing ? 'text-accent font-medium' : 'text-text-primary'}`}>
              {take.name}
            </div>}
        <div className="text-[11px] text-text-muted tabular-nums flex gap-2">
          <span>{take.duration != null ? formatTime(take.duration) : '—'}</span>
          {take.position != null && <span>@ {formatTime(take.position)}</span>}
          {take.channels >= 2 && <span>stereo</span>}
          {renamed && <span className="truncate italic" title="Original file name">{originalName}</span>}
        </div>
      </div>
      {!editing && (
        <button
          className="w-6 h-6 shrink-0 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-[var(--surface-raised)] opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
          title="Rename take (F2)"
          onClick={() => onEditing(take.id)}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Pencil size={12} />
        </button>
      )}
      {placed && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" title="On the timeline" />}
      {previewing && !loading && <PreviewProgressBar engine={engine} />}
    </div>
  )
})

/** Inline text field: Enter or blur saves, Esc cancels (onDone(null)). Empty restores the original name. */
function RenameInput({ value, placeholder, onDone, className = '' }: { value: string; placeholder?: string; onDone: (v: string | null) => void; className?: string }): JSX.Element {
  const [v, setV] = useState(value)
  const done = useRef(false)
  const finish = (out: string | null): void => { if (done.current) return; done.current = true; onDone(out) }
  return (
    <input
      autoFocus
      value={v}
      placeholder={placeholder}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(v)
        else if (e.key === 'Escape') finish(null)
      }}
      onBlur={() => finish(v)}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className={`w-full h-6 -my-0.5 px-1 -mx-1 rounded bg-[var(--surface-raised)] text-[13px] text-text-primary outline-none ring-1 ring-accent/60 ${className}`}
    />
  )
}

/** Runs `cb` every animation frame while mounted. */
function useFrame(cb: () => void, deps: React.DependencyList): void {
  const cbRef = useRef(cb)
  cbRef.current = cb
  useEffect(() => {
    let raf = 0
    const tick = (): void => { cbRef.current(); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

function PreviewProgressBar({ engine }: { engine: SessionEngine }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useFrame(() => {
    const d = engine.previewDuration
    if (ref.current) ref.current.style.transform = `scaleX(${d ? engine.previewPosition() / d : 0})`
  }, [engine])
  return <div ref={ref} className="absolute left-0 bottom-0 h-[2px] w-full origin-left bg-accent pointer-events-none" style={{ transform: 'scaleX(0)' }} />
}

/** A little spectrum meter fed from the preview's analyser. */
function LevelBars({ engine, bars, className = '', barClass = '' }: { engine: SessionEngine; bars: number; className?: string; barClass?: string }): JSX.Element {
  const refs = useRef<(HTMLSpanElement | null)[]>([])
  const data = useMemo(() => new Uint8Array(32), [])
  useFrame(() => {
    engine.previewLevels(data)
    // Skip the lowest bin (DC/rumble) and spread the bars across the musical range.
    const span = Math.max(1, Math.floor(18 / bars))
    for (let i = 0; i < bars; i++) {
      let m = 0
      for (let j = 1 + i * span; j < 1 + (i + 1) * span; j++) if (data[j] > m) m = data[j]
      const el = refs.current[i]
      if (el) el.style.transform = `scaleY(${Math.max(0.15, Math.pow(m / 255, 1.6))})`
    }
  }, [engine, bars])
  return (
    <span className={`flex items-end ${className}`}>
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} ref={(el) => { refs.current[i] = el }} className={`h-full origin-bottom rounded-full transition-transform duration-75 ${barClass}`} style={{ transform: 'scaleY(0.15)' }} />
      ))}
    </span>
  )
}

const DECK_WAVE_H = 56

/** The now-playing panel for the take being previewed from the bin. */
function PreviewDeck({ take, zipPath, engine, loaded, paused, loop, volume, placed, onToggle, onClose, onLoop, onVolume, onPlace }: {
  take: Take; zipPath: string; engine: SessionEngine; loaded: LoadedTake | undefined
  paused: boolean; loop: boolean; volume: number; placed: boolean
  onToggle: () => void; onClose: () => void; onLoop: () => void; onVolume: (v: number) => void; onPlace: () => void
}): JSX.Element {
  const progress = useLoadProgress(takeKey(zipPath, take.id))
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const [hoverX, setHoverX] = useState<number | null>(null)
  const hoverRef = useRef(hoverX)
  hoverRef.current = hoverX
  const dur = loaded?.buffer.duration ?? take.duration ?? 0
  const ready = !!loaded
  const sounding = ready && !paused
  const drawn = useRef({ key: '', frame: 0, accent: '', muted: '' })

  useFrame(() => {
    const c = canvasRef.current
    if (!c) return
    const memo = drawn.current
    // Theme colours can change under us, but reading computed style every frame forces a style recalc.
    if (memo.frame++ % 60 === 0) {
      const css = getComputedStyle(c)
      memo.accent = `rgb(${css.getPropertyValue('--accent-rgb').trim() || '255 255 255'})`
      memo.muted = css.getPropertyValue('--text-muted').trim() || '#888'
    }
    const { accent, muted } = memo
    const w = c.clientWidth, h = DECK_WAVE_H
    const pos = ready && engine.previewActive ? engine.previewPosition() : 0
    const hover = hoverRef.current
    // Paused with the mouse still: the picture hasn't changed. (The loading shimmer animates, so always draws.)
    const key = `${w}|${pos.toFixed(3)}|${hover}|${accent}|${muted}`
    if (ready && key === memo.key) return
    memo.key = key
    const dpr = window.devicePixelRatio || 1
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr) }
    const g = c.getContext('2d')
    if (!g || !w) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    const frac = dur ? pos / dur : 0
    const peaks = loaded?.peaks
    const bar = 2, gap = 1, n = Math.floor(w / (bar + gap))
    const mid = h / 2
    for (let i = 0; i < n; i++) {
      let m: number
      if (peaks?.length) {
        m = 0
        const i0 = Math.floor((i / n) * peaks.length), i1 = Math.max(i0 + 1, Math.floor(((i + 1) / n) * peaks.length))
        for (let j = i0; j < i1; j++) if (peaks[j] > m) m = peaks[j]
      } else {
        // Until the audio decodes: a soft travelling wave.
        m = 0.05 + 0.04 * Math.sin(i * 0.35 - performance.now() / 160)
      }
      const y = Math.max(1, Math.min(1, Math.sqrt(m)) * (mid - 2))
      const x = i * (bar + gap)
      const isPlayed = (i + 0.5) / n <= frac
      const inHover = hover != null && ready && x >= Math.min(hover, frac * w) && x <= Math.max(hover, frac * w)
      g.fillStyle = isPlayed ? accent : muted
      g.globalAlpha = isPlayed ? (inHover ? 0.6 : 1) : inHover ? 0.75 : 0.4
      g.fillRect(x, mid - y, bar, y * 2)
    }
    g.globalAlpha = 1
    if (ready && frac > 0) {
      g.fillStyle = accent
      g.shadowColor = accent
      g.shadowBlur = 8
      g.fillRect(frac * w - 1, 1, 2, h - 2)
      g.shadowBlur = 0
    }
    const el = timeRef.current
    if (el) {
      const text = `${formatTime(pos)} / ${formatTime(dur)}`
      if (el.textContent !== text) el.textContent = text
    }
  }, [engine, loaded, dur, ready])

  const seekAt = (clientX: number): void => {
    const c = canvasRef.current
    if (!c || !ready) return
    const r = c.getBoundingClientRect()
    engine.seekPreview(clamp((clientX - r.left) / r.width, 0, 1) * dur)
  }
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!ready) return
    e.currentTarget.setPointerCapture(e.pointerId)
    seekAt(e.clientX)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    setHoverX(e.clientX - e.currentTarget.getBoundingClientRect().left)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) seekAt(e.clientX)
  }
  const nudge = (d: number): void => { if (ready) engine.seekPreview(engine.previewPosition() + d) }

  const ctl = 'w-8 h-8 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-[var(--surface-raised)] transition-colors disabled:opacity-40 disabled:pointer-events-none'
  const canvasW = canvasRef.current?.clientWidth || 1
  return (
    <div
      className="relative shrink-0 border-t border-[var(--border)] px-3 pt-2.5 pb-3 animate-slide-up"
      style={{ background: 'linear-gradient(180deg, rgb(var(--accent-rgb) / 0.16), rgb(var(--accent-rgb) / 0.04) 75%, transparent)' }}
    >
      <div className="flex items-center gap-2.5">
        {sounding
          ? <LevelBars engine={engine} bars={4} className="h-4 w-[18px] gap-[2px] shrink-0" barClass="w-[3px] bg-accent" />
          : <span className="h-4 w-[18px] shrink-0 flex items-end gap-[2px]">{[0, 1, 2, 3].map((i) => <span key={i} className="w-[3px] h-[3px] rounded-full bg-accent/60" />)}</span>}
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-accent">
            {!loaded ? `Loading${progress !== undefined ? ` ${Math.round(progress * 100)}%` : '…'}` : sounding ? 'Now previewing' : 'Paused'}
          </div>
          <div className="text-[13px] font-semibold text-text-primary truncate" title={take.id}>{take.name}</div>
        </div>
        <button className="w-6 h-6 shrink-0 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-[var(--surface-raised)]" title="Close preview (Esc)" onClick={onClose}>
          <X size={14} />
        </button>
      </div>

      <div className="relative mt-2.5">
        <canvas
          ref={canvasRef}
          className={`block w-full ${ready ? 'cursor-pointer' : 'cursor-wait'}`}
          style={{ height: DECK_WAVE_H }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHoverX(null)}
        />
        {hoverX != null && ready && (
          <div
            className="absolute top-0 -translate-x-1/2 -translate-y-[calc(100%+4px)] px-1.5 py-0.5 rounded bg-black/85 text-[10px] font-mono text-white pointer-events-none whitespace-nowrap"
            style={{ left: clamp(hoverX, 16, canvasW - 16) }}
          >
            {formatTime(clamp(hoverX / canvasW, 0, 1) * dur)}
          </div>
        )}
      </div>

      <div className="mt-1 flex items-center justify-between text-[11px] font-mono tabular-nums text-text-muted">
        <span ref={timeRef}>0:00 / {formatTime(dur)}</span>
        {take.position != null && <span title="Where it was recorded in the session">@ {formatTime(take.position)}</span>}
      </div>

      <div className="mt-1.5 flex items-center gap-0.5">
        <button className={ctl} title="Back to start" disabled={!ready} onClick={() => engine.seekPreview(0)}><SkipBack size={15} /></button>
        <button className={ctl} title="Back 5 s" disabled={!ready} onClick={() => nudge(-5)}><RotateCcw size={15} /></button>
        <button
          className="w-10 h-10 mx-0.5 shrink-0 rounded-full flex items-center justify-center bg-accent text-white hover:bg-accent-hover hover:scale-105 active:scale-95 transition-all shadow-[0_4px_18px_rgb(var(--accent-rgb)/0.45)] disabled:opacity-60"
          title={sounding ? 'Pause (Space)' : 'Play (Space)'}
          disabled={!loaded}
          onClick={onToggle}
        >
          {!loaded ? <Loader2 size={17} className="animate-spin" /> : sounding ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" className="ml-0.5" />}
        </button>
        <button className={ctl} title="Forward 5 s" disabled={!ready} onClick={() => nudge(5)}><RotateCw size={15} /></button>
        <button className={`${ctl} ${loop ? '!text-accent bg-accent/15' : ''}`} title="Loop the preview" onClick={onLoop}><Repeat size={15} /></button>
        <div className="flex-1" />
        <button
          className={`h-8 px-2.5 shrink-0 rounded-full flex items-center gap-1 text-xs font-medium transition-colors ${placed ? 'text-text-muted bg-[var(--surface-raised)]' : 'text-accent bg-accent/15 hover:bg-accent/25'}`}
          title={take.kind === 'bounce' ? 'Use it as the reference' : 'Drop it on the timeline where it was recorded'}
          onClick={onPlace}
        >
          {placed ? <Check size={13} /> : <Plus size={13} />} {take.kind === 'bounce' ? 'Reference' : placed ? 'Placed' : 'Place'}
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2 text-text-muted" title={`Preview volume ${Math.round(volume * 100)}%`}>
        <button className="shrink-0 hover:text-text-primary" onClick={() => onVolume(volume > 0 ? 0 : 1)}>
          {volume > 0 ? <Volume2 size={14} /> : <VolumeX size={14} />}
        </button>
        <input type="range" min={0} max={1.5} step={0.01} value={volume} onChange={(e) => onVolume(Number(e.target.value))} className="flex-1 h-1 accent-[rgb(var(--accent-rgb))]" />
      </div>
    </div>
  )
}

/** A take folder's header: fold, name, M/S for every lane in it. */
const FolderHeader = memo(function FolderHeader({ folder, members, open, selected, onToggle, onRename, onPointerDown, onMute, onSolo, onFx, onMenu }: {
  folder: TakeFolder; members: SmTrack[]; open: boolean; selected: boolean
  onToggle: (id: string) => void
  onRename: (id: string, name: string) => void
  onPointerDown: (id: string, e: React.PointerEvent) => void
  onMute: (id: string) => void
  onSolo: (id: string) => void
  /** Opens the FX popover on every lane in the folder. */
  onFx: (id: string, anchor: HTMLElement) => void
  onMenu: (id: string, e: React.MouseEvent) => void
}): JSX.Element {
  const muted = members.length > 0 && members.every((t) => t.muted)
  const solo = members.length > 0 && members.every((t) => t.solo)
  const takes = members.reduce((n, t) => n + t.clips.length, 0)
  const toggleCls = (on: boolean, onCls: string): string =>
    `w-6 h-6 rounded-md text-[11px] font-bold transition-colors ${on ? onCls : 'bg-[var(--surface)] text-text-muted hover:text-text-primary'}`
  return (
    <div
      className="group sticky left-0 z-10 shrink-0 flex bg-[var(--surface-raised)] border-r border-[var(--border)] cursor-grab"
      style={{ width: HEADER_W }}
      title="Take folder: the comp lane shows what plays from its lanes · click to select them · drag to move it · right-click for more"
      onPointerDown={(e) => {
        const el = e.target as HTMLElement
        if (e.button !== 0 || el.closest('button') || (el instanceof HTMLInputElement && document.activeElement === el)) return
        onPointerDown(folder.id, e)
      }}
      onContextMenu={(e) => onMenu(folder.id, e)}
    >
      {selected && <div className="absolute inset-0 pointer-events-none bg-accent/10 ring-1 ring-inset ring-accent/40" />}
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-1 px-1.5">
        <div className="flex items-center gap-1">
          <button
            className="w-6 h-6 shrink-0 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-overlay"
            title={open ? 'Fold to the comp lane' : 'Show the take lanes'}
            onClick={() => onToggle(folder.id)}
          >
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
          <input
            data-folder-name={folder.id}
            value={folder.name}
            placeholder="Take folder"
            onChange={(e) => onRename(folder.id, e.target.value)}
            className="flex-1 min-w-0 h-6 px-1 rounded bg-transparent hover:bg-[var(--surface)] focus:bg-[var(--surface)] text-[13px] font-semibold text-text-primary outline-none"
          />
          <button className={toggleCls(muted, 'bg-amber-500/80 text-black')} title="Mute every lane in the folder" onClick={() => onMute(folder.id)}>M</button>
          <button className={toggleCls(solo, 'bg-emerald-500/80 text-black')} title="Solo every lane in the folder" onClick={() => onSolo(folder.id)}>S</button>
          {members.length > 0 && <FxButton active={members.some(hasEffects)} title="Effects on every lane in the folder" onOpen={(el) => onFx(folder.id, el)} />}
        </div>
        <div className="pl-7 text-[11px] text-text-muted truncate">
          {members.length} lane{members.length === 1 ? '' : 's'} · {takes} take{takes === 1 ? '' : 's'}
        </div>
      </div>
    </div>
  )
})

/** What a folder's lanes add up to: each heard stretch drawn in its lane's colour, with a
 *  warning band wherever two takes still play at once. */
const CompLane = memo(function CompLane({ members, loaded, takesById, pps, width, laneStyle, selectedSet, onClipDown, onLanePointerDown, onMenu }: {
  members: { track: SmTrack; color: string; heard: boolean }[]
  loaded: Map<string, LoadedTake>; takesById: Map<string, Take>; pps: number; width: number; laneStyle?: React.CSSProperties; selectedSet: Set<string>
  onClipDown: (e: React.PointerEvent, clipId: string) => void
  onLanePointerDown: (e: React.PointerEvent) => void
  onMenu: (takeId: string, e: React.MouseEvent, clipId?: string) => void
}): JSX.Element {
  const segs = members.flatMap((m) => (m.heard
    ? m.track.clips.flatMap((c) => audibleSpans(c).map(([a, b]) => ({ key: `${c.id}:${a}`, clip: c, color: m.color, view: { ...c, start: c.start + a, offset: takeTime(c, c.start + a), length: b - a } })))
    : []))
  // Sweep for stretches with two or more takes heard; comp edges meet exactly, so skip slivers.
  const edges = segs.flatMap((sg): [number, number][] => [[sg.view.start, 1], [sg.view.start + sg.view.length, -1]]).sort((x, y) => x[0] - y[0] || x[1] - y[1])
  const clashes: { from: number; to: number; n: number }[] = []
  let n = 0, from = 0, most = 0
  for (const [t, d] of edges) {
    const before = n
    n += d
    if (before < 2 && n >= 2) { from = t; most = n }
    else if (n >= 2) most = Math.max(most, n)
    else if (before >= 2 && t - from > 0.02) clashes.push({ from, to: t, n: most })
  }
  return (
    <div className="relative shrink-0" style={{ width, ...laneStyle }} onPointerDown={onLanePointerDown}>
      {!segs.length && (
        <div className="sticky left-0 inline-block px-2 pt-2 text-[11px] text-text-muted pointer-events-none">Comp - what plays from the lanes in this folder</div>
      )}
      {segs.map((sg) => {
        const w = Math.max(1, sg.view.length * pps)
        const lt = loaded.get(sg.clip.takeId)
        return (
          <div
            key={sg.key}
            className="absolute top-1 bottom-1 overflow-hidden cursor-pointer"
            style={{ left: sg.view.start * pps, width: w, background: `color-mix(in srgb, ${sg.color} 22%, transparent)`, borderTop: `2px solid ${sg.color}` }}
            title={`${takesById.get(sg.clip.takeId)?.name ?? 'Missing take'} - click to select it`}
            onPointerDown={(e) => onClipDown(e, sg.clip.id)}
            onContextMenu={(e) => onMenu(sg.clip.takeId, e, sg.clip.id)}
          >
            {lt && Array.from({ length: Math.ceil(w / TILE_W) }, (_, i) => (
              <WaveTile key={i} peaks={sg.clip.reversed ? reversedPeaks(lt.peaks) : lt.peaks} clip={sg.view} pps={pps} x={i * TILE_W} width={Math.min(TILE_W, w - i * TILE_W)} color={sg.color} />
            ))}
            {selectedSet.has(sg.clip.id) && <div className="absolute inset-0 ring-2 ring-inset ring-white/80 pointer-events-none" />}
          </div>
        )
      })}
      {clashes.filter((c) => c.to > 0).map((c) => (
        <div
          key={c.from}
          className="absolute top-0 h-1.5 z-10 bg-amber-400/90"
          // A take can start before time 0; keep the band inside the lane, off the header.
          style={{ left: Math.max(0, c.from) * pps, width: (c.to - Math.max(0, c.from)) * pps }}
          title={`${c.n} takes play at once here - swipe one (K) or comp it (C)`}
        />
      ))}
    </div>
  )
})

const panLabel = (pan: number): string => (pan === 0 ? 'centre' : `${Math.round(Math.abs(pan) * 100)}% ${pan < 0 ? 'left' : 'right'}`)

/** Project-wide effect settings, shown in every lane's FX popover. */
interface SharedFx { bpm: number | null; echoNote: EchoNote; reverbSize: ReverbSize }

/** The lanes an open FX popover acts on, where it sits, and the button that opened it (if one did). */
interface FxTarget { ids: string[]; folderId?: string; anchor: HTMLElement | null; left: number; top: number }

/** Effects copied from a lane, for pasting onto others - kept across projects this session. */
let fxClipboard: { fx: FxCopy; from: string } | null = null

/** The FX button on a lane or folder header. */
function FxButton({ active, title, onOpen }: { active: boolean; title: string; onOpen: (anchor: HTMLElement) => void }): JSX.Element {
  return (
    <button
      className={`h-6 px-1.5 shrink-0 rounded-md text-[10px] font-bold transition-colors ${active ? 'bg-accent/80 text-white' : 'bg-[var(--surface-raised)] text-text-muted hover:text-text-primary'}`}
      title={title}
      onClick={(e) => onOpen(e.currentTarget)}
    >FX</button>
  )
}

/** The FX popover: the lanes' plug-ins and own chain, their sends, and the shared send
 *  settings. On several lanes each change goes to all of them; what's shown is the
 *  first lane's, with "mixed" where the others differ. */
function FxPopover({ target, lanes, folderName, shared, host, clipboard, onEdit, onShared, onCopy, onPaste, onClose }: {
  target: FxTarget; lanes: SmTrack[]; folderName?: string; shared: SharedFx; host: PluginHost | null
  clipboard: { fx: FxCopy; from: string } | null
  onEdit: (ids: string[], e: FxEdit, history: boolean) => void
  onShared: (patch: Partial<Pick<SmProject, 'echoNote' | 'reverbSize'>>) => void
  onCopy: (trackId: string) => void
  onPaste: (ids: string[]) => void
  onClose: () => void
}): JSX.Element | null {
  const popRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: PointerEvent): void => {
      const t = e.target as Node
      if (popRef.current?.contains(t) || target.anchor?.contains(t)) return
      onClose()
    }
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', esc) }
  }, [target, onClose])
  useEffect(() => { if (!lanes.length) onClose() }, [lanes.length, onClose])
  const lead = lanes[0]
  if (!lead) return null
  const ids = lanes.map((t) => t.id)
  const many = lanes.length > 1 ? ` (all ${lanes.length} lanes)` : ''
  const where = folderName ?? (lanes.length > 1 ? `${lanes.length} lanes` : lead.name)
  const edit = (e: FxEdit, history = true): void => onEdit(ids, e, history)
  const slider = (label: string, value: number, readout: string, set: (v: number) => void, title: string): JSX.Element => (
    <label className="flex items-center gap-2 text-xs text-text-secondary">
      <span className="w-14 shrink-0">{label}</span>
      <input
        type="range" min={0} max={1} step={0.02} value={value}
        onChange={(e) => set(Number(e.target.value))}
        onDoubleClick={() => set(0)}
        title={`${title}${many} - double-click to turn off`}
        className="flex-1 min-w-0 h-1 accent-[rgb(var(--accent-rgb))]"
      />
      <span className="w-12 text-right tabular-nums text-text-muted">{readout}</span>
    </label>
  )
  const seg = <T extends string>(options: readonly T[], value: T, set: (v: T) => void, label: (v: T) => string, disabled = false): JSX.Element => (
    <div className={`flex flex-1 rounded-md overflow-hidden border border-[var(--border)] ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      {options.map((o) => (
        <button
          key={o}
          className={`flex-1 h-6 text-[11px] transition-colors ${o === value ? 'bg-accent/80 text-white' : 'text-text-muted hover:text-text-primary hover:bg-[var(--surface-raised)]'}`}
          onClick={() => set(o)}
        >{label(o)}</button>
      ))}
    </div>
  )
  const heading = 'text-[10px] font-semibold uppercase tracking-wider text-text-muted'
  const small = 'h-6 px-2 rounded-md text-[11px] flex items-center gap-1 bg-[var(--surface-raised)] text-text-secondary hover:text-text-primary disabled:opacity-40'
  return createPortal(
    // Portal events still bubble through React to the header, which would select the lane.
    <div
      ref={popRef}
      className="fixed z-50 w-[260px] p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] shadow-xl space-y-2 overflow-y-auto"
      style={{ left: target.left, top: target.top, maxHeight: `calc(100vh - ${target.top + 8}px)` }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      {(lanes.length > 1 || folderName) && (
        <div className="-mt-0.5 pb-1 border-b border-[var(--border)]">
          <div className="text-xs font-semibold text-text-primary truncate">{folderName ? `${folderName} - every lane` : `${lanes.length} lanes`}</div>
          <div className="text-[10px] text-text-muted truncate" title={lanes.map((t) => t.name).join(', ')}>
            {lanes.length > 1 ? `Each change goes to all ${lanes.length}: ${lanes.map((t) => t.name).join(', ')}` : lead.name}
          </div>
        </div>
      )}
      {host && <PluginList host={host} lanes={lanes} where={where} many={many} heading={heading} onEdit={edit} />}
      <div className={`${heading} ${host ? 'pt-1' : ''}`}>Lane</div>
      {CHAIN_KEYS.map((k: ChainKey) => {
        const v = lead.chain?.[k] ?? 0
        const mixed = lanes.some((t) => (t.chain?.[k] ?? 0) !== v)
        return <div key={k}>{slider(CHAIN_LABELS[k], v, mixed ? 'mixed' : chainReadout(k, v), (x) => edit({ kind: 'chain', key: k, value: x }, false), CHAIN_TITLES[k])}</div>
      })}
      <div className={`${heading} pt-1`}>Sends</div>
      {FX_KEYS.map((k: FxKey) => {
        const v = lead.fx?.[k] ?? 0
        const mixed = lanes.some((t) => (t.fx?.[k] ?? 0) !== v)
        return <div key={k}>{slider(FX_LABELS[k], v, mixed ? 'mixed' : v > 0 ? `${Math.round(v * 100)}%` : 'off', (x) => edit({ kind: 'send', key: k, value: x }, false), `${FX_LABELS[k]} send`)}</div>
      })}
      <div className={`${heading} pt-1`}>Shared by every lane</div>
      <div className="flex items-center gap-2 text-xs text-text-secondary" title={shared.bpm ? `Echo repeats at ${Math.round(echoSeconds(shared) * 1000)} ms - ${shared.echoNote} at ${shared.bpm.toFixed(1)} BPM` : 'Set the tempo to time the echo to the beat - it repeats every 375 ms until then'}>
        <span className="w-14 shrink-0">Echo</span>
        {seg(Object.keys(ECHO_NOTES) as EchoNote[], shared.echoNote, (v) => onShared({ echoNote: v }), (v) => v, !shared.bpm)}
      </div>
      <div className="flex items-center gap-2 text-xs text-text-secondary" title="Reverb size">
        <span className="w-14 shrink-0">Reverb</span>
        {seg(Object.keys(REVERB_SIZES) as ReverbSize[], shared.reverbSize, (v) => onShared({ reverbSize: v }), (v) => v[0].toUpperCase() + v.slice(1))}
      </div>
      <div className="flex items-center gap-1 pt-1 border-t border-[var(--border)]">
        {lanes.length === 1 && (
          <button className={small} disabled={!hasEffects(lead)} onClick={() => onCopy(lead.id)} title="Copy this lane's effects and plug-ins, to paste onto other lanes or a folder">
            <Copy size={11} /> Copy
          </button>
        )}
        {clipboard && (
          <button className={small} onClick={() => onPaste(ids)} title={`Replace ${lanes.length > 1 ? 'these lanes\' effects' : 'this lane\'s effects'} with the ones copied from ${clipboard.from}`}>
            <ClipboardPaste size={11} /> Paste from {clipboard.from}
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** What the FX popover needs from the view to list, add and open VST3 plug-ins. */
interface PluginHost {
  scan: VstScan | null
  scanning: boolean
  /** Plug-in windows open now, by pluginEditorKey. */
  open: ReadonlySet<string>
  /** Opens a plug-in's window; `lanes` share it, the first one's settings show. */
  edit: (lanes: string[], pl: SmPlugin, where: string) => void
  /** Same, but as plain sliders for the plug-in's parameters rather than its own window. */
  controls: (lanes: string[], pl: SmPlugin, where: string) => void
  /** Settings → Plug-ins: folders, hidden plug-ins, the ones that failed. */
  manage: () => void
}

/** The lanes' VST3 plug-ins, in order (linked ones as one row), and the picker for adding one. */
function PluginList({ host, lanes, where, many, heading, onEdit }: {
  host: PluginHost; lanes: SmTrack[]; where: string; many: string; heading: string
  onEdit: (e: FxEdit) => void
}): JSX.Element {
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const { scan, scanning } = host
  useEffect(() => { if (adding && !scan && !scanning) void vstPlugins.load() }, [adding, scan, scanning])
  const rows: PluginRow[] = pluginRows(lanes)
  const q = query.trim().toLowerCase()
  const shown = (scan?.plugins ?? []).filter((info) => !info.hidden)
  const found = shown.filter((info) => !q || `${info.name} ${info.vendor}`.toLowerCase().includes(q))
  const hiddenCount = (scan?.plugins.length ?? 0) - shown.length
  const icon = 'w-5 h-5 shrink-0 rounded flex items-center justify-center transition-colors'
  const small = 'h-6 px-2 rounded-md text-[11px] flex items-center gap-1 bg-[var(--surface-raised)] text-text-secondary hover:text-text-primary disabled:opacity-40'
  return (
    <>
      <div className="flex items-center justify-between">
        <div className={heading}>Plug-ins</div>
        <button className={small} onClick={() => setAdding((a) => !a)} title={`Add a VST3 plug-in${many}`}>
          {adding ? <X size={12} /> : <Plus size={12} />} {adding ? 'Done' : 'Add'}
        </button>
      </div>
      {!rows.length && !adding && (
        <div className="text-[11px] leading-snug text-text-muted">
          Your VST3 effects - Auto-Tune, EQs, anything installed. In the Windows app, changes are heard live during playback.
        </div>
      )}
      {rows.map(({ plugin: pl, lanes: on }, i) => {
        const open = on.some((id) => host.open.has(pluginEditorKey(id, pl.id)))
        const partial = on.length < lanes.length
        return (
          <div key={pl.id} className="flex items-center gap-1 text-xs">
            <button
              className={`${icon} ${pl.bypass ? 'text-text-muted hover:text-text-primary' : 'text-accent'}`}
              title={pl.bypass ? `Turn ${pl.name} back on${many}` : `Bypass ${pl.name}${many}`}
              onClick={() => onEdit({ kind: 'bypassPlugin', id: pl.id, bypass: !pl.bypass })}
            >
              <Power size={12} />
            </button>
            <button
              className={`flex-1 min-w-0 truncate text-left rounded px-1 h-6 hover:bg-[var(--surface-raised)] ${pl.bypass ? 'text-text-muted line-through' : 'text-text-primary'}`}
              title={`${open ? 'Bring up' : 'Open'} ${pl.name}'s window${pl.vendor ? ` (${pl.vendor})` : ''}${on.length > 1 ? ` - its settings go to all ${on.length} lanes that have it` : ''}`}
              onClick={() => host.edit(on, pl, on.length === lanes.length ? where : on.length > 1 ? `${on.length} lanes` : lanes.find((t) => t.id === on[0])?.name ?? where)}
            >
              {pl.name}{open && <span className="ml-1 text-accent">●</span>}
            </button>
            <button
              className={`${icon} text-text-muted hover:text-text-primary`}
              title={`Simple controls for ${pl.name} - plain sliders for every parameter`}
              onClick={() => host.controls(on, pl, on.length === lanes.length ? where : on.length > 1 ? `${on.length} lanes` : lanes.find((t) => t.id === on[0])?.name ?? where)}
            >
              <SlidersHorizontal size={12} />
            </button>
            {partial && (
              <button
                className="h-5 px-1 shrink-0 rounded text-[10px] tabular-nums text-text-muted hover:text-accent hover:bg-[var(--surface-raised)]"
                title={`On ${on.length} of ${lanes.length} lanes (${on.map((id) => lanes.find((t) => t.id === id)?.name).join(', ')}) - click to add it, with the same settings, to the rest`}
                onClick={() => onEdit({ kind: 'spreadPlugin', id: pl.id })}
              >
                {on.length}/{lanes.length}
              </button>
            )}
            {i > 0 && (
              <button
                className={`${icon} text-text-muted hover:text-text-primary`}
                title="Move earlier in the chain"
                onClick={() => onEdit({ kind: 'movePlugin', id: pl.id })}
              >
                <ArrowUp size={12} />
              </button>
            )}
            <button
              className={`${icon} text-text-muted hover:text-red-400`}
              title={`Remove ${pl.name}${on.length > 1 ? ` from all ${on.length} lanes that have it` : ''}`}
              onClick={() => onEdit({ kind: 'removePlugin', id: pl.id })}
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
      {adding && (
        <div className="rounded-md border border-[var(--border)] p-1.5 space-y-1.5">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search plug-ins"
            className="w-full h-6 px-2 rounded bg-[var(--surface-raised)] text-xs text-text-primary outline-none"
          />
          <div className="max-h-48 overflow-y-auto">
            {!scan ? (
              <div className="px-1 py-2 text-[11px] text-text-muted flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Looking for plug-ins…</div>
            ) : !found.length ? (
              <div className="px-1 py-2 text-[11px] text-text-muted">{shown.length ? 'No match' : hiddenCount ? 'Every plug-in is hidden - bring some back in Manage plug-ins.' : 'No VST3 effects found - install some, or add the folder they\'re in.'}</div>
            ) : found.map((info) => (
              <button
                key={`${info.path}|${info.cid}`}
                className="w-full flex items-baseline gap-1.5 px-1 py-1 rounded text-left text-xs hover:bg-[var(--surface-raised)]"
                title={`${info.name}${info.version ? ` ${info.version}` : ''}${info.sub ? ` - ${info.sub.replace(/\|/g, ', ')}` : ''}\n${info.path}`}
                onClick={() => {
                  // One id on every lane links them.
                  const pl: SmPlugin = { id: uid(), path: info.path, cid: info.cid, name: info.name, ...(info.vendor ? { vendor: info.vendor } : {}) }
                  onEdit({ kind: 'addPlugin', plugin: pl })
                  setAdding(false)
                  setQuery('')
                  host.edit(lanes.map((t) => t.id), pl, where)
                }}
              >
                <span className="truncate text-text-primary">{info.name}</span>
                <span className="truncate text-[10px] text-text-muted">{info.vendor}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button className={small} disabled={scanning} onClick={() => void vstPlugins.rescan()} title="Look through the plug-in folders again">
              <RefreshCw size={11} className={scanning ? 'animate-spin' : ''} /> Rescan
            </button>
            <button className={small} onClick={host.manage} title="Plug-in folders, hidden plug-ins and the ones that wouldn't load - in Settings">
              <Settings2 size={11} /> Manage…
            </button>
          </div>
          {(!!hiddenCount || !!scan?.failed.length) && (
            <div className="text-[10px] text-text-muted">
              {[hiddenCount ? `${hiddenCount} hidden` : '', scan?.failed.length ? `${scan.failed.length} couldn't be loaded` : ''].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
      )}
    </>
  )
}

const CHAIN_TITLES: Record<ChainKey, string> = {
  lowCut: 'Low cut - clears rumble and mic thumps below the voice',
  comp: 'Compressor - evens out loud and quiet words',
  presence: 'Presence - brings the voice forward (3.5 kHz)',
  air: 'Air - adds top-end sheen (10 kHz shelf)',
  lofi: 'Lo-fi - telephone band-pass with grit',
}

const TrackHeader = memo(function TrackHeader({ track, nested = false, color, selected, groupSize, onSelect, onFx, onChange, onRemove, onMenu }: {
  track: SmTrack; nested?: boolean; color: string; selected: boolean; groupSize: number
  onSelect: (id: string, e: React.PointerEvent) => void
  /** Opens the FX popover - on every selected lane when this one is among them. */
  onFx: (id: string, anchor: HTMLElement) => void
  onChange: (id: string, patch: Partial<SmTrack>, history?: boolean) => void
  onRemove: (id: string) => void
  onMenu: (id: string, e: React.MouseEvent) => void
}): JSX.Element {
  const toggleCls = (on: boolean, onCls: string): string =>
    `w-6 h-6 rounded-md text-[11px] font-bold transition-colors ${on ? onCls : 'bg-[var(--surface-raised)] text-text-muted hover:text-text-primary'}`
  const many = groupSize > 1 ? ` (all ${groupSize} selected tracks)` : ''
  return (
    <div
      className="group sticky left-0 z-10 shrink-0 flex bg-[var(--surface)] border-r border-[var(--border)] cursor-grab"
      style={{ width: HEADER_W }}
      title="Click to select · Ctrl+click to add · Shift+click for a range · drag to reorder (Alt+↑/↓) · right-click for more"
      onPointerDown={(e) => {
        const el = e.target as HTMLElement
        // Buttons and the volume slider act on their own; the name selects too, unless it's already being edited.
        if (e.button !== 0 || el.closest('button') || (el instanceof HTMLInputElement && (el.type === 'range' || document.activeElement === el))) return
        onSelect(track.id, e)
      }}
      onContextMenu={(e) => onMenu(track.id, e)}
    >
      {selected && <div className="absolute inset-0 pointer-events-none bg-accent/10 ring-1 ring-inset ring-accent/40" />}
      {nested && <div className="w-3 shrink-0 bg-[var(--surface-raised)] border-r border-[var(--border)]" />}
      <div className="w-1 shrink-0" style={{ background: color }} />
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-1.5 px-2">
        <div className="flex items-center gap-1">
          <input
            data-track-name={track.id}
            value={track.name}
            onChange={(e) => onChange(track.id, { name: e.target.value }, false)}
            className="flex-1 min-w-0 h-6 px-1 rounded bg-transparent hover:bg-[var(--surface-raised)] focus:bg-[var(--surface-raised)] text-[13px] font-medium text-text-primary outline-none"
          />
          <button className={toggleCls(track.muted, 'bg-amber-500/80 text-black')} title={`Mute${many}`} onClick={() => onChange(track.id, track.muted ? { muted: false } : { muted: true, solo: false })}>M</button>
          <button className={toggleCls(track.solo, 'bg-emerald-500/80 text-black')} title={`Solo${many}`} onClick={() => onChange(track.id, track.solo ? { solo: false } : { solo: true, muted: false })}>S</button>
          <FxButton active={chainActive(track.chain) || FX_KEYS.some((k) => (track.fx?.[k] ?? 0) > 0) || !!track.plugins?.some((pl) => !pl.bypass)} title={`Effects - plug-ins, low cut, compressor, EQ, lo-fi, reverb, echo, chorus${many}`} onOpen={(el) => onFx(track.id, el)} />
          <button className="w-6 h-6 rounded-md flex items-center justify-center text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition" title={groupSize > 1 ? `Delete ${groupSize} tracks` : 'Delete track'} onClick={() => onRemove(track.id)}>
            <Trash2 size={13} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="range" min={0} max={1.5} step={0.01} value={track.gain}
            onChange={(e) => onChange(track.id, { gain: Number(e.target.value) }, false)}
            title={`Volume ${dbOf(track.gain).toFixed(1)} dB${many}`}
            className="flex-1 min-w-0 h-1 accent-[rgb(var(--accent-rgb))]"
          />
          <input
            type="range" min={-1} max={1} step={0.02} value={track.pan ?? 0}
            onChange={(e) => { const v = Number(e.target.value); onChange(track.id, { pan: Math.abs(v) < 0.04 ? 0 : v }, false) }}
            onDoubleClick={() => onChange(track.id, { pan: 0 })}
            title={`Pan ${panLabel(track.pan ?? 0)}${many} - double-click to centre`}
            className="w-12 h-1 accent-[rgb(var(--accent-rgb))]"
          />
        </div>
      </div>
    </div>
  )
})

const ClipView = memo(function ClipView({ clip, take, zipPath, loaded, failed, pps, color, selected, compTool, swipe, fx, onPointerDown, onMenu }: {
  clip: SmClip; take: Take | undefined; zipPath: string; loaded: LoadedTake | undefined; failed: boolean; pps: number; color: string; selected: boolean
  compTool: boolean
  /** The lane's plug-in chain, if it has one on. */
  fx: LaneFx | null
  /** The stretch being swiped across this clip right now, timeline seconds. */
  swipe?: { from: number; to: number }
  onPointerDown: (e: React.PointerEvent, clipId: string, mode: DragMode) => void
  onMenu: (takeId: string, e: React.MouseEvent, clipId?: string) => void
}): JSX.Element {
  const progress = useLoadProgress(takeKey(zipPath, clip.takeId))
  useSyncExternalStore(subscribeStretches, stretchVersion)
  const audio = loaded && !clip.muted ? clipAudioState(clip, loaded.buffer, fx) : null
  const audioNote = audio?.stage === 'stretching' ? ' · stretching…' : audio?.stage === 'plugins' ? ' · plug-ins…' : audio?.stage === 'failed' ? ` · plug-in failed (${audio.error}) - playing dry` : ''
  const w = Math.max(2, clip.length * pps)
  const left = clip.start * pps
  const tiles = Math.ceil(w / TILE_W)
  const handle = 'absolute top-0 bottom-0 w-2 cursor-ew-resize z-10'
  const fadeHandle = 'absolute top-0 w-3 h-3 rounded-sm bg-white/90 border border-black/30 cursor-ew-resize z-20 opacity-0 group-hover:opacity-100'
  const fadeInW = clip.fadeIn * pps, fadeOutW = clip.fadeOut * pps
  const silences = clip.muted ? [] : silentSpans(clip)
  return (
    <div
      className={`group absolute top-1 bottom-1 rounded-md overflow-hidden ${compTool ? 'cursor-text' : 'cursor-grab active:cursor-grabbing'}`}
      style={{ left, width: w, opacity: clip.muted ? 0.35 : 1, background: `color-mix(in srgb, ${color} 22%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 70%, transparent)` }}
      onPointerDown={(e) => onPointerDown(e, clip.id, 'move')}
      onContextMenu={(e) => onMenu(clip.takeId, e, clip.id)}
    >
      {loaded && Array.from({ length: tiles }, (_, i) => (
        <WaveTile key={i} peaks={clip.reversed ? reversedPeaks(loaded.peaks) : loaded.peaks} clip={clip} pps={pps} x={i * TILE_W} width={Math.min(TILE_W, w - i * TILE_W)} color={color} />
      ))}
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-text-muted">
          {failed ? 'Could not load' : progress !== undefined ? `Loading ${Math.round(progress * 100)}%` : 'Loading…'}
        </div>
      )}
      {silences.map(([a, b]) => (
        <div
          key={a}
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{ left: a * pps, width: (b - a) * pps, background: 'repeating-linear-gradient(135deg, rgba(0,0,0,0.55) 0 4px, rgba(0,0,0,0.4) 4px 8px)' }}
        />
      ))}
      {swipe && swipe.to > swipe.from && (
        <div
          className="absolute top-0 bottom-0 pointer-events-none border-x-2"
          style={{ left: (swipe.from - clip.start) * pps, width: (swipe.to - swipe.from) * pps, background: 'rgba(255,255,255,0.18)', borderColor: color }}
        />
      )}
      {fadeInW > 0 && <svg className="absolute left-0 top-0 h-full pointer-events-none" width={fadeInW} preserveAspectRatio="none" viewBox="0 0 100 100"><path d="M0 100 L100 0 L0 0 Z" fill="rgba(0,0,0,0.35)" /></svg>}
      {fadeOutW > 0 && <svg className="absolute right-0 top-0 h-full pointer-events-none" width={fadeOutW} preserveAspectRatio="none" viewBox="0 0 100 100"><path d="M0 0 L100 100 L100 0 Z" fill="rgba(0,0,0,0.35)" /></svg>}
      <div className="absolute left-1.5 top-0.5 right-1.5 text-[11px] font-medium truncate pointer-events-none" style={{ color, textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>
        {clip.muted ? '(muted) ' : ''}{take?.name ?? 'Missing take'}{clip.reversed ? ' · reversed' : ''}{retimeLabel(clip) ? ` · ${retimeLabel(clip)}` : ''}{audioNote}{clip.gain !== 1 ? ` · ${dbOf(clip.gain).toFixed(1)} dB` : ''}
      </div>
      {selected && <div className="absolute inset-0 rounded-[5px] ring-2 ring-inset ring-white/80 pointer-events-none z-10" />}
      <div className={`${handle} left-0`} onPointerDown={(e) => onPointerDown(e, clip.id, 'trimL')} />
      <div className={`${handle} right-0`} onPointerDown={(e) => onPointerDown(e, clip.id, 'trimR')} />
      <div className={fadeHandle} style={{ left: Math.max(2, fadeInW - 6) }} title="Fade in" onPointerDown={(e) => onPointerDown(e, clip.id, 'fadeIn')} />
      <div className={fadeHandle} style={{ right: Math.max(2, fadeOutW - 6) }} title="Fade out" onPointerDown={(e) => onPointerDown(e, clip.id, 'fadeOut')} />
    </div>
  )
})

const WaveTile = memo(function WaveTile({ peaks, clip, pps, x, width, color }: {
  peaks: Float32Array; clip: SmClip; pps: number; x: number; width: number; color: string
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const h = LANE_H - 10
  const speed = clipSpeed(clip)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.max(1, Math.round(width * dpr))
    c.height = Math.round(h * dpr)
    const g = c.getContext('2d')
    if (!g) return
    g.scale(dpr, dpr)
    g.clearRect(0, 0, width, h)
    g.fillStyle = color
    const mid = h / 2 + 6
    const amp = h / 2 - 8
    for (let px = 0; px < width; px++) {
      const t0 = clip.offset + ((x + px) / pps) * speed
      const i0 = Math.floor(t0 * PEAKS_PER_SEC)
      const i1 = Math.max(i0 + 1, Math.floor((t0 + speed / pps) * PEAKS_PER_SEC))
      let m = 0
      for (let i = i0; i < i1 && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i]
      const y = Math.max(0.5, Math.min(1, m) * amp)
      g.fillRect(px, mid - y, 1, y * 2)
    }
  }, [peaks, clip.offset, speed, pps, x, width, color, h])
  return <canvas ref={ref} className="absolute top-0 pointer-events-none" style={{ left: x, width, height: h, opacity: 0.85 }} />
})

function Ruler({ width, pps, bpm, gridOffset, loop, snap, onSeek, onLoop }: {
  width: number; pps: number; bpm: number | null; gridOffset: number
  loop: { start: number; end: number; on: boolean } | null
  snap: (t: number, alt: boolean) => number
  onSeek: (t: number) => void
  onLoop: (r: LoopRange) => void
}): JSX.Element {
  // A click seeks; a drag sets the loop range (snapped, Alt to ignore the grid).
  const [draft, setDraft] = useState<LoopRange | null>(null)
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    const left = e.currentTarget.getBoundingClientRect().left
    const x0 = e.clientX
    const t0 = (x0 - left) / pps
    let range: LoopRange | null = null
    const move = (ev: PointerEvent): void => {
      if (!range && Math.abs(ev.clientX - x0) < 8) return
      const a = snap(t0, ev.altKey), b = snap(Math.max(0, (ev.clientX - left) / pps), ev.altKey)
      range = { start: Math.max(0, Math.min(a, b)), end: Math.max(a, b) }
      setDraft(range)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDraft(null)
      // A drag that snaps to (almost) nothing is still a click.
      if (range && range.end - range.start > 0.05) onLoop(range)
      else onSeek(t0)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const band = draft ?? loop
  const marks: JSX.Element[] = []
  if (bpm) {
    const bar = (60 / bpm) * 4
    const stride = Math.max(1, Math.pow(2, Math.ceil(Math.log2(56 / (bar * pps)))))
    const first = Math.ceil(-gridOffset / bar)
    for (let n = first; ; n += stride) {
      const t = gridOffset + n * bar
      const x = t * pps
      if (x > width) break
      if (x < 0) continue
      marks.push(
        <div key={n} className="absolute top-0 bottom-0 border-l border-[var(--border)]" style={{ left: x }}>
          <span className="absolute left-1 top-1 text-[10px] text-text-muted tabular-nums">{n + 1}</span>
        </div>,
      )
    }
  } else {
    const steps = [1, 2, 5, 10, 15, 30, 60]
    const step = steps.find((s) => s * pps >= 70) ?? 120
    for (let t = 0; t * pps <= width; t += step) {
      marks.push(
        <div key={t} className="absolute top-0 bottom-0 border-l border-[var(--border)]" style={{ left: t * pps }}>
          <span className="absolute left-1 top-1 text-[10px] text-text-muted tabular-nums">{formatTime(t).replace(/\.\d$/, '')}</span>
        </div>,
      )
    }
  }
  return (
    <div
      className="relative shrink-0 bg-[var(--surface)] border-b border-[var(--border)] cursor-text overflow-hidden"
      style={{ width }}
      onPointerDown={onPointerDown}
      title="Click to move the playhead, drag to set the loop"
    >
      {band && (
        <div
          className={`absolute bottom-0 h-2 rounded-sm ${draft || loop?.on ? 'bg-accent/70' : 'bg-text-muted/30'}`}
          style={{ left: band.start * pps, width: (band.end - band.start) * pps }}
        />
      )}
      {marks}
    </div>
  )
}

/** Moves on its own rAF loop so the editor doesn't re-render 60 times a second. */
function Playhead({ engine, pps, follow, scrollRef, onScrub }: {
  engine: SessionEngine; pps: number; follow: boolean; scrollRef: React.RefObject<HTMLDivElement>
  onScrub: (t: number, phase: 'start' | 'move' | 'end') => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  // Grab the head or the line and drag it to move the playhead.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const host = ref.current?.parentElement
    if (!host) return
    const at = (clientX: number): number => Math.max(0, (clientX - host.getBoundingClientRect().left - HEADER_W) / pps)
    onScrub(at(e.clientX), 'start')
    const move = (ev: PointerEvent): void => onScrub(at(ev.clientX), 'move')
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      onScrub(at(ev.clientX), 'end')
    }
    document.body.style.cursor = 'ew-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  useEffect(() => {
    let raf = 0
    // Manual scrolling (scrollbar drag, wheel) suspends follow until the playhead is back in view.
    let manual = false
    const el0 = scrollRef.current
    // Any scroll we didn't cause ourselves (scrollbar drag, wheel, trackpad) is manual; the scrollbar
    // doesn't reliably fire pointer events, so compare against the position we last set.
    let lastSet = el0?.scrollLeft ?? 0
    const onScroll = (): void => { if (el0 && Math.abs(el0.scrollLeft - lastSet) > 1) manual = true }
    el0?.addEventListener('scroll', onScroll, { passive: true })
    let lastX = NaN, lastCut = NaN
    const tick = (): void => {
      const x = HEADER_W + engine.position() * pps
      const el = scrollRef.current
      if (ref.current) {
        // Slide under the sticky track-header column instead of drawing over it.
        const cut = Math.max((el?.scrollLeft ?? 0) + HEADER_W - x, -20)
        if (x !== lastX) { ref.current.style.transform = `translateX(${x}px)`; lastX = x }
        if (cut !== lastCut) { ref.current.style.clipPath = `inset(0 -20px 0 ${cut}px)`; lastCut = cut }
      }
      if (follow && el && engine.playing) {
        const visL = el.scrollLeft + HEADER_W, visR = el.scrollLeft + el.clientWidth - 40
        const inView = x <= visR && x >= visL
        if (inView) manual = false
        else if (!manual) { el.scrollLeft = x - HEADER_W - 40; lastSet = el.scrollLeft }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      el0?.removeEventListener('scroll', onScroll)
    }
  }, [engine, pps, follow, scrollRef])
  return (
    <div ref={ref} className="absolute top-0 bottom-0 left-0 w-px bg-accent z-30 pointer-events-none">
      {/* Hit areas: the whole ruler height around the head, and a thin strip along the line. */}
      <div className="absolute -left-[7px] top-0 w-[15px] pointer-events-auto cursor-ew-resize" style={{ height: RULER_H }} onPointerDown={onPointerDown} title="Drag to move the playhead" />
      <div className="absolute -left-[2px] bottom-0 w-[5px] pointer-events-auto cursor-ew-resize" style={{ top: RULER_H }} onPointerDown={onPointerDown} />
      <div className="absolute -left-[5px] top-0 w-[11px] h-[11px] bg-accent pointer-events-none" style={{ clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }} />
    </div>
  )
}

function TimeReadout({ engine, bpm, gridOffset }: { engine: SessionEngine; bpm: number | null; gridOffset: number }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      const t = engine.position()
      let text = formatTime(t)
      if (bpm) {
        const beats = (t - gridOffset) / (60 / bpm)
        if (beats >= 0) text = `${Math.floor(beats / 4) + 1}.${Math.floor(beats % 4) + 1}  ·  ${text}`
      }
      if (ref.current && ref.current.textContent !== text) ref.current.textContent = text
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [engine, bpm, gridOffset])
  return <div ref={ref} className="min-w-[128px] px-2 text-sm font-mono tabular-nums text-text-primary whitespace-pre" />
}

type RetimePatch = { speed?: number; pitch?: number; keepPitch?: boolean }

/** "80% · +2 st" for a clip at another speed or pitch; empty when it plays as recorded. */
function retimeLabel(c: SmClip): string {
  const parts: string[] = []
  if (clipSpeed(c) !== 1) parts.push(`${Math.round(clipSpeed(c) * 1000) / 10}%${c.keepPitch ? ' (pitch held)' : ''}`)
  if (c.pitch) parts.push(`${c.pitch > 0 ? '+' : ''}${Math.round(c.pitch * 100) / 100} st`)
  return parts.join(' · ')
}

/** Exact speed and pitch for the clip menu: type the numbers, Enter or Apply. */
function RetimePanel({ clip, onApply }: { clip: SmClip; onApply: (patch: RetimePatch) => void }): JSX.Element {
  const [speed, setSpeed] = useState(String(Math.round(clipSpeed(clip) * 1000) / 10))
  const [pitch, setPitch] = useState(String(clip.pitch ?? 0))
  const [hold, setHold] = useState(!!clip.keepPitch)
  const sp = Number(speed), pt = Number(pitch)
  const valid = speed.trim() !== '' && pitch.trim() !== '' && Number.isFinite(sp) && Number.isFinite(pt)
    && sp >= MIN_SPEED * 100 && sp <= MAX_SPEED * 100 && Math.abs(pt) <= MAX_PITCH
  const apply = (): void => { if (valid) onApply({ speed: sp / 100, pitch: pt, keepPitch: hold }) }
  const onKey = (e: React.KeyboardEvent): void => { if (e.key === 'Enter') { e.preventDefault(); apply() } }
  return (
    <div className="w-[220px] p-3 space-y-2.5">
      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <span className="w-12 shrink-0">Speed</span>
        <input autoFocus type="number" step="any" min={MIN_SPEED * 100} max={MAX_SPEED * 100} value={speed} onChange={(e) => setSpeed(e.target.value)} onKeyDown={onKey} className={`${input} h-7 flex-1 min-w-0 tabular-nums`} />
        <span className="w-5 text-text-muted">%</span>
      </label>
      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <span className="w-12 shrink-0">Pitch</span>
        <input type="number" step="any" min={-MAX_PITCH} max={MAX_PITCH} value={pitch} onChange={(e) => setPitch(e.target.value)} onKeyDown={onKey} className={`${input} h-7 flex-1 min-w-0 tabular-nums`} />
        <span className="w-5 text-text-muted">st</span>
      </label>
      <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer" title="Off: pitch follows the speed, like tape (sped up / slowed). On: the speed changes, the pitch doesn't.">
        <input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} className="accent-[rgb(var(--accent-rgb))]" />
        Hold pitch when the speed changes
      </label>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[11px] text-text-muted">{valid ? '' : `Speed ${MIN_SPEED * 100}-${MAX_SPEED * 100}%, pitch ±${MAX_PITCH}`}</span>
        <button className={`${btn} h-7 ${btnOn}`} disabled={!valid} onClick={apply}>Apply</button>
      </div>
    </div>
  )
}

/** A number field that applies once typing or the arrows pause (or on Enter / leaving it).
 *  Each new speed or pitch can mean re-stretching a whole take, so not every keystroke. */
function CommitNumber({ value, min, max, step, onCommit, className }: {
  value: number; min: number; max: number; step: number | 'any'; onCommit: (v: number) => void; className: string
}): JSX.Element {
  const [text, setText] = useState(String(value))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { setText(String(value)) }, [value])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const apply = (t: string): void => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const v = Number(t)
    if (t.trim() === '' || !Number.isFinite(v)) { setText(String(value)); return }
    const c = clamp(v, min, max)
    if (c !== value) onCommit(c)
    else setText(String(value))
  }
  return (
    <input
      type="number" min={min} max={max} step={step} value={text}
      onChange={(e) => {
        const t = e.target.value
        setText(t)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => apply(t), 600)
      }}
      onBlur={(e) => apply(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') apply((e.target as HTMLInputElement).value)
        else if (e.key === 'Escape') { if (timer.current) clearTimeout(timer.current); setText(String(value)) }
      }}
      className={className}
    />
  )
}

function ClipInspector({ count, clip, take, originalName, renaming, setRenaming, alternates, alternateIndex, onCycle, onComp, onToggleMute, onReverse, onRetime, onLoop, onChange, onRename, onSplit, onDuplicate, onDelete, onLocate }: {
  clip: SmClip; take: Take | undefined; originalName: string | undefined
  renaming: boolean; setRenaming: (on: boolean) => void
  onRename: (takeId: string, name: string) => void
  alternates: number; alternateIndex: number
  onCycle: (dir: 1 | -1) => void; onComp: () => void; onToggleMute: () => void; onReverse: () => void; onRetime: (patch: RetimePatch) => void; onLoop: () => void
  count: number
  onChange: (patch: Partial<SmClip>, history: boolean) => void
  onSplit: () => void; onDuplicate: () => void; onDelete: () => void; onLocate: () => void
}): JSX.Element {
  const num = (label: string, value: number, key: 'fadeIn' | 'fadeOut', max: number): JSX.Element => (
    <label className="flex items-center gap-1.5 text-xs text-text-muted">
      {label}
      <input
        type="number" min={0} max={max} step={0.05} value={Number(value.toFixed(2))}
        onChange={(e) => onChange({ [key]: clamp(Number(e.target.value) || 0, 0, max) }, false)}
        className={`${input} w-20 h-7 tabular-nums`}
      />
    </label>
  )
  return (
    <div className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 border-t border-[var(--border)] bg-[var(--surface-raised)]">
      <div className="group/name min-w-0 flex items-center gap-1">
        {renaming && take
          ? <div className="w-[240px]"><RenameInput value={take.name} placeholder={originalName} onDone={(name) => { setRenaming(false); if (name != null) onRename(take.id, name) }} /></div>
          : <button className="min-w-0 text-left" onClick={onLocate} title={`Jump to clip${take && originalName && take.name !== originalName ? `
File: ${originalName}` : ''}`}>
              <div className="text-sm text-text-primary truncate max-w-[240px]">{take?.name ?? 'Missing take'}{count > 1 ? ` + ${count - 1} more` : ''}</div>
              <div className="text-[11px] text-text-muted tabular-nums">{formatTime(clip.start)} → {formatTime(clip.start + clip.length)} · {clip.length.toFixed(2)}s</div>
            </button>}
        {take && !renaming && (
          <button className="w-6 h-6 shrink-0 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-overlay opacity-0 group-hover/name:opacity-100 transition" title="Rename take" onClick={() => setRenaming(true)}>
            <Pencil size={12} />
          </button>
        )}
      </div>
      <label className="flex items-center gap-2 text-xs text-text-muted">
        Gain
        <input
          type="range" min={-24} max={12} step={0.5} value={Math.max(-24, dbOf(clip.gain))}
          onChange={(e) => onChange({ gain: gainOf(Number(e.target.value)) }, false)}
          className="w-32 accent-[rgb(var(--accent-rgb))]"
        />
        <span className="w-14 tabular-nums text-text-secondary">{dbOf(clip.gain).toFixed(1)} dB</span>
      </label>
      {alternates > 1 && (
        <div className="flex items-center gap-1 text-xs text-text-muted" title="Other takes over the same stretch: [ and ] switch, and the one you land on is the one heard">
          <button className={`${btn} h-7 px-1.5`} onClick={() => onCycle(-1)}><ChevronLeft size={15} /></button>
          <span className="tabular-nums text-text-secondary">Take {alternateIndex + 1}/{alternates}</span>
          <button className={`${btn} h-7 px-1.5`} onClick={() => onCycle(1)}><ChevronRight size={15} /></button>
          <button className={`${btn} h-7`} onClick={onComp} title={`Hear only this take here - mutes the other ${alternates - 1} (C)`}>Comp</button>
        </div>
      )}
      <button className={`${btn} h-7 ${clip.muted ? btnOn : ''}`} onClick={onToggleMute} title="Mute this clip (M)">
        <VolumeX size={14} /> {clip.muted ? 'Muted' : 'Mute'}
      </button>
      <button className={`${btn} h-7 ${clip.reversed ? btnOn : ''}`} onClick={onReverse} title={clip.reversed ? 'Playing backwards - click to play forwards' : 'Play this clip backwards'}>
        <Rewind size={14} /> {clip.reversed ? 'Reversed' : 'Reverse'}
      </button>
      <label className="flex items-center gap-1.5 text-xs text-text-muted" title="Playback speed - the clip grows or shrinks on the timeline">
        Speed
        <CommitNumber value={Math.round(clipSpeed(clip) * 1000) / 10} min={MIN_SPEED * 100} max={MAX_SPEED * 100} step="any" onCommit={(v) => onRetime({ speed: v / 100 })} className={`${input} w-[72px] h-7 tabular-nums`} />
        %
      </label>
      <button
        className={`${btn} h-7 ${clip.keepPitch ? btnOn : ''}`}
        disabled={clipSpeed(clip) === 1}
        onClick={() => onRetime({ keepPitch: !clip.keepPitch })}
        title={clip.keepPitch ? 'Pitch held while the speed changes - click to let it follow, like tape' : 'Pitch follows the speed, like tape (sped up / slowed) - click to hold it'}
      >
        {clip.keepPitch ? 'Pitch held' : 'Hold pitch'}
      </button>
      <label className="flex items-center gap-1.5 text-xs text-text-muted" title="Pitch shift in semitones, without changing the speed">
        Pitch
        <CommitNumber value={clip.pitch ?? 0} min={-MAX_PITCH} max={MAX_PITCH} step="any" onCommit={(v) => onRetime({ pitch: v })} className={`${input} w-16 h-7 tabular-nums`} />
        st
      </label>
      {num('Fade in', clip.fadeIn, 'fadeIn', clip.length - clip.fadeOut)}
      {num('Fade out', clip.fadeOut, 'fadeOut', clip.length - clip.fadeIn)}
      <div className="flex-1" />
      <button className={btn} onClick={onLoop} title="Loop this clip"><Repeat size={15} /> Loop</button>
      <button className={btn} onClick={onSplit} title="Split at playhead (S)"><Scissors size={15} /> Split</button>
      <button className={btn} onClick={onDuplicate} title="Duplicate (Ctrl+D)"><Copy size={15} /> Duplicate</button>
      <button className={`${btn} hover:text-red-400`} onClick={onDelete} title="Delete (Del)"><Trash2 size={15} /> Delete</button>
    </div>
  )
}
