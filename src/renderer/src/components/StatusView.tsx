import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronLeft, CircleDashed, RefreshCw, WifiOff, XCircle, type LucideIcon } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { ELECTRON_TITLEBAR_CLEARANCE_Y, IS_ELECTRON } from '../lib/platform'
import {
  checkServices, clearOutages, formatDuration, getStatus, OVERALL_TEXT, recheck, useServiceStatus,
  type Outage, type Overall, type ServiceResult,
} from '../lib/serviceStatus'
import { glassPillButton } from './glassControls'

// The downtime page: is juicewrldapi.com up, which parts answer, and the
// outages this device has seen. Everything here is probed from the client,
// so it still works (and is most useful) while the server is down.

const OVERALL_ICON: Record<Overall, { icon: LucideIcon; tone: string }> = {
  unknown: { icon: CircleDashed, tone: 'text-text-muted' },
  up: { icon: CheckCircle2, tone: 'text-green-400' },
  degraded: { icon: AlertTriangle, tone: 'text-amber-400' },
  partial: { icon: AlertTriangle, tone: 'text-amber-400' },
  down: { icon: XCircle, tone: 'text-red-400' },
  offline: { icon: WifiOff, tone: 'text-text-muted' },
}

const STATE_TEXT: Record<ServiceResult['state'], { label: string; dot: string }> = {
  up: { label: 'Working', dot: 'bg-green-400' },
  slow: { label: 'Slow', dot: 'bg-amber-400' },
  down: { label: 'Down', dot: 'bg-red-400' },
}

const REFRESH_MS = 60_000
const DISCORD_URL = 'https://discord.gg/jwa'

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s} s ago`
  return `${formatDuration(ms)} ago`
}

function when(t: number): string {
  const d = new Date(t)
  const today = new Date().toDateString() === d.toDateString()
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return today ? time : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`
}

function latency(r: ServiceResult): string {
  if (r.state === 'down') return r.detail ?? ''
  if (r.ms == null) return ''
  return r.ms >= 1000 ? `${(r.ms / 1000).toFixed(1)} s` : `${r.ms} ms`
}

function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

