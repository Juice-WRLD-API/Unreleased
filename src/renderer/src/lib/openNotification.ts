// Follows a notification area entry's target (see lib/notificationHistory) -
// the same place its banner went when clicked. Separate from the history
// module because it needs both stores, and the chat store records into the
// history, so importing them there would be a cycle.
import { useChatStore } from '../store/chatStore'
import { useStore } from '../store/useStore'
import type { NotificationTarget } from './notificationHistory'

export function openNotificationTarget(target: NotificationTarget): void {
  if (target.view === 'news') {
    useStore.getState().setActiveView('news')
    // Same hand-off as NewsNotifier: NewsView reads this on mount, or the
    // event if it's already open.
    try {
      sessionStorage.setItem('news:openPostId', String(target.postId))
    } catch {}
    window.dispatchEvent(new CustomEvent('news:open', { detail: target.postId }))
    return
  }
  useStore.setState({ activeView: 'chat' })
  const chat = useChatStore.getState()
  const room = target.room
  if (room) {
    const path = room.kind === 'channel' ? `/chat/c/${room.id}` : `/chat/dm/${room.id}`
    if (window.location.pathname !== path) window.history.pushState({ view: 'chat' }, '', path)
    chat.openRoom(room)
  } else if (!chat.active) {
    // A device alert's approve prompt lives in the room pane, so make sure
    // one is open.
    const conv = chat.conversations[0]
    if (conv) chat.openRoom({ kind: 'conversation', id: conv.id })
  }
}
