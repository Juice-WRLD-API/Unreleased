// ZIP-job state shared by ApiFilesView.desktop.tsx and .mobile.tsx - starting
// a job, polling it, and triggering the download were byte-identical between
// the two views. Selection is read through `getSelectedEntries` rather than a
// shared type, since desktop (useMultiSelect Map) and mobile (a plain Set)
// use different selection models.
//
// Backend ZIP jobs are disabled (see ZIP_OPERATIONS_ENABLED in juicewrldApi.ts),
// so the archive is built client-side instead (lib/clientZip): directories are
// expanded recursively via listFilesRecursive, keeping their folder structure
// inside the ZIP. If the browser can only build it in memory and it's too big,
// falls back to downloading each file individually.
import { useState } from 'react'
import { buildStreamUrl, JWApiFileEntry, listFilesRecursive } from '../lib/juicewrldApi'
import { ZipStatus } from '../lib/apiFilesShared'
import { openZipTarget, saveItems, ZipItem, ZipProgress } from '../lib/clientZip'

export function useApiFilesZip(opts: { activeChannel: string; getSelectedEntries: () => JWApiFileEntry[] }): {
  zipStatus: ZipStatus
  zipProgress: ZipProgress | null
  resetZip: () => void
  downloadZip: () => Promise<void>
  downloadFolder: (entry: { path: string; name: string }) => Promise<void>
} {
  const { activeChannel, getSelectedEntries } = opts
  const [zipStatus, setZipStatus] = useState<ZipStatus>('idle')
  const [zipProgress, setZipProgress] = useState<ZipProgress | null>(null)

  const finish = (status: ZipStatus): void => {
    setZipStatus(status)
    setZipProgress(null)
    setTimeout(() => setZipStatus('idle'), 3000)
  }

  const downloadEntries = async (entries: JWApiFileEntry[], archiveName: string): Promise<void> => {
    if (entries.length === 0) return
    // Before any await - the save dialog needs the click's user activation.
    const target = await openZipTarget(archiveName)
    if (!target) return
    setZipStatus('starting')
    const items: ZipItem[] = []
    try {
      for (const entry of entries) {
        if (entry.type === 'file') {
          items.push({ name: entry.name, url: buildStreamUrl(entry.path, activeChannel), size: entry.size })
          continue
        }
        // Keep the folder's own name and layout inside the archive.
        const prefix = entry.path.replace(/\/+$/, '') + '/'
        for (const file of await listFilesRecursive(entry.path, activeChannel)) {
          const rel = file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.name
          items.push({ name: `${entry.name}/${rel}`, url: buildStreamUrl(file.path, activeChannel), size: file.size })
        }
      }
      if (items.length === 0) { setZipStatus('idle'); return }
      setZipStatus('zipping')
      const { saved, cancelled } = await saveItems(target, items, setZipProgress)
      if (cancelled) { setZipStatus('idle'); setZipProgress(null); return }
      finish(saved > 0 ? 'done' : 'error')
    } catch {
      finish('error')
    }
  }

  const downloadZip = (): Promise<void> => {
    const entries = getSelectedEntries()
    const name = entries.length === 1 ? entries[0].name.replace(/\.[^.]+$/, '') : 'Selected files'
    return downloadEntries(entries, name)
  }

  const downloadFolder = (entry: { path: string; name: string }): Promise<void> =>
    downloadEntries([{ ...entry, type: 'directory' }], entry.name)

  return { zipStatus, zipProgress, resetZip: () => setZipStatus('idle'), downloadZip, downloadFolder }
}
