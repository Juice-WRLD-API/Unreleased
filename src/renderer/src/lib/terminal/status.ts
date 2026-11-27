import { useStore } from '../../store/useStore'
import { formatDuration, getStatus, recheck } from '../serviceStatus'
import {
  createIncident, deleteIncident, fetchIncidents, fetchStatusPage, INCIDENT_IMPACTS, INCIDENT_STATUSES, postIncidentUpdate,
  SERVICE_IDS, updateIncident, type Incident, type IncidentImpact, type IncidentStatus, type ServiceId,
} from '../statusApi'
import { termAccess } from './access'
import { asJson, confirmAction, fail, parseArgs, table, type TermCommand, type TermCtx, type TermTone } from './types'

// The Status page from the terminal: the server's per-service state, uptime
// and incidents, this device's own check while the server is down, and (for
// administrators) opening and updating incidents.

const USAGE = [
  'downtime [--json]                     status and 90-day uptime per service',
  'downtime incidents [--limit N] [--json]',
  'downtime show <id> [--json]',
  'downtime retry                        ask /health/ again from this device',
  'downtime open                         open the Status page',
  'admin:',
  'downtime new [--impact minor|major|maintenance] [--status s] [--services a,b] -- <title> | <message>',
  'downtime update <id> <investigating|identified|monitoring|resolved> -- <message>',
  'downtime resolve <id> [-- <message>]',
  'downtime edit <id> [--title t] [--impact i] [--services a,b]',
  'downtime rm <id> [-y]',
].join('\n  ')

const SUBS = ['incidents', 'show', 'retry', 'open', 'new', 'update', 'resolve', 'edit', 'rm']
const ADMIN_SUBS = new Set(['new', 'update', 'resolve', 'edit', 'rm'])

const OVERALL_TONE: Record<string, TermTone> = { up: 'ok', degraded: 'plain', partial: 'error', down: 'error', unknown: 'dim' }

const stamp = (iso: string): string => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function incidentId(word: string | undefined): number {
  const n = Number(word)
  return Number.isInteger(n) && n > 0 ? n : fail(`usage:\n  ${USAGE}`)
}

function servicesArg(value: string | undefined): ServiceId[] | undefined {
  if (value === undefined) return undefined
  if (value === '' || value === 'all') return []
  const ids = value.split(',').map((s) => s.trim()).filter(Boolean)
  if (ids.some((s) => !(SERVICE_IDS as string[]).includes(s))) fail(`services are: ${SERVICE_IDS.join(', ')} (or all)`)
  return ids as ServiceId[]
}

function pick<T extends string>(value: string | undefined, allowed: readonly T[], name: string): T | undefined {
  if (value === undefined) return undefined
  const v = value.toLowerCase() as T
  return allowed.includes(v) ? v : fail(`${name} is one of: ${allowed.join(', ')}`)
}

function printIncident(ctx: TermCtx, i: Incident): void {
  const length = (i.resolved_at ? Date.parse(i.resolved_at) : Date.now()) - Date.parse(i.started_at)
  ctx.print(`#${i.id} ${i.title}${i.auto ? '  (automatic)' : ''}`, i.resolved_at ? 'plain' : 'error')
  ctx.print(`   ${i.impact} · ${i.services.length ? i.services.join(', ') : 'whole site'} · ${stamp(i.started_at)}${i.resolved_at ? ` to ${stamp(i.resolved_at)}` : ', ongoing'} · ${formatDuration(length)}`, 'dim')
  for (const u of i.updates) ctx.print(`   ${stamp(u.created_at)}  ${u.status}: ${u.message}${u.author ? `  (${u.author})` : ''}`, 'plain')
}

