import { useCallback, useEffect, useState } from 'react'
import { Check, FolderOpen, Loader2, MessageSquare } from 'lucide-react'
import {
  communityEditKindLabel, listMyCommunityEdits, withdrawCommunityEdit, type CommunityEdit,
} from '../lib/communityEditsApi'
import { errorMessage } from '../lib/format'
import { relativeTime, StatusChip } from './adminShared'
import { CommunityEditPlayer, formatLength, openCommunityEditMatch } from './communityEditShared'

const PAGE = 20

// Settings > Account: the remixes and edits this account sent in. A pending
// one can be withdrawn (its file is deleted on the server); an approved one
// opens in Files.
export default function MyCommunityEdits(): JSX.Element {
  const [rows, setRows] = useState<CommunityEdit[] | null>(null)
  const [count, setCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [confirming, setConfirming] = useState<number | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [playing, setPlaying] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const page = await listMyCommunityEdits({ limit: PAGE })
      setRows(page.results)
      setCount(page.count)
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Could not load your edits'))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const loadMore = async (): Promise<void> => {
    if (!rows) return
    setLoadingMore(true)
    try {
      const page = await listMyCommunityEdits({ limit: PAGE, offset: rows.length })
      const have = new Set(rows.map((r) => r.id))
      setRows([...rows, ...page.results.filter((r) => !have.has(r.id))])
      setCount(page.count)
    } catch (err) {
      setError(errorMessage(err, 'Could not load more'))
    } finally {
      setLoadingMore(false)
    }
  }

  const withdraw = async (edit: CommunityEdit): Promise<void> => {
    setBusy(edit.id)
    try {
      await withdrawCommunityEdit(edit.id)
      setConfirming(null)
      setRows((prev) => prev?.filter((r) => r.id !== edit.id) ?? prev)
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
      : <div className="flex items-center gap-2 py-3 text-text-muted text-xs"><Loader2 size={13} className="animate-spin" />Loading your edits…</div>
  }

  return (
    <div>
      {rows.length === 0 && (
        <p className="text-text-muted text-xs py-3">
          Nothing sent in yet. Use Home → Tools → Submit a remix or edit.
        </p>
      )}
      {rows.map((e) => (
        <div key={e.id} className="py-3 border-b border-[var(--border)] last:border-b-0">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-text-primary text-sm truncate flex items-center gap-2">
                <span className="truncate">{e.title}</span>
                <StatusChip status={e.status} />
              </p>
              <p className="text-text-muted text-[11px] truncate">
                {communityEditKindLabel(e.kind)}{e.song_name ? ` of ${e.song_name}` : ''} · {formatLength(e.duration)} · sent {relativeTime(e.created_at)}
                {e.reviewer_username && ` · ${e.status === 'reversed' ? 'taken back' : e.status} by ${e.reviewer_username}`}
              </p>
              {e.notes && (
                <p className="flex items-start gap-1 text-text-muted text-[11px] italic mt-0.5">
                  <MessageSquare size={10} className="shrink-0 mt-0.5" /><span className="line-clamp-2">{e.notes}</span>
                </p>
              )}
              {e.review_notes && (
                <p className="flex items-start gap-1 text-text-secondary text-[11px] mt-0.5">
                  <Check size={10} className="shrink-0 mt-0.5" /><span className="line-clamp-3">{e.review_notes}</span>
                </p>
              )}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button onClick={() => setPlaying(playing === e.id ? null : e.id)}
                className="text-xs text-text-muted hover:text-text-primary transition-colors">
                {playing === e.id ? 'Hide' : 'Listen'}
              </button>
              {e.status === 'approved' && e.comp_path && (
                <button
                  onClick={() => openCommunityEditMatch({ source: 'community_edit', score: 100, verdict: 'duplicate', target: 'file', path: e.comp_path!, channel: e.comp_channel })}
                  title={e.comp_path}
                  className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                  <FolderOpen size={11} /> Files
                </button>
              )}
              {e.status === 'pending' && (confirming === e.id ? (
                <span className="flex items-center gap-2">
                  <span className="text-[11px] text-text-muted">Withdraw?</span>
                  <button onClick={() => setConfirming(null)} className="text-xs text-text-muted hover:text-text-primary">Cancel</button>
                  <button
                    onClick={() => void withdraw(e)}
                    disabled={busy === e.id}
                    className="inline-flex items-center gap-1 rounded-lg bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-400 hover:bg-red-500/25 disabled:opacity-60"
                  >
                    {busy === e.id && <Loader2 size={11} className="animate-spin" />} Withdraw
                  </button>
                </span>
              ) : (
                <button onClick={() => setConfirming(e.id)}
                  className="text-xs text-text-muted hover:text-red-400 transition-colors">
                  Withdraw
                </button>
              ))}
            </div>
          </div>
          {playing === e.id && <div className="mt-2"><CommunityEditPlayer edit={e} /></div>}
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
