import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Hash, ImagePlus, Loader2, Lock, Search, ShieldCheck, Trash2, X } from 'lucide-react'
import * as api from '../../lib/chatApi'
import type { ChatChannel, ChatUserBrief } from '../../lib/chatApi'
import { adminListUsers, compressImageFile, useNowPlayingByIds } from '../../lib/userApi'
import { displayName, useChatStore } from '../../store/chatStore'
import { ConfirmDialog } from './MessageItem'
import { useStaffDirectory } from './people'
import { ChatAvatar, errorText, useChatToast } from './ui'

export function DialogShell({ title, subtitle, onClose, children, footer, width = 'max-w-md' }: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  width?: string
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-end md:items-center justify-center md:p-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className={`chat-sheet relative w-full ${width} max-h-[92vh] flex flex-col rounded-t-2xl md:rounded-2xl border border-[var(--border)] bg-surface shadow-2xl`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <header className="flex items-start gap-3 px-5 pt-5 pb-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-text-primary">{title}</h2>
            {subtitle && <p className="text-sm text-text-muted mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="w-8 h-8 -mr-1 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-overlay"><X size={18} /></button>
        </header>
        <div className="chat-scroll flex-1 min-h-0 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-[var(--border)] bg-surface-raised/40 md:rounded-b-2xl">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block mb-4">
      <span className="block text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-text-muted mt-1">{hint}</span>}
    </label>
  )
}

const inputCls = 'w-full rounded-xl bg-surface-raised border border-[var(--border)] px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/60 transition-colors'

function PrimaryButton({ children, disabled, busy, onClick, danger }: { children: React.ReactNode; disabled?: boolean; busy?: boolean; onClick: () => void; danger?: boolean }): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition disabled:opacity-40 ${danger ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-accent text-white hover:brightness-110'}`}
    >
      {busy && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  )
}

function GhostButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }): JSX.Element {
  return <button onClick={onClick} className="px-4 py-2 rounded-xl text-sm font-semibold text-text-secondary hover:bg-surface-overlay transition-colors">{children}</button>
}

function Toggle({ checked, onChange, label, description, icon }: { checked: boolean; onChange: (v: boolean) => void; label: string; description: string; icon: React.ReactNode }): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`w-full flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors mb-4 ${checked ? 'border-accent/50 bg-accent/5' : 'border-[var(--border)] hover:bg-surface-raised/50'}`}
    >
      <span className="w-9 h-9 rounded-lg bg-surface-raised flex items-center justify-center text-text-secondary shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-text-primary">{label}</span>
        <span className="block text-xs text-text-muted">{description}</span>
      </span>
      <span className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${checked ? 'bg-accent' : 'bg-surface-highest'}`}>
        <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${checked ? 'left-5' : 'left-1'}`} />
      </span>
    </button>
  )
}

// ─── People picker ───────────────────────────────────────────────────────────

