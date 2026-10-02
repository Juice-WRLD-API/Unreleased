import { CHANGELOG_MAX } from './appVersion'
import { BROADCAST_LEVELS, type BroadcastLevel } from './broadcastApi'

// Chat slash commands, typed as a message's *entire* body, are intercepted
// by Composer before send - they never reach the room as literal text.
// Anything else starting with "/" (a URL, an unrecognized word, etc.) is left
// alone and sent as normal text, same as before this feature existed.
export type ChatCommandName = 'song' | 'search' | 'info' | 'mute' | 'unmute' | 'theme' | 'sharetheme' | 'np' | 'promote' | 'kick'
  | 'timeout' | 'untimeout' | 'ban' | 'unban' | 'bans' | 'siteban' | 'sitemute' | 'siteunban'
  | 'demote' | 'role' | 'allow' | 'disallow' | 'broadcast' | 'changelog' | 'seen' | 'feedback' | 'help' | 'purge'

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
  'demote', 'role', 'allow', 'disallow', 'broadcast', 'changelog', 'seen', 'feedback', 'help', 'purge',
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
  lastseen: 'seen',
  prune: 'purge',
}

// `-s` / `--share` on a command that normally answers with a card only the
// sender sees: post the same answer to the room instead. Standalone tokens
// anywhere in the args are removed; the rest comes back untouched. Short flags
// can be merged (`-hs`, `-sh5`): the `s` is taken out of a group made only of
// `h`/`s` (plus an optional count) and whatever is left stays in place for the
// command's own parser, so `/np -hs 5` reads as `/np -h 5`.
export function splitShareFlag(args: string): { share: boolean; rest: string } {
  let share = false
  const rest: string[] = []
  for (const t of args.trim().split(/\s+/).filter(Boolean)) {
    if (/^--share$/i.test(t)) { share = true; continue }
    const m = /^-([hs]+)(\d*)$/i.exec(t)
    if (!m || !/s/i.test(m[1])) { rest.push(t); continue }
    share = true
    const letters = m[1].replace(/s/gi, '')
    if (letters) rest.push(`-${letters}${m[2]}`)
  }
  return { share, rest: rest.join(' ') }
}

export const NP_HISTORY_DEFAULT = 10
export const NP_HISTORY_MAX = 25

export type NpArgs = { user: string | null } & (
  | { history: false }
  | { history: true; count: number; capped: boolean }
  | { history: true; error: string }
)

// `/np [@user] [-h [count]]` (`-h` also as `--history` or `-h5`; `-s` merges in
// as `-hs`, see splitShareFlag, which runs first). The `@user` token can sit
// anywhere and is pulled out first. Anything else after /np is ignored, same as
// before the flags existed - bare /np just shares the track. The count is
// capped at NP_HISTORY_MAX whoever's log it is.
export function parseNpArgs(args: string): NpArgs {
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const at = tokens.findIndex((t) => t.startsWith('@') && t.length > 1)
  const user = at >= 0 ? tokens[at].slice(1) : null
  if (at >= 0) tokens.splice(at, 1)
  const m = /^(?:-h|--history)\s*(\S*)\s*$/i.exec(tokens.join(' '))
  if (!m) return { user, history: false }
  if (!m[1]) return { user, history: true, count: NP_HISTORY_DEFAULT, capped: false }
  if (!/^\d+$/.test(m[1]) || Number(m[1]) < 1) return { user, history: true, error: `Usage: /np [@user] -h [count] (1-${NP_HISTORY_MAX})` }
  const n = Number(m[1])
  return { user, history: true, count: Math.min(n, NP_HISTORY_MAX), capped: n > NP_HISTORY_MAX }
}

// `/changelog [count]` (`-s` is taken out first, see splitShareFlag). No count
// is just the latest commit; a count above CHANGELOG_MAX is clamped to it.
export type ChangelogArgs = { error: string } | { count: number; capped: boolean }

