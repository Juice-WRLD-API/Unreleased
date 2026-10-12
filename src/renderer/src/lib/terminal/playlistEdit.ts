import { useStore } from '../../store/useStore'
import {
  getPlaylist, getPlaylistCover, getPublicPlaylist, getPublicPlaylistCover, removePlaylistCover, renamePlaylist, reorderPlaylist,
  updatePlaylist, uploadPlaylistCover, type PlaylistSummary,
} from '../userApi'
import { pageRows } from './more'
import { pickLocalFile } from './pick'
import { fail, oneLine, type TermCtx } from './types'

// The rest of what the Playlists page does to a playlist: rename, describe,
// visibility, reorder, covers, and looking at a public one by id. `playlist`
// (library.ts) hands anything it doesn't know to runPlaylistEdit.
export const PLAYLIST_EDIT_SUBS = ['rename', 'describe', 'public', 'private', 'move', 'cover', 'view'] as const

type FromArg = (arg: string) => Promise<PlaylistSummary>

const refresh = (): Promise<void> => useStore.getState().refreshPlaylists()

function coverLine(c: { cover_image_url?: string | null; cover_image?: string | null; trackImages: string[] }): string {
  return c.cover_image_url || c.cover_image ? `cover  ${c.cover_image_url ?? '(uploaded image)'}` : `no cover - the grid uses the first ${c.trackImages.length} track images`
}

export async function runPlaylistEdit(sub: string, rest: string, ctx: TermCtx, playlistFromArg: FromArg): Promise<void> {
  switch (sub) {
    case 'view': {
      // Someone else's public playlist, by its id - no sign-in needed.
      const id = Number(rest.trim().replace(/^#/, ''))
      if (!Number.isInteger(id) || id < 1) fail('usage: playlist view <id>  (the id of a public playlist)')
      const pub = await getPublicPlaylist(id)
      const items = [...pub.items].sort((a, b) => a.position - b.position)
      ctx.print([
        `${pub.name}${pub.description ? ` - ${oneLine(pub.description)}` : ''}`,
        items.length ? pageRows(items.length, (n) => `${String(n + 1).padStart(3)}  ${items[n].song.name}`, 80) : '(empty)',
      ].join('\n'))
      return
    }
    case 'public': case 'private': {
      const pl = await playlistFromArg(rest)
      await updatePlaylist(pl.id, { is_public: sub === 'public' })
      await refresh()
      ctx.print(`"${pl.name}" is now ${sub}`, 'ok')
      return
    }
    case 'rename': case 'describe': {
      const split = rest.split(/\s+--\s+/)
      const text = split.slice(1).join(' -- ').trim()
      if (split.length < 2 || !text) fail(`usage: playlist ${sub} <name|N> -- <${sub === 'rename' ? 'new name' : 'text'}>`)
      const pl = await playlistFromArg(split[0])
      if (sub === 'rename') await renamePlaylist(pl.id, text)
      else await updatePlaylist(pl.id, { description: text })
      await refresh()
      ctx.print(sub === 'rename' ? `renamed "${pl.name}" to "${text}"` : `description of "${pl.name}" saved`, 'ok')
      return
    }
    case 'move': {
      // playlist move <name|N> -- <from> <to>, positions as `playlist show` numbers them.
      const split = rest.split(/\s+--\s+/)
      const pos = (split[1] ?? '').trim().split(/\s+/).map(Number)
      if (split.length < 2 || pos.length !== 2 || pos.some((n) => !Number.isInteger(n) || n < 1)) fail('usage: playlist move <name|N> -- <from> <to>')
      const pl = await playlistFromArg(split[0])
      const detail = await getPlaylist(pl.id)
      const ids = [...detail.items].sort((a, b) => a.position - b.position).map((i) => i.song.id)
      const [from, to] = pos
      if (from > ids.length || to > ids.length) fail(`${pl.name} has ${ids.length} song${ids.length === 1 ? '' : 's'}`)
      const [moved] = ids.splice(from - 1, 1)
      ids.splice(to - 1, 0, moved)
      await reorderPlaylist(pl.id, ids)
      ctx.print(`moved #${from} to #${to} in "${pl.name}"`, 'ok')
      return
    }
    case 'cover': {
      // playlist cover <name|N | id:N> [-- show | set | rm]
      const split = rest.split(/\s+--\s+/)
      const mode = (split[1] ?? 'show').trim().toLowerCase()
      const pub = /^id:(\d+)$/i.exec(split[0].trim())
      if (pub) {
        if (mode !== 'show') fail('only your own playlists can have their cover changed')
        ctx.print(coverLine(await getPublicPlaylistCover(Number(pub[1]))))
        return
      }
      const pl = await playlistFromArg(split[0])
      if (mode === 'show') ctx.print(coverLine(await getPlaylistCover(pl.id)))
      else if (mode === 'rm' || mode === 'remove') {
        await removePlaylistCover(pl.id)
        await refresh()
        ctx.print(`removed the cover of "${pl.name}"`, 'ok')
      } else if (mode === 'set') {
        const file = await pickLocalFile('image/*')
        await uploadPlaylistCover(pl.id, file)
        await refresh()
        ctx.print(`cover of "${pl.name}" set from ${file.name}`, 'ok')
      } else fail('usage: playlist cover <name|N | id:N> [-- show | set | rm]')
      return
    }
    default:
      fail('usage: playlist <play|shuffle|show|open|create|delete|add|remove|rename|describe|public|private|move|cover|view> ...')
  }
}
