import { clickable } from '../../lib/a11y'
import { NP_HISTORY_MAX } from '../../lib/chatCommands'
import type { RoomRef } from '../../store/chatStore'
import { useStore } from '../../store/useStore'
import { relativeTime } from '../adminShared'
import LocalNoticeFrame from './LocalNoticeFrame'

// Rendered for /np -h's local notice - your own listening log, so it stays on
// this device unless you pass -s to post it to the room.
export default function NowPlayingHistoryCard({ room, messageId, items, total, capped }: {
  room?: RoomRef
  messageId?: number
  items: { song: number; name: string; played_at: string }[]
  total: number
  capped: boolean
}): JSX.Element {
  return (
    <LocalNoticeFrame room={room} messageId={messageId} title="Recently played">
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-text-muted">No listening history yet.</p>
      ) : (
        <ol className="mt-2 space-y-1">
          {items.map((p, i) => (
            <li
              key={`${p.song}-${p.played_at}-${i}`}
              {...clickable(() => useStore.getState().setInfoSongId(p.song))}
              className="flex items-baseline gap-2 text-xs cursor-pointer rounded hover:bg-surface-overlay px-1 -mx-1"
            >
              <span className="w-4 shrink-0 text-right text-text-muted tabular-nums">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-text-primary">{p.name}</span>
              <span className="shrink-0 text-text-muted">{relativeTime(p.played_at)}</span>
            </li>
          ))}
        </ol>
      )}
      {capped && <p className="mt-2 text-[10px] text-text-muted">Capped at {NP_HISTORY_MAX} plays.</p>}
      {total > items.length && <p className="mt-1 text-[10px] text-text-muted">{items.length} of {total} plays logged.</p>}
    </LocalNoticeFrame>
  )
}
