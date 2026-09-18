import { memo, useMemo } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { KeyRound, ShieldAlert } from 'lucide-react'
import type { ChatUserBrief } from '../../lib/chatApi'
import { splitForwardRef } from '../../lib/chatForwardRef'
import { splitReplyRef } from '../../lib/chatReplyRef'
import { decodeNewsShare, decodePlaylistShare, decodeSongInfoShare, decodeSongShare } from '../../lib/chatShare'
import { useChatStore, type UiMessage } from '../../store/chatStore'
import { useStore } from '../../store/useStore'
import rehypeChatEmoji from './emojiRehype'
import { linkMentions } from './people'
import { useOpenUserCard } from './UserCard'
import NewsShareCard from './NewsShareCard'
import PlaylistShareCard from './PlaylistShareCard'
import SongInfoCard from './SongInfoCard'
import SongShareCard from './SongShareCard'

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
        return <img src={typeof src === 'string' ? src : undefined} alt={alt} title={title} draggable={false} className="inline-block h-[1.5em] w-[1.5em] align-[-0.3em] object-contain" />
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

export default function MessageBody({ message, people }: { message: UiMessage; people: ChatUserBrief[] }): JSX.Element | null {
  const meId = useChatStore((s) => s.meId)
  const decrypted = useChatStore((s) => (message.is_encrypted ? s.plain[message.id] : undefined))

  if (message.deleted_at) {
    return <p className="text-sm italic text-text-muted">This message was deleted.</p>
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
    return info ? <SongInfoCard info={info} /> : <MemoMarkdown text={body} people={people} meId={meId} />
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
  if (!decrypted.text) return null
  const decryptedAfterReply = splitReplyRef(decrypted.text).body
  const decryptedBody = splitForwardRef(decryptedAfterReply).body
  if (!decryptedBody) return null
  const decryptedSong = decodeSongShare(decryptedBody)
  if (decryptedSong) return <SongShareCard song={decryptedSong} />
  const decryptedPlaylist = decodePlaylistShare(decryptedBody)
  if (decryptedPlaylist) return <PlaylistShareCard playlist={decryptedPlaylist} />
  const decryptedNews = decodeNewsShare(decryptedBody)
  if (decryptedNews) return <NewsShareCard news={decryptedNews} />
  const decryptedInfo = decodeSongInfoShare(decryptedBody)
  return decryptedInfo ? <SongInfoCard info={decryptedInfo} /> : <MemoMarkdown text={decryptedBody} people={people} meId={meId} />
}
