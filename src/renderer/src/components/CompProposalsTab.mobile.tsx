import { useEffect, useState } from 'react'
import {
  Loader2, CheckCircle, XCircle, RotateCcw, Download, Calendar, Hash, AlertCircle, ChevronLeft, ImageOff,
} from 'lucide-react'
import * as userApi from '../lib/userApi'
import type { CompFileProposal } from '../lib/userApi'
import { relativeTime, shortDate, StatusChip, Empty, CopyButton } from './adminShared'
import { useBackToClose } from '../hooks/useBackToClose'
import { buildStreamUrl } from '../lib/juicewrldApi'
import { useStore } from '../store/useStore'
import { getMediaType } from '../lib/fileTypes'
import { formatBytes, formatDuration } from '../lib/format'
import { useAuthedBlobUrl, useCompProposalsQueue } from '../hooks/useCompProposalsQueue'
import { FOLDER_LEVEL_TYPES, DESTINATION_TYPES, compApproveBlockedReason } from '../lib/compProposalShared'

/** One preview slot - a live comp/ path (plain <img>/<audio> against the
 *  public download URL, same as FilePickerModal's thumbnails) or an authed
 *  blob (the staged file, not yet part of comp/). Anything that isn't audio
 *  or an image (a tracklist .txt, a folder) renders nothing - the JSON
 *  snapshot below already covers non-media proposals. */
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

  if (mediaType !== 'image' && mediaType !== 'audio') return null

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

