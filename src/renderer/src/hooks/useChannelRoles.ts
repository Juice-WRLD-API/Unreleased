import { useStorePick } from '../store/useStore'
import { isChannelEditor, isChannelContributor, isChannelManager } from '../lib/userApi'
import type { JWApiChannel } from '../lib/juicewrldApi'

// The global role flags only cover the primary channel (see isChannelEditor
// et al. in userApi.ts) - this resolves whether the active channel actually
// is primary so callers can pass that through. Defaults to true when the
// channel list hasn't loaded yet or the slug isn't recognized, matching the
// safe default already baked into the isChannel* functions.
export function isPrimaryChannelSlug(channels: JWApiChannel[], slug: string | null | undefined): boolean {
  if (channels.length === 0) return true
  const ch = channels.find((c) => c.slug === slug)
  return ch ? !!ch.is_primary : true
}

// The primary channel's slug, regardless of which channel is currently
// selected in the Files tab - see useCanEdit below for why this matters.
function primaryChannelSlug(channels: JWApiChannel[]): string | undefined {
  return channels.find((c) => c.is_primary)?.slug
}

// Wraps isChannelEditor/isChannelContributor/isChannelManager with the
// account + channel lookup every call site otherwise had to repeat - keeps
// the actual permission rule (global flag on primary OR per-channel
// membership, see userApi.ts) defined in exactly one place.
//
// Deliberately checked against the *primary* channel rather than whichever
// channel is active - these hooks back views (Tracker, Playlists, Liked
// Songs, Now Playing, Player, SongInfoModal, StatsView, WrldView) that only
// ever show primary-channel songs, so editing there shouldn't be gated by
// whatever channel the Files tab happens to have selected. Views that
// actually operate on non-primary channel content (ApiFilesView,
// ContributorPage, EditorPage, etc.) call isChannelEditor/etc. directly with
// activeChannel instead of using these hooks.
export function useCanEdit(): boolean {
  const { account, channels } = useStorePick('account', 'channels')
  return isChannelEditor(account, primaryChannelSlug(channels), true)
}

export function useCanContribute(): boolean {
  const { account, channels } = useStorePick('account', 'channels')
  return isChannelContributor(account, primaryChannelSlug(channels), true)
}

export function useCanManage(): boolean {
  const { account, channels } = useStorePick('account', 'channels')
  return isChannelManager(account, primaryChannelSlug(channels), true)
}
