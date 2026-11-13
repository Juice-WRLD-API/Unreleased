import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ModalOverlay } from './Modal'
import { X, Loader2, AlertCircle, Fingerprint, Check } from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import { accountDisplayName, errorMessage } from '../lib/format'
import * as userApi from '../lib/userApi'
import { getPasskeySupport } from '../lib/passkeyApi'
import { DiscordGlyph, FIELD_CLASS, PasswordField, UsernameField, passwordScore, useUsernameStatus } from './credentialFields'

interface Props {
  onClose: () => void
}

type Step = 'form' | 'otp' | 'finish'

// After a Discord sign-in on an account with no username or password, the
// dialog offers both once. "Not now" is remembered per account; Settings →
// Account → Sign-in has the same forms for later.
const offerKey = (id: number): string => `unreleased:signInOffer:${id}`
function offerDismissed(id: number): boolean {
  try { return window.localStorage.getItem(offerKey(id)) === '1' } catch { return false }
}
function dismissOffer(id: number): void {
  try { window.localStorage.setItem(offerKey(id), '1') } catch {}
}

const secondaryBtn = 'w-full py-2.5 rounded-xl bg-[var(--surface-raised)] hover:bg-[var(--surface-overlay)] border border-[var(--border)] text-text-primary text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-60'
const primaryBtn = 'w-full py-2.5 rounded-xl bg-accent hover:opacity-90 text-white text-sm font-semibold transition-opacity flex items-center justify-center gap-2 disabled:opacity-60'

