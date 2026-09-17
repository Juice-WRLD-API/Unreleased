import { memo, useMemo } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { KeyRound, ShieldAlert } from 'lucide-react'
import type { ChatUserBrief } from '../../lib/chatApi'
import { splitReplyRef } from '../../lib/chatReplyRef'
import { decodeSongShare } from '../../lib/chatShare'
import { useChatStore, type UiMessage } from '../../store/chatStore'
import { useStore } from '../../store/useStore'
import rehypeChatEmoji from './emojiRehype'
import { linkMentions } from './people'
import SongShareCard from './SongShareCard'

function urlTransform(url: string): string {
  return url.startsWith('mention:') ? url : defaultUrlTransform(url)
}

function MarkdownText({ text, people, meId }: { text: string; people: ChatUserBrief[]; meId: number | null }): JSX.Element {
  const openPublicProfile = useStore((s) => s.openPublicProfile)
  const components = useMemo<Components>(() => ({
    a: ({ href, children }) => {
      if (href?.startsWith('mention:')) {
        const userId = Number(href.slice(8))
        const self = userId === meId
        return (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); openPublicProfile(userId) }}
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
        return <img src={typeof src === 'string' ? src : undefined} alt={alt} title={title} draggable={false} className="inline-block h-[1.2em] w-[1.2em] align-[-0.2em] object-contain" />
      }
      return <a href={typeof src === 'string' ? src : undefined} target="_blank" rel="noopener noreferrer">{alt || src}</a>
    },
  }), [meId, openPublicProfile])
  const source = useMemo(() => linkMentions(text, people), [text, people])
  return (
    <div className="chat-md text-[0.9rem] leading-relaxed text-text-primary break-words [overflow-wrap:anywhere]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeChatEmoji]} components={components} urlTransform={urlTransform}>
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
    const body = splitReplyRef(message.content).body
    if (!body) return null
    const song = decodeSongShare(body)
    return song ? <SongShareCard song={song} /> : <MemoMarkdown text={body} people={people} meId={meId} />
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
  const decryptedBody = splitReplyRef(decrypted.text).body
  if (!decryptedBody) return null
  const decryptedSong = decodeSongShare(decryptedBody)
  return decryptedSong ? <SongShareCard song={decryptedSong} /> : <MemoMarkdown text={decryptedBody} people={people} meId={meId} />
}
