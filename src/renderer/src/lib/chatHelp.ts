import { CHAT_COMMANDS, type ChatCommandInfo } from './chatCommands'

// `help <command>` for both the chat box (/help commit) and the admin terminal:
// one command looked up by name or alias, with or without the slash.
export function findChatCommand(word: string): ChatCommandInfo | null {
  const name = word.trim().replace(/^\//, '').toLowerCase()
  if (!name) return null
  return CHAT_COMMANDS.find((c) => c.name === name || c.aliases?.includes(name)) ?? null
}

export function chatCommandHelp(info: ChatCommandInfo): { title: string; text: string } {
  const aliases = info.aliases?.length ? `\nAliases: ${info.aliases.map((a) => `/${a}`).join(', ')}` : ''
  return { title: `/${info.name}`, text: `${info.usage}\n${info.description}${aliases}` }
}
