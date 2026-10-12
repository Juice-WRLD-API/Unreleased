// Lightweight localStorage persistence helper shared by the store slices.
//
// Lives here rather than in useStore.ts so slices can reach it: useStore
// imports the slice factories, so a slice importing useStore back would be a
// module cycle. Keys are namespaced under `unreleased:` and values are JSON -
// both reads and writes swallow errors, since localStorage can be unavailable
// (private mode, storage full) and a failed preference write should never
// break playback.
export const ls = {
  get: <T>(key: string): T | null => {
    try {
      const v = localStorage.getItem(`unreleased:${key}`)
      return v ? (JSON.parse(v) as T) : null
    } catch {
      return null
    }
  },
  set: <T>(key: string, value: T): void => {
    try {
      localStorage.setItem(`unreleased:${key}`, JSON.stringify(value))
    } catch (e) {
      // Visible in DevTools instead of vanishing - most commonly quota
      // exhaustion, which otherwise silently drops the write.
      console.warn(`[persist] failed to save "${key}":`, e)
    }
  },
}