function usePickablePeople(): { people: ChatUserBrief[]; loading: boolean } {
  const directory = useStaffDirectory()
  const me = useChatStore((s) => s.me)
  const meId = useChatStore((s) => s.meId)
  const [extra, setExtra] = useState<ChatUserBrief[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (me?.role !== 'administrator') return
    let cancelled = false
    setLoading(true)
    adminListUsers()
      .then((users) => {
        if (cancelled) return
        setExtra(users
          .filter((u) => u.is_active && (u.role === 'administrator' || u.manager_enabled))
          .map((u) => ({ id: u.user_id, username: u.discord_username || u.username, display_name: u.discord_username || u.username, avatar: u.discord_avatar, role: u.role === 'administrator' ? 'administrator' : 'manager' })))
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [me?.role])

  const people = useMemo(() => {
    const byId = new Map<number, ChatUserBrief>()
    for (const p of extra) byId.set(p.id, p)
    for (const p of directory) byId.set(p.id, p)
    if (meId) byId.delete(meId)
    return [...byId.values()].sort((a, b) => displayName(a).localeCompare(displayName(b)))
  }, [extra, directory, meId])

  return { people, loading }
}

function PeoplePicker({ selected, onChange, exclude, max }: {
  selected: ChatUserBrief[]
  onChange: (next: ChatUserBrief[]) => void
  exclude?: Set<number>
  max?: number
}): JSX.Element {
  const { people, loading } = usePickablePeople()
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const q = query.trim().toLowerCase()
  const selectedIds = new Set(selected.map((p) => p.id))
  const visible = people
    .filter((p) => !exclude?.has(p.id))
    .filter((p) => !q || p.username.toLowerCase().includes(q) || p.display_name.toLowerCase().includes(q))
  const byId = /^\d+$/.test(q) && !people.some((p) => String(p.id) === q) ? Number(q) : null
  const nowPlaying = useNowPlayingByIds(visible.map((p) => p.id))

  const toggle = (p: ChatUserBrief): void => {
    if (selectedIds.has(p.id)) onChange(selected.filter((x) => x.id !== p.id))
    else if (!max || selected.length < max) onChange(max === 1 ? [p] : [...selected, p])
    setQuery('')
    input.current?.focus()
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-surface-raised border border-[var(--border)] px-2 py-1.5 focus-within:border-accent/60 transition-colors">
        <Search size={15} className="text-text-muted ml-1" />
        {selected.map((p) => (
          <span key={p.id} className="chat-pop inline-flex items-center gap-1.5 rounded-full bg-accent/15 pl-0.5 pr-1.5 py-0.5 text-xs text-text-primary">
            <ChatAvatar user={p} size={18} />
            {displayName(p)}
            <button onClick={() => toggle(p)} className="text-text-muted hover:text-text-primary"><X size={11} /></button>
          </span>
        ))}
        <input
          ref={input}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !query && selected.length) onChange(selected.slice(0, -1))
            if (e.key === 'Enter' && visible[0]) { e.preventDefault(); toggle(visible[0]) }
          }}
          placeholder={selected.length ? '' : 'Search staff by name'}
          className="flex-1 min-w-[120px] bg-transparent py-1 text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
        />
      </div>
      <div className="mt-2 max-h-72 overflow-y-auto chat-scroll -mx-1">
        {loading && people.length === 0 && <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-text-muted" /></div>}
        {visible.map((p) => {
          const on = selectedIds.has(p.id)
          return (
            <button
              key={p.id}
              onClick={() => toggle(p)}
              className={`w-full flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors ${on ? 'bg-accent/10' : 'hover:bg-surface-raised/70'}`}
            >
              <ChatAvatar user={p} size={34} presence listening={!!nowPlaying[p.id]} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-text-primary truncate">{displayName(p)}</span>
                <span className="block text-xs text-text-muted truncate">@{p.username} · {p.role === 'administrator' ? 'Admin' : 'Manager'}</span>
              </span>
              <span className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${on ? 'bg-accent border-accent text-white' : 'border-[var(--border)]'}`}>
                {on && <Check size={13} strokeWidth={3} />}
              </span>
            </button>
          )
        })}
        {byId !== null && (
          <button
            onClick={() => toggle({ id: byId, username: `user${byId}`, display_name: `User #${byId}`, avatar: '', role: 'manager' })}
            className="w-full flex items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-raised/70"
          >
            <span className="w-[34px] h-[34px] rounded-full bg-surface-raised flex items-center justify-center text-text-muted text-xs font-bold">#</span>
            <span className="text-sm text-text-primary">Add user ID {byId}</span>
          </button>
        )}
        {!loading && visible.length === 0 && byId === null && (
          <p className="py-6 text-center text-xs text-text-muted leading-relaxed">
            {q ? 'No staff match that search.' : 'No one to show yet.'}
            <br />You can also type a numeric user ID.
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Servers ─────────────────────────────────────────────────────────────────

function IconPicker({ value, name, onChange }: { value: string | null; name: string; onChange: (dataUrl: string | null) => void }): JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const toast = useChatToast()
  return (
    <div className="flex items-center gap-4 mb-5">
      <button type="button" onClick={() => input.current?.click()} className="group relative">
        {value ? (
          <img src={value} alt="" className="w-20 h-20 rounded-[22px] object-cover" />
        ) : (
          <span className="w-20 h-20 rounded-[22px] border-2 border-dashed border-[var(--border)] flex flex-col items-center justify-center text-text-muted group-hover:border-accent/60 group-hover:text-accent transition-colors">
            <ImagePlus size={22} />
            <span className="text-[9px] font-bold uppercase mt-1">Icon</span>
          </span>
        )}
      </button>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-text-primary truncate">{name || 'New server'}</p>
        <p className="text-xs text-text-muted">Square images work best.</p>
        {value && <button onClick={() => onChange(null)} className="text-xs text-red-400 hover:underline mt-1">Remove icon</button>}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          try {
            onChange(await compressImageFile(file))
          } catch (err) {
            toast(errorText(err, 'Could not read that image'))
          }
        }}
      />
    </div>
  )
}

export function CreateServerModal({ onClose }: { onClose: () => void }): JSX.Element {
  const refreshLists = useChatStore((s) => s.refreshLists)
  const selectServer = useChatStore((s) => s.selectServer)
  const toast = useChatToast()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      const server = await api.createServer({ name: name.trim(), description: description.trim() || undefined, icon: icon ?? undefined })
      await refreshLists()
      selectServer(server.id)
      onClose()
    } catch (err) {
      toast(errorText(err, 'Could not create server'))
      setBusy(false)
    }
  }

  return (
    <DialogShell
      title="Create a server"
      subtitle="A home for a team, project or topic. You can add channels and people next."
      onClose={onClose}
      footer={<><GhostButton onClick={onClose}>Cancel</GhostButton><PrimaryButton onClick={create} busy={busy} disabled={!name.trim()}>Create server</PrimaryButton></>}
    >
      <IconPicker value={icon} name={name} onChange={setIcon} />
      <Field label="Server name">
        <input autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) void create() }} placeholder="Staff HQ" className={inputCls} />
      </Field>
      <Field label="Description" hint="Optional">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What's this server for?" className={`${inputCls} resize-none`} />
      </Field>
    </DialogShell>
  )
}

