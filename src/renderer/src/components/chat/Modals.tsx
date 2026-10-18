import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { Check, ChevronDown, Globe, Hash, ImagePlus, Loader2, Lock, Plus, Search, ShieldCheck, Slash, Trash2, X } from 'lucide-react'
import ThemedColorPicker from '../ThemedColorPicker'
import * as api from '../../lib/chatApi'
import { CHAT_PERMISSIONS, type ChannelOverride, type ChatChannel, type ChatMember, type ChatPermissionName, type ChatUserBrief, type PublicServerSummary, type ServerRoleDef } from '../../lib/chatApi'
import { adminListUsers, compressImageFile } from '../../lib/userApi'
import { displayName, useChatStore, useNowPlayingByIds } from '../../store/chatStore'
import { useChatPermissions } from '../../hooks/useChatPermissions'
import { ConfirmDialog } from './MessageItem'
import { useStaffDirectory } from './people'
import { ChatAvatar, errorText, ServerGlyph, useChatToast } from './ui'
import { useEscapeToClose } from '../../hooks/useEscapeToClose'

const EMPTY_CATEGORIES: string[] = []

export function DialogShell({ title, subtitle, onClose, children, footer, width = 'max-w-md' }: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  width?: string
}): JSX.Element {
  useEscapeToClose(onClose)
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
          <button onClick={onClose} title="Close" className="w-8 h-8 -mr-1 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-overlay"><X size={18} /></button>
        </header>
        <div className="chat-scroll flex-1 min-h-0 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-[var(--border)] bg-surface-raised/40 md:rounded-b-2xl">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block mb-4">
      <span className="block text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-text-muted mt-1">{hint}</span>}
    </label>
  )
}

export const inputCls = 'w-full rounded-xl bg-surface-raised border border-[var(--border)] px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/60 transition-colors'

export function PrimaryButton({ children, disabled, busy, onClick, danger }: { children: React.ReactNode; disabled?: boolean; busy?: boolean; onClick: () => void; danger?: boolean }): JSX.Element {
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

export function GhostButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }): JSX.Element {
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

export function PeoplePicker({ selected, onChange, exclude, max }: {
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
  const me = useChatStore((s) => s.me)
  const toast = useChatToast()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState<string | null>(null)
  // Same rule as ServerSettingsModal: only platform admins may publish a
  // server, so anyone else just doesn't see the choice.
  const canTogglePublic = me?.role === 'administrator'
  const [isPublic, setIsPublic] = useState(false)
  const [busy, setBusy] = useState(false)

  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      const wantPublic = canTogglePublic && isPublic
      let server = await api.createServer({
        name: name.trim(),
        description: description.trim() || undefined,
        icon: icon ?? undefined,
        ...(wantPublic ? { is_public: true } : {}),
      })
      // POST /servers/ predates is_public and some deployments still drop it,
      // so publish with a follow-up PATCH when the created server came back
      // private anyway. A failure there shouldn't lose the server itself - it
      // is already made, and the toggle is still there in Server settings.
      if (wantPublic && !server.is_public) {
        try {
          server = await api.updateServer(server.id, { is_public: true })
        } catch (err) {
          toast(errorText(err, 'Server created, but could not make it public'))
        }
      }
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
      {canTogglePublic && (
        <Toggle
          checked={isPublic}
          onChange={setIsPublic}
          icon={<Globe size={17} />}
          label="Public server"
          description="Anyone can discover and join it from Discover servers. You can change this later."
        />
      )}
    </DialogShell>
  )
}

export function ServerSettingsModal({ serverId, onClose, onAddMembers, onRoles }: { serverId: number; onClose: () => void; onAddMembers: () => void; onRoles: () => void }): JSX.Element | null {
  const server = useChatStore((s) => s.servers.find((x) => x.id === serverId))
  const me = useChatStore((s) => s.me)
  const refreshLists = useChatStore((s) => s.refreshLists)
  const toast = useChatToast()
  const [name, setName] = useState(server?.name ?? '')
  const [description, setDescription] = useState(server?.description ?? '')
  const [icon, setIcon] = useState<string | null>(server?.icon_url ?? null)
  const [isPublic, setIsPublic] = useState(server?.is_public ?? false)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  if (!server) return null

  const canDelete = server.my_role === 'owner' || me?.role === 'administrator'
  // Only platform admins may toggle is_public - PATCH /servers/{id}/ 403s for
  // anyone else, owner or not.
  const canTogglePublic = me?.role === 'administrator'
  const dirty = name.trim() !== server.name || description !== server.description || icon !== server.icon_url || isPublic !== server.is_public

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.updateServer(server.id, {
        name: name.trim(),
        description,
        ...(icon !== server.icon_url ? { icon: icon ?? '' } : {}),
        ...(canTogglePublic && isPublic !== server.is_public ? { is_public: isPublic } : {}),
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
      {canTogglePublic && (
        <Toggle
          checked={isPublic}
          onChange={setIsPublic}
          icon={<Globe size={17} />}
          label="Public server"
          description="Anyone can discover and join it from Discover servers."
        />
      )}
      <button onClick={onAddMembers} className="w-full mb-2.5 rounded-xl border border-[var(--border)] px-3 py-3 text-left hover:bg-surface-raised/50 transition-colors">
        <span className="block text-sm font-semibold text-text-primary">Add members</span>
        <span className="block text-xs text-text-muted">{server.member_count} {server.member_count === 1 ? 'member' : 'members'} today</span>
      </button>
      <button onClick={onRoles} className="w-full mb-4 rounded-xl border border-[var(--border)] px-3 py-3 text-left hover:bg-surface-raised/50 transition-colors">
        <span className="block text-sm font-semibold text-text-primary">Roles</span>
        <span className="block text-xs text-text-muted">{server.roles.length} role{server.roles.length === 1 ? '' : 's'} · colors, hierarchy, permissions</span>
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
  const channels = useChatStore(useShallow((s) => s.servers.find((x) => x.id === serverId)?.channels.filter((c) => c.category === category) ?? []))
  const renameLocalCategory = useChatStore((s) => s.renameLocalCategory)
  const toast = useChatToast()
  const [name, setName] = useState(category)
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    const next = name.trim()
    if (next === category) { onClose(); return }
    if (channels.length === 0) {
      renameLocalCategory(serverId, category, next)
      onClose()
      return
    }
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
      subtitle={channels.length > 0 ? `Applies to ${channels.length} channel${channels.length === 1 ? '' : 's'}` : 'This category has no channels yet'}
      onClose={onClose}
      footer={<><GhostButton onClick={onClose}>Cancel</GhostButton><PrimaryButton onClick={save} busy={busy} disabled={!name.trim()}>Save</PrimaryButton></>}
    >
      <Field label="Category name">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save() }} placeholder="e.g. Tracker" className={inputCls} />
      </Field>
    </DialogShell>
  )
}

