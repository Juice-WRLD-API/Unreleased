import { useCallback, useEffect, useRef, useState } from 'react'
import { logEntryKey, openLogStream, type LogEntry, type LogFilters, type LogStream, type LogStreamFrame, type LogStreamState } from '../lib/adminLogsApi'

/** A row of the live list: an entry, or a note where the server skipped some. */
export type LiveItem =
  | { kind: 'entry'; key: string; entry: LogEntry }
  | { kind: 'gap'; key: string; text: string }

// Rows kept in memory; older ones fall off the bottom.
const CAP = 2000
// Recent matches asked for on open and on every filter change, so the view
// isn't empty while it waits for new entries.
const BACKLOG = 100

const filtersKey = (f: LogFilters): string => JSON.stringify(Object.entries(f).filter(([, v]) => v).sort())

/** The live log socket as a newest-first list. Open while `active`; closing
 *  keeps the list, and reopening fills in what was written meanwhile. Pausing
 *  keeps receiving into a buffer that `resume` puts on top. */
export function useLogStream(filters: LogFilters, active: boolean) {
  const [items, setItems] = useState<LiveItem[]>([])
  const [newCount, setNewCount] = useState(0)
  const [state, setState] = useState<LogStreamState>('closed')
  const [detail, setDetail] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [paused, setPausedState] = useState(false)

  const stream = useRef<LogStream | null>(null)
  const pausedRef = useRef(false)
  // Newest first, held while paused.
  const buffer = useRef<LiveItem[]>([])
  const seen = useRef(new Set<string>())
  const newestTs = useRef<string | null>(null)
  // Between a filter change and the server's `filters.updated`, frames still
  // match the old filters - drop them rather than mix them into the new list.
  const awaitingFilters = useRef(false)
  const gapSeq = useRef(0)
  const currentFilters = useRef(filters)
  currentFilters.current = filters
  const sentKey = useRef(filtersKey(filters))

  const push = useCallback((oldestFirst: LiveItem[]) => {
    if (oldestFirst.length === 0) return
    const fresh = oldestFirst.slice().reverse()
    if (pausedRef.current) {
      buffer.current = [...fresh, ...buffer.current].slice(0, CAP)
      setNewCount(buffer.current.length)
    } else {
      setItems((list) => [...fresh, ...list].slice(0, CAP))
    }
    // Bounded: only needed to catch a reconnect's overlap with recent rows.
    if (seen.current.size > CAP * 4) seen.current = new Set(fresh.map((i) => i.key))
  }, [])

  const onFrame = useCallback((frame: LogStreamFrame) => {
    switch (frame.type) {
      case 'connected':
        awaitingFilters.current = false
        setError(null)
        return
      case 'filters.updated':
        awaitingFilters.current = false
        setError(null)
        return
      case 'error':
        awaitingFilters.current = false
        setError(frame.detail)
        return
      case 'backlog':
      case 'events': {
        if (frame.type === 'events' && awaitingFilters.current) return
        const out: LiveItem[] = []
        if (frame.type === 'events' && frame.skipped_bytes > 0) {
          out.push({ kind: 'gap', key: `gap-${++gapSeq.current}`, text: 'The stream fell behind and skipped ahead. Use Search to see what was missed.' })
        } else if (frame.type === 'events' && frame.dropped > 0) {
          out.push({ kind: 'gap', key: `gap-${++gapSeq.current}`, text: `${frame.dropped.toLocaleString()} ${frame.dropped === 1 ? 'entry' : 'entries'} skipped in a burst` })
        }
        for (const entry of frame.results) {
          const key = logEntryKey(entry)
          if (seen.current.has(key)) continue
          seen.current.add(key)
          out.push({ kind: 'entry', key, entry })
          newestTs.current = entry.ts
        }
        push(out)
      }
    }
  }, [push])

  useEffect(() => {
    if (!active) return
    // Reopening over a list we already have: ask for what came after it.
    const resumeFrom = newestTs.current
    const initial = resumeFrom ? { ...currentFilters.current, since: resumeFrom } as LogFilters : currentFilters.current
    sentKey.current = filtersKey(currentFilters.current)
    const s = openLogStream(initial, resumeFrom ? 500 : BACKLOG, {
      onFrame,
      onState: (next, why) => { setState(next); setDetail(why) },
    })
    stream.current = s
    return () => {
      s.close()
      if (stream.current === s) stream.current = null
    }
  }, [active, onFrame])

  const key = filtersKey(filters)
  useEffect(() => {
    if (key === sentKey.current) return
    sentKey.current = key
    seen.current = new Set()
    newestTs.current = null
    setItems([])
    buffer.current = []
    setNewCount(0)
    setError(null)
    if (stream.current) {
      awaitingFilters.current = true
      stream.current.setFilters(currentFilters.current, BACKLOG)
    }
  }, [key])

  const resume = useCallback(() => {
    pausedRef.current = false
    setPausedState(false)
    const held = buffer.current
    buffer.current = []
    setNewCount(0)
    if (held.length) setItems((list) => [...held, ...list].slice(0, CAP))
  }, [])

  const pause = useCallback(() => {
    pausedRef.current = true
    setPausedState(true)
  }, [])

  const clear = useCallback(() => {
    setItems([])
    buffer.current = []
    setNewCount(0)
  }, [])

  return { items, newCount, state, detail, error, paused, pause, resume, clear }
}
