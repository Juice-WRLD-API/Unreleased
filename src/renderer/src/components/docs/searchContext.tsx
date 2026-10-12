import { createContext, useContext, useCallback, Children, isValidElement, cloneElement } from 'react'

// ─── Cross-tab search ─────────────────────────────────────────────────────────
// Every tab stays mounted (this page is static markup - no fetching, no data
// deps), so each Section can hand its own rendered text to the page on mount
// and search can cover the whole document instead of only the open tab.
// Non-matching sections hide, matching ones force open, and tabs with no hits
// drop out of the tab bar.

export interface DocsSearchValue {
  /** Trimmed + lowercased. Empty string means "not searching". */
  query: string
  /** Which tab the consuming Section lives in. */
  tab: string
  register: (id: string, tab: string, title: string, text: string) => void
}

export const DocsSearchContext = createContext<DocsSearchValue>({ query: '', tab: '', register: () => {} })

// ─── Match highlighting ───────────────────────────────────────────────────────
// `query` is already lowercased; matching is case-insensitive but the original
// casing is what gets rendered. <mark> doesn't affect textContent, so the
// search index Section builds from its own DOM stays unpolluted by highlights.

export function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text
  const lower = text.toLowerCase()
  let idx = lower.indexOf(query)
  if (idx === -1) return text

  const out: React.ReactNode[] = []
  let pos = 0
  let n = 0
  while (idx !== -1) {
    if (idx > pos) out.push(text.slice(pos, idx))
    out.push(
      <mark key={n++} className="bg-accent/25 text-accent rounded-[3px] px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
    )
    pos = idx + query.length
    idx = lower.indexOf(query, pos)
  }
  if (pos < text.length) out.push(text.slice(pos))
  return out
}

// Walks arbitrary JSX and highlights every raw string it contains, cloning
// elements on the way down. Elements that hold their text in props rather than
// children (Table, Endpoint) have no children to walk, so they're returned
// untouched and highlight themselves from context instead - which is also what
// keeps this from double-marking their content.
export function highlightChildren(children: React.ReactNode, query: string): React.ReactNode {
  if (!query) return children
  return Children.map(children, (child) => {
    if (typeof child === 'string') return highlightText(child, query)
    if (!isValidElement(child)) return child
    const kids = (child.props as { children?: React.ReactNode }).children
    if (kids == null) return child
    return cloneElement(child, undefined, highlightChildren(kids, query))
  })
}

/** Highlights a plain string against the active query. */
export function useHighlight(): (text: string) => React.ReactNode {
  const { query } = useContext(DocsSearchContext)
  return useCallback((text: string) => highlightText(text, query), [query])
}

/** Highlights arbitrary JSX (e.g. a Table cell that isn't a plain string). */
export function useHighlightNodes(): (node: React.ReactNode) => React.ReactNode {
  const { query } = useContext(DocsSearchContext)
  return useCallback((node: React.ReactNode) => highlightChildren(node, query), [query])
}
