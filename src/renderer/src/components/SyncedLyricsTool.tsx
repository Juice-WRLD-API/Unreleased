import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlignLeft, ChevronLeft, ChevronRight, ChevronsDown, Clock, Crosshair, Ear, Eraser, Keyboard, Pause, Play, Plus, RotateCcw, WholeWord, X,
} from 'lucide-react'
import { formatDuration } from '../lib/format'
import { showAppToast } from '../lib/appToast'
import { ls } from '../lib/persist'
import { exactSeekAudio } from '../lib/exactSeekAudio'
import {
  clearTarget, firstTarget, hasWordTiming, insertLine, isMoved, lineAt, lineStart, linesFromPlain, lrcStamp, nudgeTarget, outOfOrder, parseStamp,
  parseSyncedLyrics, removeLine, resetTarget, serializeSyncedLyrics, setLineText, shiftAll, stampTarget, stepTarget, syncProgress, targetKey,
  targetStart, wordAt, wordsOf, type SyncLine, type SyncMode, type SyncTarget,
} from '../lib/syncedLyrics'

// The Synced lyrics tool: time lyrics to a song by hand, a line or a word at a
// time. Play the song and tap Space as each line (or word) is sung; the next
// one comes up on its own. Then pick anything that came in early or late and
// nudge it, set it to the playhead, or hear it again. It lives in the Synced
// lyrics dialog, on audio of its own, for a hand sync or to fine-tune a
// Whisper one; the song editor's Sync opens the dialog on the song.

/** What the tool stamps against: an <audio> of its own (see useAudioClock). */
export interface SyncClock {
  /** There is audio to stamp against. */
  ready: boolean
  playing: boolean
  now: () => number
  duration: () => number
  seek: (t: number) => void
  setPlaying: (on: boolean) => void
  rate: number
  setRate: (rate: number) => void
}

const MODE_KEY = 'syncedLyrics:mode'
const STEP_KEY = 'lyricsTimingStep'
/** Nudge sizes; Shift makes a nudge five times bigger. */
const STEPS = [0.01, 0.05, 0.25]
const RATES = [0.5, 0.75, 1]

/** The tool's mode: words once the lyrics have word times, else the last one used. */
export function useSyncMode(words: boolean): [SyncMode, (mode: SyncMode) => void] {
  const [mode, setMode] = useState<SyncMode>(() => (words ? 'words' : ls.get<SyncMode>(MODE_KEY) ?? 'lines'))
  // Lyrics with word times arriving (a song loaded, a file opened) open in word mode.
  useEffect(() => { if (words) setMode('words') }, [words])
  return [mode, (m) => { ls.set(MODE_KEY, m); setMode(m) }]
}

/** A clock on an <audio> of the tool's own. Render `element` anywhere. */
export function useAudioClock(src: string | null): { clock: SyncClock; element: JSX.Element | null } {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  // A file that can't be sought exactly is swapped for a WAV of itself once
  // that's decoded (see exactSeekAudio), carrying on where it got to.
  const [exact, setExact] = useState<{ from: string; url: string } | null>(null)
  const resume = useRef<{ at: number; play: boolean } | null>(null)
  useEffect(() => {
    if (!src) return
    const ac = new AbortController()
    let url: string | null = null
    exactSeekAudio(src, ac.signal).then((wav) => {
      if (!wav || ac.signal.aborted) return
      url = URL.createObjectURL(wav)
      const a = ref.current
      resume.current = a ? { at: a.currentTime, play: !a.paused } : null
      setExact({ from: src, url })
    }, () => {})
    return () => {
      ac.abort()
      setExact(null)
      if (url) URL.revokeObjectURL(url)
    }
  }, [src])
  const played = src && exact?.from === src ? exact.url : src
  useEffect(() => { setPlaying(false) }, [src])
  useEffect(() => { if (ref.current) ref.current.playbackRate = rate }, [rate, played])
  const clock: SyncClock = {
    ready: !!src,
    playing,
    now: () => ref.current?.currentTime ?? 0,
    duration: () => ref.current?.duration || 0,
    seek: (t) => { if (ref.current) ref.current.currentTime = Math.max(0, t) },
    setPlaying: (on) => {
      const a = ref.current
      if (!a) return
      if (on) a.play().catch(() => {}); else a.pause()
    },
    rate,
    setRate,
  }
  const element = played
    ? (
      <audio
        ref={ref}
        src={played}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => {
          const a = e.currentTarget
          a.playbackRate = rate
          const r = resume.current
          if (!r) return
          resume.current = null
          a.currentTime = r.at
          if (r.play) a.play().catch(() => {})
        }}
      />
    )
    : null
  return { clock, element }
}

