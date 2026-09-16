import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { ChatChannel } from '../../lib/chatApi'
import { AddMembersModal, ChannelModal, CreateServerModal, NewDmModal, ServerSettingsModal } from './Modals'

export type ChatModal =
  | { kind: 'create-server' }
  | { kind: 'server-settings'; serverId: number }
  | { kind: 'add-members'; serverId: number }
  | { kind: 'channel'; serverId: number; channel?: ChatChannel }
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
      {modal?.kind === 'server-settings' && (
        <ServerSettingsModal serverId={modal.serverId} onClose={close} onAddMembers={() => setModal({ kind: 'add-members', serverId: modal.serverId })} />
      )}
      {modal?.kind === 'add-members' && <AddMembersModal serverId={modal.serverId} onClose={close} />}
      {modal?.kind === 'channel' && <ChannelModal serverId={modal.serverId} channel={modal.channel} onClose={close} />}
      {modal?.kind === 'new-dm' && <NewDmModal onClose={close} />}
      {modal?.kind === 'add-to-dm' && <NewDmModal conversationId={modal.conversationId} onClose={close} />}
    </ModalContext.Provider>
  )
}
