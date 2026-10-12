import { relativeTime } from '../../components/adminShared'
import {
  createBetaCode, deleteBetaCode, deleteBetaVersion, fetchBetaCodes, fetchBetaVersions,
  updateBetaCode, updateBetaVersion, type BetaCode, type BetaVersion,
} from '../betaAdminApi'
import { confirmAction, fail, parseArgs, type TermCommand, type TermCtx } from './types'

// The Admin page's Beta tab (lib/betaAdminApi.ts on the site): the access
// codes people enter in the installer or Settings, and the builds /beta/versions
// lists for them. Same endpoints and rules as the site.

const ACTIONS = ['add', 'on', 'off', 'delete', 'expire'] as const
type Action = typeof ACTIONS[number]

const codeState = (c: BetaCode): string => (c.is_valid ? 'live' : c.is_active ? 'expired' : 'off')
const bare = (v: string): string => v.trim().replace(/^v/i, '')

function pickCode(codes: BetaCode[], arg: string): BetaCode {
  const q = arg.trim().toLowerCase()
  if (!q) fail('say which code (see: beta codes)')
  const exact = codes.filter((c) => c.code.toLowerCase() === q || String(c.id) === q)
  const hits = exact.length ? exact : codes.filter((c) => c.code.toLowerCase().startsWith(q) || c.label.toLowerCase().includes(q))
  if (hits.length === 0) fail(`no code matches "${arg.trim()}" (see: beta codes)`)
  if (hits.length > 1) fail(`"${arg.trim()}" matches ${hits.length} codes: ${hits.slice(0, 5).map((c) => c.code).join(', ')}`)
  return hits[0]
}

function pickVersion(versions: BetaVersion[], arg: string): BetaVersion {
  const q = bare(arg).toLowerCase()
  if (!q) fail('say which build (see: beta builds)')
  const hit = versions.find((v) => v.version.toLowerCase() === q) ?? versions.find((v) => String(v.id) === q)
  return hit ?? fail(`no build "${arg.trim()}" (see: beta builds)`)
}

async function codes(rest: string[], bool: Set<string>, value: Map<string, string>, ctx: TermCtx): Promise<void> {
  const print = ctx.print
  const [action, ...words] = rest
  if (!action) {
    const list = await fetchBetaCodes()
    if (list.length === 0) { print('no codes'); return }
    print(list.map((c) => `${c.code.slice(0, 26).padEnd(28)}${codeState(c).padEnd(9)}${(c.label || '—').slice(0, 24).padEnd(26)}${c.expires_at ? `expires ${new Date(c.expires_at).toLocaleDateString()}` : 'no expiry'}`).join('\n'))
    return
  }
  if (!(ACTIONS as readonly string[]).includes(action)) fail(`beta codes: ${ACTIONS.join('|')} (or no action to list)`)
  switch (action as Action) {
    case 'add': {
      const code = words[0] ?? fail('usage: beta codes add <code> [--label text] [--expires YYYY-MM-DD]')
      const exp = value.get('expires')
      const expires_at = exp ? new Date(`${exp}T23:59:59`).toISOString() : null
      const c = await createBetaCode({ code, label: value.get('label') ?? '', is_active: true, expires_at })
      print(`created ${c.code}`, 'ok'); return
    }
    case 'expire': {
      const list = await fetchBetaCodes()
      const c = pickCode(list, words[0] ?? '')
      const when = words[1] ?? fail('usage: beta codes expire <code> <YYYY-MM-DD|never>')
      await updateBetaCode(c.id, { expires_at: when === 'never' ? null : new Date(`${when}T23:59:59`).toISOString() })
      print(`${c.code}: ${when === 'never' ? 'no expiry' : `expires ${when}`}`, 'ok'); return
    }
    default: {
      const c = pickCode(await fetchBetaCodes(), words.join(' '))
      if (action === 'delete') {
        if (!confirmAction(ctx, `Delete code ${c.code}? Anyone using it loses beta access.`, bool.has('y'))) return
        await deleteBetaCode(c.id)
        print(`deleted ${c.code}`, 'ok'); return
      }
      await updateBetaCode(c.id, { is_active: action === 'on' })
      print(`${c.code}: ${action}`, 'ok')
    }
  }
}

async function builds(rest: string[], bool: Set<string>, value: Map<string, string>, ctx: TermCtx): Promise<void> {
  const print = ctx.print
  const [action, ...words] = rest
  if (!action) {
    const list = await fetchBetaVersions()
    if (list.length === 0) { print('no beta builds'); return }
    print(list.map((v) => `${v.version.padEnd(22)}${(v.is_active ? 'active' : 'off').padEnd(8)}${relativeTime(v.published_at ?? v.created_at).padEnd(12)}${v.file_path}`).join('\n'))
    return
  }
  switch (action) {
    case 'on': case 'off': {
      const v = pickVersion(await fetchBetaVersions(), words.join(' '))
      await updateBetaVersion(v.id, { is_active: action === 'on' })
      print(`${v.version}: ${action}`, 'ok'); return
    }
    case 'delete': {
      const v = pickVersion(await fetchBetaVersions(), words.join(' '))
      if (!confirmAction(ctx, `Delete beta ${v.version}? The build file stays on the server.`, bool.has('y'))) return
      await deleteBetaVersion(v.id)
      print(`deleted ${v.version}`, 'ok'); return
    }
    default: fail('beta builds: on|off|delete (or no action to list) - publishing a build needs a file, use the Admin page')
  }
}

export const BETA_COMMANDS: TermCommand[] = [
  {
    name: 'beta', group: 'Admin',
    usage: 'beta codes [add <code> [--label t] [--expires YYYY-MM-DD] | on|off|delete <code> [-y] | expire <code> <date|never>]  ·  beta builds [on|off|delete <version> [-y]]',
    description: 'The Admin page’s Beta tab: list, add, switch off or delete beta access codes and published beta builds; publishing a build file is done on the Admin page',
    covers: [
      'betaAdminApi.fetchBetaCodes', 'betaAdminApi.createBetaCode', 'betaAdminApi.updateBetaCode', 'betaAdminApi.deleteBetaCode',
      'betaAdminApi.fetchBetaVersions', 'betaAdminApi.updateBetaVersion', 'betaAdminApi.deleteBetaVersion',
    ],
    complete: (before, partial) => {
      const p = partial.toLowerCase()
      if (before.length === 0) return ['codes', 'builds'].filter((s) => s.startsWith(p))
      if (before.length === 1) return (before[0] === 'codes' ? ['add', 'on', 'off', 'delete', 'expire'] : ['on', 'off', 'delete']).filter((s) => s.startsWith(p))
      return []
    },
    run: async (args, ctx) => {
      const { rest, bool, value } = parseArgs(args, ['label', 'expires'])
      const [what, ...tail] = rest
      if (what === 'codes') return codes(tail, bool, value, ctx)
      if (what === 'builds') return builds(tail, bool, value, ctx)
      fail('usage: beta codes … | beta builds …')
    },
  },
]
