import { useEffect, useState, useCallback, useRef } from 'react'
import { useIsMobile } from '../hooks/useIsMobile'
import {
  ChevronLeft, Newspaper, RefreshCw, AlertCircle, Plus, Settings2,
  Pencil, Trash2, Star, Paperclip, Download, Bell, BellOff, ArrowDownWideNarrow, ArrowUpWideNarrow,
  Share2,
} from 'lucide-react'
import { useStorePick } from '../store/useStore'
import {
  fetchNews, peekNews, fetchChannels, fetchNewsItem, deleteNewsItem, isImageAttachment, isAudioAttachment,
  buildNewsAttachmentStreamUrl, ensureHttpsMediaUrl,
  ALL_CHANNEL, DEFAULT_NEWS_CHANNEL, NEWS_CHANNELS,
  type NewsItem, type NewsChannel, type NewsAttachment, type NewsSort,
} from '../lib/newsApi'
import { isSubscribed, setSubscribed, ensureNotifyPermission } from '../lib/newsNotifications'
import { hasChatAccess } from '../store/chatStore'
import NewsComposeModal from './NewsComposeModal'
import NewsChannelsModal from './NewsChannelsModal'
import ShareNewsModal from './chat/ShareNewsModal'
import ChangesFeedPanel from './ChangesFeedPanel'
import Markdown from './Markdown'

type NewsMode = 'news' | 'feed'

// Post URLs are /news/<id> so an open article can be shared/refreshed/bookmarked.
function postIdFromPath(pathname: string): number | null {
  const m = pathname.match(/^\/news\/(\d+)$/)
  return m ? Number(m[1]) : null
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// Crude markdown -> plain text for the summary fallback below: strips the
// syntax that would otherwise show up as literal symbols (headings,
// emphasis, links, code, bullets) and collapses all whitespace to single
// spaces so it reads as one flowing blurb regardless of the source's line
// breaks.
function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~`-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Falls back to a snippet of the body when no summary was written - the
// composer no longer requires one.
function displaySummary(item: NewsItem): string {
  const trimmed = item.summary?.trim()
  return trimmed || stripMarkdown(item.body || '')
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ─── Cards ────────────────────────────────────────────────────────────────────

function CategoryTag({ label }: { label: string }) {
  return (
    <span className="inline-block text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/25">
      {label}
    </span>
  )
}

// Edit/delete cluster, shown on hover for editors on desktop; always visible on
// mobile since touch has no hover state. Rendered as a sibling of the card's
// clickable button (never nested - a button can't contain buttons).
function ManageActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const isMobile = useIsMobile()
  return (
    <div className={`absolute top-2 right-2 flex items-center gap-1 transition-opacity ${isMobile ? '' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
      <button onClick={onEdit} title="Edit" aria-label="Edit post" className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"><Pencil size={13} /></button>
      <button onClick={onDelete} title="Delete" aria-label="Delete post" className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-red-600 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"><Trash2 size={13} /></button>
    </div>
  )
}

interface CardProps {
  item: NewsItem
  onOpen: (item: NewsItem) => void
  canManage: boolean
  onEdit: (item: NewsItem) => void
  onDelete: (item: NewsItem) => void
}

