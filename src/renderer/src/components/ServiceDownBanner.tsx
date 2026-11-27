import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, XCircle } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { IS_ELECTRON } from '../lib/platform'
import { useServiceStatus } from '../lib/serviceStatus'

// Shown across the top of the main window while juicewrldapi.com is down
// (lib/serviceStatus decides that). Dismissing hides it for this outage only;
// the next one shows it again. Not shown on the Status page, which says the
// same thing in full.
export default function ServiceDownBanner(): JSX.Element | null {
  const { activeView, setActiveView } = useStorePick('activeView', 'setActiveView')
  const status = useServiceStatus()
  const outageStart = status.downSince
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())

  const show = status.state === 'down' && dismissed !== outageStart && activeView !== 'status'

  useEffect(() => {
    if (!show) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [show])

  if (!show) return null

  const next = status.nextCheckAt ? Math.max(0, Math.ceil((status.nextCheckAt - now) / 1000)) : null
  const retry = status.checking ? 'Checking…' : next != null ? `Checking again in ${next} s` : ''
  const lead = IS_ELECTRON ? 'Downloads and local files still play.' : 'Pages you’ve opened show their last copy.'

  return createPortal(
    <div
      className="fixed inset-x-0 z-[240] flex justify-center pointer-events-none px-3"
      style={{ top: IS_ELECTRON ? 44 : 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
    >
      <div
        role="status"
        className="pointer-events-auto relative flex items-center gap-3 pl-3.5 pr-2 py-2.5 rounded-2xl glass-thick glass-specular text-sm max-w-[min(560px,100%)] animate-status-banner-in"
      >
        <XCircle size={18} className="text-red-400 shrink-0" />
        <div className="min-w-0">
          <p className="text-text-primary font-medium leading-tight">juicewrldapi.com is down</p>
          <p className="text-text-secondary text-xs mt-0.5">{lead}{retry ? ` ${retry}.` : ''}</p>
        </div>
        <button
          onClick={() => setActiveView('status')}
          className="shrink-0 px-2.5 py-1 rounded-lg bg-accent text-white text-xs font-medium hover:opacity-90"
        >
          Status
        </button>
        <button onClick={() => setDismissed(outageStart)} title="Hide" aria-label="Hide" className="p-1 rounded-md text-text-muted hover:text-text-primary shrink-0">
          <X size={14} />
        </button>
      </div>
    </div>,
    document.body,
  )
}