export function ServerSettingsModal({ serverId, onClose, onAddMembers }: { serverId: number; onClose: () => void; onAddMembers: () => void }): JSX.Element | null {
  const server = useChatStore((s) => s.servers.find((x) => x.id === serverId))
  const me = useChatStore((s) => s.me)
  const refreshLists = useChatStore((s) => s.refreshLists)
  const toast = useChatToast()
  const [name, setName] = useState(server?.name ?? '')
  const [description, setDescription] = useState(server?.description ?? '')
  const [icon, setIcon] = useState<string | null>(server?.icon_url ?? null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  if (!server) return null

  const canDelete = server.my_role === 'owner' || me?.role === 'administrator'
  const dirty = name.trim() !== server.name || description !== server.description || icon !== server.icon_url

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.updateServer(server.id, {
        name: name.trim(),
        description,
        ...(icon !== server.icon_url ? { icon: icon ?? '' } : {}),
      })
      await refreshLists()
      toast('Server updated', 'ok')
      onClose()
    } catch (err) {
      toast(errorText(err, 'Could not save'))
      setBusy(false)
    }
  }

  return (
    <DialogShell
      title="Server settings"
      subtitle={server.name}
      onClose={onClose}
      footer={<><GhostButton onClick={onClose}>Close</GhostButton><PrimaryButton onClick={save} busy={busy} disabled={!dirty || !name.trim()}>Save changes</PrimaryButton></>}
    >
      <IconPicker value={icon} name={name} onChange={setIcon} />
      <Field label="Server name">
        <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Description">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
      </Field>
      <button onClick={onAddMembers} className="w-full mb-4 rounded-xl border border-[var(--border)] px-3 py-3 text-left hover:bg-surface-raised/50 transition-colors">
        <span className="block text-sm font-semibold text-text-primary">Add members</span>
        <span className="block text-xs text-text-muted">{server.member_count} {server.member_count === 1 ? 'member' : 'members'} today</span>
      </button>
      {canDelete && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3">
          <p className="text-sm font-semibold text-red-300">Delete server</p>
          <p className="text-xs text-text-muted mt-0.5 mb-2.5">Removes every channel and message in it. This can&apos;t be undone.</p>
          <button onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 text-red-300 text-xs font-bold hover:bg-red-500/25">
            <Trash2 size={13} />Delete {server.name}
          </button>
        </div>
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${server.name}?`}
          body="All channels and messages will be permanently removed for everyone."
          confirmLabel="Delete server"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false)
            api.deleteServer(server.id)
              .then(() => {
                useChatStore.setState((s) => ({
                  servers: s.servers.filter((x) => x.id !== server.id),
                  activeServerId: null,
                  active: s.active?.kind === 'channel' && server.channels.some((c) => c.id === s.active!.id) ? null : s.active,
                }))
                onClose()
              })
              .catch((err) => toast(errorText(err, 'Could not delete server')))
          }}
        />
      )}
    </DialogShell>
  )
}

export function AddMembersModal({ serverId, onClose }: { serverId: number; onClose: () => void }): JSX.Element {
  const members = useChatStore((s) => s.members[serverId])
  const loadMembers = useChatStore((s) => s.loadMembers)
  const server = useChatStore((s) => s.servers.find((x) => x.id === serverId))
  const toast = useChatToast()
  const [selected, setSelected] = useState<ChatUserBrief[]>([])
  const [asAdmin, setAsAdmin] = useState(false)
  const [busy, setBusy] = useState(false)
  const exclude = useMemo(() => new Set((members ?? []).map((m) => m.user.id)), [members])

  useEffect(() => { void loadMembers(serverId) }, [serverId, loadMembers])

  const add = async (): Promise<void> => {
    setBusy(true)
    const results = await Promise.allSettled(selected.map((p) => api.addMember(serverId, p.id, asAdmin ? 'admin' : 'member')))
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
    await loadMembers(serverId, true).catch(() => undefined)
    if (failed.length) toast(`${failed.length} couldn't be added: ${errorText(failed[0].reason)}`)
    else toast(`Added ${selected.length} ${selected.length === 1 ? 'person' : 'people'}`, 'ok')
    setBusy(false)
    if (failed.length < results.length) onClose()
  }

  return (
    <DialogShell
      title="Add members"
      subtitle={server ? `Invite staff to ${server.name}` : undefined}
      onClose={onClose}
      footer={<><GhostButton onClick={onClose}>Cancel</GhostButton><PrimaryButton onClick={add} busy={busy} disabled={selected.length === 0}>Add {selected.length || ''}</PrimaryButton></>}
    >
      <PeoplePicker selected={selected} onChange={setSelected} exclude={exclude} />
      <div className="mt-4">
        <Toggle checked={asAdmin} onChange={setAsAdmin} icon={<ShieldCheck size={17} />} label="Add as server admins" description="Admins can manage channels and members." />
      </div>
    </DialogShell>
  )
}

