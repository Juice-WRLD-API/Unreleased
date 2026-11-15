import { create } from 'zustand'

// What the UI shows about offline playlist downloads. Written only by
// lib/offlineDownloads; kept apart from useStore so the Player's per-track
// "is this downloaded" lookup is a Set read, and a download ticking along
// re-renders only the views that show its progress.

export type OfflineStatus = 'queued' | 'downloading' | 'done' | 'partial' | 'error'

export interface OfflinePlaylistState {
  id: number
  name: string
  status: OfflineStatus
  /** Tracks that can be downloaded, and how many of them are. */
  total: number
  done: number
  /** Entries that can't be downloaded (local files, removed songs). */
  skipped: number
  /** Tracks that failed this round; retried on the next one. */
  failed: number
  error?: string
}

interface OfflineState {
  /** False until the saved downloads have been read back at startup. */
  loaded: boolean
  playlists: Record<number, OfflinePlaylistState>
  /** Every track id with a saved file. */
  trackIds: ReadonlySet<string>
  /** Bytes this site stores, and what the browser allows it. */
  usage: { used: number; quota: number } | null
  online: boolean
}

export const useOfflineStore = create<OfflineState>(() => ({
  loaded: false,
  playlists: {},
  trackIds: new Set<string>(),
  usage: null,
  online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
}))

if (typeof window !== 'undefined') {
  const sync = (): void => useOfflineStore.setState({ online: navigator.onLine !== false })
  window.addEventListener('online', sync)
  window.addEventListener('offline', sync)
}

export function patchOfflinePlaylist(id: number, patch: Partial<OfflinePlaylistState>): void {
  useOfflineStore.setState((s) => {
    const prev = s.playlists[id]
    if (!prev && !patch.name) return s
    return { playlists: { ...s.playlists, [id]: { ...(prev ?? { id, name: '', status: 'queued', total: 0, done: 0, skipped: 0, failed: 0 }), ...patch } } }
  })
}

export function dropOfflinePlaylist(id: number): void {
  useOfflineStore.setState((s) => {
    if (!s.playlists[id]) return s
    const next = { ...s.playlists }
    delete next[id]
    return { playlists: next }
  })
}

export function addOfflineTrackIds(ids: string[]): void {
  if (ids.length === 0) return
  useOfflineStore.setState((s) => {
    const next = new Set(s.trackIds)
    ids.forEach((id) => next.add(id))
    return { trackIds: next }
  })
}

export function removeOfflineTrackIds(ids: string[]): void {
  if (ids.length === 0) return
  useOfflineStore.setState((s) => {
    const next = new Set(s.trackIds)
    ids.forEach((id) => next.delete(id))
    return { trackIds: next }
  })
}

/** Whether this track has a saved file (reactive). */
export function useIsOfflineTrack(trackId: string): boolean {
  return useOfflineStore((s) => s.trackIds.has(trackId))
}
