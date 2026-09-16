import { Disc3, ListMusic, Gamepad2, Newspaper, Radio, Music2, Heart, Album, MessagesSquare } from 'lucide-react'
import type { ReactNode } from 'react'

// The Home dashboard's sections - each independently shown/hidden from
// Settings → Appearance → Home screen. `id` is the stable key persisted in
// homeSectionVisibility; don't rename these. No reorder support (unlike
// NAV_ITEMS) - the sections' order reflects product intent, not preference.
export interface HomeSectionDef {
  id: string
  label: string
  icon: ReactNode
  /** Only offered to managers/administrators. */
  staffOnly?: boolean
}

export const HOME_SECTIONS: HomeSectionDef[] = [
  { id: 'chat', label: 'Staff chat', icon: <MessagesSquare size={18} />, staffOnly: true },
  { id: 'recent', label: 'Recently played', icon: <Disc3 size={18} /> },
  { id: 'news', label: 'News', icon: <Newspaper size={18} /> },
  { id: 'playlists', label: 'Playlists', icon: <ListMusic size={18} /> },
  { id: 'albums', label: 'Albums', icon: <Album size={18} /> },
  { id: 'games', label: 'Games', icon: <Gamepad2 size={18} /> },
  { id: 'radio', label: '999 FM', icon: <Radio size={18} /> },
  { id: 'listening', label: 'Your listening', icon: <Music2 size={18} /> },
  { id: 'liked', label: 'Liked songs shortcut', icon: <Heart size={18} /> },
]

// Everything ships on - a user opts out rather than in.
export const DEFAULT_HOME_SECTION_VISIBILITY: Record<string, boolean> = Object.fromEntries(
  HOME_SECTIONS.map((s) => [s.id, true]),
)

export function isHomeSectionVisible(id: string, visibility: Record<string, boolean>): boolean {
  return visibility[id] ?? true
}
