import { useEffect, useState } from 'react'
import { SyncedLyricLine } from '../types'

/**
 * Whether a lyrics section should be shown, debounced against the
 * lyrics-null placeholder `currentTrackFull` briefly holds while the real
 * lyrics for a newly-started track are still loading in - collapsing
 * immediately on that placeholder made the lyrics panel flash shut and
 * reopen on every track change. Expanding is instant (nothing to hide);
 * collapsing waits a beat in case lyrics show up before it commits to "no
 * lyrics."
 */
export function useLyricsVisible(hasLyricsNatural: boolean, override: boolean, pending = false): boolean {
  const wantVisible = hasLyricsNatural !== override
  const [visible, setVisible] = useState(wantVisible)

  useEffect(() => {
    // Lyrics are still being fetched for the current track - hold whatever
    // arrangement was already on screen instead of collapsing to the
    // no-lyrics layout just because they haven't loaded yet.
    if (pending) return
    if (wantVisible) {
      setVisible(true)
      return
    }
    const t = setTimeout(() => setVisible(false), 250)
    return () => clearTimeout(t)
  }, [wantVisible, pending])

  return visible
}

/**
 * Parse LRC format into timed lines.
 * Handles: [mm:ss.xx] or [mm:ss:xx] timestamps
 */
export function parseLrc(lrc: string): SyncedLyricLine[] {
  const lines: SyncedLyricLine[] = []
  const timeRegex = /\[(\d{1,2}):(\d{2})[.:](\d{2,3})\]/g

  for (const rawLine of lrc.split(/\r?\n/)) {
    const matches = [...rawLine.matchAll(timeRegex)]
    if (matches.length === 0) continue

    const text = rawLine.replace(timeRegex, '').trim()

    for (const match of matches) {
      const min = parseInt(match[1])
      const sec = parseInt(match[2])
      const ms = parseInt(match[3].padEnd(3, '0'))
      lines.push({ time: min * 60 + sec + ms / 1000, text })
    }
  }

  return lines.sort((a, b) => a.time - b.time)
}

/**
 * Check if a string contains LRC timestamps
 */
export function isLrcFormat(text: string): boolean {
  return /\[\d{1,2}:\d{2}[.:]\d{2}/.test(text)
}

/**
 * Find current lyric line index for given time
 */
export function getCurrentLineIndex(lines: SyncedLyricLine[], currentTime: number): number {
  if (lines.length === 0) return -1

  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= currentTime) {
      idx = i
    } else {
      break
    }
  }
  return idx
}

/** Ad-libs render at the same size as the line around them, just dimmer.
 *  Applied as `opacity` on the run, which multiplies with whatever opacity the
 *  line already carries (active vs. distant), so it reads as a consistent step
 *  down from its own line rather than a fixed tone. */
export const ADLIB_OPACITY = 0.7

/**
 * Split a lyric line into plain runs and parenthesized ad-lib runs, so the
 * renderers can dim the ad-libs ("I'm still here (still here)"). The
 * brackets stay in the output - they're part of how ad-libs read.
 *
 * Only balanced `(...)` pairs on a single line count; an unclosed bracket is
 * left as ordinary text rather than swallowing the rest of the lyrics (this
 * also runs over whole multi-line plain-text lyrics, where a stray "(" would
 * otherwise shrink everything down to the next line's ")"). Nesting isn't
 * handled - it doesn't occur in practice, and the failure mode is just a
 * normally-sized fragment.
 */
export function splitAdLibs(text: string): { text: string; adLib: boolean }[] {
  const parts: { text: string; adLib: boolean }[] = []
  let last = 0
  for (const m of text.matchAll(/\([^)\r\n]*\)/g)) {
    const start = m.index ?? 0
    if (start > last) parts.push({ text: text.slice(last, start), adLib: false })
    parts.push({ text: m[0], adLib: true })
    last = start + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), adLib: false })
  return parts.length > 0 ? parts : [{ text, adLib: false }]
}

export interface ColorWordRule { phrase: string; color: string }

/** Hardcoded word/phrase -> color easter egg for the synced lyrics view.
 *  Edit this list directly to add or change pairs. */
export const LYRIC_COLOR_WORDS: ColorWordRule[] = [
  { phrase: 'R Kelly', color: '#fcba03' },
    { phrase: 'R. Kelly', color: '#fcba03' },
]

/**
 * Split a run of lyric text around any configured color-word phrases, so the
 * renderer can color just the matched text and leave the rest untouched.
 * Case-insensitive; matched phrases keep their original casing in the output.
 */
export function splitColorWords(text: string, rules: ColorWordRule[] = LYRIC_COLOR_WORDS): { text: string; color?: string }[] {
  if (rules.length === 0 || !text) return [{ text }]
  const pattern = rules.map(r => r.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const parts = text.split(new RegExp(`(${pattern})`, 'gi')).filter(p => p !== undefined && p !== '')
  return parts.map(part => {
    const rule = rules.find(r => r.phrase.toLowerCase() === part.toLowerCase())
    return rule ? { text: part, color: rule.color } : { text: part }
  })
}

/**
 * Save a synced (LRC) lyrics string as a local .lrc file - a plain client-side
 * Blob download, not a server fetch, since the lyrics text is already in
 * memory (loaded with the track).
 */
export function downloadSyncedLyrics(title: string, artist: string, lrcContent: string): void {
  // Strip characters that are invalid in filenames on Windows/macOS.
  const safeName = `${title} - ${artist}`.replace(/[/\\?%*:|"<>]/g, '').trim() || 'lyrics'
  const blob = new Blob([lrcContent], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeName}.lrc`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
