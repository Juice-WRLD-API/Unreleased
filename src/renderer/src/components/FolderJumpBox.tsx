import { useEffect, useRef, useState } from 'react'
import { Folder, FolderSearch, Loader2 } from 'lucide-react'
import { PopLayer } from './PopLayer'
import { findFolders, loadFileIndex, runFileSearch } from '../lib/fileSearch'
import { parentFolder } from '../lib/apiFilesShared'
import type { JWApiFileEntry } from '../lib/juicewrldApi'

// "Go to folder" for the Files tab: type part of any folder's name (or paste
// a path) and jump straight there, anywhere in the channel's tree. Matches
// come from the channel's full file index; while the server is still
// building it, the plain search fills in.
export function FolderJumpBox({ channel, onJump, onClose }: {
  channel: string
  onJump: (path: string) => void
  onClose: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<JWApiFileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!query.trim()) { setResults([]); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    const t = setTimeout(() => {
      loadFileIndex(channel)
        .then((index) => index
          ? findFolders(index, query)
          : runFileSearch(`type:folder ${query}`, channel).then((r) => r.entries.slice(0, 50)))
        .then((found) => { if (!cancelled) { setResults(found); setActive(0) } })
        .catch(() => { if (!cancelled) setResults([]) })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 80)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, channel])

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const jump = (entry: JWApiFileEntry | undefined): void => {
    if (!entry) return
    onJump(entry.path)
    onClose()
  }

  return (
    <div className="relative flex-1 min-w-0 ml-1">
      <FolderSearch size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onClose() }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
          else if (e.key === 'Enter') { e.preventDefault(); jump(results[active]) }
        }}
        placeholder="Go to folder…"
        className="w-full bg-surface-overlay border border-accent/40 rounded-md pl-7 pr-7 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none"
      />
      {loading && <Loader2 size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted animate-spin" />}
      {query.trim() && !loading && (
        <PopLayer
          ref={listRef}
          className="absolute left-0 right-0 top-full mt-1 z-40 max-h-72 overflow-y-auto bg-surface border border-[var(--border)] rounded-lg shadow-2xl py-1 animate-menu-pop"
        >
          {results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-text-muted">No folders match</p>
          ) : results.map((entry, i) => (
            <button
              key={entry.path}
              data-index={i}
              // mousedown, not click: the input's blur closes the box first.
              onMouseDown={(e) => { e.preventDefault(); jump(entry) }}
              onMouseMove={() => setActive(i)}
              className={`flex items-center gap-2 w-full px-3 py-1.5 text-left ${i === active ? 'bg-surface-overlay' : ''}`}
            >
              <Folder size={14} className="text-text-secondary shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-text-primary truncate">{entry.name}</span>
                {parentFolder(entry.path) && <span className="block text-[10px] text-text-muted truncate">{parentFolder(entry.path)}</span>}
              </span>
            </button>
          ))}
        </PopLayer>
      )}
    </div>
  )
}
