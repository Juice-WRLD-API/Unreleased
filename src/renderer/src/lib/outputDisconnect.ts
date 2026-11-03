// Pause when the device the music plays through disconnects (headphones
// unplugged, Bluetooth switched off or out of range) and play again when that
// same device is the output again. Chromium doesn't pause on its own: it moves
// the sound to the next default device, so the song carries on out of the
// speakers. Player.tsx runs this on every `devicechange`; it is pure so the
// steps can be tested (scripts/output-disconnect.test.cjs).
//
// Device ids and labels only come back while the page may use the microphone
// (Electron's permission check grants that to the main window). Without them
// every id is empty and this never acts.

export interface OutputDevice {
  deviceId: string
  groupId: string
  label: string
}

export interface OutputWatch {
  /** The real device the sound goes to, as of the last device list. */
  inUse: string | null
  inUseLabel: string
  /** Set when `inUse` disappeared mid-song: the device to wait for. */
  lost: string | null
  lostLabel: string
}

export const EMPTY_OUTPUT_WATCH: OutputWatch = { inUse: null, inUseLabel: '', lost: null, lostLabel: '' }

// Chromium's aliases for whatever the system default currently is.
const ALIASES = new Set(['default', 'communications'])

/** The real device sound goes to: the picked one while it's connected, or the
 *  one behind Chromium's "default" entry. null when that can't be told. */
export function deviceInUse(devices: OutputDevice[], picked: string): OutputDevice | null {
  const real = devices.filter((d) => d.deviceId && !ALIASES.has(d.deviceId))
  if (picked) return real.find((d) => d.deviceId === picked) ?? null
  const alias = devices.find((d) => d.deviceId === 'default')
  if (!alias) return null
  // The alias is labelled "Default - <real label>" on Windows and shares the
  // real device's groupId. Prefer the label: a Bluetooth headset's stereo and
  // hands-free outputs share one groupId.
  const name = alias.label.replace(/^Default\s*-\s*/i, '')
  const byLabel = name ? real.find((d) => d.label === name) : undefined
  return byLabel ?? real.find((d) => d.groupId && d.groupId === alias.groupId) ?? null
}

/** One step on a new device list. `playing`: a song is playing right now. */
export function nextOutputWatch(
  watch: OutputWatch, devices: OutputDevice[], picked: string, playing: boolean,
): { watch: OutputWatch; action: 'pause' | 'resume' | null } {
  const current = deviceInUse(devices, picked)
  // Keep the last known device through lists that can't name one (the default
  // alias briefly missing while the system switches), or a removal right
  // after would go unnoticed.
  const seen = current
    ? { inUse: current.deviceId, inUseLabel: current.label }
    : { inUse: watch.inUse, inUseLabel: watch.inUseLabel }
  if (watch.lost) {
    // Back, and the output again: not merely connected while the system
    // default stays on the speakers.
    if (current?.deviceId === watch.lost) {
      return { watch: { ...EMPTY_OUTPUT_WATCH, ...seen }, action: playing ? null : 'resume' }
    }
    return { watch: { ...watch, ...seen }, action: null }
  }
  if (playing && watch.inUse && !devices.some((d) => d.deviceId === watch.inUse)) {
    return { watch: { ...seen, lost: watch.inUse, lostLabel: watch.inUseLabel }, action: 'pause' }
  }
  return { watch: { ...watch, ...seen }, action: null }
}
