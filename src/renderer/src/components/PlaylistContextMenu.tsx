import { useState } from 'react'
import {
  Play, Shuffle, ListEnd, Archive, Link, Globe, Lock, Pencil, Trash2, FolderInput, Check, Download, Share2,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { useShallow } from 'zustand/react/shallow'
import * as userApi from '../lib/userApi'
import { setPlaylistPublic, addPlaylistInBackground, PRIVATE_PLAYLIST_REASON } from '../lib/optimisticPlaylist'
import type { PlaylistSummary } from '../lib/userApi'
import { buildStreamUrl, JWAPI_BASE } from '../lib/juicewrldApi'
import { resolveTrackFile } from '../lib/sessionEditsApi'
import { shareOrigin } from '../lib/platform'
import { openZipTarget, saveItems } from '../lib/clientZip'
import { Track } from '../types'
import { hasChatAccess } from '../lib/chatAccess'
import { lazyOverlay } from '../lib/lazyView'
import ContextMenu from './ContextMenu'
import { showAppToast } from '../lib/appToast'
import { isServerFileTrack, playlistItemsToTracks, playlistSongIds } from '../lib/playlistItems'
import { playlistJsonPayload, playlistM3uContent } from '../lib/playlistExport'

// Staff-only (it pulls in the chat store) - fetched when opened.
const SharePlaylistModal = lazyOverlay(() => import('./chat/SharePlaylistModal'))

// Self-contained context menu for an API playlist - usable from anywhere
// (the sidebar's playlist list, the Playlists grid, etc.) without needing
// PlaylistsView mounted, since it talks to userApi/the store directly. Mirrors
// the action set in PlaylistsView's open-playlist "⋯" menu.

export interface PlaylistContextMenuState {
  playlist: PlaylistSummary
  x: number
  y: number
}

export default function PlaylistContextMenu({ state, onClose }: {
  state: PlaylistContextMenuState
  onClose: () => void
}): JSX.Element {
  const { playlists, account, playCollection, addToQueue, refreshPlaylists, setPendingPlaylistId, setActiveView } = useStore(
    useShallow(s => ({
      playlists: s.playlists, account: s.account, playCollection: s.playCollection, addToQueue: s.addToQueue,
      refreshPlaylists: s.refreshPlaylists, setPendingPlaylistId: s.setPendingPlaylistId,
      setActiveView: s.setActiveView,
    }))
  )

  const [playlist, setPlaylist] = useState(state.playlist)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState(state.playlist.name)
  const [zipState, setZipState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [shareCopied, setShareCopied] = useState(false)
  const [shareToChatOpen, setShareToChatOpen] = useState(false)
  const canShareToChat = hasChatAccess(account)

  const otherPlaylists = playlists.filter(p => p.id !== playlist.id)

  if (shareToChatOpen) {
    return <SharePlaylistModal playlist={playlist} onClose={onClose} />
  }

  const open = (): void => { setPendingPlaylistId(playlist.id); setActiveView('playlists') }

  const playAll = async (): Promise<void> => {
    const d = await userApi.getPlaylist(playlist.id)
    const tracks = playlistItemsToTracks(d.items).filter(t => t.path)
    if (tracks.length) playCollection(tracks)
  }

  const queueAll = async (): Promise<void> => {
    const d = await userApi.getPlaylist(playlist.id)
    playlistItemsToTracks(d.items).filter(t => t.path).forEach(t => addToQueue(t))
  }

  // Backend ZIP jobs are disabled (see ZIP_OPERATIONS_ENABLED) - the ZIP is
  // built client-side instead (lib/clientZip). The save dialog opens before
  // the playlist fetch, while the click's user activation is still live.
  const downloadZip = async (): Promise<void> => {
    if (zipState === 'loading') return
    const target = await openZipTarget(playlist.name)
    if (!target) return
    setZipState('loading')
    try {
      const d = await userApi.getPlaylist(playlist.id)
      const tracks = playlistItemsToTracks(d.items).filter(isServerFileTrack)
      if (!tracks.length) { setZipState('error'); setTimeout(() => setZipState('idle'), 2500); return }
      // A session not yet looked up has no file of its own until it is.
      const items = (await Promise.all(tracks.map(t =>
        resolveTrackFile(t).then(f => ({ name: f.path.split('/').pop() || t.title, url: f.url, songId: userApi.trackIdToSongId(t.id) }), () => null))))
        .filter(<T,>(f: T | null): f is T => f != null)
      const { saved, cancelled } = await saveItems(target, items)
      if (cancelled) { setZipState('idle'); return }
      setZipState(saved > 0 ? 'done' : 'error')
    } catch { setZipState('error') }
    setTimeout(() => setZipState('idle'), 2500)
  }

  const downloadBlob = (content: string, mime: string, filename: string): void => {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  const exportJson = async (): Promise<void> => {
    const d = await userApi.getPlaylist(playlist.id)
    downloadBlob(JSON.stringify(playlistJsonPayload(d), null, 2), 'application/json', `${playlist.name}.json`)
  }

  const exportM3u = async (): Promise<void> => {
    const d = await userApi.getPlaylist(playlist.id)
    downloadBlob(playlistM3uContent(playlistItemsToTracks(d.items).filter(isServerFileTrack)), 'audio/x-mpegurl', `${playlist.name}.m3u`)
  }

  const copyShare = async (): Promise<void> => {
    if (!playlist.is_public && playlist.can_be_public === false) { showAppToast(PRIVATE_PLAYLIST_REASON); return }
    if (!playlist.is_public) {
      if (!window.confirm('This playlist is private. Copying a share link will make it public so anyone with the link can open it. Continue?')) return
    }
    try {
      if (!playlist.is_public) {
        await userApi.updatePlaylist(playlist.id, { is_public: true })
        setPlaylist(p => ({ ...p, is_public: true }))
        await refreshPlaylists()
      }
      await navigator.clipboard.writeText(`${shareOrigin()}/playlists?id=${playlist.id}&view=shared`)
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2000)
    } catch { showAppToast("Couldn't share the playlist") }
  }

  const shareToChat = async (): Promise<void> => {
    if (!playlist.is_public && playlist.can_be_public === false) { showAppToast(PRIVATE_PLAYLIST_REASON); return }
    if (!playlist.is_public) {
      if (!window.confirm('This playlist is private. Sharing it to chat will make it public so recipients can open it. Continue?')) return
      try {
        await userApi.updatePlaylist(playlist.id, { is_public: true })
        setPlaylist(p => ({ ...p, is_public: true }))
        await refreshPlaylists()
      } catch { return }
    }
    setShareToChatOpen(true)
  }

  // Optimistic: the label flips now and flips back (with a toast) on failure.
  const togglePublic = async (): Promise<void> => {
    const next = !playlist.is_public
    setPlaylist(p => ({ ...p, is_public: next }))
    const actual = await setPlaylistPublic(playlist.id, next)
    if (actual !== next) setPlaylist(p => ({ ...p, is_public: actual }))
  }

  const addAllTo = (targetId: number): Promise<void> => addPlaylistInBackground(playlist.id, targetId)

  const commitRename = async (): Promise<void> => {
    const val = renameVal.trim() || playlist.name
    await userApi.renamePlaylist(playlist.id, val)
    await refreshPlaylists()
    onClose()
  }

  const del = async (): Promise<void> => {
    await userApi.deletePlaylist(playlist.id)
    await refreshPlaylists()
  }

  const renameBody = (
    <div className="px-3 py-2 flex gap-2">
      <input
        autoFocus
        value={renameVal}
        onChange={e => setRenameVal(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') commitRename()
          else if (e.key === 'Escape') { e.stopPropagation(); setRenaming(false) }
        }}
        className="flex-1 min-w-0 bg-surface-overlay rounded-lg px-2.5 py-1.5 text-sm text-text-primary focus:outline-none border border-[var(--border)]"
      />
      <button onClick={commitRename} className="px-2.5 py-1.5 rounded-lg bg-accent text-white text-xs font-medium">Save</button>
    </div>
  )

  return (
    <ContextMenu
      x={state.x}
      y={state.y}
      onClose={onClose}
      zIndex={61}
      className="w-[210px]"
      body={renaming ? renameBody : undefined}
      items={[
        { icon: Play, label: 'Open', onSelect: open },
        { icon: Shuffle, label: 'Play all', onSelect: playAll },
        { icon: ListEnd, label: 'Add all to queue', onSelect: queueAll },
        {
          icon: Archive,
          label: zipState === 'error' ? 'Download failed' : zipState === 'done' ? 'Download started' : 'Download all',
          loading: zipState === 'loading',
          disabled: zipState === 'loading',
          keepOpen: true,
          onSelect: downloadZip,
        },
        {
          icon: Download,
          label: 'Export playlist',
          children: [
            { label: 'As JSON', onSelect: exportJson },
            { label: 'As M3U', onSelect: exportM3u },
          ],
        },
        'divider',
        canShareToChat && { icon: Share2, label: 'Share to chat', keepOpen: true, onSelect: () => void shareToChat() },
        { icon: shareCopied ? Check : Link, label: shareCopied ? 'Link copied!' : 'Copy share link', keepOpen: true, onSelect: copyShare },
        { icon: playlist.is_public ? Globe : Lock, label: playlist.is_public ? 'Make private' : 'Make public', keepOpen: true, onSelect: togglePublic },
        'divider',
        { icon: Pencil, label: 'Rename', keepOpen: true, onSelect: () => { setRenameVal(playlist.name); setRenaming(true) } },
        otherPlaylists.length > 0 && {
          icon: FolderInput,
          label: 'Add all to playlist',
          children: otherPlaylists.map(p => ({ label: p.name, onSelect: () => addAllTo(p.id) })),
        },
        'divider',
        { icon: Trash2, label: 'Delete playlist', danger: true, onSelect: del },
      ]}
    />
  )
}
