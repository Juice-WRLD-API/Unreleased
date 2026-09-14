import { useState, useCallback } from 'react'
import { useStrictModeSafeEffect } from '../hooks/useStrictModeSafeEffect'
import {
  Loader2, Plus, Check, AlertCircle, Radio, Users, ChevronLeft, Pencil, Power, X,
} from 'lucide-react'
import * as channelApi from '../lib/channelApi'
import type { Channel, ChannelMembershipRow } from '../lib/channelApi'
import * as userApi from '../lib/userApi'
import type { AdminUser } from '../lib/userApi'
import { useStore } from '../store/useStore'
import { Empty } from './adminShared'
import { useBackToClose } from '../hooks/useBackToClose'
import { Sheet, SheetItem } from './mobile/Sheet'

// Admin-only tab for managing Comp Channels - mirrors the master/detail
// pattern the rest of AdminPage's mobile tabs use (a list that swaps for a
// full-screen detail on tap, back button undoes it) rather than the desktop
// build's permanent two-column split, which doesn't fit a phone width.

const MEMBER_FLAGS: { key: keyof ChannelMembershipRow; label: string }[] = [
  { key: 'editor_enabled', label: 'Editor' },
  { key: 'contributor_enabled', label: 'Contributor' },
  { key: 'manager_enabled', label: 'Manager' },
  { key: 'auto_approve_proposals', label: 'Auto-approve edits' },
  { key: 'auto_approve_comp_proposals', label: 'Auto-approve comp' },
]

function CreatePanel({ onCreated, onClose }: { onCreated: () => void; onClose: () => void }): JSX.Element {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await channelApi.adminCreateChannel({ name: name.trim(), description: description.trim() })
      setName('')
      setDescription('')
      onCreated()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the channel')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-surface-raised/50 p-4 space-y-3 m-3">
      <div className="flex items-center gap-2">
        <p className="text-sm font-bold text-text-primary flex items-center gap-2 flex-1"><Plus size={14} /> New channel</p>
        <button onClick={onClose} className="p-1 rounded text-text-muted active:text-text-primary"><X size={14} /></button>
      </div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Channel name - e.g. Sessions Comp"
        className="w-full rounded-xl border border-[var(--border)] bg-surface-overlay px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/40"
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        className="w-full rounded-xl border border-[var(--border)] bg-surface-overlay px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/40"
      />
      {error && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertCircle size={12} />{error}</p>}
      <button
        onClick={submit}
        disabled={busy || !name.trim()}
        className="px-3 py-2 rounded-xl bg-accent text-white text-xs font-semibold disabled:opacity-40 flex items-center gap-1.5"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
        Create channel
      </button>
      <p className="text-[11px] text-text-muted leading-relaxed">
        An empty root folder is created on disk for the new channel. Its inner structure is built later from the contributor dashboard.
      </p>
    </div>
  )
}

function EditPanel({ channel, onSaved, onClose }: { channel: Channel; onSaved: () => void; onClose: () => void }): JSX.Element {
  const [name, setName] = useState(channel.name)
  const [description, setDescription] = useState(channel.description ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await channelApi.adminUpdateChannel(channel.id, { name: name.trim(), description: description.trim() })
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save changes')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-accent/30 bg-surface-raised/50 p-4 space-y-3 m-3">
      <div className="flex items-center gap-2">
        <Pencil size={13} className="text-accent" />
        <span className="text-sm font-semibold text-text-primary flex-1">Edit {channel.slug}</span>
        <button onClick={onClose} className="p-1 rounded text-text-muted active:text-text-primary"><X size={14} /></button>
      </div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-xl border border-[var(--border)] bg-surface-overlay px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/40"
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description"
        className="w-full rounded-xl border border-[var(--border)] bg-surface-overlay px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/40"
      />
      {error && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertCircle size={12} />{error}</p>}
      <button
        onClick={save}
        disabled={busy || !name.trim()}
        className="px-3 py-2 rounded-xl bg-accent text-white text-xs font-semibold disabled:opacity-40 flex items-center gap-1.5"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
        Save
      </button>
    </div>
  )
}

// ── Channel detail (members) ────────────────────────────────────────────────

