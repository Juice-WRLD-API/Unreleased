// Shared "download selection as .zip" flow for PlaylistsView desktop/mobile.
import { useCallback, useState } from 'react'
import { JWAPI_BASE } from '../lib/juicewrldApi'
import type { Track } from '../types'

export function usePlaylistZipDownload(): {
  zipState: 'idle' | 'loading' | 'done' | 'error'
  handleZipDownload: (trackList: Track[], name: string) => Promise<void>
} {
  const [zipState, setZipState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  const handleZipDownload = useCallback(async (trackList: Track[], name: string) => {
    if (zipState === 'loading') return
    const paths = trackList.map(t => t.path).filter(Boolean)
    if (!paths.length) return
    setZipState('loading')
    try {
      const res = await fetch(`${JWAPI_BASE}/files/zip-selection/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      })
      if (!res.ok) throw new Error()
      const contentType = res.headers.get('content-type') || ''
      if (contentType.includes('zip') || contentType.includes('octet-stream')) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = `${name}.zip`; a.click()
        URL.revokeObjectURL(url)
      } else {
        const data = await res.json()
        if (data.download_url) { const a = document.createElement('a'); a.href = data.download_url; a.download = `${name}.zip`; a.click() }
      }
      setZipState('done')
    } catch { setZipState('error') }
    setTimeout(() => setZipState('idle'), 3000)
  }, [zipState])

  return { zipState, handleZipDownload }
}
