import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Info, ListPlus, ListEnd, Plus, Folder, Pencil, Download, PackageOpen,
  ChevronDown, ChevronRight, ChevronLeft, Check, Loader2, CheckSquare2, Heart, Trash2, ListMusic, Flag,
  Layers, Star, FileAudio2, X, Ban, Share2,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { useShallow } from 'zustand/react/shallow'
import * as userApi from '../lib/userApi'
import { ensureDonorUrl, isDonorStreamUrl } from '../lib/donorPlayback'
import { buildStreamUrl, findSessionZips, songToTrack, getSongsByIds, JWApiSong, JWApiFileEntry, ZIP_OPERATIONS_ENABLED } from '../lib/juicewrldApi'
import { Track } from '../types'
import ChangeVersionMenuItem from './ChangeVersionMenuItem'
import { placeFlyout } from '../lib/menuFlyout'
import { versionsEnabled, getVersionGroup } from '../lib/versionsApi'
import { useIsMobile } from '../hooks/useIsMobile'
import { Sheet, SheetItem, SheetDivider } from './mobile/Sheet'
import { hasChatAccess } from '../store/chatStore'
import ShareSongModal from './chat/ShareSongModal'

// The one context menu used everywhere a song can be right-clicked (Tracker,
// Liked Songs, Playlists, the bottom Player bar, WRLD). Built around `Track`
// + `songId` (the common denominator across those five places - some only
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
  /** Tracker / Library - enters multi-select mode with this song selected. */
  onSelect?: () => void

  /** WRLD's simple like toggle. */
  liked?: boolean
  onToggleLike?: () => void

  /** Destructive, always-last action - "Unlike" (Liked Songs) or "Remove
   *  from playlist" (Playlists). */
  removeAction?: { label: string; onClick: () => void }

  /** Full song object, if the caller already has one - unlocks the
   *  recording-session ZIP download (needs fields Track doesn't carry). */
  song?: JWApiSong

  /** Hides "Change version" even when songId is valid - for playback
   *  contexts where switching doesn't make sense (e.g. WRLD's FM radio,
   *  which is server-driven and can't be manually redirected). */
  disableChangeVersion?: boolean

  canLinkSessionFile?: boolean
  hasSessionLinkOverride?: boolean
  onLinkSessionFile?: () => void
  onClearSessionLink?: () => void
}

