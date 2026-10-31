// Shared "make public + copy share link" flow for PlaylistsView desktop/mobile.
import { useCallback, useState } from 'react'
import * as userApi from '../lib/userApi'
import type { PlaylistDetail } from '../lib/userApi'
import { shareOrigin } from '../lib/platform'
import { showAppToast } from '../lib/appToast'
import { PRIVATE_PLAYLIST_REASON, setPlaylistPublic } from '../lib/optimisticPlaylist'

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

  // Optimistic: the label flips now and flips back (setPlaylistPublic toasts)
  // if the server says no.
  const handleTogglePublic = useCallback(async () => {
    if (!selectedId || !detail) return
    if (!detail.is_public && detail.can_be_public === false) { showAppToast(PRIVATE_PLAYLIST_REASON); return }
    const next = !detail.is_public
    const mark = (value: boolean): void => setDetail(d => (d && d.id === selectedId ? { ...d, is_public: value } : d))
    mark(next)
    setTogglingPublic(true)
    const actual = await setPlaylistPublic(selectedId, next)
    if (actual !== next) mark(actual)
    setTogglingPublic(false)
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
      await navigator.clipboard.writeText(`${shareOrigin()}/playlists?id=${selectedId}&view=shared`)
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2500)
    } catch { showAppToast("Couldn't share the playlist") }
  }, [selectedId, detail, setDetail])

  return { shareCopied, togglingPublic, handleTogglePublic, handleShare }
}
