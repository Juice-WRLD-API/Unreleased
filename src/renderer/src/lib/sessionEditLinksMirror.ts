export interface SessionEditLinkEntry {
  path: string
  duration: string | null
}

const _links = new Map<string, Map<number, SessionEditLinkEntry>>()

export function peekSessionEditLink(songId: number, channel: string): SessionEditLinkEntry | undefined {
  return _links.get(channel)?.get(songId)
}

export function setSessionEditLinksCache(channel: string, map: Map<number, SessionEditLinkEntry>): void {
  _links.set(channel, map)
}

export function setSessionEditLink(songId: number, channel: string, entry: SessionEditLinkEntry): void {
  let forChannel = _links.get(channel)
  if (!forChannel) { forChannel = new Map(); _links.set(channel, forChannel) }
  forChannel.set(songId, entry)
}

// A recording_session song has no file of its own, and which session edit it
// maps to is only looked up when it's played. Until then it carries this marker
// as its path/streamUrl so every "can this be played" check passes; the Player
// swaps it for the real stream URL (see ensureSessionEditUrl).
const PLACEHOLDER_SCHEME = 'sessionedit://'

export const sessionEditPlaceholder = (songId: number): string => `${PLACEHOLDER_SCHEME}${songId}`

export function isSessionEditPlaceholder(url: string | undefined): url is string {
  return !!url && url.startsWith(PLACEHOLDER_SCHEME)
}

export function sessionEditSongId(placeholder: string): number {
  return Number(placeholder.slice(PLACEHOLDER_SCHEME.length))
}
