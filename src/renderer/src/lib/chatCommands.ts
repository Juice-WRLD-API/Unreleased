import { BROADCAST_LEVELS, type BroadcastLevel } from './broadcastApi'

// Chat slash commands, typed as a message's *entire* body, are intercepted
// by Composer before send - they never reach the room as literal text.
// Anything else starting with "/" (a URL, an unrecognized word, etc.) is left
// alone and sent as normal text, same as before this feature existed.
export type ChatCommandName = 'song' | 'search' | 'info' | 'mute' | 'unmute' | 'theme' | 'sharetheme' | 'np' | 'promote' | 'kick'
  | 'timeout' | 'untimeout' | 'ban' | 'unban' | 'bans' | 'siteban' | 'sitemute' | 'siteunban'
  | 'demote' | 'role' | 'allow' | 'disallow' | 'broadcast' | 'changelog' | 'feedback' | 'help'

export interface ParsedChatCommand {
  command: ChatCommandName
  // Raw trailing text after the command name, already trimmed. Empty string
  // when the command was typed with no argument (e.g. bare "/np") - each
  // command decides for itself whether that's valid.
  args: string
}

const KNOWN_COMMANDS = new Set<string>([
  'song', 'search', 'info', 'mute', 'unmute', 'theme', 'sharetheme', 'np', 'promote', 'kick',
  'timeout', 'untimeout', 'ban', 'unban', 'bans', 'siteban', 'sitemute', 'siteunban',
  'demote', 'role', 'allow', 'disallow', 'broadcast', 'changelog', 'feedback', 'help',
])

// Alternate spellings that resolve to a canonical command before dispatch -
// Composer only ever sees the canonical name, so adding an alias here never
// requires touching the switch that runs each command.
const ALIASES: Record<string, ChatCommandName> = {
  nowplaying: 'np',
  to: 'timeout',
  unto: 'untimeout',
  // One revoke covers every site-wide action on a user (ban, mute, timeout
  // alike), so the obvious spellings all land on the same command rather than
  // each needing an endpoint that doesn't exist.
  siteunmute: 'siteunban',
  siteuntimeout: 'siteunban',
  unsiteban: 'siteunban',
  roles: 'role',
  deny: 'disallow',
  bc: 'broadcast',
  commit: 'changelog',
}

// `-s` / `--share` on a command that normally answers with a card only the
// sender sees: post the same answer to the room instead. Standalone tokens
// anywhere in the args are removed; the rest comes back untouched.
export function splitShareFlag(args: string): { share: boolean; rest: string } {
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const rest = tokens.filter((t) => !/^(?:-s|--share)$/i.test(t))
  return { share: rest.length !== tokens.length, rest: rest.join(' ') }
}

export const NP_HISTORY_DEFAULT = 10
export const NP_HISTORY_MAX = 25

export type NpArgs =
  | { history: false }
  | { history: true; count: number; capped: boolean }
  | { history: true; error: string }

// `/np -h [count]` (also `--history`, and `-h5`). Anything else after /np is
// ignored, same as before the flag existed - bare /np just shares the track.
export function parseNpArgs(args: string): NpArgs {
  const m = /^(?:-h|--history)\s*(\S*)\s*$/i.exec(args.trim())
  if (!m) return { history: false }
  if (!m[1]) return { history: true, count: NP_HISTORY_DEFAULT, capped: false }
  if (!/^\d+$/.test(m[1]) || Number(m[1]) < 1) return { history: true, error: `Usage: /np -h [count] (1-${NP_HISTORY_MAX})` }
  const n = Number(m[1])
  return { history: true, count: Math.min(n, NP_HISTORY_MAX), capped: n > NP_HISTORY_MAX }
}

export interface BroadcastArgs {
  history: boolean
  share: boolean
  level: BroadcastLevel | null
  // Set when `-l` was given something that isn't a level, so the caller can
  // say so instead of silently sending as "info".
  badLevel: string | null
  message: string
}

