// Pure constants/helpers shared by EditorPage.desktop.tsx and .mobile.tsx -
// identical in both views, so kept here rather than duplicated.

export const CATEGORIES = [
  { value: 'released',          label: 'Released' },
  { value: 'unreleased',        label: 'Unreleased' },
  { value: 'unsurfaced',        label: 'Unsurfaced' },
  { value: 'recording_session', label: 'Session' },
]

export const CAT_PILL: Record<string, string> = {
  released:          'bg-emerald-500 text-white',
  unreleased:        'bg-accent text-white',
  unsurfaced:        'bg-yellow-500 text-black',
  recording_session: 'bg-zinc-500 text-white',
}

export const CAT_BADGE: Record<string, string> = {
  released:          'bg-emerald-500/20 text-emerald-400',
  unreleased:        'bg-accent/20 text-accent',
  unsurfaced:        'bg-yellow-500/20 text-yellow-400',
  recording_session: 'bg-zinc-500/20 text-zinc-400',
}

export function diff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const k of Object.keys(after)) {
    const a = after[k], b = before[k]
    if (a === '' && (b === '' || b == null)) continue
    if (a == null && b == null) continue
    if (JSON.stringify(a) !== JSON.stringify(b)) patch[k] = a === '' ? null : a
  }
  return patch
}

/* ── Genius lyrics helpers ─────────────────────────────────────────────────── */
export const isGeniusUrl = (s: string): boolean =>
  /^https?:\/\/(www\.)?genius\.com\/.+/i.test(s.trim())

export function extractGeniusLyrics(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const containers = Array.from(doc.querySelectorAll('[data-lyrics-container="true"]'))
  if (!containers.length) throw new Error('No lyrics containers found')

  const raw = containers
    .map(c => {
      const clone = c.cloneNode(true) as Element
      clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'))
      return clone.textContent ?? ''
    })
    .join('\n\n')

  // The page injects contributor counts, translations, and a song description
  // before the actual lyrics. Trim everything up to the first [Section] tag.
  // Fall back to trimming after "Read More" (end of song description) if no tags.
  let start = raw.indexOf('[')
  if (start < 0) {
    const rm = raw.lastIndexOf('Read More')
    start = rm >= 0 ? rm + 9 : 0
  }

  return raw
    .slice(start)
    .replace(/^\[.*?\]\n?/gm, '')   // strip section tags
    .replace(/\n{2,}/g, '\n\n')
    .trim()
}

/* ── Synced lyrics table (parse/serialize) ────────────────────────────────── */
// Raw LRC ("[1:05.96] Animal, animal") is hard to read and easy to corrupt, so
// the editor can show it as one row per line: timestamp field + text field.
// The bracket contents are kept verbatim rather than normalised, so a partly
// typed timestamp survives a re-render and metadata tags ([ar: …]) round-trip
// untouched.
export type SyncedLine = { time: string; text: string }

export function parseSynced(v: string): SyncedLine[] {
  if (!v) return []
  return v.split('\n').map(line => {
    const m = /^\s*\[([^\]]*)\]\s?(.*)$/.exec(line)
    return m ? { time: m[1], text: m[2] } : { time: '', text: line }
  })
}

export function serializeSynced(rows: SyncedLine[]): string {
  return rows.map(r => (r.time.trim() ? `[${r.time.trim()}] ${r.text}`.trimEnd() : r.text)).join('\n')
}

// Constructed from the y/m/d parts (not `new Date(iso)`) so the picked day
// never shifts - parsing an ISO date string alone is read back as UTC
// midnight, which formats as the previous day in negative-UTC timezones.
export function formatPickedDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}
