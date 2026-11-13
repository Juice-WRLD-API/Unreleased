import { Fragment, memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BadgeCheck, Ban, Eraser, Link2, ListX, Loader2, MoreHorizontal, Pencil, Power, Send, ShieldOff, SmilePlus, Trash2, UserX, X } from 'lucide-react'
import ContextMenu from './ContextMenu'
import type { ContextMenuEntry } from './ContextMenu'
import { useStore } from '../store/useStore'
import { useRadioChatStore } from '../store/radioChatStore'
import type { RadioChatPending } from '../store/radioChatStore'
import {
  acquireRadioChat, applyRadioChatGuests, applyRadioChatLinks, applyRadioChatState, dismissRadioChatPending, dropRadioChatLines, linksMode,
  sendRadioChat,
} from '../lib/radioChatSocket'
import {
  RADIO_CHAT_LINK_MODES, RADIO_CHAT_MAX_NAME, RADIO_CHAT_MAX_TEXT, banRadioChatAuthor, deleteRadioChatMessage, fetchRadioChat,
  fetchRadioChatAdminState, fetchRadioChatBans, liftRadioChatBan, setRadioChatState,
} from '../lib/radioChatApi'
import type { RadioChatBan, RadioChatLinks, RadioChatMessage } from '../lib/radioChatApi'
import { showAppToast } from '../lib/appToast'
import { loadAllSongs } from '../lib/juicewrldApi'
import { trackShareUrl } from '../lib/platform'
import { matchRadioChatSongs } from '../lib/radioChatSongs'
import { relativeTime } from './adminShared'
import EmojiImg from './chat/EmojiImg'
import { emojiGlyph, splitChatEmoji } from './chat/emoji'
import ReactionPicker from './chat/ReactionPicker'

// The 999 FM live chat, a tab of WRLD's FM panel (desktop and phone). Anyone
// can read and post; admins get the killswitches (everyone, or guests only),
// delete and ban, who may post links, and the blocked words. Styled for WRLD's dark backdrop like the Radio tab beside it.

const BAN_LENGTHS: { label: string; minutes: number }[] = [
  { label: '10 minutes', minutes: 10 },
  { label: '1 hour', minutes: 60 },
  { label: '1 day', minutes: 60 * 24 },
  { label: 'Until lifted', minutes: 0 },
]

// Guest names get a steady colour each, so a conversation is easy to follow.
const NAME_COLORS = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#2dd4bf', '#60a5fa', '#a78bfa', '#f472b6']
function nameColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return NAME_COLORS[h % NAME_COLORS.length]
}

const errorText = (e: unknown): string => (e instanceof Error && e.message ? e.message : 'Something went wrong')

interface MenuState { x: number; y: number; line: RadioChatMessage }

type MatchSongs = ReturnType<typeof matchRadioChatSongs>
const plainText: MatchSongs = (text) => [{ text }]

const MessageText = memo(function MessageText({ text, matchSongs }: { text: string; matchSongs: MatchSongs }): JSX.Element {
  return (
    <span className="text-white/75">
      {matchSongs(text).map(({ text, songId }, i) => {
        const content = splitChatEmoji(text).map(({ text, name }, j) => name
          ? <EmojiImg key={j} name={name} className="h-[1.5em] w-[1.5em] align-[-0.3em]" />
          : text)
        return songId == null ? <Fragment key={i}>{content}</Fragment> : (
          <a key={i} href={trackShareUrl(songId)} target="_blank" rel="noopener noreferrer" className="text-sky-300 underline decoration-sky-300/60 hover:text-sky-100">
            {content}
          </a>
        )
      })}
    </span>
  )
})

