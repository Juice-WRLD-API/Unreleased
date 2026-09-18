import { Music } from 'lucide-react'
import type { SharedSongInfoPayload } from '../../lib/chatShare'
import { CATEGORY_COLORS, CATEGORY_LABELS } from '../../lib/juicewrldApi'
import { useStore } from '../../store/useStore'

export default function SongInfoCard({ info }: { info: SharedSongInfoPayload }): JSX.Element {
  const categoryLabel = CATEGORY_LABELS[info.category] ?? info.category
  const categoryColor = CATEGORY_COLORS[info.category] ?? 'text-text-muted bg-surface-highest border-[var(--border)]'
  const rows: [string, string][] = [
    ...(info.artists ? [['Artists', info.artists] as [string, string]] : []),
    ...(info.producers ? [['Producers', info.producers] as [string, string]] : []),
    ...(info.releaseDate ? [['Released', info.releaseDate] as [string, string]] : (info.leakedDate ? [['Leaked', info.leakedDate] as [string, string]] : [])),
  ]
  return (
    <div
      onClick={() => useStore.getState().setInfoSongId(info.songId)}
      className="flex gap-3 w-full max-w-sm rounded-xl border border-[var(--border)] bg-surface-raised/60 px-3 py-2.5 cursor-pointer hover:border-text-muted transition-colors"
    >
      <span className="relative w-14 h-14 rounded-lg overflow-hidden bg-surface-highest shrink-0 flex items-center justify-center">
        {info.imageUrl ? <img src={info.imageUrl} alt="" className="w-full h-full object-cover" /> : <Music size={18} className="text-text-muted" />}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-primary truncate">{info.title}</p>
        <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full border px-1.5 py-0.5 ${categoryColor}`}>{categoryLabel}</span>
          {info.era && <span className="text-xs text-text-muted">{info.era}</span>}
          <span className="text-xs text-text-muted">· {info.length}</span>
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
