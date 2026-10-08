// The channel that goes into a Track built from a file-browser entry - its id
// and its URLs - as opposed to the channel the listing itself is fetched with.
//
// Only a non-primary channel is tagged: a bare `jw-file-` id has always meant
// the primary tree, so tagging those would orphan every like made before ids
// carried a channel, and /files/ serves the primary tree with or without the
// param anyway. Playing and liking must agree on it, since the player likes
// whatever currentTrack.id says.
import { useStore } from '../store/useStore'
import { isPrimaryChannelSlug } from './useChannelRoles'

export function useTrackChannel(): {
  /** Authoritative only while `channelsReady` - isPrimaryChannelSlug answers
   *  "primary" for any slug it can't find, so before the list arrives this
   *  reads '' even for a non-primary channel. */
  trackChannel: string
  /** False until the channel list is known. Anything that persists a track id
   *  must not act on `trackChannel` before this, or it writes an id that
   *  disagrees with the one the UI just rendered. */
  channelsReady: boolean
  /** The channel the current listing is fetched with, whatever the list says. */
  activeChannel: string
  /** Resolves the list first. Returns null when it still can't be determined -
   *  fetchChannels swallows its errors and returns [], so an empty list means
   *  "unknown", not "primary", and writing '' there would produce exactly the
   *  untagged id this hook exists to prevent. */
  resolveTrackChannel: () => Promise<string | null>
} {
  const channels = useStore((s) => s.channels)
  const activeChannel = useStore((s) => s.activeChannel)
  const loadChannels = useStore((s) => s.loadChannels)

  const resolveTrackChannel = async (): Promise<string | null> => {
    if (useStore.getState().channels.length === 0) await loadChannels().catch(() => {})
    const list = useStore.getState().channels
    if (list.length === 0) return null
    return isPrimaryChannelSlug(list, activeChannel) ? '' : activeChannel
  }

  return {
    trackChannel: isPrimaryChannelSlug(channels, activeChannel) ? '' : activeChannel,
    channelsReady: channels.length > 0,
    activeChannel,
    resolveTrackChannel,
  }
}
