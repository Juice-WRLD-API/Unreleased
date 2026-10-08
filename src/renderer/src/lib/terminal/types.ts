import type { ChatUserBrief } from '../chatApi'
import type { RoomRef } from '../../store/chatStore'

// Terminal commands beyond the chat slash commands: the terminal's way of
// doing what the UI does (playback, settings, library, navigation, review
// queues, ...). Each one calls the same store actions and API functions the
// matching screen does, so the result is identical to clicking. A command that
// can't proceed throws an Error with a short message; the terminal prints it.
export type TermTone = 'error' | 'ok' | 'plain' | 'dim'

/** A full-panel mode a command can hand the terminal (it replaces the scrollback
 *  until the user leaves it, then the shell is back as it was). */
export type TermScreen =
  | { kind: 'matrix' }
  | { kind: 'visualizer' }
  | { kind: 'karaoke' }
  | { kind: 'watch'; command: string; seconds: number }
  | { kind: 'wordle'; unlimited: boolean }
  | { kind: 'heardle' }

export interface TermCtx {
  print: (text: string, tone?: TermTone) => void
  /** Open a full-panel screen. Refused inside a script. */
  screen: (screen: TermScreen) => void
  /** Ask for a typed answer. `secret` masks it as it is typed; either way it is
   *  kept out of the scrollback and the history. Rejects when the user cancels
   *  or the line is running from a script. */
  ask: (label: string, opts?: { secret?: boolean }) => Promise<string>
  /** Run a command line as if it were typed (echoed in the scrollback). Resolves
   *  false when the line printed an error. */
  exec: (line: string) => Promise<boolean>
  /** Whether the line is running from a script (`source`), where interactive
   *  commands have to refuse. */
  scripted: boolean
  /** Commands typed in the terminal, oldest first. */
  history: () => string[]
  /** The room the terminal is attached to (where `say`, `log` and chat commands act). */
  room: RoomRef
  /** Members of that room. */
  people: ChatUserBrief[]
  /** Aborted when the user cancels the running command (Ctrl+C). A command that
   *  fetches should pass it to its requests so they are actually aborted, not
   *  merely ignored; one that never reads it can't be cancelled. */
  signal: AbortSignal
}

export type TermGroup = 'Fun' | 'Account' | 'Editor' | 'Content' | 'People' | 'Player' | 'Library' | 'Navigation' | 'Settings' | 'Admin' | 'App'

export interface TermCommand {
  name: string
  aliases?: string[]
  group: TermGroup
  usage: string
  description: string
  /** The API functions (`module.function`, e.g. `userApi.addFavorite`) this
   *  command calls. `npm run terminal:check-coverage` reads these to prove every
   *  request the UI can make is reachable from the terminal. */
  covers?: string[]
  /** Acts on chat (rooms, DMs, messages), which only staff accounts have. */
  chat?: boolean
  run: (args: string, ctx: TermCtx) => void | Promise<void>
  /** Tab candidates for the token being typed, given the tokens before it. */
  complete?: (before: string[], partial: string) => string[] | Promise<string[]>
}

export const fail = (message: string): never => { throw new Error(message) }

export function parseBool(word: string): boolean | null {
  switch (word.trim().toLowerCase()) {
    case 'on': case 'true': case 'yes': case 'y': case '1': case 'enable': case 'enabled': return true
    case 'off': case 'false': case 'no': case 'n': case '0': case 'disable': case 'disabled': return false
    default: return null
  }
}

export const clock = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** Matches a typed name against a list by exact (case-insensitive) name first,
 *  then unique prefix, then unique substring. */
export function pickByName<T>(items: T[], name: (t: T) => string, typed: string): T | null {
  const q = typed.trim().toLowerCase()
  if (!q) return null
  const exact = items.find((t) => name(t).toLowerCase() === q)
  if (exact) return exact
  const starts = items.filter((t) => name(t).toLowerCase().startsWith(q))
  if (starts.length === 1) return starts[0]
  const has = items.filter((t) => name(t).toLowerCase().includes(q))
  return has.length === 1 ? has[0] : null
}

// ── Shared pieces for the commands that mirror API endpoints ────────────────

/** Splits a command's arguments on whitespace, keeping "quoted phrases" whole. */
export function tokenize(args: string): string[] {
  const out: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
  for (let m = re.exec(args); m; m = re.exec(args)) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2] ?? m[3])
  return out
}

export interface ParsedArgs {
  /** Positional words, flags removed. */
  rest: string[]
  /** `--json`, `-y` ... : true when present. */
  bool: Set<string>
  /** `--channel x`, `--limit=20` ... */
  value: Map<string, string>
}

/** Pulls `--flag`, `--key value` / `--key=value` and `-y` out of an argument
 *  string. Only the names in `valued` take a value; everything else starting
 *  with `-` is a boolean flag, so a negative number stays positional. */
export function parseArgs(args: string, valued: readonly string[] = []): ParsedArgs {
  const rest: string[] = []
  const bool = new Set<string>()
  const value = new Map<string, string>()
  const words = tokenize(args)
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const long = /^--([a-z][\w-]*)(?:=(.*))?$/i.exec(w)
    if (long) {
      const key = long[1].toLowerCase()
      if (valued.includes(key)) {
        const v = long[2] ?? words[++i]
        if (v === undefined) fail(`--${key} needs a value`)
        value.set(key, v)
      } else bool.add(key)
      continue
    }
    if (/^-[a-z]$/i.test(w)) { bool.add(w.slice(1).toLowerCase()); continue }
    rest.push(w)
  }
  return { rest, bool, value }
}

/** A positive integer id, or the command's usage line. */
export function idArg(word: string | undefined, usage: string): number {
  const n = Number(word)
  return Number.isInteger(n) && n > 0 ? n : fail(`usage: ${usage}`)
}

/** Confirms a destructive action. `-y` skips the question; a script has to pass
 *  it, since nobody is there to answer. Resolves false when declined. */
export function confirmAction(ctx: TermCtx, message: string, yes: boolean): boolean {
  if (yes) return true
  if (ctx.scripted) fail('this needs confirmation - add -y to run it from a script')
  if (!window.confirm(message)) { ctx.print('cancelled', 'dim'); return false }
  return true
}

/** Prints data as JSON when `--json` was given. Returns true when it did, so a
 *  command can `if (asJson(...)) return` ahead of its own formatting. */
export function asJson(ctx: TermCtx, on: boolean, data: unknown): boolean {
  if (on) ctx.print(JSON.stringify(data, null, 2))
  return on
}

export const oneLine = (s: string | null | undefined, max = 70): string => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** Left-aligned columns, padded to the widest cell (capped). */
export function table(rows: string[][], max = 48): string {
  if (rows.length === 0) return ''
  const widths = rows[0].map((_, c) => Math.min(max, Math.max(...rows.map((r) => (r[c] ?? '').length))))
  return rows.map((r) => r.map((cell, c) => (c === r.length - 1 ? cell : oneLine(cell, widths[c]).padEnd(widths[c] + 2))).join('')).join('\n')
}

/** Validates an inline JSON argument (a body a command sends as-is). */
export function parseJsonArg(text: string, usage: string): unknown {
  const t = text.trim()
  if (!t) fail(`usage: ${usage}`)
  try { return JSON.parse(t) } catch { return fail(`that isn't valid JSON (${usage})`) }
}
