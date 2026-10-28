import { useCallback, useEffect, useState } from 'react'
import { Loader2, MessageSquare, Check } from 'lucide-react'
import { listMyCoverArt, withdrawCoverArt, type CoverArtSubmission } from '../lib/coverArtApi'
import { dropCoverArtImage } from '../lib/coverArtImages'
import { errorMessage } from '../lib/format'
import { relativeTime, StatusChip } from './adminShared'
import { CoverArtImage } from './coverArtShared'

const PAGE = 20

// Settings > Account: the cover art this account sent in, with where each one
// stands. A pending one can be withdrawn (its image is deleted on the server),
// which is also how to send a different image for the same song.
export default function MyCoverArt(): JSX.Element {
  const [rows, setRows] = useState<CoverArtSubmission[] | null>(null)
  const [count, setCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [confirming, setConfirming] = useState<number | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const page = await listMyCoverArt({ limit: PAGE })
      setRows(page.results)
      setCount(page.count)
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Could not load your cover art'))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const loadMore = async (): Promise<void> => {
    if (!rows) return
    setLoadingMore(true)
    try {
      const page = await listMyCoverArt({ limit: PAGE, offset: rows.length })
      const have = new Set(rows.map((r) => r.id))
      setRows([...rows, ...page.results.filter((r) => !have.has(r.id))])
      setCount(page.count)
    } catch (err) {
      setError(errorMessage(err, 'Could not load more'))
    } finally {
      setLoadingMore(false)
    }
  }

  const withdraw = async (sub: CoverArtSubmission): Promise<void> => {
    setBusy(sub.id)
    try {
      await withdrawCoverArt(sub.id)
      dropCoverArtImage(sub.id)
      setConfirming(null)
      setRows((prev) => prev?.filter((r) => r.id !== sub.id) ?? prev)
      setCount((c) => Math.max(0, c - 1))
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Could not withdraw it'))
    } finally {
      setBusy(null)
    }
  }

  if (!rows) {
    return error
      ? <p className="text-red-400 text-[11px] py-2">{error}</p>
      : <div className="flex items-center gap-2 py-3 text-text-muted text-xs"><Loader2 size={13} className="animate-spin" />Loading cover art…</div>
  }

  return (
    <div>
      {rows.length === 0 && (
        <p className="text-text-muted text-xs py-3">
          Nothing sent in yet. From a song's menu, pick More → Submit cover art.
        </p>
      )}
      {rows.map((s) => (
        <div key={s.id} className="flex items-start gap-3 py-3 border-b border-[var(--border)] last:border-b-0">
          <CoverArtImage sub={s} className="w-12 h-12 rounded-md shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-text-primary text-sm truncate flex items-center gap-2">
              <span className="truncate">{s.song_name || 'Deleted song'}</span>
              <StatusChip status={s.status} />
            </p>
            <p className="text-text-muted text-[11px] truncate">
              {s.width}×{s.height} · sent {relativeTime(s.created_at)}
              {s.reviewer_username && ` · ${s.status === 'reversed' ? 'taken back' : s.status} by ${s.reviewer_username}`}
              {s.reviewed_at && ` ${relativeTime(s.reviewed_at)}`}
            </p>
            {s.notes && (
              <p className="flex items-start gap-1 text-text-muted text-[11px] italic mt-0.5">
                <MessageSquare size={10} className="shrink-0 mt-0.5" /><span className="line-clamp-2">{s.notes}</span>
              </p>
            )}
            {s.review_notes && (
              <p className="flex items-start gap-1 text-text-secondary text-[11px] mt-0.5">
                <Check size={10} className="shrink-0 mt-0.5" /><span className="line-clamp-3">{s.review_notes}</span>
              </p>
            )}
          </div>
          {s.status === 'pending' && (confirming === s.id ? (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] text-text-muted">Withdraw?</span>
              <button onClick={() => setConfirming(null)} className="text-xs text-text-muted hover:text-text-primary">Cancel</button>
              <button
                onClick={() => void withdraw(s)}
                disabled={busy === s.id}
                className="inline-flex items-center gap-1 rounded-lg bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-400 hover:bg-red-500/25 disabled:opacity-60"
              >
                {busy === s.id && <Loader2 size={11} className="animate-spin" />} Withdraw
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirming(s.id)}
              className="shrink-0 text-xs text-text-muted hover:text-red-400 transition-colors">
              Withdraw
            </button>
          ))}
        </div>
      ))}
      {error && <p className="text-red-400 text-[11px] py-2">{error}</p>}
      {rows.length < count && (
        <button onClick={() => void loadMore()} disabled={loadingMore}
          className="w-full py-2 text-[11px] font-semibold text-accent hover:bg-surface-raised rounded-lg transition-colors disabled:opacity-60">
          {loadingMore ? 'Loading…' : `Show more · ${count - rows.length} left`}
        </button>
      )}
    </div>
  )
}
