import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Play, Shuffle, ListEnd, Archive, Link, Globe, Lock, Pencil, Trash2, FolderInput, Loader2, Check, Download, ChevronRight,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { useShallow } from 'zustand/react/shallow'
import * as userApi from '../lib/userApi'
import type { PlaylistSummary } from '../lib/userApi'
import { JWAPI_BASE } from '../lib/juicewrldApi'
import { shareOrigin } from '../lib/platform'
import { placeFlyout } from '../lib/menuFlyout'
import { Track } from '../types'

// Self-contained context menu for an API playlist - usable from anywhere
// (the sidebar's playlist list, the Playlists grid, etc.) without needing
// PlaylistsView mounted, since it talks to userApi/the store directly. Mirrors
// the action set in PlaylistsView's open-playlist "⋯" menu.

function MenuItem({ icon: Icon, label, onClick, destructive = false, disabled = false, trailing, innerRef }: {
  icon: React.ElementType
  label: string
  onClick: () => void
  destructive?: boolean
  disabled?: boolean
  trailing?: React.ReactNode
  innerRef?: React.Ref<HTMLButtonElement>
}): JSX.Element {
  return (
    <button
      ref={innerRef}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      disabled={disabled}
      className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-sm transition-colors hover:bg-surface-overlay disabled:opacity-40 disabled:cursor-not-allowed ${
        destructive ? 'text-red-400 hover:text-red-300' : 'text-text-primary'
      }`}
    >
      <Icon size={14} className={destructive ? 'text-red-400' : 'text-text-muted'} />
      <span className="flex-1 text-left">{label}</span>
      {trailing}
    </button>
  )
}

export interface PlaylistContextMenuState {
  playlist: PlaylistSummary
  x: number
  y: number
}

export default function PlaylistContextMenu({ state, onClose }: {
  state: PlaylistContextMenuState
  onClose: () => void
}): JSX.Element {
  const { playlists, playCollection, addToQueue, refreshPlaylists, setPendingPlaylistId, setActiveView } = useStore(
    useShallow(s => ({
      playlists: s.playlists, playCollection: s.playCollection, addToQueue: s.addToQueue,
      refreshPlaylists: s.refreshPlaylists, setPendingPlaylistId: s.setPendingPlaylistId,
      setActiveView: s.setActiveView,
    }))
  )

  const [playlist, setPlaylist] = useState(state.playlist)
  const [showPlaylists, setShowPlaylists] = useState(false)
  const addAllItemRef = useRef<HTMLButtonElement>(null)
  const addAllSubmenuRef = useRef<HTMLDivElement>(null)
  const [addAllSubPos, setAddAllSubPos] = useState({ top: 0, left: 0 })
  const [showExport, setShowExport] = useState(false)
  const exportItemRef = useRef<HTMLButtonElement>(null)
  const exportSubmenuRef = useRef<HTMLDivElement>(null)
  const [exportSubPos, setExportSubPos] = useState({ top: 0, left: 0 })
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState(state.playlist.name)
  const [zipState, setZipState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [shareCopied, setShareCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  const otherPlaylists = playlists.filter(p => p.id !== playlist.id)

  const open = (): void => { setPendingPlaylistId(playlist.id); setActiveView('playlists'); onClose() }

  const playAll = async (): Promise<void> => {
    const d = await userApi.getPlaylist(playlist.id)
    const tracks = d.items.map(i => userApi.liteSongToTrack(i.song))
    if (tracks.length) playCollection(tracks)
    onClose()
  }

  const queueAll = async (): Promise<void> => {
    const d = await userApi.getPlaylist(playlist.id)
    d.items.forEach(i => addToQueue(userApi.liteSongToTrack(i.song)))
    onClose()
  }

  const downloadZip = async (): Promise<void> => {
    if (zipState === 'loading') return
    setZipState('loading')
    try {
      const d = await userApi.getPlaylist(playlist.id)
      const paths = d.items.map(i => userApi.liteSongToTrack(i.song)).map((t: Track) => t.path).filter(Boolean)
      if (!paths.length) { setZipState('error'); setTimeout(() => setZipState('idle'), 2500); return }
      const res = await fetch(`${JWAPI_BASE}/files/zip-selection/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths }),
      })
      if (!res.ok) throw new Error()
      const contentType = res.headers.get('content-type') || ''
      if (contentType.includes('zip') || contentType.includes('octet-stream')) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = `${playlist.name}.zip`; a.click()
        URL.revokeObjectURL(url)
      } else {
        const data = await res.json()
        if (data.download_url) { const a = document.createElement('a'); a.href = data.download_url; a.download = `${playlist.name}.zip`; a.click() }
      }
      setZipState('done')
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
    onClose()
    const d = await userApi.getPlaylist(playlist.id)
    const data = {
      name: d.name,
      description: d.description,
      tracks: d.items.map(i => ({
        id: i.song.id,
        title: i.song.name,
        artist: i.song.credited_artists,
        album: i.song.album ?? null,
        era: i.song.era?.name ?? null,
        path: i.song.path,
        image_url: i.song.image_url,
      })),
    }
    downloadBlob(JSON.stringify(data, null, 2), 'application/json', `${playlist.name}.json`)
  }

  const exportM3u = async (): Promise<void> => {
    onClose()
    const d = await userApi.getPlaylist(playlist.id)
    const tracks = d.items.map(i => userApi.liteSongToTrack(i.song))
    const lines = ['#EXTM3U']
    for (const t of tracks) {
      lines.push(`#EXTINF:${Math.round(t.duration)},${t.artist} - ${t.title}`)
      lines.push(t.streamUrl ?? t.path)
    }
    downloadBlob(lines.join('\n'), 'audio/x-mpegurl', `${playlist.name}.m3u`)
  }

  const copyShare = async (): Promise<void> => {
    try {
      if (!playlist.is_public) {
        await userApi.updatePlaylist(playlist.id, { is_public: true })
        setPlaylist(p => ({ ...p, is_public: true }))
        await refreshPlaylists()
      }
      await navigator.clipboard.writeText(`${shareOrigin()}/playlists?id=${playlist.id}&view=shared`)
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2000)
    } catch {}
  }

  const togglePublic = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await userApi.updatePlaylist(playlist.id, { is_public: !playlist.is_public })
      setPlaylist(p => ({ ...p, is_public: !p.is_public }))
      await refreshPlaylists()
    } catch {} finally { setBusy(false) }
  }

  const addAllTo = async (targetId: number): Promise<void> => {
    onClose()
    const src = await userApi.getPlaylist(playlist.id)
    await Promise.all(src.items.map(item => userApi.addToPlaylist(targetId, item.song.id).catch(() => {})))
    await refreshPlaylists()
  }

  const commitRename = async (): Promise<void> => {
    const val = renameVal.trim() || playlist.name
    await userApi.renamePlaylist(playlist.id, val)
    await refreshPlaylists()
    onClose()
  }

  const del = async (): Promise<void> => {
    onClose()
    await userApi.deletePlaylist(playlist.id)
    await refreshPlaylists()
  }

  // Keep the menu on-screen near the cursor. The 220x340 figures are just the
  // first-paint estimate - the layout effect below re-clamps against the
  // actual rendered size, since content here grows a bit (the rename field)
  // after the initial guess.
  const MENU_W = 220
  const [pos, setPos] = useState(() => ({
    left: Math.max(8, Math.min(state.x, window.innerWidth - MENU_W - 8)),
    top: Math.max(8, Math.min(state.y, window.innerHeight - 340 - 8)),
  }))

  // Close on Escape.
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const top = Math.max(8, Math.min(state.y, window.innerHeight - rect.height - 8))
    const left = Math.max(8, Math.min(state.x, window.innerWidth - rect.width - 8))
    setPos(prev => (prev.top === top && prev.left === left ? prev : { top, left }))
  }, [state.x, state.y, renaming])

  // "Add all to playlist" and "Export playlist" open flyouts beside the menu
  // (matching SongContextMenu's "Add to playlist") instead of growing this
  // menu inline - an inline list has no width cap of its own, so a long
  // playlist name would keep stretching this box out to the edge of the
  // screen. Hovering the row opens it, same as a native submenu.
  useLayoutEffect(() => {
    if (!showPlaylists) return
    const item = addAllItemRef.current, menu = ref.current, sub = addAllSubmenuRef.current
    if (!item || !menu || !sub) return
    const { top, left } = placeFlyout(item, menu, sub)
    setAddAllSubPos(prev => (prev.top === top && prev.left === left ? prev : { top, left }))
  }, [showPlaylists, pos, otherPlaylists.length])

  useLayoutEffect(() => {
    if (!showExport) return
    const item = exportItemRef.current, menu = ref.current, sub = exportSubmenuRef.current
    if (!item || !menu || !sub) return
    const { top, left } = placeFlyout(item, menu, sub)
    setExportSubPos(prev => (prev.top === top && prev.left === left ? prev : { top, left }))
  }, [showExport, pos])

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div
        ref={ref}
        className="fixed z-[61] bg-surface border border-[var(--border)] rounded-xl shadow-2xl py-1 w-[210px] overflow-x-hidden"
        style={{ left: pos.left, top: pos.top }}
        onClick={e => e.stopPropagation()}
      >
        {renaming ? (
          <div className="px-3 py-2 flex gap-2">
            <input
              autoFocus
              value={renameVal}
              onChange={e => setRenameVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); else if (e.key === 'Escape') setRenaming(false) }}
              className="flex-1 bg-surface-overlay rounded-lg px-2.5 py-1.5 text-sm text-text-primary focus:outline-none border border-[var(--border)]"
            />
            <button onClick={commitRename} className="px-2.5 py-1.5 rounded-lg bg-accent text-white text-xs font-medium">Save</button>
          </div>
        ) : (
          <>
            {/* Rendered outside the hover-tracked div below (but still inside
                this portal) so moving the mouse into a flyout doesn't count as
                "left the trigger row" and close it. */}
            {showExport && (
              <div
                ref={exportSubmenuRef}
                onClick={e => e.stopPropagation()}
                style={{ position: 'fixed', zIndex: 62, top: exportSubPos.top, left: exportSubPos.left }}
                className="w-[210px] bg-surface border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden py-1"
              >
                <button onClick={exportJson}
                  className="w-full text-left px-3.5 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors">
                  As JSON
                </button>
                <button onClick={exportM3u}
                  className="w-full text-left px-3.5 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors">
                  As M3U
                </button>
              </div>
            )}
            {showPlaylists && (
              <div
                ref={addAllSubmenuRef}
                onClick={e => e.stopPropagation()}
                style={{ position: 'fixed', zIndex: 62, top: addAllSubPos.top, left: addAllSubPos.left }}
                className="w-[210px] bg-surface border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden py-1"
              >
                <div className="max-h-44 overflow-y-auto">
                  {otherPlaylists.map(p => (
                    <button key={p.id} onClick={() => addAllTo(p.id)} title={p.name}
                      className="w-full text-left px-3.5 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors truncate">
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* Hovering a submenu row opens its flyout; hovering any other
                row closes it again, the way a native submenu behaves.
                Driving both from one handler also makes them mutually
                exclusive. */}
            <div
              onMouseOver={(e) => {
                const t = e.target as Node
                setShowPlaylists(addAllItemRef.current?.contains(t) ?? false)
                setShowExport(exportItemRef.current?.contains(t) ?? false)
              }}
            >
            <MenuItem icon={Play} label="Open" onClick={open} />
            <MenuItem icon={Shuffle} label="Play all" onClick={playAll} />
            <MenuItem icon={ListEnd} label="Add all to queue" onClick={queueAll} />
            <MenuItem
              icon={zipState === 'loading' ? Loader2 : Archive}
              label={zipState === 'error' ? 'Download failed' : zipState === 'done' ? 'Download started' : 'Download as ZIP'}
              disabled={zipState === 'loading'}
              onClick={downloadZip}
            />
            <MenuItem
              innerRef={exportItemRef}
              icon={Download}
              label="Export playlist"
              trailing={<ChevronRight size={13} className="text-text-muted" />}
              onClick={() => setShowExport(v => !v)}
            />
            <div className="border-t border-[var(--border)] my-1" />
            <MenuItem icon={shareCopied ? Check : Link} label={shareCopied ? 'Link copied!' : 'Copy share link'} onClick={copyShare} />
            <MenuItem icon={playlist.is_public ? Globe : Lock} label={playlist.is_public ? 'Make private' : 'Make public'} disabled={busy} onClick={togglePublic} />
            <div className="border-t border-[var(--border)] my-1" />
            <MenuItem icon={Pencil} label="Rename" onClick={() => { setRenameVal(playlist.name); setRenaming(true) }} />
            {otherPlaylists.length > 0 && (
              <MenuItem
                innerRef={addAllItemRef}
                icon={FolderInput}
                label="Add all to playlist"
                onClick={() => setShowPlaylists(v => !v)}
                trailing={<ChevronRight size={13} className="text-text-muted" />}
              />
            )}
            <div className="border-t border-[var(--border)] my-1" />
            <MenuItem icon={Trash2} label="Delete playlist" destructive onClick={del} />
            </div>
          </>
        )}
      </div>
    </>,
    document.body
  )
}
