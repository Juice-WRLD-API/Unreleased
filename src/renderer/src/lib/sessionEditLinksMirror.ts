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
