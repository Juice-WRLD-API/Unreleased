import { useCallback, useRef, useState } from 'react'
import { AlertCircle, Check, ChevronDown, Loader2, ShieldCheck, Upload } from 'lucide-react'
import { useStrictModeSafeEffect } from '../hooks/useStrictModeSafeEffect'
import { CDN_BINARY_PLATFORMS, fetchCdnBinaries, uploadCdnBinary, type CdnNodeBinary } from '../lib/cdnAdminApi'
import { errorMessage, formatBytes } from '../lib/format'
import { shortDate } from './adminShared'

// Admin panel for publishing jwa-cdn-node builds (POST /cdn/binary/). Shows the
// latest binary per platform and uploads a new platform+version. Shared by the
// desktop and mobile CDN nodes tabs; `compact` bumps touch-target sizing.
export default function CdnBinaryUpload({ compact = false }: { compact?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [binaries, setBinaries] = useState<CdnNodeBinary[]>([])
  const [platform, setPlatform] = useState<string>(CDN_BINARY_PLATFORMS[0])
  const [version, setVersion] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    fetchCdnBinaries().then(setBinaries).catch(() => {})
  }, [])
  useStrictModeSafeEffect(() => { load() }, [load])

  const canSubmit = !busy && !!file && version.trim().length > 0

  const submit = async (): Promise<void> => {
    if (!file || !canSubmit) return
    setBusy(true)
    setError(null)
    setDone(null)
    setProgress(0)
    try {
      const b = await uploadCdnBinary(platform, version.trim(), file, setProgress)
      setDone(`Uploaded ${b.platform} v${b.version}${b.signature ? ' (signed)' : ''}`)
      setFile(null)
      setVersion('')
      if (fileRef.current) fileRef.current.value = ''
      load()
    } catch (e) {
      setError(errorMessage(e, 'Upload failed'))
    } finally {
      setBusy(false)
    }
  }

  const field = `w-full rounded-lg bg-surface-raised border border-[var(--border)] px-3 text-text-primary outline-none focus:border-accent ${compact ? 'h-10 text-sm' : 'h-8 text-xs'}`

  return (
    <div className="rounded-xl border border-[var(--border)] overflow-hidden">
      <button onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center gap-2 px-3 text-left ${compact ? 'py-3' : 'py-2.5'} hover:bg-surface-raised transition-colors`}>
        <Upload size={13} className="text-text-muted shrink-0" />
        <span className="flex-1 text-xs font-semibold text-text-primary">Upload node binary</span>
        <ChevronDown size={14} className={`text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-[var(--border)]">
          {binaries.length > 0 && (
            <ul className="space-y-1 pt-2">
              {binaries.map((b) => (
                <li key={b.id} className="flex items-center gap-2 text-[11px] text-text-muted">
                  <span className="font-mono text-text-primary">{b.platform}</span>
                  <span>v{b.version}</span>
                  {b.signature && <span title="Signed by the server"><ShieldCheck size={11} className="text-emerald-400" /></span>}
                  <span className="ml-auto truncate">{formatBytes(b.size)} · {shortDate(b.created_at)}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-2 gap-2">
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={field}>
              {CDN_BINARY_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="Version (1.3.0)" className={field} />
          </div>

          <input ref={fileRef} type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-xs text-text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-surface-raised file:px-3 file:py-1.5 file:text-xs file:text-text-primary" />

          <button onClick={submit} disabled={!canSubmit}
            className={`flex items-center gap-1.5 rounded-lg bg-accent text-white font-medium disabled:opacity-40 ${compact ? 'h-10 px-4 text-sm' : 'px-3 py-1.5 text-xs'}`}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {busy ? (progress >= 1 ? 'Processing…' : `Uploading ${Math.round(progress * 100)}%`) : 'Upload'}
          </button>
          {busy && (
            <div className="h-1.5 rounded-full bg-surface-raised overflow-hidden">
              <div className="h-full bg-accent transition-[width] duration-150" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}

          {error && <p className="flex items-center gap-1.5 text-xs text-red-400"><AlertCircle size={12} /> {error}</p>}
          {done && <p className="flex items-center gap-1.5 text-xs text-emerald-400"><Check size={12} /> {done}</p>}
        </div>
      )}
    </div>
  )
}
