import { useState } from 'react'
import { useIsMobile } from '../hooks/useIsMobile'
import { useStore } from '../store/useStore'
import ApiFilesViewDesktop from './ApiFilesView.desktop'
import ApiFilesViewMobile from './ApiFilesView.mobile'
import DonorFiles from './DonorFiles'

// Donors get a second location beside the comp channels: their own cloud
// storage. It's a separate store with its own routes, so it swaps in as its
// own page rather than being threaded through the channel file browser.
export default function ApiFilesView(): JSX.Element {
  const isMobile = useIsMobile()
  const isDonor = useStore((s) => !!s.account?.is_donor)
  const [mine, setMine] = useState(false)
  const browser = isMobile ? <ApiFilesViewMobile /> : <ApiFilesViewDesktop />
  if (!isDonor) return browser

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
      <div className={`shrink-0 flex items-center gap-2 pt-3 ${isMobile ? 'px-4' : 'px-5'}`}>
        <div className="flex items-center bg-surface-overlay rounded-lg p-1 gap-0.5">
          {([[false, 'Channels'], [true, 'My files']] as const).map(([value, label]) => (
            <button
              key={label}
              onClick={() => setMine(value)}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${mine === value ? 'bg-surface-raised text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}
            >{label}</button>
          ))}
        </div>
      </div>
      {mine ? (
        <div className={`flex-1 min-h-0 overflow-y-auto pb-6 ${isMobile ? 'px-4' : 'px-5 max-w-3xl'}`}>
          <h1 className="text-text-primary text-xl font-bold pt-4 pb-1">My files</h1>
          <DonorFiles />
        </div>
      ) : browser}
    </div>
  )
}
