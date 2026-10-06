import { useStore } from '../../store/useStore'
import { addToPlaylist, createPlaylist, deletePlaylist, getPlaylist, removeFromPlaylist, type PlaylistSummary } from '../userApi'
import { getSongById, getSongsByIds, songToTrack, type JWApiSong } from '../juicewrldApi'
import { completeSongs, songFromArg } from './player'
import { PLAYLIST_EDIT_SUBS, runPlaylistEdit } from './playlistEdit'
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

async function playlistTracks(id: number): Promise<{ name: string; tracks: ReturnType<typeof songToTrack>[]; songs: { id: number; name: string }[] }> {
  const detail = await getPlaylist(id)
  const ordered = [...detail.items].sort((a, b) => a.position - b.position)
  const songs = await getSongsByIds(ordered.map((i) => i.song.id))
  const byId = new Map(songs.map((s) => [s.id, s]))
  const found = ordered.map((i) => byId.get(i.song.id)).filter((s): s is NonNullable<typeof s> => !!s)
  return { name: detail.name, tracks: found.map(songToTrack), songs: found.map((s) => ({ id: s.id, name: s.name })) }
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
    usage: 'playlist <play|shuffle|show|open> <name|N>  ·  create <name>  ·  delete <name|N>  ·  add|remove <name|N> -- <song>  ·  rename|describe <name|N> -- <text>  ·  public|private <name|N>  ·  move <name|N> -- <from> <to>  ·  cover <name|N|id:N> [-- show|set|rm]  ·  view <id>',
    covers: [
      'userApi.getPlaylists', 'userApi.createPlaylist', 'userApi.deletePlaylist', 'userApi.addToPlaylist', 'userApi.removeFromPlaylist', 'userApi.getPlaylist',
      'userApi.renamePlaylist', 'userApi.updatePlaylist', 'userApi.reorderPlaylist', 'userApi.uploadPlaylistCover', 'userApi.removePlaylistCover',
      'userApi.getPlaylistCover', 'userApi.getPublicPlaylist', 'userApi.getPublicPlaylistCover',
    ],
    description: 'Play, inspect and edit your playlists. <name> can be a few letters of the title, <N> or #N a number from playlists, <song> a title or a number from find',
    complete: completePlaylistNames,
    run: async (args, ctx) => {
      const [sub = '', ...restWords] = args.trim().split(/\s+/)
      const rest = restWords.join(' ')
      switch (sub.toLowerCase()) {
        case 'play': case 'shuffle': {
          const pl = await playlistFromArg(rest)
          const { tracks } = await playlistTracks(pl.id)
          if (tracks.length === 0) fail(`${pl.name} is empty`)
          st().playCollection(tracks, null, 'playlist')
          if (sub.toLowerCase() === 'shuffle' && !st().shuffle) st().toggleShuffle()
          ctx.print(`▶ ${pl.name} (${tracks.length} track${tracks.length === 1 ? '' : 's'}${sub.toLowerCase() === 'shuffle' ? ', shuffled' : ''})`, 'ok')
          return
        }
        case 'show': case 'ls': {
          const pl = await playlistFromArg(rest)
          const { songs } = await playlistTracks(pl.id)
          ctx.print(`${pl.name}\n${songs.length ? songs.slice(0, 80).map((s, i) => `${String(i + 1).padStart(3)}  ${s.name}`).join('\n') : '(empty)'}${songs.length > 80 ? `\n  … ${songs.length - 80} more` : ''}`)
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
          if (split.length < 2 || !split[1].trim()) fail(`usage: playlist ${sub.toLowerCase()} <name|N> -- <song>`)
          const pl = await playlistFromArg(split[0])
          const song = await songFromArg(split.slice(1).join(' -- ').trim())
          if (sub.toLowerCase() === 'add') await addToPlaylist(pl.id, song.id)
          else await removeFromPlaylist(pl.id, song.id)
          await st().refreshPlaylists()
          ctx.print(`${sub.toLowerCase() === 'add' ? 'added' : 'removed'} ${song.name} ${sub.toLowerCase() === 'add' ? 'to' : 'from'} "${pl.name}"`, 'ok')
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
      const songIds = ids.map((id) => /^jw-(\d+)$/.exec(id)?.[1]).filter((n): n is string => !!n).map(Number)
      const other = ids.length - songIds.length
      if (songIds.length === 0) { ctx.print(other ? `${other} liked file${other === 1 ? '' : 's'} (no library songs)` : 'no liked songs yet', 'dim'); return }
      const songs = await getSongsByIds(songIds.slice(0, 200))
      if (args.trim().toLowerCase() === 'play') {
        st().playCollection(songs.map(songToTrack), null, null)
        ctx.print(`▶ ${songs.length} liked song${songs.length === 1 ? '' : 's'}`, 'ok')
        return
      }
      ctx.print(`${songs.slice(0, 80).map((s, i) => `${String(i + 1).padStart(3)}  ${s.name}`).join('\n')}${songs.length > 80 ? `\n  … ${songs.length - 80} more` : ''}${other ? `\n  + ${other} liked file${other === 1 ? '' : 's'}` : ''}`)
    },
  },
]
