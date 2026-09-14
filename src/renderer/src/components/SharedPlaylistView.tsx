import { useEffect, useState } from 'react'
import { Play, Loader2, Music2, Share2, Download, ChevronLeft } from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import { apiFetch, buildStreamUrl, buildCoverArtUrl } from '../lib/juicewrldApi'
import { liteSongToTrack, ApiSongLite } from '../lib/userApi'
import { Track } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObject = Record<string, any>

function pathToTrack(path: string): Track {
  return {
    id: `shared-${path}`,
    path,
    streamUrl: buildStreamUrl(path),
    imageUrl: buildCoverArtUrl(path),
    title: path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? path,
    artist: 'Juice WRLD',
    album: 'Shared Playlist',
    albumArtist: 'Juice WRLD',
    year: null,
    trackNumber: null,
    duration: 0,
    genre: '',
    hasAlbumArt: true,
  }
}

/** Returns true if an object looks like a full ApiSongLite (has id + name + path). */
function isApiSongLite(obj: AnyObject): obj is ApiSongLite {
  return typeof obj === 'object' && obj !== null && 'id' in obj && 'name' in obj && 'path' in obj
}

/** Convert whatever the API returns into a Track array. */
function parseTracks(data: unknown): Track[] {
  if (!data) return []

  // Plain array
  if (Array.isArray(data)) {
    if (data.length === 0) return []
    const first = data[0]
    if (typeof first === 'string') return (data as string[]).filter(Boolean).map(pathToTrack)
    if (isApiSongLite(first)) return (data as ApiSongLite[]).map(liteSongToTrack)
    // Array of objects with path
    return (data as AnyObject[]).map(s => {
      const path = (s.path ?? s.file_path ?? s.url ?? '') as string
      return path ? pathToTrack(path) : null
    }).filter(Boolean) as Track[]
  }

  const obj = data as AnyObject
  // Named candidate fields - try recursively to handle any nesting
  const ARRAY_KEYS = ['songs', 'items', 'tracks', 'results', 'playlist_songs', 'song_list', 'files', 'entries']
  for (const key of ARRAY_KEYS) {
    const list = obj[key]
    if (!Array.isArray(list) || list.length === 0) continue
    const first = list[0]
    if (isApiSongLite(first)) return (list as ApiSongLite[]).map(liteSongToTrack)
    if (first && typeof first === 'object' && 'song' in first && isApiSongLite((first as AnyObject).song)) {
      return list.map((i: AnyObject) => liteSongToTrack(i.song as ApiSongLite))
    }
    const byPath = (list as AnyObject[]).flatMap((s: AnyObject) => {
      const p = (s.path ?? s.file_path ?? s.url ?? '') as string
      return p ? [pathToTrack(p)] : []
    })
    if (byPath.length) return byPath
  }

  // data field (object or array)
  if (obj.data && typeof obj.data === 'object') {
    const dataParsed = parseTracks(obj.data)
    if (dataParsed.length) return dataParsed
  }

  // playlist field - API wraps songs in { playlist: { songs: [...] } }
  if (obj.playlist && typeof obj.playlist === 'object') {
    const playlistParsed = parseTracks(obj.playlist)
    if (playlistParsed.length) return playlistParsed
  }

  // paths field (strings or song objects)
  if (Array.isArray(obj.paths) && obj.paths.length > 0) {
    if (typeof obj.paths[0] === 'string') return (obj.paths as string[]).filter(Boolean).map(pathToTrack)
    const pathsParsed = parseTracks(obj.paths)
    if (pathsParsed.length) return pathsParsed
  }

  // Deep scan: any other array field
  for (const key of Object.keys(obj)) {
    if ([...ARRAY_KEYS, 'data', 'paths'].includes(key)) continue
    const val = obj[key]
    if (!Array.isArray(val) || val.length === 0) continue
    const deep = parseTracks(val)
    if (deep.length) return deep
  }

  return []
}

export default function SharedPlaylistView(): JSX.Element {
  const { playTrack, playCollection, setActiveView } = useStorePick('playTrack', 'playCollection', 'setActiveView')
  const shareId = window.location.pathname.split('/shared/')[1]?.split('/')[0] ?? ''

  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [imgErrors, setImgErrors] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!shareId) { setError(true); setLoading(false); return }
    apiFetch<unknown>(`/playlists/shared/${shareId}/`)
      .then(data => {
        const parsed = parseTracks(data)
        setTracks(parsed)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [shareId])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-text-muted" />
      </div>
    )
  }

  if (error || !shareId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-muted">
        <Music2 size={40} className="opacity-20" />
        <p className="text-sm">Shared playlist not found or expired.</p>
        <button
          onClick={() => setActiveView('wrld')}
          className="flex items-center gap-1.5 text-text-muted hover:text-text-primary text-sm transition-colors mt-1"
        >
          <ChevronLeft size={15} /> Back to app
        </button>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto px-5 py-6">
      {/* Header */}
      <button
        onClick={() => setActiveView('wrld')}
        className="flex items-center gap-1.5 self-start text-text-muted hover:text-text-primary text-sm transition-colors mb-4"
      >
        <ChevronLeft size={15} /> Back to app
      </button>
      <div className="flex items-center gap-4 mb-6">
        <div className="w-16 h-16 rounded-xl bg-accent/15 flex items-center justify-center shrink-0">
          <Share2 size={28} className="text-accent" />
        </div>
        <div>
          <p className="text-text-muted text-xs uppercase tracking-widest font-semibold mb-1">Shared playlist</p>
          <h1 className="text-text-primary text-2xl font-bold">Shared Playlist</h1>
          <p className="text-text-muted text-sm">{tracks.length} tracks</p>
        </div>
      </div>

      {/* Play button */}
      {tracks.length > 0 && (
        <div className="flex gap-3 mb-6">
          <button
            onClick={() => playCollection(tracks)}
            className="flex items-center gap-2 px-6 py-3 rounded-full bg-accent text-black text-sm font-bold hover:scale-105 active:scale-95 transition-transform shadow-lg"
          >
            <Play size={17} fill="currentColor" /> Play all
          </button>
        </div>
      )}

      {/* Track list */}
      <div className="space-y-0.5">
        {tracks.map((t, i) => (
          <div
            key={t.id}
            className="group flex items-center gap-3 px-3 py-2.5 hover:bg-surface-overlay rounded-lg cursor-pointer transition-colors"
            onClick={() => playTrack(t, tracks)}
          >
            <span className="text-text-muted text-xs w-6 text-right tabular-nums shrink-0">{i + 1}</span>
            <div className="relative w-9 h-9 rounded-lg overflow-hidden bg-surface-overlay shrink-0 flex items-center justify-center">
              {!imgErrors.has(t.id) && (t.imageUrl || t.hasAlbumArt) ? (
                <img
                  src={t.imageUrl ?? ''}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={() => setImgErrors(prev => new Set([...prev, t.id]))}
                />
              ) : (
                <Music2 size={14} className="text-text-muted opacity-40" />
              )}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <Play size={12} fill="white" className="text-white ml-0.5" />
              </div>
            </div>
            <span className="text-text-primary text-sm flex-1 truncate" title={t.title}>{t.title}</span>
            <a
              href={buildStreamUrl(t.path)}
              download={`${t.title}.mp3`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-raised transition-all hidden md:flex"
              title="Download"
            >
              <Download size={14} />
            </a>
          </div>
        ))}
      </div>

      {tracks.length === 0 && (
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-text-muted">
          <Music2 size={40} className="opacity-20" />
          <p className="text-sm">This shared playlist is empty.</p>
        </div>
      )}
    </div>
  )
}
