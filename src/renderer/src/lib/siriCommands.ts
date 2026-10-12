// Bridges Siri / Shortcuts actions (iOS App Intents) into the player - see
// ios/App/App/SiriIntents.swift and SiriCommands.swift for the native half.
//
// The intents only queue a command; this drains the queue on mount (a
// cold-launch intent fires before the bundle loads) and on every native ping.
// Every playback decision stays here in JS.

import { registerPlugin } from '@capacitor/core'
import { IS_IOS, IS_NATIVE_APP } from './platform'
import { searchSongs, songToTrack } from './juicewrldApi'
import { useStore } from '../store/useStore'
import { runPlayerCommand } from '../components/Player'

interface SiriCommand {
  action: 'play' | 'pause' | 'next' | 'previous' | 'toggleShuffle' | 'like' | 'playSong'
  query?: string
}

interface SiriCommandsPlugin {
  consume(): Promise<{ commands: SiriCommand[] }>
  addListener(eventName: 'command', cb: () => void): Promise<{ remove: () => void }>
}

async function run(cmd: SiriCommand): Promise<void> {
  const state = useStore.getState()
  switch (cmd.action) {
    case 'play': state.setIsPlaying(true); break
    case 'pause': state.setIsPlaying(false); break
    case 'next': runPlayerCommand('next'); break
    case 'previous': runPlayerCommand('previous'); break
    case 'toggleShuffle': state.toggleShuffle(); break
    case 'like': {
      // Siri's "like" means like, not toggle: re-saying it must not unlike.
      const id = state.currentTrack?.id
      if (id && !state.likedTrackIds.includes(id)) state.toggleLike(id)
      break
    }
    case 'playSong': {
      const [song] = await searchSongs(cmd.query ?? '', 1)
      if (song) state.playTrack(songToTrack(song), [songToTrack(song)])
      break
    }
  }
}

/** Starts listening for Siri commands; returns an unsubscribe. No-op off iOS. */
export function startSiriCommands(): () => void {
  if (!IS_NATIVE_APP || !IS_IOS) return () => {}
  const plugin = registerPlugin<SiriCommandsPlugin>('SiriCommands')
  let stopped = false
  const drain = async (): Promise<void> => {
    try {
      const { commands } = await plugin.consume()
      for (const cmd of commands) {
        if (stopped) return
        await run(cmd).catch(() => {})
      }
    } catch { /* plugin missing (older build) - nothing to do */ }
  }
  let handle: { remove: () => void } | undefined
  void drain()
  Promise.resolve(plugin.addListener('command', () => { void drain() }))
    .then((l) => { if (stopped) l.remove(); else handle = l })
    .catch(() => {})
  return () => { stopped = true; handle?.remove() }
}
