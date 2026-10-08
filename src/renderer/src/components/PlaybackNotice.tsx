import { AlertCircle } from 'lucide-react'
import { usePlaybackNotice } from '../lib/playbackNotice'

/** Pill above the player for playback problems that would otherwise be silent. */
export default function PlaybackNotice(): JSX.Element | null {
  const message = usePlaybackNotice()
  if (!message) return null
  return (
    <div
      role="status"
      className="fixed left-1/2 -translate-x-1/2 z-[80] max-w-[calc(100vw-2rem)] flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-surface-highest text-text-primary text-[13px] shadow-2xl animate-slide-up"
      style={{ bottom: 'calc(var(--bottom-nav-height, 0px) + 112px)' }}
    >
      <AlertCircle size={14} className="text-red-400 shrink-0" />
      <span className="truncate">{message}</span>
    </div>
  )
}
