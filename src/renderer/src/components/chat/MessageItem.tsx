import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle, Bell, BellOff, CornerDownRight, CornerUpLeft, Copy, Forward, Image as ImageIcon, Loader2, MessageSquareReply, Pencil, Pin, PinOff, RotateCcw, SmilePlus, Trash2,
} from 'lucide-react'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { ChatUserBrief } from '../../lib/chatApi'
import { chatAttachmentUrl, getMessage } from '../../lib/chatApi'
import { encodeReplyRef, splitReplyRef } from '../../lib/chatReplyRef'
import { encodeForwardRef, splitForwardRef } from '../../lib/chatForwardRef'
import { displayName, useChatStore, useMessageById, type UiMessage } from '../../store/chatStore'
import { useStore } from '../../store/useStore'
import AttachmentList, { kindOf } from './AttachmentView'
import ForwardMessageModal from './ForwardMessageModal'
import MessageBody from './MessageBody'
import MessageContextMenu from './MessageContextMenu'
import ReactionPicker from './ReactionPicker'
import EmojiImg from './EmojiImg'
import { QUICK_REACTIONS, quickReactions, rememberEmoji } from './emoji'
import { ChatAvatar, clockTime, errorText, fullStamp, useChatToast } from './ui'

function ReplyBar({ replyToId, authorId, name, snippet, hasAttachment, people }: {
  replyToId: number
  authorId: number
  name: string
  snippet: string
  hasAttachment: boolean
  people: ChatUserBrief[]
}): JSX.Element {
  // authorId/name/snippet ride in the message body, so any sender can forge
  // them to make a reply bar look like a quote from someone else. Only the
  // live message (fetched independently, not trusted from this payload) can
  // confirm who actually said what - without it, show a neutral placeholder
  // instead of attributing unverified text to a specific person.
  const live = useMessageById(replyToId)
  const verified = !!live
  const author = live?.author
  const deleted = !!live?.deleted_at
  const preview = deleted ? 'Original message was deleted' : verified ? (snippet || (hasAttachment ? 'Attachment' : '')) : 'Original message'
  return (
    <button
      onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('chat:jump', { detail: replyToId })) }}
      className="mb-0.5 flex max-w-full items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary group/reply"
    >
      <CornerUpLeft size={12} className="shrink-0 opacity-70" />
      {author && <ChatAvatar user={author} size={14} />}
      {verified && (
        <span className={`shrink-0 font-semibold ${deleted ? 'italic text-text-muted' : 'text-text-secondary group-hover/reply:text-text-primary'}`}>
          {deleted ? 'Unknown' : (author ? displayName(author) : name)}
        </span>
      )}
      <span className="min-w-0 truncate">{preview || '…'}</span>
    </button>
  )
}

