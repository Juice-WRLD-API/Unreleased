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

/** Strips the weekday prefix the API puts on date strings, e.g. "Fri May 2." → "May 2". */
export function cleanDate(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw.replace(/^[A-Za-z][a-z]+\s+(?=[A-Z]|\d)/g, '').trim().replace(/\.$/, '').trim()
}

// Lazily skips leading words up to the first month name or digit.
const DATE_PREFIX = /^[A-Za-z\s,]*?(?=(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b|\d)/

/**
 * Display form of a free-text date field: drops whatever words precede the
 * actual date ("Surfaced", "Released", weekdays, even with a missing space as
 * in "SurfacedJuly 10, 2023.") and the trailing period → "July 10, 2023".
 * Values with no recognisable date are returned trimmed but otherwise as-is.
 */
export function displayDate(raw: string | null | undefined): string {
  const s = (raw ?? '').trim()
  if (!s) return ''
  const m = DATE_PREFIX.exec(s)
  return (m ? s.slice(m[0].length) : s).replace(/\.+$/, '').trim()
}

/** Timestamp for sorting a free-text date field, or null when it has no parseable date. */
export function dateSortValue(raw: string | null | undefined): number | null {
  const d = displayDate(raw)
  if (!d) return null
  const t = Date.parse(d)
  return Number.isNaN(t) ? null : t
}

/** Comparator for dateSortValue results: undated values always sink to the end, whatever the direction. */
export function compareDates(a: number | null, b: number | null, dir: 'asc' | 'desc'): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  return dir === 'desc' ? b - a : a - b
}

/**
 * Full-account display name: display_name, then discord_username, then the
 * login-handle username (blank for Discord signups, set for username/password
 * ones - see AccountUser.username). Falls back to a caller-supplied default.
 */
export function accountDisplayName(
  u: { display_name?: string; discord_username?: string; username?: string } | null | undefined,
  fallback = ''
): string {
  return u?.display_name || u?.discord_username || u?.username || fallback
}

/** Discord handle if set, else the login-handle username - for admin/staff lists that show a handle, not a display name. */
export function discordHandle(u: { discord_username?: string; username?: string } | null | undefined): string {
  return u?.discord_username || u?.username || ''
}

/** First character of a name, uppercased, for avatar-fallback initials. */
export function initial(name: string | null | undefined): string {
  return (name || '?').charAt(0).toUpperCase()
}

/** Unwraps a caught value's message, falling back for non-Error throws (e.g. a rejected string/object). */
export function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}
