import { useEffect, useState } from 'react'
import { AlignLeft, Ban, Check, Loader2, Type, WholeWord, X, type LucideIcon } from 'lucide-react'
import {
  fetchAdminLyricsJobOutput, fetchLyricsJobOutput,
  type LyricsGenJob, type LyricsGenMode, type LyricsJobStatus, type LyricsOutput, type LyricsSegment,
} from '../lib/lyricsGenApi'
import { saveBlob } from '../lib/terminal/pick'

// Pieces the "Generate lyrics" dialog's tabs share: what each mode and status
// is called and looks like, and how a finished job's text is saved.

export const MODE_INFO: Record<LyricsGenMode, { title: string; blurb: string; icon: LucideIcon }> = {
  plain: { title: 'Transcribe', blurb: 'Write the lyrics down from the audio', icon: Type },
  synced: { title: 'Line sync', blurb: 'Time each line of your lyrics', icon: AlignLeft },
  word_synced: { title: 'Word sync', blurb: 'Time every word, karaoke style', icon: WholeWord },
}

export const STATUS_INFO: Record<LyricsJobStatus, { label: string; className: string }> = {
  queued: { label: 'Queued', className: 'text-amber-300 bg-amber-400/10 border-amber-400/25' },
  processing: { label: 'Working', className: 'text-accent bg-accent/10 border-accent/30' },
  completed: { label: 'Ready', className: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/25' },
  failed: { label: 'Failed', className: 'text-red-300 bg-red-400/10 border-red-400/25' },
  cancelled: { label: 'Cancelled', className: 'text-text-muted bg-surface-overlay border-[var(--border)]' },
}

export function StatusPill({ status }: { status: LyricsJobStatus }): JSX.Element {
  const s = STATUS_INFO[status]
  return (
    <span className={`inline-flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide ${s.className}`}>
      {status === 'queued' && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
      {status === 'processing' && <Loader2 size={10} className="animate-spin" />}
      {status === 'completed' && <Check size={10} strokeWidth={3} />}
      {status === 'failed' && <X size={10} strokeWidth={3} />}
      {status === 'cancelled' && <Ban size={10} />}
      {s.label}
    </span>
  )
}

/** A two-step button for deleting or cancelling: the first click turns it red
 *  and asks, the second (within a few seconds) does it. */
export function ConfirmButton({ icon: Icon, label, confirmLabel, onConfirm, busy = false, iconOnly = false }: {
  icon: LucideIcon
  label: string
  confirmLabel: string
  onConfirm: () => void
  busy?: boolean
  iconOnly?: boolean
}): JSX.Element {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 3500)
    return () => window.clearTimeout(t)
  }, [armed])
  const showLabel = armed || !iconOnly
  return (
    <button
      type="button"
      disabled={busy}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        if (armed) { setArmed(false); onConfirm() } else setArmed(true)
      }}
      className={`shrink-0 inline-flex items-center gap-1.5 h-7 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${showLabel ? 'px-2.5' : 'w-7 justify-center'} ${
        armed ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
      }`}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
      {showLabel && <span>{armed ? confirmLabel : label}</span>}
    </button>
  )
}

/** A mode's icon on a tinted tile, coloured by where its job stands. */
export function ModeTile({ mode, status, size = 36 }: { mode: LyricsGenMode; status?: LyricsJobStatus; size?: number }): JSX.Element {
  const Icon = MODE_INFO[mode].icon
  const tone = status === 'failed' ? 'bg-red-400/10 text-red-300'
    : status === 'cancelled' ? 'bg-surface-overlay text-text-muted'
    : status === 'completed' ? 'bg-emerald-400/10 text-emerald-300'
    : 'bg-accent/15 text-accent'
  return (
    <span className={`shrink-0 inline-flex items-center justify-center rounded-xl ${tone}`} style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.45)} />
    </span>
  )
}

/** What a job's text downloads as by default, and every format it has. */
export const defaultOutput = (mode: LyricsGenMode): LyricsOutput => (mode === 'plain' ? 'txt' : mode === 'synced' ? 'lrc' : 'enhanced_lrc')
export const outputsFor = (mode: LyricsGenMode): LyricsOutput[] => (mode === 'plain' ? ['txt'] : mode === 'synced' ? ['lrc', 'txt'] : ['enhanced_lrc', 'lrc', 'txt'])
export const OUTPUT_LABEL: Record<LyricsOutput, string> = { txt: 'Text (.txt)', lrc: 'Line LRC (.lrc)', enhanced_lrc: 'Word LRC (.words.lrc)' }

export function outputName(filename: string, output: LyricsOutput): string {
  const base = (filename || 'lyrics').replace(/\.[^.]+$/, '')
  return output === 'txt' ? `${base}.txt` : output === 'lrc' ? `${base}.lrc` : `${base}.words.lrc`
}

/** Downloads a finished job's text through the server, as the terminal's `get` does. */
export async function downloadJobOutput(job: Pick<LyricsGenJob, 'id' | 'filename'>, output: LyricsOutput, admin: boolean): Promise<void> {
  const text = admin ? await fetchAdminLyricsJobOutput(job.id, output) : await fetchLyricsJobOutput(job.id, output)
  saveText(text, outputName(job.filename, output))
}

export function saveText(text: string, name: string): void {
  saveBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), name)
}

/** Lines with start times, from the job's segments or, failing that, its LRC. */
export function timedLines(job: LyricsGenJob): LyricsSegment[] {
  const segs = job.result.segments
  if (segs?.length) return segs
  const out: LyricsSegment[] = []
  for (const raw of (job.result.synced_lyrics ?? '').split(/\r?\n/)) {
    const m = /^\s*\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\](.*)$/.exec(raw)
    if (!m) continue
    const start = Number(m[1]) * 60 + Number(m[2].replace(':', '.'))
    out.push({ start, end: start, text: m[3].replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim() })
  }
  for (let i = 0; i < out.length; i++) out[i].end = out[i + 1]?.start ?? out[i].start + 4
  return out
}

/** 83.4 -> "1:23.40", the way LRC writes it. */
export function lrcTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}
