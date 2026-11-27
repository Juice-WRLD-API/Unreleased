import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, ChevronLeft, Minus, Plus, RefreshCw, Trash2, Wrench, X, type LucideIcon } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { formatDuration, recheck, useServiceStatus } from '../lib/serviceStatus'
import {
  createIncident, deleteIncident, fetchIncidents, fetchStatusPage, INCIDENT_IMPACTS, INCIDENT_STATUSES, postIncidentUpdate,
  SERVICE_IDS, type Incident, type IncidentImpact, type IncidentStatus, type ServiceId, type StatusDay, type StatusPage,
  type StatusServiceInfo,
} from '../lib/statusApi'
import { showAppToast } from '../lib/appToast'
import ThemedSelect from './ThemedSelect'
import { glassPillButton } from './glassControls'

// The status page: is juicewrldapi.com up, 90 days of history per service and
// the incidents, all recorded on the server (lib/statusApi). While the server
// is down this device's own check (lib/serviceStatus) says so on top, and the
// history shows from the last copy saved.

const REFRESH_MS = 60_000
const DISCORD_URL = 'https://discord.gg/jwa'
// Phones show the most recent half; the rest come in from `sm`.
const NARROW_DAYS = 45

type Banner = { text: string; tone: string; icon: LucideIcon }

const BANNERS: Record<string, Banner> = {
  up: { text: 'All systems operational', tone: 'bg-green-600', icon: Check },
  degraded: { text: 'Some services are slow', tone: 'bg-amber-500', icon: AlertTriangle },
  partial: { text: 'Partial outage', tone: 'bg-orange-500', icon: AlertTriangle },
  down: { text: 'juicewrldapi.com is down', tone: 'bg-red-600', icon: X },
  maintenance: { text: 'Maintenance in progress', tone: 'bg-sky-600', icon: Wrench },
  unknown: { text: 'Checking…', tone: 'bg-[var(--fill-strong)]', icon: Minus },
}

const IMPACT_TONE: Record<IncidentImpact, string> = {
  minor: 'bg-amber-500',
  major: 'bg-red-500',
  maintenance: 'bg-sky-500',
}

const STATUS_LABEL: Record<IncidentStatus, string> = {
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
}

function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

