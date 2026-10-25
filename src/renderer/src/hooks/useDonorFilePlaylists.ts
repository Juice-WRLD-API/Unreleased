// Which of the user's playlists hold one donor file, and toggling it in and
// out - shared by the My files row picker and the donor file menu.
// Membership is read from the cached playlist details (getPlaylists seeds
// them for every playlist), so the picker opens without fetching. Adds and
// removes are optimistic and roll back with a toast.
import { useState } from 'react'
import * as userApi from '../lib/userApi'
import type { PlaylistSummary } from '../lib/userApi'
import { addEntriesInBackground } from '../lib/optimisticPlaylist'
import { showAppToast } from '../lib/appToast'
import { useStore } from '../store/useStore'

const findEntry = (playlistId: number, fileId: string): userApi.PlaylistItemEntry | undefined =>
  userApi.peekPlaylistDetail(playlistId)?.items.find((it) => it.donor_file?.file_id === fileId)

export function useDonorFilePlaylists(fileId: string): {
  playlists: PlaylistSummary[]
  inList: (playlistId: number) => boolean
  toggle: (playlistId: number) => void
  createWith: (name: string) => Promise<void>
} {
  const playlists = useStore((s) => s.playlists)
  const [override, setOverride] = useState<Map<number, boolean>>(new Map())
  const mark = (id: number, value: boolean): void => setOverride((m) => new Map(m).set(id, value))

  const inList = (id: number): boolean => override.get(id) ?? !!findEntry(id, fileId)

  const toggle = (id: number): void => {
    if (!inList(id)) {
      mark(id, true)
      void addEntriesInBackground(id, [{ source: 'donor', file_id: fileId }]).then((failed) => {
        if (failed.length) mark(id, false)
      })
      return
    }
    const entry = findEntry(id, fileId)
    if (!entry) return
    mark(id, false)
    userApi.removePlaylistEntry(id, entry.id)
      .then(() => useStore.getState().refreshPlaylists())
      .catch(() => { mark(id, true); showAppToast("Couldn't remove it from the playlist") })
  }

  const createWith = async (name: string): Promise<void> => {
    try {
      const pl = await userApi.createPlaylist(name)
      await userApi.addPlaylistEntry(pl.id, { source: 'donor', file_id: fileId })
      await useStore.getState().refreshPlaylists()
    } catch { showAppToast("Couldn't create the playlist") }
  }

  return { playlists, inList, toggle, createWith }
}