export function RenameCategoryModal({ serverId, category, onClose }: { serverId: number; category: string; onClose: () => void }): JSX.Element {
  const channels = useChatStore((s) => s.servers.find((x) => x.id === serverId)?.channels.filter((c) => c.category === category) ?? [])
  const toast = useChatToast()
  const [name, setName] = useState(category)
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    const next = name.trim()
    if (next === category) { onClose(); return }
    setBusy(true)
    try {
      const updated = await Promise.all(channels.map((c) => api.updateChannel(c.id, { category: next })))
      useChatStore.setState((s) => ({
        servers: s.servers.map((x) => x.id !== serverId ? x : {
          ...x,
          channels: x.channels.map((c) => updated.find((u) => u.id === c.id) ?? c),
        }),
      }))
      onClose()
    } catch (err) {
      toast(errorText(err, 'Could not rename category'))
      setBusy(false)
    }
  }

  return (
    <DialogShell
      title="Rename category"
      subtitle={`Applies to ${channels.length} channel${channels.length === 1 ? '' : 's'}`}
      onClose={onClose}
      footer={<><GhostButton onClick={onClose}>Cancel</GhostButton><PrimaryButton onClick={save} busy={busy} disabled={!name.trim()}>Save</PrimaryButton></>}
    >
      <Field label="Category name">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save() }} placeholder="e.g. Tracker" className={inputCls} />
      </Field>
    </DialogShell>
  )
}

