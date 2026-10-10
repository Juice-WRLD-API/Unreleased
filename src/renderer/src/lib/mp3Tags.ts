// Read/write ID3 tags in a browser. MP3 only - browser-id3-writer is the only
// writer here, and it replaces the whole ID3v2 tag, so anything we don't read
// back and re-set (lyrics, comments, custom frames) is dropped on save. Title,
// artist, album, year, genre and cover are preserved/edited.
import { ID3Writer } from 'browser-id3-writer'
import jsmediatags from 'jsmediatags/dist/jsmediatags.min.js'

export interface Mp3Cover { mime: string; data: ArrayBuffer }

export interface Mp3Tags {
  title: string
  artist: string
  album: string
  year: string
  genre: string
  /** The existing embedded cover, if any. */
  cover: Mp3Cover | null
}

export const EMPTY_TAGS: Mp3Tags = { title: '', artist: '', album: '', year: '', genre: '', cover: null }

export function canEditTags(filename: string): boolean {
  return /\.mp3$/i.test(filename)
}

export function readMp3Tags(blob: Blob): Promise<Mp3Tags> {
  return new Promise((resolve) => {
    jsmediatags.read(blob, {
      onSuccess: ({ tags }) => {
        const pic = tags.picture
        resolve({
          title: tags.title ?? '',
          artist: tags.artist ?? '',
          album: tags.album ?? '',
          year: (tags.year ?? '').slice(0, 4),
          genre: tags.genre ?? '',
          cover: pic
            ? { mime: pic.format, data: new Uint8Array(pic.data).buffer }
            : null,
        })
      },
      // No tag at all is normal for an untagged file - start from blanks.
      onError: () => resolve({ ...EMPTY_TAGS }),
    })
  })
}

export interface EmbeddableLyrics {
  /** Plain text, one lyric line per line. Written as USLT. */
  text: string
  /** Timed lines (seconds), written as SYLT alongside the plain text. */
  synced: { time: number; text: string }[]
}

/** Adds lyrics and/or a cover to an MP3 while keeping the tags it already
 *  carries (as far as this module reads them - see the header note). A given
 *  `cover` replaces the file's own one. */
export async function embedInMp3(source: Blob, extras: { lyrics?: EmbeddableLyrics; cover?: Mp3Cover }): Promise<Blob> {
  const tags = await readMp3Tags(source)
  if (extras.cover) tags.cover = extras.cover
  const writer = new ID3Writer(await source.arrayBuffer())
  applyTags(writer, tags)
  const { lyrics } = extras
  if (lyrics) {
    writer.setFrame('USLT', { description: '', lyrics: lyrics.text })
    if (lyrics.synced.length > 0) {
      writer.setFrame('SYLT', {
        type: 1, // lyrics
        text: lyrics.synced.map((l) => [l.text, Math.round(l.time * 1000)] as const),
        timestampFormat: 2, // milliseconds
        description: '',
      })
    }
  }
  writer.addTag()
  return writer.getBlob()
}

function applyTags(writer: ID3Writer, tags: Mp3Tags): void {
  if (tags.title.trim()) writer.setFrame('TIT2', tags.title.trim())
  if (tags.artist.trim()) writer.setFrame('TPE1', [tags.artist.trim()])
  if (tags.album.trim()) writer.setFrame('TALB', tags.album.trim())
  if (/^\d{4}$/.test(tags.year.trim())) writer.setFrame('TYER', Number(tags.year.trim()))
  if (tags.genre.trim()) writer.setFrame('TCON', [tags.genre.trim()])
  if (tags.cover) {
    writer.setFrame('APIC', {
      type: 3, // front cover
      data: tags.cover.data,
      description: '',
      useUnicodeEncoding: false,
    })
  }
}

export async function writeMp3Tags(source: Blob, tags: Mp3Tags): Promise<Blob> {
  const writer = new ID3Writer(await source.arrayBuffer())
  applyTags(writer, tags)
  writer.addTag()
  return writer.getBlob()
}
