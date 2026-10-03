import { getMe } from './api'
import { getToken, loadConfig } from './config'
import type { Shell } from './shell'

export type Group = 'Files' | 'Library' | 'Player' | 'People' | 'Admin' | 'Fun' | 'Shell' | 'Account'

export interface Command {
  name: string
  aliases?: string[]
  group: Group
  usage: string
  description: string
  /** Takes a path in the file tree (Tab walks the folders); 'dir' skips files. */
  path?: 'dir' | 'any'
  /** Tab candidates for everything after the command word (each one replaces
   *  the whole argument text), for commands that don't take a path. */
  complete?: (arg: string, sh: Shell) => Promise<string[]>
  run: (arg: string, sh: Shell) => void | Promise<void>
}

export const fail = (message: string): never => { throw new Error(message) }

export function needSignIn(what: string): void {
  if (!getToken()) fail(`sign in to ${what} (try: login)`)
}

/** Whether the signed-in account is a platform administrator: the role saved
 *  at login (whoami refreshes it), else asked of the API. */
export async function isAdmin(): Promise<boolean> {
  if (!getToken()) return false
  const saved = loadConfig().user?.role
  if (saved) return saved === 'admin'
  try { return !!(await getMe()).is_administrator } catch { return false }
}

export async function needAdmin(): Promise<void> {
  needSignIn('use the admin commands')
  if (!(await isAdmin())) fail('that needs an administrator account (if your role just changed, run whoami)')
}

export const plural = (n: number, word: string, many = `${word}s`): string => `${n} ${n === 1 ? word : many}`

/** A numbered list the way the site prints one: right-aligned numbers, then a
 *  cut-off note past `limit`. */
export function numbered(rows: string[], limit = 80): string {
  const shown = rows.slice(0, limit).map((r, i) => `${String(i + 1).padStart(3)}  ${r}`)
  return [...shown, ...(rows.length > limit ? [`  … ${rows.length - limit} more`] : [])].join('\n')
}
