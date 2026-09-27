import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { onChatNotificationBanner, type ChatNotificationPayload } from '../lib/chatNotifications'
import { clickable } from '../lib/a11y'

interface BannerToast extends ChatNotificationPayload {
  toastId: number
}

const AUTO_DISMISS_MS = 6000

// Mounted once in the main window (App), next to NewsNotifier. Shows a
// Discord-style in-app banner whenever a chat notification fires, so new
// messages are visible even while browsing somewhere else in the app.
export default function ChatNotificationBanner(): JSX.Element | null {
  const [toasts, setToasts] = useState<BannerToast[]>([])
  const nextId = useRef(1)

  useEffect(() => onChatNotificationBanner((payload) => {
    const toastId = nextId.current++
    setToasts((t) => [...t.slice(-2), { ...payload, toastId }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.toastId !== toastId)), AUTO_DISMISS_MS)
  }), [])

  if (toasts.length === 0) return null

  const dismiss = (toastId: number): void => setToasts((t) => t.filter((x) => x.toastId !== toastId))

  return createPortal(
    // Always-mounted live region, so an incoming message is announced rather
    // than appearing silently. Polite: a new chat message shouldn't interrupt.
    <div
      role="status"
      aria-live="polite"
      className="fixed top-4 right-4 z-[250] flex flex-col gap-2 w-[320px] max-w-[calc(100vw-2rem)] pointer-events-none"
    >
      {toasts.map((t) => (
        <div
          key={t.toastId}
          {...clickable(() => { t.onOpen(); dismiss(t.toastId) })}
          className="animate-slide-in-right pointer-events-auto cursor-pointer flex items-start gap-2.5 p-3 rounded-xl border border-[var(--border)] bg-surface shadow-2xl"
        >
          {t.icon ? (
            <img src={t.icon} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
          ) : (
            <span className="w-9 h-9 rounded-full bg-accent/20 shrink-0" />
          )}
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-sm font-semibold text-text-primary truncate">{t.title}</p>
            <p className="text-xs text-text-muted line-clamp-2 break-words">{t.body}</p>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); dismiss(t.toastId) }}
            className="p-1 -m-1 rounded-md text-text-muted hover:text-text-primary shrink-0"
            aria-label="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}
