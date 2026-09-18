// Shared data/logic for the Comp Channels admin tab. Desktop and mobile
// wrap these hooks in their own layouts - keep behavior here, JSX in them.
import { useCallback, useState } from 'react'
import { useStrictModeSafeEffect } from './useStrictModeSafeEffect'
import * as channelApi from '../lib/channelApi'
import type { Channel, ChannelMembershipRow } from '../lib/channelApi'
import * as userApi from '../lib/userApi'
import type { AdminUser } from '../lib/userApi'
import { useStore } from '../store/useStore'
import { errorMessage } from '../lib/format'

export const MEMBER_FLAGS: { key: keyof ChannelMembershipRow; label: string }[] = [
  { key: 'editor_enabled', label: 'Editor' },
  { key: 'contributor_enabled', label: 'Contributor' },
  { key: 'manager_enabled', label: 'Manager' },
  { key: 'auto_approve_proposals', label: 'Auto-approve edits' },
  { key: 'auto_approve_comp_proposals', label: 'Auto-approve comp' },
]

export function useChannelList(): {
  channels: Channel[]
  users: AdminUser[]
  loading: boolean
  reload: () => void
} {
  const loadChannels = useStore((s) => s.loadChannels)
  const [channels, setChannels] = useState<Channel[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    setLoading(true)
    Promise.all([
      channelApi.fetchChannelList().catch(() => [] as Channel[]),
      userApi.adminListUsers().catch(() => [] as AdminUser[]),
    ]).then(([chs, us]) => {
      setChannels(chs)
      setUsers(us)
    }).finally(() => setLoading(false))
    loadChannels().catch(() => {})
  }, [loadChannels])

  useStrictModeSafeEffect(() => { reload() }, [reload])

  return { channels, users, loading, reload }
}

export function useToggleChannelActive(onChanged: () => void): {
  busyId: number | null
  toggleActive: (channel: Channel) => Promise<void>
} {
  const [busyId, setBusyId] = useState<number | null>(null)

  const toggleActive = useCallback(async (channel: Channel) => {
    setBusyId(channel.id)
    try {
      if (channel.is_active) await channelApi.adminDeactivateChannel(channel.id)
      else await channelApi.adminUpdateChannel(channel.id, { is_active: true })
      onChanged()
    } finally {
      setBusyId(null)
    }
  }, [onChanged])

  return { busyId, toggleActive }
}

export function useChannelMembers(channelId: number, users: AdminUser[]): {
  members: ChannelMembershipRow[]
  loading: boolean
  busyUser: number | null
  error: string | null
  setFlag: (userId: number, patch: Partial<ChannelMembershipRow>) => Promise<void>
  addable: AdminUser[]
  addMember: (userId: number) => Promise<void>
} {
  const [members, setMembers] = useState<ChannelMembershipRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyUser, setBusyUser] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    channelApi.adminListChannelMembers(channelId)
      .then(setMembers)
      .catch(() => setMembers([]))
      .finally(() => setLoading(false))
  }, [channelId])

  useStrictModeSafeEffect(() => { reload() }, [reload])

  const setFlag = useCallback(async (userId: number, patch: Partial<ChannelMembershipRow>) => {
    setBusyUser(userId)
    setError(null)
    try {
      const row = await channelApi.adminSetChannelMember(channelId, { user_id: userId, ...patch } as {
        user_id: number
        editor_enabled?: boolean
        contributor_enabled?: boolean
        manager_enabled?: boolean
        auto_approve_proposals?: boolean
        auto_approve_comp_proposals?: boolean
      })
      setMembers((prev) => {
        const rest = prev.filter((m) => m.user_id !== userId)
        return [...rest, row].sort((a, b) => a.username.localeCompare(b.username))
      })
    } catch (e) {
      setError(errorMessage(e, 'Could not update membership'))
    } finally {
      setBusyUser(null)
    }
  }, [channelId])

  const memberIds = new Set(members.map((m) => m.user_id))
  const addable = users.filter((u) => !memberIds.has(u.user_id))

  const addMember = useCallback(async (userId: number) => {
    await setFlag(userId, { editor_enabled: false })
  }, [setFlag])

  return { members, loading, busyUser, error, setFlag, addable, addMember }
}

export function useCreateChannel(onCreated: () => void): {
  name: string
  setName: (v: string) => void
  description: string
  setDescription: (v: string) => void
  busy: boolean
  error: string | null
  submit: () => Promise<void>
} {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await channelApi.adminCreateChannel({ name: name.trim(), description: description.trim() })
      setName('')
      setDescription('')
      onCreated()
    } catch (e) {
      setError(errorMessage(e, 'Could not create the channel'))
    } finally {
      setBusy(false)
    }
  }, [name, description, busy, onCreated])

  return { name, setName, description, setDescription, busy, error, submit }
}

export function useEditChannel(channel: Channel, onSaved: () => void): {
  name: string
  setName: (v: string) => void
  description: string
  setDescription: (v: string) => void
  busy: boolean
  error: string | null
  save: () => Promise<void>
} {
  const [name, setName] = useState(channel.name)
  const [description, setDescription] = useState(channel.description ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await channelApi.adminUpdateChannel(channel.id, { name: name.trim(), description: description.trim() })
      onSaved()
    } catch (e) {
      setError(errorMessage(e, 'Could not save changes'))
    } finally {
      setBusy(false)
    }
  }, [channel.id, name, description, onSaved])

  return { name, setName, description, setDescription, busy, error, save }
}
