import { memo, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle, CornerDownRight, CornerUpLeft, Copy, Loader2, MessageSquareReply, Pencil, Pin, PinOff, RotateCcw, SmilePlus, Trash2,
} from 'lucide-react'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { ChatUserBrief } from '../../lib/chatApi'
import { encodeReplyRef, splitReplyRef } from '../../lib/chatReplyRef'
import { displayName, useChatStore, useMessageById, type UiMessage } from '../../store/chatStore'
import { useStore } from '../../store/useStore'
import AttachmentList from './AttachmentView'
import MessageBody from './MessageBody'
import MessageContextMenu from './MessageContextMenu'
import ReactionPicker from './ReactionPicker'
import { QUICK_REACTIONS, emojiGlyph, quickReactions, rememberEmoji } from './emoji'
import { ChatAvatar, clockTime, errorText, fullStamp, useChatToast } from './ui'

function ReplyBar({ replyToId, authorId, name, snippet, hasAttachment, people }: {
  replyToId: number
  authorId: number
  name: string
  snippet: string
  hasAttachment: boolean
  people: ChatUserBrief[]
}): JSX.Element {
  const live = useMessageById(replyToId)
  const author = live?.author ?? people.find((p) => p.id === authorId)
  const deleted = !!live?.deleted_at
  const preview = deleted ? 'Original message was deleted' : (snippet || (hasAttachment ? 'Attachment' : ''))
  return (
    <button
      onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('chat:jump', { detail: replyToId })) }}
      className="mb-0.5 flex max-w-full items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary group/reply"
    >
      <CornerUpLeft size={12} className="shrink-0 opacity-70" />
      {author && <ChatAvatar user={author} size={14} />}
      <span className={`shrink-0 font-semibold ${deleted ? 'italic text-text-muted' : 'text-text-secondary group-hover/reply:text-text-primary'}`}>
        {deleted ? 'Unknown' : (author ? displayName(author) : name)}
      </span>
      <span className="min-w-0 truncate">{preview || '…'}</span>
    </button>
  )
}

export interface MessageItemProps {
  message: UiMessage
  grouped: boolean
  people: ChatUserBrief[]
  canModerate: boolean
  inThread?: boolean
  activeThread?: boolean
  editing: boolean
  onStartEdit: (id: number | null) => void
  onOpenThread?: (id: number) => void
  onReply?: (message: UiMessage) => void
  highlight?: boolean
}

function RoleTag({ role }: { role: string }): JSX.Element | null {
  if (role !== 'administrator' && role !== 'manager') return null
  return (
    <span className={`px-1.5 py-px rounded text-[9px] font-bold uppercase tracking-wider ${
      role === 'administrator' ? 'bg-red-500/15 text-red-400' : 'bg-sky-500/15 text-sky-400'
    }`}>
      {role === 'administrator' ? 'Admin' : 'Manager'}
    </span>
  )
}

function InlineEditor({ initial, onSave, onCancel }: { initial: string; onSave: (text: string) => Promise<void>; onCancel: () => void }): JSX.Element {
  const [value, setValue] = useState(initial)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [value])

  const save = async (): Promise<void> => {
    const text = value.trim()
    if (!text || text === initial.trim()) { onCancel(); return }
    setSaving(true)
    try { await onSave(text) } finally { setSaving(false) }
  }

  return (
    <div className="mt-1">
      <textarea
        ref={ref}
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onCancel() }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void save() }
        }}
        rows={1}
        className="w-full resize-none rounded-xl bg-surface-raised border border-accent/40 px-3 py-2 text-sm text-text-primary focus:outline-none"
      />
      <p className="mt-1 text-[11px] text-text-muted">
        escape to <button onClick={onCancel} className="text-accent hover:underline">cancel</button>
        {' '}· enter to <button onClick={() => void save()} className="text-accent hover:underline">save</button>
        {saving && <Loader2 size={11} className="inline ml-2 animate-spin" />}
      </p>
    </div>
  )
}

function ActionSheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }): JSX.Element {
  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="chat-sheet relative w-full rounded-t-2xl bg-surface border-t border-[var(--border)] p-3 space-y-1"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-[var(--border)]" />
        {children}
      </div>
    </div>,
    document.body,
  )
}

