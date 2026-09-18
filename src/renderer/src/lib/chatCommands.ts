// Chat slash commands, typed as a message's *entire* body, are intercepted
// by Composer before send - they never reach the room as literal text.
// Anything else starting with "/" (a URL, an unrecognized word, etc.) is left
// alone and sent as normal text, same as before this feature existed.
export type ChatCommandName = 'song' | 'search' | 'info' | 'mute' | 'unmute' | 'theme' | 'np' | 'promote' | 'kick' | 'feedback' | 'help'

export interface ParsedChatCommand {
  command: ChatCommandName
  // Raw trailing text after the command name, already trimmed. Empty string
  // when the command was typed with no argument (e.g. bare "/np") - each
  // command decides for itself whether that's valid.
  args: string
}

const KNOWN_COMMANDS = new Set<string>(['song', 'search', 'info', 'mute', 'unmute', 'theme', 'np', 'promote', 'kick', 'feedback', 'help'])

// Alternate spellings that resolve to a canonical command before dispatch -
// Composer only ever sees the canonical name, so adding an alias here never
// requires touching the switch that runs each command.
const ALIASES: Record<string, ChatCommandName> = {
  nowplaying: 'np',
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
  { name: 'np', usage: '/np', description: 'Share what you’re currently playing', aliases: ['nowplaying'], params: [] },
  { name: 'theme', usage: '/theme <name>', description: 'Change your app theme', params: ['name'] },
  { name: 'mute', usage: '/mute @user', description: 'Hide a user’s messages for you', params: ['user'] },
  { name: 'unmute', usage: '/unmute @user', description: 'Unhide a previously muted user', params: ['user'] },
  { name: 'promote', usage: '/promote @user', description: 'Promote a member to server admin', params: ['user'] },
  { name: 'kick', usage: '/kick @user', description: 'Remove a member from the server', params: ['user'] },
  { name: 'feedback', usage: '/feedback <message>', description: 'Send feedback to the developers', params: ['message'] },
  { name: 'help', usage: '/help', description: 'List available commands', params: [] },
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
