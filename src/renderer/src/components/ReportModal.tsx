import { ModalOverlay, LockToggle } from './Modal'
import { X, Flag, MessageSquareText } from 'lucide-react'
import { useStore } from '../store/useStore'
import ReportForm from './ReportForm'

// Global report dialog, mounted once at the app root and driven by the store's
// `reportModal` target - opened from a song's context menu / info panel (song
// mode) or anywhere a general feedback prompt is wired (feedback mode).
export default function ReportModal(): JSX.Element | null {
  const target = useStore((s) => s.reportModal)
  const closeReport = useStore((s) => s.closeReport)

  if (!target) return null

  const isSong = target.kind === 'song'
  const title = isSong ? 'Report an issue' : 'Send feedback'
  const Icon = isSong ? Flag : MessageSquareText

  return (
    <ModalOverlay
      onClose={closeReport}
      zIndexClassName="z-[170]"
      panelClassName="bg-surface border border-[var(--border)] rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-md max-h-[92svh]"
      minWidth={380} minHeight={380}
    >
      {({ onHandleMouseDown, locked, toggleLock, canLock }) => (
      <div className="bg-surface w-full h-full overflow-y-auto">
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] sticky top-0 bg-surface cursor-grab active:cursor-grabbing"
          onMouseDown={onHandleMouseDown}
        >
          <h2 className="flex items-center gap-2 text-text-primary text-sm font-semibold">
            <Icon size={15} className="text-accent" /> {title}
          </h2>
          <div className="flex items-center gap-1">
            {canLock && <LockToggle locked={locked} onClick={toggleLock} />}
            <button onClick={closeReport} title="Close" className="text-text-muted hover:text-text-primary transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="px-5 py-4">
          <ReportForm
            mode={isSong ? { kind: 'song', songId: target.songId, songName: target.songName } : { kind: 'feedback' }}
            onDone={closeReport}
          />
        </div>
      </div>
      )}
    </ModalOverlay>
  )
}
