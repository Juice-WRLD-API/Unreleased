import { buildListeningStats, formatListeningTime, joinPlayedSongs, prefsForPeriod, type ListeningPeriod, type RankedEntry } from 'site:listeningStats'
import { pickByName } from 'site:termTypes'
import { apiFetch, getMe } from './api'
import { fail, needSignIn, numbered, plural, type Command } from './command'
import { homeCwd } from './files'
import { playerOf } from './playback'
import { trackFromSong, type Track } from './player'
import { completeTitles, getSong, loadCatalog, rememberList, searchSongs, songFromArg, type Song, type SongRef } from './songs'

// The site terminal's Library commands (lib/terminal/library.ts, find from
// player.ts, stats from fun.ts). Playing goes through the shell's player
// (playback.ts); `song` also shows where a song's file is, for `get`.

// ─── Playlists ───────────────────────────────────────────────────────────────

export interface PlaylistSummary { id: number; name: string; track_count: number; is_public: boolean }
/** A song as playlists and favorites return it: enough to list and to play. */
type SongLite = SongRef & { path?: string; length?: string; era?: { name: string } | null }
interface PlaylistDetail { id: number; name: string; items: { song: SongLite; position: number }[] }

/** Tracks for a list of songs; any the list didn't carry a path for are fetched. */
async function tracksOf(songs: SongLite[]): Promise<Track[]> {
  return Promise.all(songs.map(async (s) => trackFromSong(s.path ? { ...s, path: s.path } : await getSong(s.id))))
}

let playlistCache: PlaylistSummary[] | null = null

export async function myPlaylists(fresh = false): Promise<PlaylistSummary[]> {
  needSignIn('use your playlists')
  if (fresh || !playlistCache) {
    const data = await apiFetch<PlaylistSummary[] | { results?: PlaylistSummary[] }>('/library/playlists/', { omit_cover_image: 'true' })
    playlistCache = Array.isArray(data) ? data : data?.results ?? []
  }
  return playlistCache
}

// A playlist is named by its number in `playlists` or by (part of) its name.
async function playlistFromArg(arg: string): Promise<PlaylistSummary> {
  const list = await myPlaylists()
  const num = /^#?(\d+)$/.exec(arg.trim())
  if (num) return list[Number(num[1]) - 1] ?? fail(`pick a playlist from 1 to ${list.length}`)
  return pickByName(list, (p) => p.name, arg) ?? fail(`no single playlist matches "${arg.trim()}" (try: playlists)`)
}

async function playlistSongs(id: number): Promise<{ name: string; songs: SongLite[] }> {
  const detail = await apiFetch<PlaylistDetail>(`/library/playlists/${id}/`, { omit_cover_image: 'true' })
  return { name: detail.name, songs: [...detail.items].sort((a, b) => a.position - b.position).map((i) => i.song) }
}

const SUBS = ['play', 'shuffle', 'show', 'create', 'delete', 'add', 'remove']
const PLAYLIST_SUBS = new Set(['show', 'ls', 'delete', 'rm', 'add', 'remove', 'play', 'shuffle', 'open'])

async function completePlaylist(arg: string): Promise<string[]> {
  const m = /^(\S*)(\s+)?([\s\S]*)$/.exec(arg)!
  if (!m[2]) return SUBS.filter((s) => s.startsWith(m[1].toLowerCase()))
  const sub = m[1].toLowerCase()
  if (!PLAYLIST_SUBS.has(sub)) return []
  // After `--` comes a song title.
  const dash = m[3].indexOf(' -- ')
  if (dash !== -1) {
    const head = `${m[1]} ${m[3].slice(0, dash)} -- `
    return (await completeTitles(m[3].slice(dash + 4))).map((t) => head + t)
  }
  if (m[3].startsWith('#')) return []
  const list = await myPlaylists().catch(() => [])
  return list.filter((p) => p.name.toLowerCase().startsWith(m[3].toLowerCase())).map((p) => `${m[1]} ${p.name}`)
}

