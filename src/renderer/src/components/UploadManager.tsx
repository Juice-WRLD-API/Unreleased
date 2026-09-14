import { useEffect, useRef, useState } from 'react'
import { Upload, X, CheckCircle2, AlertCircle, Loader2, ArrowUpFromLine, FolderPlus, FolderInput, Send } from 'lucide-react'
import { useStorePick, UploadItem, StagedFileChange } from '../store/useStore'
import { formatBytes } from '../lib/format'
import { cancelCompUpload, cancelAllCompUploads } from '../lib/compUploads'
import { proposeStagedChanges, stagedChangeLabel } from '../lib/compStagedChanges'

// Triggered from the Uploads row in the side menu (see Sidebar.tsx) - this
// is a lightweight anchored popup (no backdrop, no drag/resize/lock), not the
// sandbox/draggable modal system the other panels use. Closes on outside
// click, same as the old self-contained floating version.
export default function UploadManager(): JSX.Element {
  const { uploads, setShowUploadManager, clearCompletedUploads, stagedFileChanges } = useStorePick('uploads', 'setShowUploadManager', 'clearCompletedUploads', 'stagedFileChanges')
  const panelRef = useRef<HTMLDivElement>(null)
  // Lives out here rather than in StagedChanges: a fully successful propose
  // empties the queue, which unmounts that section - and with it the only
  // confirmation the user would ever see.
  const [proposeResult, setProposeResult] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (!panelRef.current?.contains(e.target as Node)) setShowUploadManager(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [setShowUploadManager])

  const active = uploads.filter((d) => d.state === 'downloading').length

  return (
    <div ref={panelRef} className="fixed top-2 right-3 z-[9990] w-[320px] rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-[var(--surface-overlay)] border-b border-[var(--border)]">
        <Upload size={13} className="text-[var(--accent)] shrink-0" />
        <span className="text-[var(--text-primary)] text-xs font-semibold flex-1">
          Uploads
          {active > 0
            ? <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-[var(--accent)]/20 text-[var(--accent)] text-[10px] font-medium">{active} active</span>
            : uploads.length > 0
              ? <span className="ml-1 text-[var(--text-muted)] font-normal text-[10px]">· {uploads.length}</span>
              : null}
        </span>
        {uploads.some(d => d.state !== 'downloading') && (
          <button onClick={clearCompletedUploads} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors px-1 rounded">
            Clear
          </button>
        )}
        {uploads.filter((d) => d.type === 'upload' && d.state === 'downloading').length > 1 && (
          <button onClick={cancelAllCompUploads} className="text-[10px] text-[var(--text-muted)] hover:text-red-400 transition-colors px-1 rounded">
            Cancel All
          </button>
        )}
        <button onClick={() => setShowUploadManager(false)} className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          <X size={13} />
        </button>
      </div>
      {/* List */}
      <div className="max-h-72 overflow-y-auto">
        {stagedFileChanges.length > 0 && <StagedChanges changes={stagedFileChanges} onResult={setProposeResult} />}
        {proposeResult && (
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
            <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
            <span className="text-[var(--text-muted)] text-[11px] flex-1">{proposeResult}</span>
            <button onClick={() => setProposeResult(null)} className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
              <X size={11} />
            </button>
          </div>
        )}
        {uploads.length === 0 ? (
          stagedFileChanges.length === 0 && !proposeResult && <p className="text-[var(--text-muted)] text-xs text-center py-6">No uploads</p>
        ) : (
          <div className="divide-y divide-[var(--border)]/40">
            {uploads.map((item) => <UploadRow key={item.id} item={item} />)}
          </div>
        )}
      </div>
    </div>
  )
}