// Leading flags only (`-h`, `-l <level>`), then the rest of the line is the
// message verbatim - so a "-h" later in the text is just text.
export function parseBroadcastArgs(args: string): BroadcastArgs {
  const out: BroadcastArgs = { history: false, share: false, level: null, badLevel: null, message: '' }
  let rest = args.trim()
  for (;;) {
    const m = /^(-h|--history|-s|--share|-l|--level)(?:\s+|$)/i.exec(rest)
    if (!m) break
    const flag = m[1].toLowerCase()
    rest = rest.slice(m[0].length)
    if (flag === '-h' || flag === '--history') { out.history = true; continue }
    if (flag === '-s' || flag === '--share') { out.share = true; continue }
    const word = /^(\S+)(?:\s+|$)/.exec(rest)
    if (!word) { out.badLevel = ''; break }
    rest = rest.slice(word[0].length)
    const level = word[1].toLowerCase()
    if ((BROADCAST_LEVELS as readonly string[]).includes(level)) out.level = level as BroadcastLevel
    else out.badLevel = word[1]
  }
  out.message = rest.trim()
  return out
}

// Site-wide staff roles an administrator can grant from chat - the same four
// toggles as the admin console's Manage panel. `editor` is a role string on
// the account; the rest are flags layered on top of it (see adminUpdateUser).
export type SiteRole = 'editor' | 'contributor' | 'manager' | 'news'
export type AutoApproveFlag = 'auto_approve_proposals' | 'auto_approve_comp_proposals'

const normalizeWord = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, '')

export function resolveSiteRole(word: string): SiteRole | null {
  switch (normalizeWord(word)) {
    case 'editor': case 'editors': case 'edit': return 'editor'
    case 'contributor': case 'contributors': case 'contrib': return 'contributor'
    case 'manager': case 'managers': case 'mod': return 'manager'
    case 'news': case 'newsposter': case 'newswriter': return 'news'
    default: return null
  }
}

// Accepts the short forms ("edits", "comp") as well as the console's own
// labels ("auto-approve-edits"), so whichever the admin remembers works.
export function resolveAutoApproveFlag(word: string): AutoApproveFlag | null {
  switch (normalizeWord(word).replace(/^autoapprove/, '')) {
    case 'edits': case 'edit': case 'proposals': case 'proposal': return 'auto_approve_proposals'
    case 'comp': case 'comps': case 'compproposals': case 'compproposal': return 'auto_approve_comp_proposals'
    default: return null
  }
}

// Drives the Composer's slash-command autocomplete popup - purely
// descriptive, doesn't affect parsing/dispatch.
export interface ChatCommandInfo {
  name: ChatCommandName
  usage: string
  description: string
  aliases?: string[]
  // Parameter names in order, e.g. ['user'] or ['user', 'reason']. Every
  // command today takes at most one (the last param always soaks up the
  // rest of the line, same as `args`), but Composer renders whichever one
  // as the "no parameters" case.
  params: string[]
}

