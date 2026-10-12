import { MessagesSquare } from 'lucide-react'
import { lazyOverlay } from '../../lib/lazyView'

const ChatUnreadBadge = lazyOverlay(() => import('./ChatUnreadBadge'))

export default function ChatNavIcon({ size = 18 }: { size?: number }): JSX.Element {
  return (
    <span className="relative inline-flex">
      <MessagesSquare size={size} />
      <ChatUnreadBadge />
    </span>
  )
}
