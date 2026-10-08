import { useState } from 'react'
import {
  Loader2, Plus, Check, AlertCircle, Radio, Users, X as XIcon, Pencil, Power,
} from 'lucide-react'
import type { Channel } from '../lib/channelApi'
import type { AdminUser } from '../lib/userApi'
import { discordHandle } from '../lib/format'
import { Empty } from './adminShared'
import {
  MEMBER_FLAGS, useChannelList, useToggleChannelActive, useChannelMembers,
  useCreateChannel, useEditChannel,
} from '../hooks/useChannelsAdmin'

function CreatePanel({ onCreated }: { onCreated: () => void }): JSX.Element {
  const { name, setName, description, setDescription, busy, error, submit } = useCreateChannel(onCreated)

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-surface-raised/50 p-4 space-y-3">
      <p className="text-sm font-bold text-text-primary flex items-center gap-2"><Plus size={14} /> New channel</p>
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

function MembersPanel({ channel, users }: { channel: Channel; users: AdminUser[] }): JSX.Element {
  const [addUserId, setAddUserId] = useState('')
  const { members, loading, busyUser, error, setFlag, addable, addMember } = useChannelMembers(channel.id, users)

  const onAdd = async (): Promise<void> => {
    const id = Number(addUserId)
    if (!id) return
    await addMember(id)
    setAddUserId('')
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="shrink-0 px-4 py-3 border-b border-[var(--border)] bg-surface-raised">
        <p className="text-sm font-bold text-text-primary flex items-center gap-2">
          <Users size={14} /> Members · {channel.name}
        </p>
        <div className="flex items-center gap-2 mt-2">
          <select
            value={addUserId}
            onChange={(e) => setAddUserId(e.target.value)}
            className="flex-1 bg-surface-overlay border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent/40"
          >
            <option value="">Add a user…</option>
            {addable.map((u) => (
              <option key={u.user_id} value={u.user_id}>{discordHandle(u)}</option>
            ))}
          </select>
          <button
            onClick={onAdd}
            disabled={!addUserId}
            className="px-3 py-1.5 rounded-lg bg-accent/10 text-accent text-xs font-semibold disabled:opacity-40 flex items-center gap-1.5"
          >
            <Plus size={13} /> Add
          </button>
        </div>
        {error && <p className="text-xs text-red-400 mt-2 flex items-center gap-1.5"><AlertCircle size={12} />{error}</p>}
      </div>

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
                      onClick={() => setFlag(m.user_id, { [key]: !on })}
                      disabled={busyUser === m.user_id}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-semibold border transition-colors flex items-center gap-1 ${
                        on
                          ? 'bg-accent/15 text-accent border-accent/30'
                          : 'bg-surface-overlay text-text-muted border-[var(--border)] hover:text-text-primary'
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
    </div>
  )
}

function EditPanel({ channel, onSaved, onClose }: { channel: Channel; onSaved: () => void; onClose: () => void }): JSX.Element {
  const { name, setName, description, setDescription, busy, error, save } = useEditChannel(channel, onSaved)

  return (
    <div className="rounded-2xl border border-accent/30 bg-surface-raised/50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Pencil size={13} className="text-accent" />
        <span className="text-sm font-semibold text-text-primary flex-1">Edit {channel.slug}</span>
        <button onClick={onClose} title="Close" className="p-1 rounded text-text-muted hover:text-text-primary"><XIcon size={14} /></button>
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

export default function ChannelsTab(): JSX.Element {
  const { channels, users, loading, reload } = useChannelList()
  const [selected, setSelected] = useState<Channel | null>(null)
  const [editing, setEditing] = useState(false)
  const { busyId, toggleActive } = useToggleChannelActive(reload)

  const current = selected ? channels.find((c) => c.id === selected.id) ?? channels[0] ?? null : channels[0] ?? null

  if (loading) return <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-text-muted" /></div>

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-80 shrink-0 border-r border-[var(--border)] flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {channels.length === 0 && <Empty label="No channels" />}
          {channels.map((c) => (
            <button
              key={c.id}
              onClick={() => { setSelected(c); setEditing(false) }}
              className={`w-full text-left px-4 py-3 border-b border-[var(--border)] transition-colors ${
                current?.id === c.id ? 'bg-accent/10' : 'hover:bg-surface-raised'
              }`}
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
        <div className="shrink-0 p-3 border-t border-[var(--border)]">
          <CreatePanel onCreated={reload} />
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {!current ? (
          <Empty label="Select a channel" />
        ) : (
          <>
            <div className="shrink-0 px-4 py-3 border-b border-[var(--border)] bg-surface-raised flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-text-primary truncate">{current.name}</p>
                <p className="text-[10px] text-text-muted">{current.slug}{current.description ? ` · ${current.description}` : ''}</p>
              </div>
              {!current.is_primary && (
                <>
                  <button
                    onClick={() => setEditing((e) => !e)}
                    className="px-2.5 py-1.5 rounded-lg bg-surface-overlay text-text-secondary hover:text-text-primary text-xs font-semibold flex items-center gap-1.5 border border-[var(--border)]"
                  >
                    <Pencil size={13} /> Edit
                  </button>
                  <button
                    onClick={() => toggleActive(current)}
                    disabled={busyId === current.id}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-colors ${
                      current.is_active
                        ? 'bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20'
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                    }`}
                  >
                    {busyId === current.id ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />}
                    {current.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </>
              )}
            </div>

            {editing && !current.is_primary && (
              <div className="p-4">
                <EditPanel channel={current} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload() }} />
              </div>
            )}

            <MembersPanel key={current.id} channel={current} users={users} />
          </>
        )}
      </div>
    </div>
  )
}
