import { useState, useRef, useEffect, useContext } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { DocsSearchContext, useHighlight, highlightText, highlightChildren } from './searchContext'
import { Badge } from './shared'

export function Code({ children }: { children: string }) {
  return (
    <code className="bg-[var(--surface-raised)] text-accent border border-[var(--border)] text-[11px] font-mono px-1.5 py-0.5 rounded break-all">
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
    <div className="rounded-2xl overflow-hidden bg-[var(--surface-overlay)]" hidden={!hit}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3.5 active:bg-[var(--surface-raised)] transition-colors text-left"
      >
        <span className="text-text-primary font-semibold text-sm">{highlightText(title, query)}</span>
        {expanded ? <ChevronDown size={16} className="text-text-muted shrink-0" /> : <ChevronRight size={16} className="text-text-muted shrink-0" />}
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
        <code className="text-[12px] font-mono text-text-primary break-all">{hl(path)}</code>
        <p className="text-xs text-text-muted mt-0.5">{hl(description)}</p>
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
      <code className="text-xs font-mono text-text-primary break-all">{path}</code>
    </div>
  )
}
