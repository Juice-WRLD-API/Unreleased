// Small UI pieces shared between AdminPage's tabs and ReportsTab (the latter
// is also embedded standalone in EditorProfileView for editor-only accounts).
import { useState, memo } from 'react'
import { Search, X as XIcon, Copy, Check, Minus, Plus } from 'lucide-react'
import type { SongEditProposal } from '../lib/userApi'

// A field's raw value, not the JSX rendering of it (which may drop blank
// lines, truncate, or otherwise reformat for display) - copying is for
// pasting the real value somewhere else, so callers should always pass the
// untruncated string regardless of what's currently visible on screen.
export function CopyButton({ text, label }: { text: string; label: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        })
      }}
      title={`Copy ${label}`}
      className="p-0.5 rounded text-inherit opacity-60 hover:opacity-100 transition-opacity"
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
    </button>
  )
}

export function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  const d = Date.now() - new Date(iso).getTime()
  const m = Math.floor(d / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function shortDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export const STATUS_STYLE: Record<string, { bg: string; text: string; dot: string; border: string }> = {
  pending:  { bg: 'bg-amber-500/10',   text: 'text-amber-400',   dot: 'bg-amber-400',   border: 'border-l-amber-500/60' },
  approved: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400', border: 'border-l-emerald-500/60' },
  resolved: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400', border: 'border-l-emerald-500/60' },
  rejected: { bg: 'bg-red-500/10',     text: 'text-red-400',     dot: 'bg-red-400',     border: 'border-l-red-500/50' },
  reversed: { bg: 'bg-zinc-500/10',    text: 'text-zinc-400',    dot: 'bg-zinc-500',    border: 'border-l-zinc-500/40' },
}

export function StatusChip({ status }: { status: string }): JSX.Element {
  const s = STATUS_STYLE[status] ?? { bg: 'bg-surface-raised', text: 'text-text-muted', dot: 'bg-text-muted', border: '' }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {status}
    </span>
  )
}

export function Avatar({ src, name, size = 8 }: { src?: string; name: string; size?: number }): JSX.Element {
  const cls = `w-${size} h-${size} rounded-full shrink-0`
  return src
    ? <img src={src} alt="" className={`${cls} object-cover`} />
    : <div className={`${cls} bg-accent/20 text-accent flex items-center justify-center text-xs font-bold`}>
        {(name || '?')[0].toUpperCase()}
      </div>
}

export function Empty({ label }: { label: string }): JSX.Element {
  return <div className="flex items-center justify-center h-full text-text-muted text-sm">{label}</div>
}

/** Flattens a row's searchable fields into one lowercase string.
 *
 *  Kept separate from the matching so callers can build it once per row when
 *  the data changes, instead of re-lowercasing every field of every row on
 *  every keystroke - on the unfiltered "All" proposals list that was thousands
 *  of string allocations per character typed. */
export function buildHaystack(...fields: (string | number | null | undefined)[]): string {
  let out = ''
  for (const f of fields) {
    if (f == null || f === '') continue
    out += (out ? ' ' : '') + String(f).toLowerCase()
  }
  return out
}

/** Case-insensitive match of every whitespace-separated term in `query`
 *  against a haystack from buildHaystack. Terms are AND-ed, not OR-ed, so
 *  "jane move" narrows to jane's move proposals instead of returning both
 *  sets. An empty query matches everything. */
export function matchesHaystack(query: string, hay: string | undefined): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (!hay) return false
  // Single-term is the overwhelmingly common case - skip the split/allocation.
  if (!/\s/.test(q)) return hay.includes(q)
  return q.split(/\s+/).every(term => hay.includes(term))
}

/** buildHaystack + matchesHaystack in one call, for lists small enough that
 *  caching the haystack isn't worth the bookkeeping. */
export function matchesQuery(query: string, ...fields: (string | number | null | undefined)[]): boolean {
  if (!query.trim()) return true
  return matchesHaystack(query, buildHaystack(...fields))
}

