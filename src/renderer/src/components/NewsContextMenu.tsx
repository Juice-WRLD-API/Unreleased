import { useState } from 'react'
import { BookOpen, Check, Link2, Pencil, Share2, Trash2 } from 'lucide-react'
import type { NewsItem } from '../lib/newsApi'
import { newsShareUrl } from '../lib/platform'
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
  const [linkCopied, setLinkCopied] = useState(false)
  // keepOpen so the clipboard write finishes before the menu unmounts, and the
  // user sees the "Link copied" confirmation (same as the song menu).
  const copyLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(newsShareUrl(item.id))
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2500)
    } catch {}
  }

  return (
    <ContextMenu
      x={state.x}
      y={state.y}
      title={item.title}
      onClose={onClose}
      items={[
        { icon: BookOpen, label: 'Open', onSelect: onOpen },
        { icon: linkCopied ? Check : Link2, label: linkCopied ? 'Link copied' : 'Copy link', keepOpen: true, onSelect: copyLink },
        onShare && { icon: Share2, label: 'Share to chat', onSelect: onShare },
        (onEdit || onDelete) && 'divider',
        onEdit && { icon: Pencil, label: 'Edit', onSelect: onEdit },
        onDelete && { icon: Trash2, label: 'Delete', danger: true, onSelect: onDelete },
      ]}
    />
  )
}