function when(iso: string | number): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === new Date().toDateString()) return time
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })}, ${time}`
}

/** The last `count` UTC dates, oldest first, as YYYY-MM-DD. */
function lastDays(count: number, end: Date): string[] {
  const out: string[] = []
  const base = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
  for (let i = count - 1; i >= 0; i--) out.push(new Date(base - i * 86_400_000).toISOString().slice(0, 10))
  return out
}

function dayTone(d: StatusDay | undefined): string {
  if (!d || d.up + d.degraded + d.down === 0) return 'bg-[var(--fill-strong)]'
  const down = d.down / 60
  if (down === 0) return 'bg-green-500'
  if (down < 5) return 'bg-yellow-400'
  if (down < 30) return 'bg-amber-500'
  if (down < 120) return 'bg-orange-500'
  return 'bg-red-500'
}

function dayText(d: StatusDay | undefined): string {
  if (!d || d.up + d.degraded + d.down === 0) return 'No data'
  const parts: string[] = []
  if (d.down) parts.push(`Down for ${formatDuration(d.down * 1000)}`)
  if (d.degraded >= 60) parts.push(`Slow for ${formatDuration(d.degraded * 1000)}`)
  return parts.length ? parts.join(' · ') : 'No downtime'
}

function stateLine(s: StatusServiceInfo): string {
  if (s.state === 'unknown') return 'No checks yet'
  if (s.state === 'down') return `Down since ${s.since ? when(s.since) : 'the last check'}${s.detail ? ` (${s.detail})` : ''}`
  if (s.state === 'degraded') return `Slow${s.latency_ms != null ? `, ${(s.latency_ms / 1000).toFixed(1)} s` : ''}`
  return 'Normal'
}

function StateIcon({ state }: { state: StatusServiceInfo['state'] }): JSX.Element {
  const cls = 'w-5 h-5 rounded-full flex items-center justify-center text-white shrink-0'
  if (state === 'up') return <span className={`${cls} bg-green-500`} aria-label="Normal"><Check size={12} strokeWidth={3} /></span>
  if (state === 'degraded') return <span className={`${cls} bg-amber-500`} aria-label="Slow"><AlertTriangle size={11} strokeWidth={2.5} /></span>
  if (state === 'down') return <span className={`${cls} bg-red-500`} aria-label="Down"><X size={12} strokeWidth={3} /></span>
  return <span className={`${cls} bg-[var(--fill-strong)]`} aria-label="Unknown"><Minus size={12} strokeWidth={3} /></span>
}

function ServiceCell({ s, days, endDate }: { s: StatusServiceInfo; days: number; endDate: Date }): JSX.Element {
  const [hover, setHover] = useState<number | null>(null)
  const byDate = new Map(s.history.map((d) => [d.date, d]))
  const dates = lastDays(days, endDate)
  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-2 mb-2.5">
        <p className="text-sm font-semibold text-text-primary">{s.label}</p>
        <span className="text-xs text-text-muted truncate">{s.description}</span>
        <span className="ml-auto"><StateIcon state={s.state} /></span>
      </div>
      <div className="relative" onMouseLeave={() => setHover(null)}>
        <div className="flex gap-[2px] h-8">
          {dates.map((date, i) => (
            <div
              key={date}
              onMouseEnter={() => setHover(i)}
              className={`flex-1 rounded-[2px] ${dayTone(byDate.get(date))} ${i < days - NARROW_DAYS ? 'hidden sm:block' : ''} ${hover === i ? 'opacity-70' : ''}`}
            />
          ))}
        </div>
        {hover !== null && (
          <div
            className="absolute bottom-full mb-2 -translate-x-1/2 z-10 pointer-events-none whitespace-nowrap rounded-lg glass-thick px-2.5 py-1.5 text-xs"
            style={{ left: `${((hover + 0.5) / days) * 100}%` }}
          >
            <p className="text-text-primary font-medium">
              {new Date(`${dates[hover]}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
            </p>
            <p className="text-text-secondary">{dayText(byDate.get(dates[hover]))}</p>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
        <span className="hidden sm:inline">{days} days ago</span>
        <span className="sm:hidden">{NARROW_DAYS} days ago</span>
        <span className="flex-1 h-px bg-[var(--border)]" />
        <span>{s.uptime != null ? `${s.uptime.toFixed(2).replace(/\.?0+$/, '')} % uptime` : 'No data yet'}</span>
        <span className="flex-1 h-px bg-[var(--border)]" />
        <span>Today</span>
      </div>
      <p className={`text-xs mt-2 ${s.state === 'down' ? 'text-red-400' : s.state === 'degraded' ? 'text-amber-400' : 'text-text-secondary'}`}>{stateLine(s)}</p>
    </div>
  )
}

function serviceNames(ids: ServiceId[], page: StatusPage | null): string {
  if (!ids.length) return 'Whole site'
  return ids.map((id) => page?.services.find((s) => s.id === id)?.label ?? id).join(', ')
}

