import { useCallback, useEffect, useState } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import { fetchChannels, type NewsChannel } from '../lib/newsApi'
import { errorMessage } from '../lib/format'
import { NewsChannelsEditor } from './NewsChannelsModal'

// Admin console home for the News feed's channels - the same editor the News
// view's "Manage channels" button opens, without having to go through the feed.
export default function NewsChannelsTab(): JSX.Element {
  const [channels, setChannels] = useState<NewsChannel[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setChannels(await fetchChannels())
      setError(null)
    } catch (e) {
      setError(errorMessage(e, 'Failed to load news channels'))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (!channels && !error) return <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-text-muted" /></div>

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg">
        {error && (
          <p className="mx-5 mt-4 text-xs text-red-400 flex items-center gap-1.5"><AlertCircle size={12} />{error}</p>
        )}
        {channels && <NewsChannelsEditor channels={channels} onChanged={load} />}
      </div>
    </div>
  )
}
