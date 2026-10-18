import { getSongById, getSongsByIds, type JWApiSong } from '../juicewrldApi'
import { isPlayableSong } from '../songVersions'
import { memberVersionPrefs, prefLabel, versionPrefToggles, type VersionPrefMember } from '../versionPrefs'
import {
  getAllVersionGroups, getOwnVersionMeta, getVersionGroup, getVersionMetaForSongs, joinVersionGroup, linkSongVersion, searchVersionTitles,
  setGroupVersionTitle, setOwnVersionTitle, setSongVersion, type SongVersionMeta,
} from '../versionsApi'
import { useStore } from '../../store/useStore'
import { trackIdToSongId } from '../userApi'
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

// ── Preferred / excluded versions (versionprefs) ────────────────────────────
// The star and ban from Change version, compact view and WRLD's version notch:
// personal, so no editor account needed. The toggle rules themselves live in
// lib/versionPrefs (versionPrefToggles), shared with those menus.
const PREF_SUBS = ['list', 'prefer', 'unprefer', 'exclude', 'unexclude', 'clear']

interface PrefRow { song: JWApiSong; version: string | null; title: string | null }

/** The song named, or the one playing when `arg` is empty. */
async function prefTarget(arg: string): Promise<JWApiSong> {
  if (arg) return songRef(arg)
  const track = st().currentTrack ?? fail('nothing is playing - name a song: versionprefs <song>')
  const id = trackIdToSongId(track.id) ?? fail(`${track.title} isn’t a library song - name one: versionprefs <song>`)
  return (await getSongById(id)) ?? fail(`no song with id ${id}`)
}

/** The song and its versions, as Change version lists them: members with
 *  nothing to play (no path, and not a session with a playable edit) are left
 *  out, since starring one would break playback. Empty = not in a group. */
async function prefRows(song: JWApiSong): Promise<PrefRow[]> {
  const [own, group] = await Promise.all([getOwnVersionMeta(song.id), getVersionGroup(song.id)])
  if (!own) return []
  const metas = [own, ...group]
  const byId = new Map((await getSongsByIds(metas.map((m) => m.songId))).map((s) => [s.id, s]))
  byId.set(song.id, song)
  const rows = await Promise.all(metas.map(async (m): Promise<PrefRow | null> => {
    const s = byId.get(m.songId)
    if (!s) return null
    if (!(await isPlayableSong(s))) return null
    return { song: s, version: prefLabel(m), title: m.versionTitle }
  }))
  return rows.filter((r): r is PrefRow => !!r)
}

const memberOf = (r: PrefRow): VersionPrefMember => ({ songId: r.song.id, version: r.version })
const normLabel = (label: string): string => label.trim().toLowerCase()
const prefWriters = (): Parameters<typeof versionPrefToggles>[2] => ({ setDefault: st().setSongDefaultVersion, setExcluded: st().setSongExcludedVersions })

/** A row by its version label ("v2", "TV Mix", "Session") or its number in the list. */
function pickRow(rows: PrefRow[], typed: string): PrefRow {
  const byLabel = rows.find((r) => r.version && normLabel(r.version) === normLabel(typed))
  if (byLabel) return byLabel
  const n = /^\d+$/.test(typed) ? Number(typed) : 0
  const row = n ? rows[n - 1] ?? fail(`pick a number from 1 to ${rows.length}`) : fail(`no version labelled "${typed}" - versionprefs list shows them`)
  if (!row.version) fail(`#${row.song.id} ${row.song.name} has no version label, so it can’t be preferred or excluded (an editor can give it one: versions set)`)
  return row
}

