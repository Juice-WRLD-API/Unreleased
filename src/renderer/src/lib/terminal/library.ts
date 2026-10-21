import { useStore } from '../../store/useStore'
import {
  addPlaylistEntry, addToPlaylist, createPlaylist, deletePlaylist, getPlaylist, removeFromPlaylist, removePlaylistEntry, trackIdToSongId,
  type PlaylistEntryInput, type PlaylistItemEntry, type PlaylistSummary,
} from '../userApi'
import { isPrivateEntry, itemSource, playlistItemsToTracks, playlistSongIds, trackToPlaylistEntry } from '../playlistItems'
import { listDonorFiles } from '../donorFilesApi'
import { isDonorAudio } from '../donorPlayback'
import { libraryTrackToTrack } from '../fileTypes'
import type { Track } from '../../types'
import { getSongById, getSongsByIds, songToTrack, type JWApiSong } from '../juicewrldApi'
import { completeSongs, songFromArg } from './player'
import { PLAYLIST_EDIT_SUBS, runPlaylistEdit } from './playlistEdit'
import { pageRows } from './more'
import { parseSearchQuery, matchesFieldFilters } from '../trackerSearch'
import { displaySongName } from '../songPrefs'
import { fail, pickByName, type TermCommand } from './types'

const st = (): ReturnType<typeof useStore.getState> => useStore.getState()

async function myPlaylists(): Promise<PlaylistSummary[]> {
  if (!st().account) fail('sign in to use your playlists')
  if (st().playlists.length === 0) await st().refreshPlaylists()
  return st().playlists
}

// A playlist is named either by its number in `playlists` or by (part of) its
// name, like a shell lets you point at a file by index or by prefix.
async function playlistFromArg(arg: string): Promise<PlaylistSummary> {
  const list = await myPlaylists()
  // `5` or `#5`, the number `playlists` printed.
  const num = /^#?(\d+)$/.exec(arg.trim())
  const n = num ? Number(num[1]) : 0
  if (n) return list[n - 1] ?? fail(`pick a playlist from 1 to ${list.length}`)
  return pickByName(list, (p) => p.name, arg) ?? fail(`no single playlist matches "${arg.trim()}" (try: playlists)`)
}

// One row per entry, in playlist order, so row numbers are the positions
// `move` and `remove -- at N` take. Songs come back in full (for show's field
// filters); file entries as the Track the player would get.
interface PlaylistRow { item: PlaylistItemEntry; track: Track; song: JWApiSong | null }

async function playlistRows(id: number): Promise<{ name: string; rows: PlaylistRow[] }> {
  const detail = await getPlaylist(id)
  const ordered = [...detail.items].sort((a, b) => a.position - b.position)
  const songs = await getSongsByIds(playlistSongIds(ordered))
  const byId = new Map(songs.map((s) => [s.id, s]))
  const tracks = playlistItemsToTracks(ordered)
  const rows = ordered.map((item, i): PlaylistRow => {
    const song = item.song ? byId.get(item.song.id) ?? null : null
    return { item, song, track: song ? songToTrack(song) : tracks[i] }
  })
  return { name: detail.name, rows }
}

function rowLabel(r: PlaylistRow): string {
  if (r.song) return displaySongName(r.song)
  switch (itemSource(r.item)) {
    case 'comp': return `${r.track.title}  (file${r.item.channel && r.item.channel !== 'comp' ? `, ${r.item.channel}` : ''})`
    case 'donor': return `${r.track.title}  (my file)`
    case 'local': return `${r.track.title}  (local${r.track.path ? '' : ', not on this device'})`
    default: return r.track.title
  }
}

