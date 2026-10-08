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

export async function writeMp3Tags(source: Blob, tags: Mp3Tags): Promise<Blob> {
  const writer = new ID3Writer(await source.arrayBuffer())
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
  writer.addTag()
  return writer.getBlob()
}
