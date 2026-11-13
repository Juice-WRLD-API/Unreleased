import { useRef, useState } from 'react'
import {
  Check, ChevronLeft, Code2, Copy, Eye, EyeOff, Heart, History, KeyRound, Loader2, LogIn, LogOut,
  MessageSquare, Music2, Pencil, Radio, ShieldCheck, Upload, User, X,
} from 'lucide-react'
import { useStore, useStorePick } from '../store/useStore'
import { hasChatAccess, useChatStore } from '../store/chatStore'
import { getToken, updateDisplayName } from '../lib/userApi'
import { accountDisplayName, initial } from '../lib/format'
import { copyText } from '../lib/clipboard'
import { useSettingsAccount } from '../hooks/useSettingsAccount'
import { useContentMotion } from '../hooks/useContentMotion'
import type { ViewType } from '../types'
import { Row, Toggle, SettingsGroup as Group, SettingsLink, SettingsTitle } from './SettingsRow'
import AccountSignIn from './AccountSignIn'
import Passkeys from './Passkeys'
import ApiKeys from './ApiKeys'
import MyCoverArt from './MyCoverArt'
import MyCommunityEdits from './MyCommunityEdits'
import MyCdnNodes from './MyCdnNodes'
import ChatDevices from './chat/ChatDevices'
import ChatKeyTransfer from './chat/ChatKeyTransfer'

export type AccountPage = 'home' | 'profile' | 'security' | 'chat' | 'uploads' | 'developer'

// Settings → Account, laid out like iOS Settings: the profile card and a short
// menu up front, each area on a page of its own behind it. Groups are docked
// glass panes (`.glass-pane`), so fields and controls inside them turn into
// plain fills of the pane by themselves.

const PAGE_TITLES: Record<Exclude<AccountPage, 'home'>, string> = {
  profile: 'Profile',
  security: 'Sign-in & security',
  chat: 'Chat',
  uploads: 'Your uploads',
  developer: 'Developer',
}

