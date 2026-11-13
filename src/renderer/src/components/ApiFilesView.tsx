import { Cloud, Globe } from 'lucide-react'
import { Suspense, useRef, useState } from 'react'
import { useIsMobile } from '../hooks/useIsMobile'
import { useStore } from '../store/useStore'
import { lazyView, responsiveView } from '../lib/lazyView'
import { useContentMotion } from '../hooks/useContentMotion'
import { GlassSegmented } from './GlassSegmented'

const ChannelBrowser = responsiveView(() => import('./ApiFilesView.desktop'), () => import('./ApiFilesView.mobile'))
// Donor-only, so everyone else never downloads it.
const DonorFiles = lazyView(() => import('./DonorFiles'))

// Donors get a second location beside the comp channels: their own cloud
// storage. It's a separate store with its own routes, so it swaps in as its
// own page rather than being threaded through the channel file browser.
// `embedded`: shown as the Tracker's Files tab, under the Tracker's own
// title, so the channel browser drops its page title.
export default function ApiFilesView({ embedded = false }: { embedded?: boolean }): JSX.Element {
  const isMobile = useIsMobile()
  const isDonor = useStore((s) => !!s.account?.is_donor)
  const [mine, setMine] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  useContentMotion(contentRef, mine ? 'mine' : 'channels')
  // On desktop the browser's own header carries the source switch (API / My files).
  const browser = <ChannelBrowser embedded={embedded} onMine={isMobile ? undefined : () => setMine(true)} />
  if (!isDonor) return browser

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
      {isMobile && (
        <div className="shrink-0 flex items-center gap-2 px-4 pt-3">
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
      )}
      {/* Full width, matching the channel browser (ApiFilesView.desktop/mobile) -
          this used to be capped to a narrow settings-style column. */}
      <div ref={contentRef} className="flex flex-col flex-1 min-h-0 min-w-0">
        {mine ? (
          <div className={`flex-1 min-h-0 overflow-y-auto ${isMobile ? 'px-4 pb-6' : 'px-5 pb-8 pb-player'}`}>
            <div className={`flex items-center justify-between gap-4 pb-3 ${isMobile || !embedded ? 'pt-5' : 'pt-1'}`}>
              <div className="flex items-center gap-2.5 min-w-0">
                <Cloud size={18} className="text-text-muted shrink-0" />
                <h1 className="text-text-primary text-xl font-bold">My files</h1>
              </div>
              {!isMobile && (
                <GlassSegmented
                  ariaLabel="Source"
                  value="mine"
                  onChange={(v) => { if (v !== 'mine') setMine(false) }}
                  options={[
                    { value: 'api', label: 'API', icon: <Globe size={12} />, title: 'Browse API files' },
                    { value: 'mine', label: 'My files', icon: <Cloud size={12} />, title: 'Your own cloud storage' },
                  ]}
                />
              )}
            </div>
            <Suspense fallback={null}><DonorFiles /></Suspense>
          </div>
        ) : browser}
      </div>
    </div>
  )
}
ApiFilesView.preload = ChannelBrowser.preload
