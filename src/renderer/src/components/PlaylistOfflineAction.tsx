import { Download, Trash2, Loader2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import { IS_NATIVE_APP } from '../lib/platform'
import { getPlaylist } from '../lib/userApi'
import { playlistSongIds } from '../lib/playlistItems'
import { reportSaveError } from '../lib/fileSave'
import { SheetItem } from './mobile/Sheet'

export async function togglePlaylistOffline(id: number, name: string): Promise<void> {
  const key = `api-${id}`
  const s = useStore.getState()
  if (s.offlinePlaylists[key] && s.offlineSync[key]?.state !== 'error') await s.removePlaylistOffline(key)
  else {
    const detail = await getPlaylist(id)
    await s.downloadPlaylistOffline(key, name, playlistSongIds(detail.items))
  }
}

export default function PlaylistOfflineAction({ id, name }: { id: number; name: string }): JSX.Element | null {
  const saved = useStore((s) => !!s.offlinePlaylists[`api-${id}`])
  const sync = useStore((s) => s.offlineSync[`api-${id}`])
  if (!IS_NATIVE_APP) return null
  const busy = sync?.state === 'syncing'
  return <SheetItem
    icon={busy ? Loader2 : saved ? Trash2 : Download}
    label={busy ? `Downloading ${sync.current}/${sync.total}…` : sync?.state === 'error' ? 'Retry offline download' : saved ? 'Remove offline download' : 'Download offline'}
    sub={sync?.state === 'error' ? 'Download incomplete. Try again.' : 'Listen without an internet connection'}
    disabled={busy}
    onClick={() => { void togglePlaylistOffline(id, name).catch(reportSaveError) }}
  />
}
