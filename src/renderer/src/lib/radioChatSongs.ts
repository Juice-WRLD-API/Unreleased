import type { JWApiSong } from './juicewrldApi'

type SongTitle = Pick<JWApiSong, 'id' | 'name' | 'track_titles'>

function titleKey(title: string): string {
  return title.trim().replace(/\s+/g, ' ').replace(/[‘’]/g, "'").toLowerCase()
}

export function matchRadioChatSongs(songs: readonly SongTitle[]): (text: string) => { text: string; songId?: number }[] {
  const titles = new Map<string, number | null>()
  for (const song of songs) {
    for (const title of [song.name, ...(song.track_titles ?? [])]) {
      const key = titleKey(title)
      if (!/[\p{L}\p{N}]/u.test(key)) continue
      const prior = titles.get(key)
      titles.set(key, prior === undefined || prior === song.id ? song.id : null)
    }
  }
  if (!titles.size) return (text) => [{ text }]

  // Match the longest title at each position and keep URLs and emoji shortcodes intact.
  const alternatives = [...titles.keys()].sort((a, b) => b.length - a.length).map((title) => title
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/ /g, '\\s+')
    .replace(/'/g, "['‘’]"))
  const matches = new RegExp(`(?:https?://|www\\.)[^\\s<>]+|:[a-z0-9_]+:|(?<![\\p{L}\\p{M}\\p{N}_])(${alternatives.join('|')})(?![\\p{L}\\p{M}\\p{N}_])`, 'giu')

  return (text) => {
    const parts: { text: string; songId?: number }[] = []
    let end = 0
    for (const match of text.matchAll(matches)) {
      if (!match[1]) continue
      const title = titleKey(match[1])
      const songId = titles.get(title)
      if (songId == null) continue
      const start = match.index
      const after = start + match[0].length
      // Very short titles double as common words. Require a standalone message or a quote.
      if (title.length <= 3 && /[\p{L}\p{N}]/u.test(text.slice(0, start) + text.slice(after)) &&
          !(/["“‘']$/.test(text.slice(0, start)) && /^["”’']/.test(text.slice(after)))) continue
      if (start > end) parts.push({ text: text.slice(end, start) })
      parts.push({ text: match[0], songId })
      end = after
    }
    if (end < text.length) parts.push({ text: text.slice(end) })
    return parts
  }
}
