// "Embed lyrics and cover in downloads" (Settings → Preferences). The song's
// lyrics are fetched by id and written into the MP3's ID3 tag - plain text as
// USLT, plus timed lines as SYLT when the song has synced lyrics - and the
// cover the user picked for the song (if any) replaces the file's own one.
// Every step is best-effort: if the setting is off, there's nothing to embed,
// the file isn't an MP3 or anything fails, the caller just downloads the
// untouched file.
import { useStore } from '../store/useStore'
import { getSongById, resolvePrefCoverUrl } from './juicewrldApi'
import { peekSongPref } from './songPrefs'
import { isLrcFormat, parseLrc } from './lyrics'
import { triggerDownload } from './apiFilesShared'
import type { EmbeddableLyrics, Mp3Cover } from './mp3Tags'

export interface DownloadEmbed {
  lyrics?: EmbeddableLyrics
  cover?: Mp3Cover
}

async function lyricsFor(songId: number): Promise<EmbeddableLyrics | undefined> {
  try {
    const song = await getSongById(songId)
    const synced = song.synced_lyrics && isLrcFormat(song.synced_lyrics) ? parseLrc(song.synced_lyrics) : []
    const text = (song.lyrics?.trim() || synced.map((l) => l.text).join('\n')).trim()
    return text ? { text, synced } : undefined
  } catch {
    return undefined
  }
}

/** The user's own cover for this song (not an era/rotated/API one). */
async function personalCoverFor(songId: number): Promise<Mp3Cover | undefined> {
  const url = resolvePrefCoverUrl(peekSongPref(songId)?.cover_url)
  if (!url) return undefined
  try {
    const res = await fetch(url)
    if (!res.ok) return undefined
    const blob = await res.blob()
    return { mime: blob.type, data: await blob.arrayBuffer() }
  } catch {
    return undefined
  }
}

/** What to embed for this download, or null when nothing should be. */
export async function embedForDownload(songId: number | null | undefined, path: string): Promise<DownloadEmbed | null> {
  if (songId == null || !/\.mp3$/i.test(path)) return null
  if (!useStore.getState().embedLyricsOnDownload) return null
  const [lyrics, cover] = await Promise.all([lyricsFor(songId), personalCoverFor(songId)])
  return lyrics || cover ? { lyrics, cover } : null
}

/** The blob with the extras written in, or the original if that fails. A cover
 *  the tag writer can't take (odd image type) is dropped before giving up. */
export async function embedSafe(blob: Blob, embed: DownloadEmbed): Promise<Blob> {
  try {
    const { embedInMp3 } = await import('./mp3Tags')
    try {
      return await embedInMp3(blob, embed)
    } catch (err) {
      if (!embed.cover || !embed.lyrics) throw err
      return await embedInMp3(blob, { lyrics: embed.lyrics })
    }
  } catch {
    return blob
  }
}

/** Download `url` as `filename` with the song's lyrics/cover embedded when the
 *  setting is on and there's something to embed; otherwise a plain browser
 *  download. */
export async function downloadWithEmbed(url: string, filename: string, path: string, songId: number | null | undefined): Promise<void> {
  const embed = await embedForDownload(songId, path)
  if (embed) {
    try {
      const res = await fetch(url)
      if (res.ok) {
        const blob = await embedSafe(await res.blob(), embed)
        const objectUrl = URL.createObjectURL(blob)
        triggerDownload(objectUrl, filename)
        setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
        return
      }
    } catch { /* fall through to the plain download */ }
  }
  triggerDownload(url, filename)
}