/** Search box for the review queues' left column. Filtering is client-side
 *  over the rows already loaded - neither the song-edit nor the comp-file list
 *  endpoint takes a query param, and the status filter beside it is what
 *  decides which rows get fetched in the first place. So this searches the
 *  current status bucket, not the whole archive. */
export function QueueSearch({ value, onChange, placeholder, matches, total }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  matches: number
  total: number
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="relative flex items-center">
      <Search size={12} className="absolute left-2.5 text-text-muted pointer-events-none" />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        // Escape clears rather than blurs - the list is the thing being
        // filtered, so getting back to "everything" shouldn't cost a mouse trip.
        onKeyDown={e => { if (e.key === 'Escape' && value) { e.stopPropagation(); onChange('') } }}
        placeholder={placeholder}
        spellCheck={false}
        className="w-full bg-surface-overlay rounded-md pl-7 pr-7 py-1.5 text-[11px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/40 transition-shadow"
      />
      {value && (
        <button onClick={() => onChange('')} title="Clear search"
          className="absolute right-1.5 p-0.5 rounded text-text-muted hover:text-text-primary transition-colors">
          <XIcon size={11} />
        </button>
      )}
      </div>
      {value.trim() !== '' && (
        <span className="px-1 text-[9px] text-text-muted">{matches} of {total}</span>
      )}
    </div>
  )
}

export function AppSection({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1.5">{label}</p>
      <p className="text-text-primary text-sm leading-relaxed whitespace-pre-wrap">{value}</p>
    </div>
  )
}

// ── Proposal diff ────────────────────────────────────────────────────────────
// Renders a proposal's proposed_data against its original_snapshot, field by
// field. Used by AdminPage's review queue and by EditorProfileView's "view
// proposal" panel (the same diff a reviewer sees, for the editor who filed it).

function renderValue(v: unknown): string {
  if (v == null || v === '') return '(empty)'
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.length ? v.join('\n') : '(empty)'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return JSON.stringify(v, null, 2)
}

const LONG_KEYS = new Set(['lyrics', 'synced_lyrics', 'description', 'notes', 'additional_information'])
const LONG_THRESHOLD = 200

