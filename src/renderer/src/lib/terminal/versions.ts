import { getSongById, type JWApiSong } from '../juicewrldApi'
import {
  getAllVersionGroups, getOwnVersionMeta, getVersionGroup, getVersionMetaForSongs, joinVersionGroup, linkSongVersion, searchVersionTitles,
  setGroupVersionTitle, setOwnVersionTitle, setSongVersion, type SongVersionMeta,
} from '../versionsApi'
import { useStore } from '../../store/useStore'
import { completeSongs, songFromArg } from './player'
import { asJson, fail, idArg, table, type TermCommand } from './types'

// Version groups: songs linked as versions of one another ("She's The One" v1 /
// v2 / TV Mix). Reading is open; writing needs an editor or administrator
// token, which the API checks.
const SUBS = ['show', 'all', 'search', 'link', 'set', 'title', 'grouptitle', 'join', 'meta']
const st = (): ReturnType<typeof useStore.getState> => useStore.getState()

/** A song by title / find number, or `id:123` for an exact library id. */
async function songRef(arg: string): Promise<JWApiSong> {
  const id = /^id:(\d+)$/i.exec(arg.trim())
  if (id) return (await getSongById(Number(id[1]))) ?? fail(`no song with id ${id[1]}`)
  return songFromArg(arg.trim())
}

// "<song> -- <text>"; the text can be `none` to clear it.
function splitDash(rest: string, usage: string): [string, string] {
  const parts = rest.split(/\s+--\s+/)
  const tail = parts.slice(1).join(' -- ').trim()
  if (parts.length < 2 || !parts[0].trim() || !tail) fail(`usage: ${usage}`)
  return [parts[0].trim(), tail]
}
const clearable = (text: string): string | null => (/^(none|-)$/i.test(text) ? null : text)

function meta(m: SongVersionMeta, names: Map<number, string>): string[] {
  return [`#${m.songId}`, names.get(m.songId) ?? '', m.version ?? '-', m.versionTitle ?? '-', `group ${m.groupId}`]
}

async function nameMap(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  await Promise.all([...new Set(ids)].slice(0, 60).map(async (id) => { const s = await getSongById(id).catch(() => null); if (s) out.set(id, s.name) }))
  return out
}

const needEditor = (): void => { if (!st().account) fail('sign in first (login) - changing versions needs an editor account') }

