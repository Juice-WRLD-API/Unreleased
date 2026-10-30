import { useEffect, useRef, useState } from 'react'
import { Folder, FolderSearch, Loader2 } from 'lucide-react'
import { PopLayer } from './PopLayer'

interface LocalDir { name: string; path: string }

// "Go to folder" for local files, the counterpart of FolderJumpBox: paste or
// type a path and press Enter. It opens holding the current path, selected,
// so a paste replaces it. Main resolves what was typed (quotes, ~, variables,
// relative paths; a file's path opens its folder). While typing, the folders
// in the typed parent that start with the last part are offered: arrows pick
// one, Tab completes it.
export function LocalPathBox({ current, onGo, onClose }: {
  current: string
  // Resolves to an error to show in the box, or null once the folder is open.
  onGo: (typed: string) => Promise<string | null>
  onClose: () => void
}): JSX.Element {
  const [query, setQuery] = useState(current)
  const [edited, setEdited] = useState(false)
  const [dirs, setDirs] = useState<LocalDir[]>([])
  const [active, setActive] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listings = useRef(new Map<string, LocalDir[]>())

  useEffect(() => { inputRef.current?.select() }, [])

  const cut = Math.max(query.lastIndexOf('/'), query.lastIndexOf('\\'))
  const parent = cut >= 0 ? query.slice(0, cut + 1) : ''
  const prefix = query.slice(cut + 1).toLowerCase()

  useEffect(() => {
    if (!edited || !parent) { setDirs([]); return }
    const known = listings.current.get(parent)
    if (known) { setDirs(known); return }
    let cancelled = false
    const t = setTimeout(() => {
      const el = (window as any).electron
      Promise.resolve(el?.browseLocal(parent, { typed: true, from: current }))
        .then((r: { error?: string; entries?: { name: string; path: string; type: string }[] } | undefined) => {
          const found = !r || r.error ? [] : (r.entries ?? []).filter((e) => e.type === 'directory').map(({ name, path }) => ({ name, path }))
          listings.current.set(parent, found)
          if (!cancelled) setDirs(found)
        })
        .catch(() => { if (!cancelled) setDirs([]) })
    }, 120)
    return () => { cancelled = true; clearTimeout(t) }
  }, [parent, edited, current])

  const matches = dirs.filter((d) => d.name.toLowerCase().startsWith(prefix)).slice(0, 50)
  // The typed path already names the one match: nothing left to offer.
  const offered = matches.length === 1 && matches[0].name.toLowerCase() === prefix ? [] : matches

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const go = async (target: string): Promise<void> => {
    if (!target.trim() || busy) return
    setBusy(true)
    setError(null)
    const failed = await onGo(target)
    setBusy(false)
    if (failed) setError(failed)
    else onClose()
  }

  const complete = (dir: LocalDir): void => {
    const sep = cut >= 0 ? query[cut] : '\\'
    setQuery(parent + dir.name + sep)
    setActive(-1)
  }

  return (
    <div className="relative flex-1 min-w-0 ml-1">
      <FolderSearch size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
      <input
        ref={inputRef}
        autoFocus
        value={query}
        spellCheck={false}
        onChange={(e) => { setQuery(e.target.value); setEdited(true); setActive(-1); setError(null) }}
        onBlur={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onClose() }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, offered.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, -1)) }
          else if (e.key === 'Tab' && offered.length > 0) { e.preventDefault(); complete(offered[Math.max(active, 0)]) }
          else if (e.key === 'Enter') { e.preventDefault(); go(active >= 0 && offered[active] ? offered[active].path : query) }
        }}
        placeholder="Paste or type a path…"
        className="w-full bg-surface-overlay border border-accent/40 rounded-md pl-7 pr-7 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none"
      />
      {busy && <Loader2 size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted animate-spin" />}
      {(error || offered.length > 0) && (
        <PopLayer
          ref={listRef}
          className="absolute left-0 right-0 top-full mt-1 z-40 max-h-72 overflow-y-auto bg-surface border border-[var(--border)] rounded-lg shadow-2xl py-1 animate-menu-pop"
        >
          {error ? (
            <p className="px-3 py-2 text-xs text-red-400 break-all">{error}</p>
          ) : offered.map((dir, i) => (
            <button
              key={dir.path}
              data-index={i}
              // mousedown, not click: the input's blur closes the box first.
              onMouseDown={(e) => { e.preventDefault(); go(dir.path) }}
              onMouseMove={() => setActive(i)}
              className={`flex items-center gap-2 w-full px-3 py-1.5 text-left ${i === active ? 'bg-surface-overlay' : ''}`}
            >
              <Folder size={14} className="text-text-secondary shrink-0" />
              <span className="text-xs text-text-primary truncate">{dir.name}</span>
            </button>
          ))}
        </PopLayer>
      )}
    </div>
  )
}
