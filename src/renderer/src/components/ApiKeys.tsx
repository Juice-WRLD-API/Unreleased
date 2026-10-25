import { useCallback, useEffect, useState } from 'react'
import { Ban, Check, Copy, KeyRound, Loader2, Pencil, Plus, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react'
import {
  API_KEY_LIMIT, API_KEY_SCOPES, createApiKey, deleteApiKey, isManagerAnywhere, listApiKeys, updateApiKey,
  type ApiKeyScope, type UserApiKey, type UserApiKeyCreated,
} from '../lib/userApi'
import { errorMessage } from '../lib/format'
import { relativeTime } from './adminShared'
import { useStore } from '../store/useStore'
import ThemedCheckbox from './ThemedCheckbox'

const SCOPE_HINT: Record<ApiKeyScope, string> = {
  read: 'GET requests only',
  write: 'Also create, edit and delete outside admin routes',
  admin: 'Also admin routes your role can use',
}

const inputCls = 'min-w-0 flex-1 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50'
const iconBtn = 'w-7 h-7 rounded-lg flex items-center justify-center text-text-secondary hover:bg-[var(--surface-overlay)] hover:text-text-primary disabled:opacity-40'

// `admin` is only offered to accounts that can reach admin routes at all
// (administrators and managers). A key that already has it still shows it, so
// it can be taken off.
function ScopePicker({ value, onChange, staff }: { value: ApiKeyScope[]; onChange: (next: ApiKeyScope[]) => void; staff: boolean }): JSX.Element {
  const offered = API_KEY_SCOPES.filter((s) => s !== 'admin' || staff || value.includes('admin'))
  const toggle = (s: ApiKeyScope): void =>
    onChange(value.includes(s) ? value.filter((x) => x !== s) : API_KEY_SCOPES.filter((x) => x === s || value.includes(x)))
  return (
    <div className="space-y-1">
      {offered.map((s) => (
        <label key={s} className="flex items-start gap-2 cursor-pointer select-none">
          <ThemedCheckbox checked={value.includes(s)} onChange={() => toggle(s)} className="mt-0.5" />
          <span className="text-xs">
            <span className="text-text-primary font-semibold">{s}</span>
            <span className="text-text-muted"> · {SCOPE_HINT[s]}</span>
          </span>
        </label>
      ))}
      {value.includes('admin') && (
        <p className="flex items-start gap-1.5 text-amber-400 text-[11px] pt-0.5">
          <ShieldAlert size={12} className="shrink-0 mt-px" />
          Anyone holding an admin key can do everything your staff role can. Only give it to tools you trust.
        </p>
      )}
    </div>
  )
}

function ScopeBadges({ scopes }: { scopes: ApiKeyScope[] }): JSX.Element {
  return (
    <>
      {scopes.map((s) => (
        <span key={s} className={`text-[10px] font-semibold uppercase tracking-wide rounded px-1 ${s === 'admin' ? 'bg-amber-500/15 text-amber-400' : 'bg-accent/15 text-accent'}`}>{s}</span>
      ))}
    </>
  )
}

// The one-time reveal of a new key's secret. The server never returns it again,
// so this stays up (and a tab close asks first) until the user says it's saved.
function NewKeyReveal({ created, onDone }: { created: UserApiKeyCreated; onDone: () => void }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const [stored, setStored] = useState(false)

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent): void => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  const copy = (): void => {
    void navigator.clipboard.writeText(created.key).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 mb-2">
      <p className="text-text-primary text-sm font-semibold">“{created.name}” created</p>
      <p className="text-amber-400 text-[11px] mb-2">{created.message || 'Store this API key now. It will not be shown again.'}</p>
      <button
        onClick={copy}
        className="flex items-center gap-2 w-full px-2.5 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--surface-raised)] transition-colors group"
        title="Click to copy"
      >
        <code className="flex-1 text-left text-[11px] font-mono text-text-primary break-all">{created.key}</code>
        <span className={`shrink-0 flex items-center gap-1 text-[10px] font-medium ${copied ? 'text-emerald-500' : 'text-text-muted group-hover:text-text-primary'}`}>
          {copied ? 'Copied!' : <><Copy size={11} /> Copy</>}
        </span>
      </button>
      <div className="flex items-center justify-between gap-3 pt-2">
        <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
          <ThemedCheckbox checked={stored} onChange={setStored} />
          I’ve stored this key somewhere safe
        </label>
        <button
          onClick={onDone}
          disabled={!stored}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          Done
        </button>
      </div>
    </div>
  )
}

