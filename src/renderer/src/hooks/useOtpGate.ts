import { useEffect, useState } from 'react'
import { getOtpSetup, confirmOtpSetup } from '../lib/userApi'
import type { OtpSetupPayload } from '../lib/userApi'
import { errorMessage } from '../lib/format'

// State machine behind AdminPage's OtpSetupPanel (desktop + mobile render
// slightly different JSX around this, so the JSX itself stays in each
// platform file - only the data/loading/error/confirm logic moves here).
export function useOtpGate(onEnabled: () => Promise<void>) {
  const [setup, setSetup] = useState<OtpSetupPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [code, setCodeRaw] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getOtpSetup()
      .then(setSetup)
      .catch(e => setError(errorMessage(e, 'Could not load')))
      .finally(() => setLoading(false))
  }, [])

  // Matches the original inline onChange, which cleared any prior error as
  // soon as the user started editing the code again.
  const setCode = (value: string): void => {
    setCodeRaw(value)
    setError(null)
  }

  const confirm = async (): Promise<void> => {
    setConfirming(true); setError(null)
    try {
      await confirmOtpSetup(code)
      await onEnabled()
    } catch (e) {
      setError(errorMessage(e, 'Verification failed'))
    } finally {
      setConfirming(false)
    }
  }

  return { setup, loading, code, setCode, confirming, error, confirm }
}
