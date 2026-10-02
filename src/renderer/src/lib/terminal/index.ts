import { ADMIN_COMMANDS } from './admin'
import { APP_COMMANDS } from './app'
import { LIBRARY_COMMANDS } from './library'
import { PLAYER_COMMANDS } from './player'
import { SETTINGS_COMMANDS } from './settings'
import type { TermCommand, TermGroup } from './types'

export type { TermCommand, TermCtx, TermGroup, TermTone } from './types'

// Everything the terminal can do beyond the chat slash commands and its own
// shell builtins (cd, ls, get, ...). The terminal looks a typed word up here
// before handing it to the chat command runner.
export const TERM_COMMANDS: TermCommand[] = [
  ...PLAYER_COMMANDS,
  ...LIBRARY_COMMANDS,
  ...SETTINGS_COMMANDS,
  ...ADMIN_COMMANDS,
  ...APP_COMMANDS,
]

export const TERM_GROUPS: TermGroup[] = ['Player', 'Library', 'Navigation', 'Settings', 'Admin', 'App']

export function findTermCommand(word: string): TermCommand | null {
  const name = word.trim().replace(/^\//, '').toLowerCase()
  if (!name) return null
  return TERM_COMMANDS.find((c) => c.name === name || c.aliases?.includes(name)) ?? null
}

export const TERM_COMMAND_WORDS: string[] = TERM_COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])])