const isTyping = (el: EventTarget | null): boolean => {
  const t = el as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

// The keys go to the newest tool on screen, so one in a dialog over the song
// editor doesn't also stamp the editor's.
const keyOwners: symbol[] = []

const KEYS: Array<[string, string]> = [
  ['Space', 'Stamp the picked line or word where the song is, then pick the next'],
  ['Ctrl + Space', 'Play or pause'],
  ['↑ ↓', 'Pick the previous or next line (in word mode, word)'],
  ['← →', 'Move the picked one earlier or later (Shift for 5×)'],
  ['Enter', 'Start the picked one at the playhead, staying on it'],
  ['R', 'Replay the last stamp, or the line or word you picked'],
  ['J  L', 'Back or forward 2 seconds'],
  ['Delete', 'Take the picked one\'s time away'],
  ['Esc', 'Pick nothing (Space then goes to the first untimed one)'],
]

const SMALL_BTN = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold text-text-secondary bg-surface-overlay hover:bg-surface-raised hover:text-text-primary transition-colors disabled:opacity-40 disabled:pointer-events-none'
const MINI_BTN = 'shrink-0 inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-semibold text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors disabled:opacity-40 disabled:pointer-events-none'
const ESTIMATED_MARK = 'underline decoration-dotted decoration-text-muted underline-offset-[5px]'
const MOVED_MARK = 'underline decoration-accent/70 underline-offset-[5px]'
const ORDER_MARK = 'underline decoration-wavy decoration-amber-400/80 underline-offset-[5px]'
const LIST_MASK = 'linear-gradient(to bottom, transparent, black 8%, black 92%, transparent)'

export function Kbd({ children }: { children: ReactNode }): JSX.Element {
  return <kbd className="px-1 py-px rounded border border-[var(--border)] bg-surface-overlay font-mono text-[10px] text-text-secondary">{children}</kbd>
}

/** A small two- or three-way switch. */
function Segmented<T extends string | number>({ options, value, onChange, label }: {
  options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[]
  value: T
  onChange: (value: T) => void
  label?: string
}): JSX.Element {
  return (
    <div role="group" aria-label={label} className="shrink-0 inline-flex p-0.5 rounded-lg bg-surface-overlay text-[11px] font-semibold">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          disabled={o.disabled}
          title={o.title}
          aria-pressed={o.value === value}
          className={`inline-flex items-center gap-1 px-2 h-6 rounded-md tabular-nums transition-colors disabled:opacity-40 ${o.value === value ? 'bg-surface-raised text-text-primary shadow-sm' : 'text-text-muted enabled:hover:text-text-primary'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** "+0.25s", "-1.10s". */
const offsetText = (sec: number): string => `${sec < 0 ? '-' : '+'}${Math.abs(sec).toFixed(2)}s`

export default function SyncedLyricsTool({
  lines, onChange, clock, mode, onModeChange, original = null, readOnly = false, plainLyrics = '', noAudio, footer, listClassName = 'h-[300px]', fill = false, className = '',
}: {
  lines: SyncLine[]
  onChange: (lines: SyncLine[]) => void
  clock: SyncClock
  mode: SyncMode
  /** Absent: the mode is fixed. */
  onModeChange?: (mode: SyncMode) => void
  /** The timing this started from: what "moved" and Reset compare against. */
  original?: SyncLine[] | null
  /** A preview: the lines play along and a click seeks there, but nothing
   *  can be stamped, moved or typed. Space plays and pauses. */
  readOnly?: boolean
  /** Fills an empty list. */
  plainLyrics?: string
  /** In place of the transport while there's no audio to sync against. */
  noAudio?: ReactNode
  /** Extra actions under the lines. */
  footer?: ReactNode
  /** The list's height, when it doesn't `fill`. */
  listClassName?: string
  /** The list takes whatever height the tool is given (by `className`, in a
   *  flex column), instead of `listClassName`'s. */
  fill?: boolean
  className?: string
}): JSX.Element {
  const editText = !readOnly
  const [rawSel, setRawSel] = useState<SyncTarget | null>(null)
  const [lastStamped, setLastStamped] = useState<SyncTarget | null>(null)
  const [stampFinished, setStampFinished] = useState(false)
  const setSel = (next: Parameters<typeof setRawSel>[0]): void => {
    setRawSel(next)
    setLastStamped(null)
    setStampFinished(false)
  }
  const [lit, setLit] = useState({ line: -1, word: -1 })
  const [follow, setFollow] = useState(true)
  const [step, setStep] = useState(() => {
    const saved = ls.get<number>(STEP_KEY)
    return saved && STEPS.includes(saved) ? saved : STEPS[1]
  })
  const [editing, setEditing] = useState<{ line: number; kind: 'time' | 'text' } | null>(null)
  const [showKeys, setShowKeys] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [shifted, setShifted] = useState(0)
  const [duration, setDuration] = useState(0)

  const listRef = useRef<HTMLDivElement>(null)
  const clockTextRef = useRef<HTMLSpanElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const clockRef = useRef(clock)
  clockRef.current = clock
  const linesRef = useRef(lines)
  linesRef.current = lines
  const modeRef = useRef(mode)
  modeRef.current = mode

  // A pick that no longer fits (lines removed, mode changed) falls back.
  const sel = useMemo<SyncTarget | null>(() => {
    if (!rawSel) return null
    const l = lines[rawSel.line]
    if (!l || l.hidden) return null
    if (rawSel.word === null || mode === 'lines') return { line: rawSel.line, word: null }
    return rawSel.word < wordsOf(l).length ? rawSel : null
  }, [rawSel, lines, mode])
  // What Space stamps: the pick, else the first line or word without a time.
  const cursor = readOnly || stampFinished ? null : sel ?? firstTarget(lines, mode)
  const replayTarget = lastStamped ?? sel
  const replayStart = replayTarget ? targetStart(lines, replayTarget) : null
  const order = useMemo(() => outOfOrder(lines), [lines])
  const marks = useMemo(() => lines.map((_, i) => rowMarks(lines, i, order, original, mode)), [lines, order, original, mode])
  const progress = syncProgress(lines, mode)
  const hasLines = lines.some((l) => !l.hidden)

  // Every frame the clock and the scrubber are written straight to the DOM;
  // a re-render only happens when the lit line or word changes.
  useEffect(() => {
    if (!clock.ready) { setLit({ line: -1, word: -1 }); return }
    let raf = 0
    let lastDur = -1
    let lastText = ''
    const tick = (): void => {
      const c = clockRef.current
      const t = c.now()
      const d = c.duration()
      // Only when the second changes: writing the text lays the bar out again.
      const text = formatDuration(t)
      if (clockTextRef.current && text !== lastText) { lastText = text; clockTextRef.current.textContent = text }
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${d ? Math.min(t / d, 1) : 0})`
      if (Math.round(d) !== lastDur) { lastDur = Math.round(d); setDuration(d) }
      const ls_ = linesRef.current
      const line = lineAt(ls_, t)
      const word = line >= 0 && modeRef.current === 'words' ? wordAt(ls_[line], t) : -1
      setLit((p) => (p.line === line && p.word === word ? p : { line, word }))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [clock.ready])

  // Centre a row by scrolling the list itself; scrollIntoView would drag the
  // whole page (or dialog) along.
  const centre = (line: number, onlyNearEdge: boolean): void => {
    const box = listRef.current
    const el = box?.querySelector<HTMLElement>(`[data-line="${line}"]`)
    if (!box || !el) return
    if (onlyNearEdge && el.offsetTop >= box.scrollTop + 40 && el.offsetTop + el.offsetHeight <= box.scrollTop + box.clientHeight - 40) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2, behavior: reduce ? 'auto' : 'smooth' })
  }
  useEffect(() => { if (follow && clock.playing && lit.line >= 0) centre(lit.line, false) }, [lit.line, follow, clock.playing])
  useEffect(() => { if (cursor) centre(cursor.line, true) }, [cursor?.line])

  const flashOn = (t: SyncTarget): void => {
    const key = targetKey(t)
    setFlash(key)
    window.setTimeout(() => setFlash((f) => (f === key ? null : f)), 380)
  }

  const hear = (t: SyncTarget): void => {
    const s = targetStart(lines, t)
    if (!clock.ready || s === null) return
    clock.seek(s)
    clock.setPlaying(true)
  }
  const pick = (t: SyncTarget, listen = true): void => {
    if (readOnly) {
      // A preview just plays from there.
      const s = targetStart(lines, t)
      if (clock.ready && s !== null) { clock.seek(s); clock.setPlaying(true) }
      return
    }
    setSel(t)
    if (listen) hear(t)
  }

  const stamp = (advance: boolean): void => {
    const t = advance ? cursor : sel
    if (!clock.ready || !t) return
    onChange(stampTarget(lines, t, clock.now()))
    flashOn(t)
    setLastStamped(t)
    if (advance) {
      const next = stepTarget(lines, t, 1, mode)
      const finished = targetKey(next) === targetKey(t)
      setRawSel(finished ? null : next)
      setStampFinished(finished)
    }
  }

  // A nudge pushes whatever it runs into along with it; it only stops at the
  // start of the song.
  const lastStopToast = useRef(0)
  const nudge = (by: number): void => {
    if (!sel) return
    const r = nudgeTarget(lines, sel, by)
    if (r.stopped && Date.now() - lastStopToast.current > 2500) {
      lastStopToast.current = Date.now()
      showAppToast('That\'s as early as it goes: everything before it is up against the start of the song.', { tone: 'info' })
    }
    if (r.lines !== lines) onChange(r.lines)
  }
  const clear = (): void => { if (sel && editText) onChange(clearTarget(lines, sel)) }
  const reset = (): void => { if (sel && original) onChange(resetTarget(lines, original, sel)) }
  const shiftEverything = (by: number): void => {
    const r = shiftAll(lines, by)
    if (!r.by) return
    onChange(r.lines)
    setShifted((s) => Math.round((s + r.by) * 100) / 100)
  }
  const chooseStep = (s: number): void => { setStep(s); ls.set(STEP_KEY, s) }

  /** Where the arrow keys start when nothing is picked: what's being sung. */
  const litTarget = (): SyncTarget | null => {
    if (lit.line < 0) return cursor ?? firstTarget(lines, mode, false)
    if (mode === 'lines') return { line: lit.line, word: null }
    return { line: lit.line, word: Math.max(lit.word, 0) }
  }

  const commitTime = (line: number, draft: string): void => {
    setEditing(null)
    const t = { line, word: null }
    if (!draft.trim()) { if (editText) onChange(clearTarget(lines, t)); return }
    const at = parseStamp(draft)
    if (at === null) { showAppToast(`"${draft}" isn't a time. Type it like 1:23.45`, { tone: 'info' }); return }
    onChange(stampTarget(lines, t, at))
  }
  const commitText = (line: number, draft: string): void => {
    setEditing(null)
    onChange(setLineText(lines, line, draft))
  }
  const addLine = (): void => {
    const at = sel ? sel.line + 1 : lines.length
    onChange(insertLine(lines, at))
    setSel({ line: at, word: null })
    setEditing({ line: at, kind: 'text' })
  }
  const deleteLine = (i: number): void => {
    onChange(removeLine(lines, i))
    setSel((s) => (s && s.line > i ? { ...s, line: s.line - 1 } : s && s.line === i ? null : s))
  }

  // Keyboard: on `window` in the capture phase, so it runs before the app's
  // own hotkeys (Space = play/pause, arrows = seek), and only takes the keys
  // it handles. Typing in a field always wins. The handler is reassigned each
  // render, so the one listener sees fresh state.
  const me = useRef(Symbol('synced-lyrics'))
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {})
  keyHandler.current = (e: KeyboardEvent): void => {
    if (keyOwners[keyOwners.length - 1] !== me.current) return
    if (!clock.ready || isTyping(e.target) || e.altKey || e.metaKey) return
    if (e.ctrlKey && e.key !== ' ') return
    if (readOnly && e.key !== ' ' && !/^[jl]$/i.test(e.key)) return
    const claim = (): void => { e.preventDefault(); e.stopImmediatePropagation() }
    switch (e.key) {
      case ' ':
        claim()
        if (e.repeat) break
        if (e.ctrlKey || readOnly) clock.setPlaying(!clock.playing)
        else stamp(true)
        break
      case 'ArrowUp':
      case 'ArrowDown': {
        if (!hasLines) return
        claim()
        const from = sel ?? litTarget()
        if (from) setSel(sel ? stepTarget(lines, sel, e.key === 'ArrowUp' ? -1 : 1, mode) : from)
        break
      }
      case 'ArrowLeft':
      case 'ArrowRight':
        if (!hasLines) return
        claim()
        if (!sel) { const t = litTarget(); if (t) setSel(t); break }
        nudge((e.key === 'ArrowLeft' ? -step : step) * (e.shiftKey ? 5 : 1))
        break
      case 'Enter':
        if (!sel) return
        claim()
        stamp(false)
        break
      case 'r': case 'R': case 'x': case 'X':
        if (!replayTarget) return
        claim()
        hear(replayTarget)
        break
      case 'j': case 'J': case 'l': case 'L':
        claim()
        clock.seek(clock.now() + (e.key.toLowerCase() === 'j' ? -2 : 2))
        break
      case 'Delete': case 'Backspace':
        if (!sel || !editText) return
        claim()
        clear()
        break
      case 'Escape':
        if (!sel && !lastStamped && !stampFinished) return
        claim()
        setSel(null)
        break
    }
  }
  useEffect(() => {
    const id = me.current
    keyOwners.push(id)
    const on = (e: KeyboardEvent): void => keyHandler.current(e)
    window.addEventListener('keydown', on, true)
    return () => {
      window.removeEventListener('keydown', on, true)
      const at = keyOwners.indexOf(id)
      if (at >= 0) keyOwners.splice(at, 1)
    }
  }, [])

  // The row callbacks stay the same object, so rows only re-render when
  // what they show changes.
  const actions = useRef({ pick, setEditing, commitTime, commitText, deleteLine })
  actions.current = { pick, setEditing, commitTime, commitText, deleteLine }
  const rowActions = useMemo<RowActions>(() => ({
    pick: (t) => actions.current.pick(t),
    editTime: (i) => actions.current.setEditing({ line: i, kind: 'time' }),
    editText: (i) => actions.current.setEditing({ line: i, kind: 'text' }),
    commitTime: (i, d) => actions.current.commitTime(i, d),
    commitText: (i, d) => actions.current.commitText(i, d),
    cancelEdit: () => actions.current.setEditing(null),
    remove: (i) => actions.current.deleteLine(i),
  }), [])

  // The lit line can be one that was just removed, until the next frame.
  const litLine = lines[lit.line] && !lines[lit.line].hidden ? lit.line : -1
  const litStart = litLine >= 0 ? lineStart(lines[litLine]) : null
  const started = litLine >= 0
  const selStart = sel ? targetStart(lines, sel) : null
  const selFrom = sel && original ? targetStart(original, sel) : null
  const selMoved = !!sel && !!original && isMoved(lines, original, sel)
  const cursorLabel = cursor ? targetText(lines, cursor) : null
  const ticks = useMemo(() => {
    if (!duration) return []
    return lines.flatMap((l) => {
      const s = l.hidden ? null : lineStart(l)
      return s === null || s > duration ? [] : [s / duration]
    })
  }, [lines, duration])

  return (
    <div
      className={`rounded-2xl border border-[var(--border)] bg-surface-overlay/30 overflow-hidden ${fill ? 'flex flex-col' : ''} ${className}`}
      // Buttons never take focus, so Space after a click still stamps
      // instead of pressing the last button again.
      onMouseDown={(e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault() }}
    >
      {/* Mode, progress, shift all */}
      {!readOnly && (
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-surface/40">
        {onModeChange ? (
          <Segmented
            label="Sync by"
            options={[
              { value: 'lines', label: <><AlignLeft size={12} /> Lines</>, title: 'Time each line' },
              { value: 'words', label: <><WholeWord size={12} /> Words</>, title: 'Time every word, karaoke style' },
            ]}
            value={mode}
            onChange={(m) => { onModeChange(m); setSel(null) }}
          />
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-text-secondary">
            {mode === 'words' ? <WholeWord size={13} /> : <AlignLeft size={13} />} {mode === 'words' ? 'Word timing' : 'Line timing'}
          </span>
        )}
        {progress.total > 0 && (
          <span className="flex items-center gap-2 min-w-0" title={`${progress.done} of ${progress.total} ${mode === 'words' ? 'words' : 'lines'} have a time`}>
            <span className="w-16 h-1 rounded-full bg-surface-highest overflow-hidden">
              <span
                className="block h-full w-full origin-left bg-accent transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
                style={{ transform: `scaleX(${progress.done / progress.total})` }}
              />
            </span>
            <span className="text-[11px] tabular-nums text-text-muted whitespace-nowrap">
              {progress.done}/{progress.total} {mode === 'words' ? 'words' : 'lines'}
            </span>
          </span>
        )}
        {order.size > 0 && (
          <span className="text-[11px] text-amber-300/90 whitespace-nowrap" title="Marked with a wavy line: they start before one above them">
            {order.size} out of order
          </span>
        )}
        <span className="flex-1" />
        <div className="flex items-center gap-1" title="Move every time at once, when the whole sync is early or late">
          <button onClick={() => shiftEverything(-0.1)} disabled={!progress.done} className={MINI_BTN}>−0.1s</button>
          <span className={`w-11 text-center font-mono text-[11px] tabular-nums ${shifted ? 'text-accent' : 'text-text-muted/60'}`}>
            {shifted > 0 ? '+' : ''}{shifted.toFixed(1)}s
          </span>
          <button onClick={() => shiftEverything(0.1)} disabled={!progress.done} className={MINI_BTN}>+0.1s</button>
        </div>
        <button
          onClick={() => setShowKeys((s) => !s)}
          title="Keyboard shortcuts"
          aria-pressed={showKeys}
          className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${showKeys ? 'text-accent bg-accent/10' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'}`}
        >
          <Keyboard size={14} />
        </button>
      </div>
      )}

      {showKeys && !readOnly && (
        <div className="animate-disclosure-in px-4 py-3 border-b border-[var(--border)] bg-surface/30 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          {KEYS.map(([k, d]) => (
            <div key={k} className="contents text-[11px]">
              <span className="font-mono text-[10px] text-text-primary whitespace-nowrap">{k}</span>
              <span className="text-text-muted">{d}</span>
            </div>
          ))}
        </div>
      )}

      {/* The lines */}
      <div className={`relative ${fill ? 'flex-1 min-h-[160px]' : ''}`}>
        <div
          ref={listRef}
          onWheel={() => setFollow(false)}
          onTouchMove={() => setFollow(false)}
          className={`${fill ? 'absolute inset-0' : `relative ${listClassName}`} overflow-y-auto px-2 py-8`}
          style={{ maskImage: LIST_MASK, WebkitMaskImage: LIST_MASK }}
        >
          {!hasLines && (
            <div className="py-14 flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-text-muted">No lines yet.</p>
              <div className="flex flex-wrap justify-center gap-2">
                {editText && plainLyrics.trim() && (
                  <button onClick={() => onChange(linesFromPlain(plainLyrics))} className={SMALL_BTN}>
                    <AlignLeft size={13} /> Start from the plain lyrics
                  </button>
                )}
                {editText && <button onClick={addLine} className={SMALL_BTN}><Plus size={13} /> Add a line</button>}
              </div>
            </div>
          )}
          {lines.map((l, i) => {
            if (l.hidden) return null
            const now = i === litLine
            const selCode = sel?.line === i ? sel.word ?? -1 : NONE
            const cursorCode = !sel && cursor?.line === i ? cursor.word ?? -1 : NONE
            return (
              <Row
                key={i}
                line={l}
                index={i}
                words={mode === 'words'}
                now={now}
                past={started && !now && (lineStart(l) ?? Infinity) < (litStart ?? -Infinity)}
                started={started}
                litWord={now ? lit.word : -1}
                sel={selCode}
                cursor={cursorCode}
                flash={flash?.split('.')[0] === String(i) ? (flash.includes('.') ? Number(flash.split('.')[1]) : -1) : NONE}
                marks={marks[i]}
                editing={editing?.line === i ? editing.kind : null}
                editText={editText}
                readOnly={readOnly}
                canSeek={clock.ready}
                actions={rowActions}
              />
            )
          })}
        </div>
        {!follow && clock.playing && lit.line >= 0 && (
          <button
            onClick={() => { setFollow(true); centre(lit.line, false) }}
            className="absolute left-1/2 -translate-x-1/2 bottom-2 flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/15 text-white/85 text-[11px] font-medium hover:bg-black/75 transition-colors"
          >
            <ChevronsDown size={12} /> Follow the song
          </button>
        )}
      </div>

      {/* The picked line or word, and what to do with it */}
      {hasLines && !readOnly && (
        <div className="flex flex-col gap-2 px-3 py-2.5 border-t border-[var(--border)] bg-surface/40">
          <div className="flex items-center gap-2 min-w-0 h-7">
            {sel ? (
              <>
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  {sel.word === null ? `Line ${visibleNumber(lines, sel.line)}` : `Word ${sel.word + 1} · line ${visibleNumber(lines, sel.line)}`}
                </span>
                <span className="min-w-0 truncate text-sm font-semibold text-text-primary">{targetText(lines, sel)}</span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-secondary">{selStart === null ? 'no time yet' : lrcStamp(selStart)}</span>
                {selStart !== null && selFrom !== null && Math.abs(selStart - selFrom) >= 0.005 && (
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-accent">{offsetText(selStart - selFrom)}</span>
                )}
                <span className="flex-1" />
                {editText && (
                  <button onClick={clear} disabled={selStart === null} title="Take its time away (Delete)" className={MINI_BTN}>
                    <Eraser size={12} /> Clear
                  </button>
                )}
                {original && (
                  <button onClick={reset} disabled={!selMoved} title="Put it back where it was" className={MINI_BTN}>
                    <RotateCcw size={12} /> Reset
                  </button>
                )}
                <button onClick={() => setSel(null)} title="Pick nothing (Esc)" className={`${MINI_BTN} w-7 justify-center px-0`}>
                  <X size={13} />
                </button>
              </>
            ) : (
              <p className="min-w-0 truncate text-[11px] text-text-muted">
                {!clock.ready
                  ? 'Play the song to start stamping.'
                  : cursorLabel
                    ? <>Press <Kbd>Space</Kbd> as <span className="text-text-secondary font-semibold">{cursorLabel}</span> is sung. Pick a {mode === 'words' ? 'word' : 'line'} to move it.</>
                    : <>Everything has a time. Pick a {mode === 'words' ? 'word' : 'line'} that comes in early or late to move it.</>}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => stamp(true)}
              disabled={!clock.ready || !cursor}
              title="Stamp it where the song is and pick the next (Space)"
              className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-accent text-white text-xs font-bold hover:bg-accent/90 transition-colors disabled:opacity-40"
            >
              <Clock size={13} /> Stamp
            </button>
            <button onClick={() => nudge(-step)} disabled={!sel || selStart === null} title="Earlier (←, Shift for 5×)" className={SMALL_BTN}>
              <ChevronLeft size={14} /> Earlier
            </button>
            <button onClick={() => nudge(step)} disabled={!sel || selStart === null} title="Later (→, Shift for 5×)" className={SMALL_BTN}>
              Later <ChevronRight size={14} />
            </button>
            <Segmented
              label="Nudge size"
              options={STEPS.map((s) => ({ value: s, label: `${Math.round(s * 1000)}ms`, title: 'How far one nudge moves it' }))}
              value={step}
              onChange={chooseStep}
            />
            <span className="flex-1" />
            <button onClick={() => stamp(false)} disabled={!clock.ready || !sel} title="Start it where the song is now (Enter)" className={SMALL_BTN}>
              <Crosshair size={13} /> To playhead
            </button>
            <button onClick={() => { if (replayTarget) hear(replayTarget) }} disabled={!clock.ready || replayStart === null} title="Replay the last stamp or your pick (R)" className={SMALL_BTN}>
              <Ear size={13} /> Hear it
            </button>
          </div>
        </div>
      )}

      {/* Transport */}
      <div className="flex items-center gap-3 px-3 py-2.5 border-t border-[var(--border)] bg-surface/60">
        {clock.ready ? (
          <>
            <button
              onClick={() => clock.setPlaying(!clock.playing)}
              title={clock.playing ? 'Pause (Ctrl+Space)' : 'Play (Ctrl+Space)'}
              className="w-9 h-9 shrink-0 rounded-full bg-accent text-white flex items-center justify-center hover:bg-accent/90 transition-colors"
            >
              {clock.playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="translate-x-px" />}
            </button>
            <span ref={clockTextRef} className="w-10 text-right text-[11px] tabular-nums text-text-muted">0:00</span>
            <div className="relative flex-1 h-4 flex items-center">
              <div className="relative w-full h-1.5 rounded-full bg-surface-highest overflow-hidden">
                <div ref={fillRef} className="h-full w-full origin-left bg-accent/80" style={{ transform: 'scaleX(0)' }} />
                {ticks.map((x, k) => (
                  <span key={k} className="absolute top-0 bottom-0 w-px bg-text-primary/35" style={{ left: `${x * 100}%` }} />
                ))}
              </div>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.01}
                aria-label="Seek"
                onChange={(e) => clock.seek(Number(e.target.value))}
                onPointerUp={(e) => e.currentTarget.blur()}
                className="absolute inset-0 w-full opacity-0 cursor-pointer"
              />
            </div>
            <span className="w-10 text-[11px] tabular-nums text-text-muted">{formatDuration(duration)}</span>
            <Segmented
              label="Speed"
              options={RATES.map((r) => ({ value: r, label: `${r}×`, title: r < 1 ? 'Slower, for fast verses' : 'Normal speed' }))}
              value={clock.rate}
              onChange={clock.setRate}
            />
          </>
        ) : noAudio}
      </div>

      {((editText && hasLines) || footer) && (
        <div className="flex flex-wrap items-center gap-3 px-3 py-2 border-t border-[var(--border)]">
          {editText && hasLines && (
            <>
              <button onClick={addLine} className="inline-flex items-center gap-1 text-[11px] font-semibold text-text-muted hover:text-accent transition-colors">
                <Plus size={12} /> Add line{sel ? ' below' : ''}
              </button>
              <span className="text-[11px] text-text-muted/70">Double-click a line to change its words, or its time to type one.</span>
            </>
          )}
          <span className="flex-1" />
          {footer}
        </div>
      )}
    </div>
  )
}

