import { create } from 'zustand'

// The one piece of chat UI state the always-loaded shell reads: BottomNav hides
// itself while a mobile chat room is open. Kept out of chatStore so reading it
// doesn't pull the whole chat client into the startup bundle for everyone -
// chatStore only loads for staff (see useChatBootstrap).
interface ChatUiState {
  mobileRoomOpen: boolean
  setMobileRoomOpen: (open: boolean) => void
}

export const useChatUiStore = create<ChatUiState>((set) => ({
  mobileRoomOpen: false,
  setMobileRoomOpen: (mobileRoomOpen) => set({ mobileRoomOpen }),
}))
