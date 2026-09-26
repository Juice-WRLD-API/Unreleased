import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  const submenuItemRef = useRef<HTMLDivElement>(null)
  const flyoutRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState({ left: state.x, top: state.y })
  const [flyoutPos, setFlyoutPos] = useState({ left: 0, top: 0 })
  const isAudio = !!onPlay

  // Beside the menu, top-aligned with its row - flipped to the left side when
  // there's no room on the right, and nudged up to stay on-screen.
  useLayoutEffect(() => {
    if (!playlistsOpen) return
    const place = (): void => {
      const menu = menuRef.current?.getBoundingClientRect()
      const item = submenuItemRef.current?.getBoundingClientRect()
      const fly = flyoutRef.current?.getBoundingClientRect()
      if (!menu || !item || !fly) return
      const left = menu.right + fly.width + 4 <= window.innerWidth - 8 ? menu.right + 4 : Math.max(8, menu.left - fly.width - 4)
      const top = Math.max(8, Math.min(item.top - 4, window.innerHeight - fly.height - 8))
      setFlyoutPos((p) => (p.left === left && p.top === top ? p : { left, top }))
    }
    place()
    const ro = new ResizeObserver(place)
    if (flyoutRef.current) ro.observe(flyoutRef.current)
    return () => ro.disconnect()
  }, [playlistsOpen, menuPos, donorPlaylists.length])

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
    <ClampedMenu ref={menuRef} x={state.x} y={state.y} onPositioned={setMenuPos} className="min-w-[200px] max-w-[260px]" onContextMenu={(e) => e.preventDefault()}
      // Hovering any other row closes the flyout, like a native submenu.
      onMouseOver={(e) => {
        const t = e.target as Node
        if (playlistsOpen && !submenuItemRef.current?.contains(t) && !flyoutRef.current?.contains(t)) setPlaylistsOpen(false)
      }}
    >
      <p className="px-3 pt-1.5 pb-1 text-[11px] text-text-muted truncate" title={file.filename}>{file.filename}</p>
      {isAudio && (
        <>
          <Item icon={Play} label="Play" onClick={run(onPlay)} />
          <Item icon={ListStart} label="Play next" onClick={run(() => playNext(donorFileToTrack(file)))} />
          <Item icon={ListEnd} label="Add to queue" onClick={run(() => addToQueue(donorFileToTrack(file)))} />
          <div ref={submenuItemRef} onMouseEnter={() => setPlaylistsOpen(true)}>
            <Item
              icon={ListPlus}
              label="Add to donor playlist"
              active={playlistsOpen}
              trailing={<ChevronRight size={13} className="text-text-muted" />}
              onClick={() => setPlaylistsOpen((o) => !o)}
            />
          </div>
          {playlistsOpen && (
            // A child of the menu (so clicks in it count as "inside" for the
            // outside-click close), but fixed-positioned beside it.
            <div
              ref={flyoutRef}
              style={{ position: 'fixed', top: flyoutPos.top, left: flyoutPos.left, maxHeight: window.innerHeight - 16 }}
              className="z-[60] w-56 overflow-y-auto bg-surface border border-[var(--border)] rounded-xl shadow-2xl py-1"
            >
              {donorPlaylists.length === 0 && <p className="px-3 py-1.5 text-[11px] text-text-muted">No donor playlists yet.</p>}
              {donorPlaylists.map((p) => {
                const inList = p.fileIds.includes(file.file_id)
                return (
                  <button
                    key={p.id}
                    onClick={() => (inList ? removeFromDonorPlaylist(p.id, file.file_id) : addToDonorPlaylist(p.id, file.file_id))}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm text-text-primary hover:bg-surface-overlay"
                  >
                    <span className="truncate">{p.name}</span>
                    {inList && <Check size={13} className="text-accent shrink-0" />}
                  </button>
                )
              })}
              {donorPlaylists.length > 0 && <Divider />}
              <div className="flex items-center gap-1 px-2 py-1">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') createWithFile() }}
                  placeholder="New playlist…"
                  className="flex-1 min-w-0 bg-surface-overlay rounded-md px-2 py-1 text-xs text-text-primary focus:outline-none"
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

function Item({ icon: Icon, label, onClick, danger, trailing, active }: {
  icon: LucideIcon
  label: string
  onClick: () => void
  danger?: boolean
  trailing?: React.ReactNode
  /** Held highlighted while its submenu is open. */
  active?: boolean
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-overlay ${active ? 'bg-surface-overlay' : ''} ${danger ? 'text-red-400' : 'text-text-primary'}`}
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
