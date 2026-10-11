import { useMemo, useState } from 'react'
import { Calendar, Hash, MessageSquare, ChevronLeft, Bot, CopyMinus } from 'lucide-react'
import { dedupeAutomatedFeedback, type FeedbackRow } from '../lib/reportsApi'
import type { FeedbackFilter } from '../hooks/useAdminQueue'
import { Empty, AppSection, CopyButton, relativeTime, shortDate } from './adminShared'
import { useBackToClose } from '../hooks/useBackToClose'

// Read-only view of GET /juicewrld/feedback/ - what people sent from Settings >
// Feedback, the chat /feedback command, `devfeedback send`, and the automated
// crash reports ErrorBoundary files on its own. The endpoint has no status or
// review fields, so unlike ReportsTab there's nothing to resolve here.

const FEEDBACK_FILTERS: { id: FeedbackFilter; label: string }[] = [
  { id: 'human', label: 'People' },
  { id: 'automated', label: 'Automated' },
  { id: '', label: 'All' },
]

interface ParsedFeedback {
  category: string | null
  body: string
  version: string | null
}

// submitFeedback folds the category into a "[Bug] " prefix and the app version
// into a trailing " - Unreleased vX" line (the API has no fields for either).
// Split them back out for display; anything that doesn't match (older rows,
// other clients) falls through as plain text.
function parseFeedback(message: string): ParsedFeedback {
  let body = message
  let category: string | null = null
  let version: string | null = null
  const cat = /^\[([^\]\n]{1,24})\]\s*/.exec(body)
  if (cat) { category = cat[1]; body = body.slice(cat[0].length) }
  const ver = /\n+\s*-\s*Unreleased v(\S+)\s*$/.exec(body)
  if (ver) { version = ver[1]; body = body.slice(0, ver.index) }
  return { category, body: body.trim() || message, version }
}

function Meta({ f, p, dupes = 0 }: { f: FeedbackRow; p: ParsedFeedback; dupes?: number }): JSX.Element {
  return (
    <>
      <span className="flex items-center gap-1"><Hash size={10} />{f.id}</span>
      <span className="flex items-center gap-1"><Calendar size={10} />{shortDate(f.created_at ?? null)}</span>
      {p.version && <span>v{p.version}</span>}
      {f.automated && <span className="flex items-center gap-1"><Bot size={10} />Automated</span>}
      {dupes > 0 && <span className="flex items-center gap-1"><CopyMinus size={10} />+{dupes} older {dupes === 1 ? 'duplicate' : 'duplicates'} hidden</span>}
      {f.contact && <span className="flex items-center gap-1"><MessageSquare size={10} />{f.contact}<CopyButton text={f.contact} label="contact" /></span>}
    </>
  )
}

function CategoryChip({ label }: { label: string }): JSX.Element {
  return <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-accent/15 text-accent">{label}</span>
}

