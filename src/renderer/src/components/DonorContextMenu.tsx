import { useState } from 'react'
import {
  Copy, Download, Link2, Link2Off, ListEnd, ListPlus, ListStart, Pencil, Play, Plus, Tag, Trash2, X,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { donorFileToTrack } from '../lib/donorPlayback'
import type { DonorFile } from '../lib/donorFilesApi'
import ContextMenu from './ContextMenu'

export interface DonorMenuState { file: DonorFile; x: number; y: number }

// Right-click menu for a donor file (My files, Settings, donor playlists).
// Separate from SongContextMenu: that one is built around API song ids and
// synced playlists, neither of which a donor file has. Queue and donor-playlist
// actions live here; file actions (rename, share, delete...) come from the
// caller, and any it leaves out simply don't show.
export default function DonorContextMenu({ state, onClose, onPlay, onDownload, onRename, onEditTags, onToggleShare, onCopyLink, onDelete, removeAction }: {
  state: DonorMenuState
  onClose: () => void
  onPlay?: () => void
  onDownload?: () => void
  onRename?: () => void
  onEditTags?: () => void
  onToggleShare?: () => void
  onCopyLink?: () => void
  onDelete?: () => void
  /** e.g. "Remove from playlist" inside a donor playlist. */
  removeAction?: { label: string; onClick: () => void }
}): JSX.Element {
  const { file } = state
  const playNext = useStore((s) => s.playNext)
  const addToQueue = useStore((s) => s.addToQueue)
  const donorPlaylists = useStore((s) => s.donorPlaylists)
  const addToDonorPlaylist = useStore((s) => s.addToDonorPlaylist)
  const removeFromDonorPlaylist = useStore((s) => s.removeFromDonorPlaylist)
  const createDonorPlaylist = useStore((s) => s.createDonorPlaylist)
  const [newName, setNewName] = useState('')
  const isAudio = !!onPlay

  const createWithFile = (): void => {
    if (!newName.trim()) return
    createDonorPlaylist(newName.trim(), [file.file_id])
    onClose()
  }

  return (
    <ContextMenu
      x={state.x}
      y={state.y}
      title={file.filename}
      onClose={onClose}
      items={[
        isAudio && { icon: Play, label: 'Play', onSelect: onPlay },
        isAudio && { icon: ListStart, label: 'Play next', onSelect: () => playNext(donorFileToTrack(file)) },
        isAudio && { icon: ListEnd, label: 'Add to queue', onSelect: () => addToQueue(donorFileToTrack(file)) },
        isAudio && {
          icon: ListPlus,
          label: 'Add to donor playlist',
          childrenEmpty: 'No donor playlists yet.',
          children: donorPlaylists.map((p) => {
            const inList = p.fileIds.includes(file.file_id)
            return {
              label: p.name,
              checked: inList,
              keepOpen: true,
              onSelect: () => (inList ? removeFromDonorPlaylist(p.id, file.file_id) : addToDonorPlaylist(p.id, file.file_id)),
            }
          }),
          childrenFooter: (
            <div className="flex items-center gap-1">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') createWithFile() }}
                placeholder="New playlist…"
                className="flex-1 min-w-0 bg-surface-overlay rounded-md px-2 py-1 text-xs text-text-primary focus:outline-none"
              />
              <button onClick={createWithFile} disabled={!newName.trim()} className="p-1 rounded text-accent disabled:opacity-40" title="Create"><Plus size={14} /></button>
            </div>
          ),
        },
        isAudio && 'divider',
        onDownload && { icon: Download, label: 'Download', onSelect: onDownload },
        onRename && { icon: Pencil, label: 'Rename', onSelect: onRename },
        onEditTags && { icon: Tag, label: 'Edit tags', onSelect: onEditTags },
        onToggleShare && {
          icon: file.is_shared ? Link2Off : Link2,
          label: file.is_shared ? 'Stop sharing' : 'Create share link',
          onSelect: onToggleShare,
        },
        !!(onCopyLink && file.is_shared && file.share_url) && { icon: Copy, label: 'Copy share link', onSelect: onCopyLink },
        (removeAction || onDelete) && 'divider',
        removeAction && { icon: X, label: removeAction.label, onSelect: removeAction.onClick },
        onDelete && { icon: Trash2, label: 'Delete file', danger: true, onSelect: onDelete },
      ]}
    />
  )
}
