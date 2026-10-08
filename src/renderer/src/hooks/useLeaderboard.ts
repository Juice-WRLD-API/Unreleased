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

// `activeChannel` isn't sent to the leaderboard endpoint (it's global, not
// per-channel) - it's accepted here purely so switching channels re-triggers
// a refetch, matching EditorProfileView's original combined
// Promise.all([getMyProposals(activeChannel), getLeaderboard()]) effect,
// which refetched both on every channel switch even though only one of them
// needed to.
export function useLeaderboard(refreshKey: number, activeChannel: string, discordUsername: string | null | undefined) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)

  useStrictModeSafeEffect((isCancelled) => {
    setLoading(true)
    getLeaderboard()
      .then((data) => { if (!isCancelled()) setLeaderboard(data as LeaderboardEntry[]) })
      .catch(() => {})
      .finally(() => { if (!isCancelled()) setLoading(false) })
  }, [refreshKey, activeChannel])

  const myEntry = leaderboard.find((e) => e.discord_username === discordUsername)

  return { leaderboard, loading, myEntry }
}
