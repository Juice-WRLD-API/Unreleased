import { useStore } from '../../store/useStore'
import { checkServices, clearOutages, formatDuration, getStatus, OVERALL_TEXT, recheck, type ServiceResult } from '../serviceStatus'
import { asJson, confirmAction, fail, parseArgs, table, type TermCommand, type TermTone } from './types'

// The Status page from the terminal: probe every service, list this device's
// outages, or ask /health/ again while the server is down.

const USAGE = [
  'downtime [--json]           probe every service now',
  'downtime history [--json]   outages this device saw',
  'downtime retry              ask /health/ again',
  'downtime clear [-y]         forget the outage history',
  'downtime open               open the Status page',
].join('\n  ')

const STATE_TONE: Record<ServiceResult['state'], TermTone> = { up: 'ok', slow: 'plain', down: 'error' }

const stamp = (t: number): string => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export const STATUS_COMMANDS: TermCommand[] = [
  {
    name: 'downtime', aliases: ['health', 'uptime-check'], group: 'App',
    usage: 'downtime [history | retry | clear | open] [--json]',
    description: 'Is juicewrldapi.com up? Checks the API, catalogue, files, streaming and 999 FM, and lists the outages this device has seen',
    covers: ['serviceStatus.checkServices', 'serviceStatus.recheck', 'serviceStatus.clearOutages'],
    complete: (before, partial) => before.length === 0 ? ['history', 'retry', 'clear', 'open'].filter((v) => v.startsWith(partial.toLowerCase())) : [],
    run: async (args, ctx) => {
      const { rest, bool } = parseArgs(args)
      const sub = (rest.shift() ?? '').toLowerCase()

      if (sub === 'open') { useStore.getState().setActiveView('status'); ctx.print('opened the Status page', 'ok'); return }
      if (sub === 'retry') {
        ctx.print('asking /health/…', 'dim')
        ctx.print((await recheck()) ? 'juicewrldapi.com answers' : 'still down', (getStatus().overall === 'down' ? 'error' : 'ok'))
        return
      }
      if (sub === 'clear') {
        if (!confirmAction(ctx, 'Forget the outages this device has seen?', bool.has('y'))) return
        clearOutages()
        ctx.print('outage history cleared', 'ok')
        return
      }
      if (sub === 'history') {
        const { outages } = getStatus()
        if (asJson(ctx, bool.has('json'), outages)) return
        if (!outages.length) { ctx.print('no outages seen on this device', 'dim'); return }
        const now = Date.now()
        ctx.print(table([['started', 'ended', 'length'], ...outages.map((o) => [
          stamp(o.start),
          o.end === null ? 'ongoing' : stamp(o.end),
          `${o.endApprox ? 'at least ' : ''}${formatDuration((o.end ?? now) - o.start)}`,
        ])]), 'plain')
        return
      }
      if (sub) fail(`usage:\n  ${USAGE}`)

      const results = await checkServices()
      const s = getStatus()
      if (asJson(ctx, bool.has('json'), { overall: s.overall, checked_at: s.checkedAt, services: results })) return
      ctx.print(OVERALL_TEXT[s.overall], s.overall === 'up' ? 'ok' : s.overall === 'down' || s.overall === 'partial' ? 'error' : 'plain')
      for (const r of results) {
        const time = r.state === 'down' ? (r.detail ?? '') : r.ms != null ? `${r.ms} ms` : ''
        ctx.print(`  ${r.label.padEnd(10)} ${r.state.padEnd(5)} ${time}`, STATE_TONE[r.state])
      }
      const open = s.outages[0]?.end === null ? s.outages[0] : null
      if (open) ctx.print(`down since ${stamp(open.start)} (${formatDuration(Date.now() - open.start)})`, 'dim')
    },
  },
]