// What add/remove point at: a song, or `file <path>` (in the Files tab's
// current comp), `myfile <name>` (a donor upload) or `local <name>` (a file in
// this device's library).
async function entryFromArg(arg: string): Promise<{ entry: PlaylistEntryInput; label: string }> {
  const m = /^(file|myfile|local)\s+(.+)$/i.exec(arg)
  if (!m) {
    const song = await songFromArg(arg)
    return { entry: { song_id: song.id }, label: displaySongName(song) }
  }
  const what = m[2].trim()
  switch (m[1].toLowerCase()) {
    case 'file': {
      const path = what.replace(/^\/+/, '')
      const channel = st().activeChannel
      return { entry: { source: 'comp', path, ...(channel ? { channel } : {}) }, label: path.split('/').pop() ?? path }
    }
    case 'myfile': {
      const { files } = await listDonorFiles()
      const f = pickByName(files.filter(isDonorAudio), (x) => x.filename, what) ?? fail(`no single audio file of yours matches "${what}" (try: donor ls)`)
      return { entry: { source: 'donor', file_id: f.file_id }, label: f.filename }
    }
    default: {
      if (st().libraryTracks.length === 0) await st().loadLibrary()
      const t = pickByName(st().libraryTracks, (x) => x.title, what) ?? fail(`no single library file matches "${what}"`)
      const entry = trackToPlaylistEntry(libraryTrackToTrack(t)) ?? fail('that file\'s path is too long to store in a playlist')
      return { entry, label: t.title }
    }
  }
}

function matchesEntry(item: PlaylistItemEntry, entry: PlaylistEntryInput): boolean {
  if ('song_id' in entry) return item.song?.id === entry.song_id
  if (entry.source === 'comp') return itemSource(item) === 'comp' && item.filepath === entry.path
  if (entry.source === 'donor') return item.donor_file?.file_id === entry.file_id
  return itemSource(item) === 'local' && item.local_id === entry.local_id
}

const SUBS = ['play', 'shuffle', 'show', 'create', 'delete', 'add', 'remove', 'open', ...PLAYLIST_EDIT_SUBS]
// Subcommands whose first argument is a playlist (add/remove take it before `--`).
const PLAYLIST_SUBS = new Set(['play', 'shuffle', 'show', 'ls', 'open', 'delete', 'rm', 'add', 'remove', 'rename', 'describe', 'public', 'private', 'move', 'cover'])

// Playlist titles for Tab. Like `shuffle <era>`, a title with spaces completes
// one word at a time: only the words past what is already typed come back.
async function completePlaylistNames(before: string[], partial: string): Promise<string[]> {
  if (before.length === 0) return SUBS.filter((s) => s.startsWith(partial.toLowerCase()))
  if (!PLAYLIST_SUBS.has(before[0].toLowerCase())) return []
  const typed = [...before.slice(1), partial]
  if (typed.includes('--')) return []
  const full = typed.join(' ').toLowerCase()
  if (full.startsWith('#')) return []
  let list: PlaylistSummary[]
  try { list = await myPlaylists() } catch { return [] }
  return list
    .map((p) => p.name)
    .filter((n) => n.toLowerCase().startsWith(full))
    .map((n) => n.split(' ').slice(typed.length - 1).join(' '))
}

const oneLine = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()
// The API's date fields repeat their own label ("Released" + a line break + the date).
const dateLine = (s: string | null | undefined): string => oneLine(s).replace(/^(recorded|released|previewed)\s*/i, '')

function describeSong(song: JWApiSong): string {
  const field = (label: string, value: string | null | undefined): string[] => (oneLine(value) ? [`${label.padEnd(10)}${oneLine(value)}`] : [])
  const aliases = (song.track_titles ?? []).filter((t) => t.toLowerCase() !== song.name.toLowerCase())
  return [
    `${song.name}   #${song.id}`,
    ...field('renamed', displaySongName(song) !== song.name ? displaySongName(song) : ''),
    ...field('era', song.era ? `${song.era.name}${song.era.time_frame ? ` (${song.era.time_frame})` : ''}` : ''),
    ...field('category', `${song.category.replace('_', ' ')}${song.length ? ` · ${song.length}` : ''}`),
    ...field('also', aliases.join(', ')),
    ...field('artists', song.credited_artists),
    ...field('producers', song.producers),
    ...field('engineers', song.engineers),
    ...field('studio', song.recording_locations),
    ...field('recorded', dateLine(song.record_dates)),
    ...field('previewed', dateLine(song.preview_date)),
    ...field('released', dateLine(song.release_date)),
    ...field('file', song.path),
  ].join('\n')
}

const playlistCommand = (): TermCommand => LIBRARY_COMMANDS.find((c) => c.name === 'playlist')!

