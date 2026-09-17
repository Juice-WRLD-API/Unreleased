import { Newspaper } from 'lucide-react'
import type { SharedNewsPayload } from '../../lib/chatShare'
import { useStore } from '../../store/useStore'

export default function NewsShareCard({ news }: { news: SharedNewsPayload }): JSX.Element {
  const open = (): void => {
    useStore.getState().setActiveView('news')
    // NewsView reads this on mount to jump straight to the shared post - same
    // handoff NewsNotifier uses for a clicked notification.
    try {
      sessionStorage.setItem('news:openPostId', String(news.postId))
    } catch {}
    window.dispatchEvent(new CustomEvent('news:open', { detail: news.postId }))
  }
  return (
    <button
      onClick={open}
      className="group flex items-center gap-3 w-full max-w-sm rounded-xl border border-[var(--border)] bg-surface-raised/60 px-3 py-2.5 text-left hover:bg-surface-raised transition-colors"
    >
      <span className="relative w-11 h-11 rounded-lg overflow-hidden bg-surface-highest shrink-0 flex items-center justify-center">
        {news.imageUrl ? <img src={news.imageUrl} alt="" className="w-full h-full object-cover" /> : <Newspaper size={18} className="text-text-muted" />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-text-primary truncate">{news.title}</span>
        <span className="block text-xs text-text-muted truncate">{news.summary || 'News post'}</span>
      </span>
    </button>
  )
}