function FeaturedCard({ item, onOpen, canManage, onEdit, onDelete }: CardProps) {
  return (
    <div className="relative group">
      <button
        onClick={() => onOpen(item)}
        className="w-full text-left rounded-2xl overflow-hidden border border-[var(--border)] bg-[var(--surface-raised)] hover:border-accent/40 hover:shadow-lg hover:shadow-black/5 transition-all duration-200 block cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        {item.image_url ? (
          <div className="relative aspect-[16/7] w-full overflow-hidden bg-[var(--surface-overlay)]">
            <img
              src={ensureHttpsMediaUrl(item.image_url) ?? undefined}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-5">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-white drop-shadow"><Star size={11} className="fill-current text-accent" /> Featured</span>
                {item.category && <CategoryTag label={item.category} />}
                <span className="text-xs text-white/80 drop-shadow">{formatDate(item.published_at)}</span>
              </div>
              <h2 className="text-white text-xl font-bold leading-snug mb-1.5 drop-shadow-sm">{item.title}</h2>
              <p className="text-sm text-white/85 leading-relaxed line-clamp-2 drop-shadow-sm">{displaySummary(item)}</p>
            </div>
          </div>
        ) : (
          <div className="p-5">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-accent"><Star size={11} className="fill-current" /> Featured</span>
              {item.category && <CategoryTag label={item.category} />}
              <span className="text-xs text-text-muted">{formatDate(item.published_at)}</span>
            </div>
            <h2 className="text-text-primary text-lg font-bold leading-snug mb-1.5">{item.title}</h2>
            <p className="text-sm text-text-secondary leading-relaxed line-clamp-3">{displaySummary(item)}</p>
          </div>
        )}
      </button>
      {canManage && <ManageActions onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} />}
    </div>
  )
}

function NewsCard({ item, onOpen, canManage, onEdit, onDelete }: CardProps) {
  return (
    <div className="relative group h-full">
      <button
        onClick={() => onOpen(item)}
        className="w-full h-full text-left flex flex-col rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--surface-raised)] hover:border-accent/40 hover:shadow-lg hover:shadow-black/5 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        {item.image_url && (
          <div className="w-full aspect-[16/9] shrink-0 overflow-hidden bg-[var(--surface-overlay)]">
            <img
              src={ensureHttpsMediaUrl(item.image_url) ?? undefined}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
            />
          </div>
        )}
        <div className="min-w-0 flex-1 p-3.5 pr-12">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            {item.category && <CategoryTag label={item.category} />}
            <span className="text-xs text-text-muted">{formatDate(item.published_at)}</span>
            {item.attachments.length > 0 && (
              <span className="inline-flex items-center gap-0.5 text-xs text-text-muted"><Paperclip size={11} />{item.attachments.length}</span>
            )}
          </div>
          <h3 className="text-text-primary text-sm font-semibold leading-snug mb-1 line-clamp-2">{item.title}</h3>
          <p className="text-xs text-text-secondary leading-relaxed line-clamp-2">{displaySummary(item)}</p>
        </div>
      </button>
      {canManage && <ManageActions onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} />}
    </div>
  )
}

// ─── States ───────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--surface-raised)] animate-pulse">
      <div className="w-full aspect-[16/9] bg-[var(--surface-overlay)]" />
      <div className="space-y-2 p-3.5">
        <div className="h-3 w-20 rounded bg-[var(--surface-overlay)]" />
        <div className="h-4 w-3/4 rounded bg-[var(--surface-overlay)]" />
        <div className="h-3 w-full rounded bg-[var(--surface-overlay)]" />
        <div className="h-3 w-2/3 rounded bg-[var(--surface-overlay)]" />
      </div>
    </div>
  )
}

function EmptyState({ canManage, onCompose }: { canManage: boolean; onCompose: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-24 px-6">
      <div className="w-16 h-16 rounded-2xl bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center mb-4">
        <Newspaper size={28} className="text-text-muted" />
      </div>
      <h2 className="text-text-primary font-semibold mb-1">No news here yet</h2>
      <p className="text-sm text-text-muted max-w-sm">
        Announcements, releases and leaks will show up here. Check back soon.
      </p>
      {canManage && (
        <button
          onClick={onCompose}
          className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:opacity-90 transition-opacity cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <Plus size={15} /> Write the first post
        </button>
      )}
    </div>
  )
}

// ─── Attachments ──────────────────────────────────────────────────────────────

