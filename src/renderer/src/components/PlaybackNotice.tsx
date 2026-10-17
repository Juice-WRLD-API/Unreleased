import { AlertCircle } from 'lucide-react'
import { usePlaybackNotice } from '../lib/playbackNotice'

/** Pill above the player for playback problems that would otherwise be silent. */
export default function PlaybackNotice(): JSX.Element | null {
  const message = usePlaybackNotice()
  if (!message) return null
  // Center with a full-width wrapper: animate-slide-up's transform would
  // override a -translate-x-1/2 on the pill itself.
  return (
    <div
      role="status"
      className="fixed inset-x-0 z-[80] flex justify-center px-4 pointer-events-none"
      style={{ bottom: 'calc(var(--bottom-nav-height, 0px) + 112px)' }}
    >
      <div className="pointer-events-auto max-w-full flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-surface-highest text-text-primary text-[13px] shadow-2xl animate-slide-up">
        <AlertCircle size={14} className="text-red-400 shrink-0" />
        <span className="truncate">{message}</span>
      </div>
    </div>
  )
}
