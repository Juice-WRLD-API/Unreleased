import { create } from 'zustand'
import type { RadioChatMessage, RadioChatRole } from '../lib/radioChatApi'

// The 999 FM chat as the open socket last described it. One copy per window,
// written only by lib/radioChatSocket.ts; WRLD's desktop and phone panels both
// read it.

/** A line of ours the server hasn't confirmed yet, or refused. */
export interface RadioChatPending {
  nonce: string
  name: string
  text: string
  error?: string
}

export interface RadioChatMe {
  name: string
  role: RadioChatRole
}

const NAME_KEY = 'radioChatName'
export const MAX_KEPT_LINES = 200

function storedName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' }
}

interface RadioChatStore {
  status: 'idle' | 'connecting' | 'open' | 'closed'
  /** null until the socket or the REST snapshot says. */
  enabled: boolean | null
  /** Off: only signed-in listeners can post. */
  guestsEnabled: boolean
  reason: string
  messages: RadioChatMessage[]
  pending: RadioChatPending[]
  /** Set once the socket accepted a ticket: lines go out as this account. */
  me: RadioChatMe | null
  /** A ticket is on its way: hold lines until it lands, or they'd go out as a guest's. */
  authPending: boolean
  /** The guest name typed in the panel ('' = the server picks one). */
  name: string
  setName: (name: string) => void
}

export const useRadioChatStore = create<RadioChatStore>((set) => ({
  status: 'idle',
  enabled: null,
  guestsEnabled: true,
  reason: '',
  messages: [],
  pending: [],
  me: null,
  authPending: false,
  name: storedName(),
  setName: (name) => {
    try { localStorage.setItem(NAME_KEY, name) } catch {}
    set({ name })
  },
}))

/** Adds lines by id, oldest first, keeping the last MAX_KEPT_LINES. */
export function mergeLines(current: RadioChatMessage[], incoming: RadioChatMessage[]): RadioChatMessage[] {
  if (!incoming.length) return current
  const seen = new Set(current.map((m) => m.id))
  const fresh = incoming.filter((m) => !seen.has(m.id))
  if (!fresh.length) return current
  const next = [...current, ...fresh].sort((a, b) => a.id - b.id)
  return next.length > MAX_KEPT_LINES ? next.slice(next.length - MAX_KEPT_LINES) : next
}
