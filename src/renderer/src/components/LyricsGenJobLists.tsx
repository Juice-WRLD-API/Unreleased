import { useEffect, useRef, useState } from 'react'
import { AlertCircle, CircleStop, Cpu, Loader2, Plus, RefreshCw, Search, Sparkles, Trash2 } from 'lucide-react'
import {
  cancelAdminLyricsJob, deleteLyricsJob, getLyricsAdminSettings, isFinished, jobTitle, listAdminLyricsJobs, setLyricsWhisperModel,
  type LyricsAdminJobSummary, type LyricsAdminSettings, type LyricsGenJobSummary,
} from '../lib/lyricsGenApi'
import { isAbortError } from '../lib/apiClient'
import { errorMessage } from '../lib/format'
import { showAppToast } from '../lib/appToast'
import { useListMotion } from '../hooks/useListMotion'
import ThemedSelect from './ThemedSelect'
import { relativeTime } from './adminShared'
import { ConfirmButton, MODE_INFO, ModeTile, StatusPill, sourceHint } from './lyricsGenShared'

// The "Your jobs" and "All jobs" tabs of the Synced lyrics dialog. Rows open
// the job in the dialog's job view; finished jobs can be deleted from here,
// and administrators can cancel anyone's running job.

const SECTION_LABEL = 'text-[11px] font-semibold uppercase tracking-wider text-text-muted'
const ADMIN_PAGE = 25
const ADMIN_POLL_MS = 5000

function JobRow({ job, user, onOpen, action }: {
  job: LyricsGenJobSummary
  user?: string
  onOpen: () => void
  action?: React.ReactNode
}): JSX.Element {
  return (
    <div data-flip-key={job.id} className="flex items-center gap-1 pr-2 rounded-xl hover:bg-surface-overlay/70 transition-colors">
      <button onClick={onOpen} className="flex-1 min-w-0 flex items-center gap-3 pl-2.5 py-2.5 text-left">
        <ModeTile mode={job.mode} status={job.status} />
        <span className="flex-1 min-w-0">
          <span className="block text-sm text-text-primary font-medium truncate" title={sourceHint(job)}>{jobTitle(job) || 'Untitled audio'}</span>
          <span className="block text-[11px] text-text-muted truncate">
            {user && <><span className="text-text-secondary">{user}</span> · </>}
            {MODE_INFO[job.mode].title} · {relativeTime(job.created_at)}
            {job.language && <> · <span className="uppercase">{job.language}</span></>}
            {job.source?.song && job.filename && <> · {job.filename}</>}
            {job.status === 'failed' && job.error && <> · <span className="text-red-300/90">{job.error}</span></>}
          </span>
        </span>
        <StatusPill status={job.status} progress={job.progress} />
      </button>
      <span className="min-w-[28px] shrink-0 flex justify-end">{action}</span>
    </div>
  )
}

export function MyJobs({ jobs, loading, error, onOpen, onRefresh, onDeleted, onCreate }: {
  jobs: LyricsGenJobSummary[] | null
  loading: boolean
  error: string | null
  onOpen: (id: string) => void
  onRefresh: () => void
  onDeleted: (id: string) => void
  onCreate: () => void
}): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  useListMotion(listRef)
  const [deleting, setDeleting] = useState<string | null>(null)

  const remove = async (id: string): Promise<void> => {
    setDeleting(id)
    try {
      await deleteLyricsJob(id)
      onDeleted(id)
    } catch (e) {
      showAppToast(errorMessage(e, 'Could not delete this job'))
    } finally {
      setDeleting(null)
    }
  }

  const active = jobs?.filter((j) => !isFinished(j)).length ?? 0
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className={SECTION_LABEL}>Your jobs</p>
          <p className="text-[11px] text-text-muted mt-0.5">
            {active ? `${active} running or waiting · ` : ''}Previews are kept for 7 days
          </p>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          title="Refresh"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors disabled:opacity-60"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-400/25 bg-red-400/5 px-3 py-2.5 text-xs text-red-300">
          <AlertCircle size={14} className="shrink-0 mt-px" /> <span className="min-w-0 break-words">{error}</span>
        </div>
      )}

      {jobs === null && !error && <div className="py-16 flex justify-center"><Loader2 size={20} className="animate-spin text-text-muted" /></div>}

      {/* Kept mounted while empty, so the first job arriving and the last one
          leaving both animate. */}
      <div ref={listRef} className="relative flex flex-col gap-0.5 -mx-2">
        {(jobs ?? []).map((j) => (
          <JobRow
            key={j.id}
            job={j}
            onOpen={() => onOpen(j.id)}
            action={isFinished(j) && (
              <ConfirmButton iconOnly icon={Trash2} label="Delete" confirmLabel="Delete?" busy={deleting === j.id} onConfirm={() => void remove(j.id)} />
            )}
          />
        ))}
      </div>

      {jobs?.length === 0 && (
        <div className="flex flex-col items-center text-center py-12 px-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent/25 to-accent/5 border border-accent/20 flex items-center justify-center">
            <Sparkles size={24} className="text-accent" />
          </div>
          <p className="mt-4 text-sm font-semibold text-text-primary">No lyrics jobs yet</p>
          <p className="mt-1 text-xs text-text-muted max-w-[300px] leading-relaxed">
            Jobs you start here or with <span className="font-mono text-text-secondary">lyricsgen</span> in the terminal show up in this list.
          </p>
          <button onClick={onCreate} className="mt-4 inline-flex items-center gap-1.5 h-9 px-4 rounded-xl text-sm font-semibold bg-accent text-white hover:bg-accent/90 transition-colors">
            <Plus size={15} /> New job
          </button>
        </div>
      )}
    </div>
  )
}

