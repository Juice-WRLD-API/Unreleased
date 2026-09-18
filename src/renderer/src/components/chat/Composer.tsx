import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { AtSign, Command, CornerUpLeft, FileText, Loader2, Music, Paperclip, SendHorizontal, SmilePlus, X } from 'lucide-react'
import * as chatApi from '../../lib/chatApi'
import { MAX_CHAT_UPLOAD_BYTES, type ChatUserBrief } from '../../lib/chatApi'
import { CHAT_COMMANDS, currentParamIndex, parseChatCommand, type ChatCommandInfo, type ParsedChatCommand } from '../../lib/chatCommands'
import { splitForwardRef } from '../../lib/chatForwardRef'
import { encodeReplyRef, splitReplyRef } from '../../lib/chatReplyRef'
import { encodeSongInfoShare, encodeSongShare } from '../../lib/chatShare'
import { buildImageUrl, resolveTitleToSong, searchSongs, songToTrack, type JWApiSong } from '../../lib/juicewrldApi'
import { allSkins } from '../../lib/skins'
import { displayName, roomKey, useChatStore, type RoomRef, type UiMessage } from '../../store/chatStore'
import { useStore } from '../../store/useStore'
import ReactionPicker from './ReactionPicker'
import { emojiGlyph, EMOJI_IMG } from './emoji'
import { EVERYONE_HANDLE, mentionIdsIn } from './people'

