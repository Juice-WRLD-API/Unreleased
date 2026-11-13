// 999 FM live chat over REST. Reading needs no account; the live lines come
// over the chat socket (radioChatSocket.ts). Moderation is admin + 2FA only,
// the server answers anyone else with 403. Backend: juicewrld/radio_chat.py,
// docs/06-999-fm.md "Live chat".
import { RADIO_API_BASE } from './apiServers'
import { authedRequest } from './apiClient'
import { getToken } from './userApi'

// Server limits (juicewrld/radio_chat.py).
export const RADIO_CHAT_MAX_TEXT = 300
export const RADIO_CHAT_MAX_NAME = 24
export const RADIO_CHAT_MIN_NAME = 2

export type RadioChatRole = 'admin' | 'mod' | 'member'

export interface RadioChatMessage {
  id: number
  name: string
  text: string
  /** Sent from a signed-in account; `name` is then the account's username. */
  verified: boolean
  role: RadioChatRole | null
  sent_at: string
}

export interface RadioChatState {
  /** Everyone's switch. */
  enabled: boolean
  /** Listeners without an account. Off, only signed-in listeners can post. */
  guests_enabled: boolean
  /** The admin's note while chat is off ('' when on). */
  reason: string
  /** Who may post links. Older servers omit it (they act as 'signed_in'). */
  links?: RadioChatLinks
  updated_at: string | null
}

/** Who may post links: everyone, signed-in listeners, staff (admins and mods), no one. */
export type RadioChatLinks = 'everyone' | 'signed_in' | 'staff' | 'off'
export const RADIO_CHAT_LINK_MODES: { mode: RadioChatLinks; label: string }[] = [
  { mode: 'everyone', label: 'Everyone' },
  { mode: 'signed_in', label: 'Signed-in listeners' },
  { mode: 'staff', label: 'Staff only' },
  { mode: 'off', label: 'No one' },
]

/** The admin view of the state: also the blocked words, which listeners never see. */
export interface RadioChatAdminState extends RadioChatState {
  blocked_words: string[]
}

export interface RadioChatStatePatch {
  enabled?: boolean
  guests?: boolean
  reason?: string
  clear?: boolean
  links?: RadioChatLinks
  /** Replaces the list. Entries match whole words; `*` matches any letters. */
  blocked_words?: string[]
  add_words?: string[]
  remove_words?: string[]
}

export interface RadioChatSnapshot extends RadioChatState {
  messages: RadioChatMessage[]
}

export interface RadioChatBan {
  id: number
  name: string
  reason: string
  created_by: string | null
  created_at: string
  /** null: until lifted. */
  expires_at: string | null
}

const base = (): string => `${RADIO_API_BASE.replace(/\/$/, '')}/radio/chat`

/** Public: the switch and the last 50 lines, oldest first. */
export async function fetchRadioChat(signal?: AbortSignal): Promise<RadioChatSnapshot> {
  return authedRequest<RadioChatSnapshot>(`${base()}/`, { method: 'GET', signal }, null)
}

/** A 30-second ticket that marks this listener's lines as their account's. */
export async function fetchRadioChatTicket(): Promise<string> {
  const res = await authedRequest<{ ticket: string }>(`${base()}/ws-ticket/`, { method: 'POST' }, getToken())
  return res.ticket
}

/** Admin: the switches and filters. `enabled` is everyone, `guests` only
 *  listeners without an account; `clear` also hides every line for good;
 *  `links` and the word fields are the filters. */
export async function setRadioChatState(patch: RadioChatStatePatch): Promise<RadioChatAdminState & { cleared: number }> {
  return authedRequest<RadioChatAdminState & { cleared: number }>(`${base()}/state/`, {
    method: 'POST',
    body: JSON.stringify(patch),
  }, getToken())
}

/** Admin: the state with the blocked words. */
export async function fetchRadioChatAdminState(signal?: AbortSignal): Promise<RadioChatAdminState> {
  return authedRequest<RadioChatAdminState>(`${base()}/state/`, { method: 'GET', signal }, getToken())
}

/** Admin: hide one line. */
export async function deleteRadioChatMessage(id: number): Promise<void> {
  await authedRequest<unknown>(`${base()}/messages/${id}/`, { method: 'DELETE' }, getToken())
}

/** Admin: ban a line's author (address, browser and account). `minutes: 0`
 *  bans until lifted; `purge` (default on) hides their lines from the last day. */
export async function banRadioChatAuthor(messageId: number, opts: { minutes?: number; reason?: string; purge?: boolean } = {}): Promise<RadioChatBan & { hidden: number }> {
  return authedRequest<RadioChatBan & { hidden: number }>(`${base()}/bans/`, {
    method: 'POST',
    body: JSON.stringify({ message_id: messageId, ...opts }),
  }, getToken())
}

/** Admin: bans in force. */
export async function fetchRadioChatBans(signal?: AbortSignal): Promise<RadioChatBan[]> {
  const res = await authedRequest<{ results: RadioChatBan[] }>(`${base()}/bans/`, { method: 'GET', signal }, getToken())
  return res?.results ?? []
}

/** Admin: lift a ban. */
export async function liftRadioChatBan(id: number): Promise<void> {
  await authedRequest<unknown>(`${base()}/bans/${id}/`, { method: 'DELETE' }, getToken())
}
