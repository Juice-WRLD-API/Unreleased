import { useHighlight, useHighlightNodes } from './searchContext'

// ─── Small reusable primitives (identical on desktop and mobile) ─────────────

export function Badge({ children, color = 'default' }: { children: string; color?: 'get' | 'post' | 'put' | 'delete' | 'patch' | 'default' }) {
  const styles: Record<string, string> = {
    get:     'bg-emerald-500/15 text-emerald-500 border border-emerald-500/25',
    post:    'bg-blue-500/15 text-blue-400 border border-blue-500/25',
    put:     'bg-violet-500/15 text-violet-400 border border-violet-500/25',
    delete:  'bg-red-500/15 text-red-400 border border-red-500/25',
    patch:   'bg-amber-500/15 text-amber-400 border border-amber-500/25',
    default: 'bg-[var(--surface-raised)] text-text-muted border border-[var(--border)]',
  }
  return (
    <span className={`inline-block text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded font-mono ${styles[color]}`}>
      {children}
    </span>
  )
}

export function Pre({ children }: { children: string }) {
  return (
    <pre className="bg-[var(--surface-raised)] border border-[var(--border)] rounded-xl text-[11px] font-mono text-text-secondary p-4 overflow-x-auto whitespace-pre leading-relaxed">
      {children}
    </pre>
  )
}

export function Table({ headers, rows }: { headers: string[]; rows: (string | JSX.Element)[][] }) {
  const hl = useHighlight()
  const hlNodes = useHighlightNodes()
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[var(--surface-raised)] border-b border-[var(--border)]">
            {headers.map(h => (
              <th key={h} className="text-left px-4 py-2.5 text-text-muted text-xs font-semibold uppercase tracking-wide">{hl(h)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={`border-b border-[var(--border)] last:border-0 ${i % 2 === 0 ? '' : 'bg-[var(--surface-raised)]/40'}`}>
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2.5 text-text-secondary align-top">
                  {typeof cell === 'string' ? hl(cell) : hlNodes(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
