import { useEffect, useState } from 'react'
import { Loader2, CheckCircle, RotateCcw, Hash, Calendar, MessageSquare, Music2, ChevronLeft } from 'lucide-react'
import * as reportsApi from '../lib/reportsApi'
import type { SongReportRow, SongReportStatus } from '../lib/reportsApi'
import { apiFetch, buildImageUrl } from '../lib/juicewrldApi'
import type { JWApiSong } from '../lib/juicewrldApi'
import { StatusChip, Empty, AppSection, relativeTime, shortDate, STATUS_STYLE } from './adminShared'

// User-submitted song issue reports (wrong/missing info or lyrics). The app's
// own submit path folds the issue checkboxes into the message text, so the
// message is rendered verbatim; resolving PATCHes status + review_notes and
// the server records who reviewed and when. Used both as an AdminPage tab
// and standalone in EditorProfileView for editor-only accounts.

export default function ReportsTab({ reports, status, setStatus, onChanged, compact = false }: {
  reports: SongReportRow[]
  status: SongReportStatus | ''
  setStatus: (s: SongReportStatus | '') => void
  onChanged: () => void
  /** Single-pane list↔detail (same shape as ReportsTab.mobile) instead of the
   *  fixed-320px-sidebar master-detail split below. The split assumes a full
   *  page's worth of width; squeezed into a bento tile it left the detail
   *  pane a sliver or clipped outright. Pass this wherever the tab renders
   *  inside a tile rather than a full AdminPage panel. */
  compact?: boolean
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

  if (compact) {
    if (r) return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="shrink-0 flex items-center gap-1.5 pb-2">
          <button onClick={() => setSelected(null)}
            className="p-1 -ml-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-raised transition-colors">
            <ChevronLeft size={16} />
          </button>
          <h2 className="flex-1 min-w-0 truncate text-text-primary text-sm font-bold">{songLabel(r)}</h2>
          <StatusChip status={r.status} />
        </div>
        <div className="flex-1 overflow-y-auto pr-1 space-y-3">
          <div className="flex items-center gap-3 text-xs text-text-muted flex-wrap">
            {reportsApi.reportSongId(r) != null && <span className="flex items-center gap-1"><Hash size={10} />{reportsApi.reportSongId(r)}</span>}
            {rSong?.era?.name && <span>{rSong.era.name}</span>}
            <span className="flex items-center gap-1"><Calendar size={10} />{shortDate(r.created_at ?? null)}</span>
          </div>
          <AppSection label="Report" value={r.message} />
          {r.status !== 'pending' && r.review_notes && (
            <AppSection label="Review notes" value={r.review_notes} />
          )}
          {r.status === 'pending' && (
            <textarea
              value={notes[r.id] || ''}
              onChange={e => setNotes(n => ({ ...n, [r.id]: e.target.value }))}
              placeholder="Optional note recorded with the resolution…"
              rows={2}
              className="w-full bg-surface-overlay border border-[var(--border)] rounded-lg px-2.5 py-2 text-text-primary text-xs resize-none focus:outline-none focus:border-accent/40"
            />
          )}
          {actionId === r.id ? (
            <div className="flex justify-center py-1"><Loader2 size={14} className="animate-spin text-text-muted" /></div>
          ) : r.status === 'pending' ? (
            <button onClick={() => doReview(r, 'resolved')}
              className="w-full py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5">
              <CheckCircle size={12} /> Resolve
            </button>
          ) : (
            <button onClick={() => doReview(r, 'pending')}
              className="w-full py-1.5 rounded-lg bg-surface-overlay hover:bg-surface-raised text-text-secondary text-xs font-semibold transition-colors flex items-center justify-center gap-1.5">
              <RotateCcw size={12} /> Reopen
            </button>
          )}
        </div>
      </div>
    )

    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="shrink-0 flex gap-1 flex-wrap mb-2">
          {FILTERS.map(f => (
            <button key={f.id || 'all'} onClick={() => setStatus(f.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                status === f.id ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto pr-1 space-y-1.5">
          {reports.length === 0 && <Empty label="No reports" />}
          {reports.map(item => (
            <button key={item.id} onClick={() => setSelected(item)}
              className={`w-full text-left rounded-xl border border-[var(--border)] px-3 py-2.5 transition-colors hover:bg-surface-raised ${
                item.status !== 'pending' ? 'opacity-60' : ''
              }`}>
              <div className="flex items-center gap-2 mb-1">
                <StatusChip status={item.status} />
                <p className="text-text-primary text-xs font-semibold truncate flex-1 min-w-0">{songLabel(item)}</p>
              </div>
              <p className="text-text-muted text-[11px] truncate">{item.message}</p>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: list */}
      <div className="w-80 shrink-0 border-r border-[var(--border)] flex flex-col overflow-hidden">
        <div className="shrink-0 flex gap-1 flex-wrap px-3 py-2.5 border-b border-[var(--border)] bg-surface-raised">
          {FILTERS.map(f => (
            <button key={f.id || 'all'} onClick={() => setStatus(f.id)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                status === f.id ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {reports.length === 0 && <Empty label="No reports" />}
          {reports.map(item => (
            <button key={item.id} onClick={() => setSelected(item)}
              className={`w-full text-left px-3 py-3 border-b border-[var(--border)] border-l-2 ${STATUS_STYLE[item.status]?.border ?? 'border-l-transparent'} transition-colors ${
                selected?.id === item.id ? 'bg-accent/10' : 'hover:bg-surface-raised'
              } ${item.status !== 'pending' ? 'opacity-60' : ''}`}>
              <p className="text-text-primary text-xs font-semibold truncate">{songLabel(item)}</p>
              <p className="text-text-muted text-[10px] truncate mt-0.5">{item.message}</p>
              <p className="text-text-muted text-[10px] mt-1">
                {item.status === 'pending'
                  ? relativeTime(item.created_at ?? null)
                  : `resolved · ${shortDate(item.reviewed_at ?? null)}`}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Right: detail */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!r ? <Empty label="Select a report" /> : (
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-xl bg-surface-overlay flex items-center justify-center shrink-0 overflow-hidden">
                {rSong?.image_url
                  ? <img src={buildImageUrl(rSong.image_url)} alt="" className="w-full h-full object-cover" />
                  : <Music2 size={22} className="text-text-muted opacity-40" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap mb-1">
                  <h2 className="text-text-primary text-lg font-bold truncate">{songLabel(r)}</h2>
                  <StatusChip status={r.status} />
                </div>
                <div className="flex items-center gap-4 text-xs text-text-muted flex-wrap">
                  {reportsApi.reportSongId(r) != null && <span className="flex items-center gap-1"><Hash size={10} />{reportsApi.reportSongId(r)}</span>}
                  {rSong?.era?.name && <span>{rSong.era.name}</span>}
                  <span className="flex items-center gap-1"><Calendar size={10} />{shortDate(r.created_at ?? null)}</span>
                  {r.contact && <span className="flex items-center gap-1"><MessageSquare size={10} />{r.contact}</span>}
                  {r.reviewer_username && <span>Reviewed by {r.reviewer_username}</span>}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {actionId === r.id ? <Loader2 size={14} className="animate-spin text-text-muted" /> : r.status === 'pending' ? (
                  <button onClick={() => doReview(r, 'resolved')}
                    className="px-3 py-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-xs font-semibold transition-colors flex items-center gap-1.5">
                    <CheckCircle size={13} /> Resolve
                  </button>
                ) : (
                  <button onClick={() => doReview(r, 'pending')}
                    className="px-3 py-2 rounded-lg bg-surface-overlay hover:bg-surface-raised text-text-secondary text-xs font-semibold transition-colors flex items-center gap-1.5">
                    <RotateCcw size={13} /> Reopen
                  </button>
                )}
              </div>
            </div>

            <hr className="border-[var(--border)]" />

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
        )}
      </div>
    </div>
  )
}
