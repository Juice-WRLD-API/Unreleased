import { CHAT_COMMANDS } from '../../lib/chatCommands'
import type { RoomRef } from '../../store/chatStore'
import LocalNoticeFrame from './LocalNoticeFrame'

// Rendered for /help's local notice (see chatStore's postLocalNotice) - this
// card only ever exists in the requester's own client, never on the server,
// so no one else in the room can see it.
export default function HelpCard({ room, messageId }: { room: RoomRef; messageId: number }): JSX.Element {
  const commands = CHAT_COMMANDS.filter((c) => c.name !== 'help')
  return (
    <LocalNoticeFrame room={room} messageId={messageId} title="Commands">
      <dl className="mt-2 space-y-1.5">
        {commands.map((c) => (
          <div key={c.name} className="flex gap-2 text-xs">
            <dt className="shrink-0 font-mono text-accent">{c.usage}</dt>
            <dd className="text-text-secondary min-w-0">{c.description}</dd>
          </div>
        ))}
      </dl>
    </LocalNoticeFrame>
  )
}
