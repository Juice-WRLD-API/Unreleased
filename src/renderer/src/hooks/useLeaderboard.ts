import { useState } from 'react'
import { getLeaderboard } from '../lib/userApi'
import { useStrictModeSafeEffect } from './useStrictModeSafeEffect'

export type LeaderboardEntry = {
  rank: number
  user_id: number
  username: string
  discord_username: string
  discord_avatar: string
  approved_count: number
  badges: Array<{ slug: string; name: string; icon: string; description: string; category: string; note: string; awarded_at: string; awarded_by_username: string | null }>
}

// The leaderboard endpoint is global, not per-channel, so only refreshKey
// re-triggers it - switching channels doesn't need a refetch.
export function useLeaderboard(refreshKey: number, discordUsername: string | null | undefined) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)

  useStrictModeSafeEffect((isCancelled) => {
    setLoading(true)
    getLeaderboard()
      .then((data) => { if (!isCancelled()) setLeaderboard(data as LeaderboardEntry[]) })
      .catch(() => {})
      .finally(() => { if (!isCancelled()) setLoading(false) })
  }, [refreshKey])

  const myEntry = leaderboard.find((e) => e.discord_username === discordUsername)

  return { leaderboard, loading, myEntry }
}
