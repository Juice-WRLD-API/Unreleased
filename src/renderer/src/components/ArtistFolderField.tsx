import { useEffect, useState } from 'react'
import type { AdminUser } from '../lib/userApi'

// Admin → Users and a profile's admin panel: the artist's folder name under
// Cover Arts/ in the community channel. Shown while the artist role is on; the
// server picks a name when the role is switched on without one, and renaming a
// folder that holds covers moves them.
export default function ArtistFolderField({ user, onSave }: {
  user: Pick<AdminUser, 'user_id' | 'artist_enabled' | 'artist_folder'>
  onSave: (folder: string) => void
}): JSX.Element | null {
  const saved = user.artist_folder ?? ''
  const [value, setValue] = useState(saved)
  useEffect(() => { setValue(saved) }, [saved, user.user_id])
  if (!user.artist_enabled) return null
  const trimmed = value.trim()
  const changed = trimmed !== saved && trimmed !== ''
  return (
    <form
      className="flex items-center gap-2 pl-3 text-xs"
      onSubmit={(e) => { e.preventDefault(); if (changed) onSave(trimmed) }}
    >
      <span className="shrink-0 text-text-muted">Cover Arts/</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={80}
        placeholder="Folder name"
        aria-label="Artist folder name"
        className="min-w-0 flex-1 rounded-lg bg-[var(--fill)] px-2 py-1 text-text-primary outline-none focus:ring-1 focus:ring-accent"
      />
      {changed && (
        <button type="submit" className="shrink-0 rounded-lg bg-accent px-2.5 py-1 font-semibold text-white hover:opacity-90">
          Save
        </button>
      )}
    </form>
  )
}