export function parseChangelogArgs(args: string): ChangelogArgs {
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return { count: 1, capped: false }
  if (tokens.length > 1 || !/^\d+$/.test(tokens[0]) || Number(tokens[0]) < 1) return { error: `Usage: /changelog [count] [-s] (1-${CHANGELOG_MAX})` }
  const n = Number(tokens[0])
  return { count: Math.min(n, CHANGELOG_MAX), capped: n > CHANGELOG_MAX }
}

export const PURGE_DEFAULT = 10
export const PURGE_MAX = 50

export type PurgeArgs =
  | { error: string }
  | { user: string | null; count: number; capped: boolean }

// `/purge [@user] [count]` (`-s` is taken out first, see splitShareFlag). Both
// tokens can come in either order. Count defaults to PURGE_DEFAULT and is
// clamped to PURGE_MAX - an over-the-cap number purges the max rather than
// failing, and `capped` lets the caller say so.
export function parsePurgeArgs(args: string): PurgeArgs {
  const usage = `Usage: /purge [@user] [count] [-s] (1-${PURGE_MAX})`
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const at = tokens.findIndex((t) => t.startsWith('@') && t.length > 1)
  const user = at >= 0 ? tokens[at].slice(1) : null
  if (at >= 0) tokens.splice(at, 1)
  if (tokens.length > 1) return { error: usage }
  if (tokens.length === 0) return { user, count: PURGE_DEFAULT, capped: false }
  if (!/^\d+$/.test(tokens[0]) || Number(tokens[0]) < 1) return { error: usage }
  const n = Number(tokens[0])
  return { user, count: Math.min(n, PURGE_MAX), capped: n > PURGE_MAX }
}

export interface BroadcastArgs {
  history: boolean
  share: boolean
  level: BroadcastLevel | null
  // Set when `-l` was given something that isn't a level, so the caller can
  // say so instead of silently sending as "info".
  badLevel: string | null
  // `-h` only: how many past broadcasts to show (`/broadcast -h 1` is just the
  // latest). Null when absent or not a positive number.
  count: number | null
  message: string
}

export const BROADCAST_HISTORY_DEFAULT = 10
export const BROADCAST_HISTORY_MAX = 25

