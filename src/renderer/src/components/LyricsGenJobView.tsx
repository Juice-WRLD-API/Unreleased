import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle, AlignLeft, Ban, Check, ChevronLeft, CircleStop, Copy, Download, FileAudio, Hourglass, Info, Loader2, Pause, PencilLine, Play,
  RotateCcw, Trash2, WholeWord,
} from 'lucide-react'
import {
  cancelAdminLyricsJob, deleteLyricsJob, getAdminLyricsJob, getLyricsJob, isFinished, lrcToPlain,
  type LyricsAdminJob, type LyricsGenJob, type LyricsGenMode, type LyricsOutput, type LyricsSegment,
} from '../lib/lyricsGenApi'
import { isAbortError } from '../lib/apiClient'
import { errorMessage, formatDuration } from '../lib/format'
import { showAppToast } from '../lib/appToast'
import { pickLocalFile } from '../lib/terminal/pick'
import { relativeTime } from './adminShared'
import {
  ConfirmButton, MODE_INFO, ModeTile, OUTPUT_LABEL, StatusPill, downloadJobOutput, lrcTime, outputName, outputsFor, saveText, timedLines,
} from './lyricsGenShared'

// One lyrics job in the "Generate lyrics" dialog: followed live while it waits
// and runs, then its result - an editable transcript, or the synced lines with
// a play-along preview - with downloads and the next step (sync the reviewed
// text, or upgrade line sync to per-word). Administrators open other users'
// jobs here too, through the admin routes, and can cancel one that is running.

const POLL_MS = 3000

const SMALL_BTN = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold text-text-secondary bg-surface-overlay hover:bg-surface-raised hover:text-text-primary transition-colors disabled:opacity-50'
const SECTION_LABEL = 'text-[11px] font-semibold uppercase tracking-wider text-text-muted'

