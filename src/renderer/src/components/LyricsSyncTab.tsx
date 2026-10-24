import { useState, type ReactNode } from 'react'
import { ClipboardPaste, FileText, Loader2, Music2, RotateCcw } from 'lucide-react'
import ThemedSelect from './ThemedSelect'
import { ConfirmButton } from './lyricsGenShared'
import SyncedLyricsTool, { type SyncClock } from './SyncedLyricsTool'
import { serializeSyncedLyrics, type SyncLine, type SyncMode } from '../lib/syncedLyrics'

// The Synced lyrics dialog's Sync tab: the Synced lyrics tool on audio the
// dialog holds (a file, or a song's own audio), for anyone. The lyrics come
// from the song, a Whisper job, a .txt or .lrc, or are pasted; the result is
// copied, downloaded, or handed back to the song editor from the footer.

const CHIP = 'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-[var(--border)] text-[11px] font-semibold text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors disabled:opacity-50'
const SMALL_BTN = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold text-text-secondary bg-surface-overlay hover:bg-surface-raised hover:text-text-primary transition-colors disabled:opacity-50'

export default function LyricsSyncTab({ lines, onLines, mode, onMode, clock, audioField, audioHint, song, jobs, onJob, onFile, onPaste, busy }: {
  lines: SyncLine[]
  onLines: (lrc: string) => void
  mode: SyncMode
  onMode: (mode: SyncMode) => void
  clock: SyncClock
  /** The audio picker the Generate tab uses too. */
  audioField: ReactNode
  /** Says when this isn't the audio the lyrics were timed to. */
  audioHint?: ReactNode
  /** The song whose lyrics can start the sync. */
  song: { title: string; load: () => void } | null
  /** Finished Whisper jobs to start from (donors). */
  jobs: { value: string; label: string }[]
  onJob: (id: string) => void
  onFile: () => void
  onPaste: (text: string) => void
  busy: boolean
}): JSX.Element {
  const [paste, setPaste] = useState('')
  const empty = !lines.some((l) => !l.hidden)

  return (
    <div className="flex flex-col gap-4">
      <div>
        {audioField}
        {audioHint}
      </div>

      {empty ? (
        <section className="rounded-2xl border border-[var(--border)] bg-surface-overlay/20 p-4">
          <p className="text-sm font-semibold text-text-primary">The lyrics to time</p>
          <p className="mt-0.5 text-[11px] text-text-muted leading-relaxed">
            One line per line, as sung. An LRC keeps its times, so you can fix an existing sync, and word times come along too.
          </p>
          <div className="flex flex-wrap items-center gap-1.5 mt-3">
            {song && (
              <button onClick={song.load} disabled={busy} className={CHIP}>
                <Music2 size={12} className="shrink-0" /> <span className="truncate max-w-[200px]">{song.title}'s lyrics</span>
              </button>
            )}
            {jobs.length > 0 && (
              <ThemedSelect
                value=""
                onChange={onJob}
                placeholder="From a Whisper job"
                disabled={busy}
                options={jobs}
                className={`${CHIP} pr-2`}
                menuClassName="max-w-[360px]"
              />
            )}
            <button onClick={onFile} disabled={busy} className={CHIP}><FileText size={12} /> Open .txt or .lrc</button>
            {busy && <Loader2 size={13} className="animate-spin text-text-muted" />}
          </div>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            spellCheck={false}
            placeholder={'Or paste them here.\n\nOne lyric line per line.'}
            className="mt-3 w-full h-40 resize-none rounded-xl border border-[var(--border)] bg-surface-overlay/40 px-3.5 py-2.5 text-sm leading-relaxed text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-accent/60 transition-colors"
          />
          <div className="flex justify-end mt-2">
            <button onClick={() => { onPaste(paste); setPaste('') }} disabled={!paste.trim()} className={SMALL_BTN}>
              <ClipboardPaste size={13} /> Start syncing
            </button>
          </div>
        </section>
      ) : (
        <SyncedLyricsTool
          lines={lines}
          onChange={(next) => onLines(serializeSyncedLyrics(next))}
          clock={clock}
          mode={mode}
          onModeChange={onMode}
          listClassName="h-[280px]"
          noAudio={<p className="flex-1 text-xs text-text-muted">Choose the audio above to start stamping.</p>}
          footer={(
            <ConfirmButton icon={RotateCcw} label="Start over" confirmLabel="Clear these lyrics?" onConfirm={() => onLines('')} />
          )}
        />
      )}
    </div>
  )
}