// Which Whisper model the worker loads. Changing it is instant here and rolls
// back if the server refuses.
function ModelCard(): JSX.Element {
  const [settings, setSettings] = useState<LyricsAdminSettings | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    getLyricsAdminSettings(ac.signal).then(setSettings, (e) => { if (!isAbortError(e)) setError(errorMessage(e, 'Could not load the model setting')) })
    return () => ac.abort()
  }, [])

  const choose = (model: string): void => {
    if (!settings || model === settings.whisper_model) return
    const before = settings
    setSettings({ ...settings, whisper_model: model, effective_model: model || settings.default_model })
    setLyricsWhisperModel(model).then(setSettings, (e) => {
      setSettings(before)
      showAppToast(errorMessage(e, 'Could not change the model'))
    })
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-surface-overlay/30 p-4">
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 shrink-0 rounded-xl bg-accent/15 text-accent flex items-center justify-center"><Cpu size={18} /></span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary">Whisper model</p>
          <p className="text-[11px] text-text-muted truncate">
            {settings
              ? <>Using <span className="text-text-secondary font-semibold">{settings.effective_model}</span>{settings.whisper_model ? '' : ' (server default)'}{settings.updated_by && <> · set by {settings.updated_by} {relativeTime(settings.updated_at)}</>}</>
              : error ? <span className="text-red-300">{error}</span> : 'Loading…'}
          </p>
        </div>
        {settings && (
          <ThemedSelect
            value={settings.whisper_model}
            onChange={choose}
            options={[
              { value: '', label: `Server default (${settings.default_model})` },
              ...settings.available_models.map((m) => ({ value: m, label: m })),
            ]}
            className="h-8 px-3 rounded-lg bg-surface-overlay border border-[var(--border)] text-xs text-text-primary min-w-[150px]"
          />
        )}
      </div>
      <p className="mt-3 text-[11px] text-text-muted leading-relaxed">
        Applies from the next job, with no restart. A model that hasn't been used before downloads first (large-v3 is about 2.9 GB), so that job is slow. Larger models are much slower on CPU.
      </p>
    </section>
  )
}

const FILTERS: { id: string; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'active', label: 'Running' },
  { id: 'completed', label: 'Ready' },
  { id: 'failed', label: 'Failed' },
  { id: 'cancelled', label: 'Cancelled' },
]

