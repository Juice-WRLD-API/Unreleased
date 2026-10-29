import type { OfflineTrackMeta } from '../types'

// Downloaded copies the player couldn't open this session: the file was
// deleted, its drive is gone, or a folder move left the index pointing at
// where it used to be. Such a song plays from the server instead, and the next
// playlist resync downloads it again. Keyed by the copy (path + download time)
// rather than the song, so a re-download or a repointed index entry is tried
// again.
const unreadable = new Map<string, string>()

const copyKey = (entry: Pick<OfflineTrackMeta, 'localPath' | 'downloadedAt'>): string =>
  `${entry.localPath}|${entry.downloadedAt}`

export function markOfflineCopyUnreadable(id: string, entry: Pick<OfflineTrackMeta, 'localPath' | 'downloadedAt'>): void {
  unreadable.set(id, copyKey(entry))
}

export function isOfflineCopyUnreadable(id: string, entry: Pick<OfflineTrackMeta, 'localPath' | 'downloadedAt'>): boolean {
  return unreadable.get(id) === copyKey(entry)
}
