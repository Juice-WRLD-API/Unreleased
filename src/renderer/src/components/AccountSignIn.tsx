import { useState, type FormEvent } from 'react'
import { AtSign, Check, KeyRound, Loader2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import { changePassword, changeUsername, type AccountUser } from '../lib/userApi'
import { errorMessage } from '../lib/format'
import { DiscordGlyph, PasswordField, UsernameField, formatChangeDate, passwordScore, useUsernameStatus } from './credentialFields'

const actionBtn = 'shrink-0 rounded-full bg-[var(--fill)] hover:bg-[var(--fill-strong)] px-3 py-1 text-xs font-semibold text-accent transition-colors disabled:opacity-40 disabled:text-text-muted'
const saveBtn = 'inline-flex items-center gap-1 rounded-full bg-accent px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60'

// Settings → Account: how this account signs in. Discord sign-ups start with
// a placeholder username and no password; here they can pick both and then
// sign in either way. Renames are limited to one every 14 days by the server.
export default function AccountSignIn({ account }: { account: AccountUser }): JSX.Element {
  const [open, setOpen] = useState<'username' | 'password' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Older servers don't send the sign-in fields: say nothing rather than guess.
  if (account.username_chosen === undefined && account.has_password === undefined) return <></>

  const chosen = account.username_chosen !== false
  const nextChange = account.username_next_change_at ?? null
  const close = (msg?: string): void => { setOpen(null); setNotice(msg ?? null) }

  return (
    // Sits inside a Settings group card, which supplies the pane and padding.
    <div>
      {account.discord_id && (
        <div className="flex items-center gap-2.5 py-3 border-b border-[var(--border)]">
          <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-[#5865F2] text-white">
            <DiscordGlyph size={13} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-text-primary">Discord</p>
            <p className="text-text-muted text-[11px] truncate">Connected{account.discord_username ? ` as ${account.discord_username}` : ''}</p>
          </div>
        </div>
      )}

      <div className="py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-[#2563eb]">
            <AtSign size={13} className="text-white" strokeWidth={2.25} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-text-primary truncate">{chosen ? account.username : 'Username'}</p>
            <p className="text-text-muted text-[11px]">
              {!chosen ? 'Not chosen yet. Pick one to sign in with a password.'
                : nextChange ? `You can change it again on ${formatChangeDate(nextChange)}`
                  : 'You sign in with this. It can change once every 14 days.'}
            </p>
          </div>
          {open !== 'username' && (
            <button onClick={() => { setNotice(null); setOpen('username') }} disabled={!!nextChange} className={actionBtn}>
              {chosen ? 'Change' : 'Choose'}
            </button>
          )}
        </div>
        {open === 'username' && <UsernameForm account={account} onDone={close} />}
      </div>

      <div className="py-3">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-[#7c3aed]">
            <KeyRound size={13} className="text-white" strokeWidth={2.25} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-text-primary">Password</p>
            <p className="text-text-muted text-[11px]">
              {account.has_password ? 'Set. Changing it signs your other devices out.'
                : account.discord_id ? 'Not set. You sign in with Discord.' : 'Not set.'}
            </p>
          </div>
          {open !== 'password' && (
            <button onClick={() => { setNotice(null); setOpen('password') }} className={actionBtn}>
              {account.has_password ? 'Change' : 'Add'}
            </button>
          )}
        </div>
        {open === 'password' && <PasswordForm account={account} onDone={close} />}
      </div>

      {notice && (
        <p className="flex items-center gap-1.5 text-emerald-500 text-[11px] pb-3 -mt-1">
          <Check size={12} />{notice}
        </p>
      )}
    </div>
  )
}

function UsernameForm({ account, onDone }: { account: AccountUser; onDone: (msg?: string) => void }): JSX.Element {
  const chosen = account.username_chosen !== false
  const [name, setName] = useState(chosen ? account.username ?? '' : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const status = useUsernameStatus(name, chosen ? account.username : undefined)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (status.state === 'bad' || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const updated = await changeUsername(name.trim())
      useStore.setState({ account: updated })
      onDone(`Username saved. Sign in as ${updated.username} from now on.`)
    } catch (err) {
      setError(errorMessage(err, 'Could not save the username.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2">
      <UsernameField value={name} onChange={setName} status={status} disabled={busy} autoFocus placeholder="New username" />
      <p className="text-text-muted text-[11px] px-0.5">
        {chosen ? 'Your old username stops working for sign-in right away. ' : ''}
        After saving you can change it again in 14 days.
      </p>
      {error && <p className="text-red-400 text-[11px] px-0.5">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={() => onDone()} disabled={busy} className="text-xs text-text-muted hover:text-text-primary disabled:opacity-40">Cancel</button>
        <button type="submit" disabled={busy || status.state !== 'ok'} className={saveBtn}>
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={12} />}Save
        </button>
      </div>
    </form>
  )
}

function PasswordForm({ account, onDone }: { account: AccountUser; onDone: (msg?: string) => void }): JSX.Element {
  // A Discord account has to pick a username first: it's what a password signs in with.
  const needsName = account.username_chosen === false
  const [name, setName] = useState('')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameStatus = useUsernameStatus(needsName ? name : '')
  const mismatch = confirm.length > 0 && confirm !== next
  const ready = passwordScore(next) > 0 && confirm === next
    && (!account.has_password || current.length > 0)
    && (!needsName || nameStatus.state === 'ok')

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      if (needsName) {
        const named = await changeUsername(name.trim())
        useStore.setState({ account: named })
      }
      const res = await changePassword({ new_password: next, ...(account.has_password ? { current_password: current } : {}) })
      useStore.setState({ account: res.user })
      onDone(account.has_password
        ? `Password changed.${res.signed_out ? ` Signed out of ${res.signed_out} other device${res.signed_out === 1 ? '' : 's'}.` : ''}`
        : `Password added. You can now sign in as ${res.user.username} with it.`)
    } catch (err) {
      setError(errorMessage(err, 'Could not save the password.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2">
      {needsName && (
        <UsernameField value={name} onChange={setName} status={nameStatus} disabled={busy} autoFocus placeholder="Choose a username" />
      )}
      {/* Lets password managers file the new password under the right name. */}
      {!needsName && <input type="text" autoComplete="username" value={account.username ?? ''} readOnly hidden />}
      {account.has_password && (
        <PasswordField value={current} onChange={setCurrent} placeholder="Current password" autoComplete="current-password" disabled={busy} autoFocus />
      )}
      <PasswordField value={next} onChange={setNext} placeholder="New password" autoComplete="new-password" disabled={busy} autoFocus={!needsName && !account.has_password} showStrength />
      <PasswordField value={confirm} onChange={setConfirm} placeholder="Confirm new password" autoComplete="new-password" disabled={busy} />
      {mismatch && <p className="text-red-400 text-[11px] px-0.5">The passwords don’t match.</p>}
      <p className="text-text-muted text-[11px] px-0.5">
        At least 8 characters, not all numbers and not a common password.
        {needsName ? ' You can keep signing in with Discord too.' : ''}
      </p>
      {error && <p className="text-red-400 text-[11px] px-0.5">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={() => onDone()} disabled={busy} className="text-xs text-text-muted hover:text-text-primary disabled:opacity-40">Cancel</button>
        <button type="submit" disabled={busy || !ready} className={saveBtn}>
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={12} />}{account.has_password ? 'Change password' : 'Add password'}
        </button>
      </div>
    </form>
  )
}
