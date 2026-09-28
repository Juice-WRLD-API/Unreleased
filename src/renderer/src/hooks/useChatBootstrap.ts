import { useEffect } from 'react'
import { useStorePick } from '../store/useStore'
import { hasChatAccess } from '../lib/chatAccess'
import { runWhenIdle } from '../lib/platform'

// The chat client (store, API, socket, share codecs) is staff-only, so it's a
// separate chunk loaded here on demand rather than part of everyone's startup
// bundle. `loaded` means someone has pulled it in - the only case where a
// teardown has anything to tear down.
const loadChatStore = () => import('../store/chatStore')
let loaded = false

// Keeps the chat socket alive app-wide for staff, so unread badges and Home's
// chat tile stay live without the chat view being open.
export function useChatBootstrap(): void {
  const { account } = useStorePick('account')
  const allowed = hasChatAccess(account)
  const accountId = account?.id ?? null

  useEffect(() => {
    if (!account || !allowed) {
      if (loaded) void loadChatStore().then((m) => m.useChatStore.getState().teardown())
      return
    }
    return runWhenIdle(() => {
      loaded = true
      void loadChatStore().then((m) => m.useChatStore.getState().init(account))
    }, 2500)
    // Re-run only when the signed-in identity or its access changes, not on
    // every account payload refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, allowed])
}