function MenuItem({ icon, label, onClick, destructive, trailing, innerRef }: {
  icon: React.ReactNode; label: string; onClick: () => void; destructive?: boolean
  /** Right-aligned adornment - the submenu chevron. */
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

// A mobile sub-sheet's header: back chevron + title, in place of Sheet's
// plain `title` string - sub-sheets (playlist picker, version switcher, ZIP
// picker) need an explicit way back to the main sheet since swiping down or
// tapping the scrim closes the whole menu, not just the sub-sheet.
function SubSheetHeader({ title, onBack }: { title: string; onBack: () => void }): JSX.Element {
  return (
    <button
      onClick={onBack}
      title="Back"
      className="w-full flex items-center gap-1 px-3 pt-3 pb-1 text-text-primary font-semibold text-[15px]"
    >
      <ChevronLeft size={19} className="text-text-muted shrink-0" />
      {title}
    </button>
  )
}


function downloadTrack(track: Track): void {
  // Donor files need the auth header, so hand them to the blob path instead.
  if (isDonorStreamUrl(track.streamUrl)) {
    void ensureDonorUrl(track.streamUrl).then((url) => {
      const link = document.createElement('a')
      link.href = url
      link.download = `${track.title}.mp3`
      document.body.appendChild(link)
      link.click()
      link.remove()
    })
    return
  }
  const a = document.createElement('a')
  a.href = track.streamUrl ?? buildStreamUrl(track.path)
  a.download = `${track.title}.mp3`
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
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
  onPlay, onPlayNext, onAddToQueue, onShowInFiles, onSelect,
  liked, onToggleLike, removeAction, song, disableChangeVersion,
  canLinkSessionFile, hasSessionLinkOverride, onLinkSessionFile, onClearSessionLink,
}: Props): JSX.Element {
  const { playlists, account, refreshPlaylists, setShowUserAuth, playTrack, localPlaylists, addToLocalPlaylist, createLocalPlaylist, songPrefs, setSongDefaultVersion, setSongExcludedVersions } = useStore(
    useShallow(s => ({
      playlists: s.playlists, account: s.account, refreshPlaylists: s.refreshPlaylists,
      setShowUserAuth: s.setShowUserAuth, playTrack: s.playTrack,
      localPlaylists: s.localPlaylists, addToLocalPlaylist: s.addToLocalPlaylist, createLocalPlaylist: s.createLocalPlaylist,
      songPrefs: s.songPrefs, setSongDefaultVersion: s.setSongDefaultVersion, setSongExcludedVersions: s.setSongExcludedVersions,
    }))
  )
  const isMobile = useIsMobile()
  const { track, songId } = state
  const menuRef = useRef<HTMLDivElement>(null)
  const [panel, setPanel] = useState<'main' | 'zip'>('main')
  // "Add to playlist" opens a flyout beside the menu rather than replacing it.
  const [playlistsOpen, setPlaylistsOpen] = useState(false)
  const addItemRef = useRef<HTMLButtonElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const [subPos, setSubPos] = useState({ top: 0, left: 0 })
  // "Change version" is a flyout too, but ChangeVersionMenuItem owns its own
  // placement (it has to re-place itself when its list finishes loading) - the
  // open state stays here so all three submenus remain mutually exclusive.
  const [versionsOpen, setVersionsOpen] = useState(false)
  const versionItemRef = useRef<HTMLButtonElement>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [doneId, setDoneId] = useState<number | null>(null)
  const [localDoneId, setLocalDoneId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [contained, setContained] = useState<Set<number>>(new Set())
  const [zipLoading, setZipLoading] = useState(false)
  const [zipCandidates, setZipCandidates] = useState<JWApiFileEntry[] | null>(null)
  const [shareOpen, setShareOpen] = useState(false)

  // Mobile only: "Add to playlist" and "Change version" replace the whole
  // sheet's content instead of opening a desktop-style flyout (there's no
  // room beside a full-width bottom sheet, and PlaylistsView.mobile/
  // ApiTrackerView.mobile already establish "swap the sheet's content"
  // as this app's mobile drill-down pattern). The zip picker reuses
  // `panel`/`zipCandidates` above since that state is already
  // platform-agnostic.
  const [mobileSub, setMobileSub] = useState<'playlists' | 'versions' | null>(null)
  const [mobileVersions, setMobileVersions] = useState<{ song: JWApiSong; label: string | null; version: string | null }[] | null>(null)
  const [mobileVersionsLoading, setMobileVersionsLoading] = useState(false)

  useEffect(() => {
    if (!isMobile || mobileSub !== 'versions' || songId == null || mobileVersions != null || mobileVersionsLoading) return
    let cancelled = false
    setMobileVersionsLoading(true)
    ;(async () => {
      try {
        const metas = await getVersionGroup(songId)
        const songs = await getSongsByIds(metas.map(m => m.songId))
        const byId = new Map(songs.map(s => [s.id, s]))
        const fetched = metas
          .map(m => {
            const song = byId.get(m.songId)
            if (!song?.path) return null
            return {
              song,
              version: m.version,
              label: m.version ? (m.versionTitle ? `${m.version} - ${m.versionTitle}` : m.version) : m.versionTitle,
            }
          })
          .filter((v): v is { song: JWApiSong; label: string | null; version: string | null } => !!v)
        if (!cancelled) setMobileVersions(fetched)
      } finally {
        if (!cancelled) setMobileVersionsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [isMobile, mobileSub, songId, mobileVersions, mobileVersionsLoading])

  const mobileDefaultVersion = (() => {
    if (songId == null) return null
    const own = songPrefs[songId]?.default_version
    if (own) return own
    for (const v of mobileVersions ?? []) {
      const d = songPrefs[v.song.id]?.default_version
      if (d) return d
    }
    return null
  })()

  const toggleMobileDefaultVersion = (version: string): void => {
    if (songId == null) return
    const isDefault = mobileDefaultVersion?.toLowerCase() === version.toLowerCase()
    if (!isDefault) { setSongDefaultVersion(songId, version); return }
    if (songPrefs[songId]?.default_version?.toLowerCase() === version.toLowerCase()) setSongDefaultVersion(songId, null)
    for (const v of mobileVersions ?? []) {
      if (songPrefs[v.song.id]?.default_version?.toLowerCase() === version.toLowerCase()) setSongDefaultVersion(v.song.id, null)
    }
  }

  const mobileExcludedVersions = (() => {
    const set = new Set<string>()
    if (songId == null) return set
    for (const label of songPrefs[songId]?.excluded_versions ?? []) set.add(label.toLowerCase())
    for (const v of mobileVersions ?? []) {
      for (const label of songPrefs[v.song.id]?.excluded_versions ?? []) set.add(label.toLowerCase())
    }
    return set
  })()

  const toggleMobileExcludedVersion = (version: string): void => {
    if (songId == null) return
    const label = version.toLowerCase()
    const isExcluded = mobileExcludedVersions.has(label)
    if (!isExcluded) {
      const own = songPrefs[songId]?.excluded_versions ?? []
      setSongExcludedVersions(songId, [...own, version])
      return
    }
    const ownExcluded = songPrefs[songId]?.excluded_versions ?? []
    if (ownExcluded.some(v => v.toLowerCase() === label)) {
      setSongExcludedVersions(songId, ownExcluded.filter(v => v.toLowerCase() !== label))
    }
    for (const v of mobileVersions ?? []) {
      const sibExcluded = songPrefs[v.song.id]?.excluded_versions ?? []
      if (sibExcluded.some(x => x.toLowerCase() === label)) {
        setSongExcludedVersions(v.song.id, sibExcluded.filter(x => x.toLowerCase() !== label))
      }
    }
  }

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
    } catch {} finally { setBusyId(null) }
  }

  const createAndAdd = async (): Promise<void> => {
    const name = newName.trim()
    if (!name) return
    if (isLocalOnly) {
      createLocalPlaylist(name)
      // createLocalPlaylist sets activeLocalPlaylistId synchronously (zustand
      // set() applies immediately), so it's readable right after the call -
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
  // (e.g. shared-playlist placeholder rows) - treat both as invalid.
  const hasValidSong = songId != null && songId > 0
  const isUnplayable = track.genre === 'unsurfaced' || (track.genre === 'recording_session' && !track.path)
  // A local library file with no matching API song - it already lives on
  // disk (so "Download" is meaningless) and can't join a server playlist,
  // but it can join one of the device-local playlists instead.
  const isLocalOnly = songId == null && track.id.startsWith('local-')
  const canAddToPlaylist = !isUnplayable && (hasValidSong || isLocalOnly)
  // Sharing rides the song's own stream URL, so it only makes sense for
  // real API songs (not local-only files, which nobody else can reach) and
  // only for staff, who are the only ones with a chat to share into.
  const canShareToChat = hasChatAccess(account) && hasValidSong && !!track.streamUrl && !isDonorStreamUrl(track.streamUrl)
  // Sessions/unsurfaced are treated as unplayable - don't offer Play / Play
  // next / Add to queue for them (they'd never actually play). Local files
  // (no category in genre) stay playable as long as they have a path.
  const canQueue = !!track.path && !isUnplayable

  // Estimated clamp for the very first paint; corrected against the real
  // rendered size in the layout effect below. The estimate alone isn't enough
  // because the menu's height varies a lot (which optional items a caller
  // enables, long titles), so near a screen edge the guess undershoots and the
  // menu spills off-screen. Measuring the actual box fixes every case. The
  // submenus don't factor in - they're flyouts positioned separately.
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

  if (shareOpen && canShareToChat) {
    return <ShareSongModal track={track} songId={songId as number} onClose={onClose} />
  }

  if (isMobile) {
    if (panel === 'zip') {
      return (
        <Sheet onClose={() => setPanel('main')} header={<SubSheetHeader title="Download session" onBack={() => setPanel('main')} />}>
          {zipCandidates && zipCandidates.length > 0 ? (
            <>
              <p className="px-5 pb-1 text-xs text-text-muted">Multiple matches found - pick one:</p>
              {zipCandidates.map(c => (
                <SheetItem key={c.path} icon={PackageOpen} label={c.name} onClick={() => { downloadZipEntry(c); onClose() }} />
              ))}
            </>
          ) : (
            <p className="px-5 py-6 text-sm text-text-muted text-center">No matching ZIP found for this session.</p>
          )}
        </Sheet>
      )
    }

    if (mobileSub === 'playlists') {
      return (
        <Sheet onClose={() => setMobileSub(null)} header={<SubSheetHeader title="Add to playlist" onBack={() => setMobileSub(null)} />}>
          {isLocalOnly ? (
            <>
              {localPlaylists.length === 0 && <p className="px-5 py-3 text-sm text-text-muted">No playlists yet.</p>}
              {localPlaylists.map((p) => {
                const alreadyIn = p.trackIds.includes(track.id)
                return (
                  <SheetItem
                    key={p.id} icon={ListMusic} label={p.name} active={alreadyIn || localDoneId === p.id}
                    trailing={(alreadyIn || localDoneId === p.id) ? <Check size={16} className="text-accent" /> : undefined}
                    onClick={() => { addToLocalPlaylist(p.id, track.id); setLocalDoneId(p.id) }}
                  />
                )
              })}
            </>
          ) : !account ? (
            <div className="px-5 pb-4">
              <p className="text-sm text-text-muted mb-3">Log in to save to playlists.</p>
              <button
                onClick={() => { setShowUserAuth(true); onClose() }}
                className="w-full py-2.5 rounded-xl bg-accent/15 text-accent text-sm font-semibold"
              >
                Log in
              </button>
            </div>
          ) : (
            <>
              {playlists.length === 0 && <p className="px-5 py-3 text-sm text-text-muted">No playlists yet.</p>}
              {playlists.map((p) => {
                const alreadyIn = contained.has(p.id)
                return (
                  <SheetItem
                    key={p.id} icon={ListMusic} label={p.name} active={alreadyIn || doneId === p.id} disabled={busyId === p.id}
                    trailing={busyId === p.id
                      ? <Loader2 size={16} className="animate-spin text-text-muted" />
                      : (alreadyIn || doneId === p.id) ? <Check size={16} className="text-accent" /> : undefined}
                    onClick={() => addTo(p.id)}
                  />
                )
              })}
            </>
          )}
          {(isLocalOnly || account) && (
            <>
              <SheetDivider />
              {creating ? (
                <div className="flex gap-2 px-5 py-2">
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createAndAdd()}
                    placeholder="Playlist name"
                    autoFocus
                    className="flex-1 min-w-0 bg-surface-overlay border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none"
                  />
                  <button onClick={createAndAdd} disabled={busyId === -1} className="px-3 rounded-lg bg-accent/15 text-accent">
                    {busyId === -1 ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  </button>
                </div>
              ) : (
                <SheetItem icon={Plus} label="New playlist" onClick={() => setCreating(true)} />
              )}
            </>
          )}
        </Sheet>
      )
    }

    if (mobileSub === 'versions') {
      return (
        <Sheet onClose={() => setMobileSub(null)} header={<SubSheetHeader title="Change version" onBack={() => setMobileSub(null)} />}>
          {mobileVersionsLoading ? (
            <p className="px-5 py-3 text-sm text-text-muted flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
          ) : !mobileVersions || mobileVersions.length === 0 ? (
            <p className="px-5 py-3 text-sm text-text-muted">No other versions linked.</p>
          ) : mobileVersions.map(({ song: v, label, version }) => {
            const isDefault = !!version && mobileDefaultVersion?.toLowerCase() === version.toLowerCase()
            const isExcluded = !!version && mobileExcludedVersions.has(version.toLowerCase())
            return (
              <div key={v.id} className="flex items-center gap-1 pl-5 pr-3">
                <button
                  onClick={() => { const t = songToTrack(v); playTrack(t, [t]); onClose() }}
                  className="flex-1 min-w-0 text-left py-3.5 text-[15px] text-text-primary truncate"
                >
                  {v.name}
                  {label && <span className="text-text-muted text-xs"> - {label}</span>}
                </button>
                {version && (
                  <button
                    onClick={() => toggleMobileDefaultVersion(version)}
                    title={isDefault ? 'Default version - tap to unset' : `Always play "${version}" for this song`}
                    className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-full ${isDefault ? 'text-accent' : 'text-text-muted'}`}
                  >
                    <Star size={16} fill={isDefault ? 'currentColor' : 'none'} />
                  </button>
                )}
                {version && (
                  <button
                    onClick={() => toggleMobileExcludedVersion(version)}
                    title={isExcluded ? 'Excluded - tap to allow again' : `Never auto-pick "${version}" for this song`}
                    className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-full ${isExcluded ? 'text-red-400' : 'text-text-muted'}`}
                  >
                    <Ban size={16} />
                  </button>
                )}
              </div>
            )
          })}
        </Sheet>
      )
    }

    return (
      <Sheet
        onClose={onClose}
        title={track.title}
        header={<p className="px-5 pt-0.5 pb-2 text-xs text-text-muted truncate">{track.artist}</p>}
      >
        {onPlay && canQueue && <SheetItem icon={ListEnd} label="Play" onClick={() => { onPlay(); onClose() }} />}
        {onPlayNext && canQueue && <SheetItem icon={ListEnd} label="Play next" onClick={() => { onPlayNext(); onClose() }} />}
        {hasValidSong && <SheetItem icon={Info} label="Song info" onClick={() => { onInfo(); onClose() }} />}
        {hasValidSong && (
          <SheetItem
            icon={Flag} label="Report issue"
            onClick={() => { useStore.getState().openReport({ kind: 'song', songId: songId as number, songName: track.apiTitle || track.title }); onClose() }}
          />
        )}
        {onSelect && <SheetItem icon={CheckSquare2} label="Select" onClick={() => { onSelect(); onClose() }} />}
        {onAddToQueue && canQueue && <SheetItem icon={ListPlus} label="Add to queue" onClick={() => { onAddToQueue(); onClose() }} />}
        {canAddToPlaylist && (
          <SheetItem icon={Plus} label="Add to playlist" trailing={<ChevronRight size={16} className="text-text-muted" />} onClick={() => setMobileSub('playlists')} />
        )}
        {canShareToChat && <SheetItem icon={Share2} label="Share to chat" onClick={() => setShareOpen(true)} />}
        {onShowInFiles && track.path && <SheetItem icon={Folder} label="Show in Files" onClick={() => { onShowInFiles(); onClose() }} />}
        {canEdit && songId != null && songId > 0 && (
          <SheetItem icon={Pencil} label="Edit" onClick={() => { useStore.getState().openSongEditor(songId); onClose() }} />
        )}
        {onToggleLike && (
          <SheetItem icon={Heart} label={liked ? 'Unlike' : 'Like'} active={liked} onClick={() => { onToggleLike(); onClose() }} />
        )}
        {versionsEnabled && !disableChangeVersion && songId != null && songId > 0 && (
          <SheetItem icon={Layers} label="Change version" trailing={<ChevronRight size={16} className="text-text-muted" />} onClick={() => setMobileSub('versions')} />
        )}
        {ZIP_OPERATIONS_ENABLED && song && !track.path && track.genre === 'recording_session' && (
          <>
            <SheetDivider />
            <SheetItem
              icon={PackageOpen} label={zipLoading ? 'Finding files…' : 'Download session (ZIP)'} disabled={zipLoading}
              trailing={zipLoading ? <Loader2 size={14} className="animate-spin text-text-muted" /> : undefined}
              onClick={loadSessionZips}
            />
          </>
        )}
        {track.path && !isLocalOnly && (
          <>
            <SheetDivider />
            <SheetItem icon={Download} label="Download" onClick={() => { downloadTrack(track); onClose() }} />
          </>
        )}
        {removeAction && (
          <>
            <SheetDivider />
            <SheetItem icon={Trash2} label={removeAction.label} danger onClick={() => { removeAction.onClick(); onClose() }} />
          </>
        )}
      </Sheet>
    )
  }

  return (
    <div
      ref={menuRef}
      // Height-capped to the viewport: a fully-loaded menu (queue actions +
      // playlist/version/file rows + Download/Remove) is taller than a short
      // phone screen, and the position clamp alone would leave the bottom
      // items clipped and unreachable - scroll instead.
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
              <p className="px-3 pb-1 text-[10px] text-text-muted">Multiple matches found - pick one:</p>
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
          {canShareToChat && (
            <MenuItem icon={<Share2 size={14} />} label="Share to chat" onClick={() => setShareOpen(true)} />
          )}
          {onShowInFiles && track.path && (
            <MenuItem icon={<Folder size={14} />} label="Show in Files" onClick={() => { onShowInFiles(); onClose() }} />
          )}
          {canEdit && songId != null && songId > 0 && (
            <MenuItem icon={<Pencil size={14} />} label="Edit" onClick={() => { useStore.getState().openSongEditor(songId); onClose() }} />
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
          {ZIP_OPERATIONS_ENABLED && song && !track.path && track.genre === 'recording_session' && (
            <>
              <Divider />
              <MenuItem
                icon={zipLoading ? <Loader2 size={14} className="animate-spin" /> : <PackageOpen size={14} />}
                label={zipLoading ? 'Finding files…' : 'Download session (ZIP)'}
                onClick={loadSessionZips}
              />
            </>
          )}
          {song && canLinkSessionFile && track.genre === 'recording_session' && onLinkSessionFile && (
            <>
              <Divider />
              <MenuItem icon={<FileAudio2 size={14} />} label="Link session file…" onClick={() => { onLinkSessionFile(); onClose() }} />
              {hasSessionLinkOverride && onClearSessionLink && (
                <MenuItem icon={<X size={14} />} label="Clear manual link" onClick={() => { onClearSessionLink(); onClose() }} />
              )}
            </>
          )}
          {track.path && !isLocalOnly && (
            <>
              <Divider />
              <MenuItem icon={<Download size={14} />} label="Download" onClick={() => { downloadTrack(track); onClose() }} />
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
