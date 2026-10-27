import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store/useStore'
import { memberVersionPrefs, versionPrefToggles, type VersionPrefMember } from '../lib/versionPrefs'

export type { VersionPrefMember }

const norm = (label: string): string => label.trim().toLowerCase()

/** Preferred/excluded state for a version group plus the toggles that change
 *  it - reactive counterpart of lib/versionPrefs (see there for why a
 *  preferred set lives in each member's `default_version`, and for the toggle
 *  rules, which the terminal's `vprefs` shares). Used by the Change-version
 *  menu, the song-prefs panel and Playlists' compact view so the star means
 *  the same thing everywhere. */
export function useVersionPrefToggles(members: VersionPrefMember[]): {
  preferred: Set<string>
  excluded: Set<string>
  isPreferred: (version: string | null) => boolean
  isExcluded: (version: string | null) => boolean
  togglePreferred: (member: VersionPrefMember) => void
  toggleExcluded: (member: VersionPrefMember) => void
  clearPreferred: () => void
} {
  const { songPrefs, setSongDefaultVersion, setSongExcludedVersions } = useStore(
    useShallow((s) => ({
      songPrefs: s.songPrefs,
      setSongDefaultVersion: s.setSongDefaultVersion,
      setSongExcludedVersions: s.setSongExcludedVersions,
    }))
  )

  const { preferred, excluded } = useMemo(() => memberVersionPrefs(members, songPrefs), [songPrefs, members])
  const toggles = versionPrefToggles(members, songPrefs, { setDefault: setSongDefaultVersion, setExcluded: setSongExcludedVersions })

  return {
    preferred,
    excluded,
    isPreferred: (version) => !!version && preferred.has(norm(version)),
    isExcluded: (version) => !!version && excluded.has(norm(version)),
    ...toggles,
  }
}