export default function LyricsGenJobView({ jobId, admin, audio, backLabel, onBack, onContinue, onRetry, onDeleted, onUpdate }: {
  jobId: string
  /** Read (and cancel) through the administrator routes. */
  admin: boolean
  /** The audio the dialog holds; used for the play-along when it's this job's file. */
  audio: File | null
  backLabel: string
  onBack: () => void
  /** Start a sync job from this result's text. */
  onContinue: (job: LyricsGenJob, mode: LyricsGenMode, text: string) => void
  /** Back to the form with this failed job's settings. */
  onRetry: (job: LyricsGenJob) => void
  onDeleted: (id: string) => void
  onUpdate?: (job: LyricsGenJob) => void
}): JSX.Element {
  const [job, setJob] = useState<LyricsGenJob | LyricsAdminJob | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState<'delete' | 'cancel' | null>(null)

  // Follow the job until it finishes. A failed poll on a job already shown
  // just tries again later; only a first load that fails shows an error.
  useEffect(() => {
    const ac = new AbortController()
    let timer = 0
    let shown = false
    const load = async (): Promise<void> => {
      try {
        const j = admin ? await getAdminLyricsJob(jobId, ac.signal) : await getLyricsJob(jobId, ac.signal)
        shown = true
        setJob(j)
        setLoadError(null)
        if (!isFinished(j)) timer = window.setTimeout(load, POLL_MS)
      } catch (e) {
        if (isAbortError(e) || ac.signal.aborted) return
        if (shown) timer = window.setTimeout(load, POLL_MS * 2)
        else setLoadError(errorMessage(e, 'Could not load this job'))
      }
    }
    void load()
    return () => { ac.abort(); window.clearTimeout(timer) }
  }, [jobId, admin, attempt])

  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate
  useEffect(() => { if (job) onUpdateRef.current?.(job) }, [job])

  const remove = async (): Promise<void> => {
    setBusy('delete')
    try {
      await deleteLyricsJob(jobId)
      onDeleted(jobId)
    } catch (e) {
      showAppToast(errorMessage(e, 'Could not delete this job'))
      setBusy(null)
    }
  }

  const cancel = async (): Promise<void> => {
    setBusy('cancel')
    try {
      setJob(await cancelAdminLyricsJob(jobId))
    } catch (e) {
      showAppToast(errorMessage(e, 'Could not cancel this job'))
    } finally {
      setBusy(null)
    }
  }

  const user = job && 'user' in job ? job.user.username : null
  const playAlongAudio = audio && job && audio.name === job.filename ? audio : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 -mt-1">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 -ml-1.5 pl-1 pr-2.5 h-7 rounded-lg text-xs font-semibold text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
        >
          <ChevronLeft size={15} /> {backLabel}
        </button>
        {job && !admin && isFinished(job) && (
          <ConfirmButton icon={Trash2} label="Delete" confirmLabel="Delete preview?" busy={busy === 'delete'} onConfirm={() => void remove()} />
        )}
      </div>

      {!job ? (
        loadError ? (
          <div className="rounded-2xl border border-red-400/25 bg-red-400/5 px-5 py-8 flex flex-col items-center gap-2 text-center">
            <AlertCircle size={22} className="text-red-300" />
            <p className="text-sm text-text-primary font-medium">{loadError}</p>
            <button onClick={() => { setLoadError(null); setAttempt((n) => n + 1) }} className={`${SMALL_BTN} mt-1`}>
              <RotateCcw size={13} /> Try again
            </button>
          </div>
        ) : (
          <div className="py-16 flex justify-center"><Loader2 size={20} className="animate-spin text-text-muted" /></div>
        )
      ) : (
        <>
          <div className="flex items-center gap-3 min-w-0">
            <ModeTile mode={job.mode} status={job.status} size={42} />
            <div className="flex-1 min-w-0">
              <p className="text-text-primary text-sm font-semibold truncate" title={job.filename}>{job.filename || 'Untitled audio'}</p>
              <p className="text-text-muted text-xs truncate">
                {MODE_INFO[job.mode].title}
                {job.language && <> · <span className="uppercase">{job.language}</span></>}
                {' · '}{relativeTime(job.created_at)}
                {user && <> · by <span className="text-text-secondary">{user}</span></>}
              </p>
            </div>
            <StatusPill status={job.status} />
          </div>

          {(job.status === 'queued' || job.status === 'processing') && (
            <Working job={job} admin={admin} cancelling={busy === 'cancel'} onCancel={() => void cancel()} />
          )}

          {job.status === 'failed' && (
            <div className="rounded-2xl border border-red-400/25 bg-red-400/5 px-5 py-6 flex flex-col items-center gap-2 text-center">
              <AlertCircle size={22} className="text-red-300" />
              <p className="text-sm text-text-primary font-semibold">This job didn't finish</p>
              <p className="text-xs text-text-muted max-w-[360px] break-words">{job.error || 'The server gave no reason.'}</p>
              {!admin && (
                <button onClick={() => onRetry(job)} className={`${SMALL_BTN} mt-2`}>
                  <RotateCcw size={13} /> Change and try again
                </button>
              )}
            </div>
          )}

          {job.status === 'cancelled' && (
            <div className="rounded-2xl border border-[var(--border)] bg-surface-overlay/40 px-5 py-6 flex flex-col items-center gap-2 text-center">
              <Ban size={22} className="text-text-muted" />
              <p className="text-sm text-text-primary font-semibold">Cancelled</p>
              {job.error && <p className="text-xs text-text-muted">{job.error}</p>}
            </div>
          )}

          {job.status === 'completed' && (job.mode === 'plain'
            ? <Transcript job={job} admin={admin} onContinue={(m, t) => onContinue(job, m, t)} />
            : <SyncedResult job={job} admin={admin} audio={playAlongAudio} onContinue={(m, t) => onContinue(job, m, t)} />)}
        </>
      )}
    </div>
  )
}

