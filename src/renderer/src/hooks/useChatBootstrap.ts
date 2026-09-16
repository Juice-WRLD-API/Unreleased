import { useEffect } from 'react'
import { useStorePick } from '../store/useStore'
import { hasChatAccess, useChatStore } from '../store/chatStore'
import { runWhenIdle } from '../lib/platform'

// Keeps the chat socket alive app-wide for staff, so unread badges and Home's
// chat tile stay live without the chat view being open.
export function useChatBootstrap(): void {
  const { account } = useStorePick('account')
  const allowed = hasChatAccess(account)
  const accountId = account?.id ?? null

  useEffect(() => {
    if (!account || !allowed) {
      useChatStore.getState().teardown()
      return
    }
    return runWhenIdle(() => { void useChatStore.getState().init(account) }, 2500)
    // Re-run only when the signed-in identity or its access changes, not on
    // every account payload refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, allowed])
}