export default function AccountSettings({ page, setPage, openMainView }: {
  page: AccountPage
  setPage: (p: AccountPage) => void
  openMainView: (view: ViewType) => void
}): JSX.Element {
  const { account, logoutAccount, setShowUserAuth } = useStorePick('account', 'logoutAccount', 'setShowUserAuth')
  const pageRef = useRef<HTMLDivElement>(null)
  // The chat page only exists for chat members; fall back to the menu.
  const shown: AccountPage = page === 'chat' && account && !hasChatAccess(account) ? 'home' : page
  useContentMotion(pageRef, shown)

  if (!account) {
    return (
      <div>
        <SettingsTitle>Account</SettingsTitle>
        <div className="glass-pane rounded-2xl p-5 flex flex-col items-center text-center gap-3">
          <span className="w-14 h-14 rounded-full bg-accent/15 text-accent flex items-center justify-center"><User size={26} /></span>
          <p className="text-text-secondary text-sm max-w-xs">
            Sign in to keep liked songs, playlists and settings in sync on every device.
          </p>
          <button
            onClick={() => setShowUserAuth(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-accent text-white text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <LogIn size={15} />
            Log in or sign up
          </button>
        </div>
      </div>
    )
  }

  return (
    <div ref={pageRef}>
      {shown === 'home' ? (
        <>
          <SettingsTitle>Account</SettingsTitle>
          <ProfileCard />
          <Group flush>
            <SettingsLink icon={User} color="#0f766e" label="Profile" sub="Bio and what your public profile shows" onClick={() => setPage('profile')} />
            <SettingsLink
              icon={ShieldCheck}
              color="#2563eb"
              label="Sign-in & security"
              sub={account.username_chosen === false ? 'Choose a username and add a password' : 'Username, password, passkeys and two-factor'}
              onClick={() => setPage('security')}
            />
            {hasChatAccess(account) && (
              <SettingsLink icon={MessageSquare} color="#7c3aed" label="Chat" sub="Online status, read receipts and devices" onClick={() => setPage('chat')} />
            )}
            <SettingsLink icon={Upload} color="#db2777" label="Your uploads" sub="Cover art, remixes & edits and CDN nodes" onClick={() => setPage('uploads')} />
            <SettingsLink icon={Code2} color="#4b5563" label="Developer" sub="API keys and your auth token" onClick={() => setPage('developer')} />
          </Group>
          <div className="glass-pane rounded-2xl">
            <button
              onClick={() => logoutAccount()}
              className="w-full flex items-center justify-center gap-2 px-3.5 py-3 rounded-2xl text-red-400 text-sm font-semibold hover:bg-red-500/10 transition-colors"
            >
              <LogOut size={15} />
              Log out
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-5 -ml-1">
            <button
              type="button"
              onClick={() => setPage('home')}
              className="glass-field glass-specular relative flex items-center gap-0.5 h-8 pl-1.5 pr-3 rounded-full text-xs font-medium text-text-secondary hover:text-text-primary"
            >
              <ChevronLeft size={16} />
              Account
            </button>
            <h3 className="text-text-primary text-2xl font-bold tracking-tight truncate">{PAGE_TITLES[shown]}</h3>
          </div>
          {shown === 'profile' && <ProfilePage />}
          {shown === 'security' && <SecurityPage openMainView={openMainView} />}
          {shown === 'chat' && <ChatPage />}
          {shown === 'uploads' && (
            <>
              <Group title="Cover art"><MyCoverArt /></Group>
              <Group title="Remixes & edits"><MyCommunityEdits /></Group>
              <Group title="CDN nodes"><MyCdnNodes /></Group>
            </>
          )}
          {shown === 'developer' && <DeveloperPage />}
        </>
      )}
    </div>
  )
}

function ProfileCard(): JSX.Element {
  const account = useStore((s) => s.account)!
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const { avatarUploading, avatarError, handleAvatarFile, handleAvatarRemove } = useSettingsAccount()
  const [editing, setEditing] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    const trimmed = nameInput.trim()
    if (!trimmed) { setNameError('Name cannot be empty.'); return }
    setSaving(true)
    setNameError(null)
    try {
      useStore.setState({ account: await updateDisplayName(trimmed) })
      setEditing(false)
    } catch {
      setNameError('Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const handle = account.username_chosen !== false && account.username ? `@${account.username}` : account.discord_username
  const badges = [
    account.discord_id && 'Discord',
    account.otp_enabled && '2FA',
    account.is_donor && 'Donor',
  ].filter(Boolean) as string[]

  return (
    <div className="glass-pane rounded-2xl p-5 mb-6 flex items-center gap-4">
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleAvatarFile(f); e.target.value = '' }}
      />
      <button
        type="button"
        onClick={() => avatarInputRef.current?.click()}
        disabled={avatarUploading}
        title="Change photo"
        className="relative w-[72px] h-[72px] shrink-0 rounded-full group"
      >
        {account.avatar ? (
          <img src={account.avatar} alt="" className="w-full h-full rounded-full object-cover shadow-md" />
        ) : (
          <span className="w-full h-full rounded-full bg-accent/20 text-accent flex items-center justify-center text-2xl font-bold">
            {initial(accountDisplayName(account))}
          </span>
        )}
        <span className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center ring-2 ring-[var(--surface)] shadow">
          {avatarUploading ? <Loader2 size={12} className="animate-spin" /> : <Pencil size={11} />}
        </span>
      </button>

      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setEditing(false) }}
              maxLength={50}
              disabled={saving}
              aria-label="Display name"
              className="glass-field min-w-0 w-full max-w-[14rem] rounded-lg px-2 py-1 text-text-primary text-base font-bold"
            />
            <button onClick={() => void save()} disabled={saving} className="p-1.5 rounded-full text-accent hover:bg-accent/15 transition-colors disabled:opacity-40" title="Save">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            </button>
            <button onClick={() => setEditing(false)} disabled={saving} className="p-1.5 rounded-full text-text-muted hover:bg-[var(--fill)] transition-colors disabled:opacity-40" title="Cancel">
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setNameInput(accountDisplayName(account)); setNameError(null); setEditing(true) }}
            className="flex items-center gap-1.5 max-w-full group/name"
            title="Change display name"
          >
            <span className="text-text-primary text-lg font-bold truncate">{accountDisplayName(account)}</span>
            <Pencil size={12} className="text-text-muted opacity-0 group-hover/name:opacity-100 transition-opacity shrink-0" />
          </button>
        )}
        {handle && <p className="text-text-muted text-xs truncate">{handle}</p>}
        {(nameError || avatarError) && <p className="text-[11px] text-red-400 mt-0.5">{nameError || avatarError}</p>}
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {badges.map((b) => (
            <span key={b} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${b === 'Donor' ? 'bg-pink-500/15 text-pink-400' : 'bg-[var(--fill)] text-text-secondary'}`}>
              {b === 'Donor' && <Heart size={9} fill="currentColor" />}
              {b === 'Donor' && account.donor_since ? `Donor since ${new Date(account.donor_since).getFullYear()}` : b}
            </span>
          ))}
          {account.avatar && (
            <button onClick={() => void handleAvatarRemove()} disabled={avatarUploading} className="text-[10px] font-medium text-text-muted hover:text-red-400 transition-colors px-1">
              Remove photo
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ProfilePage(): JSX.Element {
  const account = useStore((s) => s.account)!
  const {
    bioDraft, setBioDraft, bioSaving, saveBio,
    privacyError, togglePublicPlayHistory, togglePublicPlaylists, togglePublicNowPlaying,
  } = useSettingsAccount()
  return (
    <>
      <Group title="Bio" footer={bioSaving ? 'Saving…' : `${bioDraft.length}/500 · saved when you click away`}>
        <textarea
          value={bioDraft}
          onChange={(e) => setBioDraft(e.target.value.slice(0, 500))}
          onBlur={() => void saveBio()}
          placeholder="Tell people about yourself"
          rows={3}
          aria-label="Bio"
          className="w-full -mx-0.5 my-3 px-0.5 bg-transparent text-text-primary text-sm placeholder:text-text-muted resize-none focus:outline-none"
        />
      </Group>
      <Group title="Public profile" footer={privacyError ? <span className="text-red-400">{privacyError}</span> : 'Anyone with your profile link sees what you turn on here.'}>
        <Row icon={History} iconColor="#0f766e" label="Listening history" sub="The songs you played recently">
          <Toggle on={!!account.public_play_history} onClick={() => void togglePublicPlayHistory()} />
        </Row>
        <Row icon={Music2} iconColor="#0f766e" label="Public playlists" sub="Playlists you already marked public">
          <Toggle on={!!account.public_playlists} onClick={() => void togglePublicPlaylists()} />
        </Row>
        <Row icon={Radio} iconColor="#0f766e" label="Now playing" sub="The track you're playing right now">
          <Toggle on={!!account.public_now_playing} onClick={() => void togglePublicNowPlaying()} />
        </Row>
      </Group>
    </>
  )
}

function SecurityPage({ openMainView }: { openMainView: (view: ViewType) => void }): JSX.Element {
  const account = useStore((s) => s.account)!
  return (
    <>
      {/* Older servers don't report how the account signs in. */}
      {(account.username_chosen !== undefined || account.has_password !== undefined) && (
        <Group title="Sign-in" footer="Sign in with Discord, your username and password, or a passkey.">
          <AccountSignIn account={account} />
        </Group>
      )}
      {/* Setup is admin-only on the server (GET otp/setup/ answers
          "Administrator access required."), and Admin already parks an
          admin without 2FA on its setup panel. */}
      <Group title="Two-factor">
        <Row
          icon={ShieldCheck}
          iconColor={account.otp_enabled ? '#059669' : '#6b7280'}
          label="Two-factor authentication"
          sub={account.otp_enabled
            ? 'Sign-ins ask for a code from your authenticator app'
            : account.is_administrator ? 'Required for admin tools' : 'Not turned on for this account'}
        >
          {account.otp_enabled ? (
            <span className="shrink-0 text-[11px] font-semibold text-emerald-500">On</span>
          ) : account.is_administrator ? (
            <button onClick={() => openMainView('admin')} className="shrink-0 text-[11px] font-semibold text-accent hover:underline">Set up</button>
          ) : (
            <span className="shrink-0 text-[11px] font-semibold text-text-muted">Off</span>
          )}
        </Row>
      </Group>
      <Group title="Passkeys"><div className="pb-3"><Passkeys /></div></Group>
    </>
  )
}

function ChatPage(): JSX.Element {
  const account = useStore((s) => s.account)!
  const presence = useChatStore((s) => s.presenceEnabled)
  const read = useChatStore((s) => s.readEnabled)
  const setPresence = useChatStore((s) => s.setPresenceEnabled)
  const setRead = useChatStore((s) => s.setReadEnabled)
  return (
    <>
      <Group title="Privacy">
        <Row icon={Radio} iconColor="#0f766e" label="Online status" sub="Turn off to stop requesting and showing who's online">
          <Toggle on={presence} onClick={() => setPresence(!presence)} />
        </Row>
        <Row icon={Check} iconColor="#0f766e" label="Read receipts" sub="Turn off to stop sending read marks to the server">
          <Toggle on={read} onClick={() => setRead(!read)} />
        </Row>
      </Group>
      <Group title="Devices">
        <div className="py-3">
          <ChatDevices userId={account.id} />
          <ChatKeyTransfer userId={account.id} />
        </div>
      </Group>
    </>
  )
}

function DeveloperPage(): JSX.Element {
  const [showToken, setShowToken] = useState(false)
  const [copied, setCopied] = useState(false)
  const token = getToken()
  return (
    <>
      <Group title="API keys"><div className="pb-3"><ApiKeys /></div></Group>
      <Group title="Auth token" footer="Anyone with this token can act as you. Don't share it.">
        <div className="flex items-center gap-3 py-3">
          <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-[#4b5563]">
            <KeyRound size={13} className="text-white" strokeWidth={2.25} />
          </span>
          <code className="flex-1 min-w-0 text-[11px] font-mono text-text-muted truncate">
            {showToken ? (token ?? '—') : '••••••••••••••••••••••••'}
          </code>
          <button onClick={() => setShowToken((v) => !v)} title={showToken ? 'Hide' : 'Show'} className="p-1.5 rounded-full text-text-muted hover:text-text-primary hover:bg-[var(--fill)] transition-colors">
            {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button
            onClick={() => {
              if (!token) return
              copyText(token)
              setCopied(true)
              window.setTimeout(() => setCopied(false), 2000)
            }}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${copied ? 'text-emerald-500' : 'text-text-secondary hover:text-text-primary bg-[var(--fill)]'}`}
          >
            {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
          </button>
        </div>
      </Group>
    </>
  )
}
