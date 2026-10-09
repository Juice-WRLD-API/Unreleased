import { Bell, BellOff, CornerUpLeft, Copy, Forward, Image, MessageSquareReply, Pencil, Pin, PinOff, SmilePlus, Trash2 } from 'lucide-react'
import ContextMenu from '../ContextMenu'
import EmojiImg from './EmojiImg'
import { quickReactions } from './emoji'

export default function MessageContextMenu({
  x, y, onClose, onReact, onMoreReactions, onReply, onOpenThread, canEdit, onEdit, canPin, pinned, onTogglePin, canCopy, onCopy, canCopyImage, onCopyImage, canForward, onForward, canDelete, onDelete, canMute, muted, onToggleMute,
}: {
  x: number
  y: number
  onClose: () => void
  onReact: (name: string) => void
  onMoreReactions: () => void
  onReply?: () => void
  onOpenThread?: () => void
  canEdit: boolean
  onEdit: () => void
  canPin: boolean
  pinned: boolean
  onTogglePin: () => void
  canCopy: boolean
  onCopy: () => void
  canCopyImage: boolean
  onCopyImage: () => void
  canForward: boolean
  onForward: () => void
  canDelete: boolean
  onDelete: () => void
  canMute?: boolean
  muted?: boolean
  onToggleMute?: () => void
}): JSX.Element {
  return (
    <ContextMenu
      x={x}
      y={y}
      onClose={onClose}
      zIndex={130}
      className="chat-pop w-[220px]"
      header={(close) => (
        <div className="flex items-center gap-0.5 px-1.5 pb-1.5 mb-1 border-b border-[var(--border)]">
          {quickReactions(6).map((name) => (
            <button
              key={name}
              onClick={() => { close(); onReact(name) }}
              title={`:${name}:`}
              className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-surface-overlay hover:scale-110 transition"
            >
              <EmojiImg name={name} className="h-6 w-6" />
            </button>
          ))}
          <button
            onClick={() => { close(); onMoreReactions() }}
            title="More reactions"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:bg-surface-overlay hover:text-text-primary transition"
          >
            <SmilePlus size={16} />
          </button>
        </div>
      )}
      items={[
        onReply && { icon: CornerUpLeft, label: 'Reply', onSelect: onReply },
        onOpenThread && { icon: MessageSquareReply, label: 'Reply in Thread', onSelect: onOpenThread },
        canEdit && { icon: Pencil, label: 'Edit Message', onSelect: onEdit },
        canPin && { icon: pinned ? PinOff : Pin, label: pinned ? 'Unpin Message' : 'Pin Message', onSelect: onTogglePin },
        canCopy && { icon: Copy, label: 'Copy Text', onSelect: onCopy },
        canCopyImage && { icon: Image, label: 'Copy Image', onSelect: onCopyImage },
        canForward && { icon: Forward, label: 'Forward Message', onSelect: onForward },
        canMute && onToggleMute && { icon: muted ? Bell : BellOff, label: muted ? 'Unmute User' : 'Mute User', onSelect: onToggleMute },
        canDelete && 'divider',
        canDelete && { icon: Trash2, label: 'Delete Message', danger: true, onSelect: onDelete },
      ]}
    />
  )
}
