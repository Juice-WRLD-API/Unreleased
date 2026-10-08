import { fetchProposalPropagation } from '../cdnAdminApi'
import { adminUpdateUser } from '../userApi'
import { asJson, fail, idArg, parseArgs, parseBool, table, type TermCommand } from './types'
import { resolveUser, directory } from './users'

// More of the Admin page: editing a user's role and switches, and watching a
// proposal spread across the CDN. Admin-only like the rest of the group.
const ROLES = ['editor', 'contributor', 'manager', 'applicant'] as const
type Role = (typeof ROLES)[number]

const SWITCHES: Record<string, 'contributor_enabled' | 'manager_enabled' | 'news_enabled' | 'is_active' | 'auto_approve_proposals' | 'auto_approve_comp_proposals'> = {
  contributor: 'contributor_enabled', manager: 'manager_enabled', news: 'news_enabled', active: 'is_active', 'auto-edits': 'auto_approve_proposals', 'auto-comp': 'auto_approve_comp_proposals',
}

export const ADMIN_EXTRA_COMMANDS: TermCommand[] = [
  {
    name: 'usermod', group: 'Admin',
    usage: `usermod <user> [--role ${ROLES.join('|')}] [--contributor on|off] [--manager on|off] [--news on|off] [--active on|off] [--auto-edits on|off] [--auto-comp on|off]`,
    description: 'Change a user’s role and switches (the Admin page’s Users tab). <user> is a name or id as for `user`',
    covers: ['userApi.adminUpdateUser'],
    complete: async (before, partial) => (before.length === 0 ? (await directory()).map((u) => u.username).filter((n) => n.toLowerCase().startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => {
      const { rest, value } = parseArgs(args, ['role', ...Object.keys(SWITCHES)])
      if (rest.length === 0) fail('usage: usermod <user> --role … / --active off …')
      const user = await resolveUser(rest.join(' '))
      const patch: Parameters<typeof adminUpdateUser>[1] = {}
      if (value.has('role')) {
        const role = (value.get('role') as string).toLowerCase() as Role
        if (!ROLES.includes(role)) fail(`--role is one of ${ROLES.join(', ')}`)
        patch.role = role
      }
      for (const [flag, field] of Object.entries(SWITCHES)) {
        const v = value.get(flag)
        if (v === undefined) continue
        patch[field] = parseBool(v) ?? fail(`--${flag} takes on or off`)
      }
      if (Object.keys(patch).length === 0) fail('nothing to change - give --role or a switch')
      const u = await adminUpdateUser(user.id, patch)
      ctx.print(`${u.username}: ${u.role}${u.is_active ? '' : ' (inactive)'} · contributor ${u.contributor_enabled ? 'on' : 'off'} · auto-approve edits ${u.auto_approve_proposals ? 'on' : 'off'}, comp ${u.auto_approve_comp_proposals ? 'on' : 'off'}`, 'ok')
    },
  },
  {
    name: 'propagation', group: 'Admin', usage: 'propagation <proposalId> [--json]',
    description: 'How far an approved comp proposal has spread across the CDN nodes',
    covers: ['cdnAdminApi.fetchProposalPropagation'],
    run: async (args, ctx) => {
      const { rest, bool } = parseArgs(args)
      const p = await fetchProposalPropagation(idArg(rest[0], 'propagation <proposalId>'))
      if (asJson(ctx, bool.has('json'), p)) return
      ctx.print([
        `proposal #${p.proposal.id}  ${p.proposal.change_type} ${p.proposal.file_path}  (${p.proposal.status})`,
        p.nodes.length ? table(p.nodes.map((n) => [n.name, n.online ? 'online' : 'offline', String(n.state), [n.city, n.country_code].filter(Boolean).join(', ')])) : 'no nodes',
      ].join('\n'))
    },
  },
]
