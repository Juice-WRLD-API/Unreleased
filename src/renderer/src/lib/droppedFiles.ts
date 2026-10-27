// Files dragged in from the OS (or picked with a folder input), flattened to
// a list of bodies plus the path each should land at relative to the drop
// folder - so dropping "Session/stems/a.wav" keeps the Session/stems nesting.

export interface LocalUpload {
  file: File
  /** Forward-slash path under the target folder, e.g. "Session/stems/a.wav". */
  relPath: string
}

// OS metadata that rides along with a dragged folder and never belongs in comp/.
const JUNK = new Set(['.ds_store', 'thumbs.db', 'desktop.ini'])
const isJunk = (name: string): boolean => JUNK.has(name.toLowerCase()) || name.startsWith('._')

/** Whether a drag carries OS files, as opposed to an in-app row drag. */
export function isFileDrag(dt: DataTransfer): boolean {
  return Array.from(dt.types).includes('Files')
}

/** Walks a drop's files and folders recursively. The entries are read out of
 *  the DataTransfer synchronously - it's emptied once the drop handler returns,
 *  so this must be called directly from onDrop, before any await. */
export function collectDroppedFiles(dt: DataTransfer): Promise<LocalUpload[]> {
  const entries = Array.from(dt.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => !!e)
  // No entry API (or nothing it recognised) - fall back to the flat file list,
  // which still covers plain files; folders just can't be expanded then.
  const flat = Array.from(dt.files)
  if (entries.length === 0) {
    return Promise.resolve(flat.filter((f) => !isJunk(f.name)).map((file) => ({ file, relPath: file.name })))
  }

  const out: LocalUpload[] = []
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (isJunk(entry.name)) return
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))
      out.push({ file, relPath: prefix + entry.name })
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      // readEntries hands back at most ~100 children per call; keep reading
      // until it returns an empty batch.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
        if (batch.length === 0) break
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`)
      }
    }
  }
  return (async () => {
    for (const e of entries) await walk(e, '')
    return out
  })()
}

/** Files from an `<input type="file">`, keeping a folder input's relative paths. */
export function filesFromInput(list: FileList | null): LocalUpload[] {
  return Array.from(list ?? [])
    .map((file) => ({ file, relPath: file.webkitRelativePath || file.name }))
    .filter(({ relPath }) => !relPath.split('/').some(isJunk))
}