// Settings > Account: the account's API keys. Keys are listed by prefix only;
// the full secret exists client-side just once, in NewKeyReveal above.
export default function ApiKeys(): JSX.Element {
  const staff = useStore((s) => !!s.account && (s.account.is_administrator || isManagerAnywhere(s.account)))
  const [keys, setKeys] = useState<UserApiKey[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ name: string; scopes: ApiKeyScope[] } | null>(null)
  const [created, setCreated] = useState<UserApiKeyCreated | null>(null)
  const [editing, setEditing] = useState<{ id: string; name: string; scopes: ApiKeyScope[] } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setKeys(await listApiKeys())
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Could not load your API keys'))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const replace = (k: UserApiKey): void => setKeys((prev) => prev?.map((x) => (x.id === k.id ? k : x)) ?? prev)

  const create = async (): Promise<void> => {
    if (!draft) return
    const name = draft.name.trim()
    if (!name) { setError('Give the key a name'); return }
    if (draft.scopes.length === 0) { setError('Pick at least one scope'); return }
    setBusy('new')
    try {
      const res = await createApiKey(name, draft.scopes)
      const summary: UserApiKey = {
        id: res.id, name: res.name, key_prefix: res.key_prefix, scopes: res.scopes,
        is_active: res.is_active, last_used_at: res.last_used_at, created_at: res.created_at,
      }
      setKeys((prev) => [summary, ...(prev ?? [])])
      setCreated(res)
      setDraft(null)
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Could not create the key'))
    } finally {
      setBusy(null)
    }
  }

  const saveEdit = async (): Promise<void> => {
    if (!editing) return
    const name = editing.name.trim()
    if (!name) { setError('Give the key a name'); return }
    if (editing.scopes.length === 0) { setError('Pick at least one scope'); return }
    setBusy(editing.id)
    try {
      replace(await updateApiKey(editing.id, { name, scopes: editing.scopes }))
      setEditing(null)
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Could not save the key'))
    } finally {
      setBusy(null)
    }
  }

  const setActive = async (k: UserApiKey, active: boolean): Promise<void> => {
    setBusy(k.id)
    try {
      replace(await updateApiKey(k.id, { is_active: active }))
      setError(null)
    } catch (err) {
      setError(errorMessage(err, active ? 'Could not restore the key' : 'Could not revoke the key'))
    } finally {
      setBusy(null)
    }
  }

  const remove = async (k: UserApiKey): Promise<void> => {
    setBusy(k.id)
    try {
      await deleteApiKey(k.id)
      setKeys((prev) => prev?.filter((x) => x.id !== k.id) ?? prev)
      setConfirmDelete(null)
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Could not delete the key'))
    } finally {
      setBusy(null)
    }
  }

  if (!keys) {
    return error
      ? <p className="text-red-400 text-[11px] py-2">{error}</p>
      : <div className="flex items-center gap-2 py-3 text-text-muted text-xs"><Loader2 size={13} className="animate-spin" />Loading API keys…</div>
  }

  const atLimit = keys.length >= API_KEY_LIMIT

  return (
    <div>
      {created && <NewKeyReveal created={created} onDone={() => setCreated(null)} />}

      {keys.length === 0 && !draft && <p className="text-text-muted text-xs py-3">No API keys yet.</p>}
      {keys.map((k) => (
        <div key={k.id} className="py-3 border-b border-[var(--border)] last:border-b-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${k.is_active ? 'bg-[#7c3aed]' : 'bg-[#475569]'}`}>
                <KeyRound size={13} className="text-white" strokeWidth={2.25} />
              </div>
              <div className="min-w-0">
                <p className="text-sm truncate flex items-center gap-1.5">
                  <span className={`truncate ${k.is_active ? 'text-text-primary' : 'text-text-muted line-through'}`}>{k.name}</span>
                  <ScopeBadges scopes={k.scopes} />
                  {!k.is_active && <span className="text-[10px] font-semibold uppercase tracking-wide text-red-400">Revoked</span>}
                </p>
                <p className="text-text-muted text-[11px] truncate">
                  <code className="font-mono">{k.key_prefix}…</code>
                  {' · '}created {relativeTime(k.created_at)}
                  {' · '}{k.last_used_at ? `last used ${relativeTime(k.last_used_at)}` : 'never used'}
                </p>
              </div>
            </div>
            {confirmDelete === k.id ? (
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-text-muted">Delete for good?</span>
                <button onClick={() => setConfirmDelete(null)} className="text-xs text-text-muted hover:text-text-primary">Cancel</button>
                <button
                  onClick={() => void remove(k)}
                  disabled={busy === k.id}
                  className="inline-flex items-center gap-1 rounded-lg bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-400 hover:bg-red-500/25 disabled:opacity-60"
                >
                  {busy === k.id && <Loader2 size={11} className="animate-spin" />}Delete
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-0.5 shrink-0">
                {busy === k.id && <Loader2 size={13} className="animate-spin text-text-muted mr-1" />}
                <button onClick={() => setEditing({ id: k.id, name: k.name, scopes: k.scopes })} disabled={busy === k.id} title="Edit" aria-label="Edit" className={iconBtn}>
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() => void setActive(k, !k.is_active)}
                  disabled={busy === k.id}
                  title={k.is_active ? 'Revoke (keeps it listed, stops it working)' : 'Restore'}
                  aria-label={k.is_active ? 'Revoke' : 'Restore'}
                  className={iconBtn}
                >
                  {k.is_active ? <Ban size={15} /> : <RotateCcw size={15} />}
                </button>
                <button onClick={() => setConfirmDelete(k.id)} disabled={busy === k.id} title="Delete" aria-label="Delete" className={`${iconBtn} hover:!text-red-400`}>
                  <Trash2 size={15} />
                </button>
              </div>
            )}
          </div>
          {editing?.id === k.id && (
            <div className="pl-8 pt-2 space-y-2">
              <input
                value={editing.name}
                maxLength={100}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') void saveEdit(); if (e.key === 'Escape') setEditing(null) }}
                aria-label="Key name"
                className={`${inputCls} w-full`}
              />
              <ScopePicker value={editing.scopes} onChange={(scopes) => setEditing({ ...editing, scopes })} staff={staff} />
              <div className="flex items-center gap-2">
                <button onClick={() => setEditing(null)} className="text-xs text-text-muted hover:text-text-primary">Cancel</button>
                <button onClick={() => void saveEdit()} disabled={busy === k.id} className="rounded-lg bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent disabled:opacity-60">Save</button>
              </div>
            </div>
          )}
        </div>
      ))}

      {draft ? (
        <div className="mt-2 rounded-xl border border-[var(--border)] p-3 space-y-2">
          <input
            autoFocus
            value={draft.name}
            maxLength={100}
            placeholder="Name, e.g. Discord bot"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') void create(); if (e.key === 'Escape') setDraft(null) }}
            aria-label="Key name"
            className={`${inputCls} w-full`}
          />
          <ScopePicker value={draft.scopes} onChange={(scopes) => setDraft({ ...draft, scopes })} staff={staff} />
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setDraft(null)} className="text-xs text-text-muted hover:text-text-primary">Cancel</button>
            <button
              onClick={() => void create()}
              disabled={busy === 'new'}
              className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {busy === 'new' ? <Loader2 size={11} className="animate-spin" /> : <Check size={12} />}Create key
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => { setDraft({ name: '', scopes: ['read'] }); setError(null) }}
          disabled={atLimit || !!created}
          title={atLimit ? `Maximum of ${API_KEY_LIMIT} API keys` : undefined}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary disabled:opacity-40"
        >
          <Plus size={13} />New API key
        </button>
      )}

      <p className="text-text-muted text-[11px] pt-2">
        Keys let scripts and integrations call the API as you. Send one as <code className="font-mono">X-API-Key: jwapi_…</code> or{' '}
        <code className="font-mono">Authorization: ApiKey jwapi_…</code>. A key never gives more access than your account has.
        Revoking stops a key working but keeps it listed; deleting removes it. Up to {API_KEY_LIMIT} keys.
      </p>
      {error && <p className="text-red-400 text-[11px] pt-1">{error}</p>}
    </div>
  )
}
