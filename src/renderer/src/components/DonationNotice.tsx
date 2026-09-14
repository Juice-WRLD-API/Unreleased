import { useEffect, useState } from 'react'
import { Heart, Copy, Check, X as XIcon } from 'lucide-react'
import { COOKIE_NOTICE_ACK_EVENT } from './CookieNotice'

const STORAGE_KEY = 'donation-notice-dismissed'
const COOKIE_STORAGE_KEY = 'cookie-notice-ack'

function isCookieNoticeAcked(): boolean {
  try {
    return localStorage.getItem(COOKIE_STORAGE_KEY) === '1'
  } catch {
    return true
  }
}

const ADDRESSES = [
  { label: 'ETH', value: '0x82744830C7Df595e92f2F8c4EbBA87cE9DC94b4d' },
  { label: 'BTC', value: 'bc1qk9mtqeyfuhdtksmlcpsylt69xp9d6xvt5528h0' }
] as const

function AddressRow({ label, value }: { label: string; value: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2 min-w-0 bg-surface-overlay rounded-lg px-2.5 py-1.5">
      <span className="shrink-0 text-[10px] font-semibold text-text-muted w-8">{label}</span>
      <span className="min-w-0 flex-1 truncate text-[11px] font-mono text-text-secondary">{value}</span>
      <button
        onClick={() => {
          navigator.clipboard.writeText(value).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          })
        }}
        title={`Copy ${label} address`}
        className="shrink-0 p-1 rounded text-text-muted hover:text-accent transition-colors"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  )
}

// A one-time, dismissible notice inviting crypto donations to support the
// site. Purely informational - dismissing it is remembered so it never
// shows again on this device.
export default function DonationNotice(): JSX.Element | null {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      return true
    }
  })

  const dismiss = (): void => {
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // best effort - dismiss for this session regardless
    }
    setDismissed(true)
  }

  // Both notices anchor to the same bottom-center spot, so showing this one
  // while the cookie notice is still up would stack them. Wait for the
  // cookie notice to be acknowledged (or for it to have never appeared) -
  // its dismiss button broadcasts this event so we don't need a reload to
  // pick it up.
  const [cookieNoticeClear, setCookieNoticeClear] = useState(isCookieNoticeAcked)
  useEffect(() => {
    if (cookieNoticeClear) return
    const onAck = (): void => setCookieNoticeClear(true)
    window.addEventListener(COOKIE_NOTICE_ACK_EVENT, onAck)
    return () => window.removeEventListener(COOKIE_NOTICE_ACK_EVENT, onAck)
  }, [cookieNoticeClear])

  if (dismissed || !cookieNoticeClear) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-[9500] flex justify-center px-3 pb-3 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-[420px] rounded-2xl border border-[var(--border)] bg-surface shadow-2xl px-4 py-3.5">
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5 text-accent">
            <Heart size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-text-secondary text-xs leading-relaxed mb-2">
              Enjoying the site? Donations help keep it running.
            </p>
            <div className="flex flex-col gap-1.5">
              {ADDRESSES.map(a => <AddressRow key={a.label} label={a.label} value={a.value} />)}
            </div>
          </div>
          <button
            onClick={dismiss}
            title="Dismiss"
            className="shrink-0 p-1 rounded text-text-muted hover:text-text-primary transition-colors"
          >
            <XIcon size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
