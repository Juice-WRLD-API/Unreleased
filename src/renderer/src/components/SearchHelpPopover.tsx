import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PopLayer } from './PopLayer'
import { Info } from 'lucide-react'
import { SEARCH_FIELD_HELP } from '../lib/trackerSearch'
import { FILE_SEARCH_HELP } from '../lib/fileSearch'

const CODE = 'text-text-secondary bg-surface-overlay px-1 py-0.5 rounded'

/** Which syntax the popover explains: the song field filters (default) or
 *  the Files search's (fileSearch.ts). */
export type SearchHelpKind = 'songs' | 'files'

const WIDTH = 288
const MAX_HEIGHT = 320
const GAP = 8

// Explains the field:"value" query syntax (trackerSearch.ts) that a search
// box's info button opens - shared by every search that takes it (Tracker,
// 999 FM, playlists, queues, tier list). Rendered where the button's
// `relative` wrapper is, but portalled and fixed-positioned against that
// wrapper so panels with overflow-hidden (the queues) don't clip it. Closes on
// outside click/Escape like the other popovers/menus.
export default function SearchHelpPopover({ onClose, kind = 'songs' }: { onClose: () => void; kind?: SearchHelpKind }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const markerRef = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null)

  useLayoutEffect(() => {
    const place = (): void => {
      const anchor = markerRef.current?.parentElement
      if (!anchor) return
      const r = anchor.getBoundingClientRect()
      const below = window.innerHeight - r.bottom - GAP * 2
      const above = r.top - GAP * 2
      // Below the button unless there's clearly more room above it.
      const flip = below < MAX_HEIGHT && above > below
      const maxHeight = Math.min(MAX_HEIGHT, flip ? above : below)
      const left = Math.max(GAP, Math.min(r.right - WIDTH, window.innerWidth - WIDTH - GAP))
      setPos({ top: flip ? r.top - GAP - maxHeight : r.bottom + GAP, left, maxHeight })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [])

  useEffect(() => {
    const handle = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  return (
    <>
      <span ref={markerRef} className="hidden" />
      {pos && createPortal(
        <PopLayer
          ref={ref}
          // preventDefault keeps focus in the search box underneath, so reading
          // this doesn't blur (and, in playlists, close) the search.
          onMouseDown={(e) => e.preventDefault()}
          style={{ top: pos.top, left: pos.left, width: WIDTH, maxHeight: pos.maxHeight }}
          className="fixed overflow-y-auto bg-surface border border-[var(--border)] rounded-xl shadow-2xl z-[200] p-3 animate-menu-pop"
        >
          <p className="text-text-primary text-xs font-semibold mb-1">Search syntax</p>
          {kind === 'files' ? (
            <p className="text-text-muted text-xs mb-2.5 leading-snug">
              Every word must match, in any order - the name or a folder it's in. Case, accents and
              punctuation don't matter, and if nothing matches exactly, small typos are forgiven.
              Put <code className={CODE}>-</code> before anything to leave it out; commas mean "any of",
              e.g. <code className={CODE}>ext:wav,flac</code>.
            </p>
          ) : (
            <p className="text-text-muted text-xs mb-2.5 leading-snug">
              Search any field directly with <code className={CODE}>field:"value"</code>.
              Combine with plain words and multiple fields - matches are case-insensitive substrings, all filters must match.
              An optional <code className={CODE}>&</code> between
              fields is just for readability, e.g. <code className={CODE}>artists:"Juice WRLD" &amp; category:unreleased</code>.
            </p>
          )}
          <div className="grid grid-cols-1 gap-1">
            {(kind === 'files' ? FILE_SEARCH_HELP : SEARCH_FIELD_HELP).map(({ field, example }) => (
              <div key={field} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-text-muted shrink-0">{field}</span>
                <code className="text-text-secondary bg-surface-overlay px-1.5 py-0.5 rounded truncate">{example}</code>
              </div>
            ))}
          </div>
        </PopLayer>,
        document.body,
      )}
    </>
  )
}

/** The info button that opens the popover, styled per search box. Its
 *  mousedown is swallowed so clicking it leaves focus in the search input. */
export function SearchHelpButton({ className, size = 14, kind }: {
  className: (open: boolean) => string
  size?: number
  kind?: SearchHelpKind
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
        title="Search syntax help"
        className={className(open)}
      >
        <Info size={size} />
      </button>
      {open && <SearchHelpPopover onClose={close} kind={kind} />}
    </div>
  )
}
