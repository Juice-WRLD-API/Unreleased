import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ClampedMenu } from '../ClampedMenu'
import { PICKER_GROUPS, emojiGlyph, recentEmoji, rememberEmoji } from './emoji'
import { useDismiss } from './ui'

export default function ReactionPicker({ x, y, onPick, onClose }: {
  x: number
  y: number
  onPick: (name: string) => void
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [hover, setHover] = useState<string | null>(null)
  useDismiss(true, onClose, ref)

  const recent = recentEmoji()
  const q = query.trim().toLowerCase().replace(/^:/, '')
  const groups = q
    ? [{ label: 'Results', names: PICKER_GROUPS.flatMap((g) => g.names).filter((n) => n.includes(q)) }]
    : [...(recent.length ? [{ label: 'Recent', names: recent }] : []), ...PICKER_GROUPS]

  const pick = (name: string): void => {
    rememberEmoji(name)
    onPick(name)
    onClose()
  }

  return createPortal(
    <ClampedMenu ref={ref} x={x} y={y} className="chat-pop w-[296px] !py-0 z-[120]">
      <div className="p-2 border-b border-[var(--border)]">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const first = groups[0]?.names[0]
              if (first) pick(first)
            }
          }}
          placeholder="Find a reaction"
          className="w-full rounded-lg bg-surface-raised border border-[var(--border)] px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
        />
      </div>
      <div className="max-h-64 overflow-y-auto chat-scroll px-2 pb-2">
        {groups.map((g) => g.names.length > 0 && (
          <div key={g.label}>
            <p className="px-1 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">{g.label}</p>
            <div className="grid grid-cols-8 gap-0.5">
              {g.names.map((name) => (
                <button
                  key={`${g.label}-${name}`}
                  onClick={() => pick(name)}
                  onMouseEnter={() => setHover(name)}
                  className="h-8 rounded-lg text-xl leading-none flex items-center justify-center hover:bg-surface-overlay hover:scale-110 transition"
                >
                  {emojiGlyph(name)}
                </button>
              ))}
            </div>
          </div>
        ))}
        {groups.every((g) => g.names.length === 0) && (
          <p className="py-6 text-center text-xs text-text-muted">No reactions match &ldquo;{query}&rdquo;</p>
        )}
      </div>
      <div className="h-8 px-3 flex items-center gap-2 border-t border-[var(--border)] text-xs text-text-muted">
        {hover ? <><span className="text-base">{emojiGlyph(hover)}</span><span>:{hover}:</span></> : 'Pick a reaction'}
      </div>
    </ClampedMenu>,
    document.body,
  )
}