function ChannelDetail({ channel, users, onBack, onChanged }: {
  channel: Channel
  users: AdminUser[]
  onBack: () => void
  onChanged: () => void
}): JSX.Element {
  const [members, setMembers] = useState<ChannelMembershipRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyUser, setBusyUser] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [addSheetOpen, setAddSheetOpen] = useState(false)
  const [busyToggle, setBusyToggle] = useState(false)

  useBackToClose(onBack, !editing && !addSheetOpen)

  const reload = useCallback(() => {
    setLoading(true)
    channelApi.adminListChannelMembers(channel.id)
      .then(setMembers)
      .catch(() => setMembers([]))
      .finally(() => setLoading(false))
  }, [channel.id])

  useStrictModeSafeEffect(() => { reload() }, [reload])

  const setFlag = async (userId: number, patch: Partial<ChannelMembershipRow>): Promise<void> => {
    setBusyUser(userId)
    setError(null)
    try {
      const row = await channelApi.adminSetChannelMember(channel.id, { user_id: userId, ...patch } as {
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
      setError(e instanceof Error ? e.message : 'Could not update membership')
    } finally {
      setBusyUser(null)
    }
  }

  const memberIds = new Set(members.map((m) => m.user_id))
  const addable = users.filter((u) => !memberIds.has(u.user_id))

  const addMember = async (userId: number): Promise<void> => {
    setAddSheetOpen(false)
    await setFlag(userId, { editor_enabled: false })
  }

  const toggleActive = async (): Promise<void> => {
    setBusyToggle(true)
    try {
      if (channel.is_active) await channelApi.adminDeactivateChannel(channel.id)
      else await channelApi.adminUpdateChannel(channel.id, { is_active: true })
      onChanged()
    } finally {
      setBusyToggle(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border)]">
        <button onClick={onBack} className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-text-primary active:bg-surface-overlay transition-colors">
          <ChevronLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold text-text-primary truncate">{channel.name}</p>
          <p className="text-[11px] text-text-muted truncate">{channel.slug}{channel.description ? ` · ${channel.description}` : ''}</p>
        </div>
        {!channel.is_primary && (
          <>
            <button
              onClick={() => setEditing((e) => !e)}
              className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full text-text-muted active:bg-surface-overlay transition-colors"
              aria-label="Edit channel"
            ><Pencil size={15} /></button>
            <button
              onClick={toggleActive}
              disabled={busyToggle}
              className={`w-9 h-9 shrink-0 flex items-center justify-center rounded-full transition-colors disabled:opacity-40 ${
                channel.is_active ? 'text-red-400 active:bg-red-500/10' : 'text-emerald-400 active:bg-emerald-500/10'
              }`}
              aria-label={channel.is_active ? 'Deactivate channel' : 'Reactivate channel'}
            >{busyToggle ? <Loader2 size={15} className="animate-spin" /> : <Power size={15} />}</button>
          </>
        )}
      </div>

      {editing && !channel.is_primary && (
        <EditPanel channel={channel} onClose={() => setEditing(false)} onSaved={onChanged} />
      )}

      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)]">
        <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted flex items-center gap-1.5">
          <Users size={12} /> Members
        </p>
        <button
          onClick={() => setAddSheetOpen(true)}
          disabled={addable.length === 0}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent/15 text-accent text-xs font-semibold disabled:opacity-40"
        >
          <Plus size={12} /> Add
        </button>
      </div>

      {error && (
        <div className="mx-3 mt-2 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs shrink-0">
          <AlertCircle size={13} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin text-text-muted" /></div>
        ) : members.length === 0 ? (
          <Empty label="No members yet" />
        ) : (
          members.map((m) => (
            <div key={m.user_id} className="px-4 py-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-2 mb-2">
                <p className="text-sm font-medium text-text-primary flex-1 truncate">{m.username}</p>
                {busyUser === m.user_id && <Loader2 size={13} className="animate-spin text-text-muted" />}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {MEMBER_FLAGS.map(({ key, label }) => {
                  const on = !!m[key]
                  return (
                    <button
                      key={key as string}
                      onClick={() => setFlag(m.user_id, { [key]: !on } as Partial<ChannelMembershipRow>)}
                      disabled={busyUser === m.user_id}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-semibold border transition-colors flex items-center gap-1 ${
                        on
                          ? 'bg-accent/15 text-accent border-accent/30'
                          : 'bg-surface-overlay text-text-muted border-[var(--border)] active:text-text-primary'
                      }`}
                    >
                      {on && <Check size={10} />}{label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {addSheetOpen && (
        <Sheet title="Add member" onClose={() => setAddSheetOpen(false)}>
          {addable.length === 0 ? (
            <Empty label="Everyone is already a member" />
          ) : (
            addable.map((u) => (
              <SheetItem
                key={u.user_id}
                icon={Users}
                label={u.discord_username || u.username}
                onClick={() => addMember(u.user_id)}
              />
            ))
          )}
        </Sheet>
      )}
    </div>
  )
}

// ── List ─────────────────────────────────────────────────────────────────────

export default function ChannelsTab(): JSX.Element {
  const loadChannels = useStore((s) => s.loadChannels)
  const [channels, setChannels] = useState<Channel[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)

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

  const selected = channels.find((c) => c.id === selectedId) ?? null

  if (loading) return <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-text-muted" /></div>

  if (selected) {
    return (
      <ChannelDetail
        channel={selected}
        users={users}
        onBack={() => setSelectedId(null)}
        onChanged={reload}
      />
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)]">
        <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted flex items-center gap-1.5">
          <Radio size={12} /> Channels
        </p>
        <button
          onClick={() => setCreating((c) => !c)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent/15 text-accent text-xs font-semibold"
        >
          <Plus size={12} /> New
        </button>
      </div>

      {creating && <CreatePanel onCreated={reload} onClose={() => setCreating(false)} />}

      <div className="flex-1 overflow-y-auto">
        {channels.length === 0 && <Empty label="No channels" />}
        {channels.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedId(c.id)}
            className="w-full text-left px-4 py-3 border-b border-[var(--border)] active:bg-surface-raised transition-colors"
          >
            <div className="flex items-center gap-2">
              <Radio size={13} className={c.is_active ? 'text-accent' : 'text-text-muted'} />
              <span className="text-sm font-semibold text-text-primary truncate flex-1">{c.name}</span>
              {c.is_primary && <span className="text-[9px] font-bold uppercase text-accent bg-accent/15 px-1.5 py-0.5 rounded">primary</span>}
              {!c.is_active && <span className="text-[9px] font-bold uppercase text-red-400 bg-red-500/15 px-1.5 py-0.5 rounded">off</span>}
            </div>
            <p className="text-[10px] text-text-muted mt-0.5 truncate">{c.slug}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
