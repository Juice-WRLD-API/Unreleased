export interface QueueContextResult<T> {
  tracks: T[]
  index: number
}

/**
 * Resolve a playback request into a queue whose selected index always points
 * at the requested track. Omitting context is an explicit standalone launch;
 * collection callers must pass their collection deliberately.
 */
export function resolveQueueContext<T extends { id: string }>(
  track: T,
  context?: T[],
): QueueContextResult<T> {
  const requested = context ?? [track]
  const requestedIndex = requested.findIndex(candidate => candidate.id === track.id)

  return requestedIndex >= 0
    ? { tracks: requested, index: requestedIndex }
    : { tracks: [track, ...requested], index: 0 }
}
