import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import {
  Plus, Trash2, Save, Check, X, Search, Loader2, ChevronLeft, ChevronUp, ChevronDown,
  Music, Shield, AlertCircle,
} from 'lucide-react'
import { apiFetch, buildImageUrl, loadAllSongs } from '../lib/juicewrldApi'
import type { JWApiSong } from '../lib/juicewrldApi'
import * as albumsApi from '../lib/albumsApi'
import type { Album, Artist, AlbumSongEntry } from '../lib/albumsApi'
import { useStorePick } from '../store/useStore'
import { errorMessage } from '../lib/format'

// Admin UI for the real Album catalog (GET/POST/PATCH/DELETE
// /accounts/admin/albums/), replacing the old client-side wrlddata.json
// editor. That JSON let one album carry several "editions" (Standard/Deluxe),
// each with its own cover and tracklist - the backend album object has no
// such concept, just one release_date and one flat songs[] tracklist. This
// view (and the public Wrld page reading /albums/) both work against that
// simpler flat shape now.

// ── Song path → metadata lookup ─────────────────────────────────────────────

/** Resolves a track's display name/art from its stored file path, using the
 *  same whole-catalog fetch (?all=true) the versions table uses - the album
 *  API only stores {order, path}, not full song metadata. */
function usePathIndex(): Map<string, JWApiSong> {
  const [songs, setSongs] = useState<JWApiSong[]>([])
  useEffect(() => { loadAllSongs().then(setSongs).catch(() => {}) }, [])
  return useMemo(() => new Map(songs.filter(s => s.path).map(s => [s.path as string, s])), [songs])
}

function trackLabel(path: string, song: JWApiSong | undefined): string {
  if (song) return song.name
  const base = path.split('/').pop() ?? path
  return base.replace(/\.[^.]+$/, '')
}

// ── Song search autocomplete ───────────────────────────────────────────────

