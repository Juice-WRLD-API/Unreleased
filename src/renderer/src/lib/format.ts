// Shared display formatters. Every mm:ss / byte-size label in the app goes
// through here - don't re-implement these locally in components.

/**
 * Seconds → "m:ss". `empty` is returned for 0/NaN/Infinity/negative input,
 * since different surfaces want different placeholders ('--:--', '—', '').
 */
export function formatDuration(seconds: number, empty = '0:00'): string {
  if (!seconds || !isFinite(seconds) || seconds < 0) return empty
  const min = Math.floor(seconds / 60)
  const sec = Math.floor(seconds % 60)
  return `${min}:${String(sec).padStart(2, '0')}`
}

/** Seconds → "3 hr 12 min" / "45 min", for playlist/library totals. */
export function formatTotalDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h > 0) return `${h} hr ${m} min`
  return `${m} min`
}

/** Bytes → "1.5 MB"-style label. */
export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`
  return `${(b / 1073741824).toFixed(2)} GB`
}