function OutageRow({ o, now }: { o: Outage; now: number }): JSX.Element {
  const ongoing = o.end === null
  const length = (o.end ?? now) - o.start
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className={`w-2 h-2 rounded-full shrink-0 ${ongoing ? 'bg-red-400' : 'bg-text-muted'}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text-primary">
          {when(o.start)}{ongoing ? '' : ` to ${when(o.end!)}`}
        </p>
        <p className="text-xs text-text-muted">
          {ongoing ? `Ongoing, ${formatDuration(length)} so far` : `${o.endApprox ? 'At least ' : ''}${formatDuration(length)}`}
          {o.endApprox ? ' (the app was closed when it came back)' : ''}
        </p>
      </div>
    </li>
  )
}

export default function StatusView(): JSX.Element {
  const { setActiveView, previousView, appMenuPosition } = useStorePick('setActiveView', 'previousView', 'appMenuPosition')
  const backView = previousView && previousView !== 'status' ? previousView : 'home'
  const status = useServiceStatus()
  const [now, setNow] = useState(Date.now())

  // Probe on open and once a minute after. While down the monitor polls
  // /health/ on its own backoff, so this only refreshes the rest.
  useEffect(() => {
    void checkServices()
    const id = setInterval(() => { if (getStatus().overall !== 'down') void checkServices() }, REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  // Ticks the "checked … ago" and countdown text.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const { icon: Icon, tone } = OVERALL_ICON[status.overall]
  const down = status.overall === 'down'
  const offline = status.overall === 'offline'
  const ongoing = status.outages[0]?.end === null ? status.outages[0] : null

  let sub: string
  if (down) {
    const since = ongoing?.start ?? status.since
    const next = status.nextCheckAt ? Math.max(0, Math.ceil((status.nextCheckAt - now) / 1000)) : null
    sub = `Down since ${when(since)} (${formatDuration(now - since)}).${status.checking ? ' Checking…' : next != null ? ` Checking again in ${next} s.` : ''}`
  } else if (offline) {
    sub = 'This device has no connection. The status will update once it’s back.'
  } else if (status.checking && !status.checkedAt) {
    sub = 'Asking each service…'
  } else {
    sub = status.checkedAt ? `Checked ${ago(now - status.checkedAt)}` : ''
  }

  const onCheck = (): void => { void (down || offline ? recheck() : checkServices()) }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-player">
      <div
        className="w-full max-w-2xl mx-auto px-5 md:px-6 pb-10"
        style={{ paddingTop: IS_ELECTRON && appMenuPosition !== 'title-bar' ? ELECTRON_TITLEBAR_CLEARANCE_Y : 24 }}
      >
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
          <button onClick={onCheck} disabled={status.checking} className={`ml-auto ${glassPillButton(false)}`}>
            <RefreshCw size={14} className={status.checking ? 'animate-spin motion-reduce:animate-none' : ''} />
            Check now
          </button>
        </div>

        <section className="relative glass-pane rounded-2xl p-5 flex items-center gap-4" aria-live="polite">
          <Icon size={36} className={`shrink-0 ${tone}`} />
          <div className="min-w-0">
            <p className="text-text-primary text-lg font-semibold leading-tight">{OVERALL_TEXT[status.overall]}</p>
            {sub && <p className="text-text-secondary text-sm mt-1">{sub}</p>}
          </div>
        </section>

        {(down || offline) && (
          <section className="relative glass-pane rounded-2xl p-5 mt-4">
            <p className="text-text-primary text-sm font-semibold mb-2">What still works</p>
            <ul className="text-text-secondary text-sm space-y-1.5 list-disc pl-5">
              {IS_ELECTRON && <li>Downloaded playlists, songs kept by Sync, and your local library play as normal.</li>}
              <li>Pages you&rsquo;ve opened before show the last copy the app saved.</li>
              <li>Signing in, playlist edits, chat and 999 FM wait until the server is back.</li>
            </ul>
          </section>
        )}

        <h2 className="text-text-muted text-xs font-semibold uppercase tracking-wide mt-7 mb-2 px-1">Services</h2>
        <ul className="relative glass-pane rounded-2xl divide-y divide-[var(--border)]">
          {status.services.map((r) => {
            const known = status.checkedAt != null
            const s = STATE_TEXT[r.state]
            return (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text-primary font-medium">{r.label}</p>
                  <p className="text-xs text-text-muted truncate">{r.description}</p>
                </div>
                {known ? (
                  <div className="text-right shrink-0">
                    <p className="text-sm text-text-primary flex items-center justify-end gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                      {s.label}
                    </p>
                    <p className="text-xs text-text-muted tabular-nums">{latency(r)}</p>
                  </div>
                ) : (
                  <span className="text-xs text-text-muted shrink-0">Checking…</span>
                )}
              </li>
            )
          })}
        </ul>

        <div className="flex items-end justify-between mt-7 mb-2 px-1">
          <h2 className="text-text-muted text-xs font-semibold uppercase tracking-wide">Recent outages</h2>
          {status.outages.some((o) => o.end !== null) && (
            <button onClick={clearOutages} className="text-xs text-text-muted hover:text-text-primary">Clear</button>
          )}
        </div>
        {status.outages.length > 0 ? (
          <ul className="relative glass-pane rounded-2xl divide-y divide-[var(--border)]">
            {status.outages.map((o) => <OutageRow key={o.start} o={o} now={now} />)}
          </ul>
        ) : (
          <p className="relative glass-pane rounded-2xl px-4 py-3 text-sm text-text-secondary">No outages seen on this device.</p>
        )}
        <p className="text-xs text-text-muted mt-2 px-1">
          Outages this device noticed while the app was open. When the server is down, updates are posted in the{' '}
          <button onClick={() => openExternal(DISCORD_URL)} className="text-accent hover:underline">Discord</button>.
        </p>
      </div>
    </div>
  )
}
