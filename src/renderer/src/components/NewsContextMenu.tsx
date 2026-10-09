import { BookOpen, Link2, Pencil, Share2, Trash2 } from 'lucide-react'
import type { NewsItem } from '../lib/newsApi'
import ContextMenu from './ContextMenu'

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
  const copyLink = (): void => {
    void navigator.clipboard.writeText(`${window.location.origin}/news/${item.id}`).catch(() => undefined)
  }

  return (
    <ContextMenu
      x={state.x}
      y={state.y}
      title={item.title}
      onClose={onClose}
      items={[
        { icon: BookOpen, label: 'Open', onSelect: onOpen },
        { icon: Link2, label: 'Copy link', onSelect: copyLink },
        onShare && { icon: Share2, label: 'Share to chat', onSelect: onShare },
        (onEdit || onDelete) && 'divider',
        onEdit && { icon: Pencil, label: 'Edit', onSelect: onEdit },
        onDelete && { icon: Trash2, label: 'Delete', danger: true, onSelect: onDelete },
      ]}
    />
  )
}
