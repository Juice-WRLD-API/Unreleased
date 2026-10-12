let _activeChannel = ''

export function peekActiveChannel(): string {
  return _activeChannel
}

export function setActiveChannelCache(channel: string): void {
  _activeChannel = channel
}
