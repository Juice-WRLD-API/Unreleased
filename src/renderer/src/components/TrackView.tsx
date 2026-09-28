import { useEffect, useState } from 'react'
import { Play, Loader2, Music2, ChevronLeft, Share2, Download, Check } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { getSongById, songToTrack, buildStreamUrl, CATEGORY_LABELS, JWApiSong } from '../lib/juicewrldApi'
import { trackShareUrl } from '../lib/platform'
import { formatDuration } from '../lib/format'
import { AlbumArtThumbnail } from './AlbumArtThumbnail'

// Public track page - a real, shareable URL for a single song (unlike an
// in-app chat share card, which only ever renders inside this app). Fetched
// by internal song id, the same id every other surface already fetches
// `/songs/{id}/` with (see juicewrldApi.ts) - no separate public identifier
// needed. See seo.ts (noindex - one URL per song is a lot of near-duplicate
// pages, not worth it in Google) and server/social-preview.mjs (per-track
// Discord/Twitter unfurl - that service re-fetches the same song server-side
// since this component's tags only ever reach a JS-executing visitor).
function trackIdFromPath(pathname: string): number | null {
  const m = pathname.match(/^\/track\/(\d+)\/?$/)
  return m ? Number(m[1]) : null
}

export default function TrackView(): JSX.Element {
  const { playTrack, setActiveView } = useStorePick('playTrack', 'setActiveView')
  // Read once on mount: TrackView stays mounted behind WRLD while the URL
  // moves to /wrld, so re-deriving this per render would lose the id.
  const [songId] = useState(() => trackIdFromPath(window.location.pathname))

  const [song, setSong] = useState<JWApiSong | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (songId == null) { setError(true); setLoading(false); return }
    let cancelled = false
    getSongById(songId)
      .then((s) => { if (!cancelled) setSong(s) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [songId])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-text-muted" />
      </div>
    )
  }

  if (error || !song || songId == null) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-muted">
        <Music2 size={40} className="opacity-20" />
        <p className="text-sm">Track not found.</p>
        <button
          onClick={() => setActiveView('api-tracker')}
          className="flex items-center gap-1.5 text-text-muted hover:text-text-primary text-sm transition-colors mt-1"
        >
          <ChevronLeft size={15} /> Back to app
        </button>
      </div>
    )
  }

  const track = songToTrack(song)
  const duration = formatDuration(track.duration)
  const categoryLabel = CATEGORY_LABELS[song.category] ?? song.category
  // Same rule as SongContextMenu's isUnplayable - unsurfaced songs and
  // pathless sessions have no audio to play or download.
  const isUnplayable = song.category === 'unsurfaced' || (song.category === 'recording_session' && !track.path)
  const canPlay = !!track.path && !isUnplayable

  const handleShare = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(trackShareUrl(songId))
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {}
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto px-5 py-6">
      <button
        onClick={() => setActiveView('api-tracker')}
        className="flex items-center gap-1.5 self-start text-text-muted hover:text-text-primary text-sm transition-colors mb-4"
      >
        <ChevronLeft size={15} /> Back to app
      </button>

      <div className="flex items-center gap-4 mb-6">
        <div className="w-24 h-24 rounded-xl overflow-hidden bg-surface-overlay shrink-0">
          <AlbumArtThumbnail track={track} fill className="w-full h-full" />
        </div>
        <div className="min-w-0">
          <p className="text-text-muted text-xs uppercase tracking-widest font-semibold mb-1">{categoryLabel}</p>
          <h1 className="text-text-primary text-2xl font-bold truncate" title={track.title}>{track.title}</h1>
          <p className="text-text-muted text-sm truncate">{track.artist}{song.era?.name ? ` · ${song.era.name}` : ''}{duration !== '0:00' ? ` · ${duration}` : ''}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        {canPlay && (
          <button
            onClick={() => playTrack(track, [track])}
            className="flex items-center gap-2 px-6 py-3 rounded-full bg-accent text-black text-sm font-bold hover:scale-105 active:scale-95 transition-transform shadow-lg"
          >
            <Play size={17} fill="currentColor" /> Play
          </button>
        )}
        <button
          onClick={handleShare}
          className="flex items-center gap-2 px-4 py-3 rounded-full bg-surface-overlay text-text-primary text-sm font-semibold hover:bg-surface-raised transition-colors"
        >
          {copied ? <Check size={15} /> : <Share2 size={15} />} {copied ? 'Copied' : 'Copy link'}
        </button>
        {canPlay && (
          <a
            href={track.streamUrl ?? buildStreamUrl(track.path)}
            download={`${track.title}.mp3`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-3 rounded-full bg-surface-overlay text-text-primary text-sm font-semibold hover:bg-surface-raised transition-colors"
          >
            <Download size={15} /> Download
          </a>
        )}
      </div>

      {(song.album || song.producers || song.engineers) && (
        <div className="space-y-2 text-sm">
          {song.album && <p><span className="text-text-muted">Album: </span><span className="text-text-primary">{song.album}</span></p>}
          {song.producers && <p><span className="text-text-muted">Producers: </span><span className="text-text-primary">{song.producers}</span></p>}
          {song.engineers && <p><span className="text-text-muted">Engineers: </span><span className="text-text-primary">{song.engineers}</span></p>}
        </div>
      )}
    </div>
  )
}
