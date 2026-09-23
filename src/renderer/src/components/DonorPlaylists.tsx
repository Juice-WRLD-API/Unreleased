import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowDown, ArrowUp, Check, Cloud, Music2, Pencil, Play, Plus, Shuffle, Trash2, X } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useIsMobile } from '../hooks/useIsMobile'
import { registerBackHandler } from '../lib/backHandlers'
import { donorFileToTrack, isDonorAudio } from '../lib/donorPlayback'
import { formatBytes } from '../lib/format'
import { fisherYates } from '../store/queueSlice'
import type { DonorPlaylist } from '../types'
import type { DonorFile } from '../lib/donorFilesApi'
import PlaylistCard from './PlaylistCard'
import MobilePlaylistCard from './PlaylistCard.mobile'
import { DonorAudioTile } from './DonorFiles'
import DonorContextMenu from './DonorContextMenu'
import type { DonorMenuState } from './DonorContextMenu'
import { fetchDonorFileBlob } from '../lib/donorFilesApi'

// Playlists of donor cloud files. They sit on the Playlists page as a third
// kind beside synced and on-device ones and use the same card + hero + track
// list look, but storage is the account's user_settings blob (see the store's
// donorPlaylists) and entries are file_ids resolved against the donor file list.

/** Resolves a playlist's file_ids against the loaded donor files. A file that
 *  has since been deleted simply drops out. Loads the list on first use. */
function useDonorPlaylistFiles(playlist: DonorPlaylist | undefined): { files: DonorFile[]; loading: boolean } {
  const donorFiles = useStore((s) => s.donorFiles)
  const loadDonorFiles = useStore((s) => s.loadDonorFiles)
  useEffect(() => { if (donorFiles === null) void loadDonorFiles() }, [donorFiles, loadDonorFiles])
  const files = useMemo(() => {
    if (!playlist || !donorFiles) return []
    const byId = new Map(donorFiles.map((f) => [f.file_id, f]))
    return playlist.fileIds.map((id) => byId.get(id)).filter((f): f is DonorFile => !!f && isDonorAudio(f))
  }, [playlist, donorFiles])
  return { files, loading: donorFiles === null }
}

function DonorCover({ className = '' }: { className?: string }): JSX.Element {
  return (
    <div className={`bg-gradient-to-br from-accent/40 to-accent/10 flex items-center justify-center ${className}`}>
      <Cloud size={32} className="text-accent/50" />
    </div>
  )
}

function trackCount(n: number): string {
  return `${n} ${n === 1 ? 'track' : 'tracks'}`
}

// ── Library section ──────────────────────────────────────────────────────────

