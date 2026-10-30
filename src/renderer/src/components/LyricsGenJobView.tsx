import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle, AlignLeft, Ban, Check, ChevronLeft, CircleStop, Clock, Copy, Download, FileAudio, Hourglass, Info, Loader2, PencilLine, RotateCcw, Trash2,
  WholeWord,
} from 'lucide-react'
import {
  cancelAdminLyricsJob, deleteLyricsJob, getAdminLyricsJob, getLyricsJob, isFinished, jobServerAudio, jobTitle, lrcToPlain, serverAudioUrl,
  type LyricsAdminJob, type LyricsGenJob, type LyricsGenMode, type LyricsOutput, type LyricsSegment,
} from '../lib/lyricsGenApi'
import { countTimingEdits, loadTimingDraft, lrcTime, saveTimingDraft, timedLines, timingOutput } from '../lib/lyricsTiming'
import { linesFromSegments } from '../lib/syncedLyrics'
import { buildStreamUrl, searchSongs } from '../lib/juicewrldApi'
import { isAbortError } from '../lib/apiClient'
import { errorMessage } from '../lib/format'
import { copyText } from '../lib/clipboard'
import { showAppToast } from '../lib/appToast'
import { pickLocalFile } from '../lib/terminal/pick'
import { relativeTime } from './adminShared'
import {
  ConfirmButton, MODE_INFO, ModeTile, OUTPUT_LABEL, StatusPill, downloadJobOutput, outputName, outputsFor, saveText, sourceHint,
} from './lyricsGenShared'
import SyncedLyricsTool, { useAudioClock } from './SyncedLyricsTool'

// One lyrics job in the Synced lyrics dialog: followed live while it waits
// and runs, then its result - an editable transcript, or the synced lines in
// the Synced lyrics tool, playing along with the audio, where anything early
// or late is moved by ear - with downloads and the next step (sync the
// reviewed text, upgrade line sync to per-word, change the lines in Sync, or
// hand it to the song editor that asked for it). Administrators open other
// users' jobs here too, through the admin routes, and can cancel one that is
// running.

const POLL_MS = 3000

const SMALL_BTN = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold text-text-secondary bg-surface-overlay hover:bg-surface-raised hover:text-text-primary transition-colors disabled:opacity-50'
const SECTION_LABEL = 'text-[11px] font-semibold uppercase tracking-wider text-text-muted'

export default function LyricsGenJobView({ jobId, admin, audio, backLabel, onBack, onContinue, onRetry, onEdit, apply, onDeleted, onUpdate }: {
  jobId: string
  /** Read (and cancel) through the administrator routes. */
  admin: boolean
  /** The audio file the dialog holds; used for the play-along when it's this
   *  job's upload. A job on server audio plays along with its stream. */
  audio: File | null
  backLabel: string
  onBack: () => void
  /** Start a sync job from this result's text. */
  onContinue: (job: LyricsGenJob, mode: LyricsGenMode, text: string) => void
  /** Back to the form with this failed job's settings. */
  onRetry: (job: LyricsGenJob) => void
  /** Opens the result in the Sync tab, where its lines can change too. */
  onEdit?: (job: LyricsGenJob, lrc: string) => void
  /** Hands the result to the song editor that opened the dialog. */
  apply?: { label: string; onApply: (lrc: string) => void }
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
  const server = job ? jobServerAudio(job) : null
  const playAlongAudio = audio && job && !server && audio.name === job.filename ? audio : null
  const uploadedSong = useCatalogueCopy(job?.status === 'completed' && job.mode !== 'plain' && !server && !playAlongAudio ? job.filename : null)
  const playAlongUrl = server ? serverAudioUrl(server) : uploadedSong

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
              <p className="text-text-primary text-sm font-semibold truncate" title={sourceHint(job)}>{jobTitle(job) || 'Untitled audio'}</p>
              <p className="text-text-muted text-xs truncate">
                {MODE_INFO[job.mode].title}
                {job.language && <> · <span className="uppercase">{job.language}</span></>}
                {' · '}{relativeTime(job.created_at)}
                {user && <> · by <span className="text-text-secondary">{user}</span></>}
              </p>
            </div>
            <StatusPill status={job.status} progress={job.progress} />
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
            ? <Transcript job={job} admin={admin} onContinue={(m, t) => onContinue(job, m, t)} onEdit={onEdit && ((t) => onEdit(job, t))} />
            : (
              <SyncedResult
                job={job}
                admin={admin}
                audio={playAlongAudio}
                audioUrl={playAlongUrl}
                onContinue={(m, t) => onContinue(job, m, t)}
                onEdit={onEdit && ((t) => onEdit(job, t))}
                apply={apply}
              />
            ))}
        </>
      )}
    </div>
  )
}

