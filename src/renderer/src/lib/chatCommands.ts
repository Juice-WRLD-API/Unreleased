// Chat slash commands, typed as a message's *entire* body, are intercepted
// by Composer before send - they never reach the room as literal text.
// Anything else starting with "/" (a URL, an unrecognized word, etc.) is left
// alone and sent as normal text, same as before this feature existed.
export type ChatCommandName = 'song' | 'search' | 'mute' | 'unmute' | 'theme' | 'np' | 'promote' | 'feedback' | 'help'

export interface ParsedChatCommand {
  command: ChatCommandName
  // Raw trailing text after the command name, already trimmed. Empty string
  // when the command was typed with no argument (e.g. bare "/np") - each
  // command decides for itself whether that's valid.
  args: string
}

const KNOWN_COMMANDS = new Set<string>(['song', 'search', 'mute', 'unmute', 'theme', 'np', 'promote', 'feedback', 'help'])

const COMMAND_RE = /^\/(\w+)(?:\s+([\s\S]+))?$/

export function parseChatCommand(text: string): ParsedChatCommand | null {
  const match = COMMAND_RE.exec(text.trim())
  if (!match) return null
  const name = match[1].toLowerCase()
  if (!KNOWN_COMMANDS.has(name)) return null
  return { command: name as ChatCommandName, args: (match[2] ?? '').trim() }
}
