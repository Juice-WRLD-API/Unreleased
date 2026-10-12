import { CHAT_COMMANDS } from '../../lib/chatCommands'
import type { RoomRef } from '../../store/chatStore'
import LocalNoticeFrame from './LocalNoticeFrame'

// Rendered for /help's local notice (see chatStore's postLocalNotice) - this
// card only ever exists in the requester's own client, never on the server,
// so no one else in the room can see it.
export default function HelpCard({ room, messageId }: { room?: RoomRef; messageId?: number }): JSX.Element {
  const commands = CHAT_COMMANDS.filter((c) => c.name !== 'help')
  return (
    <LocalNoticeFrame room={room} messageId={messageId} title="Commands">
      <dl className="mt-2 space-y-2">
        {commands.map((c) => (
          <div key={c.name} className="text-xs min-w-0">
            <dt className="font-mono text-accent break-words [overflow-wrap:anywhere]">{c.usage}</dt>
            <dd className="mt-0.5 text-text-secondary break-words [overflow-wrap:anywhere]">{c.description}</dd>
          </div>
        ))}
      </dl>
    </LocalNoticeFrame>
  )
}
