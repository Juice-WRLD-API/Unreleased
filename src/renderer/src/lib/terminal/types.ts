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

export type TermGroup = 'Fun' | 'People' | 'Player' | 'Library' | 'Navigation' | 'Settings' | 'Admin' | 'App'

export interface TermCommand {
  name: string
  aliases?: string[]
  group: TermGroup
  usage: string
  description: string
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