function prefTable(rows: PrefRow[], current: number): string {
  const { preferred, excluded } = memberVersionPrefs(rows.map(memberOf), st().songPrefs)
  const mark = (v: string | null): string => (!v ? '' : preferred.has(normLabel(v)) ? '★' : excluded.has(normLabel(v)) ? '⊘' : '·')
  const body = table(rows.map((r, i) => [`${i + 1}`, mark(r.version), r.version ?? '(no label)', r.song.name, `#${r.song.id}${r.song.id === current ? '  ← this one' : ''}`]))
  const note = preferred.size ? '★ preferred (auto-picks play one of these) · ⊘ excluded' : 'nothing preferred - any version not excluded (⊘) can be picked'
  return `${body}\n${note}`
}

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
  {
    name: 'versionprefs', aliases: ['vprefs', 'vpref'], group: 'Library',
    usage: 'versionprefs [list] [<song>] · prefer|unprefer|exclude|unexclude [<song> --] <label|N> · clear [<song>]',
    description: 'Your preferred (★) and excluded (⊘) versions of a song - the star and ban in Change version. <song> is a title, a number from find or id:123; left out, the song playing. <label> is a version label (v2, TV Mix, Session) or its number in the list. Several can be preferred; preferring un-excludes, excluding un-prefers; clear drops every star',
    covers: ['versionsApi.getOwnVersionMeta', 'versionsApi.getVersionGroup', 'juicewrldApi.getSongsByIds', 'sessionEditsApi.hasPlayableSessionEdit'],
    complete: (before, partial) => (before.length === 0 ? PREF_SUBS.filter((s) => s.startsWith(partial.toLowerCase())) : before.includes('--') ? [] : completeSongs(before.slice(PREF_SUBS.includes(before[0]) ? 1 : 0), partial)),
    run: async (args, ctx) => {
      const json = /(^|\s)--json(?=\s|$)/.test(args)
      const raw = args.replace(/(^|\s)--json(?=\s|$)/g, ' ').trim()
      const m = /^(\S+)\s*([\s\S]*)$/.exec(raw)
      const first = (m?.[1] ?? '').toLowerCase()
      const sub = PREF_SUBS.includes(first) ? first : 'list'
      // Everything after the subcommand word (the whole line when it was left out: `versionprefs <song>`).
      const tail = (PREF_SUBS.includes(first) ? (m?.[2] ?? '') : raw).trim()

      if (sub === 'list' || sub === 'clear') {
        const song = await prefTarget(tail)
        const rows = await prefRows(song)
        if (rows.length === 0) { ctx.print(`${song.name} isn’t linked to any other versions`, 'dim'); return }
        const members = rows.map(memberOf)
        if (sub === 'clear') {
          const prefs = st().songPrefs
          if (memberVersionPrefs(members, prefs).preferred.size === 0) { ctx.print(`no preferred versions of ${song.name} to clear`, 'dim'); return }
          versionPrefToggles(members, prefs, prefWriters()).clearPreferred()
          ctx.print(`cleared the preferred versions of ${song.name}`, 'ok')
        } else if (json) {
          const { preferred, excluded } = memberVersionPrefs(members, st().songPrefs)
          const has = (set: Set<string>, v: string | null): boolean => !!v && set.has(normLabel(v))
          asJson(ctx, true, rows.map((r) => ({ songId: r.song.id, name: r.song.name, version: r.version, versionTitle: r.title, preferred: has(preferred, r.version), excluded: has(excluded, r.version) })))
          return
        }
        ctx.print(prefTable(rows, song.id))
        return
      }

      // prefer / unprefer / exclude / unexclude take "[<song> --] <label>".
      const parts = tail.split(/\s+--\s+/)
      const [songArg, labelArg] = parts.length > 1 ? [parts[0].trim(), parts.slice(1).join(' -- ').trim()] : ['', tail]
      if (!labelArg) fail(`usage: versionprefs ${sub} [<song> --] <label|N>`)
      const song = await prefTarget(songArg)
      const rows = await prefRows(song)
      if (rows.length === 0) fail(`${song.name} isn’t linked to any other versions`)
      const row = pickRow(rows, labelArg)
      const label = row.version as string
      const prefs = st().songPrefs
      const members = rows.map(memberOf)
      const { preferred, excluded } = memberVersionPrefs(members, prefs)
      const toggles = versionPrefToggles(members, prefs, prefWriters())
      const isPreferred = preferred.has(normLabel(label))
      const isExcluded = excluded.has(normLabel(label))
      if (sub === 'prefer') {
        if (isPreferred) { ctx.print(`${label} is already preferred`, 'dim'); return }
        toggles.togglePreferred(memberOf(row))
        ctx.print(`★ ${label} is now a preferred version of ${song.name}${isExcluded ? ' (no longer excluded)' : ''}`, 'ok')
      } else if (sub === 'unprefer') {
        if (!isPreferred) { ctx.print(`${label} isn’t preferred`, 'dim'); return }
        toggles.togglePreferred(memberOf(row))
        ctx.print(`${label} is no longer preferred`, 'ok')
      } else if (sub === 'exclude') {
        if (isExcluded) { ctx.print(`${label} is already excluded`, 'dim'); return }
        toggles.toggleExcluded(memberOf(row))
        ctx.print(`⊘ ${label} is now excluded from auto-picks${isPreferred ? ' (no longer preferred)' : ''}`, 'ok')
      } else {
        if (!isExcluded) { ctx.print(`${label} isn’t excluded`, 'dim'); return }
        toggles.toggleExcluded(memberOf(row))
        ctx.print(`${label} is no longer excluded`, 'ok')
      }
      ctx.print(prefTable(rows, song.id))
    },
  },
]
