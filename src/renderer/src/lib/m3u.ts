// M3U parsing/serialization — the JS-side counterpart to desktop's parseM3u
// in electron/main.js, plus the native file picker that reads one in on
// Android (LocalLibraryPlugin.pickTextFile).
//
// Unlike desktop, there's no real filesystem here: library tracks are
// identified by content:// URIs (see lib/localLibrary.ts), and a relative
// path in an .m3u has no meaningful base directory to resolve against. So
// entries are taken as-is, and matching against the library (matchM3uEntries
// in useStore.ts) is a straight string comparison against those URIs — which
// is also exactly what an .m3u this app itself exported will contain.

export type M3uEntry = { path: string; title: string | null; duration?: number | null }

/** Parse .m3u/.m3u8 text into ordered entries. */
export function parseM3u(text: string): M3uEntry[] {
  const entries: M3uEntry[] = []
  let pendingTitle: string | null = null
  let pendingDuration: number | null = null
  // Strip a UTF-8 BOM so the first path doesn't get a stray prefix.
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) {
      // #EXTINF:<seconds>,<Artist - Title>
      const m = /^#EXTINF:\s*(-?\d+(?:\.\d+)?)\s*,\s*(.*)$/i.exec(line)
      if (m) {
        const secs = parseFloat(m[1])
        pendingDuration = Number.isFinite(secs) && secs > 0 ? secs : null
        pendingTitle = m[2].trim() || null
      }
      continue // every other #directive (#EXTM3U, #PLAYLIST, …) is ignored
    }
    entries.push({ path: line, title: pendingTitle, duration: pendingDuration })
    pendingTitle = null
    pendingDuration = null
  }
  return entries
}

/** Suggested playlist name from a picked file's display name. */
export function nameFromFilename(filename: string): string {
  return filename.replace(/\.m3u8?$/i, '').trim() || 'Imported Playlist'
}

// tracks: [{ path, title, artist, duration }] in playlist order. #EXTINF
// lines carry duration + "Artist - Title" for players that show metadata.
export function serializeM3u(tracks: { path: string; title?: string | null; artist?: string | null; duration?: number | null }[]): string {
  const lines = ['#EXTM3U']
  for (const t of tracks) {
    if (!t?.path) continue
    const dur = Number.isFinite(t.duration) && (t.duration as number) > 0 ? Math.round(t.duration as number) : -1
    const label = [t.artist, t.title].filter(Boolean).join(' - ') || t.path.split(/[\\/]/).pop() || t.path
    lines.push(`#EXTINF:${dur},${label}`)
    lines.push(t.path)
  }
  // BOM so non-ASCII paths/titles round-trip on players that assume Latin-1
  // for a bare .m3u; .m3u8 is UTF-8 by definition either way.
  return '﻿' + lines.join('\r\n') + '\r\n'
}

// ── Native file picker ──────────────────────────────────────────────────────
// Reuses LocalLibraryPlugin's pickTextFile (a general "pick a file, read it
// as text" method) rather than adding a picker to the Downloads plugin, which
// only ever writes.

interface TextFilePickerPlugin {
  pickTextFile(): Promise<{ canceled?: boolean; name?: string; text?: string }>
}

function androidPlugin(): TextFilePickerPlugin | null {
  const cap = (window as unknown as { Capacitor?: { Plugins?: { LocalLibrary?: TextFilePickerPlugin } } }).Capacitor
  return cap?.Plugins?.LocalLibrary ?? null
}

/** Opens the system file picker and reads the chosen file as text. Resolves
 *  null if the user backed out or the plugin isn't available (non-Android). */
export async function pickM3uFile(): Promise<{ name: string; text: string } | null> {
  const plugin = androidPlugin()
  if (!plugin) return null
  const res = await plugin.pickTextFile()
  if (res.canceled || res.text == null) return null
  return { name: res.name || 'playlist.m3u', text: res.text }
}
