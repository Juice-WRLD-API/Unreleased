// Feature flag for the playlist-folders profile-blob field. See
// profilePushApi.ts for the actual PATCH /accounts/account/me/ network
// layer - song prefs, listening plays, and playlist folders all push through
// that single combined pusher now, rather than each field having its own
// push function here. Only synced playlists reach the server (toServerFolders
// maps each folder to { id, name, playlist_ids }) - device-local ("local:")
// members never leave this machine and are re-attached after a pull by
// matching on the round-tripped folder id.

/** Live since the profile-blob fields shipped (2026-07-17). */
export const foldersApiEnabled = true
