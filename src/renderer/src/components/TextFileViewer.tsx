import { useEffect, useState, useMemo } from 'react'
import { X, Download, Loader2, AlertCircle, Check, Clipboard, WrapText } from 'lucide-react'

// In-app viewer for plain-text files in the Files tab. Two sources feed it:
// API files (fetched over HTTP from the stream URL) and local files (read in
// the main process, which is the only side that can touch the disk) - the
// caller owns that difference and hands us a `load` function, so this stays a
// pure presentation component.

export interface TextFileSource {
  name: string
  /** Resolves the file's text, or throws with a message worth showing. */
  load: () => Promise<{ text: string; truncated?: boolean }>
  /** Omitted for local files, where the row's own menu already downloads. */
  onDownload?: () => void
}

interface Props {
  source: TextFileSource
  onClose: () => void
}

export default function TextFileViewer({ source, onClose }: Props): JSX.Element {
  const [text, setText] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wrap, setWrap] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    setText(null)
    setError(null)
    setTruncated(false)
    source.load()
      .then((res) => {
        if (cancelled) return
        setText(res.text)
        setTruncated(!!res.truncated)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to read file')
      })
    return () => { cancelled = true }
  // The caller rebuilds `source` each render, so key off the file name rather
  // than the object identity - otherwise this refetches on every parent render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.name])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const lineCount = useMemo(() => (text ? text.split('\n').length : 0), [text])

  const copyAll = (): void => {
    if (text == null) return
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl max-h-full flex flex-col bg-surface border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-text-primary text-sm font-semibold truncate" title={source.name}>{source.name}</p>
            {text != null && (
              <p className="text-text-muted text-[11px]">
                {lineCount.toLocaleString()} {lineCount === 1 ? 'line' : 'lines'}
                {truncated && ' · showing the first 2 MB'}
              </p>
            )}
          </div>
          <button
            onClick={() => setWrap((w) => !w)}
            className={`p-2 rounded-lg transition-colors ${wrap ? 'bg-surface-raised text-text-primary' : 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay'}`}
            title={wrap ? 'Disable word wrap' : 'Enable word wrap'}
          ><WrapText size={15} /></button>
          <button
            onClick={copyAll}
            disabled={text == null}
            className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay disabled:opacity-40 transition-colors"
            title="Copy all"
          >{copied ? <Check size={15} className="text-accent" /> : <Clipboard size={15} />}</button>
          {source.onDownload && (
            <button
              onClick={source.onDownload}
              className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
              title="Download"
            ><Download size={15} /></button>
          )}
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
            title="Close"
          ><X size={15} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-auto">
          {error ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 px-6 text-center">
              <AlertCircle size={28} className="text-text-muted opacity-40" />
              <p className="text-text-muted text-sm">{error}</p>
            </div>
          ) : text == null ? (
            <div className="flex items-center justify-center gap-2 py-16 text-text-muted">
              <Loader2 size={18} className="animate-spin" /><span className="text-sm">Loading…</span>
            </div>
          ) : text.length === 0 ? (
            <p className="py-16 text-center text-text-muted text-sm">This file is empty.</p>
          ) : (
            <pre
              className={`px-4 py-3 text-xs leading-relaxed text-text-secondary font-mono ${
                wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
              }`}
            >{text}</pre>
          )}
        </div>
      </div>
    </div>
  )
}