// Leading flags only (`-h`, `-s`, `-l <level>`), then the rest of the line is
// the message verbatim - so a "-h" later in the text is just text. Short flags
// can be merged (`-hs`, `-sl warning`); the one that takes a value (`l`) is
// handled last, so `-ls warning` works the same as `-sl warning`.
export function parseBroadcastArgs(args: string): BroadcastArgs {
  const out: BroadcastArgs = { history: false, share: false, level: null, badLevel: null, count: null, message: '' }
  let rest = args.trim()
  for (;;) {
    const m = /^(--history|--share|--level|-[hsl]+)(?:\s+|$)/i.exec(rest)
    if (!m) break
    rest = rest.slice(m[0].length)
    const flag = m[1].toLowerCase()
    const letters = flag.startsWith('--') ? [flag === '--history' ? 'h' : flag === '--share' ? 's' : 'l'] : [...new Set(flag.slice(1))]
    if (letters.includes('h')) out.history = true
    if (letters.includes('s')) out.share = true
    if (!letters.includes('l')) continue
    const word = /^(\S+)(?:\s+|$)/.exec(rest)
    if (!word) { out.badLevel = ''; break }
    rest = rest.slice(word[0].length)
    const level = word[1].toLowerCase()
    if ((BROADCAST_LEVELS as readonly string[]).includes(level)) out.level = level as BroadcastLevel
    else out.badLevel = word[1]
  }
  out.message = rest.trim()
  if (out.history && /^\d+$/.test(out.message) && Number(out.message) >= 1) {
    out.count = Math.min(Number(out.message), BROADCAST_HISTORY_MAX)
    out.message = ''
  }
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
  { name: 'np', usage: '/np  ·  /np [@user] -h [count] [-s]', description: 'Share what you’re playing, or -h for recent plays. Add @user to look at someone else’s (if they share it); -s posts it to the room', aliases: ['nowplaying'], params: ['@user -h count'] },
  { name: 'theme', usage: '/theme <name> [-s]  ·  /theme [-s]', description: 'Change your app theme, or list them with no name (-s posts the answer to the room)', params: ['name'] },
  { name: 'sharetheme', usage: '/sharetheme', description: 'Share your current theme so others can apply it', params: [] },
  { name: 'mute', usage: '/mute @user [-s]', description: 'Hide a user’s messages for you', params: ['user'] },
  { name: 'unmute', usage: '/unmute @user [-s]', description: 'Unhide a previously muted user', params: ['user'] },
  { name: 'promote', usage: '/promote @user [editor|contributor|manager|news] [-s]', description: 'Make a member a server admin, or (site admins) grant a site role', params: ['user', 'role'] },
  { name: 'demote', usage: '/demote @user <editor|contributor|manager|news> [-s]', description: 'Admins: remove a site role from a user', params: ['user', 'role'] },
  { name: 'role', usage: '/role @user [-s]', description: 'Admins: show a user’s site roles and auto-approve settings', aliases: ['roles'], params: ['user'] },
  { name: 'allow', usage: '/allow @user <edits|comp> [-s]', description: 'Admins: turn on auto-approve for a user’s edit or comp proposals', params: ['user', 'type'] },
  { name: 'disallow', usage: '/disallow @user <edits|comp> [-s]', description: 'Admins: turn auto-approve back off', aliases: ['deny'], params: ['user', 'type'] },
  { name: 'purge', usage: '/purge [@user] [count] [-s]', description: `Delete the latest messages in this room, up to ${PURGE_MAX} (default ${PURGE_DEFAULT}). Add @user to only delete theirs. Moderators only, except for your own`, aliases: ['prune'], params: ['@user count'] },
  { name: 'kick', usage: '/kick @user', description: 'Remove a member from the server (they can rejoin)', params: ['user'] },
  { name: 'timeout', usage: '/timeout @user <minutes>', description: 'Temporarily stop a member from posting', aliases: ['to'], params: ['user', 'minutes'] },
  { name: 'untimeout', usage: '/untimeout @user', description: 'Lift a member’s timeout early', aliases: ['unto'], params: ['user'] },
  { name: 'ban', usage: '/ban @user [reason]', description: 'Ban a user from this server', params: ['user', 'reason'] },
  { name: 'unban', usage: '/unban @user', description: 'Lift a server ban so they can rejoin', params: ['user'] },
  { name: 'bans', usage: '/bans [-s]', description: 'List everyone banned from this server', params: [] },
  { name: 'siteban', usage: '/siteban @user [reason]', description: 'Admins: ban a user from all chat and DMs', params: ['user', 'reason'] },
  { name: 'sitemute', usage: '/sitemute @user [minutes]', description: 'Admins: silence a user everywhere', params: ['user', 'minutes'] },
  { name: 'siteunban', usage: '/siteunban @user', description: 'Admins: revoke every site-wide action on a user (ban, mute or timeout)', aliases: ['siteunmute', 'siteuntimeout'], params: ['user'] },
  { name: 'broadcast', usage: '/broadcast [-s] [-l level] <message>  ·  /broadcast -h [count] [-s]', description: 'Admins: push a banner to everyone online, or -h [count] to see past broadcasts (-s posts them to the room)', aliases: ['bc'], params: ['message'] },
  { name: 'changelog', usage: '/changelog [count] [-s]', description: `Show the latest commit and whether it’s built and live yet. Add a count (up to ${CHANGELOG_MAX}) for recent commit history (-s posts it to the room)`, aliases: ['commit'], params: ['count'] },
  { name: 'seen', usage: '/seen @user [-s]', description: 'Show when a user was last online or active', aliases: ['lastseen'], params: ['user'] },
  { name: 'feedback', usage: '/feedback <message>', description: 'Send feedback to the developers', params: ['message'] },
  { name: 'help', usage: '/help [command] [-s]', description: 'List available commands, or show just one (-s posts it to the room)', params: ['command'] },
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