export default function FeedbackTab({ feedback: allFeedback, filter, setFilter, stacked = false }: {
  feedback: FeedbackRow[]
  filter: FeedbackFilter
  setFilter: (f: FeedbackFilter) => void
  /** Single-pane list↔detail (mobile) instead of the master-detail split. */
  stacked?: boolean
}): JSX.Element {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // Collapses repeat crash reports (same error) into their newest row. Only
  // automated rows are affected, so the toggle is hidden on the People filter.
  const [hideDupes, setHideDupes] = useState(false)
  const canDedupe = filter !== 'human'
  const { rows: feedback, extra } = useMemo(
    () => (hideDupes && canDedupe ? dedupeAutomatedFeedback(allFeedback) : { rows: allFeedback, extra: new Map<number, number>() }),
    [allFeedback, hideDupes, canDedupe],
  )
  const parsed = useMemo(() => new Map(feedback.map(f => [f.id, parseFeedback(f.message)])), [feedback])
  // Desktop keeps the first row open so the detail pane isn't empty; mobile
  // starts on the list.
  const f = feedback.find(x => x.id === selectedId) ?? (stacked ? undefined : feedback[0])
  const p = f ? parsed.get(f.id)! : null

  useBackToClose(() => setSelectedId(null), stacked && f != null)

  const filters = (
    <div className={`shrink-0 flex gap-1 flex-wrap ${stacked ? 'px-3 py-2 border-b border-[var(--border)]' : 'px-3 py-2.5 border-b border-[var(--border)] bg-surface-raised'}`}>
      {FEEDBACK_FILTERS.map(o => (
        <button key={o.id || 'all'} onClick={() => { setFilter(o.id); setSelectedId(null) }}
          className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
            filter === o.id ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
          }`}>
          {o.label}
        </button>
      ))}
      {canDedupe && (
        <button onClick={() => setHideDupes(v => !v)} title="Show only the newest report of each repeated crash"
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
            hideDupes ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
          }`}>
          <CopyMinus size={11} />Hide dupes
        </button>
      )}
      <span className="ml-auto self-center text-[10px] text-text-muted tabular-nums">{feedback.length}</span>
    </div>
  )

  const list = (
    <div className="flex-1 overflow-y-auto">
      {feedback.length === 0 && <Empty label="No feedback" />}
      {feedback.map(item => {
        const ip = parsed.get(item.id)!
        return (
          <button key={item.id} onClick={() => setSelectedId(item.id)}
            className={`w-full text-left px-3 py-3 border-b border-[var(--border)] transition-colors ${
              !stacked && f?.id === item.id ? 'bg-accent/10' : 'hover:bg-surface-raised active:bg-surface-raised'
            }`}>
            <div className="flex items-center gap-2">
              {ip.category && <CategoryChip label={ip.category} />}
              {item.automated && <Bot size={11} className="shrink-0 text-text-muted" />}
              <p className="text-text-primary text-xs truncate flex-1 min-w-0">{ip.body}</p>
              {extra.get(item.id) && <span className="shrink-0 text-[10px] text-text-muted tabular-nums">×{extra.get(item.id)! + 1}</span>}
            </div>
            <p className="text-text-muted text-[10px] mt-1">
              {relativeTime(item.created_at ?? null)}{item.contact ? ` · ${item.contact}` : ''}
            </p>
          </button>
        )
      })}
    </div>
  )

  if (stacked) {
    if (f && p) return (
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border)]">
          <button onClick={() => setSelectedId(null)}
            className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-primary active:bg-surface-overlay transition-colors">
            <ChevronLeft size={20} />
          </button>
          <h2 className="flex-1 min-w-0 truncate text-text-primary text-[15px] font-bold">Feedback #{f.id}</h2>
          {p.category && <CategoryChip label={p.category} />}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          <div className="flex flex-col gap-1 text-xs text-text-muted"><Meta f={f} p={p} dupes={extra.get(f.id)} /></div>
          <AppSection label="Message" value={p.body} copyText={f.message} />
        </div>
      </div>
    )
    return <div className="flex flex-col h-full overflow-hidden">{filters}{list}</div>
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-80 shrink-0 border-r border-[var(--border)] flex flex-col overflow-hidden">
        {filters}
        {list}
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        {!f || !p ? <Empty label="Select feedback" /> : (
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            <div>
              <div className="flex items-center gap-3 flex-wrap mb-1">
                <h2 className="text-text-primary text-lg font-bold">Feedback #{f.id}</h2>
                {p.category && <CategoryChip label={p.category} />}
              </div>
              <div className="flex items-center gap-4 text-xs text-text-muted flex-wrap"><Meta f={f} p={p} dupes={extra.get(f.id)} /></div>
            </div>
            <hr className="border-[var(--border)]" />
            <AppSection label="Message" value={p.body} copyText={f.message} />
          </div>
        )}
      </div>
    </div>
  )
}
