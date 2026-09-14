import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  Loader2, CheckCircle, XCircle, RotateCcw, Download, Calendar, Hash, AlertCircle, ImageOff,
} from 'lucide-react'
import * as userApi from '../lib/userApi'
import type { CompFileProposal, ProposalStatus } from '../lib/userApi'
import { getToken } from '../lib/userApi'
import { relativeTime, shortDate, StatusChip, Empty, QueueSearch, buildHaystack, matchesHaystack, CopyButton } from './adminShared'
import { buildStreamUrl } from '../lib/juicewrldApi'
import { useStore } from '../store/useStore'
import { getMediaType } from '../lib/fileTypes'
import { formatBytes, formatDuration } from '../lib/format'

/** Loads a comp-admin route's bytes into an object URL - the staging file
 *  isn't public like a live comp/ path, so it needs the same authed fetch
 *  downloadStaging already uses, just kept in memory instead of saved to
 *  disk. Torn down (URL revoked) on unmount or when the source URL changes,
 *  since a leaked object URL pins the blob in memory for the page's life. */
function useAuthedBlobUrl(url: string | null): { src: string | null; loading: boolean; error: boolean; bytes: number | null } {
  const [state, setState] = useState<{ src: string | null; loading: boolean; error: boolean; bytes: number | null }>(
    { src: null, loading: !!url, error: false, bytes: null },
  )
  useEffect(() => {
    if (!url) { setState({ src: null, loading: false, error: false, bytes: null }); return }
    let cancelled = false
    let objectUrl: string | null = null
    setState({ src: null, loading: true, error: false, bytes: null })
    const token = getToken()
    fetch(url, { headers: token ? { Authorization: `Token ${token}` } : {} })
      .then((r) => { if (!r.ok) throw new Error(); return r.blob() })
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setState({ src: objectUrl, loading: false, error: false, bytes: blob.size })
      })
      .catch(() => { if (!cancelled) setState({ src: null, loading: false, error: true, bytes: null }) })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])
  return state
}

/** One preview slot - a live comp/ path (plain <img>/<audio>/<video> against
 *  the public download URL, same as FilePickerModal's thumbnails) or an
 *  authed blob (the staged file, not yet part of comp/). Anything that isn't
 *  audio, video, or an image (a tracklist .txt, a folder) renders nothing -
 *  the JSON snapshot below already covers non-media proposals. */
function MediaPreview({ label, name, src, loading, error, bytes }: {
  label: string
  name: string
  src: string | null
  loading?: boolean
  error?: boolean
  bytes?: number | null
}): JSX.Element | null {
  const mediaType = getMediaType(name)
  const [meta, setMeta] = useState<string | null>(null)
  const [broken, setBroken] = useState(false)
  useEffect(() => { setMeta(null); setBroken(false) }, [src])

  if (mediaType !== 'image' && mediaType !== 'audio' && mediaType !== 'video') return null

  const failed = error || broken || (!loading && !src)
  const sizeLabel = bytes != null ? formatBytes(bytes) : null

  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1.5">{label}</p>
      {loading ? (
        <div className="h-20 rounded-lg bg-surface-overlay flex items-center justify-center">
          <Loader2 size={16} className="animate-spin text-text-muted" />
        </div>
      ) : failed ? (
        <div className="h-20 rounded-lg bg-surface-overlay flex flex-col items-center justify-center gap-1 text-text-muted">
          <ImageOff size={16} className="opacity-50" />
          <span className="text-[10px]">Preview unavailable</span>
        </div>
      ) : mediaType === 'image' ? (
        <img
          src={src ?? undefined}
          alt=""
          onLoad={(e) => setMeta(`${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`)}
          onError={() => setBroken(true)}
          className="max-h-56 max-w-full rounded-lg border border-[var(--border)] object-contain bg-surface-overlay"
        />
      ) : mediaType === 'video' ? (
        <video
          controls
          src={src ?? undefined}
          preload="metadata"
          onLoadedMetadata={(e) => setMeta(formatDuration(e.currentTarget.duration))}
          onError={() => setBroken(true)}
          className="max-h-56 max-w-full rounded-lg border border-[var(--border)] bg-surface-overlay"
        />
      ) : (
        <audio
          controls
          src={src ?? undefined}
          preload="metadata"
          onLoadedMetadata={(e) => setMeta(formatDuration(e.currentTarget.duration))}
          onError={() => setBroken(true)}
          className="w-full h-9"
        />
      )}
      {(meta || sizeLabel) && !failed && !loading && (
        <p className="text-[10px] text-text-muted mt-1">{[meta, sizeLabel].filter(Boolean).join(' · ')}</p>
      )}
    </div>
  )
}

