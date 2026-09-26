import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink } from 'lucide-react'
import type { ChatUserBrief } from '../../lib/chatApi'
import { displayName } from '../../store/chatStore'
import { useStore } from '../../store/useStore'
import { getPublicProfile } from '../../lib/userApi'
import { ChatAvatar, useDismiss } from './ui'

// Shared avatar/name/@handle/role/bio block, used by both this popover (for
// other users) and Navigator's MyProfileCard (for yourself) so the two read
// as the same component with a different footer action.
export function UserCardBody({ user, bio, children }: {
  user: ChatUserBrief
  bio?: string | null
  children?: ReactNode
}): JSX.Element {
  return (
    <div className="px-4 pb-4">
      <ChatAvatar user={user} size={64} className="-mt-8 ring-4 ring-[var(--surface)]" />
      <p className="mt-2 text-base font-bold text-text-primary truncate">{displayName(user)}</p>
      <p className="text-xs text-text-muted truncate">@{user.username}</p>
      <span className={`mt-2 inline-flex items-center px-1.5 py-px rounded text-[9px] font-bold uppercase tracking-wider ${
        user.role === 'administrator' ? 'bg-red-500/15 text-red-400' : 'bg-sky-500/15 text-sky-400'
      }`}>
        {user.role === 'administrator' ? 'Administrator' : 'Manager'}
      </span>
      {bio && (
        <p className="mt-2 text-xs text-text-secondary leading-relaxed whitespace-pre-wrap line-clamp-3">{bio}</p>
      )}
      {children}
    </div>
  )
}

interface UserCardState { user: ChatUserBrief; x: number; y: number }

const UserCardContext = createContext<(user: ChatUserBrief, e: { clientX: number; clientY: number }) => void>(() => {})

// Cursor-positioned counterpart to MyProfileCard - click anyone's avatar or
// name anywhere in chat (message list, member list, mentions) and the same
// kind of card floats near the click, with a way into their full profile
// instead of Edit Profile.
export function useOpenUserCard(): (user: ChatUserBrief, e: { clientX: number; clientY: number }) => void {
  return useContext(UserCardContext)
}

export function UserCardHost({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<UserCardState | null>(null)
  const open = useCallback((user: ChatUserBrief, e: { clientX: number; clientY: number }) => {
    setState({ user, x: e.clientX, y: e.clientY })
  }, [])
  const close = useCallback(() => setState(null), [])
  return (
    <UserCardContext.Provider value={open}>
      {children}
      {state && <OtherUserCard key={state.user.id} user={state.user} x={state.x} y={state.y} onClose={close} />}
    </UserCardContext.Provider>
  )
}

function OtherUserCard({ user, x, y, onClose }: { user: ChatUserBrief; x: number; y: number; onClose: () => void }): JSX.Element {
  const openPublicProfile = useStore((s) => s.openPublicProfile)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [bio, setBio] = useState<string | null>(null)
  useDismiss(true, onClose, ref)

  useEffect(() => {
    let alive = true
    getPublicProfile(user.id).then((p) => { if (alive) setBio(p.bio || null) }).catch(() => {})
    return () => { alive = false }
  }, [user.id])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    })
  }, [x, y])

  return createPortal(
    <div className="fixed inset-0 z-[140]">
      <div
        ref={ref}
        className="chat-pop absolute w-[280px] rounded-2xl border border-[var(--border)] bg-surface shadow-2xl overflow-hidden"
        style={{ left: pos.left, top: pos.top }}
      >
        <div className="h-14 bg-gradient-to-br from-accent/40 to-accent/10" />
        <UserCardBody user={user} bio={bio}>
          <button
            onClick={() => { openPublicProfile(user.id); onClose() }}
            className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl bg-surface-raised hover:bg-surface-overlay px-3 py-2 text-sm font-semibold text-text-primary transition-colors"
          >
            <ExternalLink size={13} />View Full Profile
          </button>
        </UserCardBody>
      </div>
    </div>,
    document.body,
  )
}