export default function UserAuthModal({ onClose }: Props): JSX.Element {
  const { loginWithDiscord, loginWithPassword, signupWithPassword, completeApprovedLogin, loginWithPasskey } = useStorePick(
    'loginWithDiscord',
    'loginWithPasskey',
    'loginWithPassword',
    'signupWithPassword',
    'completeApprovedLogin',
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [step, setStep] = useState<Step>('form')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [displayName, setDisplayName] = useState('')
  const signupStatus = useUsernameStatus(mode === 'signup' && step === 'form' ? username : '')
  const [otp, setOtp] = useState('')
  // Second factor can be a code from the authenticator app or a yes from a signed-in device.
  const [otpMethod, setOtpMethod] = useState<'code' | 'device'>('code')
  const [approval, setApproval] = useState<{ code: string } | null>(null)
  const pollRef = useRef<number | null>(null)
  // The passkey buttons only show where the prompt can open (Windows app, website).
  const [passkeyReady, setPasskeyReady] = useState(false)
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  const [discordBusy, setDiscordBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void getPasskeySupport().then((s) => { if (alive) setPasskeyReady(s.ceremonies) })
    return () => { alive = false }
  }, [])

  const stopPolling = (): void => {
    if (pollRef.current != null) { window.clearInterval(pollRef.current); pollRef.current = null }
  }
  useEffect(() => stopPolling, [])

  const switchMode = (next: 'login' | 'signup'): void => {
    if (next === mode) return
    setMode(next)
    setError(null)
    setPassword('')
    setConfirm('')
  }

  const resetOtp = (): void => {
    stopPolling()
    setApproval(null)
    setOtpMethod('code')
    setStep('form')
    setOtp('')
    setPassword('')
    setError(null)
  }

  const requestApproval = async (): Promise<void> => {
    setError(null)
    setLoading(true)
    try {
      const req = await userApi.requestLoginApproval(username.trim(), password)
      setApproval({ code: req.code })
      const deadline = Date.now() + req.expires_in * 1000
      stopPolling()
      // One poll at a time: on a slow connection the next tick used to start
      // while the last was out, and both could complete the same login.
      let inFlight = false
      const timer = window.setInterval(async () => {
        if (inFlight) return
        inFlight = true
        try {
          const res = await userApi.pollLoginApproval(req.id, req.secret)
          // Stopped (cancelled, closed, a newer request) while this was out.
          if (pollRef.current !== timer) return
          if (res.status === 'approved') {
            stopPolling()
            await completeApprovedLogin(res.token, res.user)
            onClose()
          } else if (res.status === 'denied' || res.status === 'expired' || Date.now() > deadline) {
            stopPolling()
            setApproval(null)
            setError(res.status === 'denied' ? 'The other device denied this login.' : 'The request expired. Try again.')
          }
        } catch (err) {
          if (pollRef.current !== timer) return
          stopPolling()
          setApproval(null)
          setError(errorMessage(err, 'The request expired. Try again.'))
        } finally {
          inFlight = false
        }
      }, 2000)
      pollRef.current = timer
    } catch (err) {
      setError(errorMessage(err, 'Could not send the request.'))
    } finally {
      setLoading(false)
    }
  }

  const startDiscord = async (): Promise<void> => {
    setError(null)
    setDiscordBusy(true)
    try {
      // The website sends the whole page to Discord and back; the finish step
      // is offered from Settings → Account → Sign-in afterwards.
      await loginWithDiscord()
      onClose()
    } catch (e) {
      setError(errorMessage(e, 'Could not start Discord login'))
    } finally {
      setDiscordBusy(false)
    }
  }

  const startPasskey = async (): Promise<void> => {
    setError(null)
    setPasskeyBusy(true)
    try {
      // false = the prompt was closed or cancelled: nothing to report.
      if (await loginWithPasskey()) onClose()
    } catch (e) {
      setError(errorMessage(e, 'Could not sign in with a passkey'))
    } finally {
      setPasskeyBusy(false)
    }
  }

  const submitPassword = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    const name = username.trim()
    if (!name || !password) {
      setError('Enter a username and password.')
      return
    }
    if (mode === 'signup') {
      if (signupStatus.state === 'bad') { setError(signupStatus.reason); return }
      if (passwordScore(password) === 0) { setError('Use at least 8 characters for the password.'); return }
      if (password !== confirm) { setError('The passwords don’t match.'); return }
    }
    setLoading(true)
    try {
      if (mode === 'signup') {
        await signupWithPassword(name, password, displayName.trim() || undefined)
      } else {
        await loginWithPassword(name, password, otp.trim() || undefined)
      }
      onClose()
    } catch (err) {
      const msg = errorMessage(err, 'Something went wrong. Try again.')
      if (mode === 'login' && /otp/i.test(msg)) {
        // First pass has no code, so this just means "step 2"; a rejected code is a real error.
        setError(otp.trim() ? 'That code was not accepted. Try again.' : null)
        setStep('otp')
        setOtp('')
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  const busy = loading || discordBusy || passkeyBusy
  const title = step === 'otp' ? 'Two-factor check'
    : step === 'finish' ? 'One more thing'
      : mode === 'signup' ? 'Create your account' : 'Welcome back'
  const subtitle = step === 'otp' ? null
    : step === 'finish' ? null
      : mode === 'signup'
        ? 'Liked songs and playlists that follow you to every device.'
        : 'Sign in to sync your likes, playlists and settings.'

  return (
    <ModalOverlay
      onClose={onClose}
      standalone
      zIndexClassName="z-50"
      panelClassName="bg-surface border border-[var(--border)] rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-sm"
      minWidth={340} minHeight={300}
    >
      {() => (
      // Bottom sheet on a phone, centered dialog from md up.
      <div
        className="bg-surface w-full h-full overflow-y-auto"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            <h2 className="text-text-primary text-lg font-bold leading-tight">{title}</h2>
            {subtitle && <p className="text-xs text-text-muted mt-1 leading-relaxed">{subtitle}</p>}
          </div>
          <button onClick={onClose} title="Close" aria-label="Close" className="shrink-0 -mr-1 p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-[var(--surface-raised)] transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 pt-4 pb-5 space-y-3">
          {step === 'form' && (
            <div role="tablist" className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[var(--surface-muted,rgba(255,255,255,0.05))] border border-[var(--border)]">
              {(['login', 'signup'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => switchMode(m)}
                  disabled={busy}
                  className={`py-1.5 rounded-lg text-xs font-semibold transition-colors ${mode === m ? 'bg-[var(--surface-raised)] text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}
                >
                  {m === 'login' ? 'Log in' : 'Sign up'}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div role="alert" className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
              <AlertCircle size={13} className="shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {step === 'form' && (<>
            <button
              onClick={() => void startDiscord()}
              disabled={busy}
              className="w-full py-2.5 rounded-xl bg-[#5865F2] hover:bg-[#4752c4] text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {discordBusy ? <Loader2 size={16} className="animate-spin" /> : <DiscordGlyph />}
              Continue with Discord
            </button>
            {mode === 'login' && passkeyReady && (
              <button onClick={() => void startPasskey()} disabled={busy} className={secondaryBtn}>
                {passkeyBusy ? <Loader2 size={16} className="animate-spin" /> : <Fingerprint size={17} />}
                Sign in with a passkey
              </button>
            )}

            <div className="flex items-center gap-3 text-[10px] uppercase tracking-wide text-text-muted pt-1">
              <span className="h-px flex-1 bg-[var(--border)]" />
              or with a username
              <span className="h-px flex-1 bg-[var(--border)]" />
            </div>

            <form onSubmit={submitPassword} className="space-y-2.5">
              {mode === 'signup' ? (<>
                <UsernameField value={username} onChange={setUsername} status={signupStatus} disabled={loading} />
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Display name (optional)"
                  autoComplete="nickname"
                  maxLength={50}
                  disabled={loading}
                  className={FIELD_CLASS}
                />
                <PasswordField value={password} onChange={setPassword} autoComplete="new-password" disabled={loading} showStrength />
                <PasswordField value={confirm} onChange={setConfirm} placeholder="Confirm password" autoComplete="new-password" disabled={loading} />
                {confirm && confirm !== password && <p className="text-[11px] text-red-400 px-0.5 -mt-1">The passwords don’t match.</p>}
              </>) : (<>
                <UsernameField value={username} onChange={setUsername} disabled={loading} />
                <PasswordField value={password} onChange={setPassword} autoComplete="current-password" disabled={loading} />
              </>)}
              <button type="submit" disabled={busy || (mode === 'signup' && signupStatus.state === 'checking')} className={primaryBtn}>
                {loading && <Loader2 size={16} className="animate-spin" />}
                {mode === 'signup' ? 'Create account' : 'Log in'}
              </button>
            </form>

            <p className="text-[11px] text-text-muted leading-relaxed text-center">
              {mode === 'signup'
                ? 'Usernames are 3–30 letters, numbers, dots, dashes or underscores.'
                : 'Joined with Discord? Add a username and password in Settings → Account to sign in either way.'}
            </p>
          </>)}

          {step === 'otp' && (
            <form onSubmit={submitPassword} className="space-y-2.5">
              <p className="text-xs text-text-secondary">
                Two-factor is on for <span className="text-text-primary font-medium">{username.trim()}</span>.
                Choose how to verify.
              </p>
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[var(--surface-muted,rgba(255,255,255,0.05))]">
                {(['code', 'device'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { stopPolling(); setApproval(null); setError(null); setOtpMethod(m) }}
                    className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${otpMethod === m ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'}`}
                  >
                    {m === 'code' ? 'Authenticator code' : 'Approve on device'}
                  </button>
                ))}
              </div>
              {otpMethod === 'code' ? (
                <input
                  type="text"
                  inputMode="numeric"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="6-digit code"
                  autoComplete="one-time-code"
                  maxLength={8}
                  autoFocus
                  disabled={loading}
                  className={`${FIELD_CLASS} text-center tracking-[0.3em]`}
                />
              ) : approval ? (
                <div className="text-center space-y-2 py-1">
                  <p className="text-xs text-text-secondary">
                    Open Unreleased on a device you&apos;re signed in to and approve this login. It should show:
                  </p>
                  <div className="text-4xl font-bold tracking-widest text-text-primary">{approval.code}</div>
                  <div className="flex items-center justify-center gap-2 text-xs text-text-muted">
                    <Loader2 size={13} className="animate-spin" /> Waiting for approval
                  </div>
                </div>
              ) : (
                <p className="text-xs text-text-muted">
                  We&apos;ll send a request to your other signed-in devices. Approve it there to finish logging in.
                </p>
              )}
              <button
                type={otpMethod === 'device' ? 'button' : 'submit'}
                onClick={otpMethod === 'device' ? requestApproval : undefined}
                disabled={loading || (otpMethod === 'device' && !!approval)}
                className={primaryBtn}
              >
                {loading && <Loader2 size={16} className="animate-spin" />}
                {otpMethod === 'device' ? (approval ? 'Waiting…' : 'Send request') : 'Verify'}
              </button>
              {/* A passkey counts as two-factor on the server, so it skips this step. */}
              {passkeyReady && (
                <button type="button" onClick={() => void startPasskey()} disabled={loading || passkeyBusy} className={secondaryBtn}>
                  {passkeyBusy ? <Loader2 size={16} className="animate-spin" /> : <Fingerprint size={17} />}
                  Use a passkey instead
                </button>
              )}
              <button type="button" onClick={resetOtp} className="w-full text-xs text-text-muted hover:text-text-primary transition-colors">
                Back
              </button>
            </form>
          )}

          {step === 'finish' && <FinishStep onClose={onClose} />}
        </div>
      </div>
      )}
    </ModalOverlay>
  )
}

/** Shown once after a Discord sign-in: pick a username and password to sign in without Discord too. */
function FinishStep({ onClose }: { onClose: () => void }): JSX.Element {
  const account = useStore((s) => s.account)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set when an earlier try saved the username and then failed on the password.
  const savedName = account?.username_chosen ? account.username : undefined
  const keepsSaved = !!savedName && name.trim() === savedName
  const status = useUsernameStatus(keepsSaved ? '' : name)
  const ready = (keepsSaved || status.state === 'ok') && passwordScore(password) > 0 && password === confirm

  const skip = (): void => {
    if (account) dismissOffer(account.id)
    onClose()
  }

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      if (!keepsSaved) useStore.setState({ account: await userApi.changeUsername(name.trim()) })
      const res = await userApi.changePassword({ new_password: password })
      useStore.setState({ account: res.user })
      if (account) dismissOffer(account.id)
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Could not save. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-2.5">
      <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-text-secondary">
        <Check size={14} className="text-emerald-500 shrink-0 mt-px" />
        <span>
          Signed in as <span className="text-text-primary font-medium">{accountDisplayName(account, 'you')}</span>.
          Add a username and password to sign in without Discord too. You can do this later in Settings → Account.
        </span>
      </div>
      {error && (
        <div role="alert" className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}
      <UsernameField value={name} onChange={setName} status={status} disabled={busy} autoFocus placeholder="Choose a username" />
      <PasswordField value={password} onChange={setPassword} autoComplete="new-password" disabled={busy} showStrength />
      <PasswordField value={confirm} onChange={setConfirm} placeholder="Confirm password" autoComplete="new-password" disabled={busy} />
      {confirm && confirm !== password && <p className="text-[11px] text-red-400 px-0.5 -mt-1">The passwords don’t match.</p>}
      <p className="text-[11px] text-text-muted px-0.5">A username can change once every 14 days.</p>
      <button type="submit" disabled={busy || !ready} className={primaryBtn}>
        {busy && <Loader2 size={16} className="animate-spin" />}
        Save
      </button>
      <button type="button" onClick={skip} disabled={busy} className="w-full text-xs text-text-muted hover:text-text-primary transition-colors">
        Not now
      </button>
    </form>
  )
}