const EMOJI_NAMES = Object.keys(EMOJI_IMG).sort()
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
    const raw = replyTo.is_encrypted
      ? (() => { const p = s.plain[replyTo.id]; return p && 'text' in p ? p.text : '' })()
      : replyTo.content
    const { ref, body: afterReply } = splitReplyRef(raw)
    const body = splitForwardRef(afterReply).body
    return body || (ref ? ref.snippet : raw)
  })
  const toast = useChatToast()
  const draftKey = `${roomKey(room)}:${parent ?? 'root'}`

  const [text, setText] = useState(() => drafts.get(draftKey) ?? '')
  const [files, setFiles] = useState<PendingFile[]>([])
  const [mention, setMention] = useState<{ start: number; query: string; index: number } | null>(null)
  const [emojiQuery, setEmojiQuery] = useState<{ start: number; query: string; index: number } | null>(null)
  const [emojiAt, setEmojiAt] = useState<{ x: number; y: number } | null>(null)
  const [commandBusy, setCommandBusy] = useState<string | null>(null)
  const [searchPick, setSearchPick] = useState<{ query: string; results: JWApiSong[]; index: number } | null>(null)
  const [slashQuery, setSlashQuery] = useState<{ query: string; index: number } | null>(null)
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

  const candidates = useMemo((): (ChatUserBrief | typeof EVERYONE_HANDLE)[] => {
    if (!mention) return []
    const q = mention.query.toLowerCase()
    const users = people
      .filter((p) => p.id !== meId)
      .filter((p) => !q || p.username.toLowerCase().includes(q) || p.display_name.toLowerCase().includes(q))
      .slice(0, 6)
    // room.kind === 'conversation' already notifies every participant on
    // every message, so @everyone only makes sense (and only matters) in a
    // shared channel with more than a couple of members.
    if (room.kind === 'channel' && EVERYONE_HANDLE.startsWith(q)) return [EVERYONE_HANDLE as typeof EVERYONE_HANDLE, ...users].slice(0, 6)
    return users
  }, [mention, people, meId, room.kind])

  const updateMention = (value: string, caret: number): void => {
    const upto = value.slice(0, caret)
    const match = /(^|\s)@([\w.-]{0,32})$/.exec(upto)
    if (match) setMention({ start: caret - match[2].length - 1, query: match[2], index: 0 })
    else setMention(null)
  }

  // Only offers to autocomplete while the caret is still inside the command
  // word itself (no space typed yet) at the very start of the message - once
  // args start, or if this isn't the whole message, it gets out of the way.
  const slashCandidates = useMemo(() => {
    if (!slashQuery) return []
    const q = slashQuery.query.toLowerCase()
    return CHAT_COMMANDS.filter((c) => c.name.startsWith(q) || c.aliases?.some((a) => a.startsWith(q)))
  }, [slashQuery])

  // Once the command name itself is fully typed (the slash autocomplete above
  // hands off here as soon as a space follows it), show a Discord-style
  // parameter hint: every param the command takes, with whichever one the
  // user is currently filling in highlighted.
  const activeCommand = useMemo(() => {
    if (replyTo || files.length > 0 || !text.startsWith('/')) return null
    const parsed = parseChatCommand(text)
    if (!parsed) return null
    const info = CHAT_COMMANDS.find((c) => c.name === parsed.command)
    if (!info) return null
    // Raw (untrimmed) text after the command word, so a trailing space the
    // user just typed still counts toward moving on to the next param.
    const rawArgs = /^\/\w+(?:\s([\s\S]*))?$/.exec(text)?.[1] ?? ''
    return { info, paramIndex: currentParamIndex(info.params, rawArgs), argsEmpty: parsed.args === '' }
  }, [text, replyTo, files])

  // Discord shows the parameter you're about to fill as a placeholder chip
  // right inside the input, not just in a popup above it - it disappears the
  // moment you start typing. We only have a slot to show once (every command
  // takes at most one param today), so this is just "nothing typed yet".
  const showInlineParamChip = !!activeCommand && activeCommand.info.params.length > 0 && activeCommand.argsEmpty
    && !(slashQuery && slashCandidates.length > 0)

  const updateSlashQuery = (value: string, caret: number): void => {
    const match = /^\/(\w*)$/.exec(value.slice(0, caret))
    if (match && caret === value.length && !replyTo && files.length === 0) {
      setSlashQuery({ query: match[1].toLowerCase(), index: 0 })
    } else {
      setSlashQuery(null)
    }
  }

  const applySlashCommand = (info: ChatCommandInfo): void => {
    const insert = `/${info.name} `
    setText(insert)
    setSlashQuery(null)
    requestAnimationFrame(() => {
      textarea.current?.focus()
      textarea.current?.setSelectionRange(insert.length, insert.length)
    })
  }

  const emojiCandidates = useMemo(() => {
    if (!emojiQuery) return []
    const q = emojiQuery.query.toLowerCase()
    return EMOJI_NAMES.filter((n) => n.startsWith(q)).slice(0, 6)
  }, [emojiQuery])

  const updateEmojiQuery = (value: string, caret: number): void => {
    const upto = value.slice(0, caret)
    const match = /(^|\s):([a-z0-9_]{1,32})$/i.exec(upto)
    if (match) setEmojiQuery({ start: caret - match[2].length - 1, query: match[2], index: 0 })
    else setEmojiQuery(null)
  }

  const applyEmoji = (name: string): void => {
    if (!emojiQuery) return
    const el = textarea.current
    const caret = el?.selectionStart ?? text.length
    const insert = `:${name}: `
    const next = text.slice(0, emojiQuery.start) + insert + text.slice(caret)
    setText(next)
    setEmojiQuery(null)
    requestAnimationFrame(() => {
      const pos = emojiQuery.start + insert.length
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }

  const applyMention = (user: ChatUserBrief | typeof EVERYONE_HANDLE): void => {
    if (!mention) return
    const el = textarea.current
    const caret = el?.selectionStart ?? text.length
    const insert = `@${user === EVERYONE_HANDLE ? EVERYONE_HANDLE : user.username} `
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

  // Local, synchronous commands - no network round-trip, so they never touch
  // commandBusy/toast('ok') the way the async ones below do.
  const applyThemeCommand = (args: string): void => {
    if (!args) { toast(`Themes: ${allSkins().map((s) => s.name).join(', ')}`, 'ok'); return }
    const norm = (s: string): string => s.toLowerCase().replace(/[\s_-]+/g, '')
    const wanted = norm(args)
    const match = allSkins().find((s) => norm(s.id) === wanted || norm(s.name) === wanted)
    if (!match) { toast(`Unknown theme "${args}"`); return }
    useStore.getState().setTheme(match.id)
    toast(`Theme set to ${match.name}`, 'ok')
  }

  const runHelpCommand = (): void => {
    toast(
      'Commands: /song <title>, /search <title>, /info <title>, /np (or /nowplaying), /theme <name>, /mute @user, /unmute @user, /promote @user, /kick @user, /feedback <message>',
      'ok',
    )
  }

  const runMuteCommand = (args: string, usage: '/mute' | '/unmute'): void => {
    const uname = args.replace(/^@/, '').trim()
    if (!uname) { toast(`Usage: ${usage} @username`); return }
    const target = people.find((p) => p.username.toLowerCase() === uname.toLowerCase())
    if (!target) { toast(`No one named "${uname}" here`); return }
    if (target.id === meId) { toast("You can't mute yourself"); return }
    const wasMuted = useStore.getState().mutedUserIds.includes(target.id)
    if (usage === '/unmute' && !wasMuted) { toast(`${displayName(target)} isn't muted`); return }
    useStore.getState().toggleMuteUser(target.id)
    toast(wasMuted ? `Unmuted ${displayName(target)}` : `Muted ${displayName(target)} - their channel/server messages are hidden for you`, 'ok')
  }

  // "Now playing" card shares the exact Track the player has queued, so it
  // only works for API-sourced tracks (id "jw-<n>") - a local file has
  // nothing a recipient's client could stream from, and encodeSongShare's
  // decode side would reject it anyway (streamUrl isn't a JWAPI_BASE URL).
  const shareNowPlayingCommand = async (): Promise<void> => {
    const track = useStore.getState().currentTrack
    if (!track) { toast('Nothing is playing right now'); return }
    const match = track.id.match(/^jw-(\d+)$/)
    if (!match) { toast("The current track isn't from the song library, so it can't be shared"); return }
    await send(room, { text: encodeSongShare(track, Number(match[1])), files: [] })
  }

  // Routes through the same outbox as the Settings feedback form (see
  // useStore's submitFeedback/pendingReports) - it's queued locally first, so
  // this resolves even if delivery hasn't happened yet.
  const runFeedbackCommand = async (args: string): Promise<void> => {
    if (!args) { toast('Usage: /feedback <message>'); return }
    await useStore.getState().submitFeedback('other', args)
    toast('Feedback sent - thanks!', 'ok')
  }

  const runInfoCommand = async (args: string): Promise<void> => {
    if (!args) { toast('Usage: /info <title>'); return }
    const song = await resolveTitleToSong(args)
    if (!song) { toast(`No song found for "${args}"`); return }
    await send(room, { text: encodeSongInfoShare(song, buildImageUrl(song.image_url)), files: [] })
  }

  const runPromoteCommand = async (args: string): Promise<void> => {
    const uname = args.replace(/^@/, '').trim()
    if (!uname) { toast('Usage: /promote @username'); return }
    if (room.kind !== 'channel') { toast('/promote only works in a server channel'); return }
    const cs = useChatStore.getState()
    const server = cs.servers.find((s) => s.channels.some((c) => c.id === room.id))
    if (!server) { toast("Could not find this channel's server"); return }
    const canManage = cs.me?.role === 'administrator' || server.my_role === 'owner' || server.my_role === 'admin'
    if (!canManage) { toast("You don't have permission to promote members here"); return }
    const target = people.find((p) => p.username.toLowerCase() === uname.toLowerCase())
    if (!target) { toast(`No one named "${uname}" here`); return }
    if (target.id === server.owner) { toast("Can't change the owner's role"); return }
    const member = cs.members[server.id]?.find((m) => m.user.id === target.id)
    if (member?.server_role === 'admin') { toast(`${displayName(target)} is already an admin`); return }
    await chatApi.updateMember(server.id, target.id, { server_role: 'admin' })
    await cs.loadMembers(server.id, true)
    toast(`Promoted ${displayName(target)} to admin`, 'ok')
  }

  const runKickCommand = async (args: string): Promise<void> => {
    const uname = args.replace(/^@/, '').trim()
    if (!uname) { toast('Usage: /kick @username'); return }
    if (room.kind !== 'channel') { toast('/kick only works in a server channel'); return }
    const cs = useChatStore.getState()
    const server = cs.servers.find((s) => s.channels.some((c) => c.id === room.id))
    if (!server) { toast("Could not find this channel's server"); return }
    const canManage = cs.me?.role === 'administrator' || server.my_role === 'owner' || server.my_role === 'admin'
    if (!canManage) { toast("You don't have permission to kick members here"); return }
    const target = people.find((p) => p.username.toLowerCase() === uname.toLowerCase())
    if (!target) { toast(`No one named "${uname}" here`); return }
    if (target.id === meId) { toast("You can't kick yourself - use Leave server instead"); return }
    if (target.id === server.owner) { toast("Can't kick the owner"); return }
    await chatApi.removeMember(server.id, target.id)
    await cs.loadMembers(server.id, true)
    toast(`Kicked ${displayName(target)} from the server`, 'ok')
  }

  // "/song <query>", "/search <query>", "/info <query>", "/mute @user",
  // "/unmute @user", "/theme <name>", "/np", "/promote @user", "/kick @user",
  // "/feedback <message>" and "/help" are recognized only when they are the
  // entire message
  // (no reply-in-progress, no attachments) - anything else starting with "/"
  // (a URL, a stray command someone typed) falls through and sends as a
  // normal text message, same as before this feature existed.
  const runCommand = async (cmd: ParsedChatCommand): Promise<void> => {
    setText('')
    setFiles([])
    setMention(null)
    setEmojiQuery(null)
    setSearchPick(null)
    setSlashQuery(null)
    drafts.delete(draftKey)
    stopTyping()

    if (cmd.command === 'theme') { applyThemeCommand(cmd.args); return }
    if (cmd.command === 'mute') { runMuteCommand(cmd.args, '/mute'); return }
    if (cmd.command === 'unmute') { runMuteCommand(cmd.args, '/unmute'); return }
    if (cmd.command === 'help') { runHelpCommand(); return }

    setCommandBusy(cmd.command)
    try {
      if (cmd.command === 'song') {
        if (!cmd.args) { toast('Usage: /song <title>'); return }
        const song = await resolveTitleToSong(cmd.args)
        if (!song) { toast(`No song found for "${cmd.args}"`); return }
        await send(room, { text: encodeSongShare(songToTrack(song), song.id), files: [] })
      } else if (cmd.command === 'search') {
        if (!cmd.args) { toast('Usage: /search <title>'); return }
        const results = await searchSongs(cmd.args)
        if (results.length === 0) { toast(`No songs found for "${cmd.args}"`); return }
        if (results.length === 1) {
          await send(room, { text: encodeSongShare(songToTrack(results[0]), results[0].id), files: [] })
          return
        }
        setSearchPick({ query: cmd.args, results, index: 0 })
      } else if (cmd.command === 'info') {
        await runInfoCommand(cmd.args)
      } else if (cmd.command === 'np') {
        await shareNowPlayingCommand()
      } else if (cmd.command === 'promote') {
        await runPromoteCommand(cmd.args)
      } else if (cmd.command === 'kick') {
        await runKickCommand(cmd.args)
      } else if (cmd.command === 'feedback') {
        await runFeedbackCommand(cmd.args)
      }
    } catch (err) {
      toast(errorText(err, 'Command failed'))
    } finally {
      setCommandBusy(null)
    }
  }

  const pickSearchResult = (song: JWApiSong): void => {
    setSearchPick(null)
    send(room, { text: encodeSongShare(songToTrack(song), song.id), files: [] })
      .catch((err) => toast(errorText(err, 'Message failed to send')))
  }

  const submit = (): void => {
    if (disabledReason || commandBusy) return
    let body = text.trim()
    if (!body && files.length === 0) return
    if (!replyTo && files.length === 0) {
      const cmd = parseChatCommand(body)
      if (cmd) { void runCommand(cmd); return }
    }
    // Plain "Reply" (as opposed to replying inside a thread, which never sets
    // `replyTo`) posts a normal message in the room - it isn't threaded, so
    // the link back to the original message rides along as a small envelope
    // in the body, which MessageItem renders as a reply bar rather than text.
    if (replyTo) {
      const snippet = replyPreview.split('\n')[0].slice(0, 140)
      body = `${encodeReplyRef({
        id: replyTo.id,
        authorId: replyTo.author.id,
        name: displayName(replyTo.author),
        snippet,
        hasAttachment: replyTo.attachments.length > 0,
      })}${body}`
    }
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
    if (slashQuery && slashCandidates.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const dir = e.key === 'ArrowDown' ? 1 : -1
        setSlashQuery({ ...slashQuery, index: (slashQuery.index + dir + slashCandidates.length) % slashCandidates.length })
        return
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault()
        applySlashCommand(slashCandidates[slashQuery.index])
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); setSlashQuery(null); return }
    }
    if (searchPick && searchPick.results.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const dir = e.key === 'ArrowDown' ? 1 : -1
        setSearchPick({ ...searchPick, index: (searchPick.index + dir + searchPick.results.length) % searchPick.results.length })
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pickSearchResult(searchPick.results[searchPick.index])
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); setSearchPick(null); return }
    }
    if (emojiQuery && emojiCandidates.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const dir = e.key === 'ArrowDown' ? 1 : -1
        setEmojiQuery({ ...emojiQuery, index: (emojiQuery.index + dir + emojiCandidates.length) % emojiCandidates.length })
        return
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault()
        applyEmoji(emojiCandidates[emojiQuery.index])
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); setEmojiQuery(null); return }
    }
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
      {slashQuery && slashCandidates.length > 0 && (
        <div className="chat-pop absolute left-4 right-4 md:left-5 md:right-5 bottom-full mb-2 z-20 rounded-xl border border-[var(--border)] bg-surface shadow-2xl overflow-hidden">
          <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">Commands</p>
          <div className="max-h-64 overflow-y-auto chat-scroll">
            {slashCandidates.map((c, i) => (
              <button
                key={c.name}
                onMouseDown={(e) => { e.preventDefault(); applySlashCommand(c) }}
                onMouseEnter={() => setSlashQuery({ ...slashQuery, index: i })}
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left ${i === slashQuery.index ? 'bg-surface-overlay' : ''}`}
              >
                <Command size={14} className="shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-text-primary truncate">
                    {c.usage}
                    {c.aliases && c.aliases.length > 0 && (
                      <span className="text-text-muted"> (or /{c.aliases.join(', /')})</span>
                    )}
                  </span>
                  <span className="block text-xs text-text-muted truncate">{c.description}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!(slashQuery && slashCandidates.length > 0) && activeCommand && (
        <div className="chat-pop absolute left-4 right-4 md:left-5 md:right-5 bottom-full mb-2 z-20 rounded-xl border border-[var(--border)] bg-surface shadow-2xl px-3 py-2">
          <div className="flex items-center gap-1.5 flex-wrap text-sm font-mono">
            <span className="text-text-primary">/{activeCommand.info.name}</span>
            {activeCommand.info.params.length === 0 ? (
              <span className="text-text-muted text-xs font-sans">takes no parameters</span>
            ) : (
              activeCommand.info.params.map((p, i) => (
                <span
                  key={p}
                  className={i === activeCommand.paramIndex ? 'text-accent font-semibold' : 'text-text-muted'}
                >
                  {`<${p}>`}
                </span>
              ))
            )}
          </div>
          <p className="mt-0.5 text-xs text-text-muted">{activeCommand.info.description}</p>
        </div>
      )}

      {searchPick && searchPick.results.length > 0 && (
        <div className="chat-pop absolute left-4 right-4 md:left-5 md:right-5 bottom-full mb-2 z-20 rounded-xl border border-[var(--border)] bg-surface shadow-2xl overflow-hidden">
          <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">Results for "{searchPick.query}"</p>
          <div className="max-h-64 overflow-y-auto chat-scroll">
            {searchPick.results.map((song, i) => (
              <button
                key={song.id}
                onMouseDown={(e) => { e.preventDefault(); pickSearchResult(song) }}
                onMouseEnter={() => setSearchPick({ ...searchPick, index: i })}
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left ${i === searchPick.index ? 'bg-surface-overlay' : ''}`}
              >
                <Music size={14} className="shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-text-primary truncate">{song.name}</span>
                  <span className="block text-xs text-text-muted truncate">{song.era?.name ?? song.category}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {mention && candidates.length > 0 && (
        <div className="chat-pop absolute left-4 right-4 md:left-5 md:right-5 bottom-full mb-2 z-20 rounded-xl border border-[var(--border)] bg-surface shadow-2xl overflow-hidden">
          <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">Members</p>
          {candidates.map((p, i) => (
            <button
              key={p === EVERYONE_HANDLE ? EVERYONE_HANDLE : p.id}
              onMouseDown={(e) => { e.preventDefault(); applyMention(p) }}
              onMouseEnter={() => setMention({ ...mention, index: i })}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left ${i === mention.index ? 'bg-surface-overlay' : ''}`}
            >
              {p === EVERYONE_HANDLE ? (
                <>
                  <span className="h-6 w-6 shrink-0 rounded-full bg-surface-raised flex items-center justify-center text-text-secondary"><AtSign size={13} /></span>
                  <span className="text-sm text-text-primary truncate">everyone</span>
                  <span className="text-xs text-text-muted truncate">Notify everyone in this channel</span>
                </>
              ) : (
                <>
                  <ChatAvatar user={p} size={24} presence />
                  <span className="text-sm text-text-primary truncate">{displayName(p)}</span>
                  <span className="text-xs text-text-muted truncate">@{p.username}</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}

      {!mention && emojiQuery && emojiCandidates.length > 0 && (
        <div className="chat-pop absolute left-4 right-4 md:left-5 md:right-5 bottom-full mb-2 z-20 rounded-xl border border-[var(--border)] bg-surface shadow-2xl overflow-hidden">
          <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">Emoji</p>
          {emojiCandidates.map((name, i) => (
            <button
              key={name}
              onMouseDown={(e) => { e.preventDefault(); applyEmoji(name) }}
              onMouseEnter={() => setEmojiQuery({ ...emojiQuery, index: i })}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left ${i === emojiQuery.index ? 'bg-surface-overlay' : ''}`}
            >
              <img src={EMOJI_IMG[name]} alt="" className="h-5 w-5 shrink-0 object-contain" />
              <span className="text-sm text-text-primary truncate">:{name}:</span>
            </button>
          ))}
        </div>
      )}

      {commandBusy && (
        <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-surface-raised/70 px-2.5 py-1.5 text-xs text-text-muted">
          <Loader2 size={13} className="shrink-0 animate-spin" />
          <span>Running /{commandBusy}...</span>
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
          <div className="relative flex-1 min-w-0">
            <textarea
              ref={textarea}
              value={text}
              rows={1}
              disabled={!!disabledReason}
              placeholder={disabledReason ?? placeholder}
              onChange={(e) => {
                setText(e.target.value)
                updateMention(e.target.value, e.target.selectionStart)
                updateEmojiQuery(e.target.value, e.target.selectionStart)
                updateSlashQuery(e.target.value, e.target.selectionStart)
                if (e.target.value) noteTyping()
                else stopTyping()
              }}
              onKeyDown={onKeyDown}
              onClick={(e) => {
                updateMention(text, e.currentTarget.selectionStart)
                updateEmojiQuery(text, e.currentTarget.selectionStart)
                updateSlashQuery(text, e.currentTarget.selectionStart)
              }}
              onBlur={() => { window.setTimeout(() => { setMention(null); setEmojiQuery(null); setSearchPick(null); setSlashQuery(null) }, 120) }}
              onPaste={(e) => {
                const pasted = Array.from(e.clipboardData.files)
                if (pasted.length) {
                  e.preventDefault()
                  addFiles(pasted)
                }
              }}
              className="w-full resize-none bg-transparent px-1.5 py-2 text-[0.9rem] leading-relaxed text-text-primary placeholder:text-text-muted focus:outline-none disabled:cursor-not-allowed"
            />
            {showInlineParamChip && activeCommand && (
              <div aria-hidden className="absolute inset-0 px-1.5 py-2 text-[0.9rem] leading-relaxed whitespace-pre-wrap break-words pointer-events-none overflow-hidden">
                <span className="invisible">{text}</span>
                <span className="inline-block rounded border border-accent/40 bg-accent/15 px-1 text-accent text-[0.8em] font-medium align-baseline">
                  {activeCommand.info.params[activeCommand.paramIndex]}
                </span>
              </div>
            )}
          </div>
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

      {emojiAt && (
        <ReactionPicker x={emojiAt.x} y={emojiAt.y} onPick={(name) => insertAtCaret(emojiGlyph(name))} onClose={() => setEmojiAt(null)} />
      )}
    </div>
  )
})

export default Composer