export function AdminJobs({ onOpen }: { onOpen: (id: string) => void }): JSX.Element {
  const [status, setStatus] = useState('')
  const [userQuery, setUserQuery] = useState('')
  const [user, setUser] = useState('')
  const [rows, setRows] = useState<LyricsAdminJobSummary[] | null>(null)
  const [count, setCount] = useState(0)
  const [active, setActive] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useListMotion(listRef)

  useEffect(() => {
    const t = window.setTimeout(() => setUser(userQuery.trim()), 350)
    return () => window.clearTimeout(t)
  }, [userQuery])

  // First page for the current filter, refreshed while anything is running.
  // Pages fetched with "Show more" are left alone by the refresh.
  const pagedRef = useRef(false)
  useEffect(() => {
    const ac = new AbortController()
    let timer = 0
    pagedRef.current = false
    setRows(null)
    const load = async (): Promise<void> => {
      try {
        const data = await listAdminLyricsJobs({ status, user, limit: ADMIN_PAGE }, ac.signal)
        if (!pagedRef.current) setRows(data.results)
        setCount(data.count)
        setActive(data.active)
        setError(null)
        if (data.active > 0) timer = window.setTimeout(load, ADMIN_POLL_MS)
      } catch (e) {
        if (isAbortError(e) || ac.signal.aborted) return
        setError(errorMessage(e, 'Could not load the jobs'))
      }
    }
    void load()
    return () => { ac.abort(); window.clearTimeout(timer) }
  }, [status, user])

  const more = async (): Promise<void> => {
    if (!rows) return
    setLoadingMore(true)
    try {
      const data = await listAdminLyricsJobs({ status, user, limit: ADMIN_PAGE, offset: rows.length })
      pagedRef.current = true
      setRows((r) => [...(r ?? []), ...data.results.filter((j) => !r?.some((x) => x.id === j.id))])
      setCount(data.count)
    } catch (e) {
      showAppToast(errorMessage(e, 'Could not load more jobs'))
    } finally {
      setLoadingMore(false)
    }
  }

  const cancel = async (id: string): Promise<void> => {
    setCancelling(id)
    try {
      const job = await cancelAdminLyricsJob(id)
      setRows((r) => r?.map((j) => (j.id === id ? { ...j, status: job.status, error: job.error } : j)) ?? r)
      setActive((n) => Math.max(0, n - 1))
    } catch (e) {
      showAppToast(errorMessage(e, 'Could not cancel this job'))
    } finally {
      setCancelling(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ModelCard />

      <div className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className={SECTION_LABEL}>Everyone's jobs</p>
            <p className="text-[11px] text-text-muted mt-0.5 flex items-center gap-1.5">
              {active > 0 && <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />}
              {active} running or waiting · {count} {status || user ? 'match' : 'in total'}
            </p>
          </div>
          <label className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              placeholder="Username"
              className="h-8 w-36 pl-7 pr-2.5 rounded-lg bg-surface-overlay border border-[var(--border)] text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/60 transition-colors"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setStatus(f.id)}
              className={`h-7 px-3 rounded-full text-xs font-semibold border transition-colors ${
                status === f.id ? 'border-accent/50 bg-accent/15 text-accent' : 'border-[var(--border)] text-text-muted hover:text-text-primary hover:bg-surface-overlay'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-400/25 bg-red-400/5 px-3 py-2.5 text-xs text-red-300">
            <AlertCircle size={14} className="shrink-0 mt-px" /> <span className="min-w-0 break-words">{error}</span>
          </div>
        )}
        {rows === null && !error && <div className="py-12 flex justify-center"><Loader2 size={20} className="animate-spin text-text-muted" /></div>}

        <div ref={listRef} className="relative flex flex-col gap-0.5 -mx-2">
          {(rows ?? []).map((j) => (
            <JobRow
              key={j.id}
              job={j}
              user={j.user.username}
              onOpen={() => onOpen(j.id)}
              action={!isFinished(j) && (
                <ConfirmButton iconOnly icon={CircleStop} label="Cancel" confirmLabel="Cancel?" busy={cancelling === j.id} onConfirm={() => void cancel(j.id)} />
              )}
            />
          ))}
        </div>
        {rows?.length === 0 && <p className="py-10 text-center text-sm text-text-muted">No jobs{status || user ? ' match' : ' yet'}</p>}

        {rows && rows.length < count && (
          <button
            onClick={() => void more()}
            disabled={loadingMore}
            className="self-center inline-flex items-center gap-1.5 h-8 px-4 rounded-lg text-xs font-semibold text-text-secondary bg-surface-overlay hover:bg-surface-raised hover:text-text-primary transition-colors disabled:opacity-60"
          >
            {loadingMore && <Loader2 size={13} className="animate-spin" />} Show more
          </button>
        )}
      </div>
    </div>
  )
}