function IncidentCard({ incident, page, admin, onChanged }: {
  incident: Incident
  page: StatusPage | null
  admin: boolean
  onChanged: () => void
}): JSX.Element {
  const [status, setStatus] = useState<IncidentStatus>(incident.resolved_at ? 'investigating' : 'monitoring')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  const post = async (): Promise<void> => {
    if (!message.trim()) return
    setBusy(true)
    try {
      await postIncidentUpdate(incident.id, status, message.trim())
      setMessage('')
      setOpen(false)
      onChanged()
    } catch (e) {
      showAppToast(`Couldn't post the update: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!window.confirm(`Delete "${incident.title}"? This can't be undone.`)) return
    try {
      await deleteIncident(incident.id)
      onChanged()
    } catch (e) {
      showAppToast(`Couldn't delete it: ${(e as Error).message}`)
    }
  }

  const length = (incident.resolved_at ? new Date(incident.resolved_at).getTime() : Date.now()) - new Date(incident.started_at).getTime()
  return (
    <article className="relative glass-pane rounded-2xl overflow-hidden">
      <div className={`absolute left-0 inset-y-0 w-1 ${incident.resolved_at ? 'bg-[var(--fill-strong)]' : IMPACT_TONE[incident.impact]}`} />
      <div className="px-5 py-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-text-primary">{incident.title}</p>
            <p className="text-xs text-text-muted mt-0.5">
              {serviceNames(incident.services, page)} · {when(incident.started_at)}
              {incident.resolved_at ? ` to ${when(incident.resolved_at)} · ${formatDuration(length)}` : ` · ongoing, ${formatDuration(length)}`}
              {incident.impact === 'maintenance' ? ' · Maintenance' : ''}
            </p>
          </div>
          {admin && (
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => setOpen((v) => !v)} className="px-2.5 py-1 rounded-lg bg-[var(--fill)] hover:bg-[var(--fill-strong)] text-xs text-text-primary">
                {open ? 'Cancel' : 'Post update'}
              </button>
              <button onClick={remove} title="Delete incident" aria-label="Delete incident" className="p-1.5 rounded-lg text-text-muted hover:text-red-400">
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </div>
        <ol className="mt-3 space-y-3">
          {incident.updates.map((u) => (
            <li key={u.id} className="text-sm">
              <span className="font-semibold text-text-primary">{STATUS_LABEL[u.status] ?? u.status}</span>
              <span className="text-text-secondary"> - {u.message}</span>
              <p className="text-xs text-text-muted mt-0.5">{when(u.created_at)}{u.author ? ` · ${u.author}` : ''}</p>
            </li>
          ))}
        </ol>
        {admin && open && (
          <div className="mt-3 flex flex-col gap-2">
            <ThemedSelect
              value={status}
              onChange={(v) => setStatus(v as IncidentStatus)}
              options={INCIDENT_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
              className="w-44 bg-[var(--fill)] text-text-primary text-xs px-2.5 py-1.5 rounded-lg focus:outline-none"
            />
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="What's happening?"
              className="w-full bg-[var(--fill)] text-text-primary text-sm px-3 py-2 rounded-lg focus:outline-none resize-y"
            />
            <button onClick={post} disabled={busy || !message.trim()} className="self-start px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium disabled:opacity-50">
              Post
            </button>
          </div>
        )}
      </div>
    </article>
  )
}

function NewIncidentForm({ onDone }: { onDone: (created: boolean) => void }): JSX.Element {
  const [title, setTitle] = useState('')
  const [impact, setImpact] = useState<IncidentImpact>('minor')
  const [status, setStatus] = useState<IncidentStatus>('investigating')
  const [services, setServices] = useState<ServiceId[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const toggle = (id: ServiceId): void => setServices((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      await createIncident({ title: title.trim(), message: message.trim(), impact, status, services })
      onDone(true)
    } catch (e) {
      showAppToast(`Couldn't open the incident: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const field = 'w-full bg-[var(--fill)] text-text-primary text-sm px-3 py-2 rounded-lg focus:outline-none'
  return (
    <section className="relative glass-pane rounded-2xl p-5 mt-4 flex flex-col gap-3">
      <p className="text-sm font-semibold text-text-primary">New incident</p>
      <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Title, e.g. Streaming is slow" className={field} />
      <div className="flex flex-wrap gap-2">
        <ThemedSelect
          value={impact}
          onChange={(v) => setImpact(v as IncidentImpact)}
          options={INCIDENT_IMPACTS.map((i) => ({ value: i, label: i[0].toUpperCase() + i.slice(1) }))}
          className="w-40 bg-[var(--fill)] text-text-primary text-xs px-2.5 py-1.5 rounded-lg focus:outline-none"
        />
        <ThemedSelect
          value={status}
          onChange={(v) => setStatus(v as IncidentStatus)}
          options={INCIDENT_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
          className="w-44 bg-[var(--fill)] text-text-primary text-xs px-2.5 py-1.5 rounded-lg focus:outline-none"
        />
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Affected services">
        {SERVICE_IDS.map((id) => (
          <button
            key={id}
            onClick={() => toggle(id)}
            aria-pressed={services.includes(id)}
            className={`px-2.5 py-1 rounded-full text-xs ${services.includes(id) ? 'bg-accent text-white' : 'bg-[var(--fill)] text-text-secondary hover:text-text-primary'}`}
          >
            {id}
          </button>
        ))}
        <span className="text-xs text-text-muted self-center ml-1">{services.length ? '' : 'None picked: the whole site'}</span>
      </div>
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={2000} placeholder="First update" className={`${field} resize-y`} />
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy || !title.trim() || !message.trim()} className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium disabled:opacity-50">
          Open incident
        </button>
        <button onClick={() => onDone(false)} className="px-3 py-1.5 rounded-lg bg-[var(--fill)] text-text-primary text-xs">Cancel</button>
      </div>
    </section>
  )
}

export default function StatusView(): JSX.Element {
  const { setActiveView, previousView, account } = useStorePick('setActiveView', 'previousView', 'account')
  const backView = previousView && previousView !== 'status' ? previousView : 'home'
  const admin = !!account?.is_administrator
  const live = useServiceStatus()
  const [page, setPage] = useState<StatusPage | null>(null)
  const [cached, setCached] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [older, setOlder] = useState<Incident[]>([])
  const [olderTotal, setOlderTotal] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [now, setNow] = useState(Date.now())

  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setLoading(true)
    try {
      const r = await fetchStatusPage(signal)
      setPage(r.page)
      setCached(r.cached)
      setError('')
      // A copy from the cache means the server didn't answer: let the live check say so.
      if (r.cached) void recheck()
    } catch (e) {
      if (signal?.aborted) return
      setError((e as Error).message)
      void recheck()
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    void load(ctrl.signal)
    const id = setInterval(() => { void load() }, REFRESH_MS)
    return () => { ctrl.abort(); clearInterval(id) }
  }, [load])

  // Back up: fetch the fresh copy straight away.
  useEffect(() => { if (live.state === 'up' && cached) void load() }, [live.state, cached, load])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const liveDown = live.state === 'down'
  const maintenance = page?.active_incidents.some((i) => i.impact === 'maintenance')
  const bannerKey = liveDown ? 'down' : !page ? 'unknown' : page.overall === 'up' && maintenance ? 'maintenance' : page.overall
  const banner = BANNERS[bannerKey] ?? BANNERS.unknown
  const BannerIcon = banner.icon

  let bannerSub = ''
  if (liveDown) {
    const next = live.nextCheckAt ? Math.max(0, Math.ceil((live.nextCheckAt - now) / 1000)) : null
    bannerSub = `This device can't reach it since ${when(live.downSince ?? now)}.${live.checking ? ' Checking…' : next != null ? ` Checking again in ${next} s.` : ''}`
  } else if (live.state === 'offline') {
    bannerSub = 'This device has no connection, so this is the last saved copy.'
  }

  const loadOlder = async (): Promise<void> => {
    try {
      const shown = (page?.active_incidents.length ?? 0) + (page?.recent_incidents.length ?? 0)
      const r = await fetchIncidents(20, shown + older.length)
      setOlder((o) => [...o, ...r.results])
      setOlderTotal(r.count)
    } catch (e) {
      showAppToast(`Couldn't load older incidents: ${(e as Error).message}`)
    }
  }

  const refresh = (): void => { setOlder([]); setOlderTotal(null); void load() }
  const days = page?.days ?? 90
  const endDate = page ? new Date(page.generated_at) : new Date(now)
  const shownIds = new Set([...(page?.active_incidents ?? []), ...(page?.recent_incidents ?? [])].map((i) => i.id))
  const past = [...(page?.recent_incidents ?? []), ...older.filter((i) => !shownIds.has(i.id) && i.resolved_at)]

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-player">
      <div className="w-full max-w-5xl mx-auto px-4 md:px-6 pt-6 pb-12">
        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={() => setActiveView(backView)}
            title="Back"
            aria-label="Back"
            className="p-1 -ml-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <ChevronLeft size={18} />
          </button>
          <h1 className="text-text-primary text-xl font-bold">Status</h1>
          <div className="ml-auto flex items-center gap-2">
            {admin && !creating && (
              <button onClick={() => setCreating(true)} className={glassPillButton(false)}>
                <Plus size={14} /> New incident
              </button>
            )}
            <button onClick={() => { void recheck(); refresh() }} disabled={loading || live.checking} className={glassPillButton(false)}>
              <RefreshCw size={14} className={loading || live.checking ? 'animate-spin motion-reduce:animate-none' : ''} />
              Check now
            </button>
          </div>
        </div>

        <section aria-live="polite" className={`rounded-xl ${banner.tone} text-white px-5 py-3.5 shadow-sm`}>
          <p className="flex items-center gap-2.5 text-lg font-semibold">
            <BannerIcon size={20} strokeWidth={2.5} /> {banner.text}
          </p>
          {bannerSub && <p className="text-sm text-white/90 mt-1">{bannerSub}</p>}
        </section>

        {(liveDown || live.state === 'offline') && (
          <section className="relative glass-pane rounded-2xl p-5 mt-4">
            <p className="text-text-primary text-sm font-semibold mb-2">What still works</p>
            <ul className="text-text-secondary text-sm space-y-1.5 list-disc pl-5">
              <li>Pages you&rsquo;ve opened before show the last copy the app saved.</li>
              <li>Signing in, playlist edits, chat and 999 FM wait until the server is back.</li>
            </ul>
          </section>
        )}

        {creating && <NewIncidentForm onDone={(made) => { setCreating(false); if (made) refresh() }} />}

        {page?.active_incidents.length ? (
          <div className="mt-6 flex flex-col gap-3">
            <h2 className="text-text-primary text-base font-semibold px-1">Active incidents</h2>
            {page.active_incidents.map((i) => <IncidentCard key={i.id} incident={i} page={page} admin={admin} onChanged={refresh} />)}
          </div>
        ) : null}

        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 mt-8 mb-3 px-1">
          <h2 className="text-text-primary text-xl font-bold">Current status</h2>
          <p className="text-xs text-text-muted">
            Uptime over the past {days} days{cached && page ? `. Saved copy from ${when(page.generated_at)}` : ''}.
          </p>
        </div>

        {page ? (
          <div className="relative glass-pane rounded-2xl grid md:grid-cols-2">
            {page.services.map((s, i) => (
              // Rules between cells: one column on phones, two from md.
              <div key={s.id} className={`border-[var(--border)] ${i > 0 ? 'border-t' : ''} ${i === 1 ? 'md:border-t-0' : ''} ${i % 2 === 1 ? 'md:border-l' : ''}`}>
                <ServiceCell s={s} days={days} endDate={endDate} />
              </div>
            ))}
          </div>
        ) : (
          <p className="relative glass-pane rounded-2xl px-5 py-4 text-sm text-text-secondary">
            {loading ? 'Loading the history…' : `The history isn't available right now${error ? ` (${error})` : ''}.`}
          </p>
        )}

        {page?.monitor.stale && page.monitor.last_check && (
          <p className="text-xs text-text-muted mt-2 px-1">The server&rsquo;s checks last ran {when(page.monitor.last_check)}.</p>
        )}

        <h2 className="text-text-primary text-xl font-bold mt-10 mb-3 px-1">Past incidents</h2>
        {past.length ? (
          <div className="flex flex-col gap-3">
            {past.map((i) => <IncidentCard key={i.id} incident={i} page={page} admin={admin} onChanged={refresh} />)}
          </div>
        ) : (
          <p className="relative glass-pane rounded-2xl px-5 py-4 text-sm text-text-secondary">No incidents in the last 14 days.</p>
        )}
        {page && (olderTotal === null || shownIds.size + older.length < olderTotal) && (
          <button onClick={loadOlder} className={`mt-3 ${glassPillButton(false)}`}>Older incidents</button>
        )}

        <p className="text-xs text-text-muted mt-8 px-1">
          The server checks each service once a minute. While it&rsquo;s down, updates are posted in the{' '}
          <button onClick={() => openExternal(DISCORD_URL)} className="text-accent hover:underline">Discord</button>.
        </p>
      </div>
    </div>
  )
}