export function CreateCategoryModal({ serverId, onClose }: { serverId: number; onClose: () => void }): JSX.Element {
  const existing = useChatStore(useShallow((s) => {
    const server = s.servers.find((x) => x.id === serverId)
    return new Set([...(server?.channels.map((c) => c.category).filter(Boolean) ?? []), ...(s.localCategories[serverId] ?? [])])
  }))
  const addLocalCategory = useChatStore((s) => s.addLocalCategory)
  const toast = useChatToast()
  const [name, setName] = useState('')

  const save = (): void => {
    const next = name.trim()
    if (!next) return
    if (existing.has(next)) { toast('That category already exists'); return }
    addLocalCategory(serverId, next)
    onClose()
  }

  return (
    <DialogShell
      title="Create category"
      subtitle="Group channels under a heading - add channels to it whenever you're ready"
      onClose={onClose}
      footer={<><GhostButton onClick={onClose}>Cancel</GhostButton><PrimaryButton onClick={save} disabled={!name.trim()}>Create category</PrimaryButton></>}
    >
      <Field label="Category name">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save() }} placeholder="e.g. Tracker" className={inputCls} />
      </Field>
    </DialogShell>
  )
}

export function DiscoverServersModal({ onClose }: { onClose: () => void }): JSX.Element {
  const refreshLists = useChatStore((s) => s.refreshLists)
  const selectServer = useChatStore((s) => s.selectServer)
  const toast = useChatToast()
  const [servers, setServers] = useState<PublicServerSummary[] | null>(null)
  const [joiningId, setJoiningId] = useState<number | null>(null)
  // Servers the join attempt came back 403-banned from. There's no field on
  // the discover payload saying so, so the row only learns it by trying.
  const [bannedFrom, setBannedFrom] = useState<Set<number>>(new Set())

  useEffect(() => {
    let cancelled = false
    api.discoverServers()
      .then((list) => { if (!cancelled) setServers(list) })
      .catch((err) => { if (!cancelled) toast(errorText(err, 'Could not load public servers')) })
    return () => { cancelled = true }
  }, [toast])

  const join = async (server: PublicServerSummary): Promise<void> => {
    setJoiningId(server.id)
    try {
      const joined = await api.joinServer(server.id)
      await refreshLists()
      selectServer(joined.id)
      onClose()
    } catch (err) {
      const message = errorText(err, 'Could not join server')
      if (/banned/i.test(message)) setBannedFrom((prev) => new Set(prev).add(server.id))
      toast(message)
      setJoiningId(null)
    }
  }

  return (
    <DialogShell title="Discover servers" subtitle="Public servers anyone can join" onClose={onClose} footer={<GhostButton onClick={onClose}>Close</GhostButton>}>
      {!servers && <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-text-muted" /></div>}
      {servers?.length === 0 && <p className="text-sm text-text-muted text-center py-8">No public servers to join yet.</p>}
      {servers?.map((server) => (
        <div key={server.id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] px-3 py-2.5 mb-2">
          <ServerGlyph server={server} size={40} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-text-primary truncate">{server.name}</p>
            <p className="text-xs text-text-muted truncate">{server.description || `${server.member_count} member${server.member_count === 1 ? '' : 's'}`}</p>
          </div>
          {server.is_member ? (
            <span className="shrink-0 text-xs font-semibold text-text-muted px-3 py-1.5">Joined</span>
          ) : bannedFrom.has(server.id) ? (
            <span className="shrink-0 text-xs font-semibold text-red-400 px-3 py-1.5">Banned</span>
          ) : (
            <PrimaryButton onClick={() => void join(server)} busy={joiningId === server.id}>Join</PrimaryButton>
          )}
        </div>
      ))}
    </DialogShell>
  )
}

// ─── Roles & permissions ───────────────────────────────────────────────────────

const PERMISSION_LABELS: Record<ChatPermissionName, string> = {
  view_channels: 'View channels',
  send_messages: 'Send messages',
  manage_messages: 'Manage messages',
  manage_channels: 'Manage channels',
  manage_server: 'Manage server',
  manage_roles: 'Manage roles',
  kick_members: 'Kick members',
  ban_members: 'Ban members',
  mention_everyone: 'Mention @everyone',
  attach_files: 'Attach files',
  add_reactions: 'Add reactions',
  manage_threads: 'Manage threads',
  administrator: 'Administrator (all)',
}

const PERMISSION_KEYS = Object.keys(CHAT_PERMISSIONS) as ChatPermissionName[]

function PermissionCheckboxes({ value, onChange, columns = 2 }: { value: number; onChange: (next: number) => void; columns?: 1 | 2 }): JSX.Element {
  return (
    <div className={`grid gap-1 mb-3 ${columns === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {PERMISSION_KEYS.map((key) => {
        const bit = CHAT_PERMISSIONS[key]
        const on = (value & bit) !== 0
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(on ? value & ~bit : value | bit)}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${on ? 'bg-accent/10 text-text-primary' : 'text-text-secondary hover:bg-surface-raised/60'}`}
          >
            <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? 'bg-accent border-accent text-white' : 'border-[var(--border)]'}`}>
              {on && <Check size={11} strokeWidth={3} />}
            </span>
            {PERMISSION_LABELS[key]}
          </button>
        )
      })}
    </div>
  )
}

function RoleRow({ serverId, role, canManage }: { serverId: number; role: ServerRoleDef; canManage: boolean }): JSX.Element {
  const loadRoles = useChatStore((s) => s.loadRoles)
  const toast = useChatToast()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(role.name)
  const [color, setColor] = useState(role.color)
  const [position, setPosition] = useState(role.position)
  const [permissions, setPermissions] = useState(role.permissions)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (open) return
    setName(role.name)
    setColor(role.color)
    setPosition(role.position)
    setPermissions(role.permissions)
  }, [role, open])

  const dirty = name !== role.name || color !== role.color || position !== role.position || permissions !== role.permissions

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const body: Partial<api.RoleInput> = { color, permissions }
      if (!role.is_default) { body.name = name.trim(); body.position = position }
      await api.updateRole(serverId, role.id, body)
      await loadRoles(serverId, true)
      setOpen(false)
    } catch (err) {
      toast(errorText(err, 'Could not save role'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] mb-2 overflow-hidden">
      <button
        type="button"
        onClick={() => canManage && setOpen((v) => !v)}
        className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left ${canManage ? 'hover:bg-surface-raised/50' : ''}`}
      >
        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: role.color || '#8a8f98' }} />
        <span className="flex-1 min-w-0 text-sm font-semibold text-text-primary truncate">{role.name}</span>
        <span className="text-[11px] text-text-muted">{role.permission_names.length} perm{role.permission_names.length === 1 ? '' : 's'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 border-t border-[var(--border)] pt-3">
          <div className="flex items-center gap-2 mb-3">
            <ThemedColorPicker value={color || '#8a8f98'} onChange={setColor} title="Role color" className="w-9 h-9 rounded-lg border border-[var(--border)]" />
            {!role.is_default ? (
              <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} flex-1`} />
            ) : (
              <span className="flex-1 text-sm text-text-muted italic">@everyone — implicit for every member</span>
            )}
          </div>
          {!role.is_default && (
            <Field label="Position" hint="Higher = more authority">
              <input type="number" value={position} onChange={(e) => setPosition(Number(e.target.value))} className={inputCls} />
            </Field>
          )}
          <PermissionCheckboxes value={permissions} onChange={setPermissions} />
          <div className="flex items-center justify-between">
            {!role.is_default ? (
              <button onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-400 hover:underline">
                <Trash2 size={13} />Delete role
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <GhostButton onClick={() => setOpen(false)}>Cancel</GhostButton>
              <PrimaryButton onClick={save} busy={busy} disabled={!dirty || (!role.is_default && !name.trim())}>Save</PrimaryButton>
            </div>
          </div>
          {confirmDelete && (
            <ConfirmDialog
              title={`Delete ${role.name}?`}
              body="Members who only hold this role immediately lose its permissions. This can't be undone."
              confirmLabel="Delete role"
              onCancel={() => setConfirmDelete(false)}
              onConfirm={() => {
                setConfirmDelete(false)
                api.deleteRole(serverId, role.id)
                  .then(() => loadRoles(serverId, true))
                  .catch((err) => toast(errorText(err, 'Could not delete role')))
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

function NewRoleRow({ serverId, onDone }: { serverId: number; onDone: () => void }): JSX.Element {
  const loadRoles = useChatStore((s) => s.loadRoles)
  const toast = useChatToast()
  const [name, setName] = useState('New Role')
  const [color, setColor] = useState('#5865F2')
  const [permissions, setPermissions] = useState<number>(CHAT_PERMISSIONS.view_channels | CHAT_PERMISSIONS.send_messages)
  const [busy, setBusy] = useState(false)

  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.createRole(serverId, { name: name.trim(), color, position: 1, permissions })
      await loadRoles(serverId, true)
      onDone()
    } catch (err) {
      toast(errorText(err, 'Could not create role'))
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-accent/40 bg-accent/5 p-3 mb-2">
      <div className="flex items-center gap-2 mb-3">
        <ThemedColorPicker value={color} onChange={setColor} title="Role color" className="w-9 h-9 rounded-lg border border-[var(--border)]" />
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} flex-1`} />
      </div>
      <PermissionCheckboxes value={permissions} onChange={setPermissions} />
      <div className="flex justify-end gap-2">
        <GhostButton onClick={onDone}>Cancel</GhostButton>
        <PrimaryButton onClick={create} busy={busy} disabled={!name.trim()}>Create role</PrimaryButton>
      </div>
    </div>
  )
}

