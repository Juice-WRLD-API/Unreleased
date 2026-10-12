// Feature flag for the per-song preferences / listening-plays profile-blob
// fields. See profilePushApi.ts for the actual PATCH /accounts/account/me/
// network layer - song prefs, listening plays, and playlist folders all push
// through that single combined pusher now, rather than each field having its
// own push function here.

/** Live since the profile-blob fields shipped (2026-07-17). */
export const preferencesApiEnabled = true
