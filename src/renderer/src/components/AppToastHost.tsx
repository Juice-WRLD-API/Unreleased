// Renders lib/appToast's toasts - the brief error shown when an optimistic
// action rolls back, or an info notice with an optional action button. Same
// look as the chat's ToastHost.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Info, X } from 'lucide-react'
import { dismissAppToast, subscribeAppToasts, type AppToast } from '../lib/appToast'

export default function AppToastHost(): JSX.Element {
  const [toasts, setToasts] = useState<AppToast[]>([])
  useEffect(() => subscribeAppToasts(setToasts), [])
  return createPortal(
    // Always-mounted live region, so the text is announced when it appears.
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 -translate-x-1/2 z-[200] flex flex-col items-center gap-2 pointer-events-none"
      style={{ bottom: 'calc(var(--bottom-nav-height, 0px) + 96px)' }}
    >
      {toasts.map(t => (
        <div key={t.id} className="pointer-events-auto flex items-center gap-2.5 pl-3 pr-2 py-2 rounded-xl border border-[var(--border)] bg-surface shadow-2xl text-sm text-text-primary max-w-[90vw]">
          {t.tone === 'info'
            ? <Info size={16} className="text-accent shrink-0" />
            : <AlertCircle size={16} className="text-red-400 shrink-0" />}
          <span className="min-w-0">{t.text}</span>
          {t.action && (
            <button
              onClick={() => { dismissAppToast(t.id); t.action!.onClick() }}
              className="shrink-0 px-2.5 py-1 rounded-lg bg-accent text-white text-xs font-medium hover:opacity-90"
            >
              {t.action.label}
            </button>
          )}
          <button onClick={() => dismissAppToast(t.id)} title="Dismiss" className="p-1 rounded-md text-text-muted hover:text-text-primary">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}
