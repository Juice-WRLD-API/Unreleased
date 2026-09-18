// ZIP-job state shared by ApiFilesView.desktop.tsx and .mobile.tsx - starting
// a job, polling it, and triggering the download were byte-identical between
// the two views. Selection is read through `getSelectedEntries` rather than a
// shared type, since desktop (useMultiSelect Map) and mobile (a plain Set)
// use different selection models.
//
// Backend ZIP jobs are disabled (see ZIP_OPERATIONS_ENABLED in juicewrldApi.ts),
// so this downloads every file individually instead: directories are expanded
// recursively via listFilesRecursive, then each file is downloaded one at a
// time through the browser's normal download mechanism.
import { useState } from 'react'
import { buildStreamUrl, JWApiFileEntry, listFilesRecursive } from '../lib/juicewrldApi'
import { triggerDownload, ZipStatus } from '../lib/apiFilesShared'

// Spacing consecutive downloads out - firing them all in the same tick makes
// Chrome silently block everything past the first few as a popup/download flood.
const DOWNLOAD_SPACING_MS = 350

export function useApiFilesZip(opts: { activeChannel: string; getSelectedEntries: () => JWApiFileEntry[] }): {
  zipStatus: ZipStatus
  resetZip: () => void
  downloadZip: () => Promise<void>
  downloadFolder: (entry: { path: string; name: string }) => Promise<void>
} {
  const { activeChannel, getSelectedEntries } = opts
  const [zipStatus, setZipStatus] = useState<ZipStatus>('idle')

  const downloadEntries = async (entries: JWApiFileEntry[]): Promise<void> => {
    if (entries.length === 0) return
    setZipStatus('starting')
    try {
      const files: JWApiFileEntry[] = []
      for (const entry of entries) {
        if (entry.type === 'file') files.push(entry)
        else files.push(...await listFilesRecursive(entry.path, activeChannel))
      }
      if (files.length === 0) { setZipStatus('idle'); return }
      setZipStatus('zipping')
      for (const file of files) {
        triggerDownload(buildStreamUrl(file.path, activeChannel), file.name)
        await new Promise((r) => setTimeout(r, DOWNLOAD_SPACING_MS))
      }
      setZipStatus('done')
      setTimeout(() => setZipStatus('idle'), 3000)
    } catch {
      setZipStatus('error')
      setTimeout(() => setZipStatus('idle'), 3000)
    }
  }

  const downloadZip = (): Promise<void> => downloadEntries(getSelectedEntries())

  const downloadFolder = (entry: { path: string; name: string }): Promise<void> =>
    downloadEntries([{ ...entry, type: 'directory' }])

  return { zipStatus, resetZip: () => setZipStatus('idle'), downloadZip, downloadFolder }
}
