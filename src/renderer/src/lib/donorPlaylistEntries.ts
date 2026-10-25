// Donor files live in ordinary synced playlists now (as `donor` entries - see
// lib/playlistItems), so there is one kind of playlist instead of a separate
// donor-only list in user_settings.donor_playlists. This module moves those
// old lists over, and keeps a file's playlist slots when a tag edit replaces
// it with a re-uploaded copy (which gets a new file_id).
import { addPlaylistEntry, createPlaylist, deletePlaylist, getPlaylist, peekPlaylistDetail, reorderPlaylistItems } from './userApi'
import type { PlaylistItemEntry } from './userApi'
import { showAppToast } from './appToast'
import { useStore } from '../store/useStore'

let migrating = false

/** Turn each old donor playlist into a synced playlist of donor entries, then
 *  drop it from user_settings. One at a time, so an interrupted run leaves
 *  the rest for the next sign-in. Files deleted since are skipped. */
export async function migrateDonorPlaylists(): Promise<void> {
  const st = useStore.getState()
  if (migrating || !st.account || st.donorPlaylists.length === 0) return
  migrating = true
  let moved = 0
  try {
    for (const dp of [...st.donorPlaylists]) {
      const created = await createPlaylist(dp.name)
      try {
        for (const fileId of dp.fileIds) {
          await addPlaylistEntry(created.id, { source: 'donor', file_id: fileId }).catch((err: Error) => {
            if (!/not found/i.test(err.message)) throw err
          })
        }
      } catch (err) {
        // Don't leave a half-filled copy behind for the next attempt to duplicate.
        await deletePlaylist(created.id).catch(() => undefined)
        throw err
      }
      const now = useStore.getState()
      now._setDonorPlaylists(now.donorPlaylists.filter((p) => p.id !== dp.id))
      moved++
    }
  } catch {
    // Offline or the server said no: try again next time.
  } finally {
    migrating = false
    if (moved) {
      await useStore.getState().refreshPlaylists().catch(() => undefined)
      showAppToast(`Moved ${moved} donor playlist${moved === 1 ? '' : 's'} into your playlists`)
    }
  }
}

export interface DonorSlot { playlistId: number; index: number }

const entryOf = (items: PlaylistItemEntry[], fileId: string): PlaylistItemEntry | undefined =>
  items.find((it) => it.donor_file?.file_id === fileId)

/** Where a donor file sits in the user's playlists, read before the file is
 *  deleted (the server drops its entries along with it). */
export async function findDonorSlots(fileId: string): Promise<DonorSlot[]> {
  const slots: DonorSlot[] = []
  for (const p of useStore.getState().playlists) {
    const detail = peekPlaylistDetail(p.id) ?? await getPlaylist(p.id).catch(() => null)
    if (!detail) continue
    const ordered = [...detail.items].sort((a, b) => a.position - b.position)
    const at = ordered.findIndex((it) => it.donor_file?.file_id === fileId)
    if (at >= 0) slots.push({ playlistId: p.id, index: at })
  }
  return slots
}

/** Put the replacement file back where the old one was. */
export async function restoreDonorSlots(slots: DonorSlot[], newFileId: string): Promise<void> {
  for (const { playlistId, index } of slots) {
    try {
      const detail = await addPlaylistEntry(playlistId, { source: 'donor', file_id: newFileId })
      const ordered = [...detail.items].sort((a, b) => a.position - b.position)
      const added = entryOf(ordered, newFileId)
      if (!added) continue
      const ids = ordered.filter((it) => it.id !== added.id).map((it) => it.id)
      ids.splice(Math.min(index, ids.length), 0, added.id)
      await reorderPlaylistItems(playlistId, ids)
    } catch { /* the file is still in the user's files; only its slot is lost */ }
  }
  if (slots.length) void useStore.getState().refreshPlaylists()
}
