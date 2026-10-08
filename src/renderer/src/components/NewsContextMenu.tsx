import { useEffect, useRef } from 'react'
import { BookOpen, Link2, Pencil, Share2, Trash2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useIsMobile } from '../hooks/useIsMobile'
import type { NewsItem } from '../lib/newsApi'
import { ClampedMenu } from './ClampedMenu'
import { shareOrigin } from '../lib/platform'
import { Sheet, SheetItem, SheetDivider } from './mobile/Sheet'

export interface NewsMenuState { item: NewsItem; x: number; y: number }

// Right-click menu for a news post card. Actions the caller leaves out (share
// without chat access, edit/delete on someone else's post) simply don't show.
export default function NewsContextMenu({ state, onClose, onOpen, onShare, onEdit, onDelete }: {
  state: NewsMenuState
  onClose: () => void
  onOpen: () => void
  onShare?: () => void
  onEdit?: () => void
  onDelete?: () => void
}): JSX.Element {
  const { item } = state
  const isMobile = useIsMobile()
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isMobile) return
    const onDown = (e: MouseEvent): void => { if (!menuRef.current?.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    const onScroll = (): void => onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [isMobile, onClose])

  const run = (fn?: () => void) => (): void => { onClose(); fn?.() }
  const copyLink = (): void => {
    void navigator.clipboard.writeText(`${shareOrigin()}/news/${item.id}`).catch(() => undefined)
  }

  if (isMobile) {
    return (
      <Sheet onClose={onClose} title={item.title}>
        <SheetItem icon={BookOpen} label="Open" onClick={run(onOpen)} />
        <SheetItem icon={Link2} label="Copy link" onClick={run(copyLink)} />
        {onShare && <SheetItem icon={Share2} label="Share to chat" onClick={run(onShare)} />}
        {(onEdit || onDelete) && <SheetDivider />}
        {onEdit && <SheetItem icon={Pencil} label="Edit" onClick={run(onEdit)} />}
        {onDelete && <SheetItem icon={Trash2} label="Delete" danger onClick={run(onDelete)} />}
      </Sheet>
    )
  }

  return (
    <ClampedMenu ref={menuRef} x={state.x} y={state.y} className="min-w-[200px] max-w-[260px]" onContextMenu={(e) => e.preventDefault()}>
      <p className="px-3 pt-1.5 pb-1 text-[11px] text-text-muted truncate" title={item.title}>{item.title}</p>
      <Item icon={BookOpen} label="Open" onClick={run(onOpen)} />
      <Item icon={Link2} label="Copy link" onClick={run(copyLink)} />
      {onShare && <Item icon={Share2} label="Share to chat" onClick={run(onShare)} />}
      {(onEdit || onDelete) && <Divider />}
      {onEdit && <Item icon={Pencil} label="Edit" onClick={run(onEdit)} />}
      {onDelete && <Item icon={Trash2} label="Delete" danger onClick={run(onDelete)} />}
    </ClampedMenu>
  )
}

function Item({ icon: Icon, label, onClick, danger }: {
  icon: LucideIcon
  label: string
  onClick: () => void
  danger?: boolean
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-overlay ${danger ? 'text-red-400' : 'text-text-primary'}`}
    >
      <Icon size={14} className={danger ? '' : 'text-text-muted'} />
      <span className="flex-1 truncate">{label}</span>
    </button>
  )
}

function Divider(): JSX.Element {
  return <div className="my-1 border-t border-[var(--border)]" />
}