const PLAYLIST: Command = {
  name: 'playlist', aliases: ['pl'], group: 'Library',
  usage: 'playlist <play|shuffle|show> <name|N>  ·  create <name>  ·  delete [-y] <name|N>  ·  add <name|N> -- <song>  ·  remove <name|N> -- <song>',
  description: 'Play, look at and edit your playlists. <name> can be a few letters of the title, <N> a number from playlists, <song> a title or a number from the last list',
  complete: completePlaylist,
  run: async (args, sh) => {
    const [sub = '', ...restWords] = args.trim().split(/\s+/)
    let rest = restWords.join(' ')
    switch (sub.toLowerCase()) {
      case 'show': case 'ls': {
        const pl = await playlistFromArg(rest)
        const { name, songs } = await playlistSongs(pl.id)
        rememberList(songs)
        sh.print(`${name}\n${songs.length ? numbered(songs.map((s) => s.name)) : '(empty)'}`)
        return
      }
      case 'create': case 'new': {
        if (!rest) fail('usage: playlist create <name>')
        needSignIn('create playlists')
        const made = await apiFetch<{ name: string }>('/library/playlists/', {}, { method: 'POST', body: { name: rest } })
        playlistCache = null
        sh.print(`created "${made.name}"`, 'ok')
        return
      }
      case 'delete': case 'rm': {
        const yes = /^-y\s+/.exec(rest)
        if (yes) rest = rest.slice(yes[0].length)
        const pl = await playlistFromArg(rest)
        if (!yes) {
          if (!process.stdin.isTTY) fail(`playlist delete: add -y to delete "${pl.name}" without asking`)
          const answer = await sh.ask(`Delete the playlist "${pl.name}" (${plural(pl.track_count, 'track')})? This can't be undone. [y/N] `)
          if (!/^y(es)?$/i.test(answer.trim())) { sh.print('cancelled', 'dim'); return }
        }
        await apiFetch(`/library/playlists/${pl.id}/`, {}, { method: 'DELETE' })
        playlistCache = null
        sh.print(`deleted "${pl.name}"`, 'ok')
        return
      }
      case 'add': case 'remove': {
        const verb = sub.toLowerCase()
        const split = rest.split(/\s+--\s+/)
        if (split.length < 2 || !split[1].trim()) fail(`usage: playlist ${verb} <name|N> -- <song>`)
        const pl = await playlistFromArg(split[0])
        const song = await songFromArg(split.slice(1).join(' -- '))
        if (verb === 'add') await apiFetch(`/library/playlists/${pl.id}/items/`, {}, { method: 'POST', body: { song_id: song.id } })
        else await apiFetch(`/library/playlists/${pl.id}/items/${song.id}/`, {}, { method: 'DELETE' })
        playlistCache = null
        sh.print(`${verb === 'add' ? 'added' : 'removed'} ${song.name} ${verb === 'add' ? 'to' : 'from'} "${pl.name}"`, 'ok')
        return
      }
      case 'play': case 'shuffle': {
        const player = playerOf(sh)
        const pl = await playlistFromArg(rest)
        const { songs } = await playlistSongs(pl.id)
        if (songs.length === 0) fail(`${pl.name} is empty`)
        await player.playCollection(await tracksOf(songs))
        // Like the site: the list plays from its first song, then the rest shuffled.
        if (sub.toLowerCase() === 'shuffle') player.setShuffle(true)
        sh.print(`▶ ${pl.name} (${plural(songs.length, 'track')}${sub.toLowerCase() === 'shuffle' ? ', shuffled' : ''})`, 'ok')
        return
      }
      case 'open':
        fail('playlist open: that opens the playlist page on the site (here: playlist show)')
        return
      default:
        fail('usage: playlist <play|shuffle|show|create|delete|add|remove> ...')
    }
  },
}

// ─── Stats ───────────────────────────────────────────────────────────────────

const PERIODS = ['all', '7', '30']

function barRows(entries: RankedEntry[], limit: number): string[] {
  const top = entries.slice(0, limit)
  const max = Math.max(1, ...top.map((e) => e.plays))
  const width = Math.min(26, Math.max(...top.map((e) => e.label.length), 4))
  return top.map((e) => `  ${e.label.slice(0, width).padEnd(width)}  ${'█'.repeat(Math.max(1, Math.round((e.plays / max) * 24)))} ${e.plays}`)
}

