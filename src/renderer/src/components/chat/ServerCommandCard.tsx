import { useEffect, useMemo, useState } from 'react'
import type { ServerCard } from '../../lib/chatApi'
import { getSongsByIds } from '../../lib/juicewrldApi'
import type { BroadcastMessage } from '../../lib/broadcastApi'
import { displayName } from '../../store/chatStore'
import BroadcastHistoryCard from './BroadcastHistoryCard'
import HelpCard from './HelpCard'
import NowPlayingHistoryCard from './NowPlayingHistoryCard'
import NowPlayingNowCard from './NowPlayingNowCard'

const KINDS = new Set<string>(['help', 'npNow', 'npHistory', 'broadcastHistory'])

// A message's `card` only ever comes from the server, which built it from its
// own records (see chat.cards in the API), so unlike chat text it can be
// believed. An unknown kind (a newer server than this client) is left to fall
// back to the message's own `content`, a short server-written summary.
export function isKnownServerCard(card: unknown): card is ServerCard {
  return !!card && typeof card === 'object' && KINDS.has((card as { kind?: unknown }).kind as string)
}

// Cards carry song ids, never titles - the title comes from the library, so
// what a card shows is always the real entry. Falls back to "Song #id" until
// (or unless) the lookup lands.
function useSongNames(ids: number[]): Map<number, string> {
  const key = ids.join(',')
  const [names, setNames] = useState<Map<number, string>>(new Map())
  useEffect(() => {
    let live = true
    getSongsByIds(ids)
      .then((songs) => { if (live) setNames(new Map(songs.map((s) => [s.id, s.name]))) })
      .catch(() => undefined)
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return names
}

const songLabel = (names: Map<number, string>, id: number): string => names.get(id) ?? `Song #${id}`

export default function ServerCommandCard({ card }: { card: ServerCard }): JSX.Element | null {
  const songIds = useMemo(
    () => card.kind === 'npNow' ? [card.song] : card.kind === 'npHistory' ? card.items.map((p) => p.song) : [],
    [card],
  )
  const names = useSongNames(songIds)

  switch (card.kind) {
    case 'help':
      return <HelpCard />
    case 'npNow':
      return <NowPlayingNowCard user={displayName(card.user)} song={card.song} name={songLabel(names, card.song)} updatedAt={card.updated_at} />
    case 'npHistory':
      return (
        <NowPlayingHistoryCard
          items={card.items.map((p) => ({ song: p.song, name: songLabel(names, p.song), played_at: p.played_at }))}
          total={card.total}
          capped={card.capped}
          user={card.user ? displayName(card.user) : undefined}
        />
      )
    case 'broadcastHistory':
      return <BroadcastHistoryCard items={card.items as BroadcastMessage[]} total={card.total} />
    default:
      return null
  }
}