// While the job waits for the worker or runs: what's happening, and that
// closing the dialog doesn't stop it.
function Working({ job, admin, cancelling, onCancel }: {
  job: LyricsGenJob
  admin: boolean
  cancelling: boolean
  onCancel: () => void
}): JSX.Element {
  const queued = job.status === 'queued'
  const title = queued ? 'Waiting for its turn' : job.mode === 'plain' ? 'Listening to the song' : 'Lining the words up with the audio'
  const blurb = queued
    ? 'Jobs run one at a time on the server. This one starts as soon as the worker is free.'
    : job.mode === 'plain'
      ? 'Whisper is writing down what it hears. A full song usually takes a few minutes.'
      : 'Each line is matched to where it is sung, word by word. Your text is kept exactly as written.'
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-surface-overlay/30 px-6 py-10 flex flex-col items-center text-center">
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{ background: `radial-gradient(70% 90% at 50% 0%, ${queued ? 'rgb(251 191 36 / 0.10)' : 'rgb(var(--accent-rgb) / 0.16)'}, transparent 70%)` }}
      />
      <div className={`relative w-20 h-20 rounded-full flex items-center justify-center border ${queued ? 'bg-amber-400/10 border-amber-400/25' : 'bg-accent/10 border-accent/25'}`}>
        {queued
          ? <Hourglass size={26} className="text-amber-300 animate-pulse" />
          : (
            <div className="flex items-end gap-[5px] h-8" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className="eq-bar w-[5px] h-full rounded-full bg-accent" style={{ animationDelay: `${-0.17 * i}s`, animationDuration: `${0.8 + (i % 3) * 0.15}s` }} />
              ))}
            </div>
          )}
      </div>
      <p className="relative mt-5 text-text-primary text-[15px] font-semibold">{title}</p>
      <p className="relative mt-1.5 text-text-muted text-xs leading-relaxed max-w-[340px]">{blurb}</p>
      <p className="relative mt-5 text-[11px] text-text-muted/80">
        {admin ? `Started ${relativeTime(job.created_at)}.` : 'You can close this window. The job keeps going and waits under Your jobs.'}
      </p>
      {admin && (
        <div className="relative mt-3">
          <ConfirmButton icon={CircleStop} label="Cancel job" confirmLabel="Cancel this job?" busy={cancelling} onConfirm={onCancel} />
        </div>
      )}
    </div>
  )
}

function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 1800)
    return () => window.clearTimeout(t)
  }, [copied])
  return [copied, (text) => { navigator.clipboard.writeText(text).then(() => setCopied(true), () => showAppToast('Could not copy')) }]
}

function useDownload(job: LyricsGenJob, admin: boolean): [LyricsOutput | null, (output: LyricsOutput) => void] {
  const [busy, setBusy] = useState<LyricsOutput | null>(null)
  const run = (output: LyricsOutput): void => {
    if (busy) return
    setBusy(output)
    downloadJobOutput(job, output, admin)
      .catch((e) => showAppToast(errorMessage(e, 'Could not download the lyrics')))
      .finally(() => setBusy(null))
  }
  return [busy, run]
}

