import { adminCreateAlbum, adminDeleteAlbum, adminFetchAlbums, adminUpdateAlbum, fetchAlbums, fetchArtists, type AlbumWritePayload } from '../albumsApi'
import {
  adminCreateChannel, adminDeactivateChannel, adminListChannelMembers, adminSetChannelMember, adminUpdateChannel, fetchChannelList,
} from '../channelApi'
import { adminCreateEra, adminDeleteEra, adminUpdateEra, fetchEraList } from '../erasApi'
import { asJson, confirmAction, fail, idArg, parseArgs, parseBool, table, type TermCommand } from './types'

// The Admin page's catalog tabs: eras, albums/artists and Files-tab channels.
// Admin-only (the group gates them; the API refuses anyone else too).
const onOff = (v: string | undefined, name: string): boolean | undefined => (v === undefined ? undefined : parseBool(v) ?? fail(`--${name} takes on or off`))
const num = (v: string | undefined, name: string): number | undefined => {
  if (v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : fail(`--${name} must be a number`)
}
// Drops the keys a command wasn't given, so a PATCH only carries what changed.
const defined = <T extends Record<string, unknown>>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>

export const CATALOG_COMMANDS: TermCommand[] = [
  {
    name: 'era', group: 'Admin', usage: 'era [ls] · new <name> [--desc d] [--time t] [--plays n] · edit <id> [--name n] [--desc d] [--time t] [--plays n] · rm <id>',
    description: 'The eras the catalog is sorted into',
    covers: ['erasApi.fetchEraList', 'erasApi.adminCreateEra', 'erasApi.adminUpdateEra', 'erasApi.adminDeleteEra'],
    complete: (before, partial) => (before.length === 0 ? ['ls', 'new', 'edit', 'rm'].filter((v) => v.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => {
      const { rest, bool, value } = parseArgs(args, ['name', 'desc', 'time', 'plays'])
      const sub = (rest.shift() ?? 'ls').toLowerCase()
      const fields = { description: value.get('desc'), time_frame: value.get('time'), play_count: num(value.get('plays'), 'plays') }
      if (sub === 'ls') {
        const list = await fetchEraList()
        if (asJson(ctx, bool.has('json'), list)) return
        ctx.print(list.length ? table(list.map((e) => [`#${e.id}`, e.name, e.time_frame, `${e.play_count} plays`])) : 'no eras', list.length ? 'plain' : 'dim')
      } else if (sub === 'new') {
        const name = value.get('name') ?? rest.join(' ')
        if (!name) fail('usage: era new <name> [--desc d] [--time t]')
        const e = await adminCreateEra({ name, ...defined(fields) })
        ctx.print(`created era #${e.id} ${e.name}`, 'ok')
      } else if (sub === 'edit') {
        const id = idArg(rest[0], 'era edit <id> [--name n] [--desc d] [--time t] [--plays n]')
        const patch = defined({ name: value.get('name'), ...fields })
        if (Object.keys(patch).length === 0) fail('nothing to change - give --name, --desc, --time or --plays')
        const e = await adminUpdateEra(id, patch)
        ctx.print(`updated era #${e.id} ${e.name}`, 'ok')
      } else if (sub === 'rm') {
        const id = idArg(rest[0], 'era rm <id>')
        if (!confirmAction(ctx, `Delete era #${id}? Songs in it lose their era.`, bool.has('y'))) return
        await adminDeleteEra(id)
        ctx.print(`deleted era #${id}`, 'ok')
      } else fail('usage: era [ls | new | edit | rm]')
    },
  },
  {
    name: 'album', group: 'Admin',
    usage: 'album [ls [--public]] · new <title> --artist <id> --date YYYY-MM-DD [--type t] [--desc d] [--cover url] [--songs "path|path"] · edit <id> [same flags] · rm <id>',
    description: 'Albums (and, with `album artists`, the artists they belong to). --songs lists file paths in track order, separated by |',
    covers: ['albumsApi.fetchAlbums', 'albumsApi.fetchArtists', 'albumsApi.adminFetchAlbums', 'albumsApi.adminCreateAlbum', 'albumsApi.adminUpdateAlbum', 'albumsApi.adminDeleteAlbum'],
    complete: (before, partial) => (before.length === 0 ? ['ls', 'artists', 'new', 'edit', 'rm'].filter((v) => v.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => {
      const { rest, bool, value } = parseArgs(args, ['title', 'artist', 'date', 'type', 'desc', 'cover', 'songs', 'plays'])
      const sub = (rest.shift() ?? 'ls').toLowerCase()
      const songs = value.has('songs') ? (value.get('songs') as string).split('|').map((p) => p.trim()).filter(Boolean).map((path, i) => ({ order: i + 1, path })) : undefined
      const fields = defined({
        title: value.get('title'), artist_id: num(value.get('artist'), 'artist'), release_date: value.get('date'), type: value.get('type'),
        description: value.get('desc'), cover_url: value.get('cover'), play_count: num(value.get('plays'), 'plays'), songs,
      }) as Partial<AlbumWritePayload>
      if (sub === 'ls') {
        const list = bool.has('public') ? await fetchAlbums() : await adminFetchAlbums()
        if (asJson(ctx, bool.has('json'), list)) return
        ctx.print(list.length ? table(list.map((a) => [`#${a.id}`, a.title, a.artist?.name ?? '', a.release_date, `${a.songs?.length ?? 0} songs`])) : 'no albums', list.length ? 'plain' : 'dim')
      } else if (sub === 'artists') {
        const list = await fetchArtists()
        if (asJson(ctx, bool.has('json'), list)) return
        ctx.print(list.length ? table(list.map((a) => [`#${a.id}`, a.name])) : 'no artists', list.length ? 'plain' : 'dim')
      } else if (sub === 'new') {
        const title = fields.title ?? rest.join(' ')
        const { artist_id, release_date } = fields
        if (!title || artist_id === undefined || !release_date) return fail('usage: album new <title> --artist <id> --date YYYY-MM-DD (artist ids: album artists)')
        const a = await adminCreateAlbum({ ...fields, title, artist_id, release_date })
        ctx.print(`created album #${a.id} ${a.title}`, 'ok')
      } else if (sub === 'edit') {
        const id = idArg(rest[0], 'album edit <id> [--title t] [--date d] …')
        if (Object.keys(fields).length === 0) fail('nothing to change - give --title, --artist, --date, --type, --desc, --cover, --plays or --songs')
        const a = await adminUpdateAlbum(id, fields)
        ctx.print(`updated album #${a.id} ${a.title}`, 'ok')
      } else if (sub === 'rm') {
        const id = idArg(rest[0], 'album rm <id>')
        if (!confirmAction(ctx, `Delete album #${id}?`, bool.has('y'))) return
        await adminDeleteAlbum(id)
        ctx.print(`deleted album #${id}`, 'ok')
      } else fail('usage: album [ls | artists | new | edit | rm]')
    },
  },
  {
    name: 'channels', group: 'Admin',
    usage: 'channels [ls] · new <name> [--slug s] [--desc d] [--order n] · edit <id> [--name n] [--desc d] [--order n] [--active on|off] · rm <id> · members <id> · member <id> <userId> [--editor on|off] [--contributor on|off] [--manager on|off] [--auto-edits on|off] [--auto-comp on|off]',
    description: 'Manage the Files-tab channels and who can edit, contribute to or manage each (channel, singular, switches the one you are browsing)',
    covers: ['channelApi.fetchChannelList', 'channelApi.adminCreateChannel', 'channelApi.adminUpdateChannel', 'channelApi.adminDeactivateChannel', 'channelApi.adminListChannelMembers', 'channelApi.adminSetChannelMember'],
    complete: (before, partial) => (before.length === 0 ? ['ls', 'new', 'edit', 'rm', 'members', 'member'].filter((v) => v.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => {
      const { rest, bool, value } = parseArgs(args, ['name', 'slug', 'desc', 'order', 'active', 'editor', 'contributor', 'manager', 'auto-edits', 'auto-comp'])
      const sub = (rest.shift() ?? 'ls').toLowerCase()
      if (sub === 'ls') {
        const list = await fetchChannelList()
        if (asJson(ctx, bool.has('json'), list)) return
        ctx.print(table(list.map((c) => [`#${c.id}`, c.slug, c.name, `${c.is_primary ? 'primary ' : ''}${c.is_active ? '' : 'inactive'}`])))
      } else if (sub === 'new') {
        const name = value.get('name') ?? rest.join(' ')
        if (!name) fail('usage: channels new <name> [--slug s] [--desc d] [--order n]')
        const c = await adminCreateChannel({ name, slug: value.get('slug'), description: value.get('desc'), sort_order: num(value.get('order'), 'order') })
        ctx.print(`created channel #${c.id} (${c.slug})`, 'ok')
      } else if (sub === 'edit') {
        const id = idArg(rest[0], 'channels edit <id> [--name n] [--desc d] [--order n] [--active on|off]')
        const patch = defined({ name: value.get('name'), description: value.get('desc'), sort_order: num(value.get('order'), 'order'), is_active: onOff(value.get('active'), 'active') })
        if (Object.keys(patch).length === 0) fail('nothing to change - give --name, --desc, --order or --active')
        const c = await adminUpdateChannel(id, patch)
        ctx.print(`updated channel #${c.id} (${c.slug})`, 'ok')
      } else if (sub === 'rm') {
        const id = idArg(rest[0], 'channels rm <id>')
        if (!confirmAction(ctx, `Deactivate channel #${id}?`, bool.has('y'))) return
        await adminDeactivateChannel(id)
        ctx.print(`channel #${id} deactivated`, 'ok')
      } else if (sub === 'members') {
        const rows = await adminListChannelMembers(idArg(rest[0], 'channels members <id>'))
        if (asJson(ctx, bool.has('json'), rows)) return
        const yes = (b: boolean, l: string): string => (b ? l : '')
        ctx.print(rows.length ? table(rows.map((m) => [`#${m.user_id}`, m.username, [yes(m.manager_enabled, 'manager'), yes(m.editor_enabled, 'editor'), yes(m.contributor_enabled, 'contributor'), yes(m.auto_approve_proposals, 'auto-edits'), yes(m.auto_approve_comp_proposals, 'auto-comp')].filter(Boolean).join(' ')])) : 'no members', rows.length ? 'plain' : 'dim')
      } else if (sub === 'member') {
        const id = idArg(rest[0], 'channels member <id> <userId> [--editor on|off] …')
        const user_id = idArg(rest[1], 'channels member <id> <userId> [--editor on|off] …')
        const patch = defined({
          editor_enabled: onOff(value.get('editor'), 'editor'), contributor_enabled: onOff(value.get('contributor'), 'contributor'), manager_enabled: onOff(value.get('manager'), 'manager'),
          auto_approve_proposals: onOff(value.get('auto-edits'), 'auto-edits'), auto_approve_comp_proposals: onOff(value.get('auto-comp'), 'auto-comp'),
        })
        if (Object.keys(patch).length === 0) fail('nothing to change - give --editor, --contributor, --manager, --auto-edits or --auto-comp')
        const m = await adminSetChannelMember(id, { user_id, ...patch })
        ctx.print(`${m.username} in ${m.channel_name}: editor ${m.editor_enabled ? 'on' : 'off'}, contributor ${m.contributor_enabled ? 'on' : 'off'}, manager ${m.manager_enabled ? 'on' : 'off'}`, 'ok')
      } else fail('usage: channels [ls | new | edit | rm | members | member]')
    },
  },
]