export const CHAT_COMMANDS: ChatCommandInfo[] = [
  { name: 'song', usage: '/song <title>', description: 'Share a song from the library', params: ['title'] },
  { name: 'search', usage: '/search <title>', description: 'Search the library and pick a result', params: ['title'] },
  { name: 'info', usage: '/info <title>', description: 'Show a song’s era, category, length and credits', params: ['title'] },
  { name: 'np', usage: '/np  ·  /np -h [count] [-s]', description: 'Share what you’re currently playing, or -h to see your recent plays (-s posts them to the room)', aliases: ['nowplaying'], params: ['-h count'] },
  { name: 'theme', usage: '/theme <name>  ·  /theme [-s]', description: 'Change your app theme, or list them with no name (-s posts the list to the room)', params: ['name'] },
  { name: 'sharetheme', usage: '/sharetheme', description: 'Share your current theme so others can apply it', params: [] },
  { name: 'mute', usage: '/mute @user', description: 'Hide a user’s messages for you', params: ['user'] },
  { name: 'unmute', usage: '/unmute @user', description: 'Unhide a previously muted user', params: ['user'] },
  { name: 'promote', usage: '/promote @user [editor|contributor|manager|news]', description: 'Make a member a server admin, or (site admins) grant a site role', params: ['user', 'role'] },
  { name: 'demote', usage: '/demote @user <editor|contributor|manager|news>', description: 'Admins: remove a site role from a user', params: ['user', 'role'] },
  { name: 'role', usage: '/role @user', description: 'Admins: show a user’s site roles and auto-approve settings', aliases: ['roles'], params: ['user'] },
  { name: 'allow', usage: '/allow @user <edits|comp>', description: 'Admins: turn on auto-approve for a user’s edit or comp proposals', params: ['user', 'type'] },
  { name: 'disallow', usage: '/disallow @user <edits|comp>', description: 'Admins: turn auto-approve back off', aliases: ['deny'], params: ['user', 'type'] },
  { name: 'kick', usage: '/kick @user', description: 'Remove a member from the server (they can rejoin)', params: ['user'] },
  { name: 'timeout', usage: '/timeout @user <minutes>', description: 'Temporarily stop a member from posting', aliases: ['to'], params: ['user', 'minutes'] },
  { name: 'untimeout', usage: '/untimeout @user', description: 'Lift a member’s timeout early', aliases: ['unto'], params: ['user'] },
  { name: 'ban', usage: '/ban @user [reason]', description: 'Ban a user from this server', params: ['user', 'reason'] },
  { name: 'unban', usage: '/unban @user', description: 'Lift a server ban so they can rejoin', params: ['user'] },
  { name: 'bans', usage: '/bans', description: 'List everyone banned from this server', params: [] },
  { name: 'siteban', usage: '/siteban @user [reason]', description: 'Admins: ban a user from all chat and DMs', params: ['user', 'reason'] },
  { name: 'sitemute', usage: '/sitemute @user [minutes]', description: 'Admins: silence a user everywhere', params: ['user', 'minutes'] },
  { name: 'siteunban', usage: '/siteunban @user', description: 'Admins: revoke every site-wide action on a user (ban, mute or timeout)', aliases: ['siteunmute', 'siteuntimeout'], params: ['user'] },
  { name: 'broadcast', usage: '/broadcast [-l level] <message>  ·  /broadcast -h [-s]', description: 'Admins: push a banner to everyone online, or -h to see past broadcasts (-s posts them to the room)', aliases: ['bc'], params: ['message'] },
  { name: 'changelog', usage: '/changelog [-s]', description: 'Show the latest commit and whether it’s built and live yet (-s posts it to the room)', aliases: ['commit'], params: [] },
  { name: 'feedback', usage: '/feedback <message>', description: 'Send feedback to the developers', params: ['message'] },
  { name: 'help', usage: '/help [-s]', description: 'List available commands (-s posts the list to the room)', params: [] },
]

// Which of a command's params the user is currently typing, given the raw
// (untrimmed) text after the command name. Only the final param can contain
// spaces (it captures the rest of the line), so completed leading params are
// counted as whitespace-separated tokens; typing a trailing space moves on
// to the next one.
export function currentParamIndex(params: string[], argsText: string): number {
  if (params.length <= 1) return 0
  const tokens = argsText.split(/\s+/).filter(Boolean)
  const endsWithSpace = /\s$/.test(argsText)
  const slot = tokens.length - (endsWithSpace ? 0 : 1)
  return Math.min(Math.max(slot, 0), params.length - 1)
}

const COMMAND_RE = /^\/(\w+)(?:\s+([\s\S]+))?$/

export function parseChatCommand(text: string): ParsedChatCommand | null {
  const match = COMMAND_RE.exec(text.trim())
  if (!match) return null
  const typed = match[1].toLowerCase()
  const name = ALIASES[typed] ?? typed
  if (!KNOWN_COMMANDS.has(name)) return null
  return { command: name as ChatCommandName, args: (match[2] ?? '').trim() }
}
