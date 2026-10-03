import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Pause, Plus, X, Clock, Rewind, RotateCcw, Keyboard, ChevronsDown } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { seekAudio, getAudioCurrentTime, getAudioDuration } from './Player'
import { songToTrack } from '../lib/juicewrldApi'
import type { JWApiSong } from '../lib/juicewrldApi'
import { trackIdToSongId } from '../lib/userApi'
import { parseSynced, serializeSynced, type SyncedLine } from '../lib/editorPageShared'

/* Manual lyric syncing, modelled on the stamping tools of the Whisper project
   (minus the AI transcription): play the song, hit Space to stamp the current
   time onto the selected line, and fine-tune with the rewind/replay keys. It
   edits the same LRC text the "Lines"/"Raw" views do, so everything stays in
   one source of truth. */

const REWIND_KEY = 'editor:syncRewind'
const DEFAULT_REWIND = 0.1

const pad2 = (n: number): string => String(n).padStart(2, '0')
const round3 = (n: number): number => Math.round(n * 1000) / 1000

// mm:ss.xx - the form the app's LRC parser reads (seconds need two digits).
function stampStr(s: number): string {
  const cs = Math.max(0, Math.round(s * 100))
  const m = Math.floor(cs / 6000)
  const rem = cs % 6000
  return `${pad2(m)}:${pad2(Math.floor(rem / 100))}.${pad2(rem % 100)}`
}

// Display form: same digits, no zero-padded minutes.
function fmtTime(s: number): string {
  return stampStr(s).replace(/^0(?=\d:)/, '')
}

// null for an empty stamp or a metadata tag like "ar: Juice WRLD".
function parseTime(raw: string): number | null {
  const v = raw.trim()
  let m = /^(\d+):(\d{1,2})(?:[.:](\d{1,3}))?$/.exec(v)
  if (m) return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(`0.${m[3]}`) : 0)
  m = /^(\d+(?:\.\d+)?)$/.exec(v)
  return m ? Number(m[1]) : null
}

function loadRewind(): number {
  try {
    const n = parseFloat(localStorage.getItem(REWIND_KEY) ?? '')
    return n > 0 ? n : DEFAULT_REWIND
  } catch { return DEFAULT_REWIND }
}

