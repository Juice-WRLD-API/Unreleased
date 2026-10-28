import { useState, useRef, useEffect, useContext } from 'react'
import { ChevronRight } from 'lucide-react'
import { DocsSearchContext, useHighlight, highlightText, highlightChildren } from './searchContext'
import { Badge } from './shared'

export function Code({ children }: { children: string }) {
  return (
    <code className="bg-[var(--fill)] text-accent text-[12px] font-mono px-1.5 py-0.5 rounded-md break-all">
      {children}
    </code>
  )
}

export function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const { query, tab, register } = useContext(DocsSearchContext)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useState('')

  // The body is always in the DOM (hidden via `hidden` rather than unmounted)
  // so collapsed sections are still indexed and still findable by search.
  useEffect(() => {
    const t = (bodyRef.current?.textContent ?? '').toLowerCase()
    setText(t)
    register(`${tab}:${title}`, tab, title, t)
  }, [tab, title, register])

  const hit = !query || title.toLowerCase().includes(query) || text.includes(query)
  // While searching, expand matches so the hit is visible without a click -
  // but don't clobber the user's own toggle state for when the search clears.
  const expanded = query ? true : open

  return (
    <div className="rounded-[20px] overflow-hidden bg-[var(--grouped)]" hidden={!hit}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 min-h-[48px] py-3 active:bg-[var(--fill)] transition-colors text-left"
      >
        <span className="text-headline text-text-primary">{highlightText(title, query)}</span>
        {/* One chevron that turns, as iOS disclosure rows do. */}
        <ChevronRight size={18} strokeWidth={2.5} className={`text-text-muted opacity-60 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
      </button>
      <div ref={bodyRef} hidden={!expanded} className="px-4 pb-4 space-y-4">
        {highlightChildren(children, query)}
      </div>
    </div>
  )
}

export function Endpoint({ method, path, description }: { method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'; path: string; description: string }) {
  const hl = useHighlight()
  return (
    <div className="flex items-start gap-3 py-2">
      <Badge color={method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch'}>{method}</Badge>
      <div className="min-w-0 flex-1">
        <code className="text-[13px] font-mono text-text-primary break-all">{hl(path)}</code>
        <p className="text-footnote text-text-secondary mt-0.5">{hl(description)}</p>
      </div>
    </div>
  )
}

// Inline "METHOD /path/" header used ad hoc inside a Section body (ZIP
// operations, Who Am I, Feedback, etc.) - same visual language as Endpoint
// above but without its description line.
export function MethodPath({ method, path, className = '' }: { method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'; path: string; className?: string }) {
  return (
    <div className={`flex items-center gap-2 mb-1 ${className}`}>
      <Badge color={method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch'}>{method}</Badge>
      <code className="text-[13px] font-mono text-text-primary break-all">{path}</code>
    </div>
  )
}