const NONE = -2

/** A line's number counting only the shown lines, from 1. */
function visibleNumber(lines: SyncLine[], i: number): number {
  let n = 0
  for (let k = 0; k <= i; k++) if (!lines[k].hidden) n++
  return n
}

/** A target's words, for the bar and the hint. */
function targetText(lines: SyncLine[], t: SyncTarget): string {
  const l = lines[t.line]
  if (!l) return ''
  if (t.word === null) return l.text || '♪'
  return `"${wordsOf(l)[t.word]?.text ?? ''}"`
}

interface RowMarks {
  /** The line's start: before one above it, moved from the original. */
  lineOut: boolean
  lineMoved: boolean
  /** Comma-joined word indexes, so the row can stay memoized. */
  wordsOut: string
  wordsMoved: string
}

function rowMarks(lines: SyncLine[], i: number, order: Set<string>, original: SyncLine[] | null, mode: SyncMode): RowMarks {
  const l = lines[i]
  const out: string[] = []
  const moved: string[] = []
  if (mode === 'words') {
    wordsOf(l).forEach((_, j) => {
      if (order.has(`${i}.${j}`)) out.push(String(j))
      if (original && isMoved(lines, original, { line: i, word: j })) moved.push(String(j))
    })
  }
  return {
    lineOut: order.has(`${i}`),
    lineMoved: !!original && original[i]?.text === l.text && lineStart(original[i]) !== lineStart(l),
    wordsOut: out.join(','),
    wordsMoved: moved.join(','),
  }
}

