import type { RoomRef } from '../../store/chatStore'
import LocalNoticeFrame from './LocalNoticeFrame'

// Rendered for the plain "it worked" answers - /theme <name>, /mute, /role,
// /allow and friends - which used to be a toast that vanished. Shown to just
// the sender as a local notice, or to the room when the command had `-s`.
export default function ResultCard({ room, messageId, title, text }: {
  room?: RoomRef
  messageId?: number
  title: string
  text: string
}): JSX.Element {
  return (
    <LocalNoticeFrame room={room} messageId={messageId} title={title}>
      <p className="mt-2 text-xs text-text-secondary whitespace-pre-line break-words [overflow-wrap:anywhere]">{text}</p>
    </LocalNoticeFrame>
  )
}
