// State for Heardle's Statistics panel - identical between the desktop modal
// and the mobile Sheet; only the wrapping JSX differs between the two views.
import { useMemo, useState } from 'react'
import { loadStats } from '../lib/heardle'
import type { DailyMode, Stats } from '../lib/heardle'

export function useHeardleStats(initialMode: DailyMode): {
  tab: DailyMode
  setTab: (m: DailyMode) => void
  stats: Stats
  max: number
  winRate: number
} {
  const [tab, setTab] = useState<DailyMode>(initialMode)
  // Streaks are per-mode, so the panel is too - it reads straight from storage
  // on open rather than mirroring the round's state.
  const stats: Stats = useMemo(() => loadStats(tab), [tab])
  const max = Math.max(1, ...stats.distribution)
  const winRate = stats.played ? Math.round((stats.won / stats.played) * 100) : 0
  return { tab, setTab, stats, max, winRate }
}
