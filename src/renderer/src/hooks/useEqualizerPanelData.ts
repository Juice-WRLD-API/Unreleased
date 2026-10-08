// Shared data/logic for the equalizer popover (desktop) / sheet (mobile).
// Both wrap this in their own JSX/controls - see EqualizerPanel.desktop.tsx
// and .mobile.tsx, which differ only in presentation (native range inputs vs.
// touch-drag faders, <select> vs. InlineSelect, etc.), not behavior.
import { useEffect, useState } from 'react'
import { useStorePick, type AppStore } from '../store/useStore'

// Short axis labels for the band sliders (32 … 16K).
export function bandLabel(freq: number): string {
  return freq >= 1000 ? `${freq / 1000}K` : String(freq)
}

const EQ_STORE_KEYS = [
  'eqEnabled', 'setEqEnabled', 'eqGains', 'setEqBand', 'eqPreset', 'setEqPreset',
  'eqBalance', 'setEqBalance', 'eqMono', 'setEqMono', 'eqBoost', 'setEqBoost',
  'skipSilence', 'setSkipSilence', 'playbackSpeed', 'setPlaybackSpeed',
  'pitchShift', 'setPitchShift', 'reverbEnabled', 'setReverbEnabled',
  'reverbMix', 'setReverbMix', 'reverbDecay', 'setReverbDecay',
  'communityEdits', 'playCommunityEdit',
  'abLoopStart', 'abLoopEnd', 'setAbLoopPoint', 'clearAbLoop',
  'preferOgVersion', 'setPreferOgVersion',
  'sleepTimerEnd', 'setSleepTimer',
  'audioOutput', 'setAudioOutput',
  'radioFmActive',
] as const

export function useEqualizerPanelData(): Pick<AppStore, typeof EQ_STORE_KEYS[number]> & {
  balanceLabel: string
  sleepMinutes: number
  setSleepMinutes: (v: number) => void
  outputDevices: MediaDeviceInfo[]
} {
  const store = useStorePick(...EQ_STORE_KEYS)
  const { eqBalance, sleepTimerEnd } = store

  const balancePct = Math.round(eqBalance * 100)
  const balanceLabel = balancePct === 0 ? 'C' : balancePct < 0 ? `L ${-balancePct}` : `R ${balancePct}`

  // Sleep timer - duration picked before starting (mirrors Settings), plus a
  // periodic re-render while running so the countdown stays fresh.
  const [sleepMinutes, setSleepMinutes] = useState(30)
  const [, sleepTick] = useState(0)
  useEffect(() => {
    if (!sleepTimerEnd) return
    const id = setInterval(() => sleepTick((t) => t + 1), 30000)
    return () => clearInterval(id)
  }, [sleepTimerEnd])

  // Output devices - same enumeration the player bar's picker uses.
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    // Absent in some iOS Safari contexts - see Player.tsx's equivalent effect.
    if (!navigator.mediaDevices) return
    const enumerate = async (): Promise<void> => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        setOutputDevices(devices.filter((d) => d.kind === 'audiooutput'))
      } catch { /* ignore */ }
    }
    enumerate()
    navigator.mediaDevices.addEventListener('devicechange', enumerate)
    return () => navigator.mediaDevices.removeEventListener('devicechange', enumerate)
  }, [])

  return { ...store, balanceLabel, sleepMinutes, setSleepMinutes, outputDevices }
}
