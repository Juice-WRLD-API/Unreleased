import { Music } from 'lucide-react'
import { clickable } from '../../lib/a11y'
import type { RoomRef } from '../../store/chatStore'
import { useStore } from '../../store/useStore'
import { relativeTime } from '../adminShared'
import LocalNoticeFrame from './LocalNoticeFrame'

// Rendered for /np @user - what that person is playing, as their public
// now-playing endpoint reported when the command ran (a snapshot, not live).
export default function NowPlayingNowCard({ room, messageId, user, song, name, updatedAt }: {
  room?: RoomRef
  messageId?: number
  user: string
  song: number
  name: string
  updatedAt: string
}): JSX.Element {
  return (
    <LocalNoticeFrame room={room} messageId={messageId} title={`${user} is listening to`}>
      <div
        {...clickable(() => useStore.getState().setInfoSongId(song))}
        className="mt-2 flex items-center gap-2 cursor-pointer rounded hover:bg-surface-overlay px-1 -mx-1 py-0.5"
      >
        <Music size={14} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-xs text-text-primary">{name}</span>
        <span className="shrink-0 text-[11px] text-text-muted">{relativeTime(updatedAt)}</span>
      </div>
    </LocalNoticeFrame>
  )
}
