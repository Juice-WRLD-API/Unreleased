import { useEffect, useMemo, useRef, useState } from 'react'
import { loadAllSongs, type JWApiSong } from '../lib/juicewrldApi'
import { eventsOnDay, loadDaySongs, peekDaySongs, type DayYear } from '../lib/onThisDay'
import { runWhenIdle } from '../lib/platform'

// Today's rows are re-read from the catalogue at most this often. In between,
// Home paints them from the cache and makes no request at all.
const REFRESH_MS = 6 * 60 * 60_000

const pad = (n: number): string => String(n).padStart(2, '0')

export interface OnThisDay {
  month: number
  day: number
  isToday: boolean
  /** YYYY-MM-DD of the day shown, for the date picker. */
  value: string
  /** null until the day's rows are in. */
  years: DayYear[] | null
  failed: boolean
  /** A YYYY-MM-DD from the date picker. */
  pick: (iso: string) => void
}

export function useOnThisDay(): OnThisDay {
  const [today] = useState(() => new Date())
  const [picked, setPicked] = useState<Date | null>(null)
  const shown = picked ?? today
  const month = shown.getMonth() + 1
  const day = shown.getDate()
  const isToday = month === today.getMonth() + 1 && day === today.getDate()
  const key = `${month}-${day}`

  const [rows, setRows] = useState<{ key: string; songs: JWApiSong[]; ts: number } | null>(() => {
    const cached = peekDaySongs(month, day)
    return cached && { key, ...cached }
  })
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let have = rowsRef.current?.key === key ? rowsRef.current : null
    if (!have && isToday) {
      const cached = peekDaySongs(month, day)
      if (cached) setRows(have = { key, ...cached })
    }
    setFailed(false)
    if (have && Date.now() - have.ts < REFRESH_MS) return
    let cancelled = false
    const load = (): void => {
      loadDaySongs(month, day)
        .then((songs) => { if (!cancelled) setRows({ key, songs, ts: Date.now() }) })
        .catch(() => { if (!cancelled && !have) setFailed(true) })
    }
    // Home is the landing page, so today's catalogue download waits for it to
    // paint - unless the catalogue is already in memory, or someone picked a
    // day and is waiting on it.
    if (!isToday || loadAllSongs.peek()) {
      load()
      return () => { cancelled = true }
    }
    const cancel = runWhenIdle(load, 3000)
    return () => { cancelled = true; cancel() }
  }, [key, month, day, isToday])

  const songs = rows?.key === key ? rows.songs : null
  const years = useMemo(() => (songs ? eventsOnDay(songs, month, day) : null), [songs, month, day])

  return {
    month, day, isToday, years, failed,
    value: `${shown.getFullYear()}-${pad(month)}-${pad(day)}`,
    pick: (iso) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
      setPicked(m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null)
    },
  }
}
