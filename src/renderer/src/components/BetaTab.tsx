import { useCallback, useRef, useState } from 'react'
import { AlertCircle, Check, Copy, KeyRound, Loader2, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
import { useStrictModeSafeEffect } from '../hooks/useStrictModeSafeEffect'
import { copyText } from '../lib/clipboard'
import * as betaAdminApi from '../lib/betaAdminApi'
import type { BetaCode, BetaVersion } from '../lib/betaAdminApi'
import { errorMessage } from '../lib/format'
import { shortDate, Empty } from './adminShared'

// Admin tab for beta gating (/beta/admin/): publish installer builds that
// code holders see in the installer's version picker, and hand out / revoke
// the access codes. Same records as Django Admin's beta section.
export default function BetaTab(): JSX.Element {
  const [codes, setCodes] = useState<BetaCode[]>([])
  const [versions, setVersions] = useState<BetaVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.all([betaAdminApi.fetchBetaCodes(), betaAdminApi.fetchBetaVersions()])
      .then(([c, v]) => { setCodes(c); setVersions(v) })
      .catch(e => setError(errorMessage(e, 'Could not load beta data')))
      .finally(() => setLoading(false))
  }, [])
  useStrictModeSafeEffect(() => { load() }, [load])

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl space-y-8">
        <div className="flex items-center gap-2">
          <p className="flex-1 text-xs text-text-muted">
            Builds are offered to anyone with a live code, in the installer&apos;s version picker. Turning a build or code off hides it without deleting it.
          </p>
          <button onClick={load} disabled={loading} title="Refresh"
            className="shrink-0 p-1.5 rounded-lg text-accent hover:bg-surface-overlay transition-colors disabled:opacity-40">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
            <AlertCircle size={13} className="shrink-0 mt-0.5" /> {error}
          </div>
        )}

        <BuildsSection versions={versions} setVersions={setVersions} loading={loading} />
        <CodesSection codes={codes} setCodes={setCodes} loading={loading} />
      </div>
    </div>
  )
}

const field = 'w-full h-8 rounded-lg bg-surface-raised border border-[var(--border)] px-3 text-xs text-text-primary outline-none focus:border-accent'
const sectionTitle = 'text-[10px] font-bold uppercase tracking-widest text-text-muted'

function Toggle({ on, busy, onChange, label }: { on: boolean; busy: boolean; onChange: (v: boolean) => void; label: string }): JSX.Element {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer shrink-0" title={label}>
      {busy ? <Loader2 size={12} className="animate-spin" /> : (
        <input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)} className="w-3.5 h-3.5 accent-[var(--accent)]" />
      )}
      {on ? 'Active' : 'Off'}
    </label>
  )
}

// ── Builds ────────────────────────────────────────────────────────────────────

