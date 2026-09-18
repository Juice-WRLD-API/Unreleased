// Shared Last.fm connect/disconnect flow for Settings - identical on desktop
// and mobile. Token auth: fetch a token, send the user to last.fm to approve
// it, then poll getSession until approval lands (it returns null while the
// token is still unapproved). window.open reaches the system browser in
// every context - the Electron windows' window-open handlers route it
// through shell.openExternal.
import { useEffect, useRef, useState } from 'react'
import { lastfmGetAuthToken, lastfmAuthUrl, lastfmTryGetSession, lastfmDisconnect } from '../lib/lastfm'

export function useLastfmConnect(setLastfmUser: (name: string | null) => void): {
  lastfmBusy: boolean
  lastfmWaiting: boolean
  lastfmError: string | null
  connectLastfm: () => Promise<void>
  disconnectLastfm: () => void
  stopLastfmPoll: () => void
} {
  const [lastfmBusy, setLastfmBusy] = useState(false)
  const [lastfmWaiting, setLastfmWaiting] = useState(false)
  const [lastfmError, setLastfmError] = useState<string | null>(null)
  const lastfmPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopLastfmPoll = (): void => {
    if (lastfmPollRef.current) clearInterval(lastfmPollRef.current)
    lastfmPollRef.current = null
    setLastfmWaiting(false)
  }
  useEffect(() => () => { if (lastfmPollRef.current) clearInterval(lastfmPollRef.current) }, [])

  const connectLastfm = async (): Promise<void> => {
    setLastfmError(null)
    setLastfmBusy(true)
    try {
      const token = await lastfmGetAuthToken()
      window.open(lastfmAuthUrl(token), '_blank', 'noopener')
      setLastfmWaiting(true)
      const startedAt = Date.now()
      lastfmPollRef.current = setInterval(() => {
        // Tokens live ~60 minutes but nobody waits that long - give up well before.
        if (Date.now() - startedAt > 5 * 60_000) {
          stopLastfmPoll()
          setLastfmError('Authorization timed out - try again.')
          return
        }
        lastfmTryGetSession(token).then((session) => {
          if (session) { stopLastfmPoll(); setLastfmUser(session.name) }
        }).catch((e: unknown) => {
          stopLastfmPoll()
          setLastfmError(e instanceof Error ? e.message : 'Connection failed')
        })
      }, 5000)
    } catch (e) {
      setLastfmError(e instanceof Error ? e.message : 'Connection failed')
    } finally {
      setLastfmBusy(false)
    }
  }

  const disconnectLastfm = (): void => {
    lastfmDisconnect()
    setLastfmUser(null)
  }

  return { lastfmBusy, lastfmWaiting, lastfmError, connectLastfm, disconnectLastfm, stopLastfmPoll }
}
