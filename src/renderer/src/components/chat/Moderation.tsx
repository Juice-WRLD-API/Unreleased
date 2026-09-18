import { useEffect, useMemo, useState } from 'react'
import { Globe2, Loader2, ShieldBan, Timer } from 'lucide-react'
import * as api from '../../lib/chatApi'
import {
  MAX_SERVER_TIMEOUT_MINUTES,
  MAX_SITE_TIMEOUT_MINUTES,
  type ChatMember,
  type ChatUserBrief,
  type ServerBan,
  type SiteModeration,
  type SiteModerationAction,
} from '../../lib/chatApi'
import { displayName, useChatStore, useExpiryTick } from '../../store/chatStore'
import { relativeTime } from '../adminShared'
import { DialogShell, Field, GhostButton, inputCls, PeoplePicker, PrimaryButton } from './Modals'
import { ChatAvatar, errorText, useChatToast } from './ui'

// Presets the timeout picker offers, in minutes. "Custom" past the last one is
// still allowed up to the API's own cap (28 days for a server, a year
// site-wide) via the number input.
const TIMEOUT_PRESETS: { label: string; minutes: number }[] = [
  { label: '60 secs', minutes: 1 },
  { label: '5 mins', minutes: 5 },
  { label: '10 mins', minutes: 10 },
  { label: '1 hour', minutes: 60 },
  { label: '1 day', minutes: 1440 },
  { label: '1 week', minutes: 10080 },
]

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'}`
  if (minutes < 1440) {
    const h = Math.round((minutes / 60) * 10) / 10
    return `${h} hour${h === 1 ? '' : 's'}`
  }
  const d = Math.round((minutes / 1440) * 10) / 10
  return `${d} day${d === 1 ? '' : 's'}`
}

// "4m 12s" / "3h 20m" / "2d 4h" left on a timeout. Recomputed by the caller
// on every render; useExpiryTick keeps that happening while one is running.
export function remainingTime(until: string): string {
  const ms = new Date(until).getTime() - Date.now()
  if (ms <= 0) return 'expired'
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m ${Math.floor((ms % 60000) / 1000)}s`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ${mins % 60}m`
  return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`
}

// Live countdown chip for a member row, self-clearing when the timeout lapses.
export function TimeoutBadge({ until }: { until: string }): JSX.Element | null {
  useExpiryTick(until)
  if (new Date(until).getTime() <= Date.now()) return null
  return (
    <span
      title={`Timed out until ${new Date(until).toLocaleString()}`}
      className="inline-flex items-center gap-1 shrink-0 rounded px-1 py-px bg-amber-500/15 text-amber-400 text-[10px] font-bold"
    >
      <Timer size={10} />{remainingTime(until)}
    </span>
  )
}

// Shown on both moderation dialogs when the caller is a platform admin: the
// same action, but routed to /site-moderation/ so it covers every server and
// DMs instead of just this one.
function SiteWideToggle({ checked, onChange, hint }: { checked: boolean; onChange: (v: boolean) => void; hint: string }): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors mb-4 ${checked ? 'border-red-500/50 bg-red-500/5' : 'border-[var(--border)] hover:bg-surface-raised/50'}`}
    >
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${checked ? 'bg-red-500/15 text-red-400' : 'bg-surface-raised text-text-secondary'}`}>
        <Globe2 size={16} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-text-primary">Apply site-wide</span>
        <span className="block text-xs text-text-muted">{hint}</span>
      </span>
      <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${checked ? 'bg-red-500 border-red-500 text-white' : 'border-[var(--border)]'}`}>
        {checked && <span className="w-2 h-2 rounded-sm bg-white" />}
      </span>
    </button>
  )
}

function usePlatformAdmin(): boolean {
  return useChatStore((s) => s.me?.role === 'administrator')
}

