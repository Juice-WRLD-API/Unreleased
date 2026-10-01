import { memo, useMemo } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { KeyRound, ShieldAlert } from 'lucide-react'
import type { ChatUserBrief } from '../../lib/chatApi'
import { splitForwardRef } from '../../lib/chatForwardRef'
import { splitReplyRef } from '../../lib/chatReplyRef'
import { decodeCommandCard, decodeLocalNotice, decodeNewsShare, decodePlaylistShare, decodeSongInfoShare, decodeSongShare, decodeThemeShare } from '../../lib/chatShare'
import type { SharedCommandCard } from '../../lib/chatShare'
import { useChatStore, useModerationNotice, type RoomRef, type UiMessage } from '../../store/chatStore'
import { useStore } from '../../store/useStore'
import { EMOJI_IMG } from './emoji'
import rehypeChatEmoji from './emojiRehype'
import BroadcastHistoryCard from './BroadcastHistoryCard'
import ChangelogCard from './ChangelogCard'
import FeedbackSentCard from './FeedbackSentCard'
import HelpCard from './HelpCard'
import { linkMentions } from './people'
import { useOpenUserCard } from './UserCard'
import NewsShareCard from './NewsShareCard'
import NowPlayingHistoryCard from './NowPlayingHistoryCard'
import PlaylistShareCard from './PlaylistShareCard'
import SongInfoCard from './SongInfoCard'
import SongShareCard from './SongShareCard'
import ModerationCard from './ModerationCard'
import ThemeListCard from './ThemeListCard'
import ThemeShareCard from './ThemeShareCard'

function urlTransform(url: string): string {
  return url.startsWith('mention:') ? url : defaultUrlTransform(url)
}

function MarkdownText({ text, people, meId }: { text: string; people: ChatUserBrief[]; meId: number | null }): JSX.Element {
  const openPublicProfile = useStore((s) => s.openPublicProfile)
  const openUserCard = useOpenUserCard()
  const components = useMemo<Components>(() => ({
    a: ({ href, children }) => {
      if (href === 'mention:everyone') {
        return <span className="inline-block rounded-md px-1 font-semibold bg-amber-400/20 text-amber-300">{children}</span>
      }
      if (href?.startsWith('mention:')) {
        const userId = Number(href.slice(8))
        const self = userId === meId
        const mentioned = people.find((p) => p.id === userId)
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              if (mentioned) openUserCard(mentioned, e)
              else openPublicProfile(userId)
            }}
            className={`inline-block rounded-md px-1 font-semibold hover:underline ${self ? 'bg-amber-400/20 text-amber-300' : 'bg-accent/15 text-accent'}`}
          >
            {children}
          </button>
        )
      }
      return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    },
    img: ({ src, alt, title, ...rest }) => {
      const emojiName = (rest as Record<string, unknown>)['data-emoji']
      if (typeof emojiName === 'string') {
        // rehypeChatEmoji sets src from this same table, but it has to survive
        // react-markdown's urlTransform to get here - which blanked it outright
        // back when Vite inlined these PNGs as data: URLs. Re-resolving from
        // the data-emoji name keeps the image right regardless of how the
        // asset is emitted.
        return <img src={EMOJI_IMG[emojiName]} alt={alt} title={title} draggable={false} className="inline-block h-[1.5em] w-[1.5em] align-[-0.3em] object-contain" />
      }
      return <a href={typeof src === 'string' ? src : undefined} target="_blank" rel="noopener noreferrer">{alt || src}</a>
    },
  }), [meId, openPublicProfile, openUserCard, people])
  const source = useMemo(() => linkMentions(text, people), [text, people])
  return (
    <div className="chat-md select-text text-[0.9rem] leading-relaxed text-text-primary break-words [overflow-wrap:anywhere]">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeChatEmoji]} components={components} urlTransform={urlTransform}>
        {source}
      </ReactMarkdown>
    </div>
  )
}

const MemoMarkdown = memo(MarkdownText)

// One renderer for a command's card whether it's the private local notice
// (room + messageId given, so it can be dismissed) or the same card posted to
// the chat with `-s` (neither given).
function CommandCard({ card, room, messageId }: { card: SharedCommandCard; room?: RoomRef; messageId?: number }): JSX.Element | null {
  switch (card.kind) {
    case 'help': return <HelpCard room={room} messageId={messageId} />
    case 'themeList': return <ThemeListCard room={room} messageId={messageId} />
    case 'broadcastHistory': return <BroadcastHistoryCard room={room} messageId={messageId} items={card.items} total={card.total} />
    case 'changelog': return <ChangelogCard room={room} messageId={messageId} status={card.status} />
    case 'npHistory': return <NowPlayingHistoryCard room={room} messageId={messageId} items={card.items} total={card.total} capped={card.capped} />
    default: return null
  }
}