export const LIBRARY_COMMANDS: TermCommand[] = [
  {
    name: 'song', aliases: ['info'], group: 'Library', usage: 'song <title | N>',
    description: 'Everything the library knows about a song: era, credits, dates and its file. N is a number from find. (In the terminal this replaces the chat /song, which posts to a room)',
    complete: completeSongs,
    run: async (args, ctx) => {
      if (!args.trim()) fail('usage: song <title | N>')
      const picked = await songFromArg(args.trim())
      ctx.print(describeSong(await getSongById(picked.id, ctx.signal)))
    },
  },
  {
    name: 'playlists', aliases: ['pls'], group: 'Library', usage: 'playlists', description: 'List your playlists, numbered. With a subcommand (playlists play #5) it works like playlist',
    complete: completePlaylistNames,
    run: async (args, ctx) => {
      // `playlists play 5` is `playlist play 5` - same words, easy to mistype.
      if (args.trim()) { await playlistCommand().run(args, ctx); return }
      const list = await myPlaylists()
      if (list.length === 0) { ctx.print('no playlists yet (playlist create <name>)', 'dim'); return }
      ctx.print(list.map((p, i) => `${String(i + 1).padStart(3)}  ${p.name}  (${p.track_count} track${p.track_count === 1 ? '' : 's'}${p.is_public ? ', public' : ''})`).join('\n'))
    },
  },
  {
    name: 'playlist', aliases: ['pl'], group: 'Library',
    usage: 'playlist <play|shuffle|show|open> <name|N>  ·  show <name|N> -- <filter>  ·  create <name>  ·  delete <name|N>  ·  add|remove <name|N> -- <song | file <path> | myfile <name> | local <name>>  ·  remove <name|N> -- at <N>  ·  rename|describe <name|N> -- <text>  ·  public|private <name|N>  ·  move <name|N> -- <from> <to>  ·  cover <name|N|id:N> [-- show|set|rm]  ·  view <id>',
    covers: [
      'userApi.getPlaylists', 'userApi.createPlaylist', 'userApi.deletePlaylist', 'userApi.addToPlaylist', 'userApi.removeFromPlaylist', 'userApi.getPlaylist',
      'userApi.addPlaylistEntry', 'userApi.removePlaylistEntry', 'userApi.reorderPlaylistItems',
      'userApi.renamePlaylist', 'userApi.updatePlaylist', 'userApi.uploadPlaylistCover', 'userApi.removePlaylistCover',
      'userApi.getPlaylistCover', 'userApi.getPublicPlaylist', 'userApi.getPublicPlaylistCover',
    ],
    description: 'Play, inspect and edit your playlists. <name> can be a few letters of the title, <N> or #N a number from playlists, <song> a title or a number from find. Playlists can also hold files: file <path> from the Files tab\'s current comp, myfile <name> from your uploads, local <name> from this device\'s library (the last two only in private playlists)',
    complete: completePlaylistNames,
    run: async (args, ctx) => {
      const [sub = '', ...restWords] = args.trim().split(/\s+/)
      const rest = restWords.join(' ')
      switch (sub.toLowerCase()) {
        case 'play': case 'shuffle': {
          const pl = await playlistFromArg(rest)
          const tracks = (await playlistRows(pl.id)).rows.map((r) => r.track).filter((t) => t.path)
          if (tracks.length === 0) fail(`${pl.name} is empty`)
          st().playCollection(tracks, null, 'playlist')
          if (sub.toLowerCase() === 'shuffle' && !st().shuffle) st().toggleShuffle()
          ctx.print(`▶ ${pl.name} (${tracks.length} track${tracks.length === 1 ? '' : 's'}${sub.toLowerCase() === 'shuffle' ? ', shuffled' : ''})`, 'ok')
          return
        }
        case 'show': case 'ls': {
          // Optional `-- <filter>`, the playlist search's syntax: plain words
          // match title/artist, field:"value" tokens any Tracker field.
          const [plArg, filter = ''] = rest.split(/\s+--\s+/)
          const pl = await playlistFromArg(plArg)
          const { rows } = await playlistRows(pl.id)
          const { freeText, filters } = parseSearchQuery(filter)
          const q = freeText.toLowerCase()
          // Field filters need a song, so they leave file entries out.
          const shown = rows
            .map((row, i) => ({ row, n: i + 1 }))
            .filter(({ row: { song, track } }) => song
              ? (!q || displaySongName(song).toLowerCase().includes(q) || song.credited_artists.toLowerCase().includes(q)) && matchesFieldFilters(song, filters)
              : !filters.length && (!q || track.title.toLowerCase().includes(q)))
          const empty = rows.length ? `nothing in ${pl.name} matches "${filter}"` : '(empty)'
          ctx.print(`${pl.name}\n${shown.length ? pageRows(shown.length, (i) => `${String(shown[i].n).padStart(3)}  ${rowLabel(shown[i].row)}`, 80) : empty}`)
          return
        }
        case 'open': {
          const pl = await playlistFromArg(rest)
          st().setPendingPlaylistId(pl.id)
          st().setActiveView('playlists')
          return
        }
        case 'create': case 'new': {
          if (!rest) fail('usage: playlist create <name>')
          if (!st().account) fail('sign in to create playlists')
          const made = await createPlaylist(rest)
          await st().refreshPlaylists()
          ctx.print(`created "${made.name}"`, 'ok')
          return
        }
        case 'delete': case 'rm': {
          const pl = await playlistFromArg(rest)
          if (!window.confirm(`Delete the playlist "${pl.name}"? This can't be undone.`)) { ctx.print('cancelled', 'dim'); return }
          await deletePlaylist(pl.id)
          await st().refreshPlaylists()
          ctx.print(`deleted "${pl.name}"`, 'ok')
          return
        }
        case 'add': case 'remove': {
          const split = rest.split(/\s+--\s+/)
          if (split.length < 2 || !split[1].trim()) fail(`usage: playlist ${sub.toLowerCase()} <name|N> -- <song | file <path> | myfile <name> | local <name>>${sub.toLowerCase() === 'remove' ? '  ·  remove <name|N> -- at <N>' : ''}`)
          const pl = await playlistFromArg(split[0])
          const target = split.slice(1).join(' -- ').trim()
          const isAdd = sub.toLowerCase() === 'add'
          // remove -- at N: any entry, by its number in `playlist show`.
          const at = !isAdd ? /^at\s+#?(\d+)$/i.exec(target) : null
          if (at) {
            const { rows } = await playlistRows(pl.id)
            const row = rows[Number(at[1]) - 1] ?? fail(`${pl.name} has ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`)
            await removePlaylistEntry(pl.id, row.item.id)
            await st().refreshPlaylists()
            ctx.print(`removed ${rowLabel(row)} from "${pl.name}"`, 'ok')
            return
          }
          const { entry, label } = await entryFromArg(target)
          if (isAdd) {
            if (isPrivateEntry(entry) && pl.is_public) fail(`"${pl.name}" is public, and your own and local files can only go in private playlists (playlist private ${pl.name})`)
            if ('song_id' in entry) await addToPlaylist(pl.id, entry.song_id)
            else await addPlaylistEntry(pl.id, entry)
          } else if ('song_id' in entry) {
            await removeFromPlaylist(pl.id, entry.song_id)
          } else {
            const item = (await getPlaylist(pl.id)).items.find((i) => matchesEntry(i, entry)) ?? fail(`${label} isn't in "${pl.name}"`)
            await removePlaylistEntry(pl.id, item.id)
          }
          await st().refreshPlaylists()
          ctx.print(`${isAdd ? 'added' : 'removed'} ${label} ${isAdd ? 'to' : 'from'} "${pl.name}"`, 'ok')
          return
        }
        default:
          await runPlaylistEdit(sub.toLowerCase(), rest, ctx, playlistFromArg)
      }
    },
  },
  {
    name: 'liked', group: 'Library', usage: 'liked [play]', description: 'List your liked songs, or play them all',
    complete: (before, partial) => (before.length === 0 ? ['play'].filter((s) => s.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => {
      const ids = st().likedTrackIds
      const songIds = ids.map(trackIdToSongId).filter((n): n is number => n != null)
      const other = ids.length - songIds.length
      if (songIds.length === 0) { ctx.print(other ? `${other} liked file${other === 1 ? '' : 's'} (no library songs)` : 'no liked songs yet', 'dim'); return }
      const songs = await getSongsByIds(songIds.slice(0, 200))
      if (args.trim().toLowerCase() === 'play') {
        st().playCollection(songs.map(songToTrack), null, null)
        ctx.print(`▶ ${songs.length} liked song${songs.length === 1 ? '' : 's'}`, 'ok')
        return
      }
      ctx.print(`${pageRows(songs.length, (i) => `${String(i + 1).padStart(3)}  ${displaySongName(songs[i])}`, 80)}${other ? `\n  + ${other} liked file${other === 1 ? '' : 's'}` : ''}`)
    },
  },
]
