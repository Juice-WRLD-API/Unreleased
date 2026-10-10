import { useEffect, useState } from 'react'
import type { ComponentProps } from 'react'
import {
  Info, ListPlus, ListEnd, Plus, Folder, Pencil, Download, PackageOpen, Check, Loader2, CheckSquare2, Heart, Trash2, ListMusic, Flag, FileAudio2, Share2, X, Link2, Layers,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { useShallow } from 'zustand/react/shallow'
import * as userApi from '../lib/userApi'
import { ensureDonorUrl, isDonorStreamUrl } from '../lib/donorPlayback'
import { buildStreamUrl, findSessionZips, songToTrack, JWApiSong, JWApiFileEntry, ZIP_OPERATIONS_ENABLED } from '../lib/juicewrldApi'
import { downloadWithEmbed } from '../lib/lyricsEmbed'
import { trackShareUrl } from '../lib/platform'
import { Track } from '../types'
import ChangeVersionPanel from './ChangeVersionPanel'
import ContextMenu from './ContextMenu'
import { versionsEnabled } from '../lib/versionsApi'
import { hasChatAccess } from '../lib/chatAccess'
import { lazyOverlay } from '../lib/lazyView'

// Staff-only (it pulls in the chat store) - fetched when opened.
const ShareSongModal = lazyOverlay(() => import('./chat/ShareSongModal'))

// lucide's `fill` is a prop, not a class, so the filled variant needs to be a
// component of its own to fit an item's `icon` slot.
const HeartFilled = (p: ComponentProps<typeof Heart>): JSX.Element => <Heart {...p} fill="currentColor" />

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

  /** Session-edit file linking (Tracker only) - lets an editor/contributor
   *  manually point a recording-session song at its session-edit audio file
   *  when the automatic filename match got it wrong or found nothing. */
  canLinkSessionFile?: boolean
  hasSessionLinkOverride?: boolean
  onLinkSessionFile?: () => void
  onClearSessionLink?: () => void
}