export default function CompProposalsTab({ embedded = false, onChanged }: { embedded?: boolean; onChanged?: () => void }): JSX.Element {
  const activeChannel = useStore((s) => s.activeChannel)
  const account = useStore((s) => s.account)
  const {
    status, setStatus, proposals, selected, setSelected, loading, actionId,
    reviewNotes, setReviewNotes, error, setError, loadError,
    doReview, doReverse, downloadStaging, bulkApproving, doAcceptAll,
  } = useCompProposalsQueue(activeChannel, onChanged, false)

  // The proposed file only exists in staging while the proposal is pending
  // (approval moves it into comp/, rejection discards it) - matches the same
  // condition the existing "Staged file" download button already gates on.
  const stagingUrl = selected && selected.staging_filename && selected.status === 'pending'
    ? userApi.adminCompProposalStagingUrl(selected.id, activeChannel)
    : null
  const staged = useAuthedBlobUrl(stagingUrl)

  const p = selected
  const approveBlockedReason = compApproveBlockedReason(p, account)

  // Every other pending proposal from the same contributor, minus anything
  // this reviewer isn't allowed to approve (delete_folder gating).
  const pendingFromContributor = p
    ? proposals.filter(x => x.contributor_username === p.contributor_username && x.status === 'pending' && !compApproveBlockedReason(x, account))
    : []

  const doAcceptAllForContributor = (): void => {
    const ids = pendingFromContributor.map(x => x.id)
    if (ids.length === 0) return
    if (!confirm(`Approve all ${ids.length} pending comp proposal${ids.length !== 1 ? 's' : ''} from ${p!.contributor_username}?`)) return
    doAcceptAll(ids)
  }

  useBackToClose(() => setSelected(null), p != null)

  if (p) return (
    <div className={`flex-1 min-w-0 h-full flex flex-col overflow-hidden ${embedded ? '' : 'bg-[var(--surface)]'}`}>
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border)]">
        <button onClick={() => setSelected(null)}
          className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-primary active:bg-surface-overlay transition-colors">
          <ChevronLeft size={20} />
        </button>
        <h2 className="flex-1 min-w-0 truncate text-text-primary text-[14px] font-bold font-mono">{p.file_path}</h2>
        <StatusChip status={p.status} />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-text-muted bg-surface-overlay px-2 py-0.5 rounded font-semibold">{userApi.compChangeTypeLabel(p.change_type)}</span>
          <span className="text-xs text-text-muted">by {p.contributor_username}</span>
          <span className="flex items-center gap-1 text-xs text-text-muted"><Calendar size={10} />{shortDate(p.created_at)}</span>
          {p.applied_commit_id && (
            <span className="flex items-center gap-1 text-xs text-text-muted">
              <Hash size={10} />{p.applied_commit_id}
              <CopyButton text={p.applied_commit_id} label="commit id" />
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <p className="text-text-primary font-mono text-xs break-all">{p.file_path}</p>
          <CopyButton text={p.file_path} label="path" />
        </div>

        {DESTINATION_TYPES.has(p.change_type) && p.destination_path && (
          <div className="flex items-center gap-1.5">
            <p className="text-text-muted font-mono text-sm break-all">→ {p.destination_path}</p>
            <CopyButton text={p.destination_path} label="destination path" />
          </div>
        )}

        {/* "Current" is the file already in comp/ - meaningful context for a
            replace, move, or delete (what's about to change or vanish), and
            for a plain upload it's simply not there yet, so the public fetch
            404s and the slot quietly shows "unavailable". Folder-level ops
            have no single-file preview. */}
        {!FOLDER_LEVEL_TYPES.has(p.change_type) && (
          <div className="grid grid-cols-1 gap-3">
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

        {p.staging_filename && p.status === 'pending' && (
          <button onClick={() => downloadStaging(p)}
            className="w-full h-10 rounded-lg text-sm text-text-secondary active:bg-surface-raised border border-[var(--border)] flex items-center justify-center gap-1.5">
            <Download size={14} /> Staged file
          </button>
        )}

        {p.contributor_notes && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1 flex items-center gap-1.5">
              Contributor notes <CopyButton text={p.contributor_notes} label="contributor notes" />
            </p>
            <p className="text-text-secondary text-sm whitespace-pre-wrap">{p.contributor_notes}</p>
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
            <p className="text-text-secondary text-sm whitespace-pre-wrap">{p.review_notes}</p>
          </div>
        )}

        {p.status === 'pending' && (
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Review note</span>
            <textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} rows={3} placeholder="Optional…"
              className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-surface-overlay px-3 py-2.5 text-sm text-text-primary focus:outline-none resize-none" />
          </label>
        )}

        {approveBlockedReason && (
          <p className="text-xs text-amber-400 flex items-center gap-1.5"><AlertCircle size={12} />{approveBlockedReason}</p>
        )}
        {error && (
          <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertCircle size={12} />{error}</p>
        )}
      </div>

      <div className="shrink-0 p-3 border-t border-[var(--border)] flex flex-col gap-2">
        {actionId === p.id || bulkApproving ? (
          <div className="flex justify-center py-2.5"><Loader2 size={16} className="animate-spin text-text-muted" /></div>
        ) : p.status === 'pending' ? (
          <>
            <div className="flex items-center gap-2">
              <button onClick={() => doReview(p.id, 'reject')}
                className="flex-1 h-11 rounded-xl bg-red-500/10 active:bg-red-500/20 text-red-400 text-sm font-semibold flex items-center justify-center gap-1.5">
                <XCircle size={15} /> Reject
              </button>
              {!approveBlockedReason && (
                <button onClick={() => doReview(p.id, 'approve')}
                  className="flex-1 h-11 rounded-xl bg-emerald-500/15 active:bg-emerald-500/25 text-emerald-400 text-sm font-semibold flex items-center justify-center gap-1.5">
                  <CheckCircle size={15} /> Approve
                </button>
              )}
            </div>
            {pendingFromContributor.length > 1 && (
              <button onClick={doAcceptAllForContributor}
                className="w-full h-10 rounded-xl bg-emerald-500/10 active:bg-emerald-500/20 text-emerald-400 text-sm font-semibold flex items-center justify-center gap-1.5">
                <CheckCircle size={14} /> Accept all ({pendingFromContributor.length}) from {p.contributor_username}
              </button>
            )}
          </>
        ) : p.status === 'approved' ? (
          <button onClick={() => doReverse(p.id)} disabled={actionId === p.id}
            className="w-full h-11 rounded-xl text-sm text-text-muted active:text-amber-400 active:bg-amber-500/10 flex items-center justify-center gap-1.5">
            <RotateCcw size={15} /> Reverse
          </button>
        ) : null}
      </div>
    </div>
  )

  return (
    <div className={`flex-1 min-w-0 h-full flex flex-col overflow-hidden ${embedded ? '' : 'bg-[var(--surface)]'}`}>
      <div className="shrink-0 p-3 border-b border-[var(--border)] flex gap-2 overflow-x-auto scrollbar-none">
        {(['pending', 'approved', 'rejected', 'reversed', ''] as const).map(s => (
          <button key={s || 'all'} onClick={() => setStatus(s)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold capitalize transition-colors ${status === s ? 'bg-accent/15 text-accent' : 'text-text-muted bg-surface-overlay'}`}>
            {s || 'all'}
          </button>
        ))}
      </div>
      {loadError && (
        <div className="mx-3 mt-3 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs shrink-0">
          <AlertCircle size={13} className="shrink-0 mt-0.5" /> {loadError}
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="flex justify-center py-8"><Loader2 className="animate-spin text-text-muted" size={18} /></div>}
        {!loading && proposals.length === 0 && <Empty label="No comp proposals" />}
        {proposals.map(item => (
          <button key={item.id} onClick={() => { setSelected(item); setReviewNotes(''); setError(null) }}
            className="w-full text-left px-3 py-3 border-b border-[var(--border)] transition-colors active:bg-surface-raised">
            <div className="flex items-center gap-1.5 mb-1">
              <StatusChip status={item.status} />
              <span className="text-[9px] text-text-muted bg-surface-raised px-1.5 py-0.5 rounded">{userApi.compChangeTypeLabel(item.change_type)}</span>
            </div>
            <p className="text-[12px] font-mono text-text-primary truncate">{item.file_path}</p>
            {DESTINATION_TYPES.has(item.change_type) && item.destination_path && (
              <p className="text-[10px] font-mono text-text-muted truncate">→ {item.destination_path}</p>
            )}
            <p className="text-[10px] text-text-muted truncate">{item.contributor_username} · {relativeTime(item.created_at)}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
