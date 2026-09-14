// Small UI pieces shared between AdminPage's tabs and ReportsTab (the latter
// is also embedded standalone in EditorProfileView for editor-only accounts).
import { useState } from 'react'
import { Search, X as XIcon, Copy, Check } from 'lucide-react'

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
