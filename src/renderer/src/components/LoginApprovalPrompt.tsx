import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, Loader2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import * as userApi from '../lib/userApi'
import { subscribeNotifications } from '../lib/notificationSocket'
import type { PendingLoginApproval } from '../lib/userApi'


/** Shown on an already-signed-in device when another device is logging in and asked for approval. */
export default function LoginApprovalPrompt(): JSX.Element | null {
  const signedIn = useStore((s) => !!s.account)
  const [pending, setPending] = useState<PendingLoginApproval[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!signedIn) { setPending([]); return }
    let cancelled = false
    const tick = (): void => {
      if (document.hidden) return
      userApi.listLoginApprovals().then((list) => { if (!cancelled) setPending(list) }).catch(() => undefined)
    }
    tick()
    // The notifications socket pushes a frame the moment a request is created.
    // No timer: we catch up by refetching on every (re)connect and when the
    // tab becomes visible again, which covers anything missed while offline.
    const unsubscribe = subscribeNotifications(
      (frame) => { if (/login[_-]?approval/i.test(frame.type)) tick() },
      tick,
    )
    document.addEventListener('visibilitychange', tick)
    return () => { cancelled = true; unsubscribe(); document.removeEventListener('visibilitychange', tick) }
  }, [signedIn])

  const decide = useCallback(async (id: string, decision: 'approve' | 'deny') => {
    setBusy(true)
    try { await userApi.decideLoginApproval(id, decision) } catch { /* expired - the next poll drops it */ }
    setPending((list) => list.filter((p) => p.id !== id))
    setBusy(false)
  }, [])

  const req = pending[0]
  if (!signedIn || !req) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/50 p-0 md:p-4">
      <div className="w-full md:max-w-sm bg-surface border border-[var(--border)] rounded-t-2xl md:rounded-2xl shadow-2xl p-5 space-y-4">
        <div className="flex items-center gap-2 text-text-primary text-sm font-semibold">
          <ShieldCheck size={18} className="text-accent" /> Approve this login?
        </div>
        <p className="text-xs text-text-secondary leading-relaxed">
          Someone entered your password on another device. Approve only if the code below
          matches the one on the screen you&apos;re signing in to.
        </p>
        <div className="text-center text-4xl font-bold tracking-widest text-text-primary">{req.code}</div>
        <div className="text-[11px] text-text-muted break-words">
          {req.ip ? `${req.ip} · ` : ''}{req.user_agent || 'Unknown device'}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => decide(req.id, 'deny')}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl border border-[var(--border)] text-text-primary text-sm font-semibold hover:bg-white/5 disabled:opacity-60"
          >
            Deny
          </button>
          <button
            onClick={() => decide(req.id, 'approve')}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {busy && <Loader2 size={14} className="animate-spin" />} Approve
          </button>
        </div>
      </div>
    </div>
  )
}