function ForwardBar({ forwardToId, name, snippet, hasAttachment, sourceLabel }: {
  forwardToId: number
  name: string
  snippet: string
  hasAttachment: boolean
  sourceLabel: string
}): JSX.Element {
  // As with ReplyBar: name/snippet ride in the message body, so any sender
  // can forge them to make a forward card look like it quotes someone else.
  // Only a live copy of the original message - checked in whatever rooms are
  // already loaded, then fetched from the server (which enforces the
  // viewer's own access to that channel/DM) - can confirm who actually said
  // what. Never attribute unverified text to a specific person.
  const live = useMessageById(forwardToId)
  const [fetched, setFetched] = useState<{ author: ChatUserBrief; deleted: boolean } | 'denied' | null>(null)
  useEffect(() => {
    if (live) return
    let cancelled = false
    getMessage(forwardToId).then((m) => {
      if (!cancelled) setFetched({ author: m.author, deleted: !!m.deleted_at })
    }).catch(() => { if (!cancelled) setFetched('denied') })
    return () => { cancelled = true }
  }, [live, forwardToId])

  const author = live?.author ?? (fetched && fetched !== 'denied' ? fetched.author : undefined)
  const deleted = live ? !!live.deleted_at : fetched && fetched !== 'denied' ? fetched.deleted : false
  const verified = !!author
  return (
    <div className="mb-1.5 flex items-start gap-2 rounded-lg border border-[var(--border)] bg-surface-raised/50 px-3 py-2 max-w-full">
      <Forward size={14} className="shrink-0 mt-0.5 opacity-70 text-text-muted" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="font-semibold text-text-muted">Forwarded</span>
          {sourceLabel && <span className="text-text-muted opacity-70 truncate">from {sourceLabel}</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
          {verified && !deleted && author && <ChatAvatar user={author} size={16} />}
          {verified && (
            <span className={`shrink-0 text-xs font-semibold ${deleted ? 'italic text-text-muted' : 'text-text-secondary'}`}>
              {deleted ? 'Unknown' : displayName(author ?? { id: 0, username: name, display_name: name, avatar: '', role: '' })}
            </span>
          )}
          <span className="min-w-0 truncate text-sm text-text-primary">
            {deleted ? 'Original message was deleted' : (snippet || (hasAttachment ? 'Attachment' : '') || '…')}
          </span>
        </div>
      </div>
    </div>
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

function InlineEditor({ initial, people, meId, onSave, onCancel }: {
  initial: string
  people: ChatUserBrief[]
  meId: number | null
  onSave: (text: string) => Promise<void>
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [mention, setMention] = useState<{ start: number; query: string; index: number } | null>(null)
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

  const candidates = useMemo(() => {
    if (!mention) return []
    const q = mention.query.toLowerCase()
    return people
      .filter((p) => p.id !== meId)
      .filter((p) => !q || p.username.toLowerCase().includes(q) || p.display_name.toLowerCase().includes(q))
      .slice(0, 6)
  }, [mention, people, meId])

  const updateMention = (val: string, caret: number): void => {
    const upto = val.slice(0, caret)
    const match = /(^|\s)@([\w.-]{0,32})$/.exec(upto)
    if (match) setMention({ start: caret - match[2].length - 1, query: match[2], index: 0 })
    else setMention(null)
  }

  const applyMention = (user: ChatUserBrief): void => {
    if (!mention) return
    const el = ref.current
    const caret = el?.selectionStart ?? value.length
    const insert = `@${user.username} `
    const next = value.slice(0, mention.start) + insert + value.slice(caret)
    setValue(next)
    setMention(null)
    requestAnimationFrame(() => {
      const pos = mention.start + insert.length
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }

  const save = async (): Promise<void> => {
    const text = value.trim()
    if (!text || text === initial.trim()) { onCancel(); return }
    setSaving(true)
    try { await onSave(text) } finally { setSaving(false) }
  }

  return (
    <div className="mt-1 relative">
      {mention && candidates.length > 0 && (
        <div className="chat-pop absolute left-0 right-0 bottom-full mb-2 z-20 rounded-xl border border-[var(--border)] bg-surface shadow-2xl overflow-hidden">
          <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">Members</p>
          {candidates.map((p, i) => (
            <button
              key={p.id}
              onMouseDown={(e) => { e.preventDefault(); applyMention(p) }}
              onMouseEnter={() => setMention({ ...mention, index: i })}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left ${i === mention.index ? 'bg-surface-overlay' : ''}`}
            >
              <ChatAvatar user={p} size={24} presence />
              <span className="text-sm text-text-primary truncate">{displayName(p)}</span>
              <span className="text-xs text-text-muted truncate">@{p.username}</span>
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        value={value}
        disabled={saving}
        onChange={(e) => { setValue(e.target.value); updateMention(e.target.value, e.target.selectionStart) }}
        onClick={(e) => updateMention(value, e.currentTarget.selectionStart)}
        onBlur={() => { window.setTimeout(() => setMention(null), 120) }}
        onKeyDown={(e) => {
          if (mention && candidates.length > 0) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const dir = e.key === 'ArrowDown' ? 1 : -1
              setMention({ ...mention, index: (mention.index + dir + candidates.length) % candidates.length })
              return
            }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyMention(candidates[mention.index]); return }
            if (e.key === 'Escape') { e.preventDefault(); setMention(null); return }
          }
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
  const mutedUserIds = useStore((s) => s.mutedUserIds)
  const toggleMuteUser = useStore((s) => s.toggleMuteUser)
  const openProfile = (): void => openPublicProfile(message.author.id)
  // message.author is a snapshot from send time - if that person has since
  // changed their avatar, prefer the live record from the room's member/
  // participant list so the picture doesn't stay stuck on the old one.
  const liveAuthor = people.find((p) => p.id === message.author.id) ?? message.author

  const reactorNames = (userIds: number[]): string => {
    const names = userIds.map((id) => {
      if (id === meId) return 'You'
      const person = people.find((p) => p.id === id)
      return person ? displayName(person) : `#${id}`
    })
    if (names.length <= 2) return names.join(' and ')
    return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
  }

  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [sheet, setSheet] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [forwarding, setForwarding] = useState(false)
  const pressTimer = useRef<number | null>(null)

  const mine = message.author.id === meId
  // Muting only applies to shared channels/servers - a DM is something you'd
  // mute the conversation for instead, not hide the other person's own
  // messages to you (see PublicProfileView's mute button for the same rule).
  const canMute = !mine && message.conversation == null
  const muted = mutedUserIds.includes(message.author.id)
  const deleted = !!message.deleted_at
  const pending = message.id < 0
  const { ref: replyRef, body: afterReply } = deleted ? { ref: null, body: plainText } : splitReplyRef(plainText)
  const { ref: forwardRef, body: bodyText } = deleted || replyRef ? { ref: null, body: afterReply } : splitForwardRef(afterReply)
  const effectiveGrouped = grouped && !replyRef && !forwardRef
  const canEdit = mine && !deleted && !pending && (!message.is_encrypted || !!plainText)
  const canDelete = !pending && !deleted && (mine || canModerate)
  const canPin = !pending && !deleted && (mine || canModerate)
  const canCopy = !deleted && !!plainText
  const imageAttachment = !deleted ? message.attachments.find((a) => kindOf(a.mime, a.name) === 'image') : undefined
  const canCopyImage = !!imageAttachment
  const canForward = !pending && !deleted && (!!bodyText || message.attachments.length > 0)

  const run = (fn: () => Promise<unknown>, failure: string) => {
    fn().catch((err) => toast(errorText(err, failure)))
  }

  // Copies the message's first image attachment as a PNG blob - the Clipboard
  // API only reliably accepts image/png across browsers/Electron, so anything
  // else (jpeg, webp, gif) gets re-encoded via canvas first.
  const copyImage = async (): Promise<void> => {
    if (!imageAttachment) return
    let blob: Blob
    if (message.is_encrypted && message.conversation && meId) {
      const { decryptAttachment } = await import('../../lib/chatE2E')
      blob = (await decryptAttachment(meId, message.conversation, imageAttachment)).blob
    } else {
      const res = await fetch(chatAttachmentUrl(imageAttachment.id))
      if (!res.ok) throw new Error('Could not load image')
      blob = await res.blob()
    }
    if (blob.type !== 'image/png') {
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
      blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not convert image'))), 'image/png'),
      )
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
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
          <ChatAvatar user={liveAuthor} size={36} className="mt-0.5" onClick={openProfile} />
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
        {forwardRef && (
          <ForwardBar
            forwardToId={forwardRef.id}
            name={forwardRef.name}
            snippet={forwardRef.snippet}
            hasAttachment={forwardRef.hasAttachment}
            sourceLabel={forwardRef.sourceLabel}
          />
        )}
        {!effectiveGrouped && (
          <div className="flex items-baseline gap-2 min-w-0">
            <span
              className="text-sm font-semibold text-text-primary truncate cursor-pointer hover:underline"
              onClick={openProfile}
            >
              {displayName(liveAuthor)}
            </span>
            <RoleTag role={liveAuthor.role} />
            <span className="text-[11px] text-text-muted shrink-0" title={fullStamp(message.created_at)}>{clockTime(message.created_at)}</span>
            {message.pinned && !inThread && <Pin size={11} className="text-amber-400 shrink-0 self-center" />}
          </div>
        )}

        {editing ? (
          <InlineEditor
            initial={bodyText}
            people={people}
            meId={meId}
            onCancel={() => onStartEdit(null)}
            onSave={async (text) => {
              try {
                await edit(message, replyRef ? `${encodeReplyRef(replyRef)}${text}` : forwardRef ? `${encodeForwardRef(forwardRef)}${text}` : text)
                onStartEdit(null)
              } catch (err) {
                toast(errorText(err, 'Could not save edit'))
              }
            }}
          />
        ) : (
          <div className="mt-0.5 flex items-end gap-1.5 flex-wrap">
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
                title={`${reactorNames(r.user_ids)} reacted with :${r.emoji}:`}
                className={`chat-pop h-7 pl-1.5 pr-2 rounded-full border text-xs flex items-center gap-1 transition-colors ${
                  r.me
                    ? 'border-accent/60 bg-accent/15 text-text-primary'
                    : 'border-[var(--border)] bg-surface-raised/60 text-text-secondary hover:border-text-muted'
                }`}
              >
                <EmojiImg name={r.emoji} className="h-4 w-4" />
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
            <button key={name} onClick={() => react(name)} title={`:${name}:`} className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-surface-overlay hover:scale-110 transition">
              <EmojiImg name={name} className="h-6 w-6" />
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
          canCopyImage={canCopyImage}
          onCopyImage={() => run(() => copyImage().then(() => toast('Image copied to clipboard', 'ok')), 'Could not copy image')}
          canForward={canForward}
          onForward={() => setForwarding(true)}
          canDelete={canDelete}
          onDelete={() => setConfirmDelete(true)}
          canMute={canMute}
          muted={muted}
          onToggleMute={() => toggleMuteUser(message.author.id)}
        />
      )}

      {sheet && (
        <ActionSheet onClose={() => setSheet(false)}>
          <div className="flex justify-between px-1 pb-2">
            {QUICK_REACTIONS.map((name) => (
              <button key={name} onClick={() => { react(name); setSheet(false) }} className="w-14 h-14 rounded-full bg-surface-raised flex items-center justify-center active:scale-95 transition">
                <EmojiImg name={name} className="h-8 w-8" />
              </button>
            ))}
          </div>
          {!inThread && onReply && <SheetRow icon={<CornerUpLeft size={18} />} label="Reply" onClick={() => { setSheet(false); onReply(message) }} />}
          {!inThread && onOpenThread && <SheetRow icon={<MessageSquareReply size={18} />} label="Reply in thread" onClick={() => { setSheet(false); onOpenThread(message.id) }} />}
          {canEdit && <SheetRow icon={<Pencil size={18} />} label="Edit message" onClick={() => { setSheet(false); onStartEdit(message.id) }} />}
          {canPin && <SheetRow icon={message.pinned ? <PinOff size={18} /> : <Pin size={18} />} label={message.pinned ? 'Unpin' : 'Pin message'} onClick={() => { setSheet(false); run(() => togglePin(message), 'Could not update pin') }} />}
          {plainText && <SheetRow icon={<Copy size={18} />} label="Copy text" onClick={() => { setSheet(false); void navigator.clipboard.writeText(bodyText); toast('Copied to clipboard', 'ok') }} />}
          {canCopyImage && <SheetRow icon={<ImageIcon size={18} />} label="Copy image" onClick={() => { setSheet(false); run(() => copyImage().then(() => toast('Image copied to clipboard', 'ok')), 'Could not copy image') }} />}
          {canForward && <SheetRow icon={<Forward size={18} />} label="Forward message" onClick={() => { setSheet(false); setForwarding(true) }} />}
          {canMute && (
            <SheetRow
              icon={muted ? <Bell size={18} /> : <BellOff size={18} />}
              label={muted ? 'Unmute user' : 'Mute user'}
              onClick={() => { setSheet(false); toggleMuteUser(message.author.id) }}
            />
          )}
          {canDelete && <SheetRow icon={<Trash2 size={18} />} label="Delete message" danger onClick={() => { setSheet(false); setConfirmDelete(true) }} />}
        </ActionSheet>
      )}

      {forwarding && <ForwardMessageModal message={message} bodyText={bodyText} onClose={() => setForwarding(false)} />}

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
