import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Styled Markdown renderer for post bodies. react-markdown builds real React
// elements (no dangerouslySetInnerHTML) and, since we don't add rehype-raw,
// strips any raw HTML in the source - so untrusted-ish editor content can't
// inject markup. GFM adds tables, task lists, strikethrough and autolinks.

// Only allow protocols that are safe to open; anything else (javascript:,
// data:, etc.) is dropped so a crafted link can't run code.
function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined
  try {
    const url = new URL(href, 'https://x.invalid')
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? href : undefined
  } catch {
    return undefined
  }
}

const components: Components = {
  h1: ({ children }) => <h1 className="text-text-primary text-xl font-bold mt-6 mb-3 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-text-primary text-lg font-bold mt-5 mb-2.5 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-text-primary text-base font-semibold mt-4 mb-2 first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="text-sm text-text-secondary leading-relaxed my-3 first:mt-0 last:mb-0">{children}</p>,
  a: ({ href, children }) => {
    const safe = safeHref(href)
    if (!safe) return <span className="text-text-secondary">{children}</span>
    return <a href={safe} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{children}</a>
  },
  strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="opacity-60">{children}</del>,
  ul: ({ children }) => <ul className="list-disc pl-5 my-3 space-y-1 text-sm text-text-secondary marker:text-text-muted">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 my-3 space-y-1 text-sm text-text-secondary marker:text-text-muted">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-accent/40 pl-4 my-3 text-sm text-text-muted italic">{children}</blockquote>
  ),
  code: ({ className, children }) => {
    // Fenced blocks carry a language- class; inline code doesn't.
    const isBlock = /language-/.test(className || '')
    if (isBlock) {
      return <code className="font-mono text-[12px] text-text-secondary">{children}</code>
    }
    return <code className="bg-[var(--surface-raised)] text-accent border border-[var(--border)] text-[12px] font-mono px-1.5 py-0.5 rounded">{children}</code>
  },
  pre: ({ children }) => (
    <pre className="bg-[var(--surface-raised)] border border-[var(--border)] rounded-xl p-4 my-3 overflow-x-auto leading-relaxed">{children}</pre>
  ),
  img: ({ src, alt }) => {
    const safe = safeHref(typeof src === 'string' ? src : undefined)
    if (!safe) return null
    return <img src={safe} alt={alt ?? ''} className="max-w-full rounded-xl my-3 border border-[var(--border)]" />
  },
  hr: () => <hr className="border-[var(--border)] my-5" />,
  table: ({ children }) => (
    <div className="overflow-x-auto my-3 rounded-xl border border-[var(--border)]">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[var(--surface-raised)]">{children}</thead>,
  th: ({ children }) => <th className="text-left px-3 py-2 text-text-muted text-xs font-semibold border-b border-[var(--border)]">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 text-text-secondary border-b border-[var(--border)] last:border-0">{children}</td>,
}

export default function Markdown({ children }: { children: string }): JSX.Element {
  return (
    <div className="break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