export function TimeoutMemberModal({ serverId, member, onClose }: {
  serverId: number
  member: ChatMember
  onClose: () => void
}): JSX.Element {
  const loadMembers = useChatStore((s) => s.loadMembers)
  const isAdmin = usePlatformAdmin()
  const toast = useChatToast()
  const [minutes, setMinutes] = useState(10)
  const [siteWide, setSiteWide] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const max = siteWide ? MAX_SITE_TIMEOUT_MINUTES : MAX_SERVER_TIMEOUT_MINUTES
  const valid = minutes >= 1 && minutes <= max

  const apply = async (): Promise<void> => {
    setBusy(true)
    try {
      if (siteWide) {
        await api.applySiteModeration({ user_id: member.user.id, action: 'timeout', duration: minutes, ...(reason.trim() ? { reason: reason.trim() } : {}) })
      } else {
        await api.timeoutMember(serverId, member.user.id, minutes)
        await loadMembers(serverId, true)
      }
      toast(`${displayName(member.user)} timed out for ${formatDuration(minutes)}`, 'ok')
      onClose()
    } catch (err) {
      toast(errorText(err, 'Could not time out this member'))
      setBusy(false)
    }
  }

  return (
    <DialogShell
      title="Time out member"
      subtitle={displayName(member.user)}
      onClose={onClose}
      footer={<><GhostButton onClick={onClose}>Cancel</GhostButton><PrimaryButton onClick={apply} busy={busy} disabled={!valid} danger>Time out</PrimaryButton></>}
    >
      <p className="text-sm text-text-secondary mb-4">
        They stay in the server and can keep reading, but can&apos;t post until the timeout expires. It lifts
        automatically — no follow-up needed.
      </p>
      <Field label="Duration">
        <div className="flex flex-wrap gap-1.5 mb-2">
          {TIMEOUT_PRESETS.map((p) => (
            <button
              key={p.minutes}
              type="button"
              onClick={() => setMinutes(p.minutes)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${minutes === p.minutes ? 'bg-accent text-white' : 'bg-surface-raised text-text-secondary hover:text-text-primary'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          type="number"
          min={1}
          max={max}
          value={minutes}
          onChange={(e) => setMinutes(Math.floor(Number(e.target.value) || 0))}
          className={inputCls}
        />
      </Field>
      <p className={`-mt-3 mb-4 text-[11px] ${valid ? 'text-text-muted' : 'text-red-400'}`}>
        Minutes, 1–{max.toLocaleString()} ({siteWide ? 'up to a year, site-wide' : 'up to 28 days'}). Currently {formatDuration(Math.max(minutes, 1))}.
      </p>
      {isAdmin && (
        <>
          <SiteWideToggle checked={siteWide} onChange={setSiteWide} hint="Silences them in every server and in DMs, not just this one." />
          {siteWide && (
            <Field label="Reason" hint="Optional, max 500 characters.">
              <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Why this action was taken" className={inputCls} />
            </Field>
          )}
        </>
      )}
    </DialogShell>
  )
}

export function BanMemberModal({ serverId, user, onClose }: {
  serverId: number
  user: ChatUserBrief
  onClose: () => void
}): JSX.Element {
  const loadMembers = useChatStore((s) => s.loadMembers)
  const isAdmin = usePlatformAdmin()
  const toast = useChatToast()
  const [reason, setReason] = useState('')
  const [siteWide, setSiteWide] = useState(false)
  const [permanent, setPermanent] = useState(true)
  const [minutes, setMinutes] = useState(1440)
  const [busy, setBusy] = useState(false)

  const apply = async (): Promise<void> => {
    setBusy(true)
    try {
      if (siteWide) {
        await api.applySiteModeration({
          user_id: user.id,
          action: 'ban',
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          ...(permanent ? {} : { duration: minutes }),
        })
      } else {
        await api.banUser(serverId, user.id, reason.trim() || undefined)
        await loadMembers(serverId, true)
        await useChatStore.getState().loadBans(serverId, true).catch(() => [])
      }
      toast(`${displayName(user)} banned`, 'ok')
      onClose()
    } catch (err) {
      toast(errorText(err, 'Could not ban this user'))
      setBusy(false)
    }
  }

  return (
    <DialogShell
      title="Ban user"
      subtitle={displayName(user)}
      onClose={onClose}
      footer={<><GhostButton onClick={onClose}>Cancel</GhostButton><PrimaryButton onClick={apply} busy={busy} danger>Ban</PrimaryButton></>}
    >
      <p className="text-sm text-text-secondary mb-4">
        They&apos;re removed from the server and can&apos;t rejoin until you unban them. Unlike a kick, this
        survives an invite.
      </p>
      <Field label="Reason" hint="Shown in the server's ban list.">
        <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Spam" className={inputCls} autoFocus />
      </Field>
      {isAdmin && (
        <>
          <SiteWideToggle checked={siteWide} onChange={setSiteWide} hint="Removes their chat access entirely — every server and DMs." />
          {siteWide && (
            <>
              <div className="flex gap-1.5 mb-4">
                <button
                  type="button"
                  onClick={() => setPermanent(true)}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${permanent ? 'bg-accent text-white' : 'bg-surface-raised text-text-secondary hover:text-text-primary'}`}
                >
                  Until revoked
                </button>
                <button
                  type="button"
                  onClick={() => setPermanent(false)}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${!permanent ? 'bg-accent text-white' : 'bg-surface-raised text-text-secondary hover:text-text-primary'}`}
                >
                  Expires after…
                </button>
              </div>
              {!permanent && (
                <Field label="Duration (minutes)" hint={`1–${MAX_SITE_TIMEOUT_MINUTES.toLocaleString()} — currently ${formatDuration(Math.max(minutes, 1))}.`}>
                  <input
                    type="number"
                    min={1}
                    max={MAX_SITE_TIMEOUT_MINUTES}
                    value={minutes}
                    onChange={(e) => setMinutes(Math.floor(Number(e.target.value) || 0))}
                    className={inputCls}
                  />
                </Field>
              )}
            </>
          )}
        </>
      )}
    </DialogShell>
  )
}

export function ServerBansModal({ serverId, onClose }: { serverId: number; onClose: () => void }): JSX.Element {
  const server = useChatStore((s) => s.servers.find((x) => x.id === serverId))
  const bans = useChatStore((s) => s.bans[serverId])
  const loadBans = useChatStore((s) => s.loadBans)
  const toast = useChatToast()
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  useEffect(() => {
    loadBans(serverId, true).catch((err) => setError(errorText(err, 'Could not load bans')))
  }, [serverId, loadBans])

  const unban = (ban: ServerBan): void => {
    setBusyId(ban.user.id)
    api.unbanUser(serverId, ban.user.id)
      .then(() => {
        useChatStore.setState((s) => ({
          bans: { ...s.bans, [serverId]: (s.bans[serverId] ?? []).filter((b) => b.user.id !== ban.user.id) },
        }))
        toast(`${displayName(ban.user)} unbanned`, 'ok')
      })
      .catch((err) => toast(errorText(err, 'Could not unban')))
      .finally(() => setBusyId(null))
  }

  return (
    <DialogShell
      title="Banned users"
      subtitle={server?.name}
      onClose={onClose}
      footer={<GhostButton onClick={onClose}>Close</GhostButton>}
    >
      {error && <p className="text-xs text-red-400 py-4 text-center">{error}</p>}
      {!error && !bans && <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-text-muted" /></div>}
      {!error && bans?.length === 0 && (
        <div className="flex flex-col items-center text-center py-10">
          <span className="w-12 h-12 rounded-2xl bg-surface-raised text-text-muted flex items-center justify-center mb-3"><ShieldBan size={22} /></span>
          <p className="text-sm font-semibold text-text-primary">No one is banned</p>
          <p className="text-xs text-text-muted mt-1">Bans you issue from the member list show up here.</p>
        </div>
      )}
      {bans?.map((ban) => (
        <div key={ban.id} className="flex items-center gap-2.5 rounded-xl px-2 py-2 mb-1 hover:bg-surface-raised/60">
          <ChatAvatar user={ban.user} size={34} />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-text-primary truncate">{displayName(ban.user)}</p>
            <p className="text-[11px] text-text-muted truncate">
              {ban.reason || 'No reason given'}
              {ban.banned_by && ` · by ${displayName(ban.banned_by)}`} · {relativeTime(ban.created_at)}
            </p>
          </div>
          <button
            onClick={() => unban(ban)}
            disabled={busyId === ban.user.id}
            className="shrink-0 px-2.5 py-1.5 rounded-lg bg-surface-raised text-xs font-bold text-text-secondary hover:text-text-primary disabled:opacity-40"
          >
            {busyId === ban.user.id ? <Loader2 size={13} className="animate-spin" /> : 'Unban'}
          </button>
        </div>
      ))}
    </DialogShell>
  )
}

const ACTION_LABEL: Record<SiteModerationAction, string> = { ban: 'Ban', mute: 'Mute', timeout: 'Timeout' }
const ACTION_HINT: Record<SiteModerationAction, string> = {
  ban: 'No chat access at all — servers and DMs.',
  mute: 'Can still read every server, but cannot post anywhere or DM.',
  timeout: 'Same as a mute, but normally paired with a duration.',
}

// Platform-admin panel for /site-moderation/. Separate from the per-server
// member list on purpose: these records aren't scoped to a server and aren't
// visible to (or actionable by) server owners.
export function SiteModerationModal({ onClose }: { onClose: () => void }): JSX.Element {
  const toast = useChatToast()
  const [records, setRecords] = useState<SiteModeration[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeOnly, setActiveOnly] = useState(true)
  const [target, setTarget] = useState<ChatUserBrief[]>([])
  const [action, setAction] = useState<SiteModerationAction>('mute')
  const [reason, setReason] = useState('')
  const [minutes, setMinutes] = useState<number | ''>('')
  const [busy, setBusy] = useState(false)

  const refresh = (only: boolean): void => {
    setRecords(null)
    setError(null)
    api.listSiteModeration({ activeOnly: only })
      .then(setRecords)
      .catch((err) => setError(errorText(err, 'Could not load site moderation')))
  }

  useEffect(() => { refresh(activeOnly) }, [activeOnly])

  const durationValid = minutes === '' || (minutes >= 1 && minutes <= MAX_SITE_TIMEOUT_MINUTES)

  const apply = async (): Promise<void> => {
    const user = target[0]
    if (!user) return
    setBusy(true)
    try {
      await api.applySiteModeration({
        user_id: user.id,
        action,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(minutes === '' ? {} : { duration: minutes }),
      })
      toast(`${ACTION_LABEL[action]} applied to ${displayName(user)}`, 'ok')
      setTarget([])
      setReason('')
      setMinutes('')
      refresh(activeOnly)
    } catch (err) {
      toast(errorText(err, 'Could not apply'))
    } finally {
      setBusy(false)
    }
  }

  const revoke = (record: SiteModeration): void => {
    api.revokeSiteModeration(record.id)
      .then(() => {
        toast('Revoked', 'ok')
        setRecords((prev) => prev
          ? (activeOnly
              ? prev.filter((r) => r.id !== record.id)
              : prev.map((r) => r.id === record.id ? { ...r, is_active: false } : r))
          : prev)
      })
      .catch((err) => toast(errorText(err, 'Could not revoke')))
  }

  return (
    <DialogShell
      title="Site-wide moderation"
      subtitle="Applies across every server and DMs"
      width="max-w-lg"
      onClose={onClose}
      footer={<><GhostButton onClick={onClose}>Close</GhostButton><PrimaryButton onClick={apply} busy={busy} disabled={target.length === 0 || !durationValid} danger>Apply {ACTION_LABEL[action].toLowerCase()}</PrimaryButton></>}
    >
      <Field label="User">
        <PeoplePicker selected={target} onChange={(next) => setTarget(next.slice(-1))} max={1} />
      </Field>
      <Field label="Action">
        <div className="flex gap-1.5">
          {(['ban', 'mute', 'timeout'] as SiteModerationAction[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAction(a)}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold transition-colors ${action === a ? 'bg-accent text-white' : 'bg-surface-raised text-text-secondary hover:text-text-primary'}`}
            >
              {ACTION_LABEL[a]}
            </button>
          ))}
        </div>
      </Field>
      <p className="-mt-3 mb-4 text-[11px] text-text-muted">{ACTION_HINT[action]}</p>
      <Field label="Reason" hint="Optional, max 500 characters.">
        <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Repeated harassment" className={inputCls} />
      </Field>
      <Field
        label="Duration (minutes)"
        hint={minutes === ''
          ? 'Leave empty to keep it until an admin revokes it.'
          : `1–${MAX_SITE_TIMEOUT_MINUTES.toLocaleString()} — currently ${formatDuration(Math.max(Number(minutes), 1))}.`}
      >
        <input
          type="number"
          min={1}
          max={MAX_SITE_TIMEOUT_MINUTES}
          value={minutes}
          placeholder="Permanent"
          onChange={(e) => setMinutes(e.target.value === '' ? '' : Math.floor(Number(e.target.value) || 0))}
          className={inputCls}
        />
      </Field>

      <div className="flex items-center gap-2 mt-2 mb-2 pt-3 border-t border-[var(--border)]">
        <h3 className="flex-1 text-[11px] font-bold uppercase tracking-wider text-text-muted">
          {activeOnly ? 'Active actions' : 'All actions'}
        </h3>
        <button
          onClick={() => setActiveOnly((v) => !v)}
          className="px-2 py-1 rounded-lg bg-surface-raised text-[11px] font-semibold text-text-secondary hover:text-text-primary"
        >
          {activeOnly ? 'Show revoked too' : 'Active only'}
        </button>
      </div>
      {error && <p className="text-xs text-red-400 py-4 text-center">{error}</p>}
      {!error && !records && <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-text-muted" /></div>}
      {!error && records?.length === 0 && <p className="text-xs text-text-muted py-6 text-center">Nothing here.</p>}
      {records?.map((r) => (
        <div key={r.id} className={`flex items-center gap-2.5 rounded-xl px-2 py-2 mb-1 hover:bg-surface-raised/60 ${r.is_active ? '' : 'opacity-50'}`}>
          <ChatAvatar user={r.user} size={32} />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-text-primary truncate flex items-center gap-1.5">
              {displayName(r.user)}
              <span className={`shrink-0 rounded px-1 py-px text-[10px] font-bold uppercase ${r.action === 'ban' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'}`}>
                {ACTION_LABEL[r.action]}
              </span>
              {!r.is_active && <span className="shrink-0 text-[10px] font-bold uppercase text-text-muted">revoked</span>}
            </p>
            <p className="text-[11px] text-text-muted truncate">
              {r.reason || 'No reason given'}
              {r.moderator && ` · by ${displayName(r.moderator)}`}
              {' · '}
              {r.expires_at ? `expires in ${remainingTime(r.expires_at)}` : 'until revoked'}
            </p>
          </div>
          {r.is_active && (
            <button onClick={() => revoke(r)} className="shrink-0 px-2.5 py-1.5 rounded-lg bg-surface-raised text-xs font-bold text-text-secondary hover:text-text-primary">
              Revoke
            </button>
          )}
        </div>
      ))}
    </DialogShell>
  )
}

// Small summary line for the members panel header: how many members are
// currently under a server-level restriction.
export function useRestrictedCount(serverId: number): number {
  const members = useChatStore((s) => s.members[serverId])
  return useMemo(() => (members ?? []).filter((m) => m.muted || api.isTimedOut(m)).length, [members])
}
