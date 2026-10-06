import type { BroadcastMessage } from '../../lib/broadcastApi'
import type { RoomRef } from '../../store/chatStore'
import { relativeTime } from '../adminShared'
import { LEVEL_STYLE } from '../BroadcastModal'
import LocalNoticeFrame from './LocalNoticeFrame'

// Rendered for /broadcast -h's local notice - the list is fetched once when
// the command runs, so it's a snapshot rather than a live feed.
export default function BroadcastHistoryCard({ room, messageId, items, total }: {
  room?: RoomRef
  messageId?: number
  items: BroadcastMessage[]
  total: number
}): JSX.Element {
  return (
    <LocalNoticeFrame room={room} messageId={messageId} title="Past broadcasts">
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-text-muted">No broadcasts have been sent yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((b) => (
            <li key={b.id} className="text-xs">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`rounded border px-1 py-px text-[9px] font-bold uppercase tracking-wider ${LEVEL_STYLE[b.level] ?? LEVEL_STYLE.info}`}>{b.level}</span>
                {b.title && <span className="font-semibold text-text-primary break-words [overflow-wrap:anywhere]">{b.title}</span>}
                <span className="text-text-muted">{b.sender} · {relativeTime(b.sent_at)}</span>
              </div>
              <p className="mt-0.5 text-text-secondary break-words [overflow-wrap:anywhere]">{b.message}</p>
            </li>
          ))}
        </ul>
      )}
      {total > items.length && (
        <p className="mt-2 text-[10px] text-text-muted">Showing the latest {items.length} of {total}.</p>
      )}
    </LocalNoticeFrame>
  )
}
