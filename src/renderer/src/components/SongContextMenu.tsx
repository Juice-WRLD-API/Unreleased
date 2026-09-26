import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Info, ListPlus, ListEnd, Plus, Folder, Pencil, Download, HardDrive, PackageOpen,
  ChevronDown, ChevronRight, Check, Loader2, CheckSquare2, Heart, Trash2, ListMusic, CircleArrowDown, Flag, FileAudio2,
  Clipboard, ClipboardCopy, Copy, FolderInput, FileCog,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { useShallow } from 'zustand/react/shallow'
import * as userApi from '../lib/userApi'
import { buildStreamUrl, findSessionZips, songToTrack, JWApiSong, JWApiFileEntry } from '../lib/juicewrldApi'
import { Track } from '../types'
import ChangeVersionMenuItem from './ChangeVersionMenuItem'
import { placeFlyout } from '../lib/menuFlyout'
import { versionsEnabled } from '../lib/versionsApi'
import { downloadFileSmart } from '../lib/cdn'

// The one context menu used everywhere a song can be right-clicked (Tracker,
// Liked Songs, Playlists, the bottom Player bar, WRLD). Built around `Track`
// + `songId` (the common denominator across those five places — some only
// have a Track, not a full JWApiSong) so it works without every caller
// re-fetching a full song object first. Common actions (Song info's caller
// hook aside, playlists, download, add-to-library, edit navigation, change
// version) are handled internally; only genuinely view-specific actions
// (Play/Play next/Add to queue, Select, Unlike/Remove, Like) are passed in.

export interface SongContextMenuState {
  track: Track
  /** null for local files with no backing API song record. */
  songId: number | null
  x: number
  y: number
}

interface Props {
  state: SongContextMenuState
  onClose: () => void
  canEdit: boolean
  /** Caller owns the info-modal state (it must survive this menu closing/
   *  unmounting), so this just signals "open info for this song". */
  onInfo: () => void

  onPlay?: () => void
  onPlayNext?: () => void
  onAddToQueue?: () => void
  onShowInFiles?: () => void
  /** Tracker / Library — enters multi-select mode with this song selected. */
  onSelect?: () => void
  /** Player only — metadata edit for a local (non-API) file. */
  onEditLocalMetadata?: () => void

  /** WRLD's simple like toggle. */
  liked?: boolean
  onToggleLike?: () => void

  /** Destructive, always-last action — "Unlike" (Liked Songs) or "Remove
   *  from playlist" (Playlists). */
  removeAction?: { label: string; onClick: () => void }

  /** Full song object, if the caller already has one — unlocks the
   *  recording-session ZIP download (needs fields Track doesn't carry). */
  song?: JWApiSong

  /** Hides "Change version" even when songId is valid — for playback
   *  contexts where switching doesn't make sense (e.g. WRLD's FM radio,
   *  which is server-driven and can't be manually redirected). */
  disableChangeVersion?: boolean
}