export default function RadioChatPanel(): JSX.Element {
  const isAdmin = useStore((s) => !!s.account?.is_administrator)
  const signedIn = useStore((s) => !!s.account)
  const setShowUserAuth = useStore((s) => s.setShowUserAuth)
  const { status, enabled, guestsEnabled, reason, links, messages, pending, authPending, name, setName } = useRadioChatStore()
  const [draft, setDraft] = useState('')
  const [matchSongs, setMatchSongs] = useState<MatchSongs>(() => plainText)
  const [emojiAt, setEmojiAt] = useState<{ x: number; y: number } | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(name)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [adminMenu, setAdminMenu] = useState<{ x: number; y: number } | null>(null)
  const [bans, setBans] = useState<RadioChatBan[] | null>(null)
  // The blocked-words editor: null while closed, '' text while it loads.
  const [words, setWords] = useState<{ text: string; loading: boolean; saving: boolean } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const stickRef = useRef(true)

  useEffect(() => acquireRadioChat(), [])
  useEffect(() => {
    let cancelled = false
    loadAllSongs().then((songs) => {
      if (!cancelled) setMatchSongs(() => matchRadioChatSongs(songs))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // First paint from REST while the socket is still connecting.
  useEffect(() => {
    if (useRadioChatStore.getState().enabled !== null) return
    const ctrl = new AbortController()
    fetchRadioChat(ctrl.signal)
      .then((snap) => {
        if (useRadioChatStore.getState().enabled !== null) return
        useRadioChatStore.setState({ enabled: snap.enabled, guestsEnabled: snap.guests_enabled !== false, reason: snap.reason, links: linksMode(snap.links), messages: snap.messages })
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [])

  // Stay pinned to the newest line unless the reader has scrolled up.
  const onScroll = (): void => {
    const el = listRef.current
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }
  useLayoutEffect(() => {
    const el = listRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [messages, pending, enabled, matchSongs])

  const send = (): void => {
    const text = draft.trim()
    if (!text) return
    stickRef.current = true
    if (sendRadioChat(text)) setDraft('')
    else showAppToast('Chat isn’t connected yet. Try again in a moment.')
  }

  const insertEmoji = (name: string): void => {
    const input = inputRef.current
    if (!input) return
    const start = input.selectionStart ?? draft.length
    const end = input.selectionEnd ?? start
    const glyph = emojiGlyph(name)
    const next = draft.slice(0, start) + glyph + draft.slice(end)
    if (next.length > RADIO_CHAT_MAX_TEXT) return
    setDraft(next)
    requestAnimationFrame(() => {
      input.focus()
      input.setSelectionRange(start + glyph.length, start + glyph.length)
    })
  }

  const saveName = (): void => {
    setName(nameDraft.trim().slice(0, RADIO_CHAT_MAX_NAME))
    setEditingName(false)
  }

  // Optimistic: the switch flips here at once, and back if the server says no.
  const toggleChat = (on: boolean, clear = false): void => {
    const before = useRadioChatStore.getState()
    applyRadioChatState(on)
    if (clear) useRadioChatStore.setState({ messages: [] })
    setRadioChatState({ enabled: on, clear: clear || undefined }).catch((e) => {
      useRadioChatStore.setState({ enabled: before.enabled, reason: before.reason, ...(clear ? { messages: before.messages } : null) })
      showAppToast(`Couldn’t turn chat ${on ? 'on' : 'off'}: ${errorText(e)}`)
    })
  }

  const toggleGuests = (on: boolean): void => {
    const before = useRadioChatStore.getState().guestsEnabled
    applyRadioChatGuests(on)
    setRadioChatState({ guests: on }).catch((e) => {
      applyRadioChatGuests(before)
      showAppToast(`Couldn’t turn guests ${on ? 'on' : 'off'}: ${errorText(e)}`)
    })
  }

  const setLinks = (mode: RadioChatLinks): void => {
    const before = useRadioChatStore.getState().links
    if (mode === before) return
    applyRadioChatLinks(mode)
    setRadioChatState({ links: mode }).catch((e) => {
      applyRadioChatLinks(before)
      showAppToast(`Couldn’t change who can post links: ${errorText(e)}`)
    })
  }

  const openWords = (): void => {
    setWords({ text: '', loading: true, saving: false })
    fetchRadioChatAdminState()
      .then((s) => setWords((cur) => (cur ? { ...cur, text: (s.blocked_words ?? []).join('\n'), loading: false } : cur)))
      .catch((e) => {
        setWords(null)
        showAppToast(`Couldn’t load the blocked words: ${errorText(e)}`)
      })
  }

  const saveWords = (): void => {
    if (!words) return
    const list = words.text.split(/[\n,]/).map((w) => w.trim()).filter(Boolean)
    setWords({ ...words, saving: true })
    setRadioChatState({ blocked_words: list })
      .then((s) => {
        setWords(null)
        const n = s.blocked_words?.length ?? list.length
        showAppToast(n ? `${n} blocked word${n === 1 ? '' : 's'} saved` : 'Blocked words cleared', { tone: 'info' })
      })
      .catch((e) => {
        setWords((cur) => (cur ? { ...cur, saving: false } : cur))
        showAppToast(`Couldn’t save the blocked words: ${errorText(e)}`)
      })
  }

  const clearAll = (): void => {
    const before = useRadioChatStore.getState().messages
    useRadioChatStore.setState({ messages: [] })
    setRadioChatState({ clear: true }).catch((e) => {
      useRadioChatStore.setState({ messages: before })
      showAppToast(`Couldn’t clear chat: ${errorText(e)}`)
    })
  }

  const deleteLine = (line: RadioChatMessage): void => {
    dropRadioChatLines([line.id])
    deleteRadioChatMessage(line.id).catch((e) => {
      useRadioChatStore.setState((s) => ({ messages: [...s.messages, line].sort((a, b) => a.id - b.id) }))
      showAppToast(`Couldn’t delete that line: ${errorText(e)}`)
    })
  }

  const ban = (line: RadioChatMessage, minutes: number): void => {
    banRadioChatAuthor(line.id, { minutes })
      .then((b) => showAppToast(`${b.name || line.name} banned ${minutes ? `for ${BAN_LENGTHS.find((l) => l.minutes === minutes)?.label ?? `${minutes} min`}` : 'until lifted'}`, { tone: 'info' }))
      .catch((e) => showAppToast(`Couldn’t ban ${line.name}: ${errorText(e)}`))
  }

  const lineMenu = (line: RadioChatMessage): ContextMenuEntry[] => [
    { label: 'Delete line', icon: Trash2, danger: true, onSelect: () => deleteLine(line) },
    line.role !== 'admin' && {
      label: `Ban ${line.name}`, icon: Ban, danger: true,
      children: BAN_LENGTHS.map((l) => ({ label: l.label, onSelect: () => ban(line, l.minutes) })),
    },
  ]

  const adminItems: ContextMenuEntry[] = [
    enabled
      ? { label: 'Turn off and clear', icon: Power, danger: true, onSelect: () => toggleChat(false, true) }
      : { label: 'Turn on', icon: Power, onSelect: () => toggleChat(true) },
    { label: 'Clear all lines', icon: Eraser, danger: true, onSelect: clearAll },
    {
      label: 'Who can post links', icon: Link2, separatorBefore: true,
      hint: RADIO_CHAT_LINK_MODES.find((m) => m.mode === links)?.label,
      children: RADIO_CHAT_LINK_MODES.map((m) => ({ label: m.label, checked: links === m.mode, onSelect: () => setLinks(m.mode) })),
    },
    { label: 'Blocked words…', icon: ListX, onSelect: openWords },
    {
      label: 'Bans', icon: ShieldOff,
      onOpen: () => { setBans(null); fetchRadioChatBans().then(setBans).catch(() => setBans([])) },
      childrenEmpty: bans === null ? 'Loading…' : 'No one is banned',
      children: (bans ?? []).map((b) => ({
        label: `Lift: ${b.name || `ban #${b.id}`}`,
        hint: b.expires_at ? `Ends ${new Date(b.expires_at).toLocaleString()}` : 'Until lifted',
        onSelect: () => {
          setBans((cur) => cur?.filter((x) => x.id !== b.id) ?? cur)
          liftRadioChatBan(b.id).catch((e) => showAppToast(`Couldn’t lift that ban: ${errorText(e)}`))
        },
      })),
    },
  ]

  const off = enabled === false
  const connecting = status !== 'open' && enabled === null
  const guestBlocked = !signedIn && !guestsEnabled
  // Signed in, wait for the socket to take the ticket, or the first line would go out as a guest.
  const ready = status === 'open' && !authPending

  return (
    <div className="flex-1 min-h-0 flex flex-col px-4 md:px-0 pb-4 md:pb-0">
      {isAdmin && (
        <div className="flex items-center gap-2 pb-3 shrink-0">
          <span className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest ${off ? 'text-white/35' : 'text-green-400/80'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${off ? 'bg-white/30' : 'bg-green-400'}`} />
            {off ? 'Chat off' : guestsEnabled ? 'Chat on' : 'Signed-in only'}
          </span>
          {!off && (
            <button
              onClick={() => toggleGuests(!guestsEnabled)}
              title={guestsEnabled ? 'Stop listeners without an account from chatting, right now' : 'Let listeners without an account chat again'}
              className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${guestsEnabled ? 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/30' : 'bg-green-600/20 text-green-300 hover:bg-green-600/30'}`}
            >
              <UserX size={12} /> {guestsEnabled ? 'Kill guests' : 'Guests on'}
            </button>
          )}
          <button
            onClick={() => toggleChat(off)}
            title={off ? 'Turn chat on for everyone' : 'Turn chat off for everyone, right now'}
            className={`${off ? 'ml-auto ' : ''}flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${off ? 'bg-green-600/20 text-green-300 hover:bg-green-600/30' : 'bg-red-600/20 text-red-300 hover:bg-red-600/35'}`}
          >
            <Power size={12} /> {off ? 'Turn on' : 'Kill chat'}
          </button>
          <button
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAdminMenu({ x: r.right, y: r.bottom }) }}
            title="More chat controls"
            aria-label="More chat controls"
            className="p-1 rounded-lg text-white/35 hover:text-white/75 hover:bg-white/10 transition-colors"
          >
            <MoreHorizontal size={15} />
          </button>
        </div>
      )}

      {isAdmin && words && (
        <form className="shrink-0 pb-3 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); saveWords() }}>
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-white/50">Blocked words</span>
            <span className="text-[11px] text-white/30">One per line. Whole words; * matches any letters.</span>
          </div>
          <textarea
            autoFocus value={words.text} rows={6} disabled={words.loading || words.saving}
            onChange={(e) => setWords({ ...words, text: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Escape') setWords(null) }}
            placeholder={words.loading ? 'Loading…' : 'No blocked words yet'}
            aria-label="Blocked words"
            className="w-full resize-none bg-white/5 text-white/85 text-sm rounded-xl py-2 px-3 border border-white/10 focus:outline-none focus:border-white/25 disabled:opacity-50"
            style={{ colorScheme: 'dark', scrollbarWidth: 'thin' }}
          />
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setWords(null)} className="px-3 py-1 rounded-lg text-xs font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors">Cancel</button>
            <button
              type="submit" disabled={words.loading || words.saving}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-white/15 text-white/90 hover:bg-white/25 disabled:opacity-40 transition-colors"
            >
              {words.saving && <Loader2 size={12} className="animate-spin" />} Save
            </button>
          </div>
        </form>
      )}

      {off ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-1.5 px-6">
          <p className="text-white/70 text-sm font-medium">Chat is off right now</p>
          {reason && <p className="text-white/40 text-xs">{reason}</p>}
        </div>
      ) : (
        <div ref={listRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 pr-1" style={{ scrollbarWidth: 'none' }}>
          {connecting && (
            <p className="m-auto flex items-center gap-2 text-white/30 text-xs"><Loader2 size={12} className="animate-spin" /> Connecting…</p>
          )}
          {!connecting && messages.length === 0 && pending.length === 0 && (
            <p className="m-auto text-white/30 text-xs">No one’s said anything yet. Say hi.</p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className="group relative text-sm leading-snug break-words rounded-lg px-2 py-1 -mx-2 hover:bg-white/5"
              title={relativeTime(m.sent_at)}
              onContextMenu={isAdmin ? (e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, line: m }) } : undefined}
            >
              <span className="font-semibold mr-1.5 inline-flex items-center gap-1 align-baseline" style={{ color: m.verified ? 'rgba(255,255,255,0.92)' : nameColor(m.name) }}>
                {m.name}
                {m.verified && <BadgeCheck size={12} className="text-sky-400 shrink-0" aria-label="Signed in" />}
                {m.role === 'admin' && <span className="text-[9px] font-bold uppercase tracking-wider text-red-300 bg-red-500/20 rounded px-1 py-px">Admin</span>}
                {m.role === 'mod' && <span className="text-[9px] font-bold uppercase tracking-wider text-amber-300 bg-amber-500/20 rounded px-1 py-px">Mod</span>}
              </span>
              <MessageText text={m.text} matchSongs={matchSongs} />
              {isAdmin && (
                <button
                  onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right, y: r.bottom, line: m }) }}
                  aria-label="Moderate this line"
                  className="absolute right-1 top-1 p-0.5 rounded text-white/40 hover:text-white/80 bg-black/40 opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
                >
                  <MoreHorizontal size={13} />
                </button>
              )}
            </div>
          ))}
          {pending.map((p) => <PendingLine key={p.nonce} line={p} matchSongs={matchSongs} />)}
        </div>
      )}

      {!off && guestBlocked && (
        <div className="shrink-0 pt-3 flex items-center gap-3">
          <p className="flex-1 text-white/45 text-xs">Only signed-in listeners can chat right now.</p>
          <button
            onClick={() => setShowUserAuth(true)}
            className="px-3 py-1.5 rounded-xl bg-white/10 text-white/85 text-xs font-medium hover:bg-white/20 transition-colors"
          >
            Log in
          </button>
        </div>
      )}

      {!off && !guestBlocked && (
        <div className="shrink-0 pt-3 flex flex-col gap-1.5">
          {/* A guest's name; an account's lines carry its username, so it has nothing to set here. */}
          {!signedIn && (
          <div className="flex items-center gap-1.5 text-[11px] text-white/35 min-h-[18px]">
            {editingName ? (
              <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); saveName() }}>
                <input
                  autoFocus value={nameDraft} maxLength={RADIO_CHAT_MAX_NAME}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setNameDraft(name); setEditingName(false) } }}
                  placeholder="Your name"
                  className="w-36 bg-white/5 text-white/80 text-xs max-md:text-[16px] rounded-md px-2 py-0.5 border border-white/15 focus:outline-none focus:border-white/30"
                  style={{ colorScheme: 'dark' }}
                />
                <button type="submit" className="text-white/60 hover:text-white">Save</button>
              </form>
            ) : (
              <button onClick={() => { setNameDraft(name); setEditingName(true) }} className="inline-flex items-center gap-1 hover:text-white/70 transition-colors">
                Chatting as <span className="text-white/70 font-medium">{name || 'a guest'}</span><Pencil size={10} />
                <span className="text-white/25 ml-1">· sign in for a verified name</span>
              </button>
            )}
          </div>
          )}
          <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); send() }}>
            <input
              ref={inputRef}
              value={draft} maxLength={RADIO_CHAT_MAX_TEXT}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={ready ? 'Say something…' : 'Connecting…'}
              aria-label="Chat message"
              className="flex-1 min-w-0 bg-white/5 text-white/85 text-sm max-md:text-[16px] rounded-xl py-2 px-3 border border-white/10 focus:outline-none focus:border-white/25 transition-colors"
              style={{ colorScheme: 'dark' }}
            />
            <button
              type="button"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setEmojiAt({ x: r.right - 296, y: r.top - 380 })
              }}
              aria-label="Emoji"
              title="Emoji"
              className="p-2 rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            >
              <SmilePlus size={15} />
            </button>
            <button
              type="submit" disabled={!draft.trim() || !ready}
              aria-label="Send"
              className="p-2 rounded-xl bg-white/10 text-white/80 hover:bg-white/20 disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <Send size={15} />
            </button>
          </form>
          {emojiAt && <ReactionPicker {...emojiAt} forMessage onPick={insertEmoji} onClose={() => setEmojiAt(null)} />}
        </div>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} title={menu.line.name} subtitle={menu.line.text.slice(0, 60)} items={lineMenu(menu.line)} />
      )}
      {adminMenu && (
        <ContextMenu x={adminMenu.x} y={adminMenu.y} onClose={() => setAdminMenu(null)} title="999 FM chat" items={adminItems} />
      )}
    </div>
  )
}

function PendingLine({ line, matchSongs }: { line: RadioChatPending; matchSongs: MatchSongs }): JSX.Element {
  return (
    <div className={`text-sm leading-snug break-words px-2 py-1 -mx-2 ${line.error ? '' : 'opacity-50'}`}>
      <span className="font-semibold mr-1.5 text-white/70">{line.name}</span>
      <MessageText text={line.text} matchSongs={matchSongs} />
      {line.error && (
        <span className="flex items-center gap-1.5 text-xs text-red-400/85 mt-0.5">
          {line.error}
          <button onClick={() => dismissRadioChatPending(line.nonce)} aria-label="Dismiss" className="text-red-400/60 hover:text-red-300"><X size={11} /></button>
        </span>
      )}
    </div>
  )
}
