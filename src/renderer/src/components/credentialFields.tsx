// Username and password inputs shared by the sign-in dialog and Settings →
// Account → Sign-in: a live availability check on usernames, a show/hide
// toggle and a strength hint on new passwords.
import { useEffect, useState } from 'react'
import { Check, Eye, EyeOff, Loader2, X } from 'lucide-react'
import { checkUsername } from '../lib/userApi'

export const FIELD_CLASS =
  'w-full px-3 py-2.5 rounded-xl bg-[var(--surface-muted,rgba(255,255,255,0.05))] border border-[var(--border)] text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors disabled:opacity-60'

const USERNAME_RE = /^[A-Za-z0-9_.-]+$/

/** The same rules the server applies, checked locally so most mistakes show without a request. */
export function localUsernameProblem(name: string): string | null {
  if (name.length < 3) return 'At least 3 characters.'
  if (name.length > 30) return 'At most 30 characters.'
  if (!USERNAME_RE.test(name)) return 'Letters, numbers, dots, dashes and underscores only.'
  if (name.toLowerCase().startsWith('discord_')) return 'This username is not available.'
  return null
}

export type UsernameStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok' }
  | { state: 'bad'; reason: string }

/** Debounced availability for `name`. `current` is the account's own username, which is never "taken". */
export function useUsernameStatus(name: string, current?: string): UsernameStatus {
  const [status, setStatus] = useState<UsernameStatus>({ state: 'idle' })
  useEffect(() => {
    const trimmed = name.trim()
    if (!trimmed) { setStatus({ state: 'idle' }); return }
    if (current && trimmed === current) { setStatus({ state: 'bad', reason: 'That is already your username.' }); return }
    const local = localUsernameProblem(trimmed)
    if (local) { setStatus({ state: 'bad', reason: local }); return }
    // A case-only change of your own name is free on the server side too.
    if (current && trimmed.toLowerCase() === current.toLowerCase()) { setStatus({ state: 'ok' }); return }
    setStatus({ state: 'checking' })
    let alive = true
    const timer = window.setTimeout(() => {
      checkUsername(trimmed)
        .then((r) => { if (alive) setStatus(r.available ? { state: 'ok' } : { state: 'bad', reason: r.reason || 'Not available.' }) })
        // An older server without the check: let the submit decide.
        .catch(() => { if (alive) setStatus({ state: 'idle' }) })
    }, 350)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [name, current])
  return status
}

export function UsernameField({ value, onChange, status, disabled, autoFocus, placeholder = 'Username' }: {
  value: string
  onChange: (v: string) => void
  status?: UsernameStatus
  disabled?: boolean
  autoFocus?: boolean
  placeholder?: string
}): JSX.Element {
  return (
    <div>
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={30}
          autoFocus={autoFocus}
          disabled={disabled}
          aria-invalid={status?.state === 'bad'}
          className={`${FIELD_CLASS} pr-9`}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
          {status?.state === 'checking' && <Loader2 size={14} className="animate-spin text-text-muted" />}
          {status?.state === 'ok' && <Check size={14} className="text-emerald-500" />}
          {status?.state === 'bad' && <X size={14} className="text-red-400" />}
        </span>
      </div>
      {status?.state === 'bad' && <p className="text-[11px] text-red-400 mt-1 px-0.5">{status.reason}</p>}
    </div>
  )
}

/** 0 (too short) to 3 (strong). The server's validators have the last word. */
export function passwordScore(pw: string): 0 | 1 | 2 | 3 {
  if (pw.length < 8) return 0
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length
  if (/^\d+$/.test(pw)) return 1
  if (pw.length >= 14 || (pw.length >= 10 && kinds >= 3)) return 3
  if (pw.length >= 10 || kinds >= 2) return 2
  return 1
}

const SCORE_LABEL = ['Too short', 'Weak', 'Okay', 'Strong'] as const
const SCORE_COLOR = ['bg-red-500', 'bg-amber-500', 'bg-lime-500', 'bg-emerald-500'] as const

export function PasswordField({ value, onChange, placeholder = 'Password', autoComplete, disabled, autoFocus, showStrength }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoComplete: 'new-password' | 'current-password'
  disabled?: boolean
  autoFocus?: boolean
  showStrength?: boolean
}): JSX.Element {
  const [visible, setVisible] = useState(false)
  const score = passwordScore(value)
  return (
    <div>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
          className={`${FIELD_CLASS} pr-10`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          title={visible ? 'Hide password' : 'Show password'}
          aria-label={visible ? 'Hide password' : 'Show password'}
          tabIndex={-1}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-text-muted hover:text-text-primary transition-colors"
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
      {showStrength && value && (
        <div className="flex items-center gap-2 mt-1.5 px-0.5">
          <div className="flex-1 grid grid-cols-4 gap-1">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`h-1 rounded-full ${i <= score ? SCORE_COLOR[score] : 'bg-[var(--border)]'}`} />
            ))}
          </div>
          <span className="text-[11px] text-text-muted w-16 text-right">{SCORE_LABEL[score]}</span>
        </div>
      )}
    </div>
  )
}

export function DiscordGlyph({ size = 18 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3c-.2.36-.43.84-.59 1.23a18.27 18.27 0 0 0-3.94 0A8.26 8.26 0 0 0 11.43 3a19.74 19.74 0 0 0-3.76 1.37C3.39 8.6 2.71 12.72 3.04 16.78a19.9 19.9 0 0 0 5.99 3.04c.48-.66.91-1.36 1.28-2.1-.7-.26-1.37-.59-2-.98.17-.12.33-.25.49-.38 3.86 1.8 8.03 1.8 11.84 0 .16.14.32.26.49.38-.64.39-1.31.72-2.01.98.37.74.8 1.44 1.28 2.1a19.86 19.86 0 0 0 6-3.04c.39-4.71-.67-8.8-3.27-12.41ZM9.68 14.29c-1.16 0-2.11-1.06-2.11-2.37 0-1.3.93-2.37 2.11-2.37 1.19 0 2.14 1.07 2.12 2.37 0 1.31-.94 2.37-2.12 2.37Zm6.64 0c-1.16 0-2.11-1.06-2.11-2.37 0-1.3.93-2.37 2.11-2.37 1.19 0 2.14 1.07 2.12 2.37 0 1.31-.93 2.37-2.12 2.37Z" />
    </svg>
  )
}

/** "November 27" for the rename wait. */
export function formatChangeDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
}
