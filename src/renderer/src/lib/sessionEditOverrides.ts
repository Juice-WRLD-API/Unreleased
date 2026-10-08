import { ls } from './persist'

export interface SessionEditOverride {
  path: string
  duration: string | null
}

type OverridesByChannel = Record<string, Record<number, SessionEditOverride>>

let _overridesByChannel: OverridesByChannel = ls.get<OverridesByChannel>('sessionEditOverrides') ?? {}

export function peekSessionEditOverride(songId: number, channel: string): SessionEditOverride | undefined {
  return _overridesByChannel[channel]?.[songId]
}

export function setSessionEditOverride(songId: number, channel: string, override: SessionEditOverride | null): void {
  const forChannel = { ..._overridesByChannel[channel] }
  if (override) forChannel[songId] = override
  else delete forChannel[songId]
  _overridesByChannel = { ..._overridesByChannel, [channel]: forChannel }
  ls.set('sessionEditOverrides', _overridesByChannel)
}