// ─── Channels ────────────────────────────────────────────────────────────────

function slugPreview(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 100)
}

export function ChannelModal({ serverId, channel, onClose }: { serverId: number; channel?: ChatChannel; onClose: () => void }): JSX.Element {
  const members = useChatStore((s) => s.members[serverId])
  const loadMembers = useChatStore((s) => s.loadMembers)
  const openRoom = useChatStore((s) => s.openRoom)
  const servers = useChatStore((s) => s.servers)
  const toast = useChatToast()
  const [name, setName] = useState(channel?.name ?? '')
  const [topic, setTopic] = useState(channel?.topic ?? '')
  const [category, setCategory] = useState(channel?.category ?? '')
  const [isPrivate, setPrivate] = useState(channel?.is_private ?? false)
  const [allowed, setAllowed] = useState<Set<number>>(new Set(channel?.allowed_members ?? []))
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => { void loadMembers(serverId) }, [serverId, loadMembers])

  const categories = useMemo(() => {
    const server = servers.find((s) => s.id === serverId)
    return [...new Set((server?.channels ?? []).map((c) => c.category).filter(Boolean))]
  }, [servers, serverId])

  const save = async (): Promise<void> => {
    setBusy(true)
    const body = {
      name: slugPreview(name) || name.trim(),
      topic: topic.trim(),
      category: category.trim(),
      is_private: isPrivate,
      allowed_members: isPrivate ? [...allowed] : [],
    }
    try {
      const result = channel ? await api.updateChannel(channel.id, body) : await api.createChannel(serverId, body)
      useChatStore.setState((s) => ({
        servers: s.servers.map((x) => x.id !== serverId ? x : { ...x, channels: [...x.channels.filter((c) => c.id !== result.id), result] }),
      }))
      if (!channel) openRoom({ kind: 'channel', id: result.id })
      onClose()
    } catch (err) {
      toast(errorText(err, 'Could not save channel'))
      setBusy(false)
    }
  }

  return (
    <DialogShell
      title={channel ? 'Edit channel' : 'Create channel'}
      subtitle={channel ? `#${channel.name}` : 'Channels keep conversations about one thing in one place.'}
      onClose={onClose}
      footer={<><GhostButton onClick={onClose}>Cancel</GhostButton><PrimaryButton onClick={save} busy={busy} disabled={!slugPreview(name)}>{channel ? 'Save' : 'Create channel'}</PrimaryButton></>}
    >
      <Field label="Channel name">
        <div className="relative">
          <Hash size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="new-channel" className={`${inputCls} pl-9`} />
        </div>
      </Field>
      <Field label="Topic" hint="Shown in the channel header">
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What's discussed here" className={inputCls} />
      </Field>
      <Field label="Category" hint="Channels with the same category are grouped together">
        <input value={category} onChange={(e) => setCategory(e.target.value)} list="chat-categories" placeholder="e.g. Tracker" className={inputCls} />
        <datalist id="chat-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      </Field>
      <Toggle checked={isPrivate} onChange={setPrivate} icon={<Lock size={17} />} label="Private channel" description="Only selected members, owners and admins can see it." />
      {isPrivate && (
        <div className="rounded-xl border border-[var(--border)] p-2 mb-4 max-h-60 overflow-y-auto chat-scroll">
          {!members && <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-text-muted" /></div>}
          {members?.map((m) => {
            const on = allowed.has(m.user.id)
            return (
              <button
                key={m.id}
                onClick={() => setAllowed((prev) => {
                  const next = new Set(prev)
                  if (on) next.delete(m.user.id)
                  else next.add(m.user.id)
                  return next
                })}
                className={`w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left ${on ? 'bg-accent/10' : 'hover:bg-surface-raised/60'}`}
              >
                <ChatAvatar user={m.user} size={26} />
                <span className="flex-1 text-sm text-text-primary truncate">{displayName(m.user)}</span>
                <span className={`w-4 h-4 rounded border flex items-center justify-center ${on ? 'bg-accent border-accent text-white' : 'border-[var(--border)]'}`}>{on && <Check size={11} strokeWidth={3} />}</span>
              </button>
            )
          })}
        </div>
      )}
      {channel && (
        <button onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-400 hover:underline">
          <Trash2 size={13} />Delete channel
        </button>
      )}
      {confirmDelete && channel && (
        <ConfirmDialog
          title={`Delete #${channel.name}?`}
          body="Every message in this channel will be removed. This can't be undone."
          confirmLabel="Delete channel"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false)
            api.deleteChannel(channel.id)
              .then(() => {
                useChatStore.setState((s) => ({
                  servers: s.servers.map((x) => x.id !== serverId ? x : { ...x, channels: x.channels.filter((c) => c.id !== channel.id) }),
                  active: s.active?.kind === 'channel' && s.active.id === channel.id ? null : s.active,
                }))
                onClose()
              })
              .catch((err) => toast(errorText(err, 'Could not delete channel')))
          }}
        />
      )}
    </DialogShell>
  )
}

