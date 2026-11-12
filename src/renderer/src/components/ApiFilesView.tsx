import { Cloud } from 'lucide-react'
import { Suspense, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { lazyView } from '../lib/lazyView'
import ApiFilesBrowser from './ApiFilesBrowser'
import { useContentMotion } from '../hooks/useContentMotion'
import { GlassSegmented } from './GlassSegmented'

// Donor-only, so everyone else never downloads it.
const DonorFiles = lazyView(() => import('./DonorFiles'))

// Donors get a second location beside the comp channels: their own cloud
// storage. It's a separate store with its own routes, so it swaps in as its
// own page rather than being threaded through the channel file browser.
export default function ApiFilesView({ embedded = false }: { embedded?: boolean } = {}): JSX.Element {
  const isDonor = useStore((s) => !!s.account?.is_donor)
  const [mine, setMine] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  useContentMotion(contentRef, mine ? 'mine' : 'channels')
  if (!isDonor) return <ApiFilesBrowser embedded={embedded} />

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
      <div className={`shrink-0 flex items-center gap-2 px-5 ${embedded ? 'pb-2' : 'pt-3'}`}>
        <GlassSegmented
          ariaLabel="Location"
          value={mine ? 'mine' : 'channels'}
          onChange={(v) => setMine(v === 'mine')}
          options={[{ value: 'channels', label: 'Channels' }, { value: 'mine', label: 'My files' }]}
        />
      </div>
      <div ref={contentRef} className="flex flex-col flex-1 min-h-0 min-w-0">
        {mine ? (
          <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-8 pb-player">
            <div className="flex items-center gap-2.5 pt-5 pb-3">
              <Cloud size={18} className="text-text-muted shrink-0" />
              <h1 className="text-text-primary text-xl font-bold">My files</h1>
            </div>
            <Suspense fallback={null}><DonorFiles /></Suspense>
          </div>
        ) : <ApiFilesBrowser embedded={embedded} />}
      </div>
    </div>
  )
}
