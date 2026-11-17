// One in-flight job per key, shared by every caller that asks for it. A caller
// that aborts only stops waiting: the job keeps running for the others, and is
// dropped a turn later if nobody is left. The turn (a timer, not a microtask)
// is what lets a remount pick the same job back up. WRLD's effect cleans the
// old wait up and starts the new one in the same flush, but the new wait joins
// only after an already-resolved lookup, so a microtask would cancel the job
// before that join and the new mount would see an abort it did not ask for.

interface Flight<T> {
  promise: Promise<T>
  controller: AbortController
  waiters: number
  /** Set while the last waiter has left and the job has not been dropped yet. */
  idle: ReturnType<typeof setTimeout> | 0
}

function aborted(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

/** Rejects when `signal` aborts. The underlying promise is left running. */
function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(aborted())
    if (signal.aborted) { onAbort(); return }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export function createSharedFlight<T>(): {
  join(key: string, start: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T>
} {
  const flights = new Map<string, Flight<T>>()

  function drop(key: string, flight: Flight<T>): void {
    flight.waiters -= 1
    if (flight.waiters > 0 || flight.idle) return
    flight.idle = setTimeout(() => {
      flight.idle = 0
      if (flight.waiters > 0) return
      if (flights.get(key) === flight) flights.delete(key)
      flight.controller.abort()
    }, 0)
  }

  return {
    join(key, start, signal) {
      if (signal?.aborted) return Promise.reject(aborted())
      let flight = flights.get(key)
      if (!flight) {
        const controller = new AbortController()
        // A synchronous throw from start() is a failed job, same as a rejection.
        let started: Promise<T>
        try { started = Promise.resolve(start(controller.signal)) } catch (err) { started = Promise.reject(err) }
        const created: Flight<T> = { promise: started, controller, waiters: 0, idle: 0 }
        const clear = (): void => { if (flights.get(key) === created) flights.delete(key) }
        created.promise.then(clear, clear)
        flights.set(key, created)
        flight = created
      }
      const mine = flight
      mine.waiters += 1
      if (mine.idle) { clearTimeout(mine.idle); mine.idle = 0 }
      let released = false
      const release = (): void => {
        if (released) return
        released = true
        drop(key, mine)
      }
      return waitFor(mine.promise, signal).then(
        (value) => { release(); return value },
        (err) => { release(); throw err },
      )
    },
  }
}
