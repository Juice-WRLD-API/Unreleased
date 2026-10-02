import type { LocalNoticePayload } from './chatShare'

// The admin terminal (components/chat/TerminalPanel) runs the very same slash
// commands as the composer. The command code lives in Composer and talks to the
// room through toasts, local notice cards and the /search picker, so rather than
// copy it the terminal borrows it: Composer registers a runner for its room
// here, and the terminal calls it with a sink that catches that output.
export interface TerminalSearchResult {
  id: number
  name: string
  detail: string
}

export interface TerminalSink {
  toast: (text: string, tone?: 'error' | 'ok') => void
  // A card only the sender would have seen (the local notice path).
  notice: (payload: LocalNoticePayload) => void
  pickSearch: (query: string, results: TerminalSearchResult[]) => void
}

// Resolves false when the text isn't a recognized command, so the terminal can
// say so instead of posting it to the room as a message.
export type TerminalRunner = (text: string, sink: TerminalSink) => Promise<boolean>

const runners = new Map<string, TerminalRunner>()

export function registerTerminalRunner(roomKey: string, runner: TerminalRunner): () => void {
  runners.set(roomKey, runner)
  return () => { if (runners.get(roomKey) === runner) runners.delete(roomKey) }
}

export function getTerminalRunner(roomKey: string): TerminalRunner | undefined {
  return runners.get(roomKey)
}
