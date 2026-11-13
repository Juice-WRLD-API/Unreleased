import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle, Calendar, Check, CheckCircle, FolderOpen, Loader2, MessageSquare, Music2, RefreshCw, RotateCcw, XCircle,
} from 'lucide-react'
import {
  adminListCommunityEdits, adminReverseCommunityEdit, adminReviewCommunityEdit, communityEditKindLabel,
  type CommunityEdit, type CommunityEditStatus,
} from '../lib/communityEditsApi'
import { errorMessage, formatBytes } from '../lib/format'
import { showAppToast } from '../lib/appToast'
import { Empty, QueueSearch, StatusChip, matchesQuery, relativeTime, shortDate } from './adminShared'
import { CommunityEditPlayer, formatLength, openCommunityEditMatch } from './communityEditShared'

const PAGE = 50
const FILTERS: { id: CommunityEditStatus | ''; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'reversed', label: 'Reversed' },
  { id: '', label: 'All' },
]

// Admin → Remixes & edits: what people sent in (GET admin/community-edits/).
// Reviewers are managers of the primary channel and administrators. Approving
// adds the file to the community channel in Files under
// Remixes & Edits/Community-Made/, and Reverse
// takes that upload back. Duplicates never get here: the server turns them
// away on submit. `onCountsChanged` refreshes the nav badge after a review.
export default function CommunityEditsTab({ onCountsChanged }: { onCountsChanged: () => void }): JSX.Element {
  const [status, setStatus] = useState<CommunityEditStatus | ''>('pending')
  const [rows, setRows] = useState<CommunityEdit[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [actionId, setActionId] = useState<number | null>(null)

  // Bumped by every first-page load, so a slow answer for a filter you just
  // left can't land on this one.
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setError(null)
    try {
      const page = await adminListCommunityEdits({ status: status || undefined, limit: PAGE })
      if (seq !== loadSeq.current) return
      setRows(page.results)
      setCount(page.count)
    } catch (e) {
      if (seq !== loadSeq.current) return
      setRows([])
      setCount(0)
      setError(errorMessage(e, 'Could not load edits'))
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [status])

  useEffect(() => { void load() }, [load])

  const loadMore = async (): Promise<void> => {
    const seq = loadSeq.current
    setLoadingMore(true)
    try {
      const page = await adminListCommunityEdits({ status: status || undefined, limit: PAGE, offset: rows.length })
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
    () => rows.filter((r) => matchesQuery(query, r.title, r.song_name, r.submitter_username, `#${r.id}`)),
    [rows, query],
  )

  useEffect(() => {
    setSelectedId((prev) => (prev != null && visible.some((r) => r.id === prev) ? prev : visible[0]?.id ?? null))
  }, [visible])

  const applyUpdate = (updated: CommunityEdit): void => {
    const leaves = status !== '' && updated.status !== status
    setRows((prev) => leaves ? prev.filter((r) => r.id !== updated.id) : prev.map((r) => (r.id === updated.id ? updated : r)))
    if (leaves) setCount((c) => Math.max(0, c - 1))
    onCountsChanged()
  }

  const review = async (edit: CommunityEdit, action: 'approve' | 'reject'): Promise<void> => {
    setActionId(edit.id)
    try {
      applyUpdate(await adminReviewCommunityEdit(edit.id, action, notes[edit.id]))
    } catch (e) {
      showAppToast(errorMessage(e, `Couldn't ${action} the edit`))
    } finally {
      setActionId(null)
    }
  }

  const reverse = async (edit: CommunityEdit): Promise<void> => {
    if (!confirm('Take back this approval? The file is taken out of Files (Remixes & Edits/Community-Made).')) return
    setActionId(edit.id)
    try {
      applyUpdate(await adminReverseCommunityEdit(edit.id))
    } catch (e) {
      showAppToast(errorMessage(e, "Couldn't reverse the approval"))
    } finally {
      setActionId(null)
    }
  }

  const s = visible.find((r) => r.id === selectedId) ?? null

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-80 shrink-0 border-r border-[var(--border)] flex flex-col overflow-hidden">
        <div className="shrink-0 px-3 py-2.5 bg-surface-raised">
          <div className="flex gap-1 flex-wrap items-center">
            {FILTERS.map((f) => (
              <button key={f.id || 'all'} onClick={() => setStatus(f.id)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                  status === f.id ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
                }`}>{f.label}
              </button>
            ))}
            <button onClick={() => void load()} disabled={loading} title="Refresh"
              className="ml-auto shrink-0 p-1.5 rounded-lg text-accent hover:bg-surface-overlay transition-colors disabled:opacity-40">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="mt-2">
            <QueueSearch value={query} onChange={setQuery} placeholder="Search title, song, submitter, #id…"
              matches={visible.length} total={rows.length} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {error && (
            <p className="flex items-start gap-1.5 px-3 py-3 text-[11px] text-red-400">
              <AlertCircle size={11} className="shrink-0 mt-0.5" /> {error}
            </p>
          )}
          {!error && !loading && rows.length === 0 && <Empty label="No edits" />}
          {rows.length > 0 && visible.length === 0 && <Empty label="No matches" />}
          {visible.map((r) => (
            <button key={r.id} onClick={() => setSelectedId(r.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-b border-[var(--border)] transition-colors ${
                selectedId === r.id ? 'bg-accent/10' : 'hover:bg-surface-raised'
              }`}>
              <div className="min-w-0 flex-1">
                <p className="text-text-primary text-xs font-semibold truncate">{r.title}</p>
                <p className="text-text-muted text-[10px] truncate">
                  {communityEditKindLabel(r.kind)} · {r.submitter_username || 'Deleted account'} · {relativeTime(r.created_at)}
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

      <div className="flex-1 flex overflow-hidden">
        {!s ? (
          <Empty label={loading ? '' : 'Select a submission'} />
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <StatusChip status={s.status} />
                  <span className="text-[10px] text-text-muted">{communityEditKindLabel(s.kind)}</span>
                </div>
                <h2 className="text-text-primary font-bold text-base leading-snug">{s.title}</h2>
                <div className="flex items-center gap-4 mt-1.5 text-[11px] text-text-muted flex-wrap">
                  <span>by <span className="font-medium">{s.submitter_username || 'Deleted account'}</span></span>
                  <span className="flex items-center gap-1"><Calendar size={10} />{shortDate(s.created_at)}</span>
                  <span>{formatLength(s.duration)} · {formatBytes(s.size)} · {s.extension.toUpperCase()}</span>
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
                      <button onClick={() => void review(s, 'approve')}
                        title="Adds it to the Community channel in Files, under Remixes & Edits/Community-Made."
                        className="px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-xs font-semibold transition-colors flex items-center gap-1.5">
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

            <div className="mt-4 max-w-xl"><CommunityEditPlayer edit={s} /></div>

            <div className="flex flex-wrap gap-2 mt-3">
              {s.song != null && (
                <button onClick={() => openCommunityEditMatch({ source: 'song', score: 100, verdict: 'similar', target: 'song', song: { id: s.song!, public_id: s.song_public_id ?? 0, name: s.song_name ?? '' }, path: '' })}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-overlay border border-[var(--border)] text-[11px] text-text-muted hover:text-text-primary transition-colors">
                  <Music2 size={12} /> Made from {s.song_name ?? 'a deleted song'}
                </button>
              )}
              {s.status === 'approved' && s.comp_path && (
                <button onClick={() => openCommunityEditMatch({ source: 'community_edit', score: 100, verdict: 'duplicate', target: 'file', path: s.comp_path!, channel: s.comp_channel })}
                  title={`Show in Files${s.comp_channel ? ` (${s.comp_channel})` : ''}`}
                  className="flex items-center gap-1.5 max-w-full px-3 py-1.5 rounded-lg bg-surface-overlay border border-[var(--border)] text-[11px] text-text-muted hover:text-text-primary transition-colors">
                  <FolderOpen size={12} className="shrink-0" />
                  <span className="truncate">{s.comp_path}</span>
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
              <input
                type="text"
                value={notes[s.id] || ''}
                onChange={(e) => setNotes((n) => ({ ...n, [s.id]: e.target.value }))}
                placeholder="Add review note (optional)…"
                className="mt-3 w-full max-w-xl bg-surface-overlay border border-[var(--border)] rounded-lg px-3 py-2 text-text-primary text-xs focus:outline-none focus:border-accent/40"
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
