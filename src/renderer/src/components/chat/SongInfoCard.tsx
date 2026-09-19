import { Loader2, Music } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SharedSongInfoPayload } from '../../lib/chatShare'
import { buildImageUrl, CATEGORY_COLORS, CATEGORY_LABELS, getSongById, type JWApiSong } from '../../lib/juicewrldApi'
import { useStore } from '../../store/useStore'

// The message only ever carries a songId (see chatShare.ts) - every field
// shown here comes from a fresh lookup, never from whatever text the
// sender's message contained.
export default function SongInfoCard({ info }: { info: SharedSongInfoPayload }): JSX.Element {
  const [song, setSong] = useState<JWApiSong | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setSong(null)
    setFailed(false)
    getSongById(info.songId)
      .then((s) => { if (!cancelled) setSong(s) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [info.songId])

  if (failed) {
    return (
      <div className="flex items-center gap-3 w-full max-w-sm rounded-xl border border-[var(--border)] bg-surface-raised/60 px-3 py-2.5 text-sm text-text-muted">
        <Music size={16} /> Song unavailable
      </div>
    )
  }

  if (!song) {
    return (
      <div className="flex items-center gap-3 w-full max-w-sm rounded-xl border border-[var(--border)] bg-surface-raised/60 px-3 py-2.5 text-text-muted">
        <Loader2 size={16} className="animate-spin" /> Loading...
      </div>
    )
  }

  const categoryLabel = CATEGORY_LABELS[song.category] ?? song.category
  const categoryColor = CATEGORY_COLORS[song.category] ?? 'text-text-muted bg-surface-highest border-[var(--border)]'
  const imageUrl = buildImageUrl(song.image_url)
  const rows: [string, string][] = [
    ...(song.credited_artists ? [['Artists', song.credited_artists] as [string, string]] : []),
    ...(song.producers ? [['Producers', song.producers] as [string, string]] : []),
    ...(song.release_date ? [['Released', song.release_date] as [string, string]] : (song.date_leaked ? [['Leaked', song.date_leaked] as [string, string]] : [])),
  ]
  return (
    <div
      onClick={() => useStore.getState().setInfoSongId(song.id)}
      className="flex gap-3 w-full max-w-sm rounded-xl border border-[var(--border)] bg-surface-raised/60 px-3 py-2.5 cursor-pointer hover:border-text-muted transition-colors"
    >
      <span className="relative w-14 h-14 rounded-lg overflow-hidden bg-surface-highest shrink-0 flex items-center justify-center">
        {imageUrl ? <img src={imageUrl} alt="" className="w-full h-full object-cover" /> : <Music size={18} className="text-text-muted" />}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-primary truncate">{song.name}</p>
        <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full border px-1.5 py-0.5 ${categoryColor}`}>{categoryLabel}</span>
          {song.era?.name && <span className="text-xs text-text-muted">{song.era.name}</span>}
          <span className="text-xs text-text-muted">· {song.length}</span>
        </div>
        {rows.length > 0 && (
          <dl className="mt-1.5 space-y-0.5">
            {rows.map(([label, value]) => (
              <div key={label} className="flex gap-1 text-xs">
                <dt className="text-text-muted shrink-0">{label}:</dt>
                <dd className="text-text-primary truncate">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  )
}
