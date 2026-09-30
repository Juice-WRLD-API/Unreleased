import { useEffect, useState } from 'react'
import { KeyRound, Loader2, ShieldAlert, ShieldCheck, Smartphone } from 'lucide-react'
import QRCode from 'qrcode'
import type { ChatUserBrief } from '../../lib/chatApi'
import type { UserTrust } from '../../lib/chatIdentity'
import type { LinkCandidate } from '../../lib/chatLinking'
import { displayName, useChatStore } from '../../store/chatStore'

const identity = () => import('../../lib/chatIdentity')

// Each participant's E2E v2 trust state, re-checked whenever a security key
// or device list changes (trustEpoch).
export function useParticipantTrust(users: ChatUserBrief[]): Map<number, UserTrust> {
  const meId = useChatStore((s) => s.meId)
  const epoch = useChatStore((s) => s.trustEpoch)
  const status = useChatStore((s) => s.identity)
  const ids = users.map((u) => u.id).join(',')
  const [trust, setTrust] = useState<Map<number, UserTrust>>(new Map())

  useEffect(() => {
    if (!meId || status === 'disabled' || status === 'unknown' || !ids) {
      setTrust(new Map())
      return
    }
    let cancelled = false
    void identity()
      .then((m) => m.loadUsersTrust(meId, ids.split(',').map(Number)))
      .then((map) => { if (!cancelled) setTrust(map) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [meId, ids, epoch, status])

  return trust
}

const bump = (): void => useChatStore.setState((s) => ({ trustEpoch: s.trustEpoch + 1 }))

// Above the message list: this device isn't linked yet, a participant's
// security key changed, or an unanswered key request can be restored from
// the recovery code.
export function TrustBanners({ participants }: { participants: ChatUserBrief[] }): JSX.Element | null {
  const meId = useChatStore((s) => s.meId)
  const status = useChatStore((s) => s.identity)
  const offerRestore = useChatStore((s) => s.offerRestore)
  const dismissRestore = useChatStore((s) => s.dismissRestoreOffer)
  const others = participants.filter((p) => p.id !== meId)
  const trust = useParticipantTrust(others)
  const [busy, setBusy] = useState<number | null>(null)

  const accept = async (userId: number): Promise<void> => {
    if (!meId) return
    setBusy(userId)
    try {
      await (await identity()).acceptKeyChange(meId, userId)
      bump()
    } finally {
      setBusy(null)
    }
  }

  const banners: JSX.Element[] = []
  if (status === 'ready') banners.push(<LinkApprovals key="approve" />)
  if (status === 'needs-link') {
    banners.push(
      <Banner key="link" tone="amber" icon={<Smartphone size={16} className="shrink-0 text-amber-400" />}>
        <span className="flex-1">
          <b>Verify this device.</b> Open Settings › Chat devices to show its number, then approve it from your other device. You can also restore with your recovery code.
        </span>
      </Banner>,
    )
  }
  if (offerRestore) {
    banners.push(
      <Banner key="restore" tone="amber" icon={<KeyRound size={16} className="shrink-0 text-amber-400" />}>
        <span className="flex-1">None of your other devices answered with the missing key. You can restore it with your recovery code in Settings › Chat devices.</span>
        <button onClick={dismissRestore} className="shrink-0 font-semibold text-amber-800 dark:text-amber-300 hover:underline">Dismiss</button>
      </Banner>,
    )
  }
  for (const user of others) {
    const t = trust.get(user.id)
    if (t?.state === 'changed') {
      banners.push(
        <Banner key={`chg-${user.id}`} tone={t.verified ? 'red' : 'amber'} icon={<ShieldAlert size={16} className={`shrink-0 ${t.verified ? 'text-red-400' : 'text-amber-400'}`} />}>
          <span className="flex-1">
            <b>{displayName(user)}&apos;s security key changed.</b>{' '}
            {t.verified
              ? 'You had verified them. Compare safety numbers again before trusting new messages; keys are not sent to them until you accept.'
              : 'This happens when they reset their identity. Keys are not sent to them until you accept.'}
          </span>
          <button onClick={() => void accept(user.id)} disabled={busy === user.id} className={`shrink-0 font-semibold hover:underline ${t.verified ? 'text-red-700 dark:text-red-300' : 'text-amber-800 dark:text-amber-300'}`}>
            {busy === user.id ? <Loader2 size={12} className="animate-spin" /> : t.verified ? 'Accept anyway' : 'Accept'}
          </button>
        </Banner>,
      )
    } else if (t?.state === 'invalid') {
      banners.push(
        <Banner key={`bad-${user.id}`} tone="red" icon={<ShieldAlert size={16} className="shrink-0 text-red-400" />}>
          <span className="flex-1"><b>Couldn&apos;t verify {displayName(user)}&apos;s devices</b> ({t.reason}). Keys are not sent to them.</span>
        </Banner>,
      )
    }
  }
  return banners.length ? <>{banners}</> : null
}

const POLL_MS = 10_000
const DISMISSED_KEY = 'unrlsd-link-dismissed'

function readDismissed(): string[] {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[] } catch { return [] }
}

// A device of yours that signed in but isn't verified yet. The server can't
// vouch for its keys, so approving means checking the number it shows.
function LinkApprovals(): JSX.Element | null {
  const meId = useChatStore((s) => s.meId)
  const epoch = useChatStore((s) => s.trustEpoch)
  const [cands, setCands] = useState<LinkCandidate[]>([])
  const [dismissed, setDismissed] = useState<string[]>(readDismissed)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!meId) return
    let cancelled = false
    const poll = (): void => {
      if (document.hidden) return
      void import('../../lib/chatIdentity').then((m) => m.getFeatures())
        .then((f) => (f.linking ? import('../../lib/chatLinking').then((l) => l.pendingDevices(meId)) : []))
        .then((list) => { if (!cancelled) setCands(list) })
        .catch(() => undefined)
    }
    poll()
    const timer = window.setInterval(poll, POLL_MS)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [meId, epoch])

  const dismiss = (id: string): void => {
    const next = [...dismissed, id]
    setDismissed(next)
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  const approve = async (c: LinkCandidate): Promise<void> => {
    if (!meId) return
    setBusy(c.session.device_id)
    setError(null)
    try {
      await (await import('../../lib/chatLinking')).approveLink(meId, c)
      setCands((l) => l.filter((x) => x.session.device_id !== c.session.device_id))
      bump()
    } catch (err) {
      setError((err as Error)?.message || 'Could not link that device.')
    } finally {
      setBusy(null)
    }
  }

  const shown = cands.filter((c) => !dismissed.includes(c.session.device_id))
  if (!shown.length) return null
  return (
    <>
      {shown.map((c) => (
        <Banner key={c.session.device_id} tone="amber" icon={<Smartphone size={16} className="shrink-0 text-amber-400" />}>
          <span className="flex-1">
            <b>Link {c.session.label || 'a new device'}?</b> Approve only if it shows{' '}
            <span className="font-mono text-sm">{c.sas}</span>. If you didn&apos;t just sign in somewhere, decline: someone may have your password.
            {error && <span className="block text-red-400">{error}</span>}
          </span>
          <button onClick={() => dismiss(c.session.device_id)} className="shrink-0 hover:underline">Not now</button>
          <button onClick={() => void approve(c)} disabled={busy === c.session.device_id} className="shrink-0 font-semibold text-amber-800 dark:text-amber-300 hover:underline">
            {busy === c.session.device_id ? <Loader2 size={12} className="animate-spin" /> : 'Approve'}
          </button>
        </Banner>
      ))}
    </>
  )
}

function Banner({ tone, icon, children }: { tone: 'amber' | 'red'; icon: JSX.Element; children: React.ReactNode }): JSX.Element {
  const cls = tone === 'red'
    ? 'border-red-500/30 bg-red-500/10 text-red-900 dark:text-red-200'
    : 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200'
  return <div className={`mx-4 md:mx-5 mt-3 flex items-center gap-3 rounded-xl border px-3 py-2.5 text-xs ${cls}`}>{icon}{children}</div>
}

// Safety number for one other person: 60 digits (12 groups of 5) derived
// from both master keys, plus a QR of the same fingerprint to scan.
export function SafetyNumber({ user }: { user: ChatUserBrief }): JSX.Element | null {
  const meId = useChatStore((s) => s.meId)
  const epoch = useChatStore((s) => s.trustEpoch)
  const status = useChatStore((s) => s.identity)
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<{ digits: string[]; qr: string; verified: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !meId) return
    let cancelled = false
    void (async () => {
      const m = await identity()
      const [sn, trust] = await Promise.all([m.safetyNumber(meId, user.id), m.loadUserTrust(meId, user.id)])
      if (cancelled) return
      if (!sn) {
        setError('Safety numbers need both of you on the new encryption with a verified key.')
        return
      }
      const hex = Array.from(sn.fingerprint, (b) => b.toString(16).padStart(2, '0')).join('')
      setData({ digits: sn.digits, qr: await QRCode.toDataURL(`unrlsd-safety:v2:${hex}`, { margin: 1, width: 168 }), verified: trust.state === 'ok' && trust.verified })
    })().catch(() => { if (!cancelled) setError('Could not compute the safety number.') })
    return () => { cancelled = true }
  }, [open, meId, user.id, epoch])

  if (status !== 'ready' || !meId || user.id === meId) return null

  const toggleVerified = async (): Promise<void> => {
    if (!data) return
    await (await identity()).setVerified(meId, user.id, !data.verified)
    setData({ ...data, verified: !data.verified })
    bump()
  }

  return (
    <div className="mt-2 rounded-lg border border-[var(--border)] p-2.5">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left text-xs font-semibold text-text-secondary hover:text-text-primary">
        {data?.verified ? <ShieldCheck size={14} className="text-accent" /> : <KeyRound size={14} />}
        Safety number with {displayName(user)}
      </button>
      {open && (
        <div className="mt-2">
          {error && <p className="text-[11px] text-text-muted">{error}</p>}
          {!error && !data && <Loader2 size={13} className="animate-spin text-text-muted" />}
          {data && (
            <>
              <p className="font-mono text-[13px] leading-6 tracking-wide text-text-primary">
                {data.digits.map((g, i) => <span key={i} className="mr-2 inline-block">{g}</span>)}
              </p>
              <img src={data.qr} alt="Safety number QR code" className="mt-2 rounded bg-white p-1" width={168} height={168} />
              <p className="mt-2 text-[11px] text-text-muted">
                Compare these numbers with {displayName(user)} in person or on a call. If they match, nobody is intercepting your messages.
              </p>
              <button onClick={() => void toggleVerified()} className="mt-2 rounded-lg bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent/25">
                {data.verified ? 'Mark as not verified' : 'Mark as verified'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
