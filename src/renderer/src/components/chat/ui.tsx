import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Hash, Lock, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { ChatServer, ChatUserBrief } from '../../lib/chatApi'
import { displayName, useChatStore } from '../../store/chatStore'

// ─── Time ────────────────────────────────────────────────────────────────────

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (dayKey(iso) === dayKey(today.toISOString())) return 'Today'
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

export function shortStamp(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (dayKey(iso) === dayKey(new Date().toISOString())) return clockTime(iso)
  if (diff < 6 * 86_400_000) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function fullStamp(iso: string): string {
  return new Date(iso).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' })
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// ─── Avatars ─────────────────────────────────────────────────────────────────

const HUES = [152, 200, 262, 330, 24, 45, 178, 290]

function hueFor(seed: number | string): number {
  const s = String(seed)
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return HUES[Math.abs(h) % HUES.length]
}

export function ChatAvatar({ user, size = 36, presence, className = '', onClick }: {
  user: Pick<ChatUserBrief, 'id' | 'avatar' | 'display_name' | 'username'>
  size?: number
  presence?: boolean
  className?: string
  onClick?: () => void
}): JSX.Element {
  const online = useChatStore((s) => !!s.online[user.id])
  const [broken, setBroken] = useState(false)
  // Reset after a load failure so a stale/transient miss (e.g. a slow CDN
  // fetch on first paint) doesn't permanently hide the picture for the rest
  // of the session once the store gives us this user's avatar again.
  useEffect(() => setBroken(false), [user.avatar])
  const name = displayName(user)
  const dot = Math.max(8, Math.round(size * 0.3))
  const hue = hueFor(user.id)
  return (
    <span
      className={`relative inline-flex shrink-0 rounded-full ${onClick ? 'cursor-pointer' : ''} ${className}`}
      style={{ width: size, height: size }}
      onClick={onClick}
    >
      {user.avatar && !broken ? (
        <img src={user.avatar} alt="" onError={() => setBroken(true)} className="w-full h-full rounded-full object-cover bg-surface-raised" />
      ) : (
        <span
          className="w-full h-full rounded-full flex items-center justify-center font-semibold select-none"
          style={{ background: `hsl(${hue} 55% 45% / 0.22)`, color: `hsl(${hue} 70% 62%)`, fontSize: Math.max(10, size * 0.4) }}
        >
          {name.charAt(0).toUpperCase()}
        </span>
      )}
      {presence && (
        <span
          className={`absolute rounded-full border-2 border-[var(--chat-ring,var(--surface))] transition-colors ${online ? 'bg-emerald-500' : 'bg-zinc-500'}`}
          style={{ width: dot, height: dot, right: -1, bottom: -1 }}
          title={online ? 'Online' : 'Offline'}
        />
      )}
    </span>
  )
}

export function ServerGlyph({ server, size = 44, active }: { server: Pick<ChatServer, 'id' | 'name' | 'icon_url'>; size?: number; active?: boolean }): JSX.Element {
  const hue = hueFor(server.id * 7 + 3)
  const initials = server.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
  return (
    <span
      className={`flex items-center justify-center overflow-hidden transition-all duration-200 ${active ? 'rounded-[14px]' : 'rounded-[22px] group-hover:rounded-[14px]'}`}
      style={{ width: size, height: size, background: server.icon_url ? undefined : `hsl(${hue} 45% 40% / ${active ? 0.5 : 0.28})` }}
    >
      {server.icon_url
        ? <img src={server.icon_url} alt="" className="w-full h-full object-cover" />
        : <span className="text-sm font-bold" style={{ color: `hsl(${hue} 80% 78%)` }}>{initials || '?'}</span>}
    </span>
  )
}

export function ChannelIcon({ isPrivate, size = 16, className = '' }: { isPrivate: boolean; size?: number; className?: string }): JSX.Element {
  return (
    <span className={`relative inline-flex ${className}`}>
      <Hash size={size} />
      {isPrivate && <Lock size={Math.round(size * 0.55)} className="absolute -right-1 -bottom-0.5 bg-[var(--chat-ring,var(--surface))] rounded-sm" />}
    </span>
  )
}

export function CountBadge({ count, mention }: { count: number; mention?: boolean }): JSX.Element | null {
  if (count <= 0) return null
  return (
    <span className={`min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold leading-none flex items-center justify-center tabular-nums ${
      mention ? 'bg-red-500 text-white' : 'bg-accent text-white'
    }`}>
      {count > 99 ? '99+' : count}
    </span>
  )
}

export function IconButton({ label, onClick, active, children, className = '', disabled }: {
  label: string
  onClick?: (e: React.MouseEvent) => void
  active?: boolean
  children: ReactNode
  className?: string
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none ${
        active ? 'text-text-primary bg-surface-highest' : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'
      } ${className}`}
    >
      {children}
    </button>
  )
}

export function Skeleton({ rows = 6 }: { rows?: number }): JSX.Element {
  return (
    <div className="px-5 py-4 space-y-5 animate-pulse">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-3">
          <div className="w-9 h-9 rounded-full bg-surface-raised shrink-0" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-3 rounded bg-surface-raised" style={{ width: `${18 + ((i * 37) % 20)}%` }} />
            <div className="h-3 rounded bg-surface-raised/70" style={{ width: `${40 + ((i * 53) % 45)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Toasts ──────────────────────────────────────────────────────────────────

interface Toast { id: number; text: string; tone: 'error' | 'ok' }

const ToastContext = createContext<(text: string, tone?: 'error' | 'ok') => void>(() => {})

export function useChatToast(): (text: string, tone?: 'error' | 'ok') => void {
  return useContext(ToastContext)
}

export function ToastHost({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const push = useCallback((text: string, tone: 'error' | 'ok' = 'error') => {
    const id = nextId.current++
    setToasts((t) => [...t.slice(-2), { id, text, tone }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])
  return (
    <ToastContext.Provider value={push}>
      {children}
      {createPortal(
        <div className="fixed left-1/2 -translate-x-1/2 z-[200] flex flex-col items-center gap-2 pointer-events-none" style={{ bottom: 'calc(var(--bottom-nav-height, 0px) + 96px)' }}>
          {toasts.map((t) => (
            <div key={t.id} className="chat-pop pointer-events-auto flex items-center gap-2.5 pl-3 pr-2 py-2 rounded-xl border border-[var(--border)] bg-surface shadow-2xl text-sm text-text-primary max-w-[90vw]">
              {t.tone === 'error' ? <AlertCircle size={16} className="text-red-400 shrink-0" /> : <CheckCircle2 size={16} className="text-accent shrink-0" />}
              <span className="min-w-0">{t.text}</span>
              <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="p-1 rounded-md text-text-muted hover:text-text-primary">
                <X size={13} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

export function errorText(err: unknown, fallback = 'Something went wrong'): string {
  const msg = (err as Error)?.message
  return msg && msg.length < 160 ? msg : fallback
}

// ─── Dismiss helpers ─────────────────────────────────────────────────────────

export function useDismiss(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement>): void {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    const onDown = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [open, onClose, ref])
}