export function RolesModal({ serverId, onClose }: { serverId: number; onClose: () => void }): JSX.Element {
  const roles = useChatStore((s) => s.roles[serverId])
  const loadRoles = useChatStore((s) => s.loadRoles)
  const perms = useChatPermissions(serverId)
  const [creating, setCreating] = useState(false)

  useEffect(() => { void loadRoles(serverId) }, [serverId, loadRoles])

  const sorted = useMemo(() => (roles ?? []).slice().sort((a, b) => b.position - a.position), [roles])

  return (
    <DialogShell title="Roles" subtitle="Colors, hierarchy and permissions for this server" onClose={onClose} footer={<GhostButton onClick={onClose}>Close</GhostButton>} width="max-w-lg">
      {!roles && <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-text-muted" /></div>}
      {roles && sorted.map((role) => <RoleRow key={role.id} serverId={serverId} role={role} canManage={perms.canManageRoles} />)}
      {perms.canManageRoles && (
        creating
          ? <NewRoleRow serverId={serverId} onDone={() => setCreating(false)} />
          : <button onClick={() => setCreating(true)} className="w-full rounded-xl border border-dashed border-[var(--border)] py-2.5 text-xs font-semibold text-text-muted hover:text-text-primary hover:border-text-muted transition-colors">+ New role</button>
      )}
    </DialogShell>
  )
}

export function MemberRolesModal({ serverId, member, onClose }: { serverId: number; member: ChatMember; onClose: () => void }): JSX.Element {
  const roles = useChatStore((s) => s.roles[serverId])
  const loadRoles = useChatStore((s) => s.loadRoles)
  const loadMembers = useChatStore((s) => s.loadMembers)
  const toast = useChatToast()
  const [selected, setSelected] = useState<Set<number>>(new Set(member.roles.map((r) => r.id)))
  const [busy, setBusy] = useState(false)

  useEffect(() => { void loadRoles(serverId) }, [serverId, loadRoles])

  const assignable = useMemo(() => (roles ?? []).filter((r) => !r.is_default).slice().sort((a, b) => b.position - a.position), [roles])

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.setMemberRoles(serverId, member.user.id, [...selected])
      await loadMembers(serverId, true)
      onClose()
    } catch (err) {
      toast(errorText(err, 'Could not update roles'))
      setBusy(false)
    }
  }

  return (
    <DialogShell
      title="Manage roles"
      subtitle={displayName(member.user)}
      onClose={onClose}
      footer={<><GhostButton onClick={onClose}>Cancel</GhostButton><PrimaryButton onClick={save} busy={busy}>Save</PrimaryButton></>}
    >
      {!roles && <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-text-muted" /></div>}
      {roles && assignable.length === 0 && <p className="text-xs text-text-muted py-4 text-center">No assignable roles yet — create one from Server settings → Roles first.</p>}
      {assignable.map((role) => {
        const on = selected.has(role.id)
        return (
          <button
            key={role.id}
            type="button"
            onClick={() => setSelected((prev) => {
              const next = new Set(prev)
              if (on) next.delete(role.id)
              else next.add(role.id)
              return next
            })}
            className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 mb-1.5 text-left transition-colors ${on ? 'bg-accent/10' : 'hover:bg-surface-raised/60'}`}
          >
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: role.color || '#8a8f98' }} />
            <span className="flex-1 text-sm text-text-primary truncate">{role.name}</span>
            <span className={`w-5 h-5 rounded-md border flex items-center justify-center ${on ? 'bg-accent border-accent text-white' : 'border-[var(--border)]'}`}>{on && <Check size={13} strokeWidth={3} />}</span>
          </button>
        )
      })}
    </DialogShell>
  )
}

// ─── Channel permissions ─────────────────────────────────────────────────────

// Only the bits that mean something per channel; server-wide ones (kick, ban,
// manage roles/server, administrator) are left alone on each row.
const CHANNEL_PERMS: { key: ChatPermissionName; hint: string }[] = [
  { key: 'view_channels', hint: 'See the channel and read its messages' },
  { key: 'send_messages', hint: 'Post new messages' },
  { key: 'attach_files', hint: 'Upload files and images' },
  { key: 'add_reactions', hint: 'React to messages' },
  { key: 'mention_everyone', hint: 'Ping @everyone' },
  { key: 'manage_threads', hint: 'Rename, close and delete threads' },
  { key: 'manage_messages', hint: "Delete and pin other people's messages" },
  { key: 'manage_channels', hint: 'Edit this channel and its permissions' },
]

const bitCount = (mask: number): number => CHANNEL_PERMS.reduce((n, p) => n + ((mask & CHAT_PERMISSIONS[p.key]) ? 1 : 0), 0)

function TriState({ state, onChange }: { state: -1 | 0 | 1; onChange: (next: -1 | 0 | 1) => void }): JSX.Element {
  const btn = (value: -1 | 0 | 1, title: string, icon: React.ReactNode, on: string): JSX.Element => (
    <button
      type="button"
      title={title}
      aria-pressed={state === value}
      onClick={() => onChange(value)}
      className={`w-8 h-7 flex items-center justify-center transition-colors ${state === value ? on : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay'}`}
    >
      {icon}
    </button>
  )
  return (
    <div className="flex shrink-0 rounded-lg border border-[var(--border)] overflow-hidden divide-x divide-[var(--border)]">
      {btn(-1, 'Deny', <X size={14} strokeWidth={3} />, 'bg-red-500 text-white')}
      {btn(0, 'Inherit from server roles', <Slash size={12} strokeWidth={3} />, 'bg-surface-highest text-text-primary')}
      {btn(1, 'Allow', <Check size={14} strokeWidth={3} />, 'bg-emerald-500 text-white')}
    </div>
  )
}

function ChannelPermissionsSection({ channelId, serverId }: { channelId: number; serverId: number }): JSX.Element {
  const roles = useChatStore((s) => s.roles[serverId])
  const loadRoles = useChatStore((s) => s.loadRoles)
  const members = useChatStore((s) => s.members[serverId])
  const toast = useChatToast()
  const [overrides, setOverridesState] = useState<ChannelOverride[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(0)

  // Writes are optimistic: the UI updates at once and each row (role or
  // member) has its own queue, so rapid clicks collapse into the latest state
  // and responses can't land out of order.
  const overridesRef = useRef<ChannelOverride[]>([])
  const desired = useRef(new Map<string, api.OverrideTarget>())
  const running = useRef(new Set<string>())
  const setOverrides = (next: ChannelOverride[]): void => { overridesRef.current = next; setOverridesState(next) }

  const load = (): void => {
    api.listOverrides(channelId).then(setOverrides).catch((err) => toast(errorText(err, 'Could not load permissions')))
  }
  useEffect(() => { load(); void loadRoles(serverId) }, [channelId, serverId])

  const flush = async (key: string): Promise<void> => {
    if (running.current.has(key)) return
    running.current.add(key)
    setSaving((n) => n + 1)
    try {
      for (;;) {
        const t = desired.current.get(key)
        if (!t) break
        desired.current.delete(key)
        const existing = overridesRef.current.find((o) => o.id > 0 && api.overrideKey(o) === key)
        const saved = await api.applyOverride(channelId, existing, t)
        const rest = overridesRef.current.filter((o) => api.overrideKey(o) !== key)
        // A newer edit queued meanwhile keeps its optimistic row; only settle
        // to the server's copy once this key is idle.
        if (desired.current.has(key)) {
          if (saved) setOverrides(overridesRef.current.map((o) => (api.overrideKey(o) === key ? { ...o, id: saved.id } : o)))
        } else setOverrides(saved ? [...rest, saved] : rest)
      }
    } catch (err) {
      desired.current.delete(key)
      toast(errorText(err, 'Could not save permission'))
      load()
    } finally {
      running.current.delete(key)
      setSaving((n) => n - 1)
    }
  }

  const write = (targets: api.OverrideTarget[]): void => {
    let next = overridesRef.current
    for (const t of targets) {
      const key = api.overrideKey(t)
      const cur = next.find((o) => api.overrideKey(o) === key)
      next = !t.allow && !t.deny
        ? next.filter((o) => api.overrideKey(o) !== key)
        : cur
          ? next.map((o) => (o === cur ? { ...o, allow: t.allow, deny: t.deny } : o))
          : [...next, { id: -1, channel: channelId, role: t.role ?? null, member: t.member ?? null, allow: t.allow, deny: t.deny }]
      desired.current.set(key, t)
    }
    setOverrides(next)
    for (const t of targets) void flush(api.overrideKey(t))
  }

  const sortedRoles = useMemo(() => (roles ?? []).slice().sort((a, b) => b.position - a.position), [roles])
  const everyone = sortedRoles.find((r) => r.is_default)
  const whitelist = overrides && roles ? api.channelWhitelist(overrides, roles) : null

  const setWhitelist = (roleIds: number[] | null): void => {
    if (!overrides || !roles) return
    try {
      write(api.planChannelWhitelist(overrides, roles, roleIds))
    } catch (err) {
      toast(errorText(err, 'Could not restrict channel'))
    }
  }

  const labelOf = (o: { role: number | null; member: number | null }): { name: string; color?: string; member?: ChatMember } => {
    if (o.role != null) {
      const r = sortedRoles.find((x) => x.id === o.role)
      return r ? { name: r.is_default ? '@everyone' : r.name, color: r.color || '#8a8f98' } : { name: `Role #${o.role}` }
    }
    const m = members?.find((x) => x.id === o.member)
    return m ? { name: displayName(m.user), member: m } : { name: `Member #${o.member}` }
  }

  // Roles first (by hierarchy, @everyone last), then members. The expanded
  // row stays visible as a draft even while it has no bits set.
  const rows = useMemo(() => {
    const list = (overrides ?? []).slice()
    if (expanded && !list.some((o) => api.overrideKey(o) === expanded)) {
      const [kind, id] = expanded.split(':')
      list.push({ id: -1, channel: channelId, role: kind === 'role' ? Number(id) : null, member: kind === 'member' ? Number(id) : null, allow: 0, deny: 0 })
    }
    const rank = (o: ChannelOverride): number => {
      if (o.role == null) return -1
      const r = sortedRoles.find((x) => x.id === o.role)
      return r?.is_default ? 0 : (r?.position ?? 0) + 1
    }
    return list.sort((a, b) => rank(b) - rank(a))
  }, [overrides, sortedRoles, expanded, channelId])

  const candidates = useMemo(() => {
    const taken = new Set(rows.map(api.overrideKey))
    const q = query.trim().toLowerCase()
    const r = sortedRoles
      .filter((x) => !taken.has(`role:${x.id}`))
      .map((x) => ({ key: `role:${x.id}`, name: x.is_default ? '@everyone' : x.name, color: x.color || '#8a8f98', member: undefined as ChatMember | undefined }))
    const m = (members ?? [])
      .filter((x) => !taken.has(`member:${x.id}`))
      .map((x) => ({ key: `member:${x.id}`, name: displayName(x.user), color: undefined, member: x }))
    return [...r, ...m].filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 30)
  }, [rows, sortedRoles, members, query])

  const loading = overrides === null || !roles

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <p className="flex-1 text-[11px] font-bold uppercase tracking-wider text-text-muted">Permissions</p>
        <span className="text-[11px] text-text-muted inline-flex items-center gap-1">
          {saving > 0 ? <><Loader2 size={11} className="animate-spin" />Saving…</> : 'Changes save instantly'}
        </span>
      </div>

      {loading && <div className="flex justify-center py-6 rounded-xl border border-[var(--border)]"><Loader2 size={16} className="animate-spin text-text-muted" /></div>}

      {!loading && (
        <>
          {/* Who can see it */}
          <div className="rounded-xl border border-[var(--border)] p-3 mb-3">
            <p className="text-sm font-semibold text-text-primary">Who can see this channel</p>
            <div className="grid grid-cols-2 gap-1 p-1 mt-2 rounded-lg bg-surface-raised">
              {([['Everyone', null], ['Only certain roles', whitelist ?? []]] as const).map(([label, value]) => {
                const on = (value === null) === (whitelist === null)
                return (
                  <button
                    key={label}
                    type="button"
                    disabled={!everyone}
                    onClick={() => { if (!on) setWhitelist(value === null ? null : []) }}
                    className={`py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-40 ${on ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            {whitelist !== null && (
              <>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {sortedRoles.filter((r) => !r.is_default).map((r) => {
                    const on = whitelist.includes(r.id)
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setWhitelist(on ? whitelist.filter((id) => id !== r.id) : [...whitelist, r.id])}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${on ? 'border-accent/60 bg-accent/10 text-text-primary' : 'border-[var(--border)] text-text-muted hover:text-text-primary hover:border-text-muted'}`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: r.color || '#8a8f98' }} />
                        {r.name}
                        {on && <Check size={12} strokeWidth={3} />}
                      </button>
                    )
                  })}
                  {sortedRoles.every((r) => r.is_default) && <p className="text-xs text-text-muted">No roles yet — create one from Server settings → Roles.</p>}
                </div>
                <p className="text-[11px] text-text-muted mt-2">
                  {whitelist.length === 0 ? 'Nobody but owners and admins can see it until you pick a role.' : 'Owners, admins and roles with Administrator can always see it.'}
                </p>
              </>
            )}
            {!everyone && <p className="text-[11px] text-text-muted mt-2">This server has no @everyone role, so it can't be restricted.</p>}
          </div>

          {/* Fine-grained overrides */}
          <div className="rounded-xl border border-[var(--border)] overflow-hidden">
            <div className="px-3 pt-3 pb-2">
              <p className="text-sm font-semibold text-text-primary">Overrides</p>
              <p className="text-xs text-text-muted">Allow or deny specific things for a role or member in this channel only.</p>
            </div>
            {rows.length === 0 && <p className="px-3 pb-3 text-xs text-text-muted">None — everyone follows their server-wide role permissions.</p>}
            {rows.map((o) => {
              const key = api.overrideKey(o)
              const open = expanded === key
              const label = labelOf(o)
              const allowN = bitCount(o.allow)
              const denyN = bitCount(o.deny)
              return (
                <div key={key} className="border-t border-[var(--border)]">
                  <div className={`flex items-center gap-2.5 px-3 py-2 ${open ? 'bg-surface-raised/50' : ''}`}>
                    <button type="button" onClick={() => setExpanded(open ? null : key)} className="flex-1 min-w-0 flex items-center gap-2.5 text-left">
                      {label.member ? <ChatAvatar user={label.member.user} size={22} /> : <span className="w-2.5 h-2.5 mx-[5px] rounded-full shrink-0" style={{ background: label.color ?? '#8a8f98' }} />}
                      <span className="flex-1 min-w-0 text-sm text-text-primary truncate">{label.name}</span>
                      {allowN > 0 && <span className="text-[11px] font-semibold text-emerald-400">{allowN} allowed</span>}
                      {denyN > 0 && <span className="text-[11px] font-semibold text-red-400">{denyN} denied</span>}
                      {!allowN && !denyN && <span className="text-[11px] text-text-muted">no changes</span>}
                      <ChevronDown size={15} className={`text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
                    </button>
                    <button
                      type="button"
                      title="Remove override"
                      onClick={() => { if (open) setExpanded(null); write([{ ...(o.role != null ? { role: o.role } : { member: o.member as number }), allow: 0, deny: 0 }]) }}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-red-400 hover:bg-surface-overlay"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  {open && (
                    <div className="px-3 pb-2 bg-surface-raised/50">
                      {CHANNEL_PERMS.map(({ key: perm, hint }) => {
                        const bit = CHAT_PERMISSIONS[perm]
                        const state: -1 | 0 | 1 = o.allow & bit ? 1 : o.deny & bit ? -1 : 0
                        return (
                          <div key={perm} className="flex items-center gap-3 py-1.5">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-text-primary">{PERMISSION_LABELS[perm]}</p>
                              <p className="text-[11px] text-text-muted truncate">{hint}</p>
                            </div>
                            <TriState
                              state={state}
                              onChange={(v) => write([{
                                ...(o.role != null ? { role: o.role } : { member: o.member as number }),
                                allow: v === 1 ? o.allow | bit : o.allow & ~bit,
                                deny: v === -1 ? o.deny | bit : o.deny & ~bit,
                              }])}
                            />
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
            <div className="border-t border-[var(--border)]">
              {!adding ? (
                <button type="button" onClick={() => setAdding(true)} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-text-muted hover:text-text-primary hover:bg-surface-raised/50 transition-colors">
                  <Plus size={14} />Add a role or member
                </button>
              ) : (
                <div className="p-2">
                  <div className="relative mb-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                    <input
                      autoFocus
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setAdding(false); setQuery('') } }}
                      placeholder="Search roles and members"
                      className={`${inputCls} pl-8 py-2`}
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto chat-scroll">
                    {candidates.length === 0 && <p className="text-xs text-text-muted text-center py-3">{members ? 'Nothing left to add' : 'Loading members…'}</p>}
                    {candidates.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => {
                          setExpanded(c.key)
                          setAdding(false)
                          setQuery('')
                        }}
                        className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-raised/60"
                      >
                        {c.member ? <ChatAvatar user={c.member.user} size={22} /> : <span className="w-2.5 h-2.5 mx-[5px] rounded-full shrink-0" style={{ background: c.color }} />}
                        <span className="flex-1 text-sm text-text-primary truncate">{c.name}</span>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">{c.member ? 'Member' : 'Role'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Channels ────────────────────────────────────────────────────────────────

function slugPreview(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 100)
}

export function ChannelModal({ serverId, channel, defaultCategory, onClose }: { serverId: number; channel?: ChatChannel; defaultCategory?: string; onClose: () => void }): JSX.Element {
  const members = useChatStore((s) => s.members[serverId])
  const loadMembers = useChatStore((s) => s.loadMembers)
  const openRoom = useChatStore((s) => s.openRoom)
  const servers = useChatStore((s) => s.servers)
  const removeLocalCategory = useChatStore((s) => s.removeLocalCategory)
  const toast = useChatToast()
  const [name, setName] = useState(channel?.name ?? '')
  const [topic, setTopic] = useState(channel?.topic ?? '')
  const [category, setCategory] = useState(channel?.category ?? defaultCategory ?? '')
  const [isPrivate, setPrivate] = useState(channel?.is_private ?? false)
  const [allowed, setAllowed] = useState<Set<number>>(new Set(channel?.allowed_members ?? []))
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => { void loadMembers(serverId) }, [serverId, loadMembers])

  const localCategories = useChatStore((s) => s.localCategories[serverId] ?? EMPTY_CATEGORIES)
  const categories = useMemo(() => {
    const server = servers.find((s) => s.id === serverId)
    return [...new Set([...(server?.channels ?? []).map((c) => c.category).filter(Boolean), ...localCategories])]
  }, [servers, serverId, localCategories])

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
      if (result.category) removeLocalCategory(serverId, result.category)
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
      {channel && <ChannelPermissionsSection channelId={channel.id} serverId={serverId} />}
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
