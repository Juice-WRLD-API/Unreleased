import { Cloud, Globe, MonitorSmartphone } from 'lucide-react'
import { Suspense, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { lazyView } from '../lib/lazyView'
import ApiFilesBrowser from './ApiFilesBrowser'
import { useContentMotion } from '../hooks/useContentMotion'
import { GlassSegmented } from './GlassSegmented'

// Donor-only, so everyone else never downloads it.
const DonorFiles = lazyView(() => import('./DonorFiles'))

// Donors get a third source beside API and Local: their own cloud storage.
// It's a separate store with its own routes, so it swaps in as its own page
// rather than being threaded through the channel file browser. The source
// switch lives in each page's header (the browser's own, and this one's).
export default function ApiFilesView({ embedded = false }: { embedded?: boolean } = {}): JSX.Element {
  const isDonor = useStore((s) => !!s.account?.is_donor)
  const [mine, setMine] = useState(false)
  // Which browser source to come back to from My files.
  const [backToLocal, setBackToLocal] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  useContentMotion(contentRef, mine ? 'mine' : 'channels')
  if (!isDonor) return <ApiFilesBrowser embedded={embedded} />
  const isElectron = navigator.userAgent.includes('Electron')

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
      <div ref={contentRef} className="flex flex-col flex-1 min-h-0 min-w-0">
        {mine ? (
          <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-8 pb-player">
            <div className={`flex items-center justify-between gap-4 pb-3 ${embedded ? 'pt-1' : isElectron ? 'pt-9' : 'pt-5'}`}>
              <div className="flex items-center gap-2.5 min-w-0">
                <Cloud size={18} className="text-text-muted shrink-0" />
                <h1 className="text-text-primary text-xl font-bold">My files</h1>
              </div>
              <GlassSegmented
                ariaLabel="Source"
                value="mine"
                onChange={(v) => { if (v !== 'mine') { setBackToLocal(v === 'local'); setMine(false) } }}
                options={[
                  { value: 'api', label: 'API', icon: <Globe size={12} />, title: 'Browse API files' },
                  ...(isElectron ? [{ value: 'local', label: 'Local', icon: <MonitorSmartphone size={12} />, title: 'Browse local files' }] : []),
                  { value: 'mine', label: 'My files', icon: <Cloud size={12} />, title: 'Your own cloud storage' },
                ]}
              />
            </div>
            <Suspense fallback={null}><DonorFiles /></Suspense>
          </div>
        ) : <ApiFilesBrowser embedded={embedded} startLocal={backToLocal} onMine={() => setMine(true)} />}
      </div>
    </div>
  )
}