interface PlayEvent { song: number; played_at: string }

function playsFrom(raw: unknown): PlayEvent[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((r) => {
    const song = Number((r as PlayEvent)?.song)
    const at = typeof (r as PlayEvent)?.played_at === 'string' ? (r as PlayEvent).played_at.trim() : ''
    return Number.isFinite(song) && song > 0 && at ? [{ song, played_at: at }] : []
  })
}

// ─── Song details ────────────────────────────────────────────────────────────

const oneLine = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()
// The API's date fields repeat their own label ("Released" + a line break + the date).
const dateLine = (s: string | null | undefined): string => oneLine(s).replace(/^(recorded|released|previewed)\s*/i, '')

async function describeSong(song: Song): Promise<string> {
  const field = (label: string, value: string | null | undefined): string[] => (oneLine(value) ? [`${label.padEnd(10)}${oneLine(value)}`] : [])
  const aliases = (song.track_titles ?? []).filter((t) => t.toLowerCase() !== song.name.toLowerCase())
  const channel = (await homeCwd().catch(() => null))?.channel
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
    ...(song.path && channel ? [`→ get "/${channel}/${song.path}"`] : []),
  ].join('\n')
}

// ─── The commands ────────────────────────────────────────────────────────────

const songArgComplete = (arg: string): Promise<string[]> => completeTitles(arg)

function playingSong(sh: Parameters<Command['run']>[1]): SongRef {
  const track = playerOf(sh).current ?? fail('nothing is playing - name a song')
  if (track.songId === undefined) fail(`${track.title} is a file from the tree, not a library song`)
  return { id: track.songId!, name: track.title }
}

