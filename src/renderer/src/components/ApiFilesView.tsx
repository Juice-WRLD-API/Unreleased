import { Cloud } from 'lucide-react'
import { Suspense, useState } from 'react'
import { useIsMobile } from '../hooks/useIsMobile'
import { useStore } from '../store/useStore'
import { lazyView, responsiveView } from '../lib/lazyView'

const ChannelBrowser = responsiveView(() => import('./ApiFilesView.desktop'), () => import('./ApiFilesView.mobile'))
// Donor-only, so everyone else never downloads it.
const DonorFiles = lazyView(() => import('./DonorFiles'))

// Donors get a second location beside the comp channels: their own cloud
// storage. It's a separate store with its own routes, so it swaps in as its
// own page rather than being threaded through the channel file browser.
export default function ApiFilesView(): JSX.Element {
  const isMobile = useIsMobile()
  const isDonor = useStore((s) => !!s.account?.is_donor)
  const [mine, setMine] = useState(false)
  const browser = <ChannelBrowser />
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
      {/* Full width, matching the channel browser (ApiFilesView.desktop/mobile) -
          this used to be capped to a narrow settings-style column. */}
      {mine ? (
        <div className={`flex-1 min-h-0 overflow-y-auto ${isMobile ? 'px-4 pb-6' : 'px-5 pb-8'}`}>
          <div className="flex items-center gap-2.5 pt-5 pb-3">
            <Cloud size={18} className="text-text-muted shrink-0" />
            <h1 className="text-text-primary text-xl font-bold">My files</h1>
          </div>
          <Suspense fallback={null}><DonorFiles /></Suspense>
        </div>
      ) : browser}
    </div>
  )
}
ApiFilesView.preload = ChannelBrowser.preload
