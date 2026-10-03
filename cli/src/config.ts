import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Everything the CLI keeps lives in ~/.unreleased (or $UNRELEASED_HOME):
//   config.json  the API token and the account it belongs to, API override
//   history      typed commands, one per line, like a shell's
//   aliases.json the user's own shortcuts (alias name=command)
//   rc           commands run when the interactive shell starts
export const HOME_DIR = process.env.UNRELEASED_HOME || join(homedir(), '.unreleased')
const CONFIG_FILE = join(HOME_DIR, 'config.json')
const HISTORY_FILE = join(HOME_DIR, 'history')
const ALIAS_FILE = join(HOME_DIR, 'aliases.json')
export const RC_FILE = join(HOME_DIR, 'rc')

export const HISTORY_MAX = 300

export interface SavedUser { id: number; name: string; role: string }

export interface Config {
  token?: string
  user?: SavedUser
  /** Overrides the API base (UNRELEASED_API wins over this). */
  api?: string
}

function readJson<T>(file: string, fallback: T): T {
  try { return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback } catch { return fallback }
}

// The token is a password-equivalent, so the files are owner-only where the
// platform has such a thing (chmod is a no-op on Windows).
function writePrivate(file: string, text: string): void {
  mkdirSync(HOME_DIR, { recursive: true })
  writeFileSync(file, text, { mode: 0o600 })
  try { chmodSync(file, 0o600) } catch { /* not supported here */ }
}

let config: Config | null = null

export function loadConfig(): Config {
  config ??= readJson<Config>(CONFIG_FILE, {})
  return config
}

export function saveConfig(next: Config): void {
  config = next
  writePrivate(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n')
}

/** The token requests are sent with: UNRELEASED_TOKEN, else the saved one. */
export function getToken(): string | null {
  return process.env.UNRELEASED_TOKEN || loadConfig().token || null
}

export function loadHistory(): string[] {
  try {
    return existsSync(HISTORY_FILE) ? readFileSync(HISTORY_FILE, 'utf8').split('\n').filter(Boolean).slice(-HISTORY_MAX) : []
  } catch { return [] }
}

export function saveHistory(lines: string[]): void {
  try { writePrivate(HISTORY_FILE, lines.slice(-HISTORY_MAX).join('\n') + '\n') } catch { /* the session still works */ }
}

export function loadAliases(): Record<string, string> {
  return readJson<Record<string, string>>(ALIAS_FILE, {})
}

export function saveAliases(aliases: Record<string, string>): void {
  try { writePrivate(ALIAS_FILE, JSON.stringify(aliases, null, 2) + '\n') } catch { /* the session still works */ }
}

export function readRc(): string[] {
  try {
    return existsSync(RC_FILE) ? readFileSync(RC_FILE, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) : []
  } catch { return [] }
}
