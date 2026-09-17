import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { CornerUpLeft, FileText, Lock, Paperclip, SendHorizontal, SmilePlus, X } from 'lucide-react'
import { MAX_CHAT_UPLOAD_BYTES, type ChatUserBrief } from '../../lib/chatApi'
import { displayName, roomKey, useChatStore, type RoomRef, type UiMessage } from '../../store/chatStore'
import ReactionPicker from './ReactionPicker'
import { emojiGlyph } from './emoji'
import { mentionIdsIn } from './people'
import { ChatAvatar, errorText, formatBytes, useChatToast } from './ui'

export interface ComposerHandle {
  addFiles: (files: File[]) => void
  focus: () => void
}

interface PendingFile {
  id: string
  file: File
  preview: string | null
}

const drafts = new Map<string, string>()
const BLOCKED_EXT = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|jar|apk|app|dmg|sh)$/i

const Composer = forwardRef<ComposerHandle, {
  room: RoomRef
  people: ChatUserBrief[]
  placeholder: string
  parent?: number | null
  replyTo?: UiMessage | null
  onCancelReply?: () => void
  disabledReason?: string | null
  encrypted?: boolean
  onEditLast?: () => void
  compact?: boolean
  enterSends?: boolean
}>(function Composer({ room, people, placeholder, parent = null, replyTo, onCancelReply, disabledReason, encrypted, onEditLast, compact, enterSends = true }, ref) {
  const send = useChatStore((s) => s.send)
  const sendTyping = useChatStore((s) => s.sendTyping)
  const meId = useChatStore((s) => s.meId)
  const replyPreview = useChatStore((s) => {
    if (!replyTo) return ''
    if (!replyTo.is_encrypted) return replyTo.content
    const p = s.plain[replyTo.id]
    return p && 'text' in p ? p.text : ''
  })
  const toast = useChatToast()
  const draftKey = `${roomKey(room)}:${parent ?? 'root'}`

  const [text, setText] = useState(() => drafts.get(draftKey) ?? '')
  const [files, setFiles] = useState<PendingFile[]>([])
  const [mention, setMention] = useState<{ start: number; query: string; index: number } | null>(null)
  const [emojiAt, setEmojiAt] = useState<{ x: number; y: number } | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const typingSentAt = useRef(0)
  const typingStop = useRef<number | null>(null)

  useEffect(() => {
    setText(drafts.get(draftKey) ?? '')
    setFiles([])
    setMention(null)
  }, [draftKey])

  useEffect(() => { drafts.set(draftKey, text) }, [draftKey, text])

  useEffect(() => { if (replyTo) textarea.current?.focus() }, [replyTo])

  useEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, compact ? 140 : 220)}px`
  }, [text, compact])

  useEffect(() => () => {
    if (typingStop.current !== null) window.clearTimeout(typingStop.current)
    files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addFiles = (incoming: File[]): void => {
    const accepted: PendingFile[] = []
    for (const file of incoming) {
      if (file.size > MAX_CHAT_UPLOAD_BYTES) { toast(`"${file.name}" is over 25 MB`); continue }
      if (BLOCKED_EXT.test(file.name)) { toast(`"${file.name}" can't be sent - executable files are blocked`); continue }
      accepted.push({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
        file,
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      })
    }
    setFiles((f) => [...f, ...accepted].slice(0, 10))
    textarea.current?.focus()
  }

  useImperativeHandle(ref, () => ({
    addFiles,
    focus: () => textarea.current?.focus(),
  }))

  const stopTyping = (): void => {
    if (typingStop.current !== null) window.clearTimeout(typingStop.current)
    typingStop.current = null
    if (typingSentAt.current) {
      typingSentAt.current = 0
      sendTyping(room, false)
    }
  }

  const noteTyping = (): void => {
    const now = Date.now()
    if (now - typingSentAt.current > 3000) {
      typingSentAt.current = now
      sendTyping(room, true)
    }
    if (typingStop.current !== null) window.clearTimeout(typingStop.current)
    typingStop.current = window.setTimeout(stopTyping, 4000)
  }

  const candidates = useMemo(() => {
    if (!mention) return []
    const q = mention.query.toLowerCase()
    return people
      .filter((p) => p.id !== meId)
      .filter((p) => !q || p.username.toLowerCase().includes(q) || p.display_name.toLowerCase().includes(q))
      .slice(0, 6)
  }, [mention, people, meId])

  const updateMention = (value: string, caret: number): void => {
    const upto = value.slice(0, caret)
    const match = /(^|\s)@([\w.-]{0,32})$/.exec(upto)
    if (match) setMention({ start: caret - match[2].length - 1, query: match[2], index: 0 })
    else setMention(null)
  }

  const applyMention = (user: ChatUserBrief): void => {
    if (!mention) return
    const el = textarea.current
    const caret = el?.selectionStart ?? text.length
    const insert = `@${user.username} `
    const next = text.slice(0, mention.start) + insert + text.slice(caret)
    setText(next)
    setMention(null)
    requestAnimationFrame(() => {
      const pos = mention.start + insert.length
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }

  const insertAtCaret = (value: string): void => {
    const el = textarea.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    setText(text.slice(0, start) + value + text.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + value.length, start + value.length)
    })
  }

  const submit = (): void => {
    if (disabledReason) return
    const body = text.trim()
    if (!body && files.length === 0) return
    const outgoing = files.map((f) => f.file)
    files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview))
    setText('')
    setFiles([])
    setMention(null)
    drafts.delete(draftKey)
    stopTyping()
    onCancelReply?.()
    send(room, { text: body, files: outgoing, parent, mentions: mentionIdsIn(body, people) })
      .catch((err) => toast(errorText(err, 'Message failed to send')))
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (mention && candidates.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const dir = e.key === 'ArrowDown' ? 1 : -1
        setMention({ ...mention, index: (mention.index + dir + candidates.length) % candidates.length })
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        applyMention(candidates[mention.index])
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); setMention(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && enterSends) {
      e.preventDefault()
      submit()
      return
    }
    if (e.key === 'ArrowUp' && !text && files.length === 0 && onEditLast) {
      e.preventDefault()
      onEditLast()
    }
  }

  const canSend = !disabledReason && (text.trim().length > 0 || files.length > 0)

  return (
    <div className={`relative ${compact ? 'px-3 pb-3' : 'px-4 md:px-5 pb-4'}`}>
      {mention && candidates.length > 0 && (
        <div className="chat-pop absolute left-4 right-4 md:left-5 md:right-5 bottom-full mb-2 z-20 rounded-xl border border-[var(--border)] bg-surface shadow-2xl overflow-hidden">
          <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">Members</p>
          {candidates.map((p, i) => (
            <button
              key={p.id}
              onMouseDown={(e) => { e.preventDefault(); applyMention(p) }}
              onMouseEnter={() => setMention({ ...mention, index: i })}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left ${i === mention.index ? 'bg-surface-overlay' : ''}`}
            >
              <ChatAvatar user={p} size={24} presence />
              <span className="text-sm text-text-primary truncate">{p.display_name || p.username}</span>
              <span className="text-xs text-text-muted truncate">@{p.username}</span>
            </button>
          ))}
        </div>
      )}

      {replyTo && (
        <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-surface-raised/70 px-2.5 py-1.5 text-xs">
          <CornerUpLeft size={13} className="shrink-0 text-text-muted" />
          <span className="shrink-0 font-semibold text-text-secondary">Replying to {displayName(replyTo.author)}</span>
          <span className="min-w-0 flex-1 truncate text-text-muted">{replyPreview || (replyTo.attachments.length ? 'Attachment' : '')}</span>
          <button onClick={onCancelReply} title="Cancel reply" className="shrink-0 text-text-muted hover:text-text-primary">
            <X size={14} />
          </button>
        </div>
      )}

      <div
        className={`rounded-2xl border bg-surface-raised/70 transition-colors ${
          disabledReason ? 'border-[var(--border)] opacity-70' : 'border-[var(--border)] focus-within:border-accent/50'
        }`}
      >
        {files.length > 0 && (
          <div className="flex gap-2 overflow-x-auto chat-scroll p-2.5 pb-0">
            {files.map((f) => (
              <div key={f.id} className="chat-pop relative shrink-0 w-24 rounded-xl border border-[var(--border)] bg-surface overflow-hidden">
                {f.preview ? (
                  <img src={f.preview} alt="" className="w-24 h-20 object-cover" />
                ) : (
                  <div className="w-24 h-20 flex items-center justify-center text-text-muted"><FileText size={24} /></div>
                )}
                <div className="px-1.5 py-1">
                  <p className="text-[10px] text-text-primary truncate">{f.file.name}</p>
                  <p className="text-[9px] text-text-muted">{formatBytes(f.file.size)}</p>
                </div>
                <button
                  onClick={() => {
                    if (f.preview) URL.revokeObjectURL(f.preview)
                    setFiles((list) => list.filter((x) => x.id !== f.id))
                  }}
                  title="Remove"
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-red-500"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-1 p-1.5">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={!!disabledReason}
            title="Attach files"
            className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors disabled:opacity-40"
          >
            <Paperclip size={18} />
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
          <textarea
            ref={textarea}
            value={text}
            rows={1}
            disabled={!!disabledReason}
            placeholder={disabledReason ?? placeholder}
            onChange={(e) => {
              setText(e.target.value)
              updateMention(e.target.value, e.target.selectionStart)
              if (e.target.value) noteTyping()
              else stopTyping()
            }}
            onKeyDown={onKeyDown}
            onClick={(e) => updateMention(text, e.currentTarget.selectionStart)}
            onBlur={() => { window.setTimeout(() => setMention(null), 120) }}
            onPaste={(e) => {
              const pasted = Array.from(e.clipboardData.files)
              if (pasted.length) {
                e.preventDefault()
                addFiles(pasted)
              }
            }}
            className="flex-1 min-w-0 resize-none bg-transparent px-1.5 py-2 text-[0.9rem] leading-relaxed text-text-primary placeholder:text-text-muted focus:outline-none disabled:cursor-not-allowed"
          />
          {!compact && (
            <button
              type="button"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setEmojiAt({ x: r.right - 296, y: r.top - 380 })
              }}
              disabled={!!disabledReason}
              title="Emoji"
              className="hidden md:flex w-9 h-9 shrink-0 rounded-xl items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors disabled:opacity-40"
            >
              <SmilePlus size={18} />
            </button>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            title="Send"
            className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center transition-all ${
              canSend ? 'bg-accent text-white hover:brightness-110 scale-100' : 'text-text-muted scale-95'
            }`}
          >
            <SendHorizontal size={17} />
          </button>
        </div>
      </div>

      {!compact && (
        <div className="hidden md:flex items-center justify-between px-2 pt-1.5 text-[10px] text-text-muted select-none">
          <span>
            <kbd className="font-sans">Enter</kbd> to send · <kbd className="font-sans">Shift+Enter</kbd> for a new line · <kbd className="font-sans">↑</kbd> to edit
          </span>
          {encrypted && <span className="inline-flex items-center gap-1"><Lock size={10} />End-to-end encrypted</span>}
        </div>
      )}

      {emojiAt && (
        <ReactionPicker x={emojiAt.x} y={emojiAt.y} onPick={(name) => insertAtCaret(emojiGlyph(name))} onClose={() => setEmojiAt(null)} />
      )}
    </div>
  )
})

export default Composer