// A plain job: Whisper's lines, editable here before they go on to be synced.
function Transcript({ job, admin, onContinue }: {
  job: LyricsGenJob
  admin: boolean
  onContinue: (mode: LyricsGenMode, text: string) => void
}): JSX.Element {
  const original = job.result.plain_lyrics?.trim() ?? ''
  const [draft, setDraft] = useState(original)
  const [copied, copy] = useCopied()
  const [downloading, download] = useDownload(job, admin)
  const edited = draft !== original
  const lines = draft.split('\n').filter((l) => l.trim()).length

  return (
    <>
      <section>
        <div className="flex items-baseline justify-between mb-2">
          <p className={SECTION_LABEL}>Transcript</p>
          <span className="text-[11px] text-text-muted tabular-nums">{lines} line{lines === 1 ? '' : 's'}{edited && ' · edited'}</span>
        </div>
        {original ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="w-full h-72 resize-none rounded-xl border border-[var(--border)] bg-surface-overlay/40 px-4 py-3 text-sm leading-relaxed text-text-primary focus:outline-none focus:border-accent/60 transition-colors"
          />
        ) : (
          <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-text-muted">
            Whisper didn't hear any words in this audio.
          </p>
        )}
        {original && (
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <button onClick={() => copy(draft)} className={SMALL_BTN}>
              {copied ? <Check size={13} className="text-emerald-300" /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={() => (edited ? saveText(draft, outputName(job.filename, 'txt')) : download('txt'))}
              disabled={downloading === 'txt'}
              className={SMALL_BTN}
            >
              {downloading === 'txt' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Download .txt
            </button>
            {edited && (
              <button onClick={() => setDraft(original)} className={SMALL_BTN}>
                <RotateCcw size={13} /> Undo edits
              </button>
            )}
          </div>
        )}
      </section>

      {!admin && original && (
        <NextStep
          title="Time these lines to the song"
          blurb="Fix any mistakes above first. Syncing keeps your text exactly as written, one line per line."
        >
          <button onClick={() => onContinue('synced', draft)} disabled={!draft.trim()} className={NEXT_BTN}>
            <AlignLeft size={15} /> Line sync
          </button>
          <button onClick={() => onContinue('word_synced', draft)} disabled={!draft.trim()} className={NEXT_BTN}>
            <WholeWord size={15} /> Word sync
          </button>
        </NextStep>
      )}
    </>
  )
}

const NEXT_BTN = 'flex-1 inline-flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-semibold bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-40'

function NextStep({ title, blurb, children }: { title: string; blurb: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/10 via-accent/5 to-transparent p-4">
      <p className="text-sm font-semibold text-text-primary">{title}</p>
      <p className="text-xs text-text-muted mt-0.5 leading-relaxed">{blurb}</p>
      <div className="flex gap-2 mt-3">{children}</div>
    </div>
  )
}

// A synced job: its lines with times, playable against the audio, or the raw LRC.
function SyncedResult({ job, admin, audio, onContinue }: {
  job: LyricsGenJob
  admin: boolean
  audio: File | null
  onContinue: (mode: LyricsGenMode, text: string) => void
}): JSX.Element {
  const [view, setView] = useState<'preview' | 'lrc'>('preview')
  const lines = useMemo(() => timedLines(job), [job])
  const words = job.mode === 'word_synced'
  const lrc = (words ? job.result.word_synced_lyrics : job.result.synced_lyrics)?.trim() ?? ''
  const [copied, copy] = useCopied()
  const [downloading, download] = useDownload(job, admin)
  const reviewText = (job.result.plain_lyrics || job.plain_lyrics || '').trim()
  const estimated = estimatedNote(job.result.unaligned_lines ?? 0, words ? job.result.unaligned_words ?? 0 : 0)

  return (
    <>
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex p-0.5 rounded-lg bg-surface-overlay text-xs font-semibold">
            {(['preview', 'lrc'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 h-7 rounded-md transition-colors ${view === v ? 'bg-surface-raised text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}
              >
                {v === 'preview' ? 'Play along' : words ? 'Word LRC' : 'LRC'}
              </button>
            ))}
          </div>
          {lines.length > 0 && (
            <span className="text-[11px] text-text-muted tabular-nums">
              {lines.length} line{lines.length === 1 ? '' : 's'} · ends {lrcTime(lines[lines.length - 1].end)}
            </span>
          )}
        </div>
        {estimated && (
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-text-muted">
            <Info size={12} className="mt-[3px] shrink-0" />
            <span>
              {estimated} Their timing is estimated and marked below. A misspelled or missing lyric is the usual cause
              {!admin && reviewText
                ? <>: <button onClick={() => onContinue(job.mode, reviewText)} className="font-semibold text-text-secondary hover:text-text-primary underline underline-offset-2 transition-colors">edit the text and sync again</button>.</>
                : '.'}
            </span>
          </p>
        )}
        {view === 'preview'
          ? <PlayAlong lines={lines} words={words} audio={audio} filename={job.filename} />
          : (
            <>
              <pre className="h-[380px] overflow-auto rounded-2xl border border-[var(--border)] bg-surface-overlay/30 px-4 py-3 text-xs leading-relaxed font-mono text-text-secondary whitespace-pre-wrap break-words select-text">
                {lrc}
              </pre>
              {estimated && <p className="text-[11px] text-text-muted">The file includes the estimated timings. LRC has no way to mark them.</p>}
            </>
          )}
        <div className="flex flex-wrap items-center gap-2">
          {outputsFor(job.mode).map((o) => (
            <button key={o} onClick={() => download(o)} disabled={downloading === o} className={SMALL_BTN}>
              {downloading === o ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {OUTPUT_LABEL[o]}
            </button>
          ))}
          <button onClick={() => copy(lrc)} className={SMALL_BTN}>
            {copied ? <Check size={13} className="text-emerald-300" /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy LRC'}
          </button>
        </div>
      </section>

      {!admin && job.mode === 'synced' && (
        <NextStep title="Time every word" blurb="Upgrade to per-word timing. Word sync gets these lyrics as plain text, without the line times.">
          <button onClick={() => onContinue('word_synced', reviewText || lrcToPlain(job.result.synced_lyrics ?? ''))} className={NEXT_BTN}>
            <WholeWord size={15} /> Word sync
          </button>
        </NextStep>
      )}
      {!admin && reviewText && (
        <button
          onClick={() => onContinue(job.mode, reviewText)}
          className="self-start inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-text-primary transition-colors"
        >
          <PencilLine size={13} /> Edit the text and sync again
        </button>
      )}
    </>
  )
}

/** "3 words couldn't be matched to the audio." or null when everything aligned. */
function estimatedNote(lines: number, words: number): string | null {
  const parts = [
    lines > 0 && `${lines} line${lines === 1 ? '' : 's'}`,
    words > 0 && `${words} word${words === 1 ? '' : 's'}`,
  ].filter(Boolean)
  return parts.length ? `${parts.join(' and ')} couldn't be matched to the audio.` : null
}

const ESTIMATED_MARK = 'underline decoration-dotted decoration-text-muted underline-offset-[5px]'

/** The line lit at `t`: the last one that has started. */
function lineAt(lines: LyricsSegment[], t: number): number {
  let lit = -1
  for (let i = 0; i < lines.length && lines[i].start <= t; i++) lit = i
  return lit
}

// The synced lines against the audio: the sung line lights up and stays in
// view, and in word mode its words fill in as they're sung. Clicking a line
// jumps there. Without the job's audio in hand, the lines show with their
// times and the audio can be picked here (it isn't uploaded).
function PlayAlong({ lines, words, audio, filename }: {
  lines: LyricsSegment[]
  words: boolean
  audio: File | null
  filename: string
}): JSX.Element {
  const [picked, setPicked] = useState<File | null>(null)
  const file = picked ?? audio
  const src = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => { if (src) URL.revokeObjectURL(src) }, [src])

  const audioRef = useRef<HTMLAudioElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const clockRef = useRef<HTMLSpanElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [lit, setLit] = useState({ line: -1, word: -1 })

  // Every frame while playing, the clock and scrubber are written straight to
  // the DOM; a re-render only happens when the lit line or word changes.
  useEffect(() => {
    const a = audioRef.current
    if (!a || !src) return
    let raf = 0
    const tick = (): void => {
      const t = a.currentTime
      if (clockRef.current) clockRef.current.textContent = formatDuration(t)
      if (fillRef.current && a.duration) fillRef.current.style.transform = `scaleX(${Math.min(t / a.duration, 1)})`
      const line = lineAt(lines, t)
      const ws = line >= 0 && words ? lines[line].words ?? [] : []
      let word = -1
      for (let i = 0; i < ws.length && ws[i].start <= t; i++) word = i
      setLit((p) => (p.line === line && p.word === word ? p : { line, word }))
      if (!a.paused) raf = requestAnimationFrame(tick)
    }
    const onPlay = (): void => { setPlaying(true); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick) }
    const onPause = (): void => { setPlaying(false); cancelAnimationFrame(raf); tick() }
    const onMeta = (): void => setDuration(a.duration || 0)
    a.addEventListener('play', onPlay)
    a.addEventListener('pause', onPause)
    a.addEventListener('seeked', tick)
    a.addEventListener('loadedmetadata', onMeta)
    return () => {
      cancelAnimationFrame(raf)
      a.removeEventListener('play', onPlay)
      a.removeEventListener('pause', onPause)
      a.removeEventListener('seeked', tick)
      a.removeEventListener('loadedmetadata', onMeta)
    }
  }, [src, lines, words])

  // Keep the sung line in the middle of the list (only while playing, so
  // scrolling around a paused preview isn't pulled back).
  useEffect(() => {
    const box = listRef.current
    const el = box?.querySelector<HTMLElement>(`[data-line="${lit.line}"]`)
    if (!box || !el || !playing) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2, behavior: reduce ? 'auto' : 'smooth' })
  }, [lit.line, playing])

  const seek = (t: number): void => {
    const a = audioRef.current
    if (!a || !src) return
    a.currentTime = t
    if (a.paused) void a.play()
  }
  const toggle = (): void => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) void a.play(); else a.pause()
  }
  const pick = (): void => {
    pickLocalFile('audio/*').then(setPicked, () => {})
  }

  const started = lit.line >= 0
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-surface-overlay/30 overflow-hidden">
      <div
        ref={listRef}
        className="relative h-[330px] overflow-y-auto px-2 py-10"
        style={{ maskImage: 'linear-gradient(to bottom, transparent, black 10%, black 90%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 10%, black 90%, transparent)' }}
      >
        {lines.length === 0 && <p className="py-16 text-center text-sm text-text-muted">No timed lines came back.</p>}
        {lines.map((l, i) => {
          const now = i === lit.line
          const tone = !started ? 'text-text-secondary' : now ? 'text-text-primary' : 'text-text-muted'
          return (
            <button
              key={i}
              data-line={i}
              onClick={() => seek(l.start)}
              disabled={!src}
              className="group relative w-full flex items-baseline gap-3 px-3 py-1.5 rounded-lg text-left enabled:hover:bg-surface-overlay/70 transition-colors disabled:cursor-default"
            >
              <span className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-accent transition-opacity duration-300 ${now ? 'opacity-100' : 'opacity-0'}`} />
              <span
                title={l.estimated ? 'Estimated timing' : undefined}
                className={`w-[52px] shrink-0 text-[10px] font-mono tabular-nums transition-colors ${l.estimated ? 'italic' : ''} ${now ? 'text-accent' : `text-text-muted/70 ${src ? 'group-hover:text-accent' : ''}`}`}
              >
                {l.estimated && '~'}{lrcTime(l.start)}
              </span>
              <span className={`flex-1 min-w-0 text-[15px] font-medium leading-snug transition-colors duration-300 ${tone}`}>
                {words && l.words?.length
                  ? l.words.map((w, j) => (
                    <span key={j} className={`transition-colors duration-200 ${now ? (j <= lit.word ? 'text-accent' : 'text-text-muted') : ''}`}>
                      <span title={w.estimated ? 'Estimated timing' : undefined} className={w.estimated ? ESTIMATED_MARK : undefined}>{w.word.trim()}</span>
                      {j < l.words!.length - 1 ? ' ' : ''}
                    </span>
                  ))
                  : <span title={l.estimated ? 'Estimated timing' : undefined} className={l.estimated && l.text ? ESTIMATED_MARK : undefined}>{l.text || '♪'}</span>}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-3 px-3 py-2.5 border-t border-[var(--border)] bg-surface/60">
        {src ? (
          <>
            <audio ref={audioRef} src={src} preload="metadata" />
            <button
              onClick={toggle}
              title={playing ? 'Pause' : 'Play'}
              className="w-9 h-9 shrink-0 rounded-full bg-accent text-white flex items-center justify-center hover:bg-accent/90 transition-colors"
            >
              {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="translate-x-px" />}
            </button>
            <span ref={clockRef} className="w-10 text-right text-[11px] tabular-nums text-text-muted">0:00</span>
            <div className="relative flex-1 h-4 flex items-center">
              <div className="w-full h-1.5 rounded-full bg-surface-highest overflow-hidden">
                <div ref={fillRef} className="h-full w-full origin-left bg-accent" style={{ transform: 'scaleX(0)' }} />
              </div>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.01}
                aria-label="Seek"
                onChange={(e) => { if (audioRef.current) audioRef.current.currentTime = Number(e.target.value) }}
                className="absolute inset-0 w-full opacity-0 cursor-pointer"
              />
            </div>
            <span className="w-10 text-[11px] tabular-nums text-text-muted">{formatDuration(duration)}</span>
          </>
        ) : (
          <>
            <FileAudio size={15} className="text-text-muted shrink-0" />
            <span className="flex-1 min-w-0 text-xs text-text-muted truncate">
              Play along with <span className="text-text-secondary">{filename || 'the audio'}</span> to check the timing
            </span>
            <button onClick={pick} className={SMALL_BTN}>Choose audio</button>
          </>
        )}
      </div>
    </div>
  )
}
