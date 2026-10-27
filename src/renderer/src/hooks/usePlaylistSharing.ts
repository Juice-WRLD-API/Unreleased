// Shared "make public + copy share link" flow for PlaylistsView desktop/mobile.
import { copyText } from '../lib/clipboard'
import { useCallback, useState } from 'react'
import * as userApi from '../lib/userApi'
import type { PlaylistDetail } from '../lib/userApi'
import { shareOrigin } from '../lib/platform'
import { showAppToast } from '../lib/appToast'
import { PRIVATE_PLAYLIST_REASON } from '../lib/optimisticPlaylist'

export function usePlaylistSharing(
  selectedId: number | null,
  detail: PlaylistDetail | null,
  setDetail: React.Dispatch<React.SetStateAction<PlaylistDetail | null>>,
): {
  shareCopied: boolean
  togglingPublic: boolean
  handleTogglePublic: () => Promise<void>
  handleShare: () => Promise<void>
} {
  const [shareCopied, setShareCopied] = useState(false)
  const [togglingPublic, setTogglingPublic] = useState(false)

  const handleTogglePublic = useCallback(async () => {
    if (!selectedId || !detail) return
    if (!detail.is_public && detail.can_be_public === false) { showAppToast(PRIVATE_PLAYLIST_REASON); return }
    setTogglingPublic(true)
    try {
      const updated = await userApi.updatePlaylist(selectedId, { is_public: !detail.is_public })
      setDetail(updated)
    } catch (e) { console.error('toggle public failed', e); showAppToast("Couldn't change the playlist's visibility") }
    finally { setTogglingPublic(false) }
  }, [selectedId, detail, setDetail])

  const handleShare = useCallback(async () => {
    if (!selectedId || !detail) return
    if (!detail.is_public && detail.can_be_public === false) { showAppToast(PRIVATE_PLAYLIST_REASON); return }
    try {
      // Ensure playlist is public before sharing
      if (!detail.is_public) {
        const updated = await userApi.updatePlaylist(selectedId, { is_public: true })
        setDetail(updated)
      }
      await copyText(`${shareOrigin()}/playlists?id=${selectedId}&view=shared`)
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2500)
    } catch { showAppToast("Couldn't share the playlist") }
  }, [selectedId, detail, setDetail])

  return { shareCopied, togglingPublic, handleTogglePublic, handleShare }
}
