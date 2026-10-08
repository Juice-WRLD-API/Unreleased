import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { Bell, BellOff, CornerUpLeft, Copy, Forward, Image, MessageSquareReply, Pencil, Pin, PinOff, SmilePlus, Trash2 } from 'lucide-react'
import { ClampedMenu } from '../ClampedMenu'
import EmojiImg from './EmojiImg'
import { quickReactions } from './emoji'
import { useDismiss } from './ui'

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[13px] font-medium transition-colors ${
        danger ? 'text-red-400 hover:bg-red-500/10' : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

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
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(true, onClose, ref)

  const act = (fn: () => void) => () => { fn(); onClose() }

  return createPortal(
    <ClampedMenu ref={ref} x={x} y={y} className="chat-pop w-[220px] !py-1.5 z-[130]">
      <div className="flex items-center gap-0.5 px-1.5 pb-1.5 mb-1 border-b border-[var(--border)]">
        {quickReactions(6).map((name) => (
          <button
            key={name}
            onClick={act(() => onReact(name))}
            title={`:${name}:`}
            className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-surface-overlay hover:scale-110 transition"
          >
            <EmojiImg name={name} className="h-6 w-6" />
          </button>
        ))}
        <button
          onClick={act(onMoreReactions)}
          title="More reactions"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:bg-surface-overlay hover:text-text-primary transition"
        >
          <SmilePlus size={16} />
        </button>
      </div>

      {onReply && <MenuItem icon={<CornerUpLeft size={15} />} label="Reply" onClick={act(onReply)} />}
      {onOpenThread && <MenuItem icon={<MessageSquareReply size={15} />} label="Reply in Thread" onClick={act(onOpenThread)} />}
      {canEdit && <MenuItem icon={<Pencil size={15} />} label="Edit Message" onClick={act(onEdit)} />}
      {canPin && <MenuItem icon={pinned ? <PinOff size={15} /> : <Pin size={15} />} label={pinned ? 'Unpin Message' : 'Pin Message'} onClick={act(onTogglePin)} />}
      {canCopy && <MenuItem icon={<Copy size={15} />} label="Copy Text" onClick={act(onCopy)} />}
      {canCopyImage && <MenuItem icon={<Image size={15} />} label="Copy Image" onClick={act(onCopyImage)} />}
      {canForward && <MenuItem icon={<Forward size={15} />} label="Forward Message" onClick={act(onForward)} />}
      {canMute && onToggleMute && (
        <MenuItem
          icon={muted ? <Bell size={15} /> : <BellOff size={15} />}
          label={muted ? 'Unmute User' : 'Mute User'}
          onClick={act(onToggleMute)}
        />
      )}
      {canDelete && (
        <>
          <div className="my-1 border-t border-[var(--border)]" />
          <MenuItem icon={<Trash2 size={15} />} label="Delete Message" danger onClick={act(onDelete)} />
        </>
      )}
    </ClampedMenu>,
    document.body,
  )
}
