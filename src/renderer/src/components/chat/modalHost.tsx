import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { ChatChannel, ChatMember, ChatUserBrief } from '../../lib/chatApi'
import { BanMemberModal, ServerBansModal, SiteModerationModal, TimeoutMemberModal } from './Moderation'
import { AddMembersModal, ChannelModal, CreateCategoryModal, CreateServerModal, DiscoverServersModal, MemberRolesModal, NewDmModal, RenameCategoryModal, RolesModal, ServerSettingsModal } from './Modals'

export type ChatModal =
  | { kind: 'create-server' }
  | { kind: 'discover-servers' }
  | { kind: 'server-settings'; serverId: number }
  | { kind: 'add-members'; serverId: number }
  | { kind: 'roles'; serverId: number }
  | { kind: 'member-roles'; serverId: number; member: ChatMember }
  | { kind: 'channel'; serverId: number; channel?: ChatChannel; defaultCategory?: string }
  | { kind: 'create-category'; serverId: number }
  | { kind: 'rename-category'; serverId: number; category: string }
  | { kind: 'timeout-member'; serverId: number; member: ChatMember }
  | { kind: 'ban-member'; serverId: number; user: ChatUserBrief }
  | { kind: 'server-bans'; serverId: number }
  | { kind: 'site-moderation' }
  | { kind: 'new-dm' }
  | { kind: 'add-to-dm'; conversationId: number }

const ModalContext = createContext<(modal: ChatModal) => void>(() => {})

export function useOpenModal(): (modal: ChatModal) => void {
  return useContext(ModalContext)
}

export function ModalHost({ children }: { children: ReactNode }): JSX.Element {
  const [modal, setModal] = useState<ChatModal | null>(null)
  const close = useCallback(() => setModal(null), [])
  return (
    <ModalContext.Provider value={setModal}>
      {children}
      {modal?.kind === 'create-server' && <CreateServerModal onClose={close} />}
      {modal?.kind === 'discover-servers' && <DiscoverServersModal onClose={close} />}
      {modal?.kind === 'server-settings' && (
        <ServerSettingsModal
          serverId={modal.serverId}
          onClose={close}
          onAddMembers={() => setModal({ kind: 'add-members', serverId: modal.serverId })}
          onRoles={() => setModal({ kind: 'roles', serverId: modal.serverId })}
        />
      )}
      {modal?.kind === 'add-members' && <AddMembersModal serverId={modal.serverId} onClose={close} />}
      {modal?.kind === 'roles' && <RolesModal serverId={modal.serverId} onClose={close} />}
      {modal?.kind === 'member-roles' && <MemberRolesModal serverId={modal.serverId} member={modal.member} onClose={close} />}
      {modal?.kind === 'channel' && <ChannelModal serverId={modal.serverId} channel={modal.channel} defaultCategory={modal.defaultCategory} onClose={close} />}
      {modal?.kind === 'create-category' && <CreateCategoryModal serverId={modal.serverId} onClose={close} />}
      {modal?.kind === 'rename-category' && <RenameCategoryModal serverId={modal.serverId} category={modal.category} onClose={close} />}
      {modal?.kind === 'timeout-member' && <TimeoutMemberModal serverId={modal.serverId} member={modal.member} onClose={close} />}
      {modal?.kind === 'ban-member' && <BanMemberModal serverId={modal.serverId} user={modal.user} onClose={close} />}
      {modal?.kind === 'server-bans' && <ServerBansModal serverId={modal.serverId} onClose={close} />}
      {modal?.kind === 'site-moderation' && <SiteModerationModal onClose={close} />}
      {modal?.kind === 'new-dm' && <NewDmModal onClose={close} />}
      {modal?.kind === 'add-to-dm' && <NewDmModal conversationId={modal.conversationId} onClose={close} />}
    </ModalContext.Provider>
  )
}