function SheetRow({ icon, label, onClick, danger }: { icon: JSX.Element; label: string; onClick: () => void; danger?: boolean }): JSX.Element {
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-[15px] active:bg-surface-overlay ${danger ? 'text-red-400' : 'text-text-primary'}`}>
      <span className={danger ? 'text-red-400' : 'text-text-muted'}>{icon}</span>
      {label}
    </button>
  )
}

function MessageItem({
  message, grouped, people, canModerate, inThread, activeThread, editing, onStartEdit, onOpenThread, onReply, highlight,
}: MessageItemProps): JSX.Element {
  const isMobile = useIsMobile()
  const meId = useChatStore((s) => s.meId)
  const toggleReaction = useChatStore((s) => s.toggleReaction)
  const togglePin = useChatStore((s) => s.togglePin)
  const remove = useChatStore((s) => s.remove)
  const edit = useChatStore((s) => s.edit)
  const plainText = useChatStore((s) => {
    if (!message.is_encrypted) return message.content
    const p = s.plain[message.id]
    return p && 'text' in p ? p.text : ''
  })
  const toast = useChatToast()
  const openPublicProfile = useStore((s) => s.openPublicProfile)
  const openProfile = (): void => openPublicProfile(message.author.id)

  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [sheet, setSheet] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const pressTimer = useRef<number | null>(null)

  const mine = message.author.id === meId
  const deleted = !!message.deleted_at
  const pending = message.id < 0
  const { ref: replyRef, body: bodyText } = deleted ? { ref: null, body: plainText } : splitReplyRef(plainText)
  const effectiveGrouped = grouped && !replyRef
  const canEdit = mine && !deleted && !pending && (!message.is_encrypted || !!plainText)
  const canDelete = !pending && !deleted && (mine || canModerate)
  const canPin = !pending && !deleted && (mine || canModerate)
  const canCopy = !deleted && !!plainText

  const run = (fn: () => Promise<unknown>, failure: string) => {
    fn().catch((err) => toast(errorText(err, failure)))
  }

  const react = (name: string): void => {
    rememberEmoji(name)
    run(() => toggleReaction(message, name), 'Could not update reaction')
  }

  const openPickerAt = (el: HTMLElement): void => {
    const r = el.getBoundingClientRect()
    setPicker({ x: r.right - 296, y: r.bottom + 6 })
  }

  const doDelete = (): void => {
    setConfirmDelete(false)
    setSheet(false)
    run(() => remove(message), 'Could not delete message')
  }

  const onTouchStart = (): void => {
    if (pending) return
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null
      navigator.vibrate?.(8)
      setSheet(true)
    }, 420)
  }
  const cancelPress = (): void => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current)
    pressTimer.current = null
  }

  const failed = message.sendState === 'failed'

  return (
    <div
      data-message-id={message.id}
      onTouchStart={onTouchStart}
      onTouchEnd={cancelPress}
      onTouchMove={cancelPress}
      onContextMenu={(e) => {
        e.preventDefault()
        if (isMobile || pending || deleted || editing) return
        setMenu({ x: e.clientX, y: e.clientY })
      }}
      className={`group relative flex gap-3 px-4 md:px-5 transition-colors ${
        effectiveGrouped ? 'pt-0.5 pb-0.5' : 'pt-3 pb-0.5'
      } ${highlight ? 'chat-flash' : ''} ${editing || activeThread ? 'bg-accent/[0.04]' : 'hover:bg-surface-raised/40'} ${
        activeThread ? 'border-l-2 border-accent/60' : message.pinned && !inThread ? 'border-l-2 border-amber-400/60' : 'border-l-2 border-transparent'
      }`}
    >
      <div className="w-9 shrink-0 flex justify-center">
        {effectiveGrouped ? (
          <span className="text-[10px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity leading-[1.6rem] tabular-nums select-none" title={fullStamp(message.created_at)}>
            {clockTime(message.created_at).replace(/\s?[AP]M$/i, '')}
          </span>
        ) : (
          <ChatAvatar user={message.author} size={36} className="mt-0.5" onClick={openProfile} />
        )}
      </div>

      <div className={`flex-1 min-w-0 ${pending && !failed ? 'opacity-60' : ''}`}>
        {replyRef && (
          <ReplyBar
            replyToId={replyRef.id}
            authorId={replyRef.authorId}
            name={replyRef.name}
            snippet={replyRef.snippet}
            hasAttachment={replyRef.hasAttachment}
            people={people}
          />
        )}
        {!effectiveGrouped && (
          <div className="flex items-baseline gap-2 min-w-0">
            <span
              className="text-sm font-semibold text-text-primary truncate cursor-pointer hover:underline"
              onClick={openProfile}
            >
              {displayName(message.author)}
            </span>
            <RoleTag role={message.author.role} />
            <span className="text-[11px] text-text-muted shrink-0" title={fullStamp(message.created_at)}>{clockTime(message.created_at)}</span>
            {message.pinned && !inThread && <Pin size={11} className="text-amber-400 shrink-0 self-center" />}
          </div>
        )}

        {editing ? (
          <InlineEditor
            initial={bodyText}
            onCancel={() => onStartEdit(null)}
            onSave={async (text) => {
              try {
                await edit(message, replyRef ? `${encodeReplyRef(replyRef)}${text}` : text)
                onStartEdit(null)
              } catch (err) {
                toast(errorText(err, 'Could not save edit'))
              }
            }}
          />
        ) : (
          <div className="flex items-end gap-1.5 flex-wrap">
            <div className="min-w-0 max-w-full">
              <MessageBody message={message} people={people} />
            </div>
            {message.edited_at && !deleted && (
              <span className="text-[10px] text-text-muted mb-0.5" title={`Edited ${fullStamp(message.edited_at)}`}>(edited)</span>
            )}
          </div>
        )}

        {!deleted && (
          <AttachmentList attachments={message.attachments} conversationId={message.conversation} encrypted={message.is_encrypted} />
        )}

        {message.reactions.length > 0 && !deleted && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {message.reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => react(r.emoji)}
                title={`:${r.emoji}:`}
                className={`chat-pop h-6 pl-1.5 pr-2 rounded-full border text-xs flex items-center gap-1 transition-colors ${
                  r.me
                    ? 'border-accent/60 bg-accent/15 text-text-primary'
                    : 'border-[var(--border)] bg-surface-raised/60 text-text-secondary hover:border-text-muted'
                }`}
              >
                <span className="text-sm leading-none">{emojiGlyph(r.emoji)}</span>
                <span className="tabular-nums font-semibold">{r.count}</span>
              </button>
            ))}
            <button
              onClick={(e) => openPickerAt(e.currentTarget)}
              title="Add reaction"
              className="h-6 w-7 rounded-full border border-dashed border-[var(--border)] text-text-muted flex items-center justify-center opacity-0 group-hover:opacity-100 hover:text-text-primary transition"
            >
              <SmilePlus size={13} />
            </button>
          </div>
        )}

        {!inThread && (message.reply_count > 0 || activeThread) && !deleted && onOpenThread && (
          <button
            onClick={() => onOpenThread(message.id)}
            className={`mt-1.5 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 -ml-2 text-xs font-semibold transition-colors ${
              activeThread ? 'bg-accent/15 text-accent' : 'text-accent hover:bg-accent/10'
            }`}
          >
            <CornerDownRight size={13} />
            {message.reply_count > 0
              ? `${message.reply_count} ${message.reply_count === 1 ? 'reply' : 'replies'}`
              : 'Thread open'}
          </button>
        )}

        {failed && (
          <div className="mt-1 flex items-center gap-2 text-xs text-red-400">
            <AlertCircle size={13} />
            Failed to send
            <button onClick={() => message.retry?.()} className="inline-flex items-center gap-1 font-semibold hover:underline"><RotateCcw size={11} />Retry</button>
            <button onClick={() => run(() => remove(message), 'Could not discard')} className="font-semibold text-text-muted hover:underline">Discard</button>
          </div>
        )}
      </div>

      {!pending && !deleted && !editing && !isMobile && (
        <div className="absolute -top-3 right-4 z-10 hidden group-hover:flex items-center gap-0.5 rounded-xl border border-[var(--border)] bg-surface shadow-lg p-0.5">
          {quickReactions(3).map((name) => (
            <button key={name} onClick={() => react(name)} title={`:${name}:`} className="w-8 h-8 rounded-lg text-base hover:bg-surface-overlay hover:scale-110 transition">
              {emojiGlyph(name)}
            </button>
          ))}
          <span className="w-px h-5 bg-[var(--border)] mx-0.5" />
          <ToolbarButton label="Add reaction" onClick={(e) => openPickerAt(e.currentTarget)}><SmilePlus size={16} /></ToolbarButton>
          {!inThread && onReply && (
            <ToolbarButton label="Reply" onClick={() => onReply(message)}><CornerUpLeft size={16} /></ToolbarButton>
          )}
          {!inThread && onOpenThread && (
            <ToolbarButton label="Reply in thread" onClick={() => onOpenThread(message.id)}><MessageSquareReply size={16} /></ToolbarButton>
          )}
          {canEdit && <ToolbarButton label="Edit" onClick={() => onStartEdit(message.id)}><Pencil size={15} /></ToolbarButton>}
          {canDelete && (
            <ToolbarButton label="Delete" danger onClick={(e) => (e.shiftKey ? doDelete() : setConfirmDelete(true))}><Trash2 size={15} /></ToolbarButton>
          )}
        </div>
      )}

      {picker && <ReactionPicker x={picker.x} y={picker.y} onPick={react} onClose={() => setPicker(null)} />}

      {menu && (
        <MessageContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onReact={react}
          onMoreReactions={() => setPicker({ x: menu.x, y: menu.y })}
          onReply={!inThread && onReply ? () => onReply(message) : undefined}
          onOpenThread={!inThread && onOpenThread ? () => onOpenThread(message.id) : undefined}
          canEdit={canEdit}
          onEdit={() => onStartEdit(message.id)}
          canPin={canPin}
          pinned={message.pinned}
          onTogglePin={() => run(() => togglePin(message), 'Could not update pin')}
          canCopy={canCopy}
          onCopy={() => { void navigator.clipboard.writeText(bodyText); toast('Copied to clipboard', 'ok') }}
          canDelete={canDelete}
          onDelete={() => setConfirmDelete(true)}
        />
      )}

      {sheet && (
        <ActionSheet onClose={() => setSheet(false)}>
          <div className="flex justify-between px-1 pb-2">
            {QUICK_REACTIONS.map((name) => (
              <button key={name} onClick={() => { react(name); setSheet(false) }} className="w-12 h-12 rounded-full bg-surface-raised text-2xl active:scale-95 transition">
                {emojiGlyph(name)}
              </button>
            ))}
          </div>
          {!inThread && onReply && <SheetRow icon={<CornerUpLeft size={18} />} label="Reply" onClick={() => { setSheet(false); onReply(message) }} />}
          {!inThread && onOpenThread && <SheetRow icon={<MessageSquareReply size={18} />} label="Reply in thread" onClick={() => { setSheet(false); onOpenThread(message.id) }} />}
          {canEdit && <SheetRow icon={<Pencil size={18} />} label="Edit message" onClick={() => { setSheet(false); onStartEdit(message.id) }} />}
          {canPin && <SheetRow icon={message.pinned ? <PinOff size={18} /> : <Pin size={18} />} label={message.pinned ? 'Unpin' : 'Pin message'} onClick={() => { setSheet(false); run(() => togglePin(message), 'Could not update pin') }} />}
          {plainText && <SheetRow icon={<Copy size={18} />} label="Copy text" onClick={() => { setSheet(false); void navigator.clipboard.writeText(bodyText); toast('Copied to clipboard', 'ok') }} />}
          {canDelete && <SheetRow icon={<Trash2 size={18} />} label="Delete message" danger onClick={() => { setSheet(false); setConfirmDelete(true) }} />}
        </ActionSheet>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete message?"
          body="This removes the message for everyone. Tip: hold Shift when clicking delete to skip this."
          confirmLabel="Delete"
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}

function ToolbarButton({ label, onClick, children, danger }: { label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode; danger?: boolean }): JSX.Element {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${danger ? 'text-text-muted hover:text-red-400 hover:bg-red-500/10' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'}`}
    >
      {children}
    </button>
  )
}

export function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel, danger = true }: {
  title: string
  body: React.ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  danger?: boolean
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, onConfirm])
  return createPortal(
    <div className="fixed inset-0 z-[160] flex items-center justify-center p-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
      <div onClick={(e) => e.stopPropagation()} className="chat-pop relative w-full max-w-sm rounded-2xl border border-[var(--border)] bg-surface shadow-2xl p-5">
        <h3 className="text-base font-bold text-text-primary">{title}</h3>
        <div className="mt-1.5 text-sm text-text-secondary leading-relaxed">{body}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-semibold text-text-secondary hover:bg-surface-overlay transition-colors">Cancel</button>
          <button
            autoFocus
            onClick={onConfirm}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${danger ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-accent text-white hover:brightness-110'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default memo(MessageItem)
