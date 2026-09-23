import { useEffect, useRef, useState } from 'react'
import {
  Check, ChevronRight, Copy, Download, Link2, Link2Off, ListEnd, ListPlus, ListStart, Pencil, Play, Plus, Tag, Trash2, X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useStore } from '../store/useStore'
import { donorFileToTrack } from '../lib/donorPlayback'
import type { DonorFile } from '../lib/donorFilesApi'
import { ClampedMenu } from './ClampedMenu'

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
  const [playlistsOpen, setPlaylistsOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const isAudio = !!onPlay

  useEffect(() => {
    const onDown = (e: MouseEvent): void => { if (!menuRef.current?.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    const onScroll = (): void => onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose])

  const run = (fn?: () => void) => (): void => { onClose(); fn?.() }
  const createWithFile = (): void => {
    if (!newName.trim()) return
    createDonorPlaylist(newName.trim(), [file.file_id])
    onClose()
  }

  return (
    <ClampedMenu ref={menuRef} x={state.x} y={state.y} className="min-w-[200px] max-w-[260px]" onContextMenu={(e) => e.preventDefault()}>
      <p className="px-3 pt-1.5 pb-1 text-[11px] text-text-muted truncate" title={file.filename}>{file.filename}</p>
      {isAudio && (
        <>
          <Item icon={Play} label="Play" onClick={run(onPlay)} />
          <Item icon={ListStart} label="Play next" onClick={run(() => playNext(donorFileToTrack(file)))} />
          <Item icon={ListEnd} label="Add to queue" onClick={run(() => addToQueue(donorFileToTrack(file)))} />
          <Item icon={ListPlus} label="Add to donor playlist" trailing={<ChevronRight size={13} className={`transition-transform ${playlistsOpen ? 'rotate-90' : ''}`} />} onClick={() => setPlaylistsOpen((o) => !o)} />
          {playlistsOpen && (
            <div className="mx-1.5 mb-1 rounded-lg bg-surface-overlay py-1">
              {donorPlaylists.length === 0 && <p className="px-2.5 py-1 text-[11px] text-text-muted">No donor playlists yet.</p>}
              {donorPlaylists.map((p) => {
                const inList = p.fileIds.includes(file.file_id)
                return (
                  <button
                    key={p.id}
                    onClick={() => (inList ? removeFromDonorPlaylist(p.id, file.file_id) : addToDonorPlaylist(p.id, file.file_id))}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-left text-sm text-text-primary hover:bg-surface-raised"
                  >
                    <span className="truncate">{p.name}</span>
                    {inList && <Check size={13} className="text-accent shrink-0" />}
                  </button>
                )
              })}
              <div className="flex items-center gap-1 px-1.5 pt-1">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') createWithFile() }}
                  placeholder="New playlist…"
                  className="flex-1 min-w-0 bg-surface rounded px-2 py-1 text-xs text-text-primary focus:outline-none"
                />
                <button onClick={createWithFile} disabled={!newName.trim()} className="p-1 rounded text-accent disabled:opacity-40" title="Create"><Plus size={14} /></button>
              </div>
            </div>
          )}
          <Divider />
        </>
      )}
      {onDownload && <Item icon={Download} label="Download" onClick={run(onDownload)} />}
      {onRename && <Item icon={Pencil} label="Rename" onClick={run(onRename)} />}
      {onEditTags && <Item icon={Tag} label="Edit tags" onClick={run(onEditTags)} />}
      {onToggleShare && (
        <Item icon={file.is_shared ? Link2Off : Link2} label={file.is_shared ? 'Stop sharing' : 'Create share link'} onClick={run(onToggleShare)} />
      )}
      {onCopyLink && file.is_shared && file.share_url && <Item icon={Copy} label="Copy share link" onClick={run(onCopyLink)} />}
      {(removeAction || onDelete) && <Divider />}
      {removeAction && <Item icon={X} label={removeAction.label} onClick={run(removeAction.onClick)} />}
      {onDelete && <Item icon={Trash2} label="Delete file" danger onClick={run(onDelete)} />}
    </ClampedMenu>
  )
}

function Item({ icon: Icon, label, onClick, danger, trailing }: {
  icon: LucideIcon
  label: string
  onClick: () => void
  danger?: boolean
  trailing?: React.ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-overlay ${danger ? 'text-red-400' : 'text-text-primary'}`}
    >
      <Icon size={14} className={danger ? '' : 'text-text-muted'} />
      <span className="flex-1 truncate">{label}</span>
      {trailing}
    </button>
  )
}

function Divider(): JSX.Element {
  return <div className="my-1 border-t border-[var(--border)]" />
}