function SongSearch({ onPick, onClose }: { onPick: (s: JWApiSong) => void; onClose: () => void }): JSX.Element {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<JWApiSong[]>([])
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (!q.trim()) { setResults([]); return }
    setLoading(true)
    timer.current = setTimeout(async () => {
      try {
        const d = await apiFetch<{ results: JWApiSong[] }>('/songs/', { search: q, page_size: 8 })
        setResults((d.results ?? []).filter(s => s.path))
      } catch { setResults([]) }
      setLoading(false)
    }, 320)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [q])

  return (
    <div className="flex flex-col gap-2 animate-fade-in">
      <div className="flex items-center gap-2 bg-[var(--surface-overlay)] border border-[var(--border)] rounded-xl px-3 py-2">
        <Search size={13} className="text-[var(--text-muted)] shrink-0" />
        <input
          ref={inputRef}
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') onClose() }}
          placeholder="Search songs by name…"
          className="flex-1 bg-transparent text-sm text-[var(--text-primary)] focus:outline-none placeholder:text-[var(--text-muted)]"
        />
        {loading
          ? <Loader2 size={13} className="animate-spin text-[var(--text-muted)] shrink-0" />
          : <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"><X size={13} /></button>
        }
      </div>

      {results.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] overflow-hidden bg-[var(--surface-raised)] shadow-lg">
          {results.map((s, i) => (
            <button
              key={s.id}
              onClick={() => { onPick(s); onClose() }}
              className={`w-full text-left px-4 py-2.5 hover:bg-[var(--surface-overlay)] transition-colors flex items-center gap-3 ${i > 0 ? 'border-t border-[var(--border)]' : ''}`}
            >
              <div className="w-7 h-7 rounded-md bg-[var(--surface-overlay)] flex items-center justify-center shrink-0 overflow-hidden">
                {buildImageUrl(s.image_url)
                  ? <img src={buildImageUrl(s.image_url)} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  : <Music size={12} className="text-[var(--text-muted)]" />
                }
              </div>
              <div className="min-w-0">
                <p className="text-sm text-[var(--text-primary)] truncate font-medium">{s.name}</p>
                <p className="text-xs text-[var(--text-muted)] truncate">{s.credited_artists} · ID {s.id}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Album grid card ───────────────────────────────────────────────────────────

function AlbumCard({ album, coverUrl, onClick, onDelete }: {
  album: Album
  coverUrl: string | undefined
  onClick: () => void
  onDelete: () => void
}): JSX.Element {
  const [imgError, setImgError] = useState(false)

  return (
    <div className="group/card flex flex-col gap-2 animate-fade-in">
      <button
        onClick={onClick}
        className="relative w-full aspect-square rounded-2xl overflow-hidden bg-[var(--surface-overlay)] shadow-sm hover:shadow-xl transition-all duration-300 ring-1 ring-black/5 dark:ring-white/5 hover:scale-[1.02]"
      >
        {coverUrl && !imgError ? (
          <img src={coverUrl} alt={album.title} className="w-full h-full object-cover" onError={() => setImgError(true)} />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Music size={32} className="text-[var(--text-muted)] opacity-30" />
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover/card:bg-black/30 transition-colors duration-200 flex items-end p-3">
          <div className="opacity-0 group-hover/card:opacity-100 transition-opacity duration-200 translate-y-1 group-hover/card:translate-y-0 transition-transform">
            <ChevronLeft size={14} className="text-white rotate-180" />
          </div>
        </div>
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 backdrop-blur-sm text-white/70 hover:text-white hover:bg-red-500/80 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-all duration-150"
        >
          <X size={11} />
        </button>
      </button>

      <div className="px-0.5">
        <p className="text-sm font-semibold text-[var(--text-primary)] leading-snug line-clamp-2">{album.title}</p>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          {album.artist?.name ?? 'Unknown artist'} · {album.release_date?.slice(0, 4) ?? '—'}
        </p>
      </div>
    </div>
  )
}

// ── Create panel ──────────────────────────────────────────────────────────────

function CreatePanel({ artists, onCreated }: { artists: Artist[]; onCreated: (a: Album) => void }): JSX.Element {
  const [title, setTitle] = useState('')
  const [artistId, setArtistId] = useState<string>(artists[0] ? String(artists[0].id) : '')
  const [releaseDate, setReleaseDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (!artistId && artists[0]) setArtistId(String(artists[0].id)) }, [artists, artistId])

  const submit = async (): Promise<void> => {
    if (!title.trim() || !artistId || !releaseDate || busy) return
    setBusy(true)
    setError(null)
    try {
      const album = await albumsApi.adminCreateAlbum({
        title: title.trim(),
        artist_id: Number(artistId),
        release_date: releaseDate,
      })
      setTitle('')
      setReleaseDate('')
      onCreated(album)
    } catch (e) {
      setError(errorMessage(e, 'Could not create the album'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border-2 border-dashed border-[var(--border)] p-4 space-y-3 flex flex-col justify-center">
      <p className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2"><Plus size={14} /> New album</p>
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Title"
        className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]/40"
      />
      <select
        value={artistId}
        onChange={e => setArtistId(e.target.value)}
        className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]/40"
      >
        <option value="" disabled>Artist…</option>
        {artists.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <input
        type="date"
        value={releaseDate}
        onChange={e => setReleaseDate(e.target.value)}
        className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]/40"
      />
      {error && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertCircle size={12} />{error}</p>}
      <button
        onClick={submit}
        disabled={busy || !title.trim() || !artistId || !releaseDate}
        className="px-3 py-2 rounded-xl bg-[var(--accent)] text-white text-xs font-semibold disabled:opacity-40 flex items-center gap-1.5 justify-center"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
        Create album
      </button>
    </div>
  )
}

// ── Album detail / edit view ───────────────────────────────────────────────────

function AlbumDetail({ album, artists, pathIndex, onBack, onSaved, onDeleted }: {
  album: Album
  artists: Artist[]
  pathIndex: Map<string, JWApiSong>
  onBack: () => void
  onSaved: (a: Album) => void
  onDeleted: () => void
}): JSX.Element {
  const [title, setTitle] = useState(album.title)
  const [type, setType] = useState(album.type ?? '')
  const [artistId, setArtistId] = useState(String(album.artist?.id ?? ''))
  const [releaseDate, setReleaseDate] = useState(album.release_date ?? '')
  const [description, setDescription] = useState(album.description ?? '')
  const [playCount, setPlayCount] = useState(String(album.play_count ?? 0))
  const [songs, setSongs] = useState<AlbumSongEntry[]>([...album.songs].sort((a, b) => a.order - b.order))
  const [addingSong, setAddingSong] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imgError, setImgError] = useState(false)

  useEffect(() => {
    setTitle(album.title)
    setType(album.type ?? '')
    setArtistId(String(album.artist?.id ?? ''))
    setReleaseDate(album.release_date ?? '')
    setDescription(album.description ?? '')
    setPlayCount(String(album.play_count ?? 0))
    setSongs([...album.songs].sort((a, b) => a.order - b.order))
    setError(null)
  }, [album])

  const initialSongsKey = useMemo(() => [...album.songs].sort((a, b) => a.order - b.order).map(s => s.path).join('|'), [album])
  const dirty = title !== album.title || type !== (album.type ?? '') || artistId !== String(album.artist?.id ?? '')
    || releaseDate !== (album.release_date ?? '') || description !== (album.description ?? '')
    || playCount !== String(album.play_count ?? 0) || songs.map(s => s.path).join('|') !== initialSongsKey

  const coverPath = songs[0]?.path
  const coverSong = coverPath ? pathIndex.get(coverPath) : undefined
  const coverUrl = buildImageUrl(coverSong?.image_url)

  const moveSong = (i: number, dir: -1 | 1): void => {
    const j = i + dir
    if (j < 0 || j >= songs.length) return
    const next = [...songs]
    ;[next[i], next[j]] = [next[j], next[i]]
    setSongs(next)
  }

  const removeSong = (i: number): void => setSongs(songs.filter((_, j) => j !== i))
  const addSong = (s: JWApiSong): void => {
    if (!s.path) return
    setSongs(prev => [...prev, { order: prev.length + 1, path: s.path as string }])
  }

  const save = async (): Promise<void> => {
    if (!title.trim() || !artistId || !releaseDate || busy) return
    setBusy(true)
    setError(null)
    try {
      const updated = await albumsApi.adminUpdateAlbum(album.id, {
        title: title.trim(),
        type: type.trim(),
        artist_id: Number(artistId),
        release_date: releaseDate,
        description,
        play_count: Number(playCount) || 0,
        songs: songs.map((s, i) => ({ order: i + 1, path: s.path })),
      })
      onSaved(updated)
    } catch (e) {
      setError(errorMessage(e, 'Could not save changes'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!confirm(`Delete "${album.title}"? This can't be undone.`)) return
    setDeleting(true)
    setError(null)
    try {
      await albumsApi.adminDeleteAlbum(album.id)
      onDeleted()
    } catch (e) {
      setError(errorMessage(e, 'Could not delete this album'))
      setDeleting(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden animate-fade-in">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--border)] shrink-0">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          <ChevronLeft size={16} /> Albums
        </button>
        <div className="flex-1" />
        <button
          onClick={remove}
          disabled={deleting}
          className="px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-semibold flex items-center gap-1.5 border border-red-500/20 disabled:opacity-40"
        >
          {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          Delete
        </button>
        <button
          onClick={save}
          disabled={busy || !dirty || !title.trim() || !artistId || !releaseDate}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 ${
            dirty ? 'bg-[var(--accent)]/15 hover:bg-[var(--accent)]/25 text-[var(--accent)]' : 'bg-[var(--surface-overlay)] text-[var(--text-muted)]'
          }`}
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          Save
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col md:flex-row gap-6 md:gap-8 px-6 md:px-8 pt-8 pb-6">
          <div className="shrink-0 w-40 md:w-52 aspect-square rounded-2xl overflow-hidden shadow-2xl ring-1 ring-black/10 dark:ring-white/10 self-center md:self-start bg-[var(--surface-overlay)]">
            {coverUrl && !imgError ? (
              <img src={coverUrl} alt={title} className="w-full h-full object-cover" onError={() => setImgError(true)} />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Music size={40} className="text-[var(--text-muted)] opacity-30" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0 flex flex-col gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1 block">Title</label>
              <input value={title} onChange={e => setTitle(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-overlay)] px-3 py-2 text-lg font-bold text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]/40" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1 block">Artist</label>
                <select value={artistId} onChange={e => setArtistId(e.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]/40">
                  {artists.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1 block">Type</label>
                <input value={type} onChange={e => setType(e.target.value)} placeholder="Album / EP / Single"
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]/40" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1 block">Release date</label>
                <input type="date" value={releaseDate} onChange={e => setReleaseDate(e.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]/40" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1 block">Play count</label>
                <input type="number" value={playCount} onChange={e => setPlayCount(e.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] tabular-nums focus:outline-none focus:border-[var(--accent)]/40" />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1 block">Description</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="Optional"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] resize-none focus:outline-none focus:border-[var(--accent)]/40" />
            </div>
            {error && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertCircle size={12} />{error}</p>}
          </div>
        </div>

        {/* Track list */}
        <div className="px-6 md:px-8 pb-10">
          <div className="flex items-center gap-4 px-3 pb-2 mb-1 border-b border-[var(--border)]">
            <span className="w-6 text-right text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">#</span>
            <span className="flex-1 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Title</span>
            <span className="w-16" />
          </div>

          <div className="flex flex-col">
            {songs.map((s, i) => (
              <div key={`${s.path}-${i}`} className="group/row flex items-center gap-4 px-3 py-2 rounded-xl hover:bg-[var(--surface-overlay)] transition-colors">
                <span className="w-6 text-right text-sm text-[var(--text-muted)] tabular-nums shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--text-primary)] truncate">{trackLabel(s.path, pathIndex.get(s.path))}</p>
                  {!pathIndex.get(s.path) && <p className="text-[10px] text-[var(--text-muted)] truncate font-mono">{s.path}</p>}
                </div>
                <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity">
                  <button onClick={() => moveSong(i, -1)} disabled={i === 0} className="w-6 h-6 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center justify-center disabled:opacity-30"><ChevronUp size={13} /></button>
                  <button onClick={() => moveSong(i, 1)} disabled={i === songs.length - 1} className="w-6 h-6 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center justify-center disabled:opacity-30"><ChevronDown size={13} /></button>
                  <button onClick={() => removeSong(i)} className="w-6 h-6 rounded-md text-[var(--text-muted)] hover:text-red-400 hover:bg-red-400/10 flex items-center justify-center"><X size={13} /></button>
                </div>
              </div>
            ))}
          </div>

          {addingSong ? (
            <div className="mt-3 px-3">
              <SongSearch onPick={addSong} onClose={() => setAddingSong(false)} />
            </div>
          ) : (
            <button onClick={() => setAddingSong(true)}
              className="mt-3 ml-3 flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">
              <Plus size={14} /> Add song
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AlbumsAdminView(): JSX.Element {
  const { account, setActiveView, setActiveAdminTab } = useStorePick('account', 'setActiveView', 'setActiveAdminTab')
  const isAdmin = !!account?.is_administrator
  const otpEnabled = !!account?.otp_enabled
  const pathIndex = usePathIndex()

  const [albums, setAlbums] = useState<Album[]>([])
  const [artists, setArtists] = useState<Artist[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const reload = useCallback(() => {
    if (!isAdmin || !otpEnabled) return
    setLoading(true)
    setError(null)
    Promise.all([albumsApi.adminFetchAlbums(), albumsApi.fetchArtists()])
      .then(([al, ar]) => {
        setAlbums(al)
        setArtists(ar)
        setSelectedId(prev => (prev != null && al.some(a => a.id === prev) ? prev : null))
      })
      .catch(e => setError(errorMessage(e, 'Failed to load albums')))
      .finally(() => setLoading(false))
  }, [isAdmin, otpEnabled])

  useEffect(() => { reload() }, [reload])

  if (!isAdmin) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
      <Shield size={28} className="text-text-muted" />
      <p className="text-text-primary font-semibold text-sm">Administrator access required</p>
      <button onClick={() => setActiveView('api-tracker')} className="text-xs text-accent hover:underline">Go back</button>
    </div>
  )

  if (!otpEnabled) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
      <Shield size={28} className="text-text-muted" />
      <p className="text-text-primary font-semibold text-sm">Two-factor authentication required</p>
      <p className="text-xs text-text-muted max-w-xs">Album management needs 2FA enabled on your account. Set it up from Admin → Security.</p>
      <button
        onClick={() => { setActiveAdminTab('security'); setActiveView('admin') }}
        className="text-xs text-accent hover:underline"
      >Go to Security</button>
    </div>
  )

  const selectedAlbum = selectedId !== null ? albums.find(a => a.id === selectedId) ?? null : null

  if (selectedAlbum) {
    return (
      <AlbumDetail
        key={selectedAlbum.id}
        album={selectedAlbum}
        artists={artists}
        pathIndex={pathIndex}
        onBack={() => setSelectedId(null)}
        onSaved={updated => setAlbums(prev => prev.map(a => a.id === updated.id ? updated : a))}
        onDeleted={() => { setAlbums(prev => prev.filter(a => a.id !== selectedAlbum.id)); setSelectedId(null) }}
      />
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-6 md:px-8 py-5 border-b border-[var(--border)] shrink-0">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Albums</h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{albums.length} albums</p>
        </div>
        {loading && <Loader2 size={16} className="animate-spin text-[var(--text-muted)]" />}
      </div>

      {error && (
        <div className="mx-6 md:mx-8 mt-4 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs shrink-0">
          <AlertCircle size={13} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 md:px-8 py-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5 md:gap-6">
          {albums.map(album => {
            const firstPath = [...album.songs].sort((a, b) => a.order - b.order)[0]?.path
            const song = firstPath ? pathIndex.get(firstPath) : undefined
            return (
              <AlbumCard
                key={album.id}
                album={album}
                coverUrl={buildImageUrl(song?.image_url)}
                onClick={() => setSelectedId(album.id)}
                onDelete={async () => {
                  if (!confirm(`Delete "${album.title}"? This can't be undone.`)) return
                  try {
                    await albumsApi.adminDeleteAlbum(album.id)
                    setAlbums(prev => prev.filter(a => a.id !== album.id))
                  } catch (e) {
                    setError(errorMessage(e, 'Could not delete this album'))
                  }
                }}
              />
            )
          })}

          <CreatePanel artists={artists} onCreated={album => { setAlbums(prev => [...prev, album]); setSelectedId(album.id) }} />
        </div>
      </div>
    </div>
  )
}
