// Bridges Siri / Shortcuts actions (iOS App Intents) into the player - see
// ios/App/App/SiriIntents.swift and SiriCommands.swift for the native half.
//
// The intents only queue a command; this drains the queue on mount (a
// cold-launch intent fires before the bundle loads) and on every native ping.
// Every playback decision stays here in JS.

import { registerPlugin } from '@capacitor/core'
import { IS_IOS, IS_NATIVE_APP } from './platform'
import { cleanTitleForSearch, loadAllSongs, searchSongs, songToTrack } from './juicewrldApi'
import { useStore } from '../store/useStore'
import { runPlayerCommand } from '../components/Player'
import { getActiveRadioClient } from './radioSocketService'
import { resumeEffectsContext } from './audioEffects'

interface SiriCommand {
  action: 'play' | 'pause' | 'next' | 'previous' | 'toggleShuffle' | 'like' | 'playSong' | 'play999Fm'
  query?: string
}

interface SiriCommandsPlugin {
  consume(): Promise<{ commands: SiriCommand[] }>
  setSongTitles(options: { titles: string[] }): Promise<void>
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
    case 'play999Fm': {
      state.setIsPlaying(false)
      resumeEffectsContext()
      state.setRadioFmActive(true)
      state.setActiveView('wrld')
      const startRadio = (): boolean => {
        const client = getActiveRadioClient()
        if (!client) return false
        void client.startListening().catch(() => useStore.getState().setRadioFmActive(false))
        return true
      }
      if (!startRadio()) {
        const started = performance.now()
        const tick = (): void => {
          if (startRadio() || performance.now() - started > 12_000) {
            window.clearInterval(handle)
          }
        }
        const handle = window.setInterval(tick, 250)
        tick()
      }
      break
    }
  }
}

async function registerSongTitles(plugin: SiriCommandsPlugin): Promise<void> {
  const songs = await loadAllSongs()
  const titles = new Set<string>()
  for (const s of songs) {
    if (['unsurfaced', 'recording_session'].includes(s.category)) continue
    const title = cleanTitleForSearch(s.name)
    if (title) titles.add(title)
  }
  await plugin.setSongTitles({ titles: [...titles] })
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
  registerSongTitles(plugin).catch(() => {})
  Promise.resolve(plugin.addListener('command', () => { void drain() }))
    .then((l) => { if (stopped) l.remove(); else handle = l })
    .catch(() => {})
  return () => { stopped = true; handle?.remove() }
}
