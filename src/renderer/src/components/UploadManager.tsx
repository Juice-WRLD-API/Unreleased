import { useEffect, useRef } from 'react'
import { Upload, X, CheckCircle2, AlertCircle, Loader2, ArrowUpFromLine, Archive, ListMusic } from 'lucide-react'
import { useStorePick, UploadItem } from '../store/useStore'
import { formatBytes } from '../lib/format'
import { cancelCompUpload, cancelAllCompUploads } from '../lib/compUploads'
import { cancelDonorUpload, cancelAllDonorUploads, isDonorUploadId } from '../lib/donorUploads'
import { cancelChatUpload, cancelAllChatUploads, isChatUploadId } from '../lib/chatUploads'
import { cancelZipTask } from '../lib/clientZip'

// Triggered from the Uploads row in the side menu (see Sidebar.tsx) - this
// is a lightweight anchored popup (no backdrop, no drag/resize/lock), not the
// sandbox/draggable modal system the other panels use. Closes on outside
// click, same as the old self-contained floating version.
export default function UploadManager(): JSX.Element {
  const { uploads, setShowUploadManager, clearCompletedUploads } = useStorePick('uploads', 'setShowUploadManager', 'clearCompletedUploads')
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (!panelRef.current?.contains(e.target as Node)) setShowUploadManager(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [setShowUploadManager])

  const active = uploads.filter((d) => d.state === 'downloading').length

  return (
    <div ref={panelRef} style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }} className="fixed right-3 z-[9990] w-[320px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-[var(--surface-overlay)] border-b border-[var(--border)]">
        <Upload size={13} className="text-[var(--accent)] shrink-0" />
        <span className="text-[var(--text-primary)] text-xs font-semibold flex-1">
          Transfers
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
          <button onClick={() => { cancelAllCompUploads(); cancelAllDonorUploads(); cancelAllChatUploads() }} className="text-[10px] text-[var(--text-muted)] hover:text-red-400 transition-colors px-1 rounded">
            Cancel All
          </button>
        )}
        <button onClick={() => setShowUploadManager(false)} className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          <X size={13} />
        </button>
      </div>
      {/* List */}
      <div className="max-h-72 overflow-y-auto">
        {uploads.length === 0 ? (
          <p className="text-[var(--text-muted)] text-xs text-center py-6">No transfers</p>
        ) : (
          <div className="divide-y divide-[var(--border)]/40">
            {uploads.map((item) => <UploadRow key={item.id} item={item} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function UploadRow({ item }: { item: UploadItem }): JSX.Element {
  const isDone = item.state === 'done'
  const isError = item.state === 'error' || item.state === 'cancelled'
  const isActive = item.state === 'downloading'
  const isUpload = item.type === 'upload'
  const isZip = item.type === 'zip'

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
            : item.type === 'playlist' ? <ListMusic size={13} className="text-[var(--accent)] animate-pulse" />
            : isZip ? <Archive size={13} className="text-[var(--accent)] animate-pulse" />
            : <Loader2 size={13} className="text-[var(--accent)] animate-spin" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[var(--text-primary)] text-xs truncate leading-snug" title={item.filename}>{item.filename}</p>
          {isActive && (item.detail || sizeLabel || speedLabel) && (
            <p className="text-[var(--text-muted)] text-[10px] mt-0.5">
              {[item.detail, sizeLabel, speedLabel].filter(Boolean).join(' · ')}
            </p>
          )}
          {isDone && item.detail && <p className="text-[var(--text-muted)] text-[10px] mt-0.5 truncate">{item.detail}</p>}
          {isError && item.error && <p className="text-red-400 text-[10px] mt-0.5 truncate">{item.error}</p>}
          {isActive && (
            <div className="mt-1.5 h-1 bg-[var(--surface-overlay)] rounded-full overflow-hidden">
              <div className="h-full bg-[var(--accent)] rounded-full transition-all duration-200" style={{ width: `${item.percent}%` }} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isActive && <span className="text-[var(--text-muted)] text-[10px]">{item.percent}%</span>}
          {isActive && isZip && (
            <button onClick={() => cancelZipTask(item.id)} title="Cancel download"
              className="p-1 rounded hover:bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-red-400 transition-colors">
              <X size={12} />
            </button>
          )}
          {isActive && isUpload && (
            <button onClick={() => (isChatUploadId(item.id) ? cancelChatUpload(item.id) : isDonorUploadId(item.id) ? cancelDonorUpload(item.id) : cancelCompUpload(item.id))} title="Cancel upload"
              className="p-1 rounded hover:bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-red-400 transition-colors">
              <X size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
