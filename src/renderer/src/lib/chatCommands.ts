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

// Drives the Composer's slash-command autocomplete popup - purely
// descriptive, doesn't affect parsing/dispatch.
export interface ChatCommandInfo {
  name: ChatCommandName
  usage: string
  description: string
}

export const CHAT_COMMANDS: ChatCommandInfo[] = [
  { name: 'song', usage: '/song <title>', description: 'Share a song from the library' },
  { name: 'search', usage: '/search <title>', description: 'Search the library and pick a result' },
  { name: 'info', usage: '/info <title>', description: 'Show a song’s era, category, length and credits' },
  { name: 'np', usage: '/np', description: 'Share what you’re currently playing' },
  { name: 'theme', usage: '/theme <name>', description: 'Change your app theme' },
  { name: 'mute', usage: '/mute @user', description: 'Hide a user’s messages for you' },
  { name: 'unmute', usage: '/unmute @user', description: 'Unhide a previously muted user' },
  { name: 'promote', usage: '/promote @user', description: 'Promote a member to server admin' },
  { name: 'kick', usage: '/kick @user', description: 'Remove a member from the server' },
  { name: 'feedback', usage: '/feedback <message>', description: 'Send feedback to the developers' },
  { name: 'help', usage: '/help', description: 'List available commands' },
]

const COMMAND_RE = /^\/(\w+)(?:\s+([\s\S]+))?$/

export function parseChatCommand(text: string): ParsedChatCommand | null {
  const match = COMMAND_RE.exec(text.trim())
  if (!match) return null
  const name = match[1].toLowerCase()
  if (!KNOWN_COMMANDS.has(name)) return null
  return { command: name as ChatCommandName, args: (match[2] ?? '').trim() }
}