interface RowActions {
  pick: (t: SyncTarget) => void
  editTime: (line: number) => void
  editText: (line: number) => void
  commitTime: (line: number, draft: string) => void
  commitText: (line: number, draft: string) => void
  cancelEdit: () => void
  remove: (line: number) => void
}

const Row = memo(function Row({ line: l, index: i, words, now, past, started, litWord, sel, cursor, flash, marks, editing, editText, readOnly, canSeek, actions }: {
  line: SyncLine
  index: number
  words: boolean
  now: boolean
  past: boolean
  started: boolean
  litWord: number
  /** NONE, -1 for the whole line, or a word index. Same for cursor and flash. */
  sel: number
  cursor: number
  flash: number
  marks: RowMarks
  editing: 'time' | 'text' | null
  editText: boolean
  /** A preview: clicks seek, nothing opens for typing. */
  readOnly: boolean
  canSeek: boolean
  actions: RowActions
}): JSX.Element {
  const start = lineStart(l)
  const tone = !started ? 'text-text-secondary' : now ? 'text-text-primary' : past ? 'text-text-muted' : 'text-text-muted/80'
  const wordsOut = marks.wordsOut ? new Set(marks.wordsOut.split(',').map(Number)) : null
  const wordsMoved = marks.wordsMoved ? new Set(marks.wordsMoved.split(',').map(Number)) : null
  const ws = words ? wordsOf(l) : []
  return (
    <div
      data-line={i}
      onClick={() => actions.pick({ line: i, word: null })}
      onDoubleClick={(e) => { if (editText && !(e.target as HTMLElement).closest('[data-chip]')) actions.editText(i) }}
      className={`group relative flex items-baseline gap-3 px-3 py-1.5 rounded-lg cursor-pointer transition-colors duration-300 ${
        sel === -1 ? 'bg-accent/10 ring-1 ring-inset ring-accent/40' : cursor === -1 ? 'ring-1 ring-inset ring-accent/25' : 'hover:bg-surface-overlay/70'
      } ${flash === -1 ? '!bg-accent/20' : ''}`}
    >
      <span className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-accent transition-opacity duration-300 ${now ? 'opacity-100' : 'opacity-0'}`} />
      {editing === 'time' ? (
        <EditField
          initial={start === null ? '' : lrcStamp(start)}
          placeholder="0:00.00"
          className="w-[62px] shrink-0 font-mono text-[11px] text-center"
          onCommit={(d) => actions.commitTime(i, d)}
          onCancel={actions.cancelEdit}
        />
      ) : (
        <span
          data-chip
          onDoubleClick={(e) => { e.stopPropagation(); if (!readOnly) actions.editTime(i) }}
          title={marks.lineOut ? 'Starts before a line above it' : readOnly ? (l.estimated ? 'Estimated timing' : undefined)
            : l.estimated ? 'Estimated timing. Double-click to type a time' : 'Double-click to type a time'}
          className={`w-[62px] shrink-0 font-mono text-[11px] tabular-nums transition-colors ${l.estimated ? 'italic' : ''} ${
            marks.lineOut ? `text-amber-300 ${ORDER_MARK}` : now ? 'text-accent' : start === null ? 'text-text-muted/50' : `text-text-muted ${canSeek ? 'group-hover:text-accent' : ''}`
          } ${marks.lineMoved && !marks.lineOut ? MOVED_MARK : ''}`}
        >
          {start === null ? '–:––.––' : `${l.estimated ? '~' : ''}${lrcStamp(start)}`}
        </span>
      )}
      {editing === 'text' ? (
        <EditField
          initial={l.text}
          placeholder="Lyric line"
          className="flex-1 min-w-0 text-[14px]"
          onCommit={(d) => actions.commitText(i, d)}
          onCancel={actions.cancelEdit}
        />
      ) : (
        <span className={`flex-1 min-w-0 text-[15px] font-medium leading-snug transition-colors duration-300 ${tone}`}>
          {words && ws.length
            ? ws.map((w, j) => {
              const picked = sel === j
              const next = cursor === j
              const out = wordsOut?.has(j)
              const moved = wordsMoved?.has(j)
              const sung = now && j <= litWord
              return (
                <span key={j}>
                  <span
                    onClick={(e) => { e.stopPropagation(); actions.pick({ line: i, word: j }) }}
                    title={w.start === null ? 'No time yet' : `${lrcStamp(w.start)}${w.estimated ? ' · estimated' : ''}${out ? ' · before a word above it' : ''}`}
                    className={`rounded-sm px-px transition-colors duration-200 hover:bg-surface-raised ${
                      sung ? 'text-accent' : now ? 'text-text-secondary' : ''
                    } ${w.start === null ? 'opacity-55' : ''} ${
                      out ? ORDER_MARK : moved ? MOVED_MARK : w.estimated ? ESTIMATED_MARK : ''
                    } ${picked ? 'bg-accent/20 ring-1 ring-accent/60 !text-text-primary !opacity-100' : next ? 'outline outline-1 outline-dashed outline-accent/50' : ''} ${
                      flash === j ? '!bg-accent/30' : ''
                    }`}
                  >
                    {w.text}
                  </span>
                  {j < ws.length - 1 ? ' ' : ''}
                </span>
              )
            })
            : <span className={l.estimated && l.text ? ESTIMATED_MARK : undefined}>{l.text || '♪'}</span>}
        </span>
      )}
      {editText && editing === null && (
        <button
          onClick={(e) => { e.stopPropagation(); actions.remove(i) }}
          title="Remove this line"
          className="shrink-0 self-center p-1 rounded text-text-muted opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-red-400 transition-opacity"
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
})

/** An inline field that commits on Enter or blur and gives up on Escape. */
function EditField({ initial, placeholder, className, onCommit, onCancel }: {
  initial: string
  placeholder: string
  className: string
  onCommit: (draft: string) => void
  onCancel: () => void
}): JSX.Element {
  const [draft, setDraft] = useState(initial)
  const done = useRef(false)
  return (
    <input
      autoFocus
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => { if (!done.current) { done.current = true; onCommit(draft) } }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') { e.stopPropagation(); done.current = true; onCancel() }
      }}
      className={`rounded border border-accent/50 bg-surface-overlay px-1.5 py-0.5 text-text-primary focus:outline-none ${className}`}
    />
  )
}
