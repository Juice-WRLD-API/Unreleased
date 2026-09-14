import { useEffect, useState } from 'react'
import { Loader2, CheckCircle, RotateCcw, Hash, Calendar, MessageSquare, Music2, ChevronLeft } from 'lucide-react'
import * as reportsApi from '../lib/reportsApi'
import type { SongReportRow, SongReportStatus } from '../lib/reportsApi'
import { apiFetch, buildImageUrl } from '../lib/juicewrldApi'
import type { JWApiSong } from '../lib/juicewrldApi'
import { StatusChip, Empty, AppSection, relativeTime, shortDate, STATUS_STYLE } from './adminShared'
import { useBackToClose } from '../hooks/useBackToClose'

// User-submitted song issue reports (wrong/missing info or lyrics). The app's
// own submit path folds the issue checkboxes into the message text, so the
// message is rendered verbatim; resolving PATCHes status + review_notes and
// the server records who reviewed and when. Used both as an AdminPage tab
// and standalone in EditorProfileView for editor-only accounts.

export default function ReportsTab({ reports, status, setStatus, onChanged }: {
  reports: SongReportRow[]
  status: SongReportStatus | ''
  setStatus: (s: SongReportStatus | '') => void
  onChanged: () => void
}): JSX.Element {
  const [actionId, setActionId] = useState<number | null>(null)
  const [notes,    setNotes]    = useState<Record<number, string>>({})
  const [selected, setSelected] = useState<SongReportRow | null>(null)

  useEffect(() => { setSelected(reports[0] ?? null) }, [reports])

  // Song names for rows that only carry an id - one bulk catalog fetch (the
  // same ?all=true mode compact view uses) instead of a request per report.
  const [songsById, setSongsById] = useState<Map<number, JWApiSong>>(new Map())
  useEffect(() => {
    apiFetch<JWApiSong[]>('/songs/', { all: 'true' })
      .then(songs => setSongsById(new Map(songs.map(s => [s.id, s]))))
      .catch(() => {})
  }, [])

  const songLabel = (r: SongReportRow): string => {
    if (r.song_name) return r.song_name
    const id = reportsApi.reportSongId(r)
    if (id == null) return r.public_id != null ? `Song #${r.public_id}` : 'Unknown song'
    return songsById.get(id)?.name ?? `Song id ${id}`
  }

  const doReview = async (r: SongReportRow, newStatus: SongReportStatus) => {
    setActionId(r.id)
    try {
      await reportsApi.reviewSongReport(r.id, { status: newStatus, review_notes: notes[r.id] ?? r.review_notes ?? '' })
      onChanged()
    } catch {} finally { setActionId(null) }
  }

  const FILTERS: { id: SongReportStatus | ''; label: string }[] = [
    { id: 'pending',  label: 'Pending'  },
    { id: 'resolved', label: 'Resolved' },
    { id: '',         label: 'All'      },
  ]

  const r = selected
  const rSong = r ? (reportsApi.reportSongId(r) != null ? songsById.get(reportsApi.reportSongId(r)!) : undefined) : undefined

  useBackToClose(() => setSelected(null), r != null)

  if (r) return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border)]">
        <button onClick={() => setSelected(null)}
          className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-primary active:bg-surface-overlay transition-colors">
          <ChevronLeft size={20} />
        </button>
        <h2 className="flex-1 min-w-0 truncate text-text-primary text-[15px] font-bold">{songLabel(r)}</h2>
        <StatusChip status={r.status} />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-14 h-14 rounded-xl bg-surface-overlay flex items-center justify-center shrink-0 overflow-hidden">
            {rSong?.image_url
              ? <img src={buildImageUrl(rSong.image_url)} alt="" className="w-full h-full object-cover" />
              : <Music2 size={22} className="text-text-muted opacity-40" />}
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-1 text-xs text-text-muted">
            {reportsApi.reportSongId(r) != null && <span className="flex items-center gap-1"><Hash size={10} />{reportsApi.reportSongId(r)}</span>}
            {rSong?.era?.name && <span>{rSong.era.name}</span>}
            <span className="flex items-center gap-1"><Calendar size={10} />{shortDate(r.created_at ?? null)}</span>
            {r.contact && <span className="flex items-center gap-1"><MessageSquare size={10} />{r.contact}</span>}
            {r.reviewer_username && <span>Reviewed by {r.reviewer_username}</span>}
          </div>
        </div>

        <AppSection label="Report" value={r.message} />

        {r.status !== 'pending' && r.review_notes && (
          <AppSection label="Review notes" value={r.review_notes} />
        )}

        {r.status === 'pending' && (
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Review note</label>
            <textarea
              value={notes[r.id] || ''}
              onChange={e => setNotes(n => ({ ...n, [r.id]: e.target.value }))}
              placeholder="Optional note recorded with the resolution…"
              rows={3}
              className="w-full bg-surface-overlay border border-[var(--border)] rounded-xl px-3 py-2.5 text-text-primary text-sm resize-none focus:outline-none focus:border-accent/40"
            />
          </div>
        )}
      </div>

      <div className="shrink-0 p-3 border-t border-[var(--border)]">
        {actionId === r.id ? (
          <div className="flex justify-center py-2.5"><Loader2 size={16} className="animate-spin text-text-muted" /></div>
        ) : r.status === 'pending' ? (
          <button onClick={() => doReview(r, 'resolved')}
            className="w-full h-11 rounded-xl bg-emerald-500/15 active:bg-emerald-500/25 text-emerald-400 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5">
            <CheckCircle size={15} /> Resolve
          </button>
        ) : (
          <button onClick={() => doReview(r, 'pending')}
            className="w-full h-11 rounded-xl bg-surface-overlay active:bg-surface-raised text-text-secondary text-sm font-semibold transition-colors flex items-center justify-center gap-1.5">
            <RotateCcw size={15} /> Reopen
          </button>
        )}
      </div>
    </div>
  )

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="shrink-0 flex gap-2 overflow-x-auto scrollbar-none px-3 py-2.5 border-b border-[var(--border)]">
        {FILTERS.map(f => (
          <button key={f.id || 'all'} onClick={() => setStatus(f.id)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              status === f.id ? 'bg-accent/15 text-accent' : 'text-text-muted bg-surface-overlay active:text-text-primary'
            }`}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {reports.length === 0 && <Empty label="No reports" />}
        {reports.map(item => (
          <button key={item.id} onClick={() => setSelected(item)}
            className={`w-full text-left px-3 py-3 border-b border-[var(--border)] border-l-2 ${STATUS_STYLE[item.status]?.border ?? 'border-l-transparent'} transition-colors active:bg-surface-raised ${
              item.status !== 'pending' ? 'opacity-60' : ''
            }`}>
            <p className="text-text-primary text-sm font-semibold truncate">{songLabel(item)}</p>
            <p className="text-text-muted text-xs truncate mt-0.5">{item.message}</p>
            <p className="text-text-muted text-[11px] mt-1">
              {item.status === 'pending'
                ? relativeTime(item.created_at ?? null)
                : `resolved · ${shortDate(item.reviewed_at ?? null)}`}
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}