// Changes dragged together in the Files tab, waiting on one Propose. They sit
// above the transfer list because they're the only rows here the user still
// has to act on - everything below is already in flight or finished.
function StagedChanges({ changes, onResult }: {
  changes: StagedFileChange[]
  onResult: (message: string | null) => void
}): JSX.Element {
  const { unstageFileChange, clearStagedFileChanges } = useStorePick('unstageFileChange', 'clearStagedFileChanges')
  const [proposing, setProposing] = useState(false)

  // Only a change that isn't waiting on a queued folder can go out now. The
  // count is a floor, not a promise: a folder proposed earlier may have been
  // approved since, which only the propose run itself can find out.
  const readyNow = changes.filter((c) => !c.awaitingFolder).length

  const propose = async (): Promise<void> => {
    if (proposing) return
    setProposing(true)
    onResult(null)
    const { proposed, failed, held } = await proposeStagedChanges()
    setProposing(false)
    const parts = [`Proposed ${proposed}`]
    if (failed > 0) parts.push(`${failed} failed`)
    if (held > 0) parts.push(`${held} waiting on a folder that isn't approved yet`)
    onResult(parts.join(' · '))
  }

  return (
    <div className="border-b border-[var(--border)] bg-[var(--accent)]/[0.04]">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-[var(--text-primary)] text-[11px] font-semibold flex-1">
          Staged changes
          <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-[var(--accent)]/20 text-[var(--accent)] text-[10px] font-medium">{changes.length}</span>
        </span>
        <button onClick={clearStagedFileChanges} disabled={proposing}
          className="text-[10px] text-[var(--text-muted)] hover:text-red-400 disabled:opacity-40 transition-colors px-1 rounded">
          Discard
        </button>
      </div>
      <div className="divide-y divide-[var(--border)]/40">
        {changes.map((change) => (
          <div key={change.id} className="flex items-start gap-2 px-3 py-2">
            <div className="mt-0.5 shrink-0">
              {change.changeType === 'create_folder'
                ? <FolderPlus size={13} className="text-[var(--accent)]" />
                : <FolderInput size={13} className="text-[var(--accent)]" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[var(--text-primary)] text-xs truncate leading-snug" title={change.path}>{stagedChangeLabel(change)}</p>
              <p className="text-[var(--text-muted)] text-[10px] truncate" title={change.destination ?? change.path}>
                {change.destination ? `→ ${change.destination}` : change.path}
              </p>
              {change.awaitingFolder && (
                <p className="text-[var(--text-muted)] text-[10px] mt-0.5 truncate italic">
                  {changes.some((c) => c.changeType === 'create_folder' && c.path === change.awaitingFolder)
                    ? 'Goes out once the new folder is approved'
                    : 'Waiting on the new folder’s approval'}
                </p>
              )}
              {change.error && <p className="text-red-400 text-[10px] mt-0.5 truncate" title={change.error}>{change.error}</p>}
            </div>
            <button onClick={() => unstageFileChange(change.id)} disabled={proposing} title="Remove from queue"
              className="shrink-0 p-1 rounded hover:bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-red-400 disabled:opacity-40 transition-colors">
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="px-3 py-2 flex items-center gap-2">
        <button onClick={propose} disabled={proposing}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-medium disabled:opacity-50 hover:opacity-90 transition-opacity">
          {proposing
            ? <><Loader2 size={12} className="animate-spin" /> Proposing…</>
            : readyNow === 0
              // Everything left is waiting on a folder - the useful action now
              // is re-checking whether that folder has been approved.
              ? <><Send size={12} /> Check for approval</>
              : <><Send size={12} /> Propose {readyNow} change{readyNow === 1 ? '' : 's'}</>}
        </button>
      </div>
    </div>
  )
}

function UploadRow({ item }: { item: UploadItem }): JSX.Element {
  const isDone = item.state === 'done'
  const isError = item.state === 'error' || item.state === 'cancelled'
  const isActive = item.state === 'downloading'
  const isUpload = item.type === 'upload'

  const sizeLabel = item.total && item.total > 0
    ? `${formatBytes(item.received ?? 0)} / ${formatBytes(item.total)}`
    : item.received ? formatBytes(item.received) : null

  const speedLabel = isActive && item.speedBps ? `${formatBytes(item.speedBps)}/s` : null

  return (
    <div className="px-3 py-2.5 hover:bg-[var(--surface-overlay)] transition-colors">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">
          {isDone ? <CheckCircle2 size={13} className="text-emerald-400" />
            : isError ? <AlertCircle size={13} className="text-red-400" />
            : isUpload ? <ArrowUpFromLine size={13} className="text-[var(--accent)] animate-pulse" />
            : <Loader2 size={13} className="text-[var(--accent)] animate-spin" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[var(--text-primary)] text-xs truncate leading-snug" title={item.filename}>{item.filename}</p>
          {isActive && (sizeLabel || speedLabel) && (
            <p className="text-[var(--text-muted)] text-[10px] mt-0.5">
              {sizeLabel}{sizeLabel && speedLabel ? ' · ' : ''}{speedLabel}
            </p>
          )}
          {isError && item.error && <p className="text-red-400 text-[10px] mt-0.5 truncate">{item.error}</p>}
          {isActive && (
            <div className="mt-1.5 h-1 bg-[var(--surface-overlay)] rounded-full overflow-hidden">
              <div className="h-full bg-[var(--accent)] rounded-full transition-all duration-200" style={{ width: `${item.percent}%` }} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isActive && <span className="text-[var(--text-muted)] text-[10px]">{item.percent}%</span>}
          {isActive && isUpload && (
            <button onClick={() => cancelCompUpload(item.id)} title="Cancel upload"
              className="p-1 rounded hover:bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-red-400 transition-colors">
              <X size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