const isTyping = (el: EventTarget | null): boolean => {
  const t = el as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

const KEYS: Array<[string, string]> = [
  ['Space', 'Stamp current time onto the selected line, then move to the next'],
  ['← →', 'Select previous / next line and jump to it'],
  ['Ctrl + ← →', 'Select previous / next line without seeking'],
  ['↑ ↓', 'Seek 1s back / forward'],
  ['C', 'Nudge the selected line earlier by the rewind step and replay it'],
  ['X', 'Replay the selected line'],
  ['V', 'Seek 1s forward'],
  ['Ctrl + Space', 'Play / pause'],
  ['Shift', 'Toggle auto-scroll'],
]

export default function LyricsSyncTool({ value, onChange, plainLyrics, song }: {
  value: string
  onChange: (v: string) => void
  /** Plain lyrics, used to seed the line list when there are no synced lines yet. */
  plainLyrics: string
  /** Song being edited - the tool only syncs against it while it's the one playing. */
  song: JWApiSong | null
}): JSX.Element {
  const { currentTrack, isPlaying, setIsPlaying, playTrack } =
    useStorePick('currentTrack', 'isPlaying', 'setIsPlaying', 'playTrack')

  const rows = useMemo(() => parseSynced(value), [value])
  const times = useMemo(() => rows.map(r => parseTime(r.time)), [rows])
  const isThisSong = !!song && !!currentTrack && trackIdToSongId(currentTrack.id) === song.id

  const [sel, setSel] = useState(-1)
  const [follow, setFollow] = useState(true)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [clock, setClock] = useState(0)
  const [duration, setDuration] = useState(0)
  const [flashIdx, setFlashIdx] = useState(-1)
  const [editTime, setEditTime] = useState<{ i: number; draft: string } | null>(null)
  const [editText, setEditText] = useState<{ i: number; draft: string } | null>(null)
  const [rewind, setRewind] = useState(loadRewind)
  const [shiftTotal, setShiftTotal] = useState(0)
  const [showKeys, setShowKeys] = useState(false)
  const [playError, setPlayError] = useState<string | null>(null)

  const listRef = useRef<HTMLDivElement>(null)
  const timesRef = useRef(times)
  timesRef.current = times

  // The line actions apply to: the selected one, else the first unstamped line
  // (so a fresh tap-through starts at the top), else whatever is playing.
  const firstUntimed = times.findIndex(t => t === null)
  const active = isThisSong ? activeIdx : -1
  const effSel = sel >= 0 && sel < rows.length ? sel : firstUntimed >= 0 ? firstUntimed : active

  const commit = (next: SyncedLine[]): void => onChange(serializeSynced(next))
  const update = (i: number, patch: Partial<SyncedLine>): void =>
    commit(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const flash = (i: number): void => {
    setFlashIdx(i)
    window.setTimeout(() => setFlashIdx(cur => (cur === i ? -1 : cur)), 350)
  }

  const jump = (t: number, resume = true): void => {
    seekAudio(Math.max(0, t))
    if (resume) setIsPlaying(true)
  }

  const select = (i: number, seek: boolean): void => {
    setSel(i)
    const t = times[i]
    if (seek && isThisSong && t !== null) jump(t)
  }

  const stamp = (): void => {
    if (!isThisSong || effSel < 0 || effSel >= rows.length) return
    update(effSel, { time: stampStr(getAudioCurrentTime()) })
    flash(effSel)
    setSel(Math.min(rows.length - 1, effSel + 1))
  }

  const nudgeLineEarlier = (): void => {
    const t = times[effSel]
    if (!isThisSong || effSel < 0 || t === null) return
    const next = Math.max(0, round3(t - rewind))
    update(effSel, { time: stampStr(next) })
    jump(next)
  }

  const replayLine = (): void => {
    const t = times[effSel]
    if (isThisSong && effSel >= 0 && t !== null) jump(t)
  }

  const skip = (d: number): void => {
    if (isThisSong) seekAudio(Math.max(0, getAudioCurrentTime() + d))
  }

  // Shifts every stamped line at once (rewrites the stamps, like whisper's
  // ±0.1s buttons). A negative shift is clamped so the earliest line stays
  // at 0 and the spacing between lines is preserved.
  const shiftAll = (delta: number): void => {
    const stamped = times.filter((t): t is number => t !== null)
    if (!stamped.length) return
    if (delta < 0) delta = Math.max(delta, -Math.min(...stamped))
    if (delta === 0) return
    commit(rows.map((r, i) => (times[i] === null ? r : { ...r, time: stampStr(round3((times[i] as number) + delta)) })))
    setShiftTotal(s => Math.round((s + delta) * 10) / 10)
  }

  const removeLine = (i: number): void => {
    commit(rows.filter((_, j) => j !== i))
    setSel(s => (s > i ? s - 1 : s === i ? -1 : s))
  }

  const addLine = (): void => {
    commit([...rows, { time: '', text: '' }])
    setEditText({ i: rows.length, draft: '' })
    setSel(rows.length)
  }

  const seedFromPlain = (): void =>
    commit(plainLyrics.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(text => ({ time: '', text })))

  const playThisSong = (): void => {
    if (!song) return
    const track = songToTrack(song)
    if (!track.path) { setPlayError('No file on this song to play'); return }
    setPlayError(null)
    playTrack(track, [track])
  }

  const commitTime = (): void => {
    if (!editTime) return
    const { i, draft } = editTime
    setEditTime(null)
    if (draft.trim() === '') { update(i, { time: '' }); return }
    const t = parseTime(draft)
    if (t !== null) update(i, { time: stampStr(t) })
  }

  const commitText = (): void => {
    if (!editText) return
    const { i, draft } = editText
    setEditText(null)
    if (rows[i] && draft !== rows[i].text) update(i, { text: draft.trim() })
  }

  // Playback clock → active line + readout. Only runs while this song is the
  // one playing; the lyric list is highlighted off the live audio time rather
  // than the store's (4x/sec) value so the highlight tracks tightly.
  useEffect(() => {
    if (!isThisSong) return
    let raf = 0
    let lastTenth = -1
    const tick = (): void => {
      const t = getAudioCurrentTime()
      const tenth = Math.floor(t * 10)
      if (tenth !== lastTenth) {
        lastTenth = tenth
        setClock(t)
        setDuration(getAudioDuration())
      }
      let idx = -1
      const ts = timesRef.current
      for (let i = 0; i < ts.length; i++) {
        const x = ts[i]
        if (x === null) continue
        if (x <= t) idx = i
        else break
      }
      setActiveIdx(idx)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isThisSong])

  // Centre a row by scrolling the list itself - scrollIntoView would also drag
  // the whole editor page along.
  const centerRow = (i: number, behavior: ScrollBehavior): void => {
    const box = listRef.current
    const el = box?.querySelector<HTMLElement>(`[data-row="${i}"]`)
    if (!box || !el) return
    box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2, behavior })
  }
  useEffect(() => { if (follow && active >= 0) centerRow(active, 'smooth') }, [active, follow])
  useEffect(() => { if (sel >= 0) centerRow(sel, 'smooth') }, [sel])

  // Keyboard shortcuts, active whenever focus isn't in a text field. The
  // handler is reassigned each render so the single listener below always sees
  // fresh state without re-subscribing.
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {})
  keyHandler.current = (e: KeyboardEvent): void => {
    if (isTyping(e.target) || e.altKey || e.metaKey) return
    if (e.key === 'Shift') {
      if (!e.repeat) setFollow(f => !f)
      return
    }
    const ctrl = e.ctrlKey
    switch (e.key) {
      case ' ':
        e.preventDefault()
        if (ctrl) { if (isThisSong) setIsPlaying(!isPlaying) } else stamp()
        break
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (!rows.length) return
        e.preventDefault()
        const base = effSel >= 0 ? effSel : 0
        const i = Math.min(rows.length - 1, Math.max(0, base + (e.key === 'ArrowRight' ? 1 : -1)))
        select(i, !ctrl)
        break
      }
      case 'ArrowUp': e.preventDefault(); skip(-1); break
      case 'ArrowDown': e.preventDefault(); skip(1); break
      case 'v': case 'V': e.preventDefault(); skip(1); break
      case 'c': case 'C': e.preventDefault(); nudgeLineEarlier(); break
      case 'x': case 'X': e.preventDefault(); replayLine(); break
    }
  }
  useEffect(() => {
    const on = (e: KeyboardEvent): void => keyHandler.current(e)
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  const stampedCount = times.filter(t => t !== null).length
  const small = 'px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-surface-overlay text-text-secondary text-[11px] font-semibold hover:text-text-primary hover:border-accent/40 transition-colors disabled:opacity-35 disabled:hover:text-text-secondary disabled:hover:border-[var(--border)]'

  return (
    <div
      className="mt-1.5 space-y-2.5"
      // Buttons never take focus, so Space/Enter after a click still reaches
      // the shortcuts instead of re-triggering the last-clicked button.
      onMouseDown={e => { if ((e.target as HTMLElement).closest('button')) e.preventDefault() }}
    >
      {/* Transport */}
      {isThisSong ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-[var(--border)] bg-surface-overlay/60 px-3 py-2">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            title="Play / pause (Ctrl+Space)"
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-accent text-white hover:opacity-90 transition-opacity"
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
          </button>
          <span className="shrink-0 font-mono text-[11px] text-text-secondary tabular-nums">
            {fmtTime(clock)} <span className="text-text-muted opacity-60">/ {fmtTime(duration)}</span>
          </span>
          <input
            type="range" min={0} max={duration || 1} step={0.1} value={Math.min(clock, duration || 1)}
            onChange={e => { setClock(Number(e.target.value)); seekAudio(Number(e.target.value)) }}
            onPointerUp={e => e.currentTarget.blur()}
            className="flex-1 min-w-0 accent-[var(--accent)]"
          />
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-[var(--border)] px-3 py-2.5 text-[12px] text-text-muted">
          <span className="flex-1">
            {song
              ? 'Play this song to sync it - stamping uses the player\'s clock.'
              : 'Open an existing song to sync lyrics against its audio.'}
            {playError && <span className="block text-red-400 mt-0.5">{playError}</span>}
          </span>
          {song && (
            <button onClick={playThisSong} className={`${small} shrink-0 flex items-center gap-1.5`}>
              <Play size={12} /> Play song
            </button>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={stamp} disabled={!isThisSong || effSel < 0}
          title="Stamp the current time onto the selected line (Space)"
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-accent text-white text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-35"
        >
          <Clock size={13} /> Stamp
        </button>
        <button onClick={nudgeLineEarlier} disabled={!isThisSong || times[effSel] == null} title={`Move the line ${rewind}s earlier and replay (C)`} className={`${small} flex items-center gap-1`}>
          <Rewind size={12} /> −{rewind}s
        </button>
        <button onClick={replayLine} disabled={!isThisSong || times[effSel] == null} title="Replay the selected line (X)" className={`${small} flex items-center gap-1`}>
          <RotateCcw size={12} /> Replay
        </button>
        <button onClick={() => skip(-1)} disabled={!isThisSong} title="Back 1s (↑)" className={small}>−1s</button>
        <button onClick={() => skip(1)} disabled={!isThisSong} title="Forward 1s (↓ / V)" className={small}>+1s</button>

        <div className="ml-auto flex items-center gap-1.5" title="Shift every stamped line - use when the whole lyric is early or late">
          <button onClick={() => shiftAll(-0.1)} disabled={!stampedCount} className={small}>−0.1s</button>
          <span className={`w-11 text-center font-mono text-[11px] tabular-nums ${shiftTotal !== 0 ? 'text-accent' : 'text-text-muted opacity-60'}`}>
            {shiftTotal > 0 ? '+' : ''}{shiftTotal.toFixed(1)}s
          </span>
          <button onClick={() => shiftAll(0.1)} disabled={!stampedCount} className={small}>+0.1s</button>
          <button
            onClick={() => setShowKeys(s => !s)} title="Keyboard shortcuts"
            className={`p-1.5 rounded-lg transition-colors ${showKeys ? 'text-accent bg-accent/10' : 'text-text-muted hover:text-text-primary'}`}
          >
            <Keyboard size={14} />
          </button>
        </div>
      </div>

      {showKeys && (
        <div className="rounded-xl border border-[var(--border)] bg-surface-overlay/60 px-3 py-2.5 space-y-1.5">
          {KEYS.map(([k, d]) => (
            <div key={k} className="flex items-baseline gap-3 text-[11px]">
              <kbd className="shrink-0 min-w-[84px] font-mono text-[10px] text-text-primary">{k}</kbd>
              <span className="text-text-muted">{d}</span>
            </div>
          ))}
          <label className="flex items-center gap-2 pt-1.5 border-t border-[var(--border)] text-[11px] text-text-muted">
            Rewind step (C)
            <input
              type="number" min={0.01} step={0.05} value={rewind}
              onChange={e => {
                const n = parseFloat(e.target.value)
                if (!(n > 0)) return
                setRewind(n)
                try { localStorage.setItem(REWIND_KEY, String(n)) } catch { /* ignore */ }
              }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
              className="w-16 rounded border border-[var(--border)] bg-surface-overlay px-1.5 py-0.5 text-[11px] text-text-primary focus:outline-none focus:border-accent/50"
            />
            s
          </label>
        </div>
      )}

      {/* Lines */}
      <div className="relative">
        <div
          ref={listRef}
          onWheel={() => setFollow(false)}
          onTouchMove={() => setFollow(false)}
          className="relative max-h-[340px] overflow-y-auto pr-0.5 space-y-0.5"
        >
          {rows.map((r, i) => {
            const t = times[i]
            const isActive = i === active
            const isSel = i === effSel
            const isPast = active >= 0 && i < active
            return (
              <div
                key={i}
                data-row={i}
                onClick={() => { if (editText?.i !== i) select(i, true) }}
                onDoubleClick={e => { if (!(e.target as HTMLElement).closest('[data-chip]')) setEditText({ i, draft: r.text }) }}
                className={`group flex items-center gap-2 rounded-lg px-1.5 py-1 cursor-pointer transition-colors ${
                  isActive ? 'bg-accent/10' : 'hover:bg-surface-overlay/60'
                } ${isSel ? 'outline outline-1 outline-accent/60' : ''} ${flashIdx === i ? '!outline-2 !outline-accent bg-accent/20' : ''}`}
              >
                {editTime?.i === i ? (
                  <input
                    autoFocus value={editTime.draft} placeholder="0:00.00"
                    onChange={e => setEditTime({ i, draft: e.target.value })}
                    onBlur={commitTime}
                    onClick={e => e.stopPropagation()}
                    onKeyDown={e => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') { setEditTime(null) }
                    }}
                    className="w-[76px] shrink-0 rounded border border-accent/50 bg-surface-overlay px-1.5 py-0.5 font-mono text-[11px] text-center text-text-primary focus:outline-none"
                  />
                ) : (
                  <span
                    data-chip
                    onClick={e => { e.stopPropagation(); setSel(i); setEditTime({ i, draft: t !== null ? stampStr(t) : r.time }) }}
                    title="Click to edit this line's time"
                    className={`w-[76px] shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px] text-center transition-colors hover:border-accent/50 ${
                      t !== null
                        ? 'border-[var(--border)] bg-surface-overlay text-text-primary'
                        : 'border-dashed border-[var(--border)] text-text-muted'
                    }`}
                  >
                    {t !== null ? fmtTime(t) : r.time.trim() ? r.time : '–:––'}
                  </span>
                )}
                {editText?.i === i ? (
                  <input
                    autoFocus value={editText.draft}
                    onChange={e => setEditText({ i, draft: e.target.value })}
                    onBlur={commitText}
                    onClick={e => e.stopPropagation()}
                    onKeyDown={e => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') { setEditText(null) }
                    }}
                    className="flex-1 min-w-0 rounded border border-accent/50 bg-surface-overlay px-1.5 py-0.5 text-[13px] text-text-primary focus:outline-none"
                  />
                ) : (
                  <span className={`flex-1 min-w-0 truncate text-[13px] select-none ${
                    isActive ? 'font-semibold text-text-primary' : t === null ? 'text-text-muted' : isPast ? 'text-text-muted opacity-70' : 'text-text-secondary'
                  }`}>
                    {r.text || <span className="opacity-40">empty line</span>}
                  </span>
                )}
                <button
                  onClick={e => { e.stopPropagation(); removeLine(i) }}
                  title="Remove line"
                  className="shrink-0 p-1 rounded text-text-muted opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-red-400 transition-all"
                >
                  <X size={12} />
                </button>
              </div>
            )
          })}
          {rows.length === 0 && (
            <div className="py-3 text-[12px] text-text-muted space-y-2">
              <p className="opacity-70">No lines yet.</p>
              {plainLyrics.trim() && (
                <button onClick={seedFromPlain} className={small}>Start from the plain lyrics</button>
              )}
            </div>
          )}
        </div>
        {!follow && active >= 0 && (
          <button
            onClick={() => { setFollow(true); centerRow(active, 'smooth') }}
            className="absolute left-1/2 -translate-x-1/2 bottom-2 flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/15 text-white/85 text-[11px] font-medium hover:bg-black/75 transition-colors"
          >
            <ChevronsDown size={12} /> Resume auto-scroll
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button onClick={addLine} className="flex items-center gap-1 text-[11px] font-semibold text-text-muted opacity-70 hover:opacity-100 hover:text-accent transition-colors">
          <Plus size={11} /> Add line
        </button>
        {rows.length > 0 && (
          <span className="text-[11px] text-text-muted opacity-60 tabular-nums">{stampedCount}/{rows.length} stamped</span>
        )}
        {isThisSong && !isPlaying && rows.length > 0 && stampedCount === 0 && (
          <span className="flex items-center gap-1 text-[11px] text-text-muted opacity-60">Press play, then Space on each line as it's sung.</span>
        )}
      </div>
    </div>
  )
}