export default function MessageBody({ message, people, room }: { message: UiMessage; people: ChatUserBrief[]; room?: RoomRef }): JSX.Element | null {
  const meId = useChatStore((s) => s.meId)
  const decrypted = useChatStore((s) => (message.is_encrypted ? s.plain[message.id] : undefined))
  // Null unless the poster actually had the permission for the action it
  // claims - a copied payload falls through and renders as the plain text it is.
  const moderation = useModerationNotice(message)

  if (message.deleted_at) {
    return <p className="text-sm italic text-text-muted">This message was deleted.</p>
  }

  if (message.local && room) {
    const notice = decodeLocalNotice(message.content)
    if (notice?.kind === 'feedbackSent') return <FeedbackSentCard room={room} messageId={message.id} message={notice.message} />
    return notice ? <CommandCard card={notice} room={room} messageId={message.id} /> : null
  }

  if (!message.is_encrypted) {
    const afterReply = splitReplyRef(message.content).body
    const body = splitForwardRef(afterReply).body
    if (!body) return null
    const song = decodeSongShare(body)
    if (song) return <SongShareCard song={song} />
    const playlist = decodePlaylistShare(body)
    if (playlist) return <PlaylistShareCard playlist={playlist} />
    const news = decodeNewsShare(body)
    if (news) return <NewsShareCard news={news} />
    const info = decodeSongInfoShare(body)
    if (info) return <SongInfoCard info={info} />
    const theme = decodeThemeShare(body)
    if (theme) return <ThemeShareCard theme={theme} />
    const command = decodeCommandCard(body)
    if (command) return <CommandCard card={command} />
    return moderation ? <ModerationCard notice={moderation} /> : <MemoMarkdown text={body} people={people} meId={meId} />
  }

  if (!message.ciphertext && message.id > 0 && !decrypted) return null
  if (!decrypted) {
    return (
      <div className="flex items-center gap-2 py-0.5">
        <span className="h-3 w-40 max-w-full rounded bg-surface-raised animate-pulse" />
      </div>
    )
  }
  if ('error' in decrypted) {
    return (
      <p className="inline-flex items-center gap-1.5 text-sm text-text-muted italic">
        {decrypted.error === 'missing-key' ? <KeyRound size={13} /> : <ShieldAlert size={13} />}
        {decrypted.error === 'missing-key' ? 'Waiting for the key to decrypt this message' : 'Unable to decrypt this message'}
      </p>
    )
  }
  const content = decryptedContent(decrypted.text, people, meId)
  if (!decrypted.unverified) return content
  return <>{content}<UnverifiedBadge /></>
}

// A v2 message whose sender signature, sender device or attachment list
// didn't check out. Shown rather than hidden, so nothing silently vanishes.
function UnverifiedBadge(): JSX.Element {
  return (
    <p
      className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400"
      title="The sender's signature on this message could not be verified. It may not be from the device it claims."
    >
      <ShieldAlert size={10} />Couldn&apos;t verify sender
    </p>
  )
}

function decryptedContent(text: string, people: ChatUserBrief[], meId: number | null): JSX.Element | null {
  if (!text) return null
  const decryptedAfterReply = splitReplyRef(text).body
  const decryptedBody = splitForwardRef(decryptedAfterReply).body
  if (!decryptedBody) return null
  const decryptedSong = decodeSongShare(decryptedBody)
  if (decryptedSong) return <SongShareCard song={decryptedSong} />
  const decryptedPlaylist = decodePlaylistShare(decryptedBody)
  if (decryptedPlaylist) return <PlaylistShareCard playlist={decryptedPlaylist} />
  const decryptedNews = decodeNewsShare(decryptedBody)
  if (decryptedNews) return <NewsShareCard news={decryptedNews} />
  const decryptedInfo = decodeSongInfoShare(decryptedBody)
  if (decryptedInfo) return <SongInfoCard info={decryptedInfo} />
  const decryptedTheme = decodeThemeShare(decryptedBody)
  if (decryptedTheme) return <ThemeShareCard theme={decryptedTheme} />
  const decryptedCommand = decodeCommandCard(decryptedBody)
  if (decryptedCommand) return <CommandCard card={decryptedCommand} />
  return <MemoMarkdown text={decryptedBody} people={people} meId={meId} />
}
