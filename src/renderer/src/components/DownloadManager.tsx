import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Download, X, CheckCircle2, AlertCircle, Loader2, RefreshCw, FolderOpen, ArrowUpFromLine } from 'lucide-react'
import { useStore, useStorePick, DownloadItem } from '../store/useStore'
import { formatBytes } from '../lib/format'
import { cancelCompUpload, cancelAllCompUploads } from '../lib/compUploads'
import { cancelDonorUpload, cancelAllDonorUploads, isDonorUploadId } from '../lib/donorUploads'
import { cancelChatUpload, cancelAllChatUploads, isChatUploadId } from '../lib/chatUploads'
import { cancelZipTask, isZipTaskId } from '../lib/clientZip'
import { PopLayer } from './PopLayer'
import { useListMotion } from '../hooks/useListMotion'
import { useContentMotion } from '../hooks/useContentMotion'

export default function DownloadManager(): JSX.Element | null {
  const { downloads, showDownloadManager, setShowDownloadManager, addDownload, updateDownload, clearCompletedDownloads, setUpdateStatus, wrldFullscreen } = useStorePick('downloads', 'showDownloadManager', 'setShowDownloadManager', 'addDownload', 'updateDownload', 'clearCompletedDownloads', 'setUpdateStatus', 'wrldFullscreen')
  const { sidebarPosition, navStyle, autoHideNav } = useStorePick('sidebarPosition', 'navStyle', 'autoHideNav')
  const el = (window as any).electron
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useListMotion(listRef)
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

  // Close panel on outside click. The nav's Transfers button toggles the
  // panel itself, so a press on it mustn't also count as "outside".
  useEffect(() => {
    if (!showDownloadManager) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Element
      if (panelRef.current?.contains(target) || target.closest?.(TRANSFERS_ANCHOR)) return
      setShowDownloadManager(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showDownloadManager])

  // Pop the panel out of the nav's Transfers button, on whichever side of it
  // faces into the window. Re-placed on resize and whenever the nav layout
  // changes while it's open.
  const [panelPos, setPanelPos] = useState<React.CSSProperties>(FALLBACK_POS)
  useLayoutEffect(() => {
    if (!showDownloadManager) return
    const place = (): void => setPanelPos(anchoredPanelPos(sidebarPosition))
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [showDownloadManager, sidebarPosition, navStyle, autoHideNav, downloads.length > 0])

  if (!el) return null
  // WRLD's immersive fullscreen hides the nav this panel pops out of, so
  // keep it from appearing over the fullscreen view.
  if (wrldFullscreen) return null
  if (!showDownloadManager) return null

  const active = downloads.filter((d) => d.state === 'downloading').length
  const activeUploads = downloads.filter((d) => d.type === 'upload' && d.state === 'downloading').length

  return (
    <PopLayer ref={panelRef} className="fixed z-[9990] animate-menu-pop" style={panelPos}>
      <div className="w-[320px] rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden">
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
              <button onClick={() => { cancelAllCompUploads(); cancelAllDonorUploads(); cancelAllChatUploads() }} className="text-[10px] text-[var(--text-muted)] hover:text-red-400 transition-colors px-1 rounded">
                Cancel All
                </button>
            )}
          <button onClick={() => setShowDownloadManager(false)} className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
            <X size={13} />
          </button>
        </div>
        {/* List */}
        <div className="max-h-72 overflow-y-auto">
          <div ref={listRef} className="relative divide-y divide-[var(--border)]/40">
            {downloads.length === 0 && (
              <p className="text-[var(--text-muted)] text-xs text-center py-6">No downloads</p>
            )}
            {downloads.map((item) => <DownloadRow key={item.id} item={item} />)}
          </div>
        </div>
      </div>
    </PopLayer>
  )
}

// Set on the nav's Transfers control (Sidebar.tsx) in every nav layout.
const TRANSFERS_ANCHOR = '[data-transfers-anchor]'
const PANEL_GAP = 8
const EDGE_GAP = 12
// No visible Transfers button (hidden in Settings, auto-hidden nav, narrow
// window): sit in the top-right corner, below the window controls.
const FALLBACK_POS: React.CSSProperties = { top: 36, right: EDGE_GAP }

function visibleAnchor(): Element | null {
  for (const node of Array.from(document.querySelectorAll(TRANSFERS_ANCHOR))) {
    const r = node.getBoundingClientRect()
    const onScreen = r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight
    if (onScreen && getComputedStyle(node).visibility !== 'hidden') return node
  }
  return null
}

function anchoredPanelPos(sidebarPosition: string): React.CSSProperties {
  const node = visibleAnchor()
  if (!node) return FALLBACK_POS
  const r = node.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (sidebarPosition === 'top' || sidebarPosition === 'bottom') {
    // Horizontal bar: below (top bar) or above (bottom bar), right edges lined up.
    const right = Math.max(EDGE_GAP, vw - r.right)
    return r.top < vh / 2 ? { top: r.bottom + PANEL_GAP, right } : { bottom: vh - r.top + PANEL_GAP, right }
  }
  // Side menu: beside the button, growing up from it when it sits low (the
  // controls live at the foot of the menu).
  const x = r.left < vw / 2 ? { left: r.right + PANEL_GAP } : { right: vw - r.left + PANEL_GAP }
  const y = r.top < vh / 2 ? { top: Math.max(EDGE_GAP, r.top) } : { bottom: Math.max(EDGE_GAP, vh - r.bottom) }
  return { ...x, ...y }
}

function DownloadRow({ item }: { item: DownloadItem }): JSX.Element {
  const statusRef = useRef<HTMLDivElement>(null)
  useContentMotion(statusRef, item.state)
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
      data-flip-key={item.id}
      className={`px-3 py-2.5 hover:bg-[var(--surface-overlay)] transition-colors${canOpen ? ' cursor-pointer' : ''}`}
      onClick={canOpen ? () => el.openPath(item.savePath!) : undefined}
    >
      <div className="flex items-start gap-2">
        <div ref={statusRef} className="mt-0.5 shrink-0">
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
              <div className="h-full bg-[var(--accent)] rounded-full origin-left control-motion" style={{ transform: `scaleX(${Math.max(0, Math.min(100, item.percent)) / 100})` }} />
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
