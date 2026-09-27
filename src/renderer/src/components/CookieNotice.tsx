import { useState } from 'react'
import { Cookie } from 'lucide-react'
import LegalModal from './LegalModal'
import { useSandboxStore } from './Modal'

const STORAGE_KEY = 'cookie-notice-ack'
export const COOKIE_NOTICE_ACK_EVENT = 'cookie-notice-ack'

// A one-time, informational storage notice. The App only uses strictly
// necessary local storage (settings, session, cache) — there's no third-party
// ad tracking to consent to — so this discloses and dismisses rather than
// gating anything. The acknowledgement is remembered so it never shows twice.
export default function CookieNotice(): JSX.Element | null {
  const [ack, setAck] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      return true // storage blocked → nothing to disclose about, stay quiet
    }
  })
  const [showPrivacy, setShowPrivacy] = useState(false)

  const dismiss = (): void => {
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // best effort — dismiss for this session regardless
    }
    window.dispatchEvent(new Event(COOKIE_NOTICE_ACK_EVENT))
    setAck(true)
  }

  if (ack) return null

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-[9500] flex justify-center px-3 pb-3 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-[560px] rounded-2xl border border-[var(--border)] bg-surface shadow-2xl px-4 py-3.5 flex items-start gap-3">
          <div className="shrink-0 mt-0.5 text-accent">
            <Cookie size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-text-secondary text-xs leading-relaxed">
              This app stores data locally on your device — settings, your session if you sign in, and cached content —
              so it can work. It doesn&apos;t use third-party advertising or tracking cookies.{' '}
              <button
                onClick={() => { useSandboxStore.getState().expand(); setShowPrivacy(true) }}
                className="text-accent hover:underline font-medium"
              >
                Privacy Policy
              </button>
            </p>
          </div>
          <button
            onClick={dismiss}
            className="shrink-0 self-center px-3 py-1.5 rounded-lg bg-accent/15 hover:bg-accent/25 border border-accent/25 text-accent text-xs font-semibold transition-colors"
          >
            Got it
          </button>
        </div>
      </div>

      {showPrivacy && <LegalModal initialDoc="privacy" onClose={() => setShowPrivacy(false)} />}
    </>
  )
}
