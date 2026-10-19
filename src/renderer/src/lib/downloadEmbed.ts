// "Add song info to downloads" (Settings → Preferences, on by default). The
// song is fetched by id and its details written into the MP3's ID3 tag: the
// name it shows under (your custom one, if set), artist, album, cover, and
// lyrics - plain text as USLT, plus timed lines as SYLT when the song has
// synced lyrics. A cover the app shows instead of the song's own art (yours,
// a rotated one, an era cover) replaces the file's own cover; the song's own
// art only fills in when the file has none. Every step is best-effort: if the
// setting is off, there's nothing to embed, the file isn't an MP3 or anything
// fails, the caller just downloads the untouched file.
import { useStore } from '../store/useStore'
import { buildImageUrl, getSongById, overrideCoverUrl, type JWApiSong } from './juicewrldApi'
import { peekSongPref } from './songPrefs'
import { isLrcFormat, parseLrc } from './lyrics'
import { triggerDownload } from './apiFilesShared'
import { fetchImageBlob } from './coverImage'
import type { Mp3Cover, Mp3Extras } from './mp3Tags'

export type DownloadEmbed = Mp3Extras

function lyricsOf(song: JWApiSong): Mp3Extras['lyrics'] {
  const synced = song.synced_lyrics && isLrcFormat(song.synced_lyrics) ? parseLrc(song.synced_lyrics) : []
  const text = (song.lyrics?.trim() || synced.map((l) => l.text).join('\n')).trim()
  return text ? { text, synced } : undefined
}

/** The image as JPEG or PNG - the only cover types players reliably show
 *  (WebP and the rest get re-encoded as JPEG). */
async function coverFrom(url: string | undefined): Promise<Mp3Cover | undefined> {
  if (!url) return undefined
  try {
    let blob = await fetchImageBlob(url)
    if (blob.type !== 'image/jpeg' && blob.type !== 'image/png') {
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return undefined
      ctx.drawImage(bitmap, 0, 0)
      bitmap.close()
      const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
      if (!jpeg) return undefined
      blob = jpeg
    }
    return { mime: blob.type, data: await blob.arrayBuffer() }
  } catch {
    return undefined
  }
}

/** What to embed for this download, or null when nothing should be. */
export async function embedForDownload(songId: number | null | undefined, path: string): Promise<DownloadEmbed | null> {
  if (songId == null || !/\.mp3$/i.test(path)) return null
  if (!useStore.getState().embedSongInfoOnDownload) return null
  let song: JWApiSong
  try {
    song = await getSongById(songId)
  } catch {
    return null
  }
  const pref = peekSongPref(songId)
  const override = overrideCoverUrl(songId, pref?.cover_url, song.category, song.era?.name)
  const [cover, fallbackCover] = await Promise.all([
    coverFrom(override),
    override ? undefined : coverFrom(buildImageUrl(song.image_url)),
  ])
  return {
    info: {
      title: pref?.name || song.name || '',
      artist: song.credited_artists || 'Juice WRLD',
      album: song.album || song.era?.name || '',
      albumArtist: 'Juice WRLD',
    },
    lyrics: lyricsOf(song),
    cover,
    fallbackCover,
  }
}

/** The blob with the extras written in, or the original if that fails. A cover
 *  the tag writer can't take (odd image type) is dropped before giving up. */
export async function embedSafe(blob: Blob, embed: DownloadEmbed): Promise<Blob> {
  try {
    const { embedInMp3 } = await import('./mp3Tags')
    try {
      return await embedInMp3(blob, embed)
    } catch (err) {
      if (!embed.cover && !embed.fallbackCover) throw err
      return await embedInMp3(blob, { ...embed, cover: undefined, fallbackCover: undefined })
    }
  } catch {
    return blob
  }
}

/** Download `url` as `filename` with the song's info embedded when the
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
