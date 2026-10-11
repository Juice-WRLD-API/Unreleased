import React, { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, FileDown, FileUp, Layers, Loader2, Magnet,
  Minus, Pause, Play, Plus, Redo2, Repeat, Scissors, Search, SkipBack, Trash2, Undo2, Volume2, VolumeX, Wand2,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { useIsMobile } from '../hooks/useIsMobile'
import { onOpenSessionRequest, takePendingSession } from '../lib/sessionMakerOpen'
import { formatBytes } from '../lib/format'
import type { JWApiFileEntry } from '../lib/juicewrldApi'
import {
  PEAKS_PER_SEC, SessionEngine, alternatesOf, compTo, defaultReference, deleteProject, isBeatTrack, downloadBlob, encodeWav, formatTime, listSessionFolders, listSessionZips,
  loadProjects, loadTake, newProject, parseProjectFile, peekLoadProgress, placeAllTakes, projectEnd, renderProject,
  saveProject, scanSession, searchSessionZips, sessionTitle, subscribeLoadProgress, takeKey, uid,
  type AB, type LoadedTake, type LoopRange, type ScannedSession, type SessionFolder, type SmClip, type SmProject, type SmTrack, type Take,
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
    return <SessionEditor key={opened.project.id} initial={opened.project} session={opened.session} onClose={() => setOpened(null)} />
  }

  return <SessionBrowser opening={opening} error={error} onOpenZip={(p) => void open(p)} onOpenProject={(p) => void open(p.zipPath, p)} />
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
  const fileRef = useRef<HTMLInputElement>(null)

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

  const zipRow = (z: JWApiFileEntry): JSX.Element => (
    <button
      key={z.path}
      onClick={() => onOpenZip(z.path)}
      disabled={!!opening}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-surface-overlay transition-colors disabled:opacity-50"
    >
      <Layers size={15} className="text-text-muted shrink-0" />
      <span className="flex-1 truncate text-sm text-text-primary">{sessionTitle(z.name)}</span>
      <span className="text-xs text-text-muted tabular-nums">{z.size ? formatBytes(z.size) : ''}</span>
    </button>
  )

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 pt-12 pb-16">
        <div className="flex items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Session Maker</h1>
            <p className="text-sm text-text-muted mt-1 max-w-xl">
              Open a studio session, drag takes onto the timeline over the beat, and arrange your own version. Takes stream straight out of the session - nothing to download first.
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
  snapshot: SmProject
  moved: boolean
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
const dbOf = (g: number): number => (g <= 0 ? -60 : 20 * Math.log10(g))
const gainOf = (db: number): number => (db <= -60 ? 0 : Math.pow(10, db / 20))

function SessionEditor({ initial, session, onClose }: { initial: SmProject; session: ScannedSession; onClose: () => void }): JSX.Element {
  // Projects saved before references existed get the default one.
  const [project, setProject] = useState<SmProject>(() => {
    if (initial.reference !== undefined) return initial
    const ref = defaultReference(session)
    return { ...initial, reference: ref ? { takeId: ref.id, offset: 0 } : null }
  })
  const projectRef = useRef(project)
  projectRef.current = project
  const undoRef = useRef<SmProject[]>([])
  const redoRef = useRef<SmProject[]>([])
  const [, bumpHistory] = useState(0)

  const [pps, setPps] = useState(40)
  const ppsRef = useRef(pps)
  ppsRef.current = pps
  const [grid, setGrid] = useState<GridDiv>(session.bpm ? 'beat' : 'off')
  const [follow, setFollow] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [loaded, setLoaded] = useState<Map<string, LoadedTake>>(() => new Map())
  const [failed, setFailed] = useState<Set<string>>(() => new Set())
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [exporting, setExporting] = useState<string | null>(null)
  const [binQuery, setBinQuery] = useState('')
  const [showBounces, setShowBounces] = useState(false)
  const [ab, setAb] = useState<AB>('mix')

  const engineRef = useRef<SessionEngine>()
  if (!engineRef.current) engineRef.current = new SessionEngine()
  const engine = engineRef.current
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)

  const takesById = useMemo(() => new Map(session.takes.map((t) => [t.id, t])), [session])
  const loadedRef = useRef(loaded)
  loadedRef.current = loaded
  const bufferFor = useCallback((takeId: string) => loadedRef.current.get(takeId)?.buffer, [])

  // ── History ──
  const commit = useCallback((next: SmProject, prev: SmProject = projectRef.current) => {
    if (next === prev) return
    undoRef.current.push(prev)
    if (undoRef.current.length > 200) undoRef.current.shift()
    redoRef.current = []
    setProject(next)
    bumpHistory((n) => n + 1)
  }, [])
  const undo = useCallback(() => {
    const prev = undoRef.current.pop()
    if (!prev) return
    redoRef.current.push(projectRef.current)
    setProject(prev)
    bumpHistory((n) => n + 1)
  }, [])
  const redo = useCallback(() => {
    const next = redoRef.current.pop()
    if (!next) return
    undoRef.current.push(projectRef.current)
    setProject(next)
    bumpHistory((n) => n + 1)
  }, [])

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

  // Edits while playing: re-schedule clips from where we are. Mix changes go live without a restart.
  const clipsKey = useMemo(() => JSON.stringify([project.tracks.map((t) => [t.id, t.clips]), project.loop, project.reference]), [project.tracks, project.loop, project.reference])
  const loadedKey = loaded.size
  useEffect(() => {
    if (engine.playing) engine.play(projectRef.current, engine.position(), bufferFor, playOpts())
  }, [clipsKey, loadedKey, engine, bufferFor, playOpts])
  useEffect(() => { engine.applyMix(project) }, [project, engine])

  useEffect(() => () => engine.dispose(), [engine])
  // The app's own player starting should stop us, not play on top.
  useEffect(() => useStore.subscribe((s, prev) => {
    if (s.isPlaying && !prev.isPlaying && engine.playing) { engine.pause(); setPlaying(false) }
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

  // ── Loop ──
  const setLoop = useCallback((range: LoopRange | null, on = true) => {
    const p = projectRef.current
    commit({ ...p, loop: range && range.end - range.start > 0.05 ? { ...range, on } : null })
  }, [commit])
  const toggleLoop = useCallback(() => {
    const p = projectRef.current
    if (p.loop) { commit({ ...p, loop: { ...p.loop, on: !p.loop.on } }); return }
    // Nothing set yet: loop the selected clip, else four bars (or 8 s) from the playhead.
    const f = selected ? findClip(p, selected) : null
    if (f) { setLoop({ start: f.clip.start, end: f.clip.start + f.clip.length }); return }
    const bar = p.bpm ? (60 / p.bpm) * 4 : 0
    const at = engine.position()
    const start = bar ? p.gridOffset + Math.floor((at - p.gridOffset) / bar) * bar : at
    setLoop({ start: Math.max(0, start), end: Math.max(0, start) + (bar ? bar * 4 : 8) })
  }, [commit, setLoop, selected, engine])

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
  const toggleClipMute = useCallback((clipId: string) => {
    commit(mapClip(projectRef.current, clipId, (c) => ({ ...c, muted: !c.muted })))
  }, [commit])

  // ── Clip operations ──
  const placeTake = useCallback((take: Take, trackIdx: number | null, at: number | null, alt = false) => {
    const go = (duration: number): void => {
      const p = projectRef.current
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
        idx = trackIdx == null ? p.tracks.findIndex((t) => !isBeatTrack(t) && free(t)) : -1
      }
      const tracks = [...p.tracks]
      if (idx < 0 || idx >= tracks.length) {
        tracks.push({ id: uid(), name: take.kind === 'bounce' ? 'Reference' : `Vocals ${tracks.length}`, gain: 1, muted: false, solo: false, clips: [] })
        idx = tracks.length - 1
      }
      tracks[idx] = { ...tracks[idx], clips: [...tracks[idx].clips, clip] }
      commit({ ...p, tracks })
      setSelected(clip.id)
    }
    if (take.duration) go(take.duration)
    else void ensureLoaded(take).then((lt) => go(lt.buffer.duration)).catch(() => {})
  }, [beatLen, snapAbs, commit, ensureLoaded, engine])

  const deleteClip = useCallback((clipId: string) => {
    const p = projectRef.current
    commit({ ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) })) })
    setSelected(null)
  }, [commit])

  const splitClip = useCallback((clipId: string, at: number) => {
    const p = projectRef.current
    const f = findClip(p, clipId)
    if (!f) return
    const { clip } = f
    if (at <= clip.start + 0.02 || at >= clip.start + clip.length - 0.02) return
    const left: SmClip = { ...clip, length: at - clip.start, fadeOut: 0 }
    const right: SmClip = { ...clip, id: uid(), start: at, offset: clip.offset + (at - clip.start), length: clip.start + clip.length - at, fadeIn: 0 }
    commit({ ...p, tracks: p.tracks.map((t) => (t.id === f.track.id ? { ...t, clips: t.clips.flatMap((c) => (c.id === clipId ? [left, right] : [c])) } : t)) })
    setSelected(right.id)
  }, [commit])

  const duplicateClip = useCallback((clipId: string) => {
    const p = projectRef.current
    const f = findClip(p, clipId)
    if (!f) return
    let start = f.clip.start + f.clip.length
    if (snapStep) start = f.clip.start + Math.ceil(f.clip.length / snapStep - 1e-6) * snapStep
    const copy: SmClip = { ...f.clip, id: uid(), start }
    commit({ ...p, tracks: p.tracks.map((t) => (t.id === f.track.id ? { ...t, clips: [...t.clips, copy] } : t)) })
    setSelected(copy.id)
  }, [commit, snapStep])

  const updateTrack = useCallback((trackId: string, patch: Partial<SmTrack>, history = true) => {
    const p = projectRef.current
    const next = { ...p, tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)) }
    if (history) commit(next)
    else setProject(next)
  }, [commit])

  const addTrack = useCallback(() => {
    const p = projectRef.current
    commit({ ...p, tracks: [...p.tracks, { id: uid(), name: `Track ${p.tracks.length + 1}`, gain: 1, muted: false, solo: false, clips: [] }] })
  }, [commit])

  const removeTrack = useCallback((trackId: string) => {
    const p = projectRef.current
    commit({ ...p, tracks: p.tracks.filter((t) => t.id !== trackId) })
  }, [commit])

  // ── Pointer: clips ──
  const laneAt = (clientY: number): number => {
    const r = rowsRef.current?.getBoundingClientRect()
    if (!r) return 0
    return Math.floor((clientY - r.top) / LANE_H)
  }
  const timeAt = (clientX: number): number => {
    const r = rowsRef.current?.getBoundingClientRect()
    if (!r) return 0
    return Math.max(0, (clientX - r.left - HEADER_W) / ppsRef.current)
  }

  const onClipPointerDown = useCallback((e: React.PointerEvent, clipId: string, mode: DragMode) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const p = projectRef.current
    const f = findClip(p, clipId)
    if (!f) return
    setSelected(clipId)
    dragRef.current = { mode, clipId, trackIdx: f.trackIdx, startX: e.clientX, startY: e.clientY, orig: f.clip, snapshot: p, moved: false }
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
  }, [])

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
    if (d.mode === 'move') {
      let start = o.start + dx
      if (snapStep && !alt) start = o.start + Math.round(dx / snapStep) * snapStep
      start = Math.max(0, start)
      const target = clamp(laneAt(e.clientY), 0, d.snapshot.tracks.length - 1)
      const moved: SmClip = { ...o, start }
      next = {
        ...d.snapshot,
        tracks: d.snapshot.tracks.map((t, i) => {
          const without = t.clips.filter((c) => c.id !== o.id)
          return i === target ? { ...t, clips: [...without, moved] } : without.length !== t.clips.length ? { ...t, clips: without } : t
        }),
      }
    } else if (d.mode === 'trimL') {
      let start = snapAbs(o.start + dx, alt)
      start = clamp(start, Math.max(0, o.start - o.offset), o.start + o.length - 0.05)
      const delta = start - o.start
      next = mapClip(d.snapshot, o.id, (c) => ({ ...c, start, offset: o.offset + delta, length: o.length - delta, fadeIn: Math.min(c.fadeIn, o.length - delta) }))
    } else if (d.mode === 'trimR') {
      let end = snapAbs(o.start + o.length + dx, alt)
      end = clamp(end, o.start + 0.05, o.start + (takeLen - o.offset))
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
  }, [commit])
  const dragMoveRef = useRef(onClipPointerMove)
  dragMoveRef.current = onClipPointerMove
  const dragEndRef = useRef(onClipPointerUp)
  dragEndRef.current = onClipPointerUp

  // ── Drop from the take bin ──
  const onDrop = (e: React.DragEvent): void => {
    const id = e.dataTransfer.getData('text/x-session-take')
    const take = id ? takesById.get(id) : undefined
    if (!take) return
    e.preventDefault()
    const lane = laneAt(e.clientY)
    placeTake(take, lane, timeAt(e.clientX), e.altKey)
  }

  // ── Keyboard ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      let handled = true
      if (e.code === 'Space') toggle()
      else if (mod && k === 'z' && !e.shiftKey) undo()
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) redo()
      else if (mod && k === 'd' && selected) duplicateClip(selected)
      else if ((k === 'delete' || k === 'backspace') && selected) deleteClip(selected)
      else if (k === 's' && !mod && selected) splitClip(selected, engine.position())
      else if (k === 'home') seek(0)
      else if ((k === '=' || k === '+') && !mod) setPps((v) => clamp(v * 1.25, MIN_PPS, MAX_PPS))
      else if (k === '-' && !mod) setPps((v) => clamp(v / 1.25, MIN_PPS, MAX_PPS))
      else if (k === 'escape') setSelected(null)
      else if (k === 'l' && !mod) toggleLoop()
      else if (k === 'r' && !mod) toggleAB()
      else if (k === 'c' && !mod && selected) compClip(selected)
      else if (k === 'm' && !mod && selected) toggleClipMute(selected)
      else if (k === ']' && !mod) cycleAlternate(1)
      else if (k === '[' && !mod) cycleAlternate(-1)
      else handled = false
      if (handled) { e.preventDefault(); e.stopPropagation() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [toggle, undo, redo, selected, duplicateClip, deleteClip, splitClip, seek, engine, toggleLoop, toggleAB, compClip, toggleClipMute, cycleAlternate])

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
  const exportWav = async (): Promise<void> => {
    if (exporting) return
    try {
      const p = projectRef.current
      const ids = [...new Set(p.tracks.flatMap((t) => t.clips.map((c) => c.takeId)))]
      setExporting('Loading takes…')
      await Promise.all(ids.map((id) => { const t = takesById.get(id); return t ? ensureLoaded(t) : null }))
      setExporting('Rendering…')
      const buf = await renderProject(p, (id) => loadedRef.current.get(id)?.buffer ?? undefined)
      downloadBlob(encodeWav(buf), `${p.name || 'session'}.wav`)
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(null)
    }
  }
  const exportProject = (): void => {
    const p = projectRef.current
    downloadBlob(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }), `${p.name || 'session'}.session.json`)
  }

  const togglePreview = (take: Take): void => {
    if (previewing === take.id) { engine.stopPreview(); setPreviewing(null); return }
    if (engine.playing) pause()
    setPreviewing(take.id)
    void ensureLoaded(take).then((lt) => {
      setPreviewing((cur) => {
        if (cur === take.id) engine.playPreview(lt.buffer, () => setPreviewing((c) => (c === take.id ? null : c)))
        return cur
      })
    }).catch(() => setPreviewing(null))
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

  const bq = binQuery.trim().toLowerCase()
  const binTakes = session.takes.filter((t) => !bq || t.name.toLowerCase().includes(bq))
  const beats = binTakes.filter((t) => t.kind === 'beat')
  const vocals = binTakes.filter((t) => t.kind === 'take' || t.kind === 'other')
  const bounces = binTakes.filter((t) => t.kind === 'bounce')
  const unplacedWithPos = session.takes.some((t) => t.kind === 'take' && t.position != null && !placedIds.has(t.id))

  const laneGrid = beatLen && grid !== 'off'
    ? {
        backgroundImage: `repeating-linear-gradient(to right, var(--border) 0 1px, transparent 1px ${beatLen * 4 * pps}px), repeating-linear-gradient(to right, color-mix(in srgb, var(--border) 45%, transparent) 0 1px, transparent 1px ${beatLen * pps}px)`,
        backgroundPosition: `${project.gridOffset * pps}px 0`,
      }
    : undefined

  return (
    <div className="flex-1 flex flex-col overflow-hidden select-none">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-1 px-3 pt-8 pb-2 border-b border-[var(--border)]">
        <button className={btn} title="Back to sessions" onClick={() => { engine.dispose(); saveProject({ ...projectRef.current, updatedAt: Date.now() }); onClose() }}>
          <ArrowLeft size={16} />
        </button>
        <input
          value={project.name}
          onChange={(e) => setProject({ ...project, name: e.target.value })}
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
            onChange={(e) => { const v = Number(e.target.value); setProject({ ...project, bpm: e.target.value === '' ? null : v > 0 ? v : project.bpm }) }}
            className={`${input} w-[72px] tabular-nums`}
          />
        </label>
        <select value={grid} onChange={(e) => setGrid(e.target.value as GridDiv)} className={`${input} ml-1`} title="Snap to grid (hold Alt while dragging to ignore it)" disabled={!project.bpm}>
          <option value="off">Snap off</option>
          <option value="bar">Bar</option>
          <option value="beat">Beat</option>
          <option value="half">1/8</option>
          <option value="quarter">1/16</option>
        </select>
        <button className={`${btn} ${follow ? btnOn : ''}`} title="Follow playhead" onClick={() => setFollow(!follow)}><Magnet size={15} /></button>
        <button className={`${btn} ${loop?.on ? btnOn : ''}`} title="Loop (L) - drag across the ruler to set the range" onClick={toggleLoop}><Repeat size={15} /></button>
        <div className="w-px h-5 bg-[var(--border)] mx-1" />
        <button className={btn} title="Zoom out (-, Ctrl+wheel)" onClick={() => setPps((v) => clamp(v / 1.4, MIN_PPS, MAX_PPS))}><Minus size={15} /></button>
        <button className={btn} title="Zoom in (+, Ctrl+wheel)" onClick={() => setPps((v) => clamp(v * 1.4, MIN_PPS, MAX_PPS))}><Plus size={15} /></button>
        <button className={btn} title="Undo (Ctrl+Z)" disabled={!undoRef.current.length} onClick={undo}><Undo2 size={15} /></button>
        <button className={btn} title="Redo (Ctrl+Shift+Z)" disabled={!redoRef.current.length} onClick={redo}><Redo2 size={15} /></button>
        <div className="flex-1" />
        {session.takes.some((t) => t.kind === 'bounce') && (
          <div className="flex items-center gap-1 mr-2">
            <select
              value={project.reference?.takeId ?? ''}
              onChange={(e) => setReference(e.target.value || null)}
              className={`${input} max-w-[150px]`}
              title="The original bounce to compare against"
            >
              <option value="">No reference</option>
              {session.takes.filter((t) => t.kind === 'bounce').map((t) => (
                <option key={t.id} value={t.id}>{t.name}{/\.mp3$/i.test(t.entries[0].name) ? ' (mp3)' : ''}</option>
              ))}
            </select>
            {project.reference && (
              <>
                <input
                  type="number" step={0.01}
                  value={Number(project.reference.offset.toFixed(3))}
                  onChange={(e) => { const p = projectRef.current; if (p.reference) setProject({ ...p, reference: { ...p.reference, offset: Number(e.target.value) || 0 } }) }}
                  title="Where the original starts on the timeline, in seconds - nudge it until it lines up"
                  className={`${input} w-[72px] tabular-nums`}
                />
                <button
                  className={`${btn} w-[92px] ${ab === 'ref' ? 'bg-amber-500/20 text-amber-400 hover:text-amber-400' : 'bg-[var(--surface-raised)]'}`}
                  title="Switch between your arrangement and the original, in sync (R)"
                  onClick={toggleAB}
                >
                  {refLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                  {ab === 'ref' ? 'Original' : 'Your mix'}
                </button>
              </>
            )}
          </div>
        )}
        <label className="flex items-center gap-1.5 text-text-muted" title="Master volume">
          <Volume2 size={15} />
          <input type="range" min={0} max={1.5} step={0.01} value={project.masterGain} onChange={(e) => setProject({ ...project, masterGain: Number(e.target.value) })} className="w-24 accent-[rgb(var(--accent-rgb))]" />
        </label>
        <button className={btn} title="Save the project as a file (share it - it holds no audio)" onClick={exportProject}><FileDown size={15} /> Project</button>
        <button className={`${btn} bg-accent text-white hover:bg-accent-hover hover:text-white`} title="Render the arrangement to a WAV file" onClick={() => void exportWav()} disabled={!!exporting || end <= 0}>
          {exporting ? <><Loader2 size={15} className="animate-spin" /> {exporting}</> : <><Download size={15} /> Export WAV</>}
        </button>
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
          <div className="flex-1 overflow-y-auto py-1">
            {beats.length > 0 && <BinHeading>Beat</BinHeading>}
            {beats.map((t) => <BinRow key={t.id} take={t} zipPath={session.zipPath} placed={placedIds.has(t.id)} previewing={previewing === t.id} failed={failed.has(t.id)} onPreview={togglePreview} onPlace={() => placeTake(t, null, null)} />)}
            {vocals.length > 0 && <BinHeading>Takes · {vocals.length}</BinHeading>}
            {vocals.map((t) => <BinRow key={t.id} take={t} zipPath={session.zipPath} placed={placedIds.has(t.id)} previewing={previewing === t.id} failed={failed.has(t.id)} onPreview={togglePreview} onPlace={() => placeTake(t, null, null)} />)}
            {bounces.length > 0 && (
              <button className="w-full flex items-center gap-1 px-3 pt-3 pb-1 text-[11px] uppercase tracking-wider text-text-muted hover:text-text-secondary" onClick={() => setShowBounces(!showBounces)}>
                {showBounces ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Bounces · {bounces.length}
              </button>
            )}
            {showBounces && bounces.map((t) => <BinRow key={t.id} take={t} zipPath={session.zipPath} placed={placedIds.has(t.id) || project.reference?.takeId === t.id} previewing={previewing === t.id} failed={failed.has(t.id)} onPreview={togglePreview} onPlace={() => setReference(t.id)} placeHint="Double-click to use it as the reference" />)}
          </div>
          <div className="px-3 py-2 border-t border-[var(--border)] text-[11px] text-text-muted leading-relaxed">
            Drag takes onto a lane · double-click to drop one where it was recorded · L loop · [ ] cycle alternate takes · C comp · M mute clip · R original/mix · S split · Ctrl+D duplicate · Del remove
          </div>
        </div>

        {/* Timeline */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div ref={scrollRef} className="flex-1 overflow-auto relative">
            <div style={{ width: HEADER_W + contentW, minHeight: '100%' }} className="relative">
              {/* Ruler */}
              <div className="sticky top-0 z-20 flex" style={{ height: RULER_H }}>
                <div className="sticky left-0 z-10 shrink-0 bg-[var(--surface)] border-b border-r border-[var(--border)]" style={{ width: HEADER_W }} />
                <Ruler width={contentW} pps={pps} bpm={project.bpm} gridOffset={project.gridOffset} loop={loop} snap={snapAbs} onSeek={seek} onLoop={(r) => setLoop(r)} />
              </div>

              {/* Lanes */}
              <div ref={rowsRef} onDragOver={(e) => { if (e.dataTransfer.types.includes('text/x-session-take')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }} onDrop={onDrop}>
                {project.tracks.map((track, ti) => (
                  <div key={track.id} className="flex border-b border-[var(--border)]" style={{ height: LANE_H }}>
                    <TrackHeader
                      track={track}
                      color={TRACK_COLORS[ti % TRACK_COLORS.length]}
                      onChange={updateTrack}
                      onRemove={() => removeTrack(track.id)}
                    />
                    <div
                      className="relative shrink-0"
                      style={{ width: contentW, ...laneGrid, opacity: track.muted ? 0.45 : 1 }}
                      onPointerDown={(e) => { if (e.button === 0) { setSelected(null); seek(timeAt(e.clientX)) } }}
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
                          selected={selected === c.id}
                          onPointerDown={onClipPointerDown}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                {/* Drop below the last lane to start a new one */}
                <div className="flex" style={{ height: LANE_H }}>
                  <div className="sticky left-0 z-10 shrink-0 flex items-start p-2 bg-[var(--surface)] border-r border-[var(--border)]" style={{ width: HEADER_W }}>
                    <button className={btn} onClick={addTrack}><Plus size={15} /> Add track</button>
                  </div>
                  <div className="flex items-center px-4 text-xs text-text-muted/70" style={{ width: contentW }}>
                    Drop a take here for a new lane
                  </div>
                </div>
              </div>

              {loop?.on && (
                <div
                  className="absolute bottom-0 z-[5] pointer-events-none bg-accent/[0.07] border-x border-accent/40"
                  style={{ top: RULER_H, left: HEADER_W + loop.start * pps, width: (loop.end - loop.start) * pps }}
                />
              )}
              <Playhead engine={engine} pps={pps} follow={follow && playing} scrollRef={scrollRef} />
            </div>
          </div>

          {/* Inspector */}
          {sel && (
            <ClipInspector
              clip={sel.clip}
              take={takesById.get(sel.clip.takeId)}
              onChange={(patch, history) => {
                const next = mapClip(projectRef.current, sel.clip.id, (c) => ({ ...c, ...patch }))
                if (history) commit(next)
                else setProject(next)
              }}
              alternates={selAlts.length}
              alternateIndex={selAlts.findIndex((c) => c.id === sel.clip.id)}
              onCycle={cycleAlternate}
              onComp={() => compClip(sel.clip.id)}
              onToggleMute={() => toggleClipMute(sel.clip.id)}
              onLoop={() => setLoop({ start: sel.clip.start, end: sel.clip.start + sel.clip.length })}
              onSplit={() => splitClip(sel.clip.id, engine.position())}
              onDuplicate={() => duplicateClip(sel.clip.id)}
              onDelete={() => deleteClip(sel.clip.id)}
              onLocate={() => seek(sel.clip.start)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function BinHeading({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wider text-text-muted">{children}</div>
}

function useLoadProgress(key: string): number | undefined {
  return useSyncExternalStore(subscribeLoadProgress, () => peekLoadProgress(key))
}

const BinRow = memo(function BinRow({ take, zipPath, placed, previewing, failed, onPreview, onPlace, placeHint = 'Double-click to place it where it was recorded' }: {
  take: Take; zipPath: string; placed: boolean; previewing: boolean; failed: boolean
  onPreview: (t: Take) => void; onPlace: () => void; placeHint?: string
}): JSX.Element {
  const progress = useLoadProgress(takeKey(zipPath, take.id))
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/x-session-take', take.id); e.dataTransfer.effectAllowed = 'copy' }}
      onDoubleClick={onPlace}
      title={`${take.id}\n${placeHint}`}
      className="group flex items-center gap-2 mx-1 px-2 py-1.5 rounded-lg hover:bg-surface-overlay cursor-grab active:cursor-grabbing"
    >
      <button
        onClick={() => onPreview(take)}
        className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center transition-colors ${previewing ? 'bg-accent text-white' : 'bg-[var(--surface-raised)] text-text-secondary hover:text-text-primary'}`}
        title={previewing ? 'Stop preview' : 'Preview'}
      >
        {previewing && progress !== undefined
          ? <span className="text-[9px] tabular-nums">{Math.round(progress * 100)}</span>
          : previewing ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" className="ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-[13px] truncate ${failed ? 'text-red-400' : 'text-text-primary'}`}>{take.name}</div>
        <div className="text-[11px] text-text-muted tabular-nums flex gap-2">
          <span>{take.duration != null ? formatTime(take.duration) : '—'}</span>
          {take.position != null && <span>@ {formatTime(take.position)}</span>}
          {take.channels >= 2 && <span>stereo</span>}
        </div>
      </div>
      {placed && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" title="On the timeline" />}
    </div>
  )
})

function TrackHeader({ track, color, onChange, onRemove }: {
  track: SmTrack; color: string
  onChange: (id: string, patch: Partial<SmTrack>, history?: boolean) => void
  onRemove: () => void
}): JSX.Element {
  const toggleCls = (on: boolean, onCls: string): string =>
    `w-6 h-6 rounded-md text-[11px] font-bold transition-colors ${on ? onCls : 'bg-[var(--surface-raised)] text-text-muted hover:text-text-primary'}`
  return (
    <div className="group sticky left-0 z-10 shrink-0 flex bg-[var(--surface)] border-r border-[var(--border)]" style={{ width: HEADER_W }}>
      <div className="w-1 shrink-0" style={{ background: color }} />
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-1.5 px-2">
        <div className="flex items-center gap-1">
          <input
            value={track.name}
            onChange={(e) => onChange(track.id, { name: e.target.value }, false)}
            className="flex-1 min-w-0 h-6 px-1 rounded bg-transparent hover:bg-[var(--surface-raised)] focus:bg-[var(--surface-raised)] text-[13px] font-medium text-text-primary outline-none"
          />
          <button className={toggleCls(track.muted, 'bg-amber-500/80 text-black')} title="Mute" onClick={() => onChange(track.id, { muted: !track.muted })}>M</button>
          <button className={toggleCls(track.solo, 'bg-emerald-500/80 text-black')} title="Solo" onClick={() => onChange(track.id, { solo: !track.solo })}>S</button>
          <button className="w-6 h-6 rounded-md flex items-center justify-center text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition" title="Delete track" onClick={onRemove}>
            <Trash2 size={13} />
          </button>
        </div>
        <input
          type="range" min={0} max={1.5} step={0.01} value={track.gain}
          onChange={(e) => onChange(track.id, { gain: Number(e.target.value) }, false)}
          title={`Volume ${dbOf(track.gain).toFixed(1)} dB`}
          className="w-full h-1 accent-[rgb(var(--accent-rgb))]"
        />
      </div>
    </div>
  )
}

const ClipView = memo(function ClipView({ clip, take, zipPath, loaded, failed, pps, color, selected, onPointerDown }: {
  clip: SmClip; take: Take | undefined; zipPath: string; loaded: LoadedTake | undefined; failed: boolean; pps: number; color: string; selected: boolean
  onPointerDown: (e: React.PointerEvent, clipId: string, mode: DragMode) => void
}): JSX.Element {
  const progress = useLoadProgress(takeKey(zipPath, clip.takeId))
  const w = Math.max(2, clip.length * pps)
  const left = clip.start * pps
  const tiles = Math.ceil(w / TILE_W)
  const handle = 'absolute top-0 bottom-0 w-2 cursor-ew-resize z-10'
  const fadeHandle = 'absolute top-0 w-3 h-3 rounded-sm bg-white/90 border border-black/30 cursor-ew-resize z-20 opacity-0 group-hover:opacity-100'
  const fadeInW = clip.fadeIn * pps, fadeOutW = clip.fadeOut * pps
  return (
    <div
      className={`group absolute top-1 bottom-1 rounded-md overflow-hidden cursor-grab active:cursor-grabbing ${selected ? 'ring-2 ring-white/80' : ''}`}
      style={{ left, width: w, opacity: clip.muted ? 0.35 : 1, background: `color-mix(in srgb, ${color} 22%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 70%, transparent)` }}
      onPointerDown={(e) => onPointerDown(e, clip.id, 'move')}
    >
      {loaded && Array.from({ length: tiles }, (_, i) => (
        <WaveTile key={i} peaks={loaded.peaks} clip={clip} pps={pps} x={i * TILE_W} width={Math.min(TILE_W, w - i * TILE_W)} color={color} />
      ))}
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-text-muted">
          {failed ? 'Could not load' : progress !== undefined ? `Loading ${Math.round(progress * 100)}%` : 'Loading…'}
        </div>
      )}
      {fadeInW > 0 && <svg className="absolute left-0 top-0 h-full pointer-events-none" width={fadeInW} preserveAspectRatio="none" viewBox="0 0 100 100"><path d="M0 100 L100 0 L0 0 Z" fill="rgba(0,0,0,0.35)" /></svg>}
      {fadeOutW > 0 && <svg className="absolute right-0 top-0 h-full pointer-events-none" width={fadeOutW} preserveAspectRatio="none" viewBox="0 0 100 100"><path d="M0 0 L100 100 L100 0 Z" fill="rgba(0,0,0,0.35)" /></svg>}
      <div className="absolute left-1.5 top-0.5 right-1.5 text-[11px] font-medium truncate pointer-events-none" style={{ color, textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>
        {clip.muted ? '(muted) ' : ''}{take?.name ?? 'Missing take'}{clip.gain !== 1 ? ` · ${dbOf(clip.gain).toFixed(1)} dB` : ''}
      </div>
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
      const t0 = clip.offset + (x + px) / pps
      const i0 = Math.floor(t0 * PEAKS_PER_SEC)
      const i1 = Math.max(i0 + 1, Math.floor((t0 + 1 / pps) * PEAKS_PER_SEC))
      let m = 0
      for (let i = i0; i < i1 && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i]
      const y = Math.max(0.5, Math.min(1, m) * amp)
      g.fillRect(px, mid - y, 1, y * 2)
    }
  }, [peaks, clip.offset, pps, x, width, color, h])
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
      if (!range && Math.abs(ev.clientX - x0) < 4) return
      const a = snap(t0, ev.altKey), b = snap(Math.max(0, (ev.clientX - left) / pps), ev.altKey)
      range = { start: Math.max(0, Math.min(a, b)), end: Math.max(a, b) }
      setDraft(range)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDraft(null)
      if (range) onLoop(range)
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
function Playhead({ engine, pps, follow, scrollRef }: { engine: SessionEngine; pps: number; follow: boolean; scrollRef: React.RefObject<HTMLDivElement> }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      const x = HEADER_W + engine.position() * pps
      if (ref.current) ref.current.style.transform = `translateX(${x}px)`
      const el = scrollRef.current
      if (follow && el && engine.playing) {
        const visL = el.scrollLeft + HEADER_W, visR = el.scrollLeft + el.clientWidth - 40
        if (x > visR || x < visL) el.scrollLeft = x - HEADER_W - 40
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [engine, pps, follow, scrollRef])
  return (
    <div ref={ref} className="absolute top-0 bottom-0 left-0 w-px bg-accent z-30 pointer-events-none">
      <div className="absolute -left-[5px] top-0 w-[11px] h-[11px] bg-accent" style={{ clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }} />
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

function ClipInspector({ clip, take, alternates, alternateIndex, onCycle, onComp, onToggleMute, onLoop, onChange, onSplit, onDuplicate, onDelete, onLocate }: {
  clip: SmClip; take: Take | undefined
  alternates: number; alternateIndex: number
  onCycle: (dir: 1 | -1) => void; onComp: () => void; onToggleMute: () => void; onLoop: () => void
  onChange: (patch: Partial<SmClip>, history: boolean) => void
  onSplit: () => void; onDuplicate: () => void; onDelete: () => void; onLocate: () => void
}): JSX.Element {
  const num = (label: string, value: number, key: 'fadeIn' | 'fadeOut', max: number): JSX.Element => (
    <label className="flex items-center gap-1.5 text-xs text-text-muted">
      {label}
      <input
        type="number" min={0} max={max} step={0.05} value={Number(value.toFixed(2))}
        onChange={(e) => onChange({ [key]: clamp(Number(e.target.value) || 0, 0, max) }, true)}
        className={`${input} w-20 h-7 tabular-nums`}
      />
    </label>
  )
  return (
    <div className="shrink-0 flex items-center gap-4 px-4 py-2 border-t border-[var(--border)] bg-[var(--surface-raised)]">
      <button className="min-w-0 text-left" onClick={onLocate} title="Jump to clip">
        <div className="text-sm text-text-primary truncate max-w-[240px]">{take?.name ?? 'Missing take'}</div>
        <div className="text-[11px] text-text-muted tabular-nums">{formatTime(clip.start)} → {formatTime(clip.start + clip.length)} · {clip.length.toFixed(2)}s</div>
      </button>
      <label className="flex items-center gap-2 text-xs text-text-muted">
        Gain
        <input
          type="range" min={-24} max={12} step={0.5} value={Math.max(-24, dbOf(clip.gain))}
          onChange={(e) => onChange({ gain: gainOf(Number(e.target.value)) }, false)}
          onPointerUp={(e) => onChange({ gain: gainOf(Number((e.target as HTMLInputElement).value)) }, true)}
          className="w-32 accent-[rgb(var(--accent-rgb))]"
        />
        <span className="w-14 tabular-nums text-text-secondary">{dbOf(clip.gain).toFixed(1)} dB</span>
      </label>
      {alternates > 1 && (
        <div className="flex items-center gap-1 text-xs text-text-muted" title="Other takes over the same stretch: [ and ] switch, and the one you land on is the one heard">
          <button className={`${btn} h-7 px-1.5`} onClick={() => onCycle(-1)}><ChevronLeft size={15} /></button>
          <span className="tabular-nums text-text-secondary">Take {alternateIndex + 1}/{alternates}</span>
          <button className={`${btn} h-7 px-1.5`} onClick={() => onCycle(1)}><ChevronRight size={15} /></button>
          <button className={`${btn} h-7`} onClick={onComp} title="Hear only this take here (C)">Comp</button>
        </div>
      )}
      <button className={`${btn} h-7 ${clip.muted ? btnOn : ''}`} onClick={onToggleMute} title="Mute this clip (M)">
        <VolumeX size={14} /> {clip.muted ? 'Muted' : 'Mute'}
      </button>
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
