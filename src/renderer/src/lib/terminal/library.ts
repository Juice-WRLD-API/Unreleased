import { useStore } from '../../store/useStore'
import { addToPlaylist, createPlaylist, deletePlaylist, getPlaylist, removeFromPlaylist, type PlaylistSummary } from '../userApi'
import { getSongsByIds, songToTrack } from '../juicewrldApi'
import { songFromArg } from './player'
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
  const n = /^\d+$/.test(arg.trim()) ? Number(arg) : 0
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

const SUBS = ['play', 'shuffle', 'show', 'create', 'delete', 'add', 'remove', 'open']

export const LIBRARY_COMMANDS: TermCommand[] = [
  {
    name: 'playlists', aliases: ['pls'], group: 'Library', usage: 'playlists', description: 'List your playlists, numbered',
    run: async (_a, ctx) => {
      const list = await myPlaylists()
      if (list.length === 0) { ctx.print('no playlists yet (playlist create <name>)', 'dim'); return }
      ctx.print(list.map((p, i) => `${String(i + 1).padStart(3)}  ${p.name}  (${p.track_count} track${p.track_count === 1 ? '' : 's'}${p.is_public ? ', public' : ''})`).join('\n'))
    },
  },
  {
    name: 'playlist', aliases: ['pl'], group: 'Library',
    usage: 'playlist <play|shuffle|show|open> <name|N>  ·  create <name>  ·  delete <name|N>  ·  add <name|N> -- <song>  ·  remove <name|N> -- <song>',
    description: 'Play, inspect and edit your playlists. <name> can be a few letters of the title, <N> a number from playlists, <song> a title or a number from find',
    complete: (before, partial) => (before.length === 0 ? SUBS.filter((s) => s.startsWith(partial.toLowerCase())) : []),
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
          fail('usage: playlist <play|shuffle|show|open|create|delete|add|remove> ...')
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
