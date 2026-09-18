// Combined network layer for the profile-blob PATCH. Song prefs, listening
// plays, and playlist folders each live as their own JSON field on
// /accounts/account/me/ (see preferencesApi.ts and foldersApi.ts for the
// per-field shapes), but they used to be pushed by three independently
// debounced timers - a burst of edits across more than one field (e.g. a
// song skip, which bumps both playcount and listening plays) fired one PATCH
// per field instead of one PATCH total. This is the single combined pusher
// the store's one shared debounce timer calls into instead.
import { JWAPI_BASE } from './juicewrldApi'
import { getToken } from './userApi'
import { apiRequest, authHeaders } from './apiClient'
import { capSongPrefs } from './songPrefs'
import type { SongPreference } from './songPrefs'
import { capListeningPlays } from './listeningPlays'
import type { ListeningPlayEvent } from './listeningPlays'
import { toServerFolders } from './playlistFolders'
import type { PlaylistFolder } from './playlistFolders'
import type { UserSettings } from './userApi'

const ME_URL = `${JWAPI_BASE}/accounts/account/me/`

export interface ProfilePushPatch {
  songPrefs?: SongPreference[]
  listeningPlays?: ListeningPlayEvent[]
  folders?: PlaylistFolder[]
  // Whole-object, same as the other three - the caller (useStore's
  // buildUserSettings) is responsible for assembling every known field, not
  // just the one that changed, since a partial object here would read as
  // "cleared" for whichever fields are missing.
  userSettings?: UserSettings
}

/** Single PATCH carrying whichever of the four profile-blob fields are
 *  dirty. No-op when signed out or when nothing is actually dirty. */
export async function pushProfile(patch: ProfilePushPatch): Promise<void> {
  const token = getToken()
  if (!token) return
  const body: Record<string, unknown> = {}
  if (patch.songPrefs) body.user_preferences = capSongPrefs(patch.songPrefs)
  if (patch.listeningPlays) body.listening_plays = capListeningPlays(patch.listeningPlays)
  if (patch.folders) body.playlist_folders = toServerFolders(patch.folders)
  if (patch.userSettings) body.user_settings = patch.userSettings
  if (Object.keys(body).length === 0) return
  await apiRequest<unknown>(ME_URL, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(body),
  })
}
