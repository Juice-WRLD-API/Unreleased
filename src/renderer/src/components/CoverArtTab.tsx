import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle, Calendar, Check, CheckCircle, ChevronLeft, Hash, Loader2, MessageSquare, RefreshCw, RotateCcw, XCircle,
} from 'lucide-react'
import {
  adminListCoverArt, adminReverseCoverArt, adminReviewCoverArt, type CoverArtStatus, type CoverArtSubmission,
} from '../lib/coverArtApi'
import { errorMessage, formatBytes } from '../lib/format'
import { showAppToast } from '../lib/appToast'
import { Empty, QueueSearch, StatusChip, matchesQuery, relativeTime, shortDate } from './adminShared'
import { CoverArtImage, SongImage } from './coverArtShared'
import { useBackToClose } from '../hooks/useBackToClose'

const PAGE = 50
const FILTERS: { id: CoverArtStatus | ''; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'reversed', label: 'Reversed' },
  { id: '', label: 'All' },
]

// Admin → Cover art: covers people sent in for songs (GET admin/cover-art/).
// Reviewers are managers of the primary channel and administrators - songs
// aren't per channel, so the active channel doesn't matter here. Approving
// points the song's image_url at the submission's image; Reverse takes that
// back. Loads its own rows, like CompProposalsTab; `onCountsChanged` refreshes
// the nav badge after a review.
export default function CoverArtTab({ onCountsChanged, stacked = false }: {
  onCountsChanged: () => void
  /** Phone layout: the list fills the screen, and a row opens its detail. */
  stacked?: boolean
}): JSX.Element {
  const [status, setStatus] = useState<CoverArtStatus | ''>('pending')
  const [rows, setRows] = useState<CoverArtSubmission[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [actionId, setActionId] = useState<number | null>(null)
  // Android back leaves the detail for the list. The handler stays registered
  // only while that detail is what's on screen.
  useBackToClose(() => setSelectedId(null), stacked && selectedId != null)

  // Bumped by every first-page load, so a slow answer for the filter you just
  // left (or a "Show more" started before the switch) can't land on this one.
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setError(null)
    try {
      const page = await adminListCoverArt({ status: status || undefined, limit: PAGE })
      if (seq !== loadSeq.current) return
      setRows(page.results)
      setCount(page.count)
    } catch (e) {
      if (seq !== loadSeq.current) return
      setRows([])
      setCount(0)
      setError(errorMessage(e, 'Could not load cover art'))
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [status])

  useEffect(() => { void load() }, [load])

  const loadMore = async (): Promise<void> => {
    const seq = loadSeq.current
    setLoadingMore(true)
    try {
      const page = await adminListCoverArt({ status: status || undefined, limit: PAGE, offset: rows.length })
      if (seq !== loadSeq.current) return
      const have = new Set(rows.map((r) => r.id))
      setRows([...rows, ...page.results.filter((r) => !have.has(r.id))])
      setCount(page.count)
    } catch (e) {
      showAppToast(errorMessage(e, 'Could not load more'))
    } finally {
      setLoadingMore(false)
    }
  }

  const visible = useMemo(
    () => rows.filter((r) => matchesQuery(query, r.song_name, r.submitter_username, `#${r.id}`, r.song_public_id)),
    [rows, query],
  )

  // Keep the selection inside the visible list, so the detail pane's buttons
  // never point at a row the search or a review just took away.
  useEffect(() => {
    setSelectedId((prev) => {
      if (prev != null && visible.some((r) => r.id === prev)) return prev
      // A phone opens a row on purpose. Don't jump into the first one.
      return stacked ? null : visible[0]?.id ?? null
    })
  }, [visible, stacked])

  const applyUpdate = (updated: CoverArtSubmission): void => {
    const leaves = status !== '' && updated.status !== status
    setRows((prev) => leaves ? prev.filter((r) => r.id !== updated.id) : prev.map((r) => (r.id === updated.id ? updated : r)))
    if (leaves) setCount((c) => Math.max(0, c - 1))
    onCountsChanged()
  }

  const review = async (sub: CoverArtSubmission, action: 'approve' | 'reject'): Promise<void> => {
    setActionId(sub.id)
    try {
      applyUpdate(await adminReviewCoverArt(sub.id, action, notes[sub.id]))
    } catch (e) {
      showAppToast(errorMessage(e, `Couldn't ${action} the cover art`))
    } finally {
      setActionId(null)
    }
  }

  const reverse = async (sub: CoverArtSubmission): Promise<void> => {
    if (!confirm('Take back this approval? If the song still shows this cover, it goes back to the one before.')) return
    setActionId(sub.id)
    try {
      applyUpdate(await adminReverseCoverArt(sub.id))
    } catch (e) {
      showAppToast(errorMessage(e, "Couldn't reverse the approval"))
    } finally {
      setActionId(null)
    }
  }

  const s = visible.find((r) => r.id === selectedId) ?? null

  const showList = !stacked || s == null
  const showDetail = !stacked || s != null

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: list. On a phone this is the whole screen until a row opens. */}
      {showList && (
      <div className={stacked
        ? 'flex-1 min-w-0 flex flex-col overflow-hidden'
        : 'w-80 shrink-0 border-r border-[var(--border)] flex flex-col overflow-hidden'}>
        <div className="shrink-0 px-3 py-2.5 bg-surface-raised">
          <div className="flex gap-1 flex-wrap items-center">
            {FILTERS.map((f) => (
              <button key={f.id || 'all'} onClick={() => setStatus(f.id)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                  status === f.id
                    ? 'bg-accent/15 text-accent'
                    : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
                }`}>{f.label}
              </button>
            ))}
            <button onClick={() => void load()} disabled={loading} title="Refresh"
              className="ml-auto shrink-0 p-1.5 rounded-lg text-accent hover:bg-surface-overlay transition-colors disabled:opacity-40">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="mt-2">
            <QueueSearch value={query} onChange={setQuery} placeholder="Search song, submitter, #id…"
              matches={visible.length} total={rows.length} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {error && (
            <p className="flex items-start gap-1.5 px-3 py-3 text-[11px] text-red-400">
              <AlertCircle size={11} className="shrink-0 mt-0.5" /> {error}
            </p>
          )}
          {!error && !loading && rows.length === 0 && <Empty label="No cover art" />}
          {rows.length > 0 && visible.length === 0 && <Empty label="No matches" />}
          {visible.map((r) => (
            <button key={r.id} onClick={() => setSelectedId(r.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-b border-[var(--border)] transition-colors ${
                selectedId === r.id ? 'bg-accent/10' : 'hover:bg-surface-raised'
              }`}>
              <CoverArtImage sub={r} className="w-10 h-10 rounded-md shrink-0" iconSize={12} />
              <div className="min-w-0 flex-1">
                <p className="text-text-primary text-xs font-semibold truncate">{r.song_name || 'Deleted song'}</p>
                <p className="text-text-muted text-[10px] truncate">
                  {r.submitter_username || 'Deleted account'} · {relativeTime(r.created_at)}
                </p>
              </div>
              {status === '' && <StatusChip status={r.status} />}
            </button>
          ))}
          {rows.length < count && (
            <button onClick={() => void loadMore()} disabled={loadingMore}
              className="w-full px-3 py-3 text-[11px] font-semibold text-accent hover:bg-surface-raised transition-colors disabled:opacity-60">
              {loadingMore ? 'Loading…' : `Show ${Math.min(count - rows.length, PAGE)} more · ${count - rows.length} left`}
            </button>
          )}
        </div>
      </div>
      )}

      {/* Right: detail. On a phone it replaces the list, with a way back. */}
      {showDetail && (
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {stacked && s && (
          <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border)]">
            <button onClick={() => setSelectedId(null)} title="Back"
              className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-primary active:bg-surface-overlay transition-colors">
              <ChevronLeft size={20} />
            </button>
            <h2 className="flex-1 min-w-0 truncate text-text-primary text-[14px] font-bold">{s.song_name || 'Deleted song'}</h2>
          </div>
        )}
        <div className="flex-1 flex overflow-hidden min-h-0">
        {!s ? (
          <Empty label={loading ? '' : 'Select a submission'} />
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="shrink-0 px-6 py-4 bg-surface-raised">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <StatusChip status={s.status} />
                    {s.song_public_id != null && (
                      <span className="flex items-center gap-0.5 text-[10px] text-text-muted">
                        <Hash size={9} />{s.song_public_id}
                      </span>
                    )}
                  </div>
                  <h2 className="text-text-primary font-bold text-base leading-snug">{s.song_name || 'Deleted song'}</h2>
                  <div className="flex items-center gap-4 mt-1.5 text-[11px] text-text-muted flex-wrap">
                    <span>by <span className="font-medium">{s.submitter_username || 'Deleted account'}</span></span>
                    <span className="flex items-center gap-1"><Calendar size={10} />{shortDate(s.created_at)}</span>
                    {s.reviewer_username && <span>reviewed by {s.reviewer_username}{s.reviewed_at ? ` ${relativeTime(s.reviewed_at)}` : ''}</span>}
                  </div>
                </div>

                {s.status === 'pending' && (
                  <div className="flex items-center gap-2 shrink-0">
                    {actionId === s.id ? <Loader2 size={14} className="animate-spin text-text-muted" /> : (
                      <>
                        <button onClick={() => void review(s, 'reject')}
                          className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-semibold transition-colors flex items-center gap-1.5">
                          <XCircle size={13} /> Reject
                        </button>
                        <button onClick={() => void review(s, 'approve')} disabled={s.song == null}
                          title={s.song == null ? 'The song was deleted' : undefined}
                          className="px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-xs font-semibold transition-colors flex items-center gap-1.5 disabled:opacity-40">
                          <CheckCircle size={13} /> Approve
                        </button>
                      </>
                    )}
                  </div>
                )}
                {s.status === 'approved' && (
                  <button onClick={() => void reverse(s)} disabled={actionId === s.id}
                    className="px-3 py-1.5 rounded-lg text-xs text-text-muted hover:text-amber-400 hover:bg-amber-500/10 transition-colors flex items-center gap-1.5 disabled:opacity-40">
                    {actionId === s.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Reverse
                  </button>
                )}
              </div>

              {(s.notes || s.review_notes) && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {s.notes && (
                    <div className="flex items-start gap-1.5 px-3 py-2 bg-surface-overlay rounded-lg text-xs text-text-muted italic border border-[var(--border)] max-w-sm whitespace-pre-wrap">
                      <MessageSquare size={11} className="text-text-muted shrink-0 mt-0.5" />
                      {s.notes}
                    </div>
                  )}
                  {s.review_notes && (
                    <div className="flex items-start gap-1.5 px-3 py-2 bg-surface-overlay rounded-lg text-xs text-text-muted italic border border-[var(--border)] max-w-sm whitespace-pre-wrap">
                      <Check size={11} className="text-text-muted shrink-0 mt-0.5" />
                      {s.review_notes}
                    </div>
                  )}
                </div>
              )}

              {s.status === 'pending' && (
                <div className="mt-3">
                  <input
                    type="text"
                    value={notes[s.id] || ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [s.id]: e.target.value }))}
                    placeholder="Add review note (optional)…"
                    className="w-full bg-surface-overlay border border-[var(--border)] rounded-lg px-3 py-2 text-text-primary text-xs focus:outline-none focus:border-accent/40"
                  />
                </div>
              )}
            </div>

            {/* Side by side: what the song shows (or showed, once this one
                replaced it) against what was sent in. */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className={`grid gap-5 max-w-3xl ${stacked ? 'grid-cols-1' : 'grid-cols-2'}`}>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">
                    {s.status === 'approved' ? 'Before' : 'Now on the song'}
                  </p>
                  <SongImage
                    imageUrl={s.status === 'approved' ? s.previous_image_url : s.song_image_url}
                    className="w-full aspect-square rounded-xl border border-[var(--border)]"
                    iconSize={22}
                  />
                  {s.song == null && <p className="text-[11px] text-amber-400 mt-1.5">The song was deleted.</p>}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">Submitted</p>
                  <CoverArtImage sub={s} className="w-full aspect-square rounded-xl border border-[var(--border)]" iconSize={22} />
                  <p className="text-[11px] text-text-muted mt-1.5">
                    {s.width}×{s.height} · {formatBytes(s.size)} · {s.mime.replace('image/', '').toUpperCase()}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
      )}
    </div>
  )
}
