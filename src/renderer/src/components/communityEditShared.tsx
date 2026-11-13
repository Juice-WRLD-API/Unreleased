import { useEffect, useState } from 'react'
import { Clock, FolderOpen, Loader2, Music2, Play } from 'lucide-react'
import { useStore } from '../store/useStore'
import { buildImageUrl } from '../lib/juicewrldApi'
import { fetchCommunityEditAudio, type CommunityEdit, type CommunityEditMatch } from '../lib/communityEditsApi'
import { errorMessage } from '../lib/format'
import { openInFiles } from './SongContextMenu'

const folderOf = (path: string): string => path.split('/').slice(0, -1).join('/')

/** Sends the user to what an upload matched: its folder in Files, or the song.
 *  Returns false for a pending edit, which has nowhere to open. */
export function openCommunityEditMatch(match: CommunityEditMatch): boolean {
  if (match.target === 'file') {
    openInFiles({ folder: folderOf(match.path), channel: match.channel })
    return true
  }
  if (match.target === 'song') {
    useStore.getState().setInfoSongId(match.song.id)
    return true
  }
  return false
}

/** What the server already has, with a way there. Shown in place of the form. */
export function MatchCard({ match, message, onOpened }: {
  match: CommunityEditMatch
  message: string
  onOpened: () => void
}): JSX.Element {
  const where = match.target === 'file' ? match.path : match.target === 'song' ? match.song.name : match.title ?? null
  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3.5 space-y-2.5">
      <p className="text-sm font-semibold text-text-primary">We already have this</p>
      <p className="text-xs text-text-secondary leading-relaxed">{message}</p>
      {where && (
        <p className="flex items-center gap-1.5 text-[11px] text-text-muted min-w-0">
          {match.target === 'song' ? <Music2 size={11} className="shrink-0" /> : match.target === 'file' ? <FolderOpen size={11} className="shrink-0" /> : <Clock size={11} className="shrink-0" />}
          <span className="truncate">{where}</span>
        </p>
      )}
      {match.target === 'pending' ? (
        <p className="text-[11px] text-text-muted">
          {match.mine
            ? 'You sent this one in already. It is in Settings → Account → My remixes & edits.'
            : 'Someone sent it in already. It shows up in Files once a manager approves it.'}
        </p>
      ) : (
        <button
          onClick={() => { if (openCommunityEditMatch(match)) onOpened() }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
        >
          {match.target === 'file' ? <><FolderOpen size={12} /> Open in Files</> : <><Music2 size={12} /> Show the song</>}
        </button>
      )}
    </div>
  )
}

export const formatLength = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds))
  const m = Math.floor(total / 60)
  return `${m}:${String(total % 60).padStart(2, '0')}`
}

/** Plays a submission. Approved ones stream from their public URL; anything
 *  else needs the token, so it is fetched once and played from a blob. */
export function CommunityEditPlayer({ edit }: { edit: Pick<CommunityEdit, 'id' | 'status' | 'audio_url'> }): JSX.Element {
  const publicUrl = edit.status === 'approved' ? buildImageUrl(edit.audio_url) ?? null : null
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A new submission starts from the Load button again.
  useEffect(() => { setBlobUrl(null); setError(null) }, [edit.id])
  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl) }, [blobUrl])

  const load = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setBlobUrl(URL.createObjectURL(await fetchCommunityEditAudio(edit.id)))
    } catch (e) {
      setError(errorMessage(e, 'Could not load the audio'))
    } finally {
      setLoading(false)
    }
  }

  const src = publicUrl ?? blobUrl
  if (src) return <audio key={src} src={src} controls preload="metadata" className="w-full h-9" />
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => void load()} disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-surface-overlay px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-60">
        {loading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Listen
      </button>
      {error && <span className="text-[11px] text-red-400">{error}</span>}
    </div>
  )
}