export function DonorPlaylistsSection({ onOpen }: { onOpen: (id: string) => void }): JSX.Element | null {
  const isMobile = useIsMobile()
  const isDonor = useStore((s) => !!s.account?.is_donor)
  const playlists = useStore((s) => s.donorPlaylists)
  const donorFiles = useStore((s) => s.donorFiles)
  const createDonorPlaylist = useStore((s) => s.createDonorPlaylist)
  const renameDonorPlaylist = useStore((s) => s.renameDonorPlaylist)
  const deleteDonorPlaylist = useStore((s) => s.deleteDonorPlaylist)
  const loadDonorFiles = useStore((s) => s.loadDonorFiles)
  const playCollection = useStore((s) => s.playCollection)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [menuId, setMenuId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => { if (isDonor && donorFiles === null) void loadDonorFiles() }, [isDonor, donorFiles, loadDonorFiles])

  if (!isDonor) return null

  const countFor = (p: DonorPlaylist): number => {
    if (!donorFiles) return p.fileIds.length
    const known = new Set(donorFiles.map((f) => f.file_id))
    return p.fileIds.filter((id) => known.has(id)).length
  }
  const submitCreate = (): void => {
    const name = newName.trim()
    if (!name) return
    createDonorPlaylist(name)
    setNewName('')
    setCreating(false)
  }
  const closeMenu = (): void => { setMenuId(null); setRenaming(false); setConfirmDelete(false) }
  const menuPlaylist = playlists.find((p) => p.id === menuId)
  const openMenu = (p: DonorPlaylist): void => { setMenuId(p.id); setRenaming(false); setConfirmDelete(false); setRenameVal(p.name) }
  const playPlaylist = (p: DonorPlaylist): void => {
    if (!donorFiles) return
    const byId = new Map(donorFiles.map((f) => [f.file_id, f]))
    const tracks = p.fileIds.map((id) => byId.get(id)).filter((f): f is DonorFile => !!f && isDonorAudio(f)).map(donorFileToTrack)
    if (tracks.length) playCollection(tracks)
  }

  const px = isMobile ? 'px-4' : ''
  return (
    <div className={`${isMobile ? 'pt-4' : 'mt-8'}`}>
      <div className={`flex items-center justify-between mb-3 ${px}`}>
        <h2 className="text-text-muted text-xs font-semibold uppercase tracking-widest">Donor files</h2>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1 text-xs font-semibold text-accent hover:brightness-110"
          ><Plus size={13} strokeWidth={2.5} /> New playlist</button>
        )}
      </div>

      {creating && (
        <div className={`flex items-center gap-2 mb-4 max-w-md ${px}`}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitCreate(); if (e.key === 'Escape') { setCreating(false); setNewName('') } }}
            placeholder="Donor playlist name"
            autoFocus
            className="flex-1 min-w-0 bg-surface-overlay border border-[var(--border)] rounded-xl px-3.5 py-2.5 text-text-primary text-sm focus:outline-none focus:border-accent/50"
          />
          <button onClick={submitCreate} className="px-4 py-2.5 rounded-xl bg-accent text-black text-sm font-semibold">Create</button>
          <button onClick={() => { setCreating(false); setNewName('') }} className="p-2.5 rounded-xl text-text-muted hover:text-text-primary"><X size={16} /></button>
        </div>
      )}

      {playlists.length === 0 && !creating && (
        <p className={`text-text-muted text-sm ${px}`}>
          No donor playlists yet. Make one here, then add files from Files &gt; My files.
        </p>
      )}

      <div
        className={isMobile ? 'grid grid-cols-2 gap-x-3 gap-y-4 px-4' : 'grid gap-x-4 gap-y-6'}
        style={isMobile ? undefined : { gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}
      >
        {playlists.map((p) => {
          const subtitle = trackCount(countFor(p))
          const badge = <span className="flex items-center gap-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded-md"><Cloud size={9} /> Donor</span>
          return isMobile ? (
            <MobilePlaylistCard
              key={p.id}
              layout="grid"
              name={p.name}
              subtitle={subtitle}
              cover={<DonorCover className="w-full h-full" />}
              badge={badge}
              selected={false}
              selectMode={false}
              onOpen={() => onOpen(p.id)}
              onLongPress={() => openMenu(p)}
              onMenu={() => openMenu(p)}
            />
          ) : (
            <PlaylistCard
              key={p.id}
              name={p.name}
              subtitle={subtitle}
              cover={<DonorCover className="w-full h-full" />}
              badge={badge}
              selected={false}
              selectMode={false}
              onClick={() => onOpen(p.id)}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openMenu(p) }}
              onMenuButton={(e) => { e.stopPropagation(); openMenu(p) }}
              onPlay={() => playPlaylist(p)}
            />
          )
        })}
      </div>

      {menuPlaylist && (
        <div className={`mt-4 flex items-center flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-surface-raised px-3 py-2 ${isMobile ? 'mx-4' : 'max-w-xl'}`}>
          {renaming ? (
            <>
              <input
                value={renameVal}
                onChange={(e) => setRenameVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && renameVal.trim()) { renameDonorPlaylist(menuPlaylist.id, renameVal.trim()); closeMenu() }
                  if (e.key === 'Escape') setRenaming(false)
                }}
                autoFocus
                className="flex-1 min-w-0 bg-surface-overlay rounded-lg px-2.5 py-1.5 text-sm text-text-primary focus:outline-none"
              />
              <button
                onClick={() => { if (renameVal.trim()) { renameDonorPlaylist(menuPlaylist.id, renameVal.trim()); closeMenu() } }}
                className="p-1.5 rounded-lg bg-accent/15 text-accent"
              ><Check size={14} /></button>
              <button onClick={() => setRenaming(false)} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary"><X size={14} /></button>
            </>
          ) : (
            <>
              <span className="text-text-primary text-sm font-medium truncate flex-1 min-w-0">{menuPlaylist.name}</span>
              <button onClick={() => { setRenaming(true); setRenameVal(menuPlaylist.name) }} className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary">
                <Pencil size={12} /> Rename
              </button>
              {confirmDelete ? (
                <>
                  <button onClick={() => setConfirmDelete(false)} className="text-xs text-text-muted hover:text-text-primary">Cancel</button>
                  <button
                    onClick={() => { deleteDonorPlaylist(menuPlaylist.id); closeMenu() }}
                    className="rounded-lg bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-400 hover:bg-red-500/25"
                  >Delete</button>
                </>
              ) : (
                <button onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-red-400">
                  <Trash2 size={12} /> Delete
                </button>
              )}
              <button onClick={closeMenu} className="p-1 text-text-muted hover:text-text-primary" aria-label="Close"><X size={14} /></button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Detail page ──────────────────────────────────────────────────────────────

export function DonorPlaylistDetail({ id, onBack }: { id: string; onBack: () => void }): JSX.Element {
  const isMobile = useIsMobile()
  const playlist = useStore((s) => s.donorPlaylists.find((p) => p.id === id))
  const renameDonorPlaylist = useStore((s) => s.renameDonorPlaylist)
  const deleteDonorPlaylist = useStore((s) => s.deleteDonorPlaylist)
  const removeFromDonorPlaylist = useStore((s) => s.removeFromDonorPlaylist)
  const reorderDonorPlaylist = useStore((s) => s.reorderDonorPlaylist)
  const playTrack = useStore((s) => s.playTrack)
  const playCollection = useStore((s) => s.playCollection)
  const currentTrackId = useStore((s) => s.currentTrack?.id)
  const { files, loading } = useDonorPlaylistFiles(playlist)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<DonorMenuState | null>(null)
  const closeCtxMenu = useCallback(() => setCtxMenu(null), [])

  useEffect(() => registerBackHandler(() => { onBack(); return true }), [onBack])
  // A playlist that vanished (deleted on another device via sync) has nothing to show.
  useEffect(() => { if (!playlist) onBack() }, [playlist, onBack])
  if (!playlist) return <div />

  const tracks = files.map(donorFileToTrack)
  const px = isMobile ? 'px-4' : 'px-6'
  const move = (fileId: string, delta: -1 | 1): void => {
    const ids = [...playlist.fileIds]
    const i = ids.indexOf(fileId)
    const j = i + delta
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    reorderDonorPlaylist(playlist.id, ids)
  }
  const commitRename = (): void => {
    if (renameVal.trim()) renameDonorPlaylist(playlist.id, renameVal.trim())
    setRenaming(false)
  }
  const iconBtn = 'p-2.5 rounded-full text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors'

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto overflow-x-hidden">
      <div className={`${px} pt-5 pb-6 shrink-0`}>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors">
          <ArrowLeft size={15} /> Playlists
        </button>
        <div className={`flex gap-5 pt-5 ${isMobile ? 'flex-col items-start' : 'items-end'}`}>
          <div className="shrink-0 rounded-xl shadow-2xl overflow-hidden" style={{ width: isMobile ? 140 : 180, height: isMobile ? 140 : 180 }}>
            <DonorCover className="w-full h-full" />
          </div>
          <div className="min-w-0 flex-1 pb-1 w-full">
            <p className="text-xs uppercase tracking-widest font-semibold mb-2 text-text-muted">Donor Playlist</p>
            {renaming ? (
              <div className="flex items-center gap-2 mb-3">
                <input
                  value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false) }}
                  autoFocus
                  className="rounded-lg px-3 py-2 text-2xl font-black focus:outline-none focus:border-accent/50 w-full bg-surface-overlay border border-[var(--border)] text-text-primary"
                />
                <button onClick={commitRename} className="p-2 rounded-lg bg-accent/15 text-accent shrink-0"><Check size={16} /></button>
                <button onClick={() => setRenaming(false)} className="p-2 rounded-lg shrink-0 text-text-muted hover:text-text-primary"><X size={16} /></button>
              </div>
            ) : (
              <h1 className="text-3xl md:text-4xl font-black truncate mb-2 text-text-primary">{playlist.name}</h1>
            )}
            <div className="flex items-center gap-1.5 text-sm mb-4 text-text-muted">
              <Cloud size={12} className="shrink-0" />
              <span>Donor files</span>
              <span>·</span>
              <span>{trackCount(files.length)}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {tracks.length > 0 && (
                <button
                  onClick={() => playCollection(tracks)}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-accent text-black text-sm font-semibold hover:brightness-105 active:scale-[0.97] transition-all"
                ><Play size={15} fill="currentColor" /> Play</button>
              )}
              {tracks.length > 1 && (
                <button
                  onClick={() => { const s = fisherYates(tracks); playTrack(s[0], s) }}
                  className={iconBtn}
                  title="Shuffle"
                ><Shuffle size={16} /></button>
              )}
              {!renaming && (
                <button onClick={() => { setRenameVal(playlist.name); setRenaming(true) }} className={iconBtn} title="Rename"><Pencil size={15} /></button>
              )}
              {confirmDelete ? (
                <span className="inline-flex items-center gap-2">
                  <button onClick={() => setConfirmDelete(false)} className="text-xs text-text-muted hover:text-text-primary">Cancel</button>
                  <button
                    onClick={() => { deleteDonorPlaylist(playlist.id); onBack() }}
                    className="rounded-lg bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-400 hover:bg-red-500/25"
                  >Delete playlist</button>
                </span>
              ) : (
                <button onClick={() => setConfirmDelete(true)} className={`${iconBtn} hover:!text-red-400 hover:!bg-red-500/10`} title="Delete playlist"><Trash2 size={15} /></button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className={`border-t border-[var(--border)] ${isMobile ? 'mx-4' : 'mx-6'} mb-3 shrink-0`} />

      {loading ? (
        <p className="text-text-muted text-sm px-6 py-6">Loading files…</p>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-center px-8">
          <Music2 className="text-text-muted opacity-20" size={40} />
          <p className="text-text-muted text-sm">This playlist is empty.</p>
          <p className="text-text-muted text-xs">Add audio from Files &gt; My files.</p>
        </div>
      ) : (
        <div className={`${isMobile ? 'px-2' : 'px-2'} pb-8`}>
          {files.map((f, i) => {
            const t = tracks[i]
            const active = currentTrackId === t.id
            return (
              <div
                key={f.file_id}
                className={`group flex items-center gap-3 px-4 py-2 rounded-lg transition-colors select-none ${ctxMenu?.file.file_id === f.file_id ? 'bg-surface-raised' : 'hover:bg-surface-raised'}`}
                onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ file: f, x: e.clientX, y: e.clientY }) }}
                onDoubleClick={isMobile ? undefined : () => playTrack(t, tracks)}
              >
                <button
                  onClick={() => playTrack(t, tracks)}
                  className={`w-7 shrink-0 text-center text-xs tabular-nums ${active ? 'text-accent' : 'text-text-muted'}`}
                  title="Play"
                >
                  <span className="group-hover:hidden">{active ? '♪' : i + 1}</span>
                  <Play size={14} fill="currentColor" className="hidden group-hover:inline text-text-primary" />
                </button>
                <DonorAudioTile fileId={f.file_id} filename={f.filename} size={40} />
                <div className="min-w-0 flex-1" onClick={isMobile ? () => playTrack(t, tracks) : undefined}>
                  <p className={`text-sm font-medium truncate ${active ? 'text-accent' : 'text-text-primary'}`} title={f.filename}>{t.title}</p>
                  <p className="text-text-muted text-xs truncate">{formatBytes(f.size)}</p>
                </div>
                <div className="flex items-center gap-0.5 shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                  <button onClick={() => move(f.file_id, -1)} disabled={i === 0} className="p-1.5 rounded text-text-muted hover:text-text-primary disabled:opacity-30" title="Move up"><ArrowUp size={13} /></button>
                  <button onClick={() => move(f.file_id, 1)} disabled={i === files.length - 1} className="p-1.5 rounded text-text-muted hover:text-text-primary disabled:opacity-30" title="Move down"><ArrowDown size={13} /></button>
                  <button onClick={() => removeFromDonorPlaylist(playlist.id, f.file_id)} className="p-1.5 rounded text-text-muted hover:text-red-400" title="Remove from playlist"><X size={13} /></button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {ctxMenu && (() => {
        const f = ctxMenu.file
        const t = tracks.find((x) => x.id === donorFileToTrack(f).id) ?? donorFileToTrack(f)
        return (
          <DonorContextMenu
            key={f.file_id}
            state={ctxMenu}
            onClose={closeCtxMenu}
            onPlay={() => playTrack(t, tracks)}
            onDownload={() => void downloadFile(f)}
            removeAction={{ label: 'Remove from this playlist', onClick: () => removeFromDonorPlaylist(playlist.id, f.file_id) }}
          />
        )
      })()}
    </div>
  )
}

async function downloadFile(f: DonorFile): Promise<void> {
  try {
    const url = URL.createObjectURL(await fetchDonorFileBlob(f.file_id))
    const a = document.createElement('a')
    a.href = url
    a.download = f.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch (err) {
    console.error('Could not download donor file', err)
  }
}