export const VERSION_COMMANDS: TermCommand[] = [
  {
    name: 'versions', aliases: ['vers'], group: 'Editor',
    usage: 'versions [show] <song> · all · search <text> · link <song> -- <other song> · set <song> -- <label|none> · title <song> -- <title|none> · grouptitle <groupId> -- <title|none> · join <song> -- <groupId> · meta <song…>',
    description: 'Version groups (the same song as v1, v2, TV Mix…). <song> is a title, a number from find or id:123. link, set, title, grouptitle and join need an editor account',
    covers: [
      'versionsApi.getVersionGroup', 'versionsApi.getAllVersionGroups', 'versionsApi.getVersionMetaForSongs', 'versionsApi.linkSongVersion',
      'versionsApi.getOwnVersionMeta', 'versionsApi.setSongVersion', 'versionsApi.setOwnVersionTitle', 'versionsApi.setGroupVersionTitle',
      'versionsApi.searchVersionTitles', 'versionsApi.joinVersionGroup',
    ],
    complete: (before, partial) => (before.length === 0 ? SUBS.filter((s) => s.startsWith(partial.toLowerCase())) : ['all', 'search', 'grouptitle'].includes(before[0]) ? [] : completeSongs(before.slice(1).filter((w) => w !== '--'), partial)),
    run: async (args, ctx) => {
      const json = /(^|\s)--json(?=\s|$)/.test(args)
      const raw = args.replace(/(^|\s)--json(?=\s|$)/g, ' ').trim()
      const m = /^(\S+)\s*([\s\S]*)$/.exec(raw)
      const first = (m?.[1] ?? '').toLowerCase()
      const sub = SUBS.includes(first) ? first : 'show'
      // Everything after the subcommand word (the whole line when it was left out: `versions <song>`).
      const tail = SUBS.includes(first) ? (m?.[2] ?? '') : raw

      if (sub === 'show') {
        if (!tail) fail('usage: versions <song>')
        const song = await songRef(tail)
        const [own, group] = await Promise.all([getOwnVersionMeta(song.id), getVersionGroup(song.id)])
        if (asJson(ctx, json, { song: song.id, own, group })) return
        if (!own) { ctx.print(`${song.name} isn’t linked to any other versions`, 'dim'); return }
        const names = await nameMap(group.map((g) => g.songId))
        ctx.print([`${song.name}  -  ${own.version ?? 'no label'}${own.versionTitle ? ` of "${own.versionTitle}"` : ''}  (group ${own.groupId})`, group.length ? table(group.map((g) => meta(g, names))) : '(no other versions)'].join('\n'))
      } else if (sub === 'all') {
        const all = await getAllVersionGroups()
        if (asJson(ctx, json, all)) return
        const byGroup = new Map<number, SongVersionMeta[]>()
        for (const m of all) byGroup.set(m.groupId, [...(byGroup.get(m.groupId) ?? []), m])
        const rows = [...byGroup.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 60).map(([g, ms]) => [`group ${g}`, ms[0].versionTitle ?? '', `${ms.length} songs`])
        ctx.print(`${table(rows)}\n${byGroup.size} titled groups${byGroup.size > 60 ? ' (60 largest shown)' : ''}`)
      } else if (sub === 'search') {
        if (!tail) fail('usage: versions search <text>')
        const found = await searchVersionTitles(tail, 20)
        if (asJson(ctx, json, found)) return
        ctx.print(found.length ? table(found.map((f) => [f.title, `group ${f.groupId}`])) : 'no version titles match', found.length ? 'plain' : 'dim')
      } else if (sub === 'meta') {
        const songs = await Promise.all(tail.split(/\s+,?\s*|,\s*/).filter(Boolean).map((w) => songRef(w)))
        if (songs.length === 0) fail('usage: versions meta <song> [song…]')
        const found = await getVersionMetaForSongs(songs.map((s) => s.id))
        if (asJson(ctx, json, [...found.values()])) return
        ctx.print(found.size ? table([...found.values()].map((m) => meta(m, new Map(songs.map((s) => [s.id, s.name]))))) : 'none of those are linked into a group', found.size ? 'plain' : 'dim')
      } else if (sub === 'link') {
        needEditor()
        const [a, b] = splitDash(tail, 'versions link <song> -- <other song>')
        const [one, two] = await Promise.all([songRef(a), songRef(b)])
        if (one.id === two.id) fail('that is the same song twice')
        await linkSongVersion(one.id, two.id)
        ctx.print(`linked ${one.name} and ${two.name} as versions of each other`, 'ok')
      } else if (sub === 'set') {
        needEditor()
        const [s, label] = splitDash(tail, 'versions set <song> -- <label|none>')
        const song = await songRef(s)
        const own = await getOwnVersionMeta(song.id)
        const value = clearable(label)
        await setSongVersion(song.id, value, own?.groupId ?? null)
        ctx.print(value ? `${song.name} is now "${value}"` : `${song.name}’s version label cleared`, 'ok')
      } else if (sub === 'title') {
        needEditor()
        const [s, title] = splitDash(tail, 'versions title <song> -- <title|none>')
        const song = await songRef(s)
        const own = await getOwnVersionMeta(song.id)
        const value = clearable(title)
        const group = await setOwnVersionTitle(song.id, value, own?.groupId ?? null)
        ctx.print(`${song.name} is in group ${group}${value ? ` titled "${value}"` : ' with no title'}`, 'ok')
      } else if (sub === 'grouptitle') {
        needEditor()
        const [g, title] = splitDash(tail, 'versions grouptitle <groupId> -- <title|none>')
        const value = clearable(title)
        await setGroupVersionTitle(idArg(g, 'versions grouptitle <groupId> -- <title|none>'), value)
        ctx.print(`group ${g} ${value ? `is now titled "${value}"` : 'has no title'}`, 'ok')
      } else if (sub === 'join') {
        needEditor()
        const [s, g] = splitDash(tail, 'versions join <song> -- <groupId>')
        const song = await songRef(s)
        const now = await joinVersionGroup(song.id, idArg(g, 'versions join <song> -- <groupId>'))
        ctx.print(`${song.name} is now in group ${now}`, 'ok')
      }
    },
  },
]
