import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, FolderOpen, Loader2, X as XIcon } from 'lucide-react'
import ThemedCheckbox from './ThemedCheckbox'
import { useStorePick } from '../store/useStore'
import { errorMessage } from '../lib/format'
import {
  loadLiveComp, localCompFiles, planCompReplace, runCompReplace,
  type CompReplacePhase, type CompReplacePlan, type LocalCompFile,
} from '../lib/compReplace'
import type { CompReplaceResult } from '../lib/userApi'

// Admin tab for managers of a channel: swap the whole comp for a local folder
// in one step (POST /accounts/admin/comp-replace/). The old comp keeps serving
// until the server exchanges the folders, so the Files tab never goes empty.
export default function CompReplaceTab(): JSX.Element {
  const { activeChannel, channels } = useStorePick('activeChannel', 'channels')
  const channelName = channels.find(c => c.slug === activeChannel)?.name ?? activeChannel ?? 'this comp'
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [picked, setPicked] = useState<{ folder: string; files: LocalCompFile[]; skipped: { path: string; reason: string }[] } | null>(null)
  const [live, setLive] = useState<Map<string, number | null> | null>(null)
  const [reuploadAll, setReuploadAll] = useState(false)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<CompReplacePhase | null>(null)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<CompReplaceResult | null>(null)
  const abortRef = useRef<(() => void) | null>(null)

  // A plan made against one channel means nothing on another.
  useEffect(() => { reset() }, [activeChannel])

  // Progress ticks re-render often; a big comp shouldn't be re-planned on each.
  const plan: CompReplacePlan | null = useMemo(() => picked && live
    ? planCompReplace(picked.files, live, { reuploadAll, skipped: picked.skipped })
    : null, [picked, live, reuploadAll])
  const busy = phase !== null

  function reset(): void {
    setPicked(null)
    setLive(null)
    setError(null)
    setResult(null)
    setNotes('')
  }

  async function onPick(list: FileList | null): Promise<void> {
    if (!list?.length) return
    reset()
    const first = list[0].webkitRelativePath || list[0].name
    const { files, skipped } = localCompFiles(list)
    setPicked({ folder: first.split('/')[0], files, skipped })
    setLoading(true)
    try {
      setLive(await loadLiveComp(activeChannel || undefined))
    } catch (e) {
      setError(errorMessage(e, 'Could not load the current comp'))
    } finally {
      setLoading(false)
    }
  }

  async function onReplace(): Promise<void> {
    if (!plan) return
    const message = `Replace ${channelName} with "${picked?.folder}"?\n\n`
      + `${plan.upload.length} file${plan.upload.length === 1 ? '' : 's'} to upload, ${plan.removed.length} removed. `
      + 'Removed and replaced files are archived and can be restored from their history.'
    if (!confirm(message)) return
    setError(null)
    setProgress(0)
    try {
      const run = runCompReplace(plan, {
        channel: activeChannel || undefined,
        notes,
        onPhase: setPhase,
        onProgress: (sent, total) => setProgress(total > 0 ? sent / total : 1),
      })
      abortRef.current = run.abort
      setResult(await run.promise)
      setPicked(null)
      setLive(null)
    } catch (e) {
      if (!(e instanceof Error && e.message === 'cancelled')) setError(errorMessage(e, 'The comp could not be replaced'))
    } finally {
      abortRef.current = null
      setPhase(null)
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl space-y-6">
        <p className="text-xs text-text-muted leading-relaxed">
          Swap all of <span className="text-text-primary font-semibold">{channelName}</span> for a folder on this computer.
          The current comp keeps serving until the new one is complete, then the two are exchanged in one step.
          Files whose path and size haven&apos;t changed are kept instead of uploaded again. Anything not in the folder is removed;
          removed and replaced files are archived with their history.
        </p>

        <input
          ref={el => { inputRef.current = el; el?.setAttribute('webkitdirectory', '') }}
          type="file" multiple className="hidden"
          onChange={e => { void onPick(e.target.files); e.target.value = '' }}
        />
        <button onClick={() => inputRef.current?.click()} disabled={busy}
          className="flex items-center gap-2 px-3 h-8 rounded-lg bg-surface-raised border border-[var(--border)] text-xs font-semibold text-text-primary hover:border-accent transition-colors disabled:opacity-40">
          <FolderOpen size={13} /> {picked ? 'Choose another folder' : 'Choose the new comp folder'}
        </button>

        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs whitespace-pre-line">
            <AlertCircle size={13} className="shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {result && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-xs">
            <Check size={13} className="shrink-0 mt-0.5" />
            <span>
              {channelName} replaced: {result.files} files ({result.added} added, {result.changed} changed, {result.removed} removed, {result.unchanged} unchanged).
              Commit {result.commit_id}.
            </span>
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Loader2 size={13} className="animate-spin" /> Comparing with the current comp…
          </div>
        )}

        {plan && picked && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              <Stat label="Files" value={plan.reuse.length + plan.upload.length} />
              <Stat label="Unchanged" value={plan.unchanged} />
              <Stat label="Moved" value={plan.moved.length} />
              <Stat label="New" value={plan.added.length} />
              <Stat label="Changed" value={plan.changed.length} />
              <Stat label="Removed" value={plan.removed.length} warn={plan.removed.length > 0} />
            </div>

            <PathList title="Removed from the comp" paths={plan.removed} />
            <PathList title="New" paths={plan.added} />
            <PathList title="Changed" paths={plan.changed} />
            <PathList title="Moved" paths={plan.moved.map(m => `${m.from} → ${m.to}`)} />
            <PathList title="Left out of the upload" paths={plan.skipped.map(s => `${s.path} (${s.reason})`)} />

            <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer">
              <ThemedCheckbox checked={reuploadAll} onChange={setReuploadAll} />
              Upload every file again (don&apos;t trust path and size matches)
            </label>

            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes for the commit (optional)" disabled={busy}
              className="w-full h-8 rounded-lg bg-surface-raised border border-[var(--border)] px-3 text-xs text-text-primary outline-none focus:border-accent" />

            {busy ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <Loader2 size={13} className="animate-spin" />
                  {phase === 'uploading'
                    ? `Uploading ${plan.upload.length} file${plan.upload.length === 1 ? '' : 's'}… ${Math.round(progress * 100)}%`
                    : 'Building and swapping in the new comp. This can take a while; the server finishes even if you close the app.'}
                  {phase === 'uploading' && (
                    <button onClick={() => abortRef.current?.()} className="ml-auto flex items-center gap-1 text-text-muted hover:text-text-primary">
                      <XIcon size={12} /> Cancel
                    </button>
                  )}
                </div>
                <div className="h-1 rounded-full bg-surface-overlay overflow-hidden">
                  <div className="h-full bg-accent origin-left transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]"
                    style={{ transform: `scaleX(${phase === 'uploading' ? progress : 1})` }} />
                </div>
              </div>
            ) : (
              <button onClick={() => void onReplace()} disabled={plan.reuse.length + plan.upload.length === 0}
                className="px-4 h-8 rounded-lg bg-accent text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-40">
                Replace {channelName}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }): JSX.Element {
  return (
    <div className="rounded-lg bg-surface-raised border border-[var(--border)] px-2.5 py-2">
      <p className={`text-sm font-bold ${warn ? 'text-amber-400' : 'text-text-primary'}`}>{value.toLocaleString()}</p>
      <p className="text-[10px] text-text-muted">{label}</p>
    </div>
  )
}

const LIST_LIMIT = 200

function PathList({ title, paths }: { title: string; paths: string[] }): JSX.Element | null {
  if (paths.length === 0) return null
  return (
    <details className="rounded-lg border border-[var(--border)] text-xs">
      <summary className="px-3 py-2 cursor-pointer text-text-primary font-semibold">{title} ({paths.length.toLocaleString()})</summary>
      <ul className="px-3 pb-2 max-h-60 overflow-y-auto font-mono text-[11px] text-text-muted space-y-0.5">
        {paths.slice(0, LIST_LIMIT).map(p => <li key={p} className="truncate" title={p}>{p}</li>)}
        {paths.length > LIST_LIMIT && <li>…and {(paths.length - LIST_LIMIT).toLocaleString()} more</li>}
      </ul>
    </details>
  )
}