function downloadTrack(track: Track, songId: number | null): void {
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
  // Lyrics embedding needs the file bytes, so it takes the fetch path; with the
  // setting off (or nothing to embed) this stays a plain anchor download.
  if (songId != null && useStore.getState().embedLyricsOnDownload) {
    void downloadWithEmbed(track.streamUrl ?? buildStreamUrl(track.path), `${track.title}.mp3`, track.path, songId)
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
  const { playlists, account, refreshPlaylists, setShowUserAuth, playTrack, localPlaylists, addToLocalPlaylist, createLocalPlaylist } = useStore(
    useShallow(s => ({
      playlists: s.playlists, account: s.account, refreshPlaylists: s.refreshPlaylists,
      setShowUserAuth: s.setShowUserAuth, playTrack: s.playTrack,
      localPlaylists: s.localPlaylists, addToLocalPlaylist: s.addToLocalPlaylist, createLocalPlaylist: s.createLocalPlaylist,
    }))
  )
  const { track, songId } = state
  // After "Download session (ZIP)" finds more than one candidate the menu swaps
  // to a pick-one page.
  const [zipCandidates, setZipCandidates] = useState<JWApiFileEntry[] | null>(null)
  const [zipPage, setZipPage] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [doneId, setDoneId] = useState<number | null>(null)
  const [localDoneId, setLocalDoneId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [contained, setContained] = useState<Set<number>>(new Set())
  const [zipLoading, setZipLoading] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

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
        setZipPage(true)
      }
    } catch {
      setZipCandidates([])
      setZipPage(true)
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

  const handleCopyLink = async (): Promise<void> => {
    if (!hasValidSong) return
    try {
      await navigator.clipboard.writeText(trackShareUrl(songId))
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2500)
    } catch {}
  }
  // Sessions/unsurfaced are treated as unplayable - don't offer Play / Play
  // next / Add to queue for them (they'd never actually play). Local files
  // (no category in genre) stay playable as long as they have a path.
  const canQueue = !!track.path && !isUnplayable

  if (shareOpen && canShareToChat) {
    return <ShareSongModal track={track} songId={songId as number} onClose={onClose} />
  }

  // "Add to playlist" second level: the account's playlists, or the device-local
  // ones for a local-only file.
  const playlistRows = isLocalOnly
    ? localPlaylists.map(p => ({
        label: p.name,
        icon: ListMusic,
        checked: p.trackIds.includes(track.id) || localDoneId === p.id,
        keepOpen: true,
        onSelect: () => { addToLocalPlaylist(p.id, track.id); setLocalDoneId(p.id) },
      }))
    : !account
      ? []
      : playlists.map(p => ({
          label: p.name,
          icon: ListMusic,
          checked: contained.has(p.id) || doneId === p.id,
          loading: busyId === p.id,
          disabled: busyId === p.id,
          keepOpen: true,
          onSelect: () => { void addTo(p.id) },
        }))

  const playlistFooter = !isLocalOnly && !account
    ? (
      <button
        onClick={() => { setShowUserAuth(true); onClose() }}
        className="w-full py-1.5 rounded-lg bg-accent/15 text-accent text-xs font-semibold"
      >
        Log in
      </button>
    )
    : creating
      ? (
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
      )
      : (
        <button
          onClick={() => setCreating(true)}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-accent hover:bg-surface-overlay rounded transition-colors"
        >
          <Plus size={12} /> New playlist
        </button>
      )

  const showZip = ZIP_OPERATIONS_ENABLED && !!song && !track.path && track.genre === 'recording_session'
  const showSessionLink = !!song && !!canLinkSessionFile && track.genre === 'recording_session' && !!onLinkSessionFile
  const canDownload = !!track.path && !isLocalOnly

  return (
    <ContextMenu
      x={state.x}
      y={state.y}
      title={track.title}
      subtitle={track.artist}
      onClose={onClose}
      // Above every view's own chrome - this menu opens from the Player bar and
      // fullscreen WRLD as well as ordinary pages.
      zIndex={9999}
      className="w-52"
      page={zipPage ? {
        title: 'Download session',
        onBack: () => setZipPage(false),
        note: zipCandidates && zipCandidates.length > 0 ? 'Multiple matches found - pick one:' : undefined,
        empty: 'No matching ZIP found for this session.',
        items: (zipCandidates ?? []).map(c => ({ label: c.name, icon: PackageOpen, onSelect: () => downloadZipEntry(c) })),
      } : null}
      items={[
        onPlay && canQueue && { icon: ListEnd, label: 'Play', onSelect: onPlay },
        onPlayNext && canQueue && { icon: ListEnd, label: 'Play next', onSelect: onPlayNext },
        hasValidSong && { icon: Info, label: 'Song info', onSelect: onInfo },
        hasValidSong && {
          icon: Flag,
          label: 'Report issue',
          onSelect: () => useStore.getState().openReport({ kind: 'song', songId: songId as number, songName: track.apiTitle || track.title }),
        },
        onSelect && { icon: CheckSquare2, label: 'Select', onSelect },
        onAddToQueue && canQueue && { icon: ListPlus, label: 'Add to queue', onSelect: onAddToQueue },
        canAddToPlaylist && {
          icon: Plus,
          label: 'Add to playlist',
          children: playlistRows,
          childrenEmpty: !isLocalOnly && !account ? 'Log in to save to playlists.' : 'No playlists yet.',
          childrenFooter: playlistFooter,
        },
        canShareToChat && { icon: Share2, label: 'Share to chat', keepOpen: true, onSelect: () => setShareOpen(true) },
        hasValidSong && { icon: linkCopied ? Check : Link2, label: linkCopied ? 'Link copied' : 'Copy link', keepOpen: true, onSelect: handleCopyLink },
        onShowInFiles && !!track.path && { icon: Folder, label: 'Show in Files', onSelect: onShowInFiles },
        canEdit && hasValidSong && { icon: Pencil, label: 'Edit', onSelect: () => useStore.getState().openSongEditor(songId as number) },
        onToggleLike && { icon: liked ? HeartFilled : Heart, label: liked ? 'Unlike' : 'Like', active: liked, onSelect: onToggleLike },
        versionsEnabled && !disableChangeVersion && hasValidSong && {
          icon: Layers,
          label: 'Change version',
          panel: ({ close, mobile }) => (
            <ChangeVersionPanel
              songId={songId as number}
              mobile={mobile}
              onChangeVersion={(s) => { const t = songToTrack(s); playTrack(t, [t]); close() }}
            />
          ),
        },
        showZip && 'divider',
        showZip && {
          icon: PackageOpen,
          label: zipLoading ? 'Finding files…' : 'Download session (ZIP)',
          loading: zipLoading,
          disabled: zipLoading,
          keepOpen: true,
          onSelect: loadSessionZips,
        },
        showSessionLink && 'divider',
        showSessionLink && { icon: FileAudio2, label: 'Link session file…', onSelect: onLinkSessionFile },
        showSessionLink && !!hasSessionLinkOverride && !!onClearSessionLink && { icon: X, label: 'Clear manual link', onSelect: onClearSessionLink },
        canDownload && 'divider',
        canDownload && { icon: Download, label: 'Download', onSelect: () => downloadTrack(track, state.songId) },
        removeAction && 'divider',
        removeAction && { icon: Trash2, label: removeAction.label, danger: true, onSelect: removeAction.onClick },
      ]}
    />
  )
}
