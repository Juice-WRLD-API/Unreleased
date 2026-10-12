// Progress toast for single-file CDN downloads (see hooks/useCdnFileDownload).
// Renders nothing while no download is in flight.
import { Loader2 } from 'lucide-react'
import { useCdnFileDownloads, fileDownloadLabel } from '../hooks/useCdnFileDownload'

function ProgressBar({ percent }: { percent: number }): JSX.Element {
  return (
    <div className="mt-2 h-1 rounded-full bg-surface-overlay overflow-hidden">
      <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${percent}%` }} />
    </div>
  )
}

/** Bottom-right card. `raised` lifts it above another bottom-right toast
 *  (the Files tab's folder-download one) so the two don't overlap. */
export function CdnDownloadToast({ raised = false }: { raised?: boolean }): JSX.Element | null {
  const downloads = useCdnFileDownloads()
  if (downloads.length === 0) return null
  return (
    <div className={`fixed right-5 z-50 w-72 bg-surface border border-[var(--border)] rounded-lg shadow-2xl px-3.5 py-2.5 text-xs text-text-primary ${raised ? 'bottom-[4.5rem]' : 'bottom-5'}`}>
      <div className="flex items-center gap-2 min-w-0">
        <Loader2 size={13} className="animate-spin text-accent shrink-0" />
        <span className="truncate">{fileDownloadLabel(downloads)}</span>
      </div>
      <ProgressBar percent={downloads[downloads.length - 1].progress?.progress ?? 0} />
    </div>
  )
}

/** Full-width pill above the mobile views' other toasts, clear of the
 *  player and the nav bar (whose height BottomNav publishes as a CSS var). */
export function CdnDownloadToastMobile(): JSX.Element | null {
  const downloads = useCdnFileDownloads()
  if (downloads.length === 0) return null
  return (
    <div
      className="fixed left-4 right-4 z-[75] px-4 py-2.5 rounded-2xl bg-surface-highest text-text-primary text-[13px] shadow-2xl animate-slide-up"
      style={{ bottom: 'calc(var(--bottom-nav-height, 0px) + 144px)' }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Loader2 size={14} className="animate-spin text-accent shrink-0" />
        <span className="truncate">{fileDownloadLabel(downloads)}</span>
      </div>
      <ProgressBar percent={downloads[downloads.length - 1].progress?.progress ?? 0} />
    </div>
  )
}