export function FieldDiff({ fieldKey, before, after, stacked = false }: {
  fieldKey: string; before: unknown; after: unknown
  /** Stacked before/after instead of side-by-side - phone width can't fit two columns. */
  stacked?: boolean
}): JSX.Element {
  const beforeStr = renderValue(before)
  const afterStr  = renderValue(after)
  const unchanged = beforeStr === afterStr
  const isLong    = LONG_KEYS.has(fieldKey) || beforeStr.length > LONG_THRESHOLD || afterStr.length > LONG_THRESHOLD
  // synced_lyrics is LRC - default expanded so content is visible immediately
  const [exp, setExp] = useState(!isLong || fieldKey === 'synced_lyrics')
  const MAX = fieldKey === 'synced_lyrics' ? 60 : 8

  const sliceLong = (s: string) => {
    const lines = s.split('\n')
    if (exp || lines.length <= MAX) return { lines, clipped: false }
    return { lines: lines.slice(0, MAX), clipped: true, total: lines.length }
  }

  const b = sliceLong(beforeStr)
  const a = sliceLong(afterStr)
  const hasBefore = before !== undefined && !unchanged
  const sideBySide = hasBefore && !unchanged

  return (
    <div className="rounded-lg overflow-hidden border border-[var(--border)] text-[11px]">
      {/* Field header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-raised border-b border-[var(--border)]">
        <span className="font-mono text-[10px] text-text-muted tracking-tight">{fieldKey.replace(/_/g, ' ')}</span>
        <div className="flex items-center gap-2">
          {unchanged && (
            <>
              <span className="text-[9px] italic text-text-muted">unchanged</span>
              <CopyButton text={afterStr} label={fieldKey} />
            </>
          )}
          {isLong && (
            <button onClick={() => setExp(e => !e)} className="text-[10px] text-accent/70 hover:text-accent">
              {exp ? 'collapse' : 'expand'}
            </button>
          )}
        </div>
      </div>

      {/* Before / after */}
      {sideBySide && (
        <div className={stacked ? 'grid grid-cols-1 divide-y divide-[var(--border)]' : 'grid grid-cols-2 divide-x divide-[var(--border)]'}>
          {/* Before */}
          <div className="bg-red-500/8 min-w-0">
            <div className="flex items-center gap-1.5 px-3 py-1 border-b border-red-500/15">
              <Minus size={9} className="text-red-500 shrink-0" />
              <span className="text-[9px] font-bold uppercase tracking-wide text-red-500 flex-1">Before</span>
              <CopyButton text={beforeStr} label={`${fieldKey} (before)`} />
            </div>
            <div className="px-3 py-2">
              {b.lines.map((line, i) => (
                <pre key={i} className="font-mono text-red-500 whitespace-pre-wrap break-words leading-relaxed">{line || ' '}</pre>
              ))}
              {'clipped' in b && b.clipped && (
                <p className="text-[9px] text-red-400 italic mt-1">+{(b as { total?: number }).total! - MAX} more lines</p>
              )}
            </div>
          </div>

          {/* After */}
          <div className="bg-emerald-500/8 min-w-0">
            <div className="flex items-center gap-1.5 px-3 py-1 border-b border-emerald-500/15">
              <Plus size={9} className="text-emerald-600 shrink-0" />
              <span className="text-[9px] font-bold uppercase tracking-wide text-emerald-600 flex-1">After</span>
              <CopyButton text={afterStr} label={`${fieldKey} (after)`} />
            </div>
            <div className="px-3 py-2">
              {a.lines.map((line, i) => (
                <pre key={i} className="font-mono text-emerald-600 whitespace-pre-wrap break-words leading-relaxed">{line || ' '}</pre>
              ))}
              {'clipped' in a && a.clipped && (
                <p className="text-[9px] text-emerald-500 italic mt-1">+{(a as { total?: number }).total! - MAX} more lines</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* New value only (no snapshot) */}
      {!unchanged && !hasBefore && (
        <div className="bg-emerald-500/8">
          <div className="flex items-center gap-1.5 px-3 py-1 border-b border-emerald-500/15">
            <Plus size={9} className="text-emerald-600 shrink-0" />
            <span className="text-[9px] font-bold uppercase tracking-wide text-emerald-600 flex-1">Value</span>
            <CopyButton text={afterStr} label={fieldKey} />
          </div>
          <div className="px-3 py-2">
            {a.lines.map((line, i) => (
              <pre key={i} className="font-mono text-emerald-600 whitespace-pre-wrap break-words leading-relaxed">{line || ' '}</pre>
            ))}
          </div>
        </div>
      )}

      {/* Unchanged */}
      {unchanged && (
        <div className="px-3 py-2">
          <pre className="font-mono text-text-muted whitespace-pre-wrap break-words leading-relaxed">
            {exp ? afterStr : afterStr.slice(0, 120) + (afterStr.length > 120 ? '…' : '')}
          </pre>
        </div>
      )}
    </div>
  )
}

// Memoized: a proposal touching lyrics renders two full lyric bodies side by
// side, and this can sit alongside a live search box - so without it every
// keystroke re-rendered the entire diff of whatever was selected.
export const ProposalDiff = memo(function ProposalDiff({ proposal, stacked = false }: { proposal: SongEditProposal; stacked?: boolean }): JSX.Element {
  const entries = Object.entries(proposal.proposed_data || {})
  if (!entries.length) return <p className="text-text-muted text-xs italic p-4">No field data.</p>
  const snap = proposal.original_snapshot || {}
  return (
    <div className="space-y-2 p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-3">
        Changes · {entries.length} field{entries.length !== 1 ? 's' : ''}
      </p>
      {entries.map(([k, v]) => <FieldDiff key={k} fieldKey={k} before={snap[k]} after={v} stacked={stacked} />)}
    </div>
  )
})