function BuildsSection({ versions, setVersions, loading }: {
  versions: BetaVersion[]
  setVersions: React.Dispatch<React.SetStateAction<BetaVersion[]>>
  loading: boolean
}): JSX.Element {
  const [version, setVersion] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [rowBusy, setRowBusy] = useState<number | null>(null)

  // The installer and updater key off the bare semver; a leading "v" here
  // would make download?version= miss.
  const cleanVersion = version.trim().replace(/^v/i, '')
  const canSubmit = !busy && cleanVersion.length > 0 && !!file

  const onPickFile = (f: File | null): void => {
    setFile(f)
    // Unreleased-Setup-2.4.0-beta.1.exe -> 2.4.0-beta.1
    const m = f?.name.match(/Setup[-.](.+)\.exe$/i)
    if (m && !version.trim()) setVersion(m[1])
  }

  const submit = async (): Promise<void> => {
    if (!canSubmit || !file) return
    setBusy(true); setMsg(null); setProgress(0)
    try {
      const v = await betaAdminApi.createBetaVersion({
        version: cleanVersion,
        notes: notes.trim(),
        is_active: true,
        published_at: new Date().toISOString(),
      }, file, setProgress)
      setVersions(prev => [v, ...prev])
      setMsg({ ok: true, text: `Published ${v.version}` })
      setVersion(''); setNotes(''); setFile(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e, 'Upload failed') })
    } finally { setBusy(false) }
  }

  const patch = async (v: BetaVersion, body: betaAdminApi.BetaVersionInput): Promise<void> => {
    setRowBusy(v.id)
    try {
      const updated = await betaAdminApi.updateBetaVersion(v.id, body)
      setVersions(prev => prev.map(x => x.id === v.id ? updated : x))
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e, 'Update failed') })
    } finally { setRowBusy(null) }
  }

  const remove = async (v: BetaVersion): Promise<void> => {
    if (!confirm(`Delete beta ${v.version}? Code holders can no longer download it.`)) return
    setRowBusy(v.id)
    try {
      await betaAdminApi.deleteBetaVersion(v.id)
      setVersions(prev => prev.filter(x => x.id !== v.id))
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e, 'Delete failed') })
    } finally { setRowBusy(null) }
  }

  return (
    <section className="space-y-3">
      <p className={sectionTitle}>Builds</p>

      <div className="rounded-xl border border-[var(--border)] p-3 space-y-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-text-primary"><Upload size={13} className="text-text-muted" /> Publish a build</p>
        <input ref={fileRef} type="file" accept=".exe" onChange={e => onPickFile(e.target.files?.[0] ?? null)}
          className="block w-full text-xs text-text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-surface-raised file:px-3 file:py-1.5 file:text-xs file:text-text-primary" />
        <input value={version} onChange={e => setVersion(e.target.value)} placeholder="Version (2.4.0-beta.1)" className={field} />
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Release notes (optional)" rows={3}
          className="w-full rounded-lg bg-surface-raised border border-[var(--border)] px-3 py-2 text-xs text-text-primary outline-none focus:border-accent resize-none" />
        <div className="flex items-center gap-3">
          <button onClick={submit} disabled={!canSubmit}
            className="flex items-center gap-1.5 rounded-lg bg-accent text-white font-medium px-3 py-1.5 text-xs disabled:opacity-40">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {busy ? (progress >= 1 ? 'Processing…' : `Uploading ${Math.round(progress * 100)}%`) : 'Publish'}
          </button>
          {cleanVersion && !cleanVersion.includes('-') && (
            <span className="text-[11px] text-amber-400">No pre-release suffix: the installer only treats tags with a &quot;-&quot; as beta.</span>
          )}
          {msg && (
            <span className={`flex items-center gap-1.5 text-xs ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {msg.ok ? <Check size={12} /> : <AlertCircle size={12} />} {msg.text}
            </span>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        {versions.length === 0 && !loading && <Empty label="No beta builds" />}
        {versions.map(v => (
          <div key={v.id} className={`px-3 py-2.5 border-b border-[var(--border)] last:border-b-0 ${v.is_active ? '' : 'opacity-60'}`}>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs font-semibold text-text-primary">{v.version}</span>
              <span className="text-[11px] text-text-muted truncate flex-1 min-w-0">
                {shortDate(v.published_at ?? v.created_at)} · <span className="font-mono">{v.file_path}</span>
              </span>
              <Toggle on={v.is_active} busy={rowBusy === v.id} label="Offer this build to code holders"
                onChange={on => patch(v, { is_active: on })} />
              <button onClick={() => remove(v)} disabled={rowBusy === v.id} title="Delete build"
                className="p-1 rounded text-text-muted hover:text-red-400 transition-colors disabled:opacity-40">
                <Trash2 size={13} />
              </button>
            </div>
            {v.notes && <p className="mt-1 text-[11px] text-text-muted whitespace-pre-wrap line-clamp-3">{v.notes}</p>}
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Codes ─────────────────────────────────────────────────────────────────────

function CodesSection({ codes, setCodes, loading }: {
  codes: BetaCode[]
  setCodes: React.Dispatch<React.SetStateAction<BetaCode[]>>
  loading: boolean
}): JSX.Element {
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('')
  const [expires, setExpires] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [rowBusy, setRowBusy] = useState<number | null>(null)
  const [copied, setCopied] = useState<number | null>(null)

  const generate = (): void => {
    const bytes = crypto.getRandomValues(new Uint8Array(9))
    setCode(btoa(String.fromCharCode(...bytes)).replace(/\+/g, 'a').replace(/\//g, 'b'))
  }

  const create = async (): Promise<void> => {
    if (!code.trim()) return
    setBusy(true); setMsg(null)
    try {
      const c = await betaAdminApi.createBetaCode({
        code: code.trim(),
        label: label.trim(),
        // Date input is a local calendar day; expire at the end of it.
        expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
      })
      setCodes(prev => [c, ...prev])
      setMsg({ ok: true, text: `Created ${c.code}` })
      setCode(''); setLabel(''); setExpires('')
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e, 'Could not create code') })
    } finally { setBusy(false) }
  }

  const patch = async (c: BetaCode, body: betaAdminApi.BetaCodeInput): Promise<void> => {
    setRowBusy(c.id)
    try {
      const updated = await betaAdminApi.updateBetaCode(c.id, body)
      setCodes(prev => prev.map(x => x.id === c.id ? updated : x))
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e, 'Update failed') })
    } finally { setRowBusy(null) }
  }

  const remove = async (c: BetaCode): Promise<void> => {
    if (!confirm(`Delete code ${c.code}? Anyone using it loses beta access. Turning it off does the same but keeps the record.`)) return
    setRowBusy(c.id)
    try {
      await betaAdminApi.deleteBetaCode(c.id)
      setCodes(prev => prev.filter(x => x.id !== c.id))
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e, 'Delete failed') })
    } finally { setRowBusy(null) }
  }

  const copy = (c: BetaCode): void => {
    copyText(c.code).then(() => {
      setCopied(c.id)
      setTimeout(() => setCopied(id => id === c.id ? null : id), 1500)
    }).catch(() => {})
  }

  return (
    <section className="space-y-3">
      <p className={sectionTitle}>Access codes</p>

      <div className="rounded-xl border border-[var(--border)] p-3 space-y-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-text-primary"><KeyRound size={13} className="text-text-muted" /> New code</p>
        <div className="grid grid-cols-3 gap-2">
          <div className="flex gap-1">
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="Code" maxLength={64} className={`${field} font-mono`} />
            <button onClick={generate} title="Generate a random code"
              className="shrink-0 px-2 rounded-lg bg-surface-raised border border-[var(--border)] text-[11px] text-text-muted hover:text-text-primary">Gen</button>
          </div>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (who it's for)" className={field} />
          <input type="date" value={expires} onChange={e => setExpires(e.target.value)} title="Expires after this day (optional)" className={field} />
        </div>
        <div className="flex items-center gap-3">
          <button onClick={create} disabled={busy || !code.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-accent text-white font-medium px-3 py-1.5 text-xs disabled:opacity-40">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Create
          </button>
          {msg && (
            <span className={`flex items-center gap-1.5 text-xs ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {msg.ok ? <Check size={12} /> : <AlertCircle size={12} />} {msg.text}
            </span>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        {codes.length === 0 && !loading && <Empty label="No codes" />}
        {codes.map(c => {
          const live = c.is_valid
          const expired = c.is_active && !live
          return (
            <div key={c.id} className={`flex items-center gap-3 px-3 py-2.5 border-b border-[var(--border)] last:border-b-0 ${live ? '' : 'opacity-60'}`}>
              <button onClick={() => copy(c)} title="Copy code"
                className="flex items-center gap-1.5 font-mono text-xs text-text-primary hover:text-accent transition-colors min-w-0">
                <span className="truncate">{c.code}</span>
                {copied === c.id ? <Check size={11} className="text-emerald-400 shrink-0" /> : <Copy size={11} className="text-text-muted shrink-0" />}
              </button>
              <span className="flex-1 min-w-0 truncate text-[11px] text-text-muted">
                {c.label || <span className="italic">no label</span>}
                {' · '}
                {c.expires_at
                  ? <span className={expired ? 'text-red-400' : ''}>{expired ? 'expired' : 'expires'} {shortDate(c.expires_at)}</span>
                  : 'no expiry'}
              </span>
              <Toggle on={c.is_active} busy={rowBusy === c.id} label="Code can unlock beta access"
                onChange={on => patch(c, { is_active: on })} />
              <button onClick={() => remove(c)} disabled={rowBusy === c.id} title="Delete code"
                className="p-1 rounded text-text-muted hover:text-red-400 transition-colors disabled:opacity-40">
                <Trash2 size={13} />
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}
