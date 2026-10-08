// Shared account-tab logic for Settings (avatar, bio, privacy toggles) -
// identical on desktop and mobile; only the surrounding layout differs.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { compressImageFile, updateAvatar, removeAvatar, updateBio, updatePrivacySettings } from '../lib/userApi'

export function useSettingsAccount(): {
  avatarUploading: boolean
  avatarError: string | null
  handleAvatarFile: (file: File) => Promise<void>
  handleAvatarRemove: () => Promise<void>
  bioDraft: string
  setBioDraft: (v: string) => void
  bioSaving: boolean
  saveBio: () => Promise<void>
  privacyError: string | null
  togglePublicPlayHistory: () => Promise<void>
  togglePublicPlaylists: () => Promise<void>
  togglePublicNowPlaying: () => Promise<void>
} {
  const account = useStore((s) => s.account)

  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)

  const handleAvatarFile = async (file: File): Promise<void> => {
    setAvatarError(null)
    setAvatarUploading(true)
    try {
      const base64 = await compressImageFile(file, 256, 200)
      const updated = await updateAvatar(base64)
      useStore.setState({ account: updated })
    } catch {
      setAvatarError('Could not update photo. Try again.')
    } finally {
      setAvatarUploading(false)
    }
  }

  const handleAvatarRemove = async (): Promise<void> => {
    setAvatarError(null)
    setAvatarUploading(true)
    try {
      const updated = await removeAvatar()
      useStore.setState({ account: updated })
    } catch {
      setAvatarError('Could not remove photo. Try again.')
    } finally {
      setAvatarUploading(false)
    }
  }

  // Bio - free text, saved on blur rather than per-keystroke.
  const [bioDraft, setBioDraft] = useState(account?.bio ?? '')
  const [bioSaving, setBioSaving] = useState(false)
  useEffect(() => { setBioDraft(account?.bio ?? '') }, [account?.bio])
  const saveBio = async (): Promise<void> => {
    if (bioDraft === (account?.bio ?? '')) return
    setBioSaving(true)
    try {
      const updated = await updateBio(bioDraft)
      useStore.setState({ account: updated })
    } catch {
      setBioDraft(account?.bio ?? '')
    } finally {
      setBioSaving(false)
    }
  }

  // Public profile toggles - optimistic, reverted on failure.
  const [privacyError, setPrivacyError] = useState<string | null>(null)
  const togglePublicPlayHistory = async (): Promise<void> => {
    if (!account) return
    const next = !account.public_play_history
    useStore.setState({ account: { ...account, public_play_history: next } })
    setPrivacyError(null)
    try {
      const updated = await updatePrivacySettings({ public_play_history: next })
      useStore.setState({ account: updated })
    } catch {
      useStore.setState({ account: { ...account, public_play_history: !next } })
      setPrivacyError('Could not update. Try again.')
    }
  }
  const togglePublicPlaylists = async (): Promise<void> => {
    if (!account) return
    const next = !account.public_playlists
    useStore.setState({ account: { ...account, public_playlists: next } })
    setPrivacyError(null)
    try {
      const updated = await updatePrivacySettings({ public_playlists: next })
      useStore.setState({ account: updated })
    } catch {
      useStore.setState({ account: { ...account, public_playlists: !next } })
      setPrivacyError('Could not update. Try again.')
    }
  }
  const togglePublicNowPlaying = async (): Promise<void> => {
    if (!account) return
    const next = !account.public_now_playing
    useStore.setState({ account: { ...account, public_now_playing: next } })
    setPrivacyError(null)
    try {
      const updated = await updatePrivacySettings({ public_now_playing: next })
      useStore.setState({ account: updated })
    } catch {
      useStore.setState({ account: { ...account, public_now_playing: !next } })
      setPrivacyError('Could not update. Try again.')
    }
  }

  return {
    avatarUploading, avatarError, handleAvatarFile, handleAvatarRemove,
    bioDraft, setBioDraft, bioSaving, saveBio,
    privacyError, togglePublicPlayHistory, togglePublicPlaylists, togglePublicNowPlaying,
  }
}
