import { CheckCircle2 } from 'lucide-react'
import type { RoomRef } from '../../store/chatStore'
import LocalNoticeFrame from './LocalNoticeFrame'

// Rendered for /feedback's local notice - confirms what was sent without
// leaving a "/feedback ..." message sitting in the room for everyone else.
export default function FeedbackSentCard({ room, messageId, message }: { room: RoomRef; messageId: number; message: string }): JSX.Element {
  return (
    <LocalNoticeFrame room={room} messageId={messageId} title="Feedback sent">
      <div className="mt-1.5 flex items-start gap-1.5">
        <CheckCircle2 size={14} className="shrink-0 mt-0.5 text-green-400" />
        <p className="text-xs text-text-secondary break-words [overflow-wrap:anywhere]">{message}</p>
      </div>
    </LocalNoticeFrame>
  )
}