export const LIBRARY_COMMANDS: Command[] = [
  {
    name: 'find', aliases: ['f'], group: 'Library', usage: 'find <title>',
    description: 'Search the song library and number the results (then play N, queue add N, song N, like N, playlist add <name> -- N)',
    complete: songArgComplete,
    run: async (args, sh) => {
      const q = args.trim()
      if (!q) fail('usage: find <title>')
      const results = await searchSongs(q, 15)
      rememberList(results)
      if (results.length === 0) { sh.print(`no songs found for "${q}"`, 'dim'); return }
      sh.print(`${numbered(results.map((r) => `${r.name}  (${r.era?.name ?? r.category})`))}\nplay N · queue add N · song N · like N · playlist add <name> -- N`)
    },
  },
  {
    name: 'song', aliases: ['info'], group: 'Library', usage: 'song <title | N>',
    description: 'Everything the library knows about a song: era, credits, dates, and its file (with the get command that downloads it)',
    complete: songArgComplete,
    run: async (args, sh) => {
      const ref = await songFromArg(args)
      sh.print(await describeSong(await getSong(ref.id)))
    },
  },
  {
    name: 'like', group: 'Library', usage: 'like [title | N]', description: 'Add a song to your liked songs (no argument: the one playing)',
    complete: songArgComplete,
    run: async (args, sh) => {
      needSignIn('like songs')
      const song = args.trim() ? await songFromArg(args) : playingSong(sh)
      await apiFetch('/library/favorites/', {}, { method: 'POST', body: { song_id: song.id } })
      sh.print(`♥ ${song.name}`, 'ok')
    },
  },
  {
    name: 'unlike', group: 'Library', usage: 'unlike [title | N]', description: 'Take a song out of your liked songs (no argument: the one playing)',
    complete: songArgComplete,
    run: async (args, sh) => {
      needSignIn('change your liked songs')
      const song = args.trim() ? await songFromArg(args) : playingSong(sh)
      await apiFetch(`/library/favorites/${song.id}/`, {}, { method: 'DELETE' })
      sh.print(`removed ${song.name} from your liked songs`, 'ok')
    },
  },
  {
    name: 'liked', group: 'Library', usage: 'liked [play | shuffle]', description: 'List your liked songs, numbered, or play them all',
    complete: async (arg) => ['play', 'shuffle'].filter((w) => w.startsWith(arg.trim().toLowerCase())),
    run: async (args, sh) => {
      needSignIn('see your liked songs')
      const mode = args.trim().toLowerCase()
      if (mode && mode !== 'play' && mode !== 'shuffle') fail('usage: liked [play | shuffle]')
      const player = mode ? playerOf(sh) : null
      const favorites = await apiFetch<{ song: SongLite }[]>('/library/favorites/')
      const songs = favorites.map((f) => f.song)
      rememberList(songs)
      if (songs.length === 0) { sh.print('no liked songs yet (like <title>)', 'dim'); return }
      if (player) {
        await player.playCollection(await tracksOf(songs))
        if (mode === 'shuffle') player.setShuffle(true)
        sh.print(`▶ ${plural(songs.length, 'liked song')}${mode === 'shuffle' ? ', shuffled' : ''}`, 'ok')
        return
      }
      sh.print(numbered(songs.map((s) => s.name), 200))
    },
  },
  {
    name: 'playlists', aliases: ['pls'], group: 'Library', usage: 'playlists', description: 'List your playlists, numbered. With a subcommand (playlists show 5) it works like playlist',
    complete: completePlaylist,
    run: async (args, sh) => {
      if (args.trim()) { await PLAYLIST.run(args, sh); return }
      const list = await myPlaylists(true)
      if (list.length === 0) { sh.print('no playlists yet (playlist create <name>)', 'dim'); return }
      sh.print(numbered(list.map((p) => `${p.name}  (${plural(p.track_count, 'track')}${p.is_public ? ', public' : ''})`), 500))
    },
  },
  PLAYLIST,
  {
    name: 'stats', group: 'Library', usage: 'stats [all | 7 | 30] [N] [-r]',
    description: 'Your listening stats as bar charts: top songs, eras, categories, collaborators. -r reloads the song catalog (kept for a day)',
    complete: async (arg) => PERIODS.filter((p) => p.startsWith(arg.trim())),
    run: async (args, sh) => {
      needSignIn('see your listening stats')
      const words = args.trim().split(/\s+/).filter(Boolean)
      const period = (words.find((w) => PERIODS.includes(w)) ?? 'all') as ListeningPeriod
      const limit = Math.min(30, Math.max(3, Number(words.find((w) => /^\d+$/.test(w) && !PERIODS.includes(w))) || 10))
      const me = await getMe() as unknown as { listening_plays?: unknown }
      const plays = playsFrom(me.listening_plays)
      if (plays.length === 0) { sh.print('nothing played yet', 'dim'); return }
      const prefs = prefsForPeriod(plays, period)
      if (prefs.length === 0) { sh.print(`no plays in the last ${period} days`, 'dim'); return }
      const catalog = await loadCatalog(words.includes('-r'), () => sh.status('loading the song catalog (kept for a day)…'))
      const stats = buildListeningStats(joinPlayedSongs(prefs, catalog))
      const top = stats.played.slice(0, limit)
      const topMax = Math.max(1, top[0]?.playcount ?? 1)
      const width = Math.min(32, Math.max(...top.map((p) => p.song.name.length), 4))
      sh.print([
        `${period === 'all' ? 'All time' : `Last ${period} days`}: ${plural(stats.totalPlays, 'play')} · ${plural(stats.distinctSongs, 'song')} · ${formatListeningTime(stats.totalSeconds)}`,
        '',
        'Top songs',
        ...top.map((p) => `  ${p.song.name.slice(0, width).padEnd(width)}  ${'█'.repeat(Math.max(1, Math.round((p.playcount / topMax) * 24)))} ${p.playcount}`),
        '',
        'Eras',
        ...barRows(stats.eras, 6),
        '',
        'Categories',
        ...barRows(stats.categories, 5),
        ...(stats.collaborators.length ? ['', 'Collaborators', ...barRows(stats.collaborators, 5)] : []),
      ].join('\n'))
    },
  },
]