export const STATUS_COMMANDS: TermCommand[] = [
  {
    name: 'downtime', aliases: ['health', 'uptime-check'], group: 'App',
    usage: 'downtime [incidents | show | retry | open | new | update | resolve | edit | rm] ...',
    description: 'Is juicewrldapi.com up? Each service\'s state and 90-day uptime from the server, its incidents, and (administrators) posting incidents',
    covers: [
      'statusApi.fetchStatusPage', 'statusApi.fetchIncidents', 'statusApi.createIncident', 'statusApi.updateIncident',
      'statusApi.postIncidentUpdate', 'statusApi.deleteIncident', 'serviceStatus.recheck',
    ],
    complete: (before, partial) => {
      const p = partial.toLowerCase()
      if (before.length === 0) return SUBS.filter((v) => v.startsWith(p) && (!ADMIN_SUBS.has(v) || termAccess().admin))
      if (before[0] === 'update' && before.length === 2) return INCIDENT_STATUSES.filter((v) => v.startsWith(p))
      return []
    },
    run: async (args, ctx) => {
      const dash = args.split(/\s+--(?:\s+|$)/)
      const { rest, bool, value } = parseArgs(dash[0], ['impact', 'status', 'services', 'title', 'limit'])
      const text = dash.slice(1).join(' -- ').trim()
      const sub = (rest.shift() ?? '').toLowerCase()
      if (ADMIN_SUBS.has(sub) && !termAccess().admin) fail('only administrators can change incidents')

      if (sub === 'open') { useStore.getState().setActiveView('status'); ctx.print('opened the Status page', 'ok'); return }
      if (sub === 'retry') {
        ctx.print('asking /health/…', 'dim')
        const ok = await recheck()
        ctx.print(ok ? 'juicewrldapi.com answers' : getStatus().state === 'offline' ? 'this device is offline' : 'still down', ok ? 'ok' : 'error')
        return
      }
      if (sub === 'incidents') {
        const limit = Math.min(100, Math.max(1, Number(value.get('limit') ?? 10) || 10))
        const r = await fetchIncidents(limit, 0, ctx.signal)
        if (asJson(ctx, bool.has('json'), r)) return
        if (!r.results.length) { ctx.print('no incidents', 'dim'); return }
        r.results.forEach((i) => printIncident(ctx, i))
        if (r.count > r.results.length) ctx.print(`${r.count - r.results.length} older (--limit)`, 'dim')
        return
      }
      if (sub === 'show') {
        const id = incidentId(rest[0])
        const r = await fetchIncidents(100, 0, ctx.signal)
        const i = r.results.find((x) => x.id === id) ?? fail(`no incident #${id} among the latest 100`)
        if (asJson(ctx, bool.has('json'), i)) return
        printIncident(ctx, i)
        return
      }
      if (sub === 'new') {
        const [title, ...msg] = text.split(/\s+\|\s+/)
        const message = msg.join(' | ').trim()
        if (!title?.trim() || !message) fail('usage: downtime new [--impact i] [--status s] [--services a,b] -- <title> | <message>')
        const i = await createIncident({
          title: title.trim(),
          message,
          impact: pick<IncidentImpact>(value.get('impact'), INCIDENT_IMPACTS, 'impact'),
          status: pick<IncidentStatus>(value.get('status'), INCIDENT_STATUSES, 'status'),
          services: servicesArg(value.get('services')),
        })
        ctx.print(`opened incident #${i.id}`, 'ok')
        return
      }
      if (sub === 'update' || sub === 'resolve') {
        const id = incidentId(rest[0])
        const status: IncidentStatus = sub === 'resolve' ? 'resolved' : pick<IncidentStatus>(rest[1], INCIDENT_STATUSES, 'status') ?? fail(`usage:\n  ${USAGE}`)
        const message = text || (sub === 'resolve' ? 'Resolved.' : fail('add the message after --'))
        const i = await postIncidentUpdate(id, status, message)
        ctx.print(`#${i.id} ${status}${i.resolved_at ? ' (closed)' : ''}`, 'ok')
        return
      }
      if (sub === 'edit') {
        const id = incidentId(rest[0])
        const patch = {
          ...(value.has('title') ? { title: value.get('title')! } : {}),
          ...(value.has('impact') ? { impact: pick<IncidentImpact>(value.get('impact'), INCIDENT_IMPACTS, 'impact') } : {}),
          ...(value.has('services') ? { services: servicesArg(value.get('services')) } : {}),
        }
        if (!Object.keys(patch).length) fail('usage: downtime edit <id> [--title t] [--impact i] [--services a,b]')
        await updateIncident(id, patch)
        ctx.print(`#${id} updated`, 'ok')
        return
      }
      if (sub === 'rm') {
        const id = incidentId(rest[0])
        if (!confirmAction(ctx, `Delete incident #${id}? This can't be undone.`, bool.has('y'))) return
        await deleteIncident(id)
        ctx.print(`#${id} deleted`, 'ok')
        return
      }
      if (sub) fail(`usage:\n  ${USAGE}`)

      let result
      try {
        result = await fetchStatusPage(ctx.signal)
      } catch (e) {
        await recheck()
        return fail(`${getStatus().state === 'down' ? 'juicewrldapi.com is down' : 'no status history'}: ${(e as Error).message}`)
      }
      const { page, cached } = result
      if (asJson(ctx, bool.has('json'), { ...page, cached, this_device: getStatus().state })) return
      if (cached) {
        await recheck()
        ctx.print(`juicewrldapi.com doesn't answer from this device. Saved copy from ${stamp(page.generated_at)}:`, 'error')
      } else {
        const stale = page.monitor.stale ? `  (server checks last ran ${page.monitor.last_check ? stamp(page.monitor.last_check) : 'never'})` : ''
        ctx.print(`overall: ${page.overall}${stale}`, OVERALL_TONE[page.overall] ?? 'plain')
      }
      ctx.print(table([
        ['service', 'state', 'latency', `uptime ${page.days}d`],
        ...page.services.map((s) => [s.label, s.state, s.state === 'down' ? s.detail : s.latency_ms != null ? `${s.latency_ms} ms` : '', s.uptime != null ? `${s.uptime}%` : '-']),
      ]), 'plain')
      for (const i of page.active_incidents) printIncident(ctx, i)
    },
  },
]