function AudioAttachment({ attachment }: { attachment: NewsAttachment }) {
  const [broken, setBroken] = useState(false)
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Paperclip size={15} className="text-text-muted shrink-0" />
        <span className="text-sm text-text-primary truncate flex-1">{attachment.name}</span>
        <span className="text-xs text-text-muted shrink-0">{humanSize(attachment.size)}</span>
        <a
          href={buildNewsAttachmentStreamUrl(attachment, true)}
          download={attachment.name}
          className="text-text-muted hover:text-accent transition-colors shrink-0"
          aria-label={`Download ${attachment.name}`}
        >
          <Download size={15} />
        </a>
      </div>
      <div className="px-3 pb-3">
        {broken ? (
          <div className="h-9 rounded-md bg-surface-overlay flex items-center justify-center text-[11px] text-text-muted">
            Preview unavailable
          </div>
        ) : (
          <audio
            controls
            src={buildNewsAttachmentStreamUrl(attachment)}
            preload="metadata"
            onError={() => setBroken(true)}
            className="w-full h-9"
          />
        )}
      </div>
    </div>
  )
}

function AttachmentList({ attachments }: { attachments: NewsAttachment[] }) {
  const images = attachments.filter(isImageAttachment)
  const audio = attachments.filter((a) => !isImageAttachment(a) && isAudioAttachment(a))
  const files = attachments.filter((a) => !isImageAttachment(a) && !isAudioAttachment(a))
  return (
    <div className="mt-6 space-y-4">
      {images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {images.map((a, i) => (
            <a key={i} href={ensureHttpsMediaUrl(a.url) ?? a.url} target="_blank" rel="noopener noreferrer" className="block rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--surface-overlay)] hover:border-accent/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
              <img src={ensureHttpsMediaUrl(a.url) ?? undefined} alt={a.name} loading="lazy" className="w-full aspect-square object-cover" />
            </a>
          ))}
        </div>
      )}
      {audio.length > 0 && (
        <div className="space-y-2">
          {audio.map((a, i) => (
            <AudioAttachment key={i} attachment={a} />
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="space-y-1.5">
          {files.map((a, i) => (
            <a
              key={i}
              href={buildNewsAttachmentStreamUrl(a, true)}
              download={a.name}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 hover:border-accent/40 transition-colors group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <Paperclip size={15} className="text-text-muted shrink-0" />
              <span className="text-sm text-text-primary truncate flex-1">{a.name}</span>
              <span className="text-xs text-text-muted shrink-0">{humanSize(a.size)}</span>
              <Download size={15} className="text-text-muted group-hover:text-accent transition-colors shrink-0" />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Article detail ───────────────────────────────────────────────────────────

function ArticleDetail({ item, channelLabel, onBack, canManage, onEdit, onDelete, canShareToChat, onShare }: {
  item: NewsItem
  channelLabel: string | null
  onBack: () => void
  canManage: boolean
  onEdit: (item: NewsItem) => void
  onDelete: (item: NewsItem) => void
  canShareToChat: boolean
  onShare: (item: NewsItem) => void
}) {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-primary transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-lg"
        >
          <ChevronLeft size={16} /> Back to news
        </button>
        <div className="ml-auto flex items-center gap-1">
          {canShareToChat && (
            <button onClick={() => onShare(item)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"><Share2 size={13} /> Share to chat</button>
          )}
          {canManage && (
            <>
              <button onClick={() => onEdit(item)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"><Pencil size={13} /> Edit</button>
              <button onClick={() => onDelete(item)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:text-red-400 hover:bg-surface-raised transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"><Trash2 size={13} /> Delete</button>
            </>
          )}
        </div>
      </div>
      {item.image_url && (
        <div className="aspect-[16/7] w-full overflow-hidden rounded-2xl bg-[var(--surface-overlay)] mb-5">
          <img src={ensureHttpsMediaUrl(item.image_url) ?? undefined} alt="" className="w-full h-full object-cover" />
        </div>
      )}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {item.featured && <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-accent"><Star size={11} className="fill-current" /> Featured</span>}
        {channelLabel && <CategoryTag label={channelLabel} />}
        {item.category && <span className="text-xs text-text-muted">{item.category}</span>}
        <span className="text-xs text-text-muted">{formatDate(item.published_at)}</span>
        {item.author && <span className="text-xs text-text-muted">· {item.author}</span>}
      </div>
      <h1 className="text-text-primary text-2xl font-bold leading-tight mb-4">{item.title}</h1>
      <Markdown>{item.body}</Markdown>
      {item.attachments.length > 0 && <AttachmentList attachments={item.attachments} />}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NewsView(): JSX.Element {
  const { setActiveView, account } = useStorePick('setActiveView', 'account')
  // News write access is its own role (is_news), separate from is_editor -
  // admins can post regardless. Only admins manage channels.
  const canPost = !!(account?.is_news || account?.is_administrator)
  const canManageChannels = !!account?.is_administrator
  // Who can edit/delete a given post: admins can touch anything; is_news
  // holders only their own. Matches the backend's authorization, so the
  // buttons don't offer an action the API would reject.
  const canManageItem = (item: NewsItem): boolean =>
    !!account && (account.is_administrator || (!!account.is_news && item.author_id != null && item.author_id === account.id))
  const canShareToChat = hasChatAccess(account)

  const [mode, setMode] = useState<NewsMode>('news')
  const [channel, setChannel] = useState<string>(DEFAULT_NEWS_CHANNEL)
  const [sort, setSort] = useState<NewsSort>('newest')
  const [channels, setChannels] = useState<NewsChannel[]>(NEWS_CHANNELS)
  const [items, setItems] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<NewsItem | null>(null)

  // Whether the user follows the active channel (drives the bell toggle). "All"
  // isn't subscribable - you follow specific channels.
  const [subscribed, setSubscribedState] = useState(false)

  // Modals
  const [composeOpen, setComposeOpen] = useState(false)
  const [editing, setEditing] = useState<NewsItem | null>(null)
  const [channelsOpen, setChannelsOpen] = useState(false)
  const [sharing, setSharing] = useState<NewsItem | null>(null)

  const loadChannels = useCallback(async () => {
    try {
      const list = await fetchChannels()
      setChannels(list)
    } catch {
      // Keep whatever we have (the static fallback) - a channels fetch failure
      // shouldn't blank out the tab bar.
    }
  }, [])

  const load = useCallback(async () => {
    // Stale-while-revalidate: show the last cached page for this exact
    // channel+sort instantly (no spinner flash on every channel switch),
    // then let the network response below replace it once it lands.
    const cached = peekNews({ channel, sort })
    if (cached) {
      setItems(cached.results)
      setLoading(false)
    } else {
      setLoading(true)
    }
    setError(null)
    try {
      const res = await fetchNews({ channel, sort })
      setItems(res.results)
    } catch (err) {
      if (!cached) setError(err instanceof Error ? err.message : 'Failed to load news')
    } finally {
      setLoading(false)
    }
  }, [channel, sort])

  useEffect(() => { loadChannels() }, [loadChannels])

  // Reload whenever the channel changes (and on mount). Close any open article
  // so we don't strand the reader on a story from the previous channel - but
  // not on the very first run, which needs to leave a URL-deep-linked post
  // (see the effect below) alone.
  const didMount = useRef(false)
  useEffect(() => {
    if (didMount.current) closeArticle()
    else didMount.current = true
    load()
  }, [load])

  // Reflect the follow state of whatever channel is active.
  useEffect(() => { setSubscribedState(channel !== ALL_CHANNEL && isSubscribed(channel)) }, [channel])

  // Open a specific post when a notification is clicked (NewsNotifier routes
  // here then dispatches the id). Also honor an id left in sessionStorage if the
  // view mounts after the event fired, or one baked into the URL (deep link /
  // page refresh / shared /news/<id> link).
  useEffect(() => {
    const openById = (id: number): void => {
      fetchNewsItem(id).then((it) => {
        setSelected(it)
        if (postIdFromPath(window.location.pathname) !== it.id) {
          window.history.pushState({}, '', `/news/${it.id}`)
        }
      }).catch(() => undefined)
    }
    const onOpen = (e: Event): void => {
      const id = (e as CustomEvent<number>).detail
      // Already-mounted path: consume the id so a later remount doesn't reopen it.
      try { sessionStorage.removeItem('news:openPostId') } catch {}
      if (typeof id === 'number') openById(id)
    }
    window.addEventListener('news:open', onOpen)
    try {
      const pending = sessionStorage.getItem('news:openPostId')
      if (pending) { sessionStorage.removeItem('news:openPostId'); openById(Number(pending)) }
      else {
        const fromUrl = postIdFromPath(window.location.pathname)
        if (fromUrl != null) openById(fromUrl)
      }
    } catch {}
    return () => window.removeEventListener('news:open', onOpen)
  }, [])

  // Keep the URL and the open article in sync with browser back/forward.
  useEffect(() => {
    const onPopState = (): void => {
      const id = postIdFromPath(window.location.pathname)
      if (id == null) { setSelected(null); return }
      fetchNewsItem(id).then(setSelected).catch(() => undefined)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // Push/pop /news/<id> as an article opens and closes, so the URL always
  // reflects what's on screen and a post can be shared or reloaded directly.
  const openItem = (item: NewsItem): void => {
    setSelected(item)
    if (postIdFromPath(window.location.pathname) !== item.id) {
      window.history.pushState({}, '', `/news/${item.id}`)
    }
  }
  const closeArticle = (): void => {
    setSelected(null)
    if (postIdFromPath(window.location.pathname) != null) {
      window.history.pushState({}, '', '/news')
    }
  }

  const toggleSubscribe = async (): Promise<void> => {
    if (channel === ALL_CHANNEL) return
    const next = !subscribed
    if (next) await ensureNotifyPermission() // ask on the first follow; harmless if already granted/denied
    setSubscribed(channel, next)
    setSubscribedState(next)
  }

  const channelLabel = (id: string): string | null => channels.find((c) => c.id === id)?.label ?? null

  const openEdit = (item: NewsItem): void => { setEditing(item); setComposeOpen(true) }
  const openNew = (): void => { setEditing(null); setComposeOpen(true) }

  const handleDelete = async (item: NewsItem): Promise<void> => {
    if (!window.confirm(`Delete “${item.title}”? This can't be undone.`)) return
    try {
      await deleteNewsItem(item.id)
      setItems((prev) => prev.filter((i) => i.id !== item.id))
      if (selected?.id === item.id) closeArticle()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  const handleSaved = (saved: NewsItem): void => {
    setComposeOpen(false)
    setEditing(null)
    // Merge the saved item in place (edit) or drop it on top (new). A full
    // reload also picks up server-side fields (author, hosted attachment urls).
    setSelected((s) => (s?.id === saved.id ? saved : s))
    load()
  }

  const featured = items.find((i) => i.featured) ?? null
  const rest = items.filter((i) => i !== featured)

  const tabs: NewsChannel[] = [{ id: ALL_CHANNEL, label: 'All' }, ...channels]

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--surface)]">
      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-6 pb-0 border-b border-[var(--border)]">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => setActiveView('wrld')}
            title="Back"
            aria-label="Back"
            className="p-1 -ml-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <ChevronLeft size={18} />
          </button>
          <h1 className="text-text-primary text-xl font-bold">News</h1>
          {mode === 'news' && (
          <div className="ml-auto flex items-center gap-1">
            {channel !== ALL_CHANNEL && (
              <button
                onClick={toggleSubscribe}
                title={subscribed ? `Following - notify me of new ${channelLabel(channel) ?? ''} posts` : 'Follow for notifications'}
                aria-label={subscribed ? 'Unfollow channel' : 'Follow channel for notifications'}
                aria-pressed={subscribed}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${subscribed ? 'text-accent hover:bg-surface-overlay' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'}`}
              >
                {subscribed ? <Bell size={16} /> : <BellOff size={16} />}
              </button>
            )}
            {canManageChannels && (
              <button
                onClick={() => setChannelsOpen(true)}
                title="Manage channels"
                aria-label="Manage channels"
                className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <Settings2 size={16} />
              </button>
            )}
            <button
              onClick={() => setSort((s) => (s === 'newest' ? 'oldest' : 'newest'))}
              title={sort === 'newest' ? 'Newest first - switch to oldest' : 'Oldest first - switch to newest'}
              aria-label={sort === 'newest' ? 'Sort: newest first, switch to oldest' : 'Sort: oldest first, switch to newest'}
              className="flex items-center gap-1 p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              {sort === 'newest' ? <ArrowDownWideNarrow size={15} /> : <ArrowUpWideNarrow size={15} />}
              <span className="text-xs hidden sm:inline">{sort === 'newest' ? 'Newest' : 'Oldest'}</span>
            </button>
            <button
              onClick={load}
              disabled={loading}
              title="Refresh"
              aria-label="Refresh news"
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
            {canPost && (
              <button
                onClick={openNew}
                className="ml-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-accent text-white hover:opacity-90 transition-opacity cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <Plus size={15} /> New post
              </button>
            )}
          </div>
          )}
        </div>
        {/* Primary tabs */}
        <div className="flex gap-1 mb-1">
          {(['news', 'feed'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`px-3 py-1.5 text-sm font-semibold rounded-lg border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                mode === m
                  ? 'bg-[var(--surface-raised)] text-accent border-[var(--border)]'
                  : 'border-transparent text-text-muted hover:text-text-primary'
              }`}
            >
              {m === 'news' ? 'News' : 'Feed'}
            </button>
          ))}
        </div>
        {/* Channels */}
        {mode === 'news' && (
        <div className="flex gap-1 overflow-x-auto scrollbar-none">
          {tabs.map((ch) => (
            <button
              key={ch.id}
              onClick={() => setChannel(ch.id)}
              aria-pressed={channel === ch.id}
              className={`flex-shrink-0 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                channel === ch.id
                  ? 'text-accent border-accent'
                  : 'text-text-muted border-transparent hover:text-text-primary'
              }`}
            >
              {ch.label}
            </button>
          ))}
        </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {mode === 'feed' ? (
          <ChangesFeedPanel />
        ) : selected ? (
          <ArticleDetail
            item={selected}
            channelLabel={channelLabel(selected.channel)}
            onBack={closeArticle}
            canManage={canManageItem(selected)}
            onEdit={openEdit}
            onDelete={handleDelete}
            canShareToChat={canShareToChat}
            onShare={setSharing}
          />
        ) : (
          <div className="max-w-6xl mx-auto">
            {loading ? (
              <div className="space-y-4">
                <div className="rounded-2xl aspect-[16/7] w-full bg-[var(--surface-raised)] border border-[var(--border)] animate-pulse" />
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
                </div>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center text-center py-24 px-6">
                <AlertCircle size={28} className="text-red-400 mb-3" />
                <p className="text-sm text-text-secondary mb-4">{error}</p>
                <button
                  onClick={load}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--surface-raised)] border border-[var(--border)] text-text-primary hover:border-accent/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                >
                  Try again
                </button>
              </div>
            ) : items.length === 0 ? (
              <EmptyState canManage={canPost} onCompose={openNew} />
            ) : (
              <div className="space-y-5">
                {featured && <FeaturedCard item={featured} onOpen={openItem} canManage={canManageItem(featured)} onEdit={openEdit} onDelete={handleDelete} />}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {rest.map((item) => (
                    <NewsCard key={item.id} item={item} onOpen={openItem} canManage={canManageItem(item)} onEdit={openEdit} onDelete={handleDelete} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {composeOpen && (
        <NewsComposeModal
          channels={channels}
          initialChannel={channel === ALL_CHANNEL ? undefined : channel}
          editing={editing}
          onClose={() => { setComposeOpen(false); setEditing(null) }}
          onSaved={handleSaved}
        />
      )}
      {channelsOpen && (
        <NewsChannelsModal
          channels={channels}
          onClose={() => setChannelsOpen(false)}
          onChanged={loadChannels}
        />
      )}
      {sharing && <ShareNewsModal item={sharing} onClose={() => setSharing(null)} />}
    </div>
  )
}
