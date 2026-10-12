import { useCallback, useState } from 'react'
import { Check } from 'lucide-react'

// Shared "toast" pattern: a short-lived pill above the bottom nav, confirming
// a fire-and-forget action (copy, queue add, import/export result). Was
// hand-rolled per-view (ApiFilesView, then PlaylistsView) before this —
// pulled out once a second view needed the same thing.

export function useToast(durationMs = 1800): { toast: string | null; showToast: (msg: string) => void } {
  const [toast, setToast] = useState<string | null>(null)
  const showToast = useCallback((msg: string): void => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), durationMs)
  }, [durationMs])
  return { toast, showToast }
}

export function Toast({ text }: { text: string | null }): JSX.Element | null {
  if (!text) return null
  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[75] flex items-center gap-2 px-4 py-2.5 rounded-full bg-surface-highest text-text-primary text-[13px] shadow-2xl animate-slide-up"
      style={{ bottom: 'calc(var(--bottom-nav-height, 0px) + 92px)' }}
    >
      <Check size={14} className="text-accent" /> {text}
    </div>
  )
}