const FOLDER_LEVEL_TYPES = new Set(['create_folder', 'rename_folder', 'move_folder', 'delete_folder'])
const DESTINATION_TYPES = new Set(['move', 'rename_folder', 'move_folder'])

export default function CompProposalsTab({ embedded = false, onChanged }: { embedded?: boolean; onChanged?: () => void }): JSX.Element {
  const activeChannel = useStore((s) => s.activeChannel)
  const account = useStore((s) => s.account)
  const [status, setStatus] = useState<ProposalStatus | ''>('pending')
  const [proposals, setProposals] = useState<CompFileProposal[]>([])
  const [selected, setSelected] = useState<CompFileProposal | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState<number | null>(null)
  const [reviewNotes, setReviewNotes] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Separate from `error` (review/reverse action failures, shown in the detail
  // pane) - this covers the list fetch itself and has to stay visible even
  // with nothing selected, since a channel-access failure clears the list.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  // Searchable: both sides of a move, who filed it, the staged file's name,
  // the change type as it's labelled on screen ("New file", not "create"), and
  // the raw id so a proposal referenced by number elsewhere can be pulled up.
  // Flattened once per fetch and matched against a deferred query, so typing
  // never waits on the list - same treatment as the song-edit queue.
  const haystacks = useMemo(() => {
    const m = new Map<number, string>()
    for (const p of proposals) {
      m.set(p.id, buildHaystack(
        p.file_path, p.destination_path, p.contributor_username,
        p.staging_filename, userApi.compChangeTypeLabel(p.change_type), p.id,
      ))
    }
    return m
  }, [proposals])

  const deferredQuery = useDeferredValue(query)

  const visible = useMemo(() => (
    deferredQuery.trim()
      ? proposals.filter(p => matchesHaystack(deferredQuery, haystacks.get(p.id)))
      : proposals
  ), [proposals, haystacks, deferredQuery])

  useEffect(() => {
    setLoading(true)
    setLoadError(null)
    userApi.adminListCompProposals(status || undefined, activeChannel)
      .then(rows => {
        setProposals(rows)
        // Reviewing a proposal reloads the list and moves the selection, so
        // the notes box has to reset with it - otherwise the text typed for
        // the proposal just approved rides along into the next Approve.
        setSelected(rows[0] ?? null)
        setReviewNotes('')
      })
      .catch((e) => {
        setLoadError(e instanceof Error ? e.message : 'Could not load comp proposals')
        // Don't leave the previous channel's list on screen underneath the
        // error - its approve/reject actions would still be live against the
        // wrong channel context.
        setProposals([])
        setSelected(null)
      })
      .finally(() => setLoading(false))
  }, [status, refreshKey, activeChannel])

  // Searching can filter the selected proposal out from under the detail pane,
  // which would otherwise leave Approve/Reject pointed at a row no longer in
  // the list. Fall through to the first match, resetting the notes box with it
  // for the same reason the fetch above does.
  useEffect(() => {
    if (selected && visible.some(v => v.id === selected.id)) return
    setSelected(visible[0] ?? null)
    setReviewNotes('')
    setError(null)
  }, [visible, selected])

  const reload = (): void => {
    setRefreshKey(k => k + 1)
    onChanged?.()
  }

  // The review/reverse endpoints hand back the updated row, so the list can
  // reflect it immediately instead of waiting on the reload() round-trip
  // below - that fetch still runs (for the row's neighbors and to reconcile
  // final ordering), it just no longer gates how long the acted-on row keeps
  // showing as pending. Dropped from view outright when it no longer matches
  // the current status filter, same as the server-side list would show.
  const applyReviewResult = (updated: CompFileProposal): void => {
    setProposals(prev => {
      const next = prev.map(p => p.id === updated.id ? updated : p)
      return status && updated.status !== status ? next.filter(p => p.id !== updated.id) : next
    })
  }

  const doReview = async (id: number, action: 'approve' | 'reject'): Promise<void> => {
    setActionId(id)
    setError(null)
    try {
      const updated = await userApi.adminReviewCompProposal(id, { action, review_notes: reviewNotes, channel: activeChannel })
      applyReviewResult(updated)
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not ${action} this proposal`)
    } finally {
      setActionId(null)
    }
  }

  const doReverse = async (id: number): Promise<void> => {
    setActionId(id)
    setError(null)
    try {
      const updated = await userApi.adminReverseCompProposal(id, activeChannel)
      applyReviewResult(updated)
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reverse this proposal')
    } finally {
      setActionId(null)
    }
  }

  const downloadStaging = (p: CompFileProposal): void => {
    const token = getToken()
    const url = userApi.adminCompProposalStagingUrl(p.id, activeChannel)
    fetch(url, { headers: token ? { Authorization: `Token ${token}` } : {} })
      .then(r => r.blob())
      .then(blob => {
        const href = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = href
        a.download = p.staging_filename || 'staged-file'
        // Anchor has to be in the document for the click to count in some
        // browsers, and the object URL has to outlive the click - revoking it
        // on the same tick cancels the download before it starts.
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(href), 60_000)
      })
      .catch(() => {})
  }

  // The proposed file only exists in staging while the proposal is pending
  // (approval moves it into comp/, rejection discards it) - matches the same
  // condition the existing "Staged file" download button already gates on.
  const stagingUrl = selected && selected.staging_filename && selected.status === 'pending'
    ? userApi.adminCompProposalStagingUrl(selected.id, activeChannel)
    : null
  const staged = useAuthedBlobUrl(stagingUrl)

  const p = selected

  // delete_folder is gated beyond the normal per-tab role check the rest of
  // this queue relies on (any editor/manager who can see the tab can approve
  // everything else): only a full administrator may approve it, and never
  // the admin who filed it. Wording matches the backend's 403 `detail`
  // strings verbatim so the client-side gate and the defense-in-depth server
  // error read as the same restriction.
  const approveBlockedReason = p && p.change_type === 'delete_folder'
    ? (!account?.is_administrator
        ? 'Folder deletions require administrator approval'
        : account?.id === p.contributor_id
          ? 'Folder deletions must be approved by a different administrator'
          : null)
    : null

  return (
    <div className={`flex-1 min-w-0 h-full flex flex-col overflow-hidden ${embedded ? '' : 'bg-[var(--surface)]'}`}>
      {loadError && (
        <div className="mx-3 mt-3 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs shrink-0">
          <AlertCircle size={13} className="shrink-0 mt-0.5" /> {loadError}
        </div>
      )}
      <div className="flex-1 min-w-0 flex overflow-hidden">
      <div className="w-72 shrink-0 border-r border-[var(--border)] flex flex-col">
        <div className="shrink-0 p-3 border-b border-[var(--border)] flex flex-col gap-2">
          {/* Wraps: five chips don't fit the 18rem column, and the last one
              ("all") was running off the edge. */}
          <div className="flex flex-wrap gap-1">
            {(['pending', 'approved', 'rejected', 'reversed', ''] as const).map(s => (
              <button key={s || 'all'} onClick={() => setStatus(s)}
                className={`px-2 py-1 rounded text-[10px] font-semibold capitalize shrink-0 ${status === s ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary'}`}>
                {s || 'all'}
              </button>
            ))}
          </div>
          <QueueSearch value={query} onChange={setQuery} placeholder="Search path, contributor…"
            matches={visible.length} total={proposals.length} />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="flex justify-center py-8"><Loader2 className="animate-spin text-text-muted" size={18} /></div>}
          {!loading && proposals.length === 0 && <Empty label="No comp proposals" />}
          {!loading && proposals.length > 0 && visible.length === 0 && <Empty label="No matches" />}
          {visible.map(item => (
            <button key={item.id} onClick={() => { setSelected(item); setReviewNotes(''); setError(null) }}
              className={`w-full text-left px-3 py-3 border-b border-[var(--border)] transition-colors ${selected?.id === item.id ? 'bg-accent/10' : 'hover:bg-surface-raised'}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <StatusChip status={item.status} />
                <span className="text-[9px] text-text-muted bg-surface-raised px-1.5 py-0.5 rounded">{userApi.compChangeTypeLabel(item.change_type)}</span>
              </div>
              <p className="text-[11px] font-mono text-text-primary truncate">{item.file_path}</p>
              {DESTINATION_TYPES.has(item.change_type) && item.destination_path && (
                <p className="text-[10px] font-mono text-text-muted truncate">→ {item.destination_path}</p>
              )}
              <p className="text-[10px] text-text-muted truncate">{item.contributor_username} · {relativeTime(item.created_at)}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {!p ? (
          <Empty label="Select a comp proposal" />
        ) : (
          <>
            <div className="shrink-0 px-6 py-4 border-b border-[var(--border)]">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <StatusChip status={p.status} />
                    <span className="text-[10px] text-text-muted bg-surface-raised px-2 py-0.5 rounded">{userApi.compChangeTypeLabel(p.change_type)}</span>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <h2 className="text-text-primary font-bold text-base font-mono break-all">{p.file_path}</h2>
                    <span className="shrink-0 mt-1"><CopyButton text={p.file_path} label="path" /></span>
                  </div>
                  {DESTINATION_TYPES.has(p.change_type) && p.destination_path && (
                    <div className="flex items-start gap-1.5 mt-1">
                      <p className="text-text-muted font-mono text-sm break-all">→ {p.destination_path}</p>
                      <span className="shrink-0 mt-0.5"><CopyButton text={p.destination_path} label="destination path" /></span>
                    </div>
                  )}
                  <div className="flex items-center gap-4 mt-1.5 text-[11px] text-text-muted flex-wrap">
                    <span>by {p.contributor_username}</span>
                    <span className="flex items-center gap-1"><Calendar size={10} />{shortDate(p.created_at)}</span>
                    {p.applied_commit_id && (
                      <span className="flex items-center gap-1">
                        <Hash size={10} />{p.applied_commit_id}
                        <CopyButton text={p.applied_commit_id} label="commit id" />
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {p.staging_filename && p.status === 'pending' && (
                    <button onClick={() => downloadStaging(p)} className="px-3 py-1.5 rounded-lg text-xs text-text-muted hover:text-text-primary border border-[var(--border)] flex items-center gap-1.5">
                      <Download size={13} /> Staged file
                    </button>
                  )}
                  {p.status === 'pending' && (
                    actionId === p.id ? <Loader2 size={14} className="animate-spin text-text-muted" /> : (
                      <>
                        <button onClick={() => doReview(p.id, 'reject')} className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 text-xs font-semibold flex items-center gap-1.5">
                          <XCircle size={13} /> Reject
                        </button>
                        {!approveBlockedReason && (
                          <button onClick={() => doReview(p.id, 'approve')} className="px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 text-xs font-semibold flex items-center gap-1.5">
                            <CheckCircle size={13} /> Approve
                          </button>
                        )}
                      </>
                    )
                  )}
                  {p.status === 'approved' && (
                    <button onClick={() => doReverse(p.id)} disabled={actionId === p.id}
                      className="px-3 py-1.5 rounded-lg text-xs text-text-muted hover:text-amber-400 flex items-center gap-1.5">
                      {actionId === p.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Reverse
                    </button>
                  )}
                </div>
              </div>
              <textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} rows={2} placeholder="Review notes (optional)"
                className="mt-3 w-full rounded-lg border border-[var(--border)] bg-surface-overlay px-3 py-2 text-xs text-text-primary focus:outline-none resize-none" />
              {approveBlockedReason && (
                <p className="mt-2 text-xs text-amber-400 flex items-center gap-1.5"><AlertCircle size={12} />{approveBlockedReason}</p>
              )}
              {error && (
                <p className="mt-2 text-xs text-red-400 flex items-center gap-1.5"><AlertCircle size={12} />{error}</p>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-sm">
              {/* "Current" is the file already in comp/ - meaningful context for
                  a replace, move, or delete (what's about to change or vanish),
                  and for a plain upload it's simply not there yet, so the public
                  fetch 404s and the slot quietly shows "unavailable". */}
              {!FOLDER_LEVEL_TYPES.has(p.change_type) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <MediaPreview label="Current file" name={p.file_path} src={buildStreamUrl(p.file_path, activeChannel)} />
                  {p.staging_filename && (
                    <MediaPreview
                      label="Proposed file"
                      name={p.staging_filename}
                      src={staged.src}
                      loading={p.status === 'pending' && staged.loading}
                      error={p.status !== 'pending' || staged.error}
                      bytes={staged.bytes}
                    />
                  )}
                </div>
              )}
              {p.contributor_notes && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1 flex items-center gap-1.5">
                    Contributor notes <CopyButton text={p.contributor_notes} label="contributor notes" />
                  </p>
                  <p className="text-text-secondary whitespace-pre-wrap">{p.contributor_notes}</p>
                </div>
              )}
              {(p.change_type === 'move_folder' || p.change_type === 'delete_folder') && Array.isArray(p.original_snapshot?.files) && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1 flex items-center gap-1.5">
                    Affected files ({(p.original_snapshot.files as string[]).length})
                    <CopyButton text={(p.original_snapshot.files as string[]).join('\n')} label="affected files" />
                  </p>
                  <ul className="text-xs font-mono text-text-muted bg-surface-overlay rounded-lg p-3 max-h-56 overflow-y-auto space-y-0.5">
                    {(p.original_snapshot.files as string[]).map((f) => (
                      <li key={f} className="truncate">{f}</li>
                    ))}
                  </ul>
                </div>
              )}
              {Object.keys(p.original_snapshot || {}).length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1 flex items-center gap-1.5">
                    Original snapshot <CopyButton text={JSON.stringify(p.original_snapshot, null, 2)} label="original snapshot" />
                  </p>
                  <pre className="text-xs font-mono text-text-muted bg-surface-overlay rounded-lg p-3 overflow-x-auto">{JSON.stringify(p.original_snapshot, null, 2)}</pre>
                </div>
              )}
              {p.review_notes && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1 flex items-center gap-1.5">
                    Review notes <CopyButton text={p.review_notes} label="review notes" />
                  </p>
                  <p className="text-text-secondary whitespace-pre-wrap">{p.review_notes}</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  )
}