function MenuItem({ icon, label, onClick, destructive, trailing, innerRef }: {
  icon: React.ReactNode; label: string; onClick: () => void; destructive?: boolean
  /** Right-aligned adornment — the submenu chevron. */
  trailing?: React.ReactNode
  innerRef?: React.Ref<HTMLButtonElement>
}): JSX.Element {
  return (
    <button
      ref={innerRef}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors hover:bg-surface-raised ${
        destructive ? 'text-red-400' : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      {icon}
      {label}
      {trailing && <span className="ml-auto flex items-center">{trailing}</span>}
    </button>
  )
}

function Divider(): JSX.Element {
  return <div className="my-1 border-t border-[var(--border)]" />
}


function downloadTrack(track: Track): void {
  // P2P CDN first (if any node has the file), falling back to the normal
  // stream URL the instant no node answers - see lib/cdn's downloadFileSmart.
  void downloadFileSmart(track.path, `${track.title}.mp3`, buildStreamUrl(track.path))
}

function downloadZipEntry(entry: JWApiFileEntry): void {
  const a = document.createElement('a')
  a.href = buildStreamUrl(entry.path)
  a.download = entry.name
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

export default function SongContextMenu({
  state, onClose, canEdit, onInfo,
  onPlay, onPlayNext, onAddToQueue, onShowInFiles, onSelect, onEditLocalMetadata,
  liked, onToggleLike, removeAction, song, disableChangeVersion,
}: Props): JSX.Element {
  const { playlists, account, refreshPlaylists, setShowUserAuth, playTrack, localPlaylists, addToLocalPlaylist, createLocalPlaylist, offlineTracks, removeOfflineTrack, downloadTrackOffline, autoDownloadIfOffline, addLibraryTrack } = useStore(
    useShallow(s => ({
      playlists: s.playlists, account: s.account, refreshPlaylists: s.refreshPlaylists,
      setShowUserAuth: s.setShowUserAuth, playTrack: s.playTrack,
      localPlaylists: s.localPlaylists, addToLocalPlaylist: s.addToLocalPlaylist, createLocalPlaylist: s.createLocalPlaylist,
      offlineTracks: s.offlineTracks, removeOfflineTrack: s.removeOfflineTrack, downloadTrackOffline: s.downloadTrackOffline,
      autoDownloadIfOffline: s.autoDownloadIfOffline, addLibraryTrack: s.addLibraryTrack,
    }))
  )
  const { track, songId } = state
  const menuRef = useRef<HTMLDivElement>(null)
  const [panel, setPanel] = useState<'main' | 'zip'>('main')
  // "Add to playlist" opens a flyout beside the menu rather than replacing it.
  const [playlistsOpen, setPlaylistsOpen] = useState(false)
  const addItemRef = useRef<HTMLButtonElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const [subPos, setSubPos] = useState({ top: 0, left: 0 })
  // "File actions" works the same way — its own flyout beside the menu.
  const [fileOpen, setFileOpen] = useState(false)
  const fileItemRef = useRef<HTMLButtonElement>(null)
  const fileSubmenuRef = useRef<HTMLDivElement>(null)
  const [fileSubPos, setFileSubPos] = useState({ top: 0, left: 0 })
  // "Change version" is a flyout too, but ChangeVersionMenuItem owns its own
  // placement (it has to re-place itself when its list finishes loading) — the
  // open state stays here so all three submenus remain mutually exclusive.
  const [versionsOpen, setVersionsOpen] = useState(false)
  const versionItemRef = useRef<HTMLButtonElement>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [doneId, setDoneId] = useState<number | null>(null)
  const [localDoneId, setLocalDoneId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [addingToLib, setAddingToLib] = useState(false)
  const [addedToLib, setAddedToLib] = useState(false)
  const [contained, setContained] = useState<Set<number>>(new Set())
  const [zipLoading, setZipLoading] = useState(false)
  const [zipCandidates, setZipCandidates] = useState<JWApiFileEntry[] | null>(null)
  const [downloadingOffline, setDownloadingOffline] = useState(false)
  const el = (window as any).electron

  useEffect(() => {
    const handle = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  useEffect(() => {
    if (!account || songId == null || playlists.length === 0) return
    Promise.all(
      playlists.map(p =>
        userApi.getPlaylist(p.id)
          .then(d => ({ id: p.id, has: (d.items ?? []).some(it => it.song.id === songId) }))
          .catch(() => ({ id: p.id, has: false }))
      )
    ).then(results => setContained(new Set(results.filter(r => r.has).map(r => r.id))))
  }, [playlists, songId, account])

  const addTo = async (id: number): Promise<void> => {
    if (songId == null) return
    setBusyId(id)
    try {
      await userApi.addToPlaylist(id, songId)
      setDoneId(id)
      setContained(prev => new Set([...prev, id]))
      await refreshPlaylists()
      autoDownloadIfOffline(id, [songId])
    } catch {} finally { setBusyId(null) }
  }

  const createAndAdd = async (): Promise<void> => {
    const name = newName.trim()
    if (!name) return
    if (isLocalOnly) {
      createLocalPlaylist(name)
      // createLocalPlaylist sets activeLocalPlaylistId synchronously (zustand
      // set() applies immediately), so it's readable right after the call —
      // that's the newly-created playlist's id, needed to add this track to it.
      const newId = useStore.getState().activeLocalPlaylistId
      if (newId) addToLocalPlaylist(newId, track.id)
      onClose()
      return
    }
    if (songId == null) return
    setBusyId(-1)
    try {
      const playlist = await userApi.createPlaylist(name)
      await userApi.addToPlaylist(playlist.id, songId)
      await refreshPlaylists()
      onClose()
    } catch {} finally { setBusyId(null) }
  }

  const loadSessionZips = async (): Promise<void> => {
    if (zipLoading || !song) return
    setZipLoading(true)
    try {
      const candidates = await findSessionZips(song)
      if (candidates.length === 1) {
        downloadZipEntry(candidates[0])
        onClose()
      } else {
        setZipCandidates(candidates)
        setPanel('zip')
      }
    } catch {
      setZipCandidates([])
      setPanel('zip')
    } finally {
      setZipLoading(false)
    }
  }

  // A couple of callers use a -1 sentinel for "no real song" instead of null
  // (e.g. shared-playlist placeholder rows) — treat both as invalid.
  const hasValidSong = songId != null && songId > 0
  const isUnplayable = ['recording_session', 'unsurfaced'].includes(track.genre)
  // A local library file with no matching API song — it already lives on
  // disk (so "Download" is meaningless) and can't join a server playlist,
  // but it can join one of the device-local playlists instead.
  const isLocalOnly = songId == null && track.id.startsWith('local-')
  const canAddToPlaylist = !isUnplayable && (hasValidSong || isLocalOnly)
  // Sessions/unsurfaced are treated as unplayable — don't offer Play / Play
  // next / Add to queue for them (they'd never actually play). Local files
  // (no category in genre) stay playable as long as they have a path.
  const canQueue = !!track.path && !isUnplayable

  // Estimated clamp for the very first paint; corrected against the real
  // rendered size in the layout effect below. The estimate alone isn't enough
  // because the menu's height varies a lot (which optional items a caller
  // enables, long titles), so near a screen edge the guess undershoots and the
  // menu spills off-screen. Measuring the actual box fixes every case. The
  // submenus don't factor in — they're flyouts positioned separately.
  const menuWidth = 208
  const menuHeight = panel !== 'main' ? 320 : 240
  const [pos, setPos] = useState(() => ({
    top: Math.max(8, Math.min(state.y, window.innerHeight - menuHeight - 8)),
    left: Math.max(8, Math.min(state.x, window.innerWidth - menuWidth - 8)),
  }))

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const top = Math.max(8, Math.min(state.y, window.innerHeight - rect.height - 8))
    const left = Math.max(8, Math.min(state.x, window.innerWidth - rect.width - 8))
    setPos(prev => (prev.top === top && prev.left === left ? prev : { top, left }))
  }, [state.x, state.y, panel, zipCandidates])

  // Flyout placement: to the right of the menu, flipped to the left when
  // there isn't room, top-aligned with the item that opened it and clamped
  // to the viewport (the list can be much taller than the item).
  useLayoutEffect(() => {
    if (!playlistsOpen) return
    const item = addItemRef.current, menu = menuRef.current, sub = submenuRef.current
    if (!item || !menu || !sub) return
    const { top, left } = placeFlyout(item, menu, sub)
    setSubPos(prev => (prev.top === top && prev.left === left ? prev : { top, left }))
  }, [playlistsOpen, creating, pos, playlists.length, localPlaylists.length, contained])

  useLayoutEffect(() => {
    if (!fileOpen) return
    const item = fileItemRef.current, menu = menuRef.current, sub = fileSubmenuRef.current
    if (!item || !menu || !sub) return
    const { top, left } = placeFlyout(item, menu, sub)
    setFileSubPos(prev => (prev.top === top && prev.left === left ? prev : { top, left }))
  }, [fileOpen, pos])

  return (
    <div
      ref={menuRef}
      // Height-capped to the viewport: a fully-loaded menu (queue actions +
      // playlist/version/file rows + Download/Remove) is taller than a short
      // phone screen, and the position clamp alone would leave the bottom
      // items clipped and unreachable — scroll instead.
      style={{ position: 'fixed', zIndex: 9999, top: pos.top, left: pos.left, maxHeight: window.innerHeight - 16 }}
      className="w-52 bg-surface border border-[var(--border)] rounded-xl shadow-2xl overflow-x-hidden overflow-y-auto py-1"
    >
      <div className="px-3 py-2 border-b border-[var(--border)] mb-1">
        <p className="text-text-primary text-xs font-semibold truncate">{track.title}</p>
        <p className="text-text-muted text-[10px] truncate">{track.artist}</p>
      </div>

      {playlistsOpen && panel === 'main' && (
        // Rendered inside the menu element (so the outside-click handler still
        // counts it as "inside") but positioned as a fixed flyout beside it.
        <div
          ref={submenuRef}
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', zIndex: 10000, top: subPos.top, left: subPos.left }}
          className="w-52 bg-surface border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden py-1"
        >
          {isLocalOnly ? (
            <div className="max-h-44 overflow-y-auto">
              {localPlaylists.length === 0 && (
                <p className="px-3 py-2 text-xs text-text-muted">No playlists yet.</p>
              )}
              {localPlaylists.map((p) => {
                const alreadyIn = p.trackIds.includes(track.id)
                return (
                  <button
                    key={p.id}
                    onClick={(e) => { e.stopPropagation(); addToLocalPlaylist(p.id, track.id); setLocalDoneId(p.id) }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
                  >
                    <ListMusic size={13} className={`shrink-0 ${alreadyIn ? 'text-accent' : 'text-text-muted'}`} />
                    <span className="flex-1 truncate text-xs" title={p.name}>{p.name}</span>
                    {(localDoneId === p.id || alreadyIn) && <Check size={12} className="text-accent shrink-0" />}
                  </button>
                )
              })}
            </div>
          ) : !account ? (
            <div className="px-3 pb-2">
              <p className="text-xs text-text-muted mb-2">Log in to save to playlists.</p>
              <button
                onClick={() => { setShowUserAuth(true); onClose() }}
                className="w-full py-1.5 rounded-lg bg-accent/15 text-accent text-xs font-semibold"
              >
                Log in
              </button>
            </div>
          ) : (
            <div className="max-h-44 overflow-y-auto">
              {playlists.length === 0 && (
                <p className="px-3 py-2 text-xs text-text-muted">No playlists yet.</p>
              )}
              {playlists.map((p) => {
                const alreadyIn = contained.has(p.id)
                return (
                  <button
                    key={p.id}
                    onClick={(e) => { e.stopPropagation(); addTo(p.id) }}
                    disabled={busyId === p.id}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
                  >
                    <ListMusic size={13} className={`shrink-0 ${alreadyIn ? 'text-accent' : 'text-text-muted'}`} />
                    <span className="flex-1 truncate text-xs" title={p.name}>{p.name}</span>
                    {busyId === p.id
                      ? <Loader2 size={12} className="animate-spin" />
                      : (doneId === p.id || alreadyIn)
                        ? <Check size={12} className="text-accent shrink-0" />
                        : null}
                  </button>
                )
              })}
            </div>
          )}
          {(isLocalOnly || account) && (
            <div className="border-t border-[var(--border)] pt-1 px-2 pb-1">
              {creating ? (
                <div className="flex gap-1">
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createAndAdd()}
                    placeholder="Playlist name"
                    autoFocus
                    className="flex-1 min-w-0 bg-surface-overlay border border-[var(--border)] rounded px-2 py-1 text-xs text-text-primary focus:outline-none"
                  />
                  <button onClick={createAndAdd} disabled={busyId === -1} className="p-1.5 rounded bg-accent/15 text-accent">
                    {busyId === -1 ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setCreating(true)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-accent hover:bg-surface-raised rounded transition-colors"
                >
                  <Plus size={12} /> New playlist
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {fileOpen && panel === 'main' && (
        // Same flyout treatment as the playlists submenu above: inside the menu
        // element so the outside-click handler still counts it as "inside".
        <div
          ref={fileSubmenuRef}
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', zIndex: 10000, top: fileSubPos.top, left: fileSubPos.left }}
          className="w-52 bg-surface border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden py-1"
        >
          {/* Actions on the local file itself. Copy/move prompt for a
              destination in the main process; delete goes to the OS trash. */}
          <MenuItem icon={<FileAudio2 size={14} />} label="Convert format" onClick={() => { useStore.getState().openConvert(track); onClose() }} />
          <MenuItem icon={<ClipboardCopy size={14} />} label="Copy file" onClick={() => { el.copyFileToClipboard(track.path); onClose() }} />
          <MenuItem icon={<Clipboard size={14} />} label="Copy path" onClick={() => { el.copyTextToClipboard(track.path); onClose() }} />
          <MenuItem icon={<Copy size={14} />} label="Copy to folder…" onClick={() => { el.copyLibraryFile(track.path); onClose() }} />
          <MenuItem icon={<FolderInput size={14} />} label="Move to folder…" onClick={() => { useStore.getState().moveLibraryTrack(track.id); onClose() }} />
          <Divider />
          {/* Deletes the user's actual file (to the OS trash) rather than just
              un-listing it — confirmed in main before anything moves. */}
          <MenuItem
            icon={<Trash2 size={14} />}
            label="Delete from disk"
            destructive
            onClick={() => { useStore.getState().deleteLibraryTrack(track.id); onClose() }}
          />
        </div>
      )}

      {panel === 'zip' ? (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); setPanel('main') }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            <ChevronDown size={12} className="rotate-90" /> Back
          </button>
          {zipCandidates && zipCandidates.length > 0 ? (
            <div className="max-h-44 overflow-y-auto">
              <p className="px-3 pb-1 text-[10px] text-text-muted">Multiple matches found — pick one:</p>
              {zipCandidates.map(c => (
                <button
                  key={c.path}
                  onClick={(e) => { e.stopPropagation(); downloadZipEntry(c); onClose() }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
                >
                  <PackageOpen size={13} className="shrink-0 text-text-muted" />
                  <span className="flex-1 truncate text-xs">{c.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="px-3 py-3 text-xs text-text-muted">No matching ZIP found for this session.</p>
          )}
        </>
      ) : (
        // Hovering a submenu row opens its flyout; hovering any other row
        // closes it again, the way a native submenu behaves. Driving both from
        // one handler also makes them mutually exclusive.
        <div
          onMouseOver={(e) => {
            const t = e.target as Node
            setPlaylistsOpen(addItemRef.current?.contains(t) ?? false)
            setFileOpen(fileItemRef.current?.contains(t) ?? false)
            setVersionsOpen(versionItemRef.current?.contains(t) ?? false)
          }}
        >
          {onPlay && canQueue && <MenuItem icon={<ListEnd size={14} />} label="Play" onClick={() => { onPlay(); onClose() }} />}
          {onPlayNext && canQueue && <MenuItem icon={<ListEnd size={14} />} label="Play next" onClick={() => { onPlayNext(); onClose() }} />}
          {hasValidSong && (
            <MenuItem icon={<Info size={14} />} label="Song info" onClick={() => { onInfo(); onClose() }} />
          )}
          {hasValidSong && (
            <MenuItem
              icon={<Flag size={14} />}
              label="Report issue"
              onClick={() => { useStore.getState().openReport({ kind: 'song', songId: songId as number, songName: track.apiTitle || track.title }); onClose() }}
            />
          )}
          {onSelect && <MenuItem icon={<CheckSquare2 size={14} />} label="Select" onClick={() => { onSelect(); onClose() }} />}
          {onAddToQueue && canQueue && (
            <MenuItem icon={<ListPlus size={14} />} label="Add to queue" onClick={() => { onAddToQueue(); onClose() }} />
          )}
          {canAddToPlaylist && (
            <MenuItem
              innerRef={addItemRef}
              icon={<Plus size={14} />}
              label="Add to playlist"
              trailing={<ChevronRight size={13} className="text-text-muted" />}
              onClick={() => setPlaylistsOpen(o => !o)}
            />
          )}
          {onShowInFiles && track.path && (
            <MenuItem icon={<Folder size={14} />} label="Show in Files" onClick={() => { onShowInFiles(); onClose() }} />
          )}
          {canEdit && songId != null && songId > 0 && (
            <MenuItem icon={<Pencil size={14} />} label="Edit" onClick={() => { useStore.getState().openSongEditor(songId); onClose() }} />
          )}
          {onEditLocalMetadata && (
            <MenuItem icon={<Pencil size={14} />} label="Edit metadata" onClick={() => { onEditLocalMetadata(); onClose() }} />
          )}
          {/* Everything that touches the user's actual file lives in its own
              flyout, so the destructive entries aren't one stray click away. */}
          {isLocalOnly && !!track.path && el && (
            <MenuItem
              innerRef={fileItemRef}
              icon={<FileCog size={14} />}
              label="File actions"
              trailing={<ChevronRight size={13} className="text-text-muted" />}
              onClick={() => setFileOpen(o => !o)}
            />
          )}
          {onToggleLike && (
            <MenuItem
              icon={<Heart size={14} fill={liked ? 'currentColor' : 'none'} className={liked ? 'text-accent' : ''} />}
              label={liked ? 'Unlike' : 'Like'}
              onClick={() => { onToggleLike(); onClose() }}
            />
          )}
          {versionsEnabled && !disableChangeVersion && songId != null && songId > 0 && (
            <ChangeVersionMenuItem
              songId={songId}
              onChangeVersion={(s) => { const t = songToTrack(s); playTrack(t, [t]); onClose() }}
              open={versionsOpen && panel === 'main'}
              onToggle={() => setVersionsOpen(o => !o)}
              itemRef={versionItemRef}
              menuRef={menuRef}
              menuPos={pos}
            />
          )}
          {song && !track.path && track.genre === 'recording_session' && (
            <>
              <Divider />
              <MenuItem
                icon={zipLoading ? <Loader2 size={14} className="animate-spin" /> : <PackageOpen size={14} />}
                label={zipLoading ? 'Finding files…' : 'Download session (ZIP)'}
                onClick={loadSessionZips}
              />
            </>
          )}
          {track.path && !isLocalOnly && (
            <>
              <Divider />
              <MenuItem icon={<Download size={14} />} label="Download" onClick={() => { downloadTrack(track); onClose() }} />
              {el && hasValidSong && (
                <MenuItem
                  icon={addingToLib ? <Loader2 size={14} className="animate-spin" /> : addedToLib ? <Check size={14} className="text-accent" /> : <HardDrive size={14} />}
                  label={addedToLib ? 'Added to library' : addingToLib ? 'Adding...' : 'Add to library'}
                  onClick={async () => {
                    if (addingToLib || addedToLib) return
                    setAddingToLib(true)
                    try {
                      const url = 'https://juicewrldapi.com/juicewrld/files/download/?path=' + encodeURIComponent(track.path)
                      const result = await el.downloadToLibrary({
                        url, songName: track.title, artist: track.artist, songPath: track.path,
                      })
                      if (!result.error) {
                        if (result.track) addLibraryTrack(result.track)
                        setAddedToLib(true)
                      }
                    } finally { setAddingToLib(false) }
                  }}
                />
              )}
              {el && hasValidSong && !offlineTracks[track.id] && (
                <MenuItem
                  icon={downloadingOffline ? <Loader2 size={14} className="animate-spin" /> : <CircleArrowDown size={14} />}
                  label={downloadingOffline ? 'Downloading…' : 'Download offline'}
                  onClick={async () => {
                    if (downloadingOffline || songId == null) return
                    setDownloadingOffline(true)
                    try { await downloadTrackOffline(songId) } finally { setDownloadingOffline(false) }
                  }}
                />
              )}
              {!!offlineTracks[track.id] && (
                <MenuItem
                  icon={<CircleArrowDown size={14} fill="currentColor" />}
                  label="Remove download"
                  destructive
                  onClick={() => { removeOfflineTrack(track.id); onClose() }}
                />
              )}
            </>
          )}
          {removeAction && (
            <>
              <Divider />
              <MenuItem icon={<Trash2 size={14} />} label={removeAction.label} destructive onClick={() => { removeAction.onClick(); onClose() }} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
