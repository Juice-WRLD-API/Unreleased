import { useCallback, useEffect, useState } from 'react'
import { Check, Fingerprint, Info, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  PASSKEY_LIMIT, addPasskey, deletePasskey, getPasskeySupport, listPasskeys, renamePasskey,
  type Passkey, type PasskeySupport,
} from '../lib/passkeyApi'
import { errorMessage } from '../lib/format'
import { relativeTime } from './adminShared'

const inputCls = 'min-w-0 flex-1 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50'
const iconBtn = 'w-7 h-7 rounded-lg flex items-center justify-center text-text-secondary hover:bg-[var(--surface-overlay)] hover:text-text-primary disabled:opacity-40'

const TRANSPORT_LABEL: Record<string, string> = {
  internal: 'this device', hybrid: 'phone', usb: 'security key', nfc: 'NFC', ble: 'Bluetooth',
}

function where(p: Passkey): string {
  const labels = p.transports.map((t) => TRANSPORT_LABEL[t]).filter(Boolean)
  return labels.length ? labels.join(', ') : 'passkey'
}

// Settings > Account: the account's passkeys. Listing, renaming and removing
// work everywhere; adding one needs the prompt, which only the website and the
// Windows desktop app can show (see lib/passkeyApi.ts).
export default function Passkeys(): JSX.Element {
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null)
  const [support, setSupport] = useState<PasskeySupport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setPasskeys(await listPasskeys())
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Could not load your passkeys'))
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    let alive = true
    void getPasskeySupport().then((s) => { if (alive) setSupport(s) })
    return () => { alive = false }
  }, [])

  const add = async (): Promise<void> => {
    if (draft == null) return
    setBusy('new')
    setError(null)
    try {
      const created = await addPasskey(draft)
      if (created) {
        setPasskeys((prev) => [created, ...(prev ?? []).filter((p) => p.id !== created.id)])
        setDraft(null)
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not add the passkey'))
    } finally {
      setBusy(null)
    }
  }

  // Renames show at once and roll back if the server says no.
  const saveName = async (): Promise<void> => {
    if (!editing) return
    const name = editing.name.trim()
    if (!name) { setError('Give the passkey a name'); return }
    const before = passkeys?.find((p) => p.id === editing.id)
    setEditing(null)
    if (!before || before.name === name) return
    setPasskeys((prev) => prev?.map((p) => (p.id === before.id ? { ...p, name } : p)) ?? prev)
    setError(null)
    try {
      const saved = await renamePasskey(before.id, name)
      setPasskeys((prev) => prev?.map((p) => (p.id === saved.id ? saved : p)) ?? prev)
    } catch (err) {
      setPasskeys((prev) => prev?.map((p) => (p.id === before.id ? before : p)) ?? prev)
      setError(errorMessage(err, 'Could not rename the passkey'))
    }
  }

  const remove = async (p: Passkey): Promise<void> => {
    setBusy(p.id)
    try {
      await deletePasskey(p.id)
      setPasskeys((prev) => prev?.filter((x) => x.id !== p.id) ?? prev)
      setConfirmDelete(null)
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Could not remove the passkey'))
    } finally {
      setBusy(null)
    }
  }

  if (!passkeys) {
    return error
      ? <p className="text-red-400 text-[11px] py-2">{error}</p>
      : <div className="flex items-center gap-2 py-3 text-text-muted text-xs"><Loader2 size={13} className="animate-spin" />Loading passkeys…</div>
  }

  const atLimit = passkeys.length >= PASSKEY_LIMIT
  const canAdd = !!support?.ceremonies

  return (
    <div>
      {passkeys.length === 0 && draft == null && <p className="text-text-muted text-xs py-3">No passkeys yet.</p>}
      {passkeys.map((p) => (
        <div key={p.id} className="py-3 border-b border-[var(--border)] last:border-b-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-[#0f766e]">
                <Fingerprint size={13} className="text-white" strokeWidth={2.25} />
              </div>
              {editing?.id === p.id ? (
                <input
                  autoFocus
                  value={editing.name}
                  maxLength={100}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') void saveName(); if (e.key === 'Escape') setEditing(null) }}
                  aria-label="Passkey name"
                  className={inputCls}
                />
              ) : (
                <div className="min-w-0">
                  <p className="text-sm truncate flex items-center gap-1.5">
                    <span className="truncate text-text-primary">{p.name}</span>
                    {p.backed_up && <span className="text-[10px] font-semibold uppercase tracking-wide rounded px-1 bg-accent/15 text-accent">Synced</span>}
                  </p>
                  <p className="text-text-muted text-[11px] truncate">
                    {where(p)}
                    {p.created_at && <>{' · '}added {relativeTime(p.created_at)}</>}
                    {' · '}{p.last_used_at ? `last used ${relativeTime(p.last_used_at)}` : 'never used'}
                  </p>
                </div>
              )}
            </div>
            {confirmDelete === p.id ? (
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-text-muted">Remove it?</span>
                <button onClick={() => setConfirmDelete(null)} className="text-xs text-text-muted hover:text-text-primary">Cancel</button>
                <button
                  onClick={() => void remove(p)}
                  disabled={busy === p.id}
                  className="inline-flex items-center gap-1 rounded-lg bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-400 hover:bg-red-500/25 disabled:opacity-60"
                >
                  {busy === p.id && <Loader2 size={11} className="animate-spin" />}Remove
                </button>
              </div>
            ) : editing?.id === p.id ? (
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => setEditing(null)} className="text-xs text-text-muted hover:text-text-primary">Cancel</button>
                <button onClick={() => void saveName()} className="rounded-lg bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent">Save</button>
              </div>
            ) : (
              <div className="flex items-center gap-0.5 shrink-0">
                <button onClick={() => setEditing({ id: p.id, name: p.name })} disabled={busy === p.id} title="Rename" aria-label="Rename" className={iconBtn}>
                  <Pencil size={15} />
                </button>
                <button onClick={() => setConfirmDelete(p.id)} disabled={busy === p.id} title="Remove" aria-label="Remove" className={`${iconBtn} hover:!text-red-400`}>
                  <Trash2 size={15} />
                </button>
              </div>
            )}
          </div>
          {confirmDelete === p.id && (
            <p className="pl-8 pt-1 text-[11px] text-text-muted">
              You won’t be able to sign in with it any more. Also delete it from the device or password manager that holds it.
            </p>
          )}
        </div>
      ))}

      {canAdd && (draft != null ? (
        <div className="mt-2 rounded-xl border border-[var(--border)] p-3 space-y-2">
          <input
            autoFocus
            value={draft}
            maxLength={100}
            placeholder="Name, e.g. Work laptop"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void add(); if (e.key === 'Escape') setDraft(null) }}
            aria-label="Passkey name"
            disabled={busy === 'new'}
            className={`${inputCls} w-full`}
          />
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setDraft(null)} disabled={busy === 'new'} className="text-xs text-text-muted hover:text-text-primary disabled:opacity-40">Cancel</button>
            <button
              onClick={() => void add()}
              disabled={busy === 'new'}
              className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {busy === 'new' ? <Loader2 size={11} className="animate-spin" /> : <Check size={12} />}Continue
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => { setDraft(''); setError(null) }}
          disabled={atLimit}
          title={atLimit ? `Maximum of ${PASSKEY_LIMIT} passkeys` : undefined}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary disabled:opacity-40"
        >
          <Plus size={13} />Add a passkey
        </button>
      ))}

      {support && !support.ceremonies && (
        <p className="flex items-start gap-1.5 text-text-muted text-[11px] pt-2">
          <Info size={12} className="shrink-0 mt-px" />
          <span>{support.reason} You can still rename or remove passkeys here.</span>
        </p>
      )}

      <p className="text-text-muted text-[11px] pt-2">
        A passkey signs you in with your face, fingerprint, PIN, a security key or your phone, without a password.
        It counts as two-factor, so you won’t be asked for a code. Up to {PASSKEY_LIMIT} passkeys.
      </p>
      {error && <p className="text-red-400 text-[11px] pt-1">{error}</p>}
    </div>
  )
}
