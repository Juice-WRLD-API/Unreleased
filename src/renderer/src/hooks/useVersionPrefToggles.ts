import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store/useStore'

/** One member of a version group, as far as preferences care. */
export interface VersionPrefMember {
  songId: number
  version: string | null
}

const norm = (label: string): string => label.trim().toLowerCase()

/** Preferred/excluded state for a version group plus the toggles that change
 *  it - reactive counterpart of lib/versionPrefs (see there for why a
 *  preferred set lives in each member's `default_version`). Shared by the
 *  Change-version menu, the song-prefs panel and Playlists' compact view so
 *  the star means the same thing everywhere. */
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

  const excluded = useMemo(() => {
    const set = new Set<string>()
    for (const m of members) for (const label of songPrefs[m.songId]?.excluded_versions ?? []) set.add(norm(label))
    return set
  }, [songPrefs, members])

  const preferred = useMemo(() => {
    const set = new Set<string>()
    for (const m of members) {
      const label = songPrefs[m.songId]?.default_version
      if (label && !excluded.has(norm(label))) set.add(norm(label))
    }
    return set
  }, [songPrefs, members, excluded])

  const clearLabel = (label: string): void => {
    for (const m of members) {
      const d = songPrefs[m.songId]?.default_version
      if (d && norm(d) === label) setSongDefaultVersion(m.songId, null)
    }
  }

  const unexclude = (label: string): void => {
    for (const m of members) {
      const list = songPrefs[m.songId]?.excluded_versions ?? []
      if (list.some(v => norm(v) === label)) setSongExcludedVersions(m.songId, list.filter(v => norm(v) !== label))
    }
  }

  const togglePreferred = (member: VersionPrefMember): void => {
    if (!member.version) return
    const label = norm(member.version)
    // Clearing has to reach wherever the label actually lives (its own row or
    // a sibling's) or the star would stay lit.
    if (preferred.has(label)) { clearLabel(label); return }
    // Preferring an excluded version un-excludes it - the two can't both hold.
    if (excluded.has(label)) unexclude(label)
    // A row holds one label; an older default can sit on a sibling's row
    // instead of its own. Move it home before overwriting so it stays preferred.
    const displaced = songPrefs[member.songId]?.default_version
    if (displaced && norm(displaced) !== label) {
      const home = members.find(m => m.songId !== member.songId && m.version && norm(m.version) === norm(displaced) && !songPrefs[m.songId]?.default_version)
      if (home) setSongDefaultVersion(home.songId, displaced)
    }
    setSongDefaultVersion(member.songId, member.version)
  }

  const toggleExcluded = (member: VersionPrefMember): void => {
    if (!member.version) return
    const label = norm(member.version)
    if (excluded.has(label)) { unexclude(label); return }
    // Excluding a preferred version drops the star - same reasoning as above.
    clearLabel(label)
    setSongExcludedVersions(member.songId, [...(songPrefs[member.songId]?.excluded_versions ?? []), member.version])
  }

  const clearPreferred = (): void => {
    for (const m of members) if (songPrefs[m.songId]?.default_version) setSongDefaultVersion(m.songId, null)
  }

  return {
    preferred,
    excluded,
    isPreferred: (version) => !!version && preferred.has(norm(version)),
    isExcluded: (version) => !!version && excluded.has(norm(version)),
    togglePreferred,
    toggleExcluded,
    clearPreferred,
  }
}