// A job made from an upload doesn't say where its audio came from, and the
// server deletes the upload once the job is done. API songs used to go up that
// way, as a file named after the song's own file, so when exactly one
// catalogue song has a file of that name, the play-along streams it.
function useCatalogueCopy(filename: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    setUrl(null)
    const title = filename?.replace(/\.[^.]+$/, '').trim()
    if (!filename || !title) return
    let live = true
    void searchSongs(title, 20).then((songs) => {
      const paths = new Set(songs.map((s) => s.path).filter((p) => p && (p.split(/[\\/]/).pop() ?? '').toLowerCase() === filename.toLowerCase()))
      if (live && paths.size === 1) setUrl(buildStreamUrl([...paths][0]))
    }, () => { /* no match to play along with; the audio can still be picked */ })
    return () => { live = false }
  }, [filename])
  return url
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
      {!queued && job.progress !== undefined && (
        <div className="relative mt-5 w-full max-w-[300px]">
          <div className="h-1.5 rounded-full bg-surface-highest overflow-hidden">
            <div
              className="h-full w-full origin-left bg-accent transition-transform duration-[600ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
              style={{ transform: `scaleX(${Math.min(job.progress, 100) / 100})` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] tabular-nums text-text-muted">
            {job.progress ? `${job.progress}%` : 'Loading the audio and the model. After a restart this can take a while.'}
          </p>
        </div>
      )}
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
  return [copied, (text) => { copyText(text).then(() => setCopied(true), () => showAppToast('Could not copy')) }]
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
function Transcript({ job, admin, onContinue, onEdit }: {
  job: LyricsGenJob
  admin: boolean
  onContinue: (mode: LyricsGenMode, text: string) => void
  onEdit?: (text: string) => void
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
      {!admin && original && onEdit && (
        <button
          onClick={() => onEdit(draft)}
          disabled={!draft.trim()}
          className="self-start inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-text-primary transition-colors disabled:opacity-40"
        >
          <Clock size={13} /> Or time them by hand in Sync
        </button>
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

// A synced job: its lines with times, playing along with the audio, or the
// raw LRC. It's a preview; the timing is changed by hand in Sync, which Edit
// in Sync opens it in. Timing moved with `lyricsgen timing` is kept on this
// device, and Copy, the LRC downloads and the next steps are built from it in
// place of the server's.
function SyncedResult({ job, admin, audio, audioUrl, onContinue, onEdit, apply }: {
  job: LyricsGenJob
  admin: boolean
  audio: File | null
  audioUrl: string | null
  onContinue: (mode: LyricsGenMode, text: string) => void
  onEdit?: (lrc: string) => void
  apply?: { label: string; onApply: (lrc: string) => void }
}): JSX.Element {
  const [view, setView] = useState<'preview' | 'lrc'>('preview')
  const original = useMemo(() => timedLines(job), [job])
  const [lines, setLines] = useState(() => loadTimingDraft(job) ?? original)
  const edits = useMemo(() => countTimingEdits(original, lines), [original, lines])
  useEffect(() => { saveTimingDraft(job.id, edits ? lines : null) }, [job.id, lines, edits])
  const words = job.mode === 'word_synced'
  const lrc = (edits ? timingOutput(lines, words ? 'enhanced_lrc' : 'lrc') : words ? job.result.word_synced_lyrics : job.result.synced_lyrics)?.trim() ?? ''
  const [copied, copy] = useCopied()
  const [downloading, download] = useDownload(job, admin)
  const save = (output: LyricsOutput): void => {
    const tuned = edits ? timingOutput(lines, output) : null
    if (tuned !== null) saveText(tuned, outputName(job.filename, output))
    else download(output)
  }
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
              {edits > 0 && <> · <span className="text-accent">{edits} {words ? 'word' : 'line'}{edits === 1 ? '' : 's'} moved</span></>}
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
              {' '}If the text is right,{' '}
              {!admin && onEdit && lrc
                ? <button onClick={() => onEdit(lrc)} className="font-semibold text-text-secondary hover:text-text-primary underline underline-offset-2 transition-colors">move them by ear in Sync</button>
                : 'move them by ear in Sync'}.
            </span>
          </p>
        )}
        {view === 'preview'
          ? (
            <JobPreview
              lines={lines}
              words={words}
              audio={audio}
              audioUrl={audioUrl}
              filename={job.filename}
              onEdit={!admin && onEdit && lrc ? () => onEdit(lrc) : undefined}
            />
          )
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
            <button key={o} onClick={() => save(o)} disabled={downloading === o} className={SMALL_BTN}>
              {downloading === o ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {OUTPUT_LABEL[o]}
            </button>
          ))}
          <button onClick={() => copy(lrc)} className={SMALL_BTN}>
            {copied ? <Check size={13} className="text-emerald-300" /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy LRC'}
          </button>
          {edits > 0 && (
            <span className="ml-auto">
              <ConfirmButton icon={RotateCcw} label="Undo timing changes" confirmLabel="Undo every change?" onConfirm={() => setLines(original)} />
            </span>
          )}
        </div>
        {edits > 0 && (
          <p className="text-[11px] text-text-muted">Your timing changes are kept on this device. Copy and the LRC downloads include them.</p>
        )}
      </section>

      {!admin && apply && lrc && (
        <NextStep title="Put it in the song editor" blurb="The lyrics go into the song's synced lyrics, with your timing changes. Check them there, then submit.">
          <button onClick={() => apply.onApply(lrc)} className={NEXT_BTN}>
            <Check size={15} /> {apply.label}
          </button>
        </NextStep>
      )}
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

// The synced lines playing along with the job's audio: the Synced lyrics
// tool as a preview, where a click plays from that line or word. A job on
// server audio streams it; otherwise, without the job's audio in hand, the
// lines show with their times and the audio can be picked here (it isn't
// uploaded). Changing anything is Edit in Sync.
function JobPreview({ lines, words, audio, audioUrl, filename, onEdit }: {
  lines: LyricsSegment[]
  words: boolean
  audio: File | null
  audioUrl: string | null
  filename: string
  onEdit?: () => void
}): JSX.Element {
  const [picked, setPicked] = useState<File | null>(null)
  const file = picked ?? audio
  const fileSrc = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => { if (fileSrc) URL.revokeObjectURL(fileSrc) }, [fileSrc])
  const { clock, element } = useAudioClock(fileSrc ?? audioUrl)
  const toolLines = useMemo(() => linesFromSegments(lines, words), [lines, words])
  const pick = (): void => {
    pickLocalFile('audio/*').then(setPicked, () => {})
  }

  return (
    <>
      {element}
      <SyncedLyricsTool
        lines={toolLines}
        onChange={() => {}}
        clock={clock}
        mode={words ? 'words' : 'lines'}
        readOnly
        noAudio={(
          <>
            <FileAudio size={15} className="text-text-muted shrink-0" />
            <span className="flex-1 min-w-0 text-xs text-text-muted truncate">
              Play along with <span className="text-text-secondary">{filename || 'the audio'}</span> to check the timing
            </span>
            <button onClick={pick} className={SMALL_BTN}>Choose audio</button>
          </>
        )}
        footer={onEdit && (
          <>
            <span className="text-[11px] text-text-muted">Something early or late?</span>
            <button
              onClick={onEdit}
              title="Open these lines, times and all, in Sync, to move them by ear, retype them or stamp them again"
              className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-bold bg-accent text-white hover:bg-accent/90 transition-colors"
            >
              <Clock size={13} /> Edit in Sync
            </button>
          </>
        )}
      />
    </>
  )
}
