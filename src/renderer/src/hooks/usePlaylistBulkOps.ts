// Shared playlist-level (not track-level) bulk delete/add-to operations for
// PlaylistsView desktop/mobile. Keys are the "api:<id>" / "local:<id>"
// composite both views already use for playlist multi-select.
import { useCallback, useState } from 'react'
import * as userApi from '../lib/userApi'
import type { LocalPlaylist } from '../types'

export function usePlaylistBulkDeletePlaylists(
  refreshPlaylists: () => Promise<void>,
  deleteLocalPlaylist: (id: string) => void,
  selectedId: number | null,
  setSelectedId: (id: number | null) => void,
  localSelectedId: string | null,
  setLocalSelectedId: (id: string | null) => void,
  exitPlaylistSelectMode: () => void,
): { busy: boolean; run: (keys: string[]) => Promise<void> } {
  const [busy, setBusy] = useState(false)

  const run = useCallback(async (keys: string[]) => {
    if (!keys.length) return
    setBusy(true)
    const apiIds = keys.filter(k => k.startsWith('api:')).map(k => Number(k.slice(4)))
    const localIds = keys.filter(k => k.startsWith('local:')).map(k => k.slice(6))
    try {
      await Promise.all(apiIds.map(id => userApi.deletePlaylist(id).catch(() => {})))
    } finally {
      localIds.forEach(id => deleteLocalPlaylist(id))
      if (selectedId != null && apiIds.includes(selectedId)) setSelectedId(null)
      if (localSelectedId != null && localIds.includes(localSelectedId)) setLocalSelectedId(null)
      await refreshPlaylists()
      setBusy(false)
      exitPlaylistSelectMode()
    }
  }, [refreshPlaylists, deleteLocalPlaylist, selectedId, setSelectedId, localSelectedId, setLocalSelectedId, exitPlaylistSelectMode])

  return { busy, run }
}

export function usePlaylistBulkAddPlaylistsTo(
  refreshPlaylists: () => Promise<void>,
  localPlaylists: LocalPlaylist[],
  addToLocalPlaylist: (targetId: string, trackId: string) => void,
  exitPlaylistSelectMode: () => void,
  onDone?: () => void,
): { busy: boolean; run: (keys: string[], target: { kind: 'api'; id: number } | { kind: 'local'; id: string }) => Promise<void> } {
  const [busy, setBusy] = useState(false)

  const run = useCallback(async (keys: string[], target: { kind: 'api'; id: number } | { kind: 'local'; id: string }) => {
    setBusy(true)
    try {
      if (target.kind === 'api') {
        const srcIds = keys.filter(k => k.startsWith('api:')).map(k => Number(k.slice(4))).filter(id => id !== target.id)
        for (const srcId of srcIds) {
          const srcDetail = await userApi.getPlaylist(srcId).catch(() => null)
          if (!srcDetail) continue
          await Promise.all(srcDetail.items.map(item => userApi.addToPlaylist(target.id, item.song.id).catch(() => {})))
        }
        await refreshPlaylists()
      } else {
        const srcIds = keys.filter(k => k.startsWith('local:')).map(k => k.slice(6)).filter(id => id !== target.id)
        const targetPl = localPlaylists.find(p => p.id === target.id)
        const existing = new Set(targetPl?.trackIds ?? [])
        for (const srcId of srcIds) {
          const src = localPlaylists.find(p => p.id === srcId)
          if (!src) continue
          src.trackIds.filter(id => !existing.has(id)).forEach(id => { existing.add(id); addToLocalPlaylist(target.id, id) })
        }
      }
    } finally {
      setBusy(false)
      onDone?.()
      exitPlaylistSelectMode()
    }
  }, [refreshPlaylists, localPlaylists, addToLocalPlaylist, exitPlaylistSelectMode, onDone])

  return { busy, run }
}