// ─── DMs ─────────────────────────────────────────────────────────────────────

export function NewDmModal({ onClose, conversationId }: { onClose: () => void; conversationId?: number }): JSX.Element {
  const startDm = useChatStore((s) => s.startDm)
  const conv = useChatStore((s) => (conversationId ? s.conversations.find((c) => c.id === conversationId) : undefined))
  const toast = useChatToast()
  const [selected, setSelected] = useState<ChatUserBrief[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const exclude = useMemo(() => new Set(conv?.participants.map((p) => p.user.id) ?? []), [conv])
  const adding = !!conv

  const go = async (): Promise<void> => {
    setBusy(true)
    try {
      if (conv) {
        const updated = await api.updateConversation(conv.id, { add_participant_ids: selected.map((p) => p.id) })
        useChatStore.setState((s) => ({ conversations: s.conversations.map((c) => c.id === updated.id ? updated : c) }))
        const meId = useChatStore.getState().meId
        if (meId) {
          const { shareKeyWithUser } = await import('../../lib/chatE2E')
          await Promise.all(selected.map((p) => shareKeyWithUser(meId, updated, p.id).catch(() => undefined)))
        }
      } else {
        await startDm(selected.map((p) => p.id), name.trim() || undefined)
      }
      onClose()
    } catch (err) {
      toast(errorText(err, 'Could not start conversation'))
      setBusy(false)
    }
  }

  return (
    <DialogShell
      title={adding ? 'Add people' : 'New message'}
      subtitle={adding ? 'They’ll get the conversation key and see new messages.' : 'Pick one person for a direct message, or several for a group.'}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto inline-flex items-center gap-1.5 text-[11px] text-text-muted"><ShieldCheck size={13} className="text-accent" />End-to-end encrypted</span>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={go} busy={busy} disabled={selected.length === 0}>{adding ? 'Add' : selected.length > 1 ? 'Create group' : 'Start chat'}</PrimaryButton>
        </>
      }
    >
      <PeoplePicker selected={selected} onChange={setSelected} exclude={exclude} />
      {!adding && selected.length > 1 && (
        <div className="mt-4">
          <Field label="Group name" hint="Optional">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={selected.map((p) => displayName(p)).join(', ')} className={inputCls} />
          </Field>
        </div>
      )}
    </DialogShell>
  )
}
