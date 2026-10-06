import { useEffect, useRef, useState } from 'react'
import { Download, X, CheckCircle2, AlertCircle, Loader2, RefreshCw, FolderOpen, ArrowDownToLine, ArrowUpFromLine, FolderPlus, FolderInput, Send } from 'lucide-react'
import { useStore, useStorePick, DownloadItem, StagedFileChange } from '../store/useStore'
import { formatBytes } from '../lib/format'
import { cancelCompUpload, cancelAllCompUploads } from '../lib/compUploads'
import { cancelZipTask, isZipTaskId } from '../lib/clientZip'
import { proposeStagedChanges, stagedChangeLabel } from '../lib/compStagedChanges'

export default function DownloadManager(): JSX.Element | null {
  const { downloads, showDownloadManager, setShowDownloadManager, addDownload, updateDownload, clearCompletedDownloads, setUpdateStatus, wrldFullscreen, stagedFileChanges } = useStorePick('downloads', 'showDownloadManager', 'setShowDownloadManager', 'addDownload', 'updateDownload', 'clearCompletedDownloads', 'setUpdateStatus', 'wrldFullscreen', 'stagedFileChanges')
  // Lives out here rather than in StagedChanges: a fully successful propose
  // empties the queue, which unmounts that section - and with it the only
  // confirmation the user would ever see.
  const [proposeResult, setProposeResult] = useState<string | null>(null)
  const el = (window as any).electron
  const panelRef = useRef<HTMLDivElement>(null)
  // Per-download last-sample (bytes, timestamp) used to derive a live
  // bytes/sec speed reading from the raw received-byte progress events.
  const speedSamples = useRef<Record<string, { bytes: number; time: number }>>({})

  useEffect(() => {
    if (!el) return
    const offStarted = el.onDownloadStarted((d: { filename: string; savePath: string; total: number }) => {
      const id = `file-${d.filename}-${Date.now()}`
      addDownload({ id, filename: d.filename, type: 'file', state: 'downloading', percent: 0, total: d.total, savePath: d.savePath })
      speedSamples.current[id] = { bytes: 0, time: Date.now() }
      setShowDownloadManager(true)
    })
    const offProgress = el.onDownloadProgress((d: { filename: string; received: number; total: number; percent: number }) => {
      const { downloads: cur } = useStore.getState()
      const match = [...cur].reverse().find((x) => x.filename === d.filename && x.state === 'downloading')
      if (!match) return
      const sample = speedSamples.current[match.id] ?? { bytes: 0, time: Date.now() }
      const now = Date.now()
      const dt = (now - sample.time) / 1000
      let speedBps: number | undefined
      if (dt >= 0.4) {
        speedBps = Math.max(0, (d.received - sample.bytes) / dt)
        speedSamples.current[match.id] = { bytes: d.received, time: now }
      }
      updateDownload(match.id, { percent: d.percent, received: d.received, total: d.total, bytesReceived: d.received, ...(speedBps !== undefined ? { speedBps } : {}) })
    })
    const offDone = el.onDownloadDone((d: { filename: string; state: string; savePath: string }) => {
      const { downloads: cur } = useStore.getState()
      const match = [...cur].reverse().find((x) => x.filename === d.filename && x.state === 'downloading')
      if (match) {
        updateDownload(match.id, { state: d.state === 'completed' ? 'done' : d.state === 'cancelled' ? 'cancelled' : 'error', percent: d.state === 'completed' ? 100 : match.percent, savePath: d.savePath, speedBps: undefined })
        delete speedSamples.current[match.id]
      }
    })
    const offUpdate = el.onUpdateStatus((d: { type: string; version?: string; percent?: number; message?: string }) => {
      setUpdateStatus(d)
      if (d.type === 'downloading') {
        const { downloads: cur } = useStore.getState()
        const existing = cur.find((x) => x.type === 'update')
        if (existing) updateDownload(existing.id, { percent: d.percent ?? 0, state: 'downloading' })
        else { addDownload({ id: 'update', filename: `Update${d.version ? ` v${d.version}` : ''}`, type: 'update', state: 'downloading', percent: d.percent ?? 0 }); setShowDownloadManager(true) }
      } else if (d.type === 'downloaded') {
        const existing = useStore.getState().downloads.find((x) => x.type === 'update')
        if (existing) updateDownload(existing.id, { state: 'done', percent: 100, filename: `Update v${d.version ?? ''} ready` })
      } else if (d.type === 'error') {
        const existing = useStore.getState().downloads.find((x) => x.type === 'update' && x.state === 'downloading')
        if (existing) updateDownload(existing.id, { state: 'error', error: d.message })
      }
    })
    return () => { offStarted?.(); offProgress?.(); offDone?.(); offUpdate?.() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Close panel on outside click
  useEffect(() => {
    if (!showDownloadManager) return
    const handler = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setShowDownloadManager(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showDownloadManager])

  if (!el) return null
  // WRLD's immersive fullscreen hides the window-control buttons this
  // trigger is anchored next to (see App.tsx / WrldView.tsx) — with no
  // corner reference left, it just floats awkwardly, so hide it too.
  if (wrldFullscreen) return null

  const active = downloads.filter((d) => d.state === 'downloading').length
  const hasDownloads = downloads.length > 0
  const activeUploads = downloads.filter((d) => d.type === 'upload' && d.state === 'downloading').length
  const stagedCount = stagedFileChanges.length
  const badgeCount = active + stagedCount

  return (
    <div ref={panelRef} className="fixed top-0 z-[9990]" style={{ right: '144px' }}>
      {/* Trigger icon */}
      <button
        onClick={() => setShowDownloadManager(!showDownloadManager)}
        className={`flex items-center justify-center w-9 h-7 transition-colors ${
          badgeCount > 0 ? 'text-[var(--accent)]' : hasDownloads ? 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]' : 'text-[var(--titlebar-icon,var(--text-muted))] hover:text-[var(--titlebar-icon-hover,var(--text-secondary))]'
        }`}
        title="Downloads"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="relative">
          <ArrowDownToLine size={14} className={active > 0 ? 'animate-pulse' : ''} />
          {badgeCount > 0 && (
            <span className="absolute -top-1.5 -right-2 min-w-[14px] h-[14px] rounded-full bg-[var(--accent)] text-white text-[9px] font-bold flex items-center justify-center px-0.5 leading-none">
              {badgeCount}
            </span>
          )}
        </div>
      </button>

      {/* Dropdown panel */}
      {showDownloadManager && (
        <div className="absolute top-full right-0 mt-1 w-[320px] rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2.5 bg-[var(--surface-overlay)] border-b border-[var(--border)]">
            <Download size={13} className="text-[var(--accent)] shrink-0" />
            <span className="text-[var(--text-primary)] text-xs font-semibold flex-1">
              Downloads
              {active > 0
                ? <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-[var(--accent)]/20 text-[var(--accent)] text-[10px] font-medium">{active} active</span>
                : downloads.length > 0
                  ? <span className="ml-1 text-[var(--text-muted)] font-normal text-[10px]">· {downloads.length}</span>
                  : null}
            </span>
            {downloads.some(d => d.state !== 'downloading') && (
              <button onClick={clearCompletedDownloads} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors px-1 rounded">
                Clear
              </button>
            )}
            {activeUploads > 1 && (
                <button onClick={cancelAllCompUploads} className="text-[10px] text-[var(--text-muted)] hover:text-red-400 transition-colors px-1 rounded">
                  Cancel All
                  </button>
              )}
            <button onClick={() => setShowDownloadManager(false)} className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
              <X size={13} />
            </button>
          </div>
          {/* List */}
          <div className="max-h-72 overflow-y-auto">
            {stagedFileChanges.length > 0 && (
              <StagedChanges changes={stagedFileChanges} onResult={setProposeResult} />
            )}
            {proposeResult && (
              <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
                <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                <span className="text-[var(--text-muted)] text-[11px] flex-1">{proposeResult}</span>
                <button onClick={() => setProposeResult(null)} className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                  <X size={11} />
                </button>
              </div>
            )}
            {downloads.length === 0 ? (
              stagedFileChanges.length === 0 && !proposeResult &&
                <p className="text-[var(--text-muted)] text-xs text-center py-6">No downloads</p>
            ) : (
              <div className="divide-y divide-[var(--border)]/40">
                {downloads.map((item) => <DownloadRow key={item.id} item={item} />)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Changes dragged together in the API Files tab, all waiting on one Propose.
// They sit above the transfer list because they're the only rows here the
// user still has to act on - everything below is already in flight or finished.
function StagedChanges({ changes, onResult }: {
  changes: StagedFileChange[]
  onResult: (message: string | null) => void
}): JSX.Element {
  const { unstageFileChange, clearStagedFileChanges } = useStorePick('unstageFileChange', 'clearStagedFileChanges')
  const [proposing, setProposing] = useState(false)

  const propose = async (): Promise<void> => {
    if (proposing) return
    setProposing(true)
    onResult(null)
    const { proposed, failed } = await proposeStagedChanges()
    setProposing(false)
    const parts = [`Proposed ${proposed}`]
    if (failed > 0) parts.push(`${failed} failed`)
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
            : <><Send size={12} /> Propose {changes.length} change{changes.length === 1 ? '' : 's'}</>}
        </button>
      </div>
    </div>
  )
}

function DownloadRow({ item }: { item: DownloadItem }): JSX.Element {
  const el = (window as any).electron
  const isDone = item.state === 'done'
  const isError = item.state === 'error' || item.state === 'cancelled'
  const isActive = item.state === 'downloading'
  const isUpload = item.type === 'upload'
  // A ZIP being built in the browser (lib/clientZip) - cancellable like an upload.
  const isZip = isZipTaskId(item.id)

  const sizeLabel = item.type === 'playlist'
    ? [
        item.total ? `${item.received ?? 0} / ${item.total} tracks` : null,
        item.bytesReceived ? formatBytes(item.bytesReceived) : null,
      ].filter(Boolean).join(' · ') || null
    : item.total && item.total > 0
      ? `${formatBytes(item.received ?? 0)} / ${formatBytes(item.total)}`
      : item.received ? formatBytes(item.received) : null

  const speedLabel = isActive && item.speedBps ? `${formatBytes(item.speedBps)}/s` : null

  const canOpen = isDone && !!item.savePath && !!el?.openPath

  return (
    <div
      className={`px-3 py-2.5 hover:bg-[var(--surface-overlay)] transition-colors${canOpen ? ' cursor-pointer' : ''}`}
      onClick={canOpen ? () => el.openPath(item.savePath!) : undefined}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">
          {isDone ? <CheckCircle2 size={13} className="text-emerald-400" />
            : isError ? <AlertCircle size={13} className="text-red-400" />
            : item.type === 'update' ? <RefreshCw size={13} className="text-[var(--accent)] animate-spin" />
            : isUpload ? <ArrowUpFromLine size={13} className="text-[var(--accent)] animate-pulse" />
            : <Loader2 size={13} className="text-[var(--accent)] animate-spin" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[var(--text-primary)] text-xs truncate leading-snug" title={item.filename}>{item.filename}</p>
          {item.detail && <p className="text-[var(--text-muted)] text-[10px] mt-0.5">{item.detail}</p>}
          {isActive && (sizeLabel || speedLabel) && (
            <p className="text-[var(--text-muted)] text-[10px] mt-0.5">
              {sizeLabel}{sizeLabel && speedLabel ? ' · ' : ''}{speedLabel}
            </p>
          )}
          {isDone && item.savePath && <p className="text-[var(--text-muted)] text-[10px] mt-0.5 truncate" title={item.savePath}>{item.savePath.split(/[/\\]/).pop()}</p>}
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
            <button onClick={() => cancelCompUpload(item.id)} title="Cancel upload"
              className="p-1 rounded hover:bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-red-400 transition-colors">
              <X size={12} />
            </button>
          )}
          {isDone && item.savePath && el?.showItemInFolder && (
            <button
              onClick={(e) => { e.stopPropagation(); el.showItemInFolder(item.savePath!) }}
              title="Show in folder"
              className="p-1 rounded hover:bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              <FolderOpen size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
