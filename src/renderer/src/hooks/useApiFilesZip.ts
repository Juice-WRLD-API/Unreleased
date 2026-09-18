// ZIP-job state shared by ApiFilesView.desktop.tsx and .mobile.tsx - starting
// a job, polling it, and triggering the download were byte-identical between
// the two views. Selection is read through `getSelectedPaths` rather than a
// shared type, since desktop (useMultiSelect Map) and mobile (a plain Set)
// use different selection models.
import { useState } from 'react'
import { apiFetch, JWAPI_BASE } from '../lib/juicewrldApi'
import { triggerDownload, ZipStatus } from '../lib/apiFilesShared'

export function useApiFilesZip(opts: { activeChannel: string; getSelectedPaths: () => string[] }): {
  zipStatus: ZipStatus
  resetZip: () => void
  downloadZip: () => Promise<void>
  downloadFolder: (entry: { path: string; name: string }) => Promise<void>
} {
  const { activeChannel, getSelectedPaths } = opts
  const [zipStatus, setZipStatus] = useState<ZipStatus>('idle')

  // Backend zips a folder path recursively with its subfolder structure
  // intact (see /files/zip-selection/'s `{ "paths": ["Compilation/Folder"] }`
  // shape in the docs), so a single directory path is enough - no need to
  // walk and flatten the tree client-side.
  const startZip = async (paths: string[], filename: string): Promise<void> => {
    if (paths.length === 0) return
    setZipStatus('starting')
    try {
      const res = await fetch(`${JWAPI_BASE}/start-zip-job/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(activeChannel ? { paths, channel: activeChannel } : { paths }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { job_id } = await res.json() as { job_id: string }
      setZipStatus('zipping')
      const poll = async (): Promise<void> => {
        const st = await apiFetch<{ status: string; download_url?: string; error?: string }>(`/zip-job-status/${job_id}/`)
        if (st.status === 'completed' && st.download_url) {
          triggerDownload(st.download_url, filename)
          setZipStatus('done')
          setTimeout(() => setZipStatus('idle'), 3000)
        } else if (st.status === 'failed') {
          throw new Error(st.error || 'ZIP job failed')
        } else {
          setTimeout(() => { poll().catch(() => { setZipStatus('error'); setTimeout(() => setZipStatus('idle'), 3000) }) }, 1500)
        }
      }
      await poll()
    } catch {
      setZipStatus('error')
      setTimeout(() => setZipStatus('idle'), 3000)
    }
  }

  const downloadZip = (): Promise<void> => startZip(getSelectedPaths(), 'selection.zip')

  const downloadFolder = (entry: { path: string; name: string }): Promise<void> => startZip([entry.path], `${entry.name}.zip`)

  return { zipStatus, resetZip: () => setZipStatus('idle'), downloadZip, downloadFolder }
}
